/**
 * Agent work schedules (PRD §5.3-Vardiya, WORKSCHED-c).
 *
 * The acceptance criterion is one sentence with three claims in it: an agent
 * may read and write *their own* rostered week; only the administrative scope
 * (`agents--all`) may touch *someone else's*; and an invalid week is refused.
 *
 * The middle claim is the one worth testing hardest, because it is the one the
 * framework does not enforce on its own. `agents--my:rw` satisfies the route's
 * scope list whichever agent id sits in the path — the self-vs-admin line is
 * drawn in the handler, so it is exactly the kind of guard that can be deleted
 * in a refactor without a single type error. The negative cases therefore come
 * first here, and the round-trip that proves the feature works at all comes
 * after them.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_WORK_SCHEDULE, WORK_SCHEDULE_DAYS } from '@nexa/types';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/** A complete, valid week that is visibly not the default. */
const LATE_SHIFT = {
  timezone: 'Europe/Istanbul',
  schedule: WORK_SCHEDULE_DAYS.map((day) => ({
    day,
    start: '12:00',
    end: '20:30',
    enabled: day !== 'sunday',
  })),
};

describe('agent work schedule (PRD §5.3-Vardiya)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  /** Owner-owned token with the tenant-wide agent scopes: the admin caller. */
  let adminToken: string;
  /** Owned by tenant A's ordinary agent, `agents--my` only: the self caller. */
  let selfToken: string;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents--all:rw', 'agents--all:ro'],
    });

    selfToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['agents--my:rw'],
    });
  });

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const getSchedule = (agentId: string, token: string) =>
    server.get(`/agents/${agentId}/work-schedule`, bearer(token));
  const putSchedule = (agentId: string, body: unknown, token: string) =>
    server.put(`/agents/${agentId}/work-schedule`, body, bearer(token));

  // ==========================================================================
  // Authorization — the self-vs-admin line (NFR-S3)
  // ==========================================================================

  describe('authorization', () => {
    it('refuses an `agents--my` token writing another agent’s schedule', async () => {
      // The whole point of the guard: this token passes the route's scope list
      // (`agents--my:rw` is on it), so nothing but the handler stops it from
      // rewriting the owner's rostered hours.
      const res = await putSchedule(fx.a.ownerAccountId, LATE_SHIFT, selfToken);

      expect(res.statusCode).toBe(403);
      expect(res.json().error.type).toBe('authorization');

      // …and the refusal is real, not cosmetic: nothing was written.
      const stored = await owner.workSchedule.findMany({ where: { licenseId: fx.a.licenseId } });
      expect(stored).toEqual([]);
    });

    it('refuses an `agents--my` token reading another agent’s schedule', async () => {
      const readOnlySelf = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['agents--my:ro'],
      });

      const res = await getSchedule(fx.a.ownerAccountId, readOnlySelf);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.type).toBe('authorization');
    });

    it('refuses a token carrying no agent scope at all', async () => {
      const unrelated = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['chats--access:rw'],
      });

      // Refused by the route's scope list, before the handler runs — on their
      // own schedule as much as on anyone else's.
      expect((await getSchedule(fx.a.agentAccountId, unrelated)).statusCode).toBe(403);
      expect((await putSchedule(fx.a.agentAccountId, LATE_SHIFT, unrelated)).statusCode).toBe(403);
    });

    it('refuses a read-only administrative token attempting a write', async () => {
      const readOnlyAdmin = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['agents--all:ro'],
      });

      expect((await getSchedule(fx.a.agentAccountId, readOnlyAdmin)).statusCode).toBe(200);
      expect((await putSchedule(fx.a.agentAccountId, LATE_SHIFT, readOnlyAdmin)).statusCode).toBe(
        403,
      );
    });

    it('keeps a customer token off the agent surface entirely', async () => {
      // I4: a customer credential reaching an agent route is a boundary
      // violation, not a permission shortfall, so the auth plugin answers 404
      // rather than 403 — the widget-facing surface must not be usable to map
      // the agent API. Asserted as 404 (not the 403 the task sketch named)
      // because that is the stricter, house-wide answer.
      const minted = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        { origin: `https://${fx.a.trustedDomain}` },
      );
      const token = minted.json().token as string;
      expect(token).toBeTruthy();

      expect((await getSchedule(fx.a.agentAccountId, token)).statusCode).toBe(404);
      expect((await putSchedule(fx.a.agentAccountId, LATE_SHIFT, token)).statusCode).toBe(404);
    });

    it('rejects an unauthenticated caller', async () => {
      const res = await server.get(`/agents/${fx.a.agentAccountId}/work-schedule`);
      expect(res.statusCode).toBe(401);
    });
  });

  // ==========================================================================
  // Tenant isolation (NFR-S4/S5)
  // ==========================================================================

  describe('tenant isolation', () => {
    it('does not reveal another licence’s agent, even to an administrative token', async () => {
      const bAdmin = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['agents--all:rw', 'agents--all:ro'],
      });

      // The scope gate passes — this token *is* an administrator, just of the
      // wrong workspace. RLS turns the lookup into a miss, and the miss is a
      // 404 so licence A's agent ids stay un-enumerable from licence B.
      const read = await getSchedule(fx.a.agentAccountId, bAdmin);
      expect(read.statusCode).toBe(404);
      expect(read.json().error.type).toBe('not_found');

      const write = await putSchedule(fx.a.agentAccountId, LATE_SHIFT, bAdmin);
      expect(write.statusCode).toBe(404);

      // Nothing was written into either licence: not A's row under B's hand,
      // and not a stray row filed under B.
      expect(await owner.workSchedule.count()).toBe(0);
    });

    it('keeps two licences’ schedules for the same weekday independent', async () => {
      const bAdmin = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['agents--all:rw', 'agents--all:ro'],
      });

      await putSchedule(fx.a.agentAccountId, LATE_SHIFT, adminToken);
      await putSchedule(fx.b.agentAccountId, DEFAULT_WORK_SCHEDULE, bAdmin);

      expect((await getSchedule(fx.a.agentAccountId, adminToken)).json()).toEqual(LATE_SHIFT);
      expect((await getSchedule(fx.b.agentAccountId, bAdmin)).json()).toEqual(
        DEFAULT_WORK_SCHEDULE,
      );
    });

    it('404s an agent id that names nobody', async () => {
      const res = await getSchedule('00000000-0000-4000-8000-000000000000', adminToken);
      expect(res.statusCode).toBe(404);
    });

    it('400s an agent id that is not a UUID', async () => {
      const res = await getSchedule('not-a-uuid', adminToken);
      expect(res.statusCode).toBe(400);
    });
  });

  // ==========================================================================
  // Validation — `normalizeWorkSchedule` is the only gate (KK: "geçersiz plan
  // reddedilir")
  // ==========================================================================

  describe('validation', () => {
    const invalid: Array<[string, unknown]> = [
      [
        'a start at or after its end',
        { timezone: 'UTC', schedule: [{ day: 'monday', start: '18:00', end: '09:00', enabled: true }] },
      ],
      [
        'a start equal to its end',
        { timezone: 'UTC', schedule: [{ day: 'monday', start: '09:00', end: '09:00', enabled: true }] },
      ],
      [
        'an out-of-range hour',
        { timezone: 'UTC', schedule: [{ day: 'monday', start: '24:00', end: '24:30', enabled: true }] },
      ],
      [
        'an unpadded time',
        { timezone: 'UTC', schedule: [{ day: 'monday', start: '9:00', end: '18:00', enabled: true }] },
      ],
      [
        'an unknown weekday',
        { timezone: 'UTC', schedule: [{ day: 'caturday', start: '09:00', end: '18:00', enabled: true }] },
      ],
      [
        'the same weekday twice',
        {
          timezone: 'UTC',
          schedule: [
            { day: 'monday', start: '09:00', end: '12:00', enabled: true },
            { day: 'monday', start: '13:00', end: '18:00', enabled: true },
          ],
        },
      ],
    ];

    for (const [what, body] of invalid) {
      it(`refuses ${what}`, async () => {
        const res = await putSchedule(fx.a.agentAccountId, body, selfToken);
        expect(res.statusCode).toBe(400);
        expect(res.json().error.type).toBe('validation');
        // Refused, not partially stored.
        expect(await owner.workSchedule.count()).toBe(0);
      });
    }

    it('refuses a body that is an array rather than a schedule object', async () => {
      // `normalizeWorkSchedule` would read an array as "no recognisable
      // fields" and hand back the default week — silently storing something
      // the caller never asked for. The route's one shape check catches it.
      const res = await putSchedule(fx.a.agentAccountId, [LATE_SHIFT], selfToken);
      expect(res.statusCode).toBe(400);
      expect(await owner.workSchedule.count()).toBe(0);
    });
  });

  // ==========================================================================
  // The round trip (KK: "ajan kendi vardiya planını okuyup yazabilir")
  // ==========================================================================

  describe('reading and writing', () => {
    it('returns the default week for an agent who has never set one', async () => {
      const res = await getSchedule(fx.a.agentAccountId, selfToken);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(DEFAULT_WORK_SCHEDULE);
      // Reading did not materialise a row — "unset" stays unset.
      expect(await owner.workSchedule.count()).toBe(0);
    });

    it('lets an agent write and read back their own week', async () => {
      const put = await putSchedule(fx.a.agentAccountId, LATE_SHIFT, selfToken);
      expect(put.statusCode).toBe(200);
      expect(put.json()).toEqual(LATE_SHIFT);

      const get = await getSchedule(fx.a.agentAccountId, selfToken);
      expect(get.statusCode).toBe(200);
      expect(get.json()).toEqual(LATE_SHIFT);
    });

    it('lets an administrator write another agent’s week', async () => {
      const put = await putSchedule(fx.a.agentAccountId, LATE_SHIFT, adminToken);
      expect(put.statusCode).toBe(200);

      // …and the agent themselves reads back what the administrator set.
      expect((await getSchedule(fx.a.agentAccountId, selfToken)).json()).toEqual(LATE_SHIFT);
    });

    it('replaces the week wholesale rather than merging into it', async () => {
      await putSchedule(fx.a.agentAccountId, LATE_SHIFT, selfToken);

      const mondayOnly = {
        timezone: 'UTC',
        schedule: [{ day: 'monday', start: '08:00', end: '16:00', enabled: true }],
      };
      const put = await putSchedule(fx.a.agentAccountId, mondayOnly, selfToken);
      expect(put.statusCode).toBe(200);

      // The six other days are gone, not retained from the previous write.
      expect((await getSchedule(fx.a.agentAccountId, selfToken)).json()).toEqual(mondayOnly);
    });

    it('is idempotent — the same week twice leaves one row', async () => {
      await putSchedule(fx.a.agentAccountId, LATE_SHIFT, selfToken);
      await putSchedule(fx.a.agentAccountId, LATE_SHIFT, selfToken);

      const rows = await owner.workSchedule.findMany({ where: { licenseId: fx.a.licenseId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.agentId).toBe(fx.a.agentAccountId);
      expect(rows[0]?.timezone).toBe(LATE_SHIFT.timezone);
    });

    it('normalises an empty schedule to the default week', async () => {
      // `normalizeWorkSchedule` treats "no slots" as "not configured", so this
      // is a reset rather than a rejection — the endpoint inherits that rule
      // instead of inventing a second one.
      const put = await putSchedule(fx.a.agentAccountId, { timezone: 'UTC', schedule: [] }, selfToken);

      expect(put.statusCode).toBe(200);
      expect(put.json()).toEqual({ timezone: 'UTC', schedule: DEFAULT_WORK_SCHEDULE.schedule });
    });
  });

  // ==========================================================================
  // Audit trail (NFR-S12)
  // ==========================================================================

  describe('audit trail', () => {
    it('records who rewrote whose hours, without the hours themselves', async () => {
      await putSchedule(fx.a.agentAccountId, LATE_SHIFT, adminToken);

      const entries = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'work_schedule.updated' },
      });

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: fx.a.ownerAccountId,
        actorType: 'agent',
        target: `account:${fx.a.agentAccountId}`,
      });
      expect(entries[0]?.metadata).toMatchObject({
        timezone: 'Europe/Istanbul',
        enabled_days: 6,
      });
      // The shape of the week, never its times.
      expect(JSON.stringify(entries[0]?.metadata)).not.toContain('12:00');
    });

    it('writes nothing when the write was refused', async () => {
      const forbidden = await putSchedule(fx.a.ownerAccountId, LATE_SHIFT, selfToken);
      expect(forbidden.statusCode).toBe(403);

      const invalid = await putSchedule(
        fx.a.agentAccountId,
        { timezone: 'UTC', schedule: [{ day: 'monday', start: '20:00', end: '08:00', enabled: true }] },
        selfToken,
      );
      expect(invalid.statusCode).toBe(400);

      const entries = await owner.auditLogEntry.findMany({
        where: { action: 'work_schedule.updated' },
      });
      expect(entries).toEqual([]);
    });
  });
});
