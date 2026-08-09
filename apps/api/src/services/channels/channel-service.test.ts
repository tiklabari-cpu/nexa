/**
 * Channel address ownership — the two branches the database cannot be made to
 * take on demand (FR-MOD-08.5.7 · NFR-S4/S5).
 *
 * The invariant "one workspace per connected channel address" is proven against
 * real Postgres in `test/integration/channels-adapters.test.ts`, including the
 * index itself. Two of its arms are unreachable from there by construction, and
 * they are exactly the arms that matter when something has already gone wrong:
 *
 *   - the write path losing the check-then-write race (Postgres raises P2002),
 *   - the read path finding more than one channel at one address.
 *
 * With the unique index in place neither can be provoked through the API, so
 * they are driven here with a stub client. A branch that only runs when the
 * invariant is already broken is precisely the one that rots untested — and it
 * is the difference between refusing and silently delivering a stranger's
 * message into the wrong tenant.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { isApiError, type ApiError } from '../../lib/api-error.js';
import { ChannelService } from './channel-service.js';
import type { TenantClient } from '../../lib/tenant.js';

const LICENSE = 42n;
const BRAND = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION = '22222222-2222-4222-8222-222222222222';

const CONNECT_BODY = {
  code: 'IGQ_mock_oauth_code',
  ig_user_id: '17841400000000001',
  username: 'acme_support',
};

/** Prisma's own unique-violation error, as the driver would raise it. */
function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: 'channels_connected_address_key' },
  });
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (isApiError(error)) return error;
    throw error;
  }
  throw new Error('expected the call to be refused, but it resolved');
}

describe('connect — the ownership pre-check (08.5.7-d)', () => {
  /**
   * A client whose `channel_address_owner` probe answers with `owners`, and whose
   * upsert records that it ran. Both refusals produce the same 400 end to end, so
   * this is the only way to see *which* one fired — and the pre-check's whole
   * job is to refuse without attempting the write.
   */
  function clientOwnedBy(owners: Array<{ license_id: bigint; brand_id: string }>): {
    tx: TenantClient;
    wrote: () => boolean;
  } {
    let wrote = false;
    const tx = {
      $queryRaw: async () => owners,
      channel: {
        upsert: async () => {
          wrote = true;
          return {
            type: 'instagram',
            brandId: BRAND,
            status: 'connected',
            config: { address: CONNECT_BODY.ig_user_id },
            createdAt: new Date(0),
          };
        },
      },
    } as unknown as TenantClient;
    return { tx, wrote: () => wrote };
  }

  const tenant = { licenseId: LICENSE, organizationId: ORGANIZATION, brandId: BRAND };

  it('refuses another workspace\'s address without attempting the write', async () => {
    const { tx, wrote } = clientOwnedBy([{ license_id: 7n, brand_id: BRAND }]);
    const error = await caught(new ChannelService().connect(tx, tenant, 'instagram', CONNECT_BODY));

    expect(error.status).toBe(400);
    expect(error.message).toBe('That channel address is already connected.');
    expect(wrote()).toBe(false);
  });

  it('refuses another brand of the same workspace, and allows re-connecting one\'s own', async () => {
    // Same licence, different brand: still two rows at one address, and the
    // resolver answers with a licence rather than a brand — so still ambiguous.
    const other = clientOwnedBy([{ license_id: LICENSE, brand_id: '33333333-3333-4333-8333-333333333333' }]);
    expect(
      (await caught(new ChannelService().connect(other.tx, tenant, 'instagram', CONNECT_BODY))).status,
    ).toBe(400);
    expect(other.wrote()).toBe(false);

    // The holder is this very channel row — the upsert path, which must stay open.
    const mine = clientOwnedBy([{ license_id: LICENSE, brand_id: BRAND }]);
    const channel = await new ChannelService().connect(mine.tx, tenant, 'instagram', CONNECT_BODY);
    expect(channel.connected).toBe(true);
    expect(mine.wrote()).toBe(true);
  });
});

describe('connect — the address race (08.5.7-d)', () => {
  /** A tenant client where the ownership probe finds nothing and the write
   *  nevertheless collides: the state a connect that lost the race sees. */
  function racingClient(): TenantClient {
    return {
      // `channel_address_owner` — free, as far as this session could tell.
      $queryRaw: async () => [],
      channel: {
        upsert: async () => {
          throw uniqueViolation();
        },
      },
    } as unknown as TenantClient;
  }

  it('turns a losing race into the same refusal the pre-check gives', async () => {
    const service = new ChannelService();
    const error = await caught(
      service.connect(
        racingClient(),
        { licenseId: LICENSE, organizationId: ORGANIZATION, brandId: BRAND },
        'instagram',
        CONNECT_BODY,
      ),
    );

    // Same status and same wording as the pre-check refusal, so which of the two
    // fired is invisible to the caller — the winner is arbitrary, the outcome is
    // not.
    expect(error.status).toBe(400);
    expect(error.message).toBe('That channel address is already connected.');
    // …and it names no workspace: the address is taken, but not by whom (NFR-S5).
    expect(error.message).not.toMatch(/license|workspace \d|brand|organi[sz]ation/i);
    expect(error.details).toBeUndefined();
  });

  it('does not swallow unrelated database failures as a taken address', async () => {
    const service = new ChannelService();
    const boom = new Error('connection terminated');
    const client = {
      $queryRaw: async () => [],
      channel: {
        upsert: async () => {
          throw boom;
        },
      },
    } as unknown as TenantClient;

    await expect(
      service.connect(
        client,
        { licenseId: LICENSE, organizationId: ORGANIZATION, brandId: BRAND },
        'instagram',
        CONNECT_BODY,
      ),
    ).rejects.toBe(boom);
  });
});

describe('resolveLicense — more than one channel at one address (08.5.7-d)', () => {
  /** A db whose resolver answers with `rows` — the shape of data that predates
   *  the unique index, or was written around the service. */
  function dbReturning(rows: unknown[]): PrismaClient {
    return { $queryRaw: async () => rows } as unknown as PrismaClient;
  }

  const rowFor = (licenseId: bigint, organizationId: string) => ({
    license_id: licenseId,
    organization_id: organizationId,
    license_status: 'active',
  });

  it('refuses to guess a tenant when two licences answer to one address', async () => {
    const service = new ChannelService();
    const error = await caught(
      service.resolveLicense(
        dbReturning([rowFor(1n, ORGANIZATION), rowFor(2n, BRAND)]),
        'instagram',
        '17841400000000001',
      ),
    );

    // Not `rows[0]`: that would route a message to whichever tenant Postgres
    // happened to list first, in undefined order and with nothing to see later.
    expect(error.status).toBe(500);
    expect(error.type).toBe('internal');
    // 5xx is what gets logged at error level by the error handler, which is the
    // point — a broken invariant should be loud, not a routine 404.
  });

  it('still resolves the single match, and 404s no match or a closed workspace', async () => {
    const service = new ChannelService();
    const one = await service.resolveLicense(
      dbReturning([rowFor(LICENSE, ORGANIZATION)]),
      'instagram',
      '17841400000000001',
    );
    expect(one).toEqual({ licenseId: LICENSE, organizationId: ORGANIZATION });

    const none = await caught(service.resolveLicense(dbReturning([]), 'instagram', 'nobody'));
    expect(none.status).toBe(404);

    const closed = await caught(
      service.resolveLicense(
        dbReturning([{ ...rowFor(LICENSE, ORGANIZATION), license_status: 'canceled' }]),
        'instagram',
        '17841400000000001',
      ),
    );
    expect(closed.status).toBe(404);
  });
});
