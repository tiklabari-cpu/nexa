/**
 * Member recognition — the four stores (SiyahTuş analysis ID-03 · owner
 * decision K4 · tm 287.1, migration 20261015180000_member_recognition).
 *
 * Nothing writes these tables yet: the member token is minted and checked from
 * tm 287.2, the matches and links are served from tm 287.4. What is pinned here
 * is what the database promises on its own, before any service relies on it:
 *
 *   - **Tenant isolation.** A signing key, a revocation, the settings and an
 *     identity link are each one workspace's. Read and write are attacked
 *     through the client the application uses (`siyahtus_app`, subject to RLS);
 *     fixtures go in through the owner, which RLS exempts, so the other
 *     tenant's rows really exist while the attack fails to reach them.
 *   - **What the application role may not do.** A revocation is not taken
 *     back, and no key, setting or link is deleted by the application — rows
 *     leave only with their licence or customer.
 *   - **The CHECKs.** A key stored in the clear, half a previous key, a token
 *     lifetime outside a day..a year, a link stored twice or to oneself.
 *   - **One set of numbers.** The column default and CHECK bounds, the contract
 *     and `@siyahtus/types` describe the same lifetime and rotation window.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadOpenApiDocument } from '@siyahtus/contract';
import {
  MEMBER_KEY_ROTATION_GRACE,
  MEMBER_TOKEN_COOKIE,
  MEMBER_TOKEN_TTL,
  POSSIBLE_MATCH_FIELDS,
  POSSIBLE_MATCH_LIMIT,
  memberTokenCookieName,
} from '@siyahtus/types';
import { withTenant, type TenantClient } from '../../src/lib/tenant.js';
import {
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** As much of a JSON schema as these tests read. */
interface SchemaNode {
  enum?: string[];
  minimum?: number;
  maximum?: number;
  default?: number;
  maxItems?: number;
  required?: string[];
  properties?: Record<string, SchemaNode>;
}

/** The bundled contract's component schemas. */
function contractSchemas(): Record<string, SchemaNode> {
  const document = loadOpenApiDocument() as unknown as {
    components: { schemas: Record<string, SchemaNode> };
  };
  return document.components.schemas;
}

/** A value shaped like `lib/credential-cipher.ts` output — what the CHECK admits. */
const SEALED = 'v1:aXZpdml2aXZpdml2:dGFndGFndGFndGFndGFn:Y2lwaGVydGV4dA';
/** A raw 32-byte key, base64url — what the CHECK exists to refuse. */
const RAW_KEY = 'q83vEjRWeJq83vEjRWeJq83vEjRWeJq83vEjRWeJq8M';

const TABLES = {
  member_token_keys: 'siyahtus_current_license',
  member_token_revocations: 'siyahtus_current_license',
  member_recognition_settings: 'siyahtus_current_license',
  customer_identity_links: 'siyahtus_current_organization',
} as const;

/** The pair in the order `customer_identity_links_order_check` stores it. */
function canonical(x: string, y: string): { customerAId: string; customerBId: string } {
  return x < y ? { customerAId: x, customerBId: y } : { customerAId: y, customerBId: x };
}

