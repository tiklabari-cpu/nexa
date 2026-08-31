/**
 * How the campaigns list heals a stale `campaigns.status` (tm 176.6).
 *
 * The *result* of the heal is pinned by the integration suite, which reads the
 * column back through a real database. What cannot be seen from there is the
 * shape of the statement — whether the update is a compare-and-set, and whether
 * a page of drifted rows costs one statement or fifty — and that is precisely
 * what makes it safe to run on a read path. So: a fake client that records what
 * the service asked the database to do, the same technique
 * `channel-service.test.ts` uses to see a write that never happens.
 */
import { describe, expect, it } from 'vitest';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { CampaignService } from './campaign-service.js';

const LICENSE = 42n;
const TENANT: TenantContext = {
  licenseId: LICENSE,
  organizationId: '11111111-1111-4111-8111-111111111111',
};

const NOW = new Date('2026-07-26T12:00:00.000Z');
const HOUR_BEFORE = new Date('2026-07-26T11:00:00.000Z');
const HOUR_AFTER = new Date('2026-07-26T13:00:00.000Z');

interface StoredCampaign {
  id: string;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
}

interface UpdateManyArgs {
  where: { licenseId: bigint; id: { in: string[] }; status: string };
  data: { status: string };
}

/** A client that serves `rows` and records every `updateMany` the service issues. */
function clientHolding(rows: StoredCampaign[]): {
  tx: TenantClient;
  updates: UpdateManyArgs[];
} {
  const updates: UpdateManyArgs[] = [];
  const tx = {
    campaign: {
      findMany: async () =>
        rows.map((row) => ({
          ...row,
          name: `campaign-${row.id}`,
          conditions: { url_contains: '/x' },
          content: { message: 'hi' },
          recurring: false,
          createdAt: HOUR_BEFORE,
          sends: [],
        })),
      updateMany: async (args: UpdateManyArgs) => {
        updates.push(args);
        return { count: args.where.id.in.length };
      },
    },
  } as unknown as TenantClient;
  return { tx, updates };
}

const list = (tx: TenantClient) => new CampaignService().list(tx, TENANT, { status: 'all' }, NOW);

describe('CampaignService.list — healing a stale status', () => {
  it('compares against the status it read, so a concurrent toggle wins the race', async () => {
    // The `where` carries the stale value. An owner who switches the campaign
    // off between this read and this write moves the row off that value, so the
    // housekeeping update matches nothing instead of resurrecting their
    // campaign — and a second reader healing the same row is a no-op for the
    // same reason.
    const { tx, updates } = clientHolding([
      { id: 'a', status: 'scheduled', startsAt: HOUR_BEFORE, endsAt: null },
    ]);

    await list(tx);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.where).toEqual({
      licenseId: LICENSE,
      id: { in: ['a'] },
      status: 'scheduled',
    });
    expect(updates[0]?.data).toEqual({ status: 'ongoing' });
  });

  it('writes nothing at all when every stored status is already true', async () => {
    // The steady state, and the reason a write on a read path is affordable:
    // the first read that notices a transition fixes it and every read after
    // that is a pure read again.
    const { tx, updates } = clientHolding([
      { id: 'a', status: 'ongoing', startsAt: HOUR_BEFORE, endsAt: null },
      { id: 'b', status: 'scheduled', startsAt: HOUR_AFTER, endsAt: null },
      { id: 'c', status: 'inactive', startsAt: null, endsAt: null },
    ]);

    await list(tx);
    expect(updates).toEqual([]);
  });

  it('spends one statement per transition rather than one per row', async () => {
    const { tx, updates } = clientHolding([
      { id: 'c', status: 'scheduled', startsAt: HOUR_BEFORE, endsAt: null },
      { id: 'b', status: 'ongoing', startsAt: HOUR_BEFORE, endsAt: HOUR_BEFORE },
      { id: 'a', status: 'scheduled', startsAt: HOUR_BEFORE, endsAt: null },
      { id: 'd', status: 'ongoing', startsAt: null, endsAt: null },
    ]);

    await list(tx);
    expect(updates).toHaveLength(2);
    expect(updates.map((update) => [update.where.status, update.data.status])).toEqual([
      ['scheduled', 'ongoing'],
      ['ongoing', 'inactive'],
    ]);
    // Sorted, so two of these statements always take their row locks in the
    // same order.
    expect(updates[0]?.where.id.in).toEqual(['a', 'c']);
  });
});