describe('member recognition schema (ID-03 · K4)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;
  /** A second customer of tenant A's organization, so A has a pair to link. */
  let aSecondCustomerId: string;

  /** Run as the application role, under one tenant's RLS context. */
  const asTenant = <T>(tenant: TenantFixture, fn: (tx: TenantClient) => Promise<T>) =>
    withTenant(app, { licenseId: tenant.licenseId, organizationId: tenant.organizationId }, fn);

  beforeAll(() => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    const second = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, username: 'mira_92' },
      select: { id: true },
    });
    aSecondCustomerId = second.id;
  });

  // =========================================================================
  // Tenant isolation
  // =========================================================================

  describe('tenant isolation', () => {
    it('turns RLS on for all four tables, each policy guarding read and write (NFR-S4 · SEMA-MIMARI.8.4e)', async () => {
      const security = await owner.$queryRaw<Array<{ relname: string; enabled: boolean }>>`
        SELECT relname, relrowsecurity AS enabled FROM pg_class
        WHERE relname IN ('member_token_keys', 'member_token_revocations',
                          'member_recognition_settings', 'customer_identity_links')
      `;
      expect(security.map((row) => row.relname).sort()).toEqual(Object.keys(TABLES).sort());
      for (const row of security) expect(row.enabled, row.relname).toBe(true);

      const policies = await owner.$queryRaw<
        Array<{ tablename: string; policyname: string; qual: string; withCheck: string | null }>
      >`
        SELECT tablename, policyname, qual, with_check AS "withCheck" FROM pg_policies
        WHERE tablename IN ('member_token_keys', 'member_token_revocations',
                            'member_recognition_settings', 'customer_identity_links')
      `;
      expect(policies).toHaveLength(4);
      for (const policy of policies) {
        const scope = TABLES[policy.tablename as keyof typeof TABLES];
        expect(policy.policyname).toBe(`${policy.tablename}_tenant`);
        // `qual` hides another tenant's rows on read; `with_check` refuses
        // planting one. They fail independently, so both are asserted.
        expect(policy.qual, policy.tablename).toContain(scope);
        expect(policy.withCheck, policy.tablename).toContain(scope);
      }
    });

    it("never shows another licence's signing key, and refuses writing one for it (NFR-S4)", async () => {
      await owner.memberTokenKey.create({
        data: { licenseId: fx.a.licenseId, keyVersion: 1, keyCiphertext: SEALED },
      });
      await owner.memberTokenKey.create({
        data: { licenseId: fx.b.licenseId, keyVersion: 3, keyCiphertext: SEALED },
      });

      const seen = await asTenant(fx.a, (tx) => tx.memberTokenKey.findMany());
      expect(seen.map((key) => key.licenseId)).toEqual([fx.a.licenseId]);

      const touched = await asTenant(fx.a, (tx) =>
        tx.memberTokenKey.updateMany({
          where: { licenseId: fx.b.licenseId },
          data: { keyCiphertext: SEALED, keyVersion: 4 },
        }),
      );
      expect(touched.count).toBe(0);
      const theirs = await owner.memberTokenKey.findUniqueOrThrow({
        where: { licenseId: fx.b.licenseId },
      });
      expect(theirs.keyVersion).toBe(3);

      await owner.memberTokenKey.delete({ where: { licenseId: fx.b.licenseId } });
      await expect(
        asTenant(fx.a, (tx) =>
          tx.memberTokenKey.create({
            data: { licenseId: fx.b.licenseId, keyVersion: 1, keyCiphertext: SEALED },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("never shows another licence's settings or revocations (NFR-S4)", async () => {
      for (const tenant of [fx.a, fx.b]) {
        await owner.memberRecognitionSettings.create({ data: { licenseId: tenant.licenseId } });
        await owner.memberTokenRevocation.create({
          data: { licenseId: tenant.licenseId, customerId: tenant.customerId },
        });
        await owner.memberTokenRevocation.create({ data: { licenseId: tenant.licenseId } });
      }

      const { settings, revocations } = await asTenant(fx.a, async (tx) => ({
        settings: await tx.memberRecognitionSettings.findMany(),
        revocations: await tx.memberTokenRevocation.findMany(),
      }));
      expect(settings.map((row) => row.licenseId)).toEqual([fx.a.licenseId]);
      expect(revocations).toHaveLength(2);
      expect(new Set(revocations.map((row) => row.licenseId))).toEqual(new Set([fx.a.licenseId]));

      await expect(
        asTenant(fx.a, (tx) =>
          tx.memberTokenRevocation.create({ data: { licenseId: fx.b.licenseId } }),
        ),
      ).rejects.toThrow(/row-level security/i);
      const changed = await asTenant(fx.a, (tx) =>
        tx.memberRecognitionSettings.updateMany({
          where: { licenseId: fx.b.licenseId },
          data: { possibleMatchesEnabled: false },
        }),
      );
      expect(changed.count).toBe(0);
    });

    it("refuses a revocation naming another organization's customer, even under the caller's own licence (NFR-S4)", async () => {
      await expect(
        asTenant(fx.a, (tx) =>
          tx.memberTokenRevocation.create({
            data: { licenseId: fx.a.licenseId, customerId: fx.b.customerId },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);

      // The same write naming one of its own customers goes through.
      const own = await asTenant(fx.a, (tx) =>
        tx.memberTokenRevocation.create({
          data: { licenseId: fx.a.licenseId, customerId: fx.a.customerId },
        }),
      );
      expect(own.customerId).toBe(fx.a.customerId);
    });

    it('refuses linking a customer to one of another organization, or filing a link under another organization (NFR-S4)', async () => {
      const crossTenant = canonical(fx.a.customerId, fx.b.customerId);
      await expect(
        asTenant(fx.a, (tx) =>
          tx.customerIdentityLink.create({
            data: {
              organizationId: fx.a.organizationId,
              ...crossTenant,
              linkedBy: fx.a.ownerAccountId,
            },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);

      const ownPair = canonical(fx.a.customerId, aSecondCustomerId);
      await expect(
        asTenant(fx.a, (tx) =>
          tx.customerIdentityLink.create({
            data: {
              organizationId: fx.b.organizationId,
              ...ownPair,
              linkedBy: fx.a.ownerAccountId,
            },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);

      const link = await asTenant(fx.a, (tx) =>
        tx.customerIdentityLink.create({
          data: { organizationId: fx.a.organizationId, ...ownPair, linkedBy: fx.a.ownerAccountId },
        }),
      );
      expect(link.organizationId).toBe(fx.a.organizationId);

      // Tenant B sees none of it, and cannot unlink it either.
      const fromB = await asTenant(fx.b, (tx) => tx.customerIdentityLink.findMany());
      expect(fromB).toEqual([]);
      const unlinked = await asTenant(fx.b, (tx) =>
        tx.customerIdentityLink.updateMany({
          where: { id: link.id },
          data: { unlinkedAt: new Date(), unlinkedBy: fx.b.ownerAccountId },
        }),
      );
      expect(unlinked.count).toBe(0);
    });
  });

  // =========================================================================
  // What the application role may not do
  // =========================================================================

  describe('the application role', () => {
    it('cannot take a revocation back — no UPDATE, no DELETE', async () => {
      const revocation = await asTenant(fx.a, (tx) =>
        tx.memberTokenRevocation.create({
          data: { licenseId: fx.a.licenseId, customerId: fx.a.customerId },
        }),
      );

      await expect(
        asTenant(fx.a, (tx) =>
          tx.memberTokenRevocation.update({
            where: { id: revocation.id },
            data: { revokedAt: new Date(0) },
          }),
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        asTenant(fx.a, (tx) => tx.memberTokenRevocation.delete({ where: { id: revocation.id } })),
      ).rejects.toThrow(/permission denied/i);
      expect(await owner.memberTokenRevocation.count()).toBe(1);
    });

    it('cannot delete a key, the settings or a link — they leave only with their licence or customer', async () => {
      await owner.memberTokenKey.create({
        data: { licenseId: fx.a.licenseId, keyVersion: 1, keyCiphertext: SEALED },
      });
      await owner.memberRecognitionSettings.create({ data: { licenseId: fx.a.licenseId } });
      const link = await owner.customerIdentityLink.create({
        data: {
          organizationId: fx.a.organizationId,
          ...canonical(fx.a.customerId, aSecondCustomerId),
          linkedBy: fx.a.ownerAccountId,
        },
      });

      await expect(asTenant(fx.a, (tx) => tx.memberTokenKey.deleteMany({}))).rejects.toThrow(
        /permission denied/i,
      );
      await expect(
        asTenant(fx.a, (tx) => tx.memberRecognitionSettings.deleteMany({})),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        asTenant(fx.a, (tx) => tx.customerIdentityLink.delete({ where: { id: link.id } })),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  // =========================================================================
  // Signing keys
  // =========================================================================

  describe('member_token_keys', () => {
    it('refuses a key stored in the clear — only a sealed ciphertext fits either slot', async () => {
      await expect(
        owner.memberTokenKey.create({
          data: { licenseId: fx.a.licenseId, keyVersion: 1, keyCiphertext: RAW_KEY },
        }),
      ).rejects.toThrow(/member_token_keys_sealed_check/);
      await expect(
        owner.memberTokenKey.create({
          data: {
            licenseId: fx.a.licenseId,
            keyVersion: 2,
            keyCiphertext: SEALED,
            previousKeyVersion: 1,
            previousKeyCiphertext: RAW_KEY,
            previousKeyValidUntil: new Date(Date.now() + 60_000),
          },
        }),
      ).rejects.toThrow(/member_token_keys_sealed_check/);
    });

    it('keeps the replaced key as a version, a ciphertext and a deadline — all three or none', async () => {
      const deadline = new Date(Date.now() + 7 * 86_400_000);
      const partial = [
        { previousKeyVersion: 1 },
        { previousKeyCiphertext: SEALED },
        { previousKeyValidUntil: deadline },
        { previousKeyVersion: 1, previousKeyCiphertext: SEALED },
        { previousKeyCiphertext: SEALED, previousKeyValidUntil: deadline },
      ];
      for (const previous of partial) {
        await expect(
          owner.memberTokenKey.create({
            data: { licenseId: fx.a.licenseId, keyVersion: 2, keyCiphertext: SEALED, ...previous },
          }),
          JSON.stringify(Object.keys(previous)),
        ).rejects.toThrow(/member_token_keys_previous_check/);
      }

      const rotated = await owner.memberTokenKey.create({
        data: {
          licenseId: fx.a.licenseId,
          keyVersion: 2,
          keyCiphertext: SEALED,
          previousKeyVersion: 1,
          previousKeyCiphertext: SEALED,
          previousKeyValidUntil: deadline,
        },
      });
      expect(rotated.previousKeyVersion).toBe(1);
    });

    it('numbers keys from 1 and refuses a previous key that is not older than the current one', async () => {
      await expect(
        owner.memberTokenKey.create({
          data: { licenseId: fx.a.licenseId, keyVersion: 0, keyCiphertext: SEALED },
        }),
      ).rejects.toThrow(/member_token_keys_version_check/);
      await expect(
        owner.memberTokenKey.create({
          data: {
            licenseId: fx.a.licenseId,
            keyVersion: 2,
            keyCiphertext: SEALED,
            previousKeyVersion: 2,
            previousKeyCiphertext: SEALED,
            previousKeyValidUntil: new Date(),
          },
        }),
      ).rejects.toThrow(/member_token_keys_previous_older_check/);
    });
  });

  // =========================================================================
  // Settings — one set of numbers
  // =========================================================================

  describe('member_recognition_settings', () => {
    it('defaults to the lifetime MEMBER_TOKEN_TTL names, with possible matches shown', async () => {
      const row = await owner.memberRecognitionSettings.create({
        data: { licenseId: fx.a.licenseId },
      });
      expect(row.tokenTtlSeconds).toBe(MEMBER_TOKEN_TTL.defaultSeconds);
      expect(row.possibleMatchesEnabled).toBe(true);

      // The database's own default, not only Prisma's copy of it.
      const [column] = await owner.$queryRaw<Array<{ value: string }>>`
        SELECT column_default AS value FROM information_schema.columns
        WHERE table_name = 'member_recognition_settings' AND column_name = 'token_ttl_seconds'
      `;
      expect(Number(column?.value)).toBe(MEMBER_TOKEN_TTL.defaultSeconds);
    });

    it('holds the lifetime between a day and a year — the bounds MEMBER_TOKEN_TTL and the contract state', async () => {
      const { minSeconds, maxSeconds } = MEMBER_TOKEN_TTL;
      for (const tooFar of [minSeconds - 1, 0, maxSeconds + 1]) {
        await expect(
          owner.memberRecognitionSettings.create({
            data: { licenseId: fx.a.licenseId, tokenTtlSeconds: tooFar },
          }),
          String(tooFar),
        ).rejects.toThrow(/member_recognition_settings_ttl_check/);
      }
      for (const edge of [minSeconds, maxSeconds]) {
        await owner.memberRecognitionSettings.upsert({
          where: { licenseId: fx.a.licenseId },
          create: { licenseId: fx.a.licenseId, tokenTtlSeconds: edge },
          update: { tokenTtlSeconds: edge },
        });
      }

      const schemas = contractSchemas();
      for (const name of ['MemberRecognitionSettings', 'MemberRecognitionSettingsInput']) {
        const ttl = schemas[name]?.properties?.['token_ttl_seconds'];
        expect({ min: ttl?.minimum, max: ttl?.maximum }, name).toEqual({
          min: minSeconds,
          max: maxSeconds,
        });
      }
      const grace = schemas['MemberKeyRotationInput']?.properties?.['grace_period_seconds'];
      expect({ min: grace?.minimum, max: grace?.maximum, default: grace?.default }).toEqual({
        min: MEMBER_KEY_ROTATION_GRACE.minSeconds,
        max: MEMBER_KEY_ROTATION_GRACE.maxSeconds,
        default: MEMBER_KEY_ROTATION_GRACE.defaultSeconds,
      });
    });
  });

  // =========================================================================
  // Identity links
  // =========================================================================

  describe('customer_identity_links', () => {
    const link = (pair: { customerAId: string; customerBId: string }) =>
      owner.customerIdentityLink.create({
        data: { organizationId: fx.a.organizationId, ...pair, linkedBy: fx.a.ownerAccountId },
      });

    it('stores a pair once, in canonical order — the reverse order and a link to oneself are refused', async () => {
      const pair = canonical(fx.a.customerId, aSecondCustomerId);
      await link(pair);

      await expect(
        link({ customerAId: pair.customerBId, customerBId: pair.customerAId }),
      ).rejects.toThrow(/customer_identity_links_order_check/);
      await expect(
        link({ customerAId: pair.customerAId, customerBId: pair.customerAId }),
      ).rejects.toThrow(/customer_identity_links_order_check/);
      await expect(link(pair)).rejects.toThrow(/Unique constraint|customer_a_id_customer_b_id_key/);
    });

    it('records an unlink with who and when, or neither — and a relink clears both', async () => {
      const row = await link(canonical(fx.a.customerId, aSecondCustomerId));

      await expect(
        owner.customerIdentityLink.update({
          where: { id: row.id },
          data: { unlinkedAt: new Date() },
        }),
      ).rejects.toThrow(/customer_identity_links_unlinked_check/);
      await expect(
        owner.customerIdentityLink.update({
          where: { id: row.id },
          data: { unlinkedBy: fx.a.ownerAccountId },
        }),
      ).rejects.toThrow(/customer_identity_links_unlinked_check/);

      await asTenant(fx.a, (tx) =>
        tx.customerIdentityLink.update({
          where: { id: row.id },
          data: { unlinkedAt: new Date(), unlinkedBy: fx.a.ownerAccountId },
        }),
      );
      const relinked = await asTenant(fx.a, (tx) =>
        tx.customerIdentityLink.update({
          where: { id: row.id },
          data: { unlinkedAt: null, unlinkedBy: null, linkedBy: fx.a.agentAccountId },
        }),
      );
      expect(relinked).toMatchObject({ unlinkedAt: null, unlinkedBy: null });
    });

    it('leaves with either customer — erasing one takes its links and revocations with it', async () => {
      await link(canonical(fx.a.customerId, aSecondCustomerId));
      await owner.memberTokenRevocation.create({
        data: { licenseId: fx.a.licenseId, customerId: aSecondCustomerId },
      });
      await owner.memberTokenRevocation.create({ data: { licenseId: fx.a.licenseId } });

      await owner.customer.delete({ where: { id: aSecondCustomerId } });

      expect(await owner.customerIdentityLink.count()).toBe(0);
      // The licence-wide revocation names no customer and stays.
      const left = await owner.memberTokenRevocation.findMany();
      expect(left.map((row) => row.customerId)).toEqual([null]);
    });
  });

  // =========================================================================
  // The contract names what the database and the types name
  // =========================================================================

  describe('contract', () => {
    it('carries the member token on POST /customer/token in the cookie @siyahtus/types names, optional both ways', () => {
      type Content = Record<string, { schema: SchemaNode }>;
      type Headers = Record<string, { description?: string }>;
      const path = loadOpenApiDocument().paths['/customer/token'] as {
        post: {
          description: string;
          parameters?: Array<{ name: string; in: string; required?: boolean }>;
          requestBody: { content: Content };
          responses: Record<string, { headers?: Headers; content: Content }>;
        };
        delete: { responses: Record<string, { headers?: Headers }> };
      };
      const operation = path.post;

      // One cookie per organization (tm 287.3) — a name OpenAPI cannot declare
      // as a parameter, so the description and both `Set-Cookie` headers name
      // it, and no fixed-name cookie parameter claims otherwise.
      const perOrganization = `${MEMBER_TOKEN_COOKIE}_<organization_id>`;
      expect(memberTokenCookieName('7f8b4a62-5c1e-4b9e-9a77-0d1e2f3a4b5c')).toBe(
        `${MEMBER_TOKEN_COOKIE}_7f8b4a62-5c1e-4b9e-9a77-0d1e2f3a4b5c`,
      );
      expect(operation.description).toContain(perOrganization);
      expect(operation.responses['200']?.headers?.['Set-Cookie']?.description).toContain(
        `${perOrganization}=<member token>`,
      );
      expect(path.delete.responses['204']?.headers?.['Set-Cookie']?.description).toContain(
        `${perOrganization}=; Max-Age=0`,
      );
      expect((operation.parameters ?? []).filter((p) => p.in === 'cookie')).toEqual([]);

      const body = operation.requestBody.content['application/json']?.schema;
      expect(Object.keys(body?.properties ?? {})).toContain('member_token');
      expect(body?.required).not.toContain('member_token');

      const ok = operation.responses['200'];
      expect(Object.keys(ok?.headers ?? {})).toContain('Set-Cookie');
      const response = ok?.content['application/json']?.schema;
      expect(Object.keys(response?.properties ?? {})).toEqual(
        expect.arrayContaining(['member_token', 'member_token_expires_at']),
      );
      // Optional: a deployment from before member tokens omits them, and a
      // request that arrived with the cookie gets no `member_token` back.
      expect(response?.required).not.toContain('member_token');
      expect(response?.required).not.toContain('member_token_expires_at');
    });

    it('lists the possible-match fields and their limit exactly as @siyahtus/types does', () => {
      const schemas = contractSchemas();
      expect(schemas['PossibleMatchField']?.enum).toEqual([...POSSIBLE_MATCH_FIELDS]);
      expect(schemas['PossibleMatchList']?.properties?.['items']?.maxItems).toBe(
        POSSIBLE_MATCH_LIMIT,
      );
    });
  });
});
