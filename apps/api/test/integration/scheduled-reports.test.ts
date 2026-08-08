/**
 * Scheduled report exports — the definition surface (PRD §5.3-Reports).
 *
 * FR-MOD-07.7's KK is "permission-based visibility; export; benchmark
 * comparison"; the share that falls to this slice is the first two, and the
 * derived criteria that go with them:
 *
 *   - defining a scheduled export is an owner/admin power — a token without
 *     `reports_manage` is refused, and `reports_read` does not imply it, so the
 *     read scope every agent-facing report uses cannot mail data out;
 *   - a definition cannot be created pointing at an unknown report group, an
 *     undefined frequency, an empty recipient list, or an address outside the
 *     workspace. That last one is the PII boundary: without it, "define a
 *     schedule" is a way to have the workspace's numbers mailed anywhere on a
 *     timer.
 *
 *   - a schedule can be cancelled, and a cancelled one never runs again nor
 *     leaves its delivery history behind;
 *   - an edit passes the same gate a create does. This is not symmetry for its
 *     own sake: anyone who can define a schedule can immediately edit it, so a
 *     PATCH that skipped the roster check would reopen the leak the create-time
 *     check closes, and the validation would only ever hold on the surface
 *     nobody has to use twice.
 *
 * And underneath all of them, the failure most easily shipped unseen: one tenant
 * reaching another's schedules — which would expose not just that a schedule
 * exists but the mailboxes it delivers to. Every miss is a 404, never a 403,
 * for the same reason.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@nexa/types';
import { FileMailer, type Mailer } from '../../src/services/mail/mailer.js';
import { ScheduledReportSweeper } from '../../src/services/reports/scheduled-report-sweeper.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface ScheduledExport {
  id: string;
  group: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  format: 'csv';
  recipients: string[];
  enabled: boolean;
  created_at: string;
  last_run_at: string | null;
}

interface ScheduledExportRun {
  id: string;
  period_key: string;
  period_from: string;
  period_to: string;
  status: 'pending' | 'delivered' | 'failed';
  row_count: number;
  recipient_count: number;
  error: string | null;
  created_at: string;
}

/** Fails every send — the provider outage the failed-run history is about. */
class BrokenMailer implements Mailer {
  async send(): Promise<void> {
    throw new Error('smtp: connection refused');
  }
}

const PATH = '/reports/scheduled-exports';

describe('scheduled report exports', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let manageToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const create = (token: string, body: unknown) => server.post(PATH, body, auth(token));

  const list = async (token: string): Promise<ScheduledExport[]> => {
    const response = await server.get(PATH, auth(token));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: ScheduledExport[] }).items;
  };

  /** A valid definition for tenant A, with one field swapped out per test. */
  const validBody = (overrides: Record<string, unknown> = {}) => ({
    group: 'leads',
    frequency: 'weekly',
    recipients: [fx.a.ownerEmail],
    ...overrides,
  });

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
    manageToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['reports_manage'],
    });
  });

  // --- Permission-based visibility (FR-MOD-07.7 KK) --------------------------

  it('refuses to create a schedule for a token without reports_manage', async () => {
    const readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['reports_read'],
    });

    const response = await create(readToken, validBody());
    expect(response.statusCode).toBe(403);
  });

  it('does not let reports_read list the schedules either', async () => {
    // The list carries recipient mailboxes — who receives the workspace's
    // numbers is management information, not part of reading a report.
    const readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['reports_read'],
    });

    expect((await server.get(PATH, auth(readToken))).statusCode).toBe(403);
  });

  it('refuses a token carrying no reports scope at all', async () => {
    const strangerToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw'],
    });

    expect((await server.get(PATH, auth(strangerToken))).statusCode).toBe(403);
    expect((await create(strangerToken, validBody())).statusCode).toBe(403);
  });

  it('rejects an unauthenticated caller', async () => {
    expect((await server.get(PATH)).statusCode).toBe(401);
  });

  // --- Export: create → list round trip --------------------------------------

  it('creates a schedule and lists it back', async () => {
    const created = await create(
      manageToken,
      validBody({ group: 'overview', frequency: 'daily', recipients: [fx.a.agentEmail] }),
    );
    expect(created.statusCode).toBe(201);

    const body = created.json() as ScheduledExport;
    expect(body.group).toBe('overview');
    expect(body.frequency).toBe('daily');
    // Defaulted, not echoed: the caller passed neither.
    expect(body.format).toBe('csv');
    expect(body.enabled).toBe(true);
    expect(body.recipients).toEqual([fx.a.agentEmail]);
    expect(body.last_run_at).toBeNull();

    const items = await list(manageToken);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(body.id);
  });

  it('can create a definition switched off', async () => {
    const created = await create(manageToken, validBody({ enabled: false }));
    expect(created.statusCode).toBe(201);
    expect((created.json() as ScheduledExport).enabled).toBe(false);
  });

  it('accepts every group in the report catalogue', async () => {
    // The catalogue grew twice during 07.7; a schedule must be definable for
    // whatever it holds today, not a hard-coded subset of it. Read the catalogue
    // with a token that also holds `reports_read` — `/reports/groups` answers
    // "what may you *read*", which `reports_manage` says nothing about; an
    // owner/admin carries both.
    const adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['reports_read', 'reports_manage'],
    });
    const groups = (await server.get('/reports/groups', auth(adminToken))).json() as {
      groups: Array<{ id: string }>;
    };
    expect(groups.groups.length).toBeGreaterThan(0);

    for (const group of groups.groups) {
      const response = await create(manageToken, validBody({ group: group.id }));
      expect(response.statusCode, group.id).toBe(201);
    }
    expect(await list(manageToken)).toHaveLength(groups.groups.length);
  });

  it('matches a recipient case-insensitively and stores the roster spelling', async () => {
    // Accounts store e-mail as citext, so the delivery step must never have to
    // guess which of two casings is the real mailbox.
    const created = await create(
      manageToken,
      validBody({ recipients: [fx.a.ownerEmail.toUpperCase()] }),
    );
    expect(created.statusCode).toBe(201);
    expect((created.json() as ScheduledExport).recipients).toEqual([fx.a.ownerEmail]);
  });

  it('collapses a duplicated recipient so nobody is mailed twice', async () => {
    const created = await create(
      manageToken,
      validBody({ recipients: [fx.a.ownerEmail, fx.a.ownerEmail.toUpperCase()] }),
    );
    expect(created.statusCode).toBe(201);
    expect((created.json() as ScheduledExport).recipients).toEqual([fx.a.ownerEmail]);
  });

  // --- Validation (derived KK: a definition cannot point at nothing) ---------

  it('rejects an unknown report group', async () => {
    const response = await create(manageToken, validBody({ group: 'not-a-report' }));
    expect(response.statusCode).toBe(400);
    expect(await list(manageToken)).toHaveLength(0);
  });

  it('rejects an undefined frequency', async () => {
    const response = await create(manageToken, validBody({ frequency: 'hourly' }));
    expect(response.statusCode).toBe(400);
  });

  it('rejects an empty recipient list', async () => {
    // A definition with no recipients would still claim its delivery period and
    // then mail nobody, silently, forever.
    const response = await create(manageToken, validBody({ recipients: [] }));
    expect(response.statusCode).toBe(400);
  });

  it('rejects a recipient outside the workspace', async () => {
    // The PII boundary: report data may only be mailed to this licence's team.
    const response = await create(
      manageToken,
      validBody({ recipients: ['attacker@example.invalid'] }),
    );
    expect(response.statusCode).toBe(400);
    expect(await list(manageToken)).toHaveLength(0);
  });

  it("rejects another tenant's agent as a recipient", async () => {
    // A real, existing mailbox — just not one on this licence. RLS narrows the
    // roster lookup, so it is refused exactly as an invented address is, and the
    // endpoint never becomes an oracle for who works where.
    const response = await create(manageToken, validBody({ recipients: [fx.b.ownerEmail] }));
    expect(response.statusCode).toBe(400);
  });

  it('rejects a suspended agent as a recipient', async () => {
    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
      data: { suspended: true },
    });

    const response = await create(manageToken, validBody({ recipients: [fx.a.agentEmail] }));
    expect(response.statusCode).toBe(400);
  });

  it('rejects a malformed address before it ever reaches the roster', async () => {
    const response = await create(manageToken, validBody({ recipients: ['not-an-email'] }));
    expect(response.statusCode).toBe(400);
  });

  it('rejects an unknown body key rather than silently ignoring it', async () => {
    const response = await create(manageToken, validBody({ frequancy: 'weekly' }));
    expect(response.statusCode).toBe(400);
  });

  it('rejects a format the scheduler does not produce', async () => {
    const response = await create(manageToken, validBody({ format: 'pdf' }));
    expect(response.statusCode).toBe(400);
  });

  // --- Cross-tenant isolation ------------------------------------------------

  it("never shows one licence another's schedules", async () => {
    expect((await create(manageToken, validBody())).statusCode).toBe(201);

    const bToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['reports_manage'],
    });

    expect(await list(bToken)).toHaveLength(0);
    // And A still sees its own — the isolation is a filter, not a wipe.
    expect(await list(manageToken)).toHaveLength(1);
  });

  it('stores a schedule against the creating licence, never the other', async () => {
    const created = await create(manageToken, validBody());
    expect(created.statusCode).toBe(201);

    const row = await owner.scheduledReport.findUniqueOrThrow({
      where: { id: (created.json() as ScheduledExport).id },
      select: { licenseId: true, createdByAgentId: true },
    });
    expect(row.licenseId).toBe(fx.a.licenseId);
    expect(row.createdByAgentId).toBe(fx.a.ownerAccountId);
  });

  // --- One definition: read, edit, cancel (07.9-sched-c) ---------------------
  //
  // The lifecycle half. Two things are load-bearing here beyond plumbing:
  //
  //   - PATCH re-validates everything create validates. A schedule can be
  //     redirected as easily as it can be defined, so an edit that skipped the
  //     roster check would reopen the exact hole create closes — the validation
  //     would only hold on the surface nobody needs twice.
  //   - a miss is 404, never 403, on every verb. 403 would mean "this exists,
  //     but not for you", which tells one workspace that another's schedule is
  //     real.
  describe('one definition', () => {
    /** A live definition belonging to tenant A. */
    const seed = async (overrides: Record<string, unknown> = {}): Promise<ScheduledExport> => {
      const response = await create(manageToken, validBody(overrides));
      expect(response.statusCode).toBe(201);
      return response.json() as ScheduledExport;
    };

    const at = (id: string) => `${PATH}/${id}`;

    const read = async (token: string, id: string): Promise<ScheduledExport> => {
      const response = await server.get(at(id), auth(token));
      expect(response.statusCode).toBe(200);
      return response.json() as ScheduledExport;
    };

    const bToken = async (): Promise<string> =>
      grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_manage'],
      });

    // --- Permission-based visibility (FR-MOD-07.7 KK) ------------------------

    it('refuses to read, edit or cancel without reports_manage', async () => {
      const schedule = await seed();
      const readToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['reports_read'],
      });

      // The by-id read is gated with the writes, not with `reports_read`: it
      // returns the same DTO the list does, recipients included, so a weaker
      // gate here would hand the read scope what the list refuses it.
      expect((await server.get(at(schedule.id), auth(readToken))).statusCode).toBe(403);
      expect(
        (await server.patch(at(schedule.id), { enabled: false }, auth(readToken))).statusCode,
      ).toBe(403);
      expect((await server.del(at(schedule.id), auth(readToken))).statusCode).toBe(403);

      // And nothing happened behind the refusal.
      expect((await read(manageToken, schedule.id)).enabled).toBe(true);
    });

    it('rejects an unauthenticated caller on every verb', async () => {
      const schedule = await seed();
      expect((await server.get(at(schedule.id))).statusCode).toBe(401);
      expect((await server.patch(at(schedule.id), { enabled: false })).statusCode).toBe(401);
      expect((await server.del(at(schedule.id))).statusCode).toBe(401);
    });

    // --- Read + edit round trip ----------------------------------------------

    it('reads back the definition the list shows', async () => {
      const schedule = await seed({ group: 'sales', frequency: 'monthly' });
      expect(await read(manageToken, schedule.id)).toEqual(schedule);
    });

    it('changes the cadence and serves the new value straight back', async () => {
      const schedule = await seed({ frequency: 'weekly' });

      const patched = await server.patch(
        at(schedule.id),
        { frequency: 'daily' },
        auth(manageToken),
      );
      expect(patched.statusCode).toBe(200);
      expect((patched.json() as ScheduledExport).frequency).toBe('daily');

      const fetched = await read(manageToken, schedule.id);
      expect(fetched.frequency).toBe('daily');
      // Untouched fields keep their value — a PATCH is not a replace.
      expect(fetched.group).toBe(schedule.group);
      expect(fetched.recipients).toEqual(schedule.recipients);
      expect(fetched.enabled).toBe(true);
    });

    it('pauses a definition without discarding it', async () => {
      const schedule = await seed();

      const patched = await server.patch(at(schedule.id), { enabled: false }, auth(manageToken));
      expect(patched.statusCode).toBe(200);
      expect((await read(manageToken, schedule.id)).enabled).toBe(false);
      // Paused, not cancelled: it is still in the list.
      expect(await list(manageToken)).toHaveLength(1);
    });

    it('replaces the recipient list, normalised the same way create normalises it', async () => {
      const schedule = await seed({ recipients: [fx.a.ownerEmail] });

      const patched = await server.patch(
        at(schedule.id),
        { recipients: [fx.a.agentEmail.toUpperCase(), fx.a.agentEmail] },
        auth(manageToken),
      );
      expect(patched.statusCode).toBe(200);
      // Roster spelling, duplicate collapsed — as on create.
      expect((patched.json() as ScheduledExport).recipients).toEqual([fx.a.agentEmail]);
    });

    it('moves a schedule to another catalogue group', async () => {
      const schedule = await seed({ group: 'leads' });

      const patched = await server.patch(at(schedule.id), { group: 'cases' }, auth(manageToken));
      expect(patched.statusCode).toBe(200);
      expect((patched.json() as ScheduledExport).group).toBe('cases');
    });

    // --- Derived KK: an edit passes the same gate a create does ---------------

    it('refuses an edit that points the schedule at an unknown group', async () => {
      const schedule = await seed({ group: 'leads' });

      const patched = await server.patch(
        at(schedule.id),
        { group: 'not-a-report' },
        auth(manageToken),
      );
      expect(patched.statusCode).toBe(400);
      expect((await read(manageToken, schedule.id)).group).toBe('leads');
    });

    it('refuses an edit to an undefined frequency', async () => {
      const schedule = await seed({ frequency: 'weekly' });

      const patched = await server.patch(
        at(schedule.id),
        { frequency: 'hourly' },
        auth(manageToken),
      );
      expect(patched.statusCode).toBe(400);
      expect((await read(manageToken, schedule.id)).frequency).toBe('weekly');
    });

    it('refuses an edit that mails the report outside the workspace', async () => {
      // The PII boundary again. Without this, "create a schedule to yourself,
      // then edit the recipients" walks straight around the create-time check.
      const schedule = await seed({ recipients: [fx.a.ownerEmail] });

      const patched = await server.patch(
        at(schedule.id),
        { recipients: ['attacker@example.invalid'] },
        auth(manageToken),
      );
      expect(patched.statusCode).toBe(400);
      expect((await read(manageToken, schedule.id)).recipients).toEqual([fx.a.ownerEmail]);
    });

    it("refuses an edit naming another tenant's agent as a recipient", async () => {
      const schedule = await seed();

      const patched = await server.patch(
        at(schedule.id),
        { recipients: [fx.b.ownerEmail] },
        auth(manageToken),
      );
      expect(patched.statusCode).toBe(400);
    });

    it('refuses an edit naming a suspended agent', async () => {
      const schedule = await seed({ recipients: [fx.a.ownerEmail] });
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        data: { suspended: true },
      });

      const patched = await server.patch(
        at(schedule.id),
        { recipients: [fx.a.agentEmail] },
        auth(manageToken),
      );
      expect(patched.statusCode).toBe(400);
    });

    it('refuses an empty edit rather than answering 200 to a no-op', async () => {
      const schedule = await seed();
      expect((await server.patch(at(schedule.id), {}, auth(manageToken))).statusCode).toBe(400);
    });

    it('refuses an unknown key in an edit rather than silently ignoring it', async () => {
      const schedule = await seed();
      const patched = await server.patch(
        at(schedule.id),
        { frequancy: 'daily' },
        auth(manageToken),
      );
      expect(patched.statusCode).toBe(400);
    });

    it('refuses an edit to a format the scheduler does not produce', async () => {
      const schedule = await seed();
      expect(
        (await server.patch(at(schedule.id), { format: 'pdf' }, auth(manageToken))).statusCode,
      ).toBe(400);
    });

    // --- Cancellation (derived KK) -------------------------------------------

    it('cancels a definition, and the cancelled one never comes back', async () => {
      const schedule = await seed();

      const cancelled = await server.del(at(schedule.id), auth(manageToken));
      expect(cancelled.statusCode).toBe(204);

      expect((await server.get(at(schedule.id), auth(manageToken))).statusCode).toBe(404);
      expect(await list(manageToken)).toHaveLength(0);
      // And it cannot be edited back into existence.
      expect(
        (await server.patch(at(schedule.id), { enabled: true }, auth(manageToken))).statusCode,
      ).toBe(404);
    });

    it('takes the delivery history down with the definition', async () => {
      // The runs table carries a composite FK on (license_id, id); cancelling a
      // schedule must not leave history rows pointing at a definition nobody can
      // read any more.
      const schedule = await seed();
      await owner.scheduledReportRun.create({
        data: {
          licenseId: fx.a.licenseId,
          scheduledReportId: schedule.id,
          periodKey: '2026-W31',
          periodFrom: new Date('2026-07-27T00:00:00Z'),
          periodTo: new Date('2026-08-03T00:00:00Z'),
          status: 'sent',
          recipientCount: 1,
          rowCount: 12,
        },
      });
      expect(
        await owner.scheduledReportRun.count({ where: { scheduledReportId: schedule.id } }),
      ).toBe(1);

      expect((await server.del(at(schedule.id), auth(manageToken))).statusCode).toBe(204);

      expect(
        await owner.scheduledReportRun.count({ where: { scheduledReportId: schedule.id } }),
      ).toBe(0);
    });

    it('cancels only the one asked for', async () => {
      const kept = await seed({ group: 'overview' });
      const doomed = await seed({ group: 'leads' });

      expect((await server.del(at(doomed.id), auth(manageToken))).statusCode).toBe(204);

      const items = await list(manageToken);
      expect(items).toHaveLength(1);
      expect(items[0]?.id).toBe(kept.id);
    });

    // --- Missing and cross-tenant ids ----------------------------------------

    it('answers 404 for an id that never existed', async () => {
      const ghost = '00000000-0000-4000-8000-000000000000';
      expect((await server.get(at(ghost), auth(manageToken))).statusCode).toBe(404);
      expect(
        (await server.patch(at(ghost), { enabled: false }, auth(manageToken))).statusCode,
      ).toBe(404);
      expect((await server.del(at(ghost), auth(manageToken))).statusCode).toBe(404);
    });

    it('rejects a malformed id before it reaches the database', async () => {
      expect((await server.get(at('not-a-uuid'), auth(manageToken))).statusCode).toBe(400);
      expect(
        (await server.patch(at('not-a-uuid'), { enabled: false }, auth(manageToken))).statusCode,
      ).toBe(400);
      expect((await server.del(at('not-a-uuid'), auth(manageToken))).statusCode).toBe(400);
    });

    it('answers 404 — not 403 — when the id belongs to another licence', async () => {
      // 403 would confirm the schedule exists. The whole point of the roster
      // boundary is that one workspace learns nothing about another's, and
      // "this id is real" is something.
      const schedule = await seed();
      const b = await bToken();

      expect((await server.get(at(schedule.id), auth(b))).statusCode).toBe(404);
      expect((await server.patch(at(schedule.id), { enabled: false }, auth(b))).statusCode).toBe(
        404,
      );
      expect((await server.del(at(schedule.id), auth(b))).statusCode).toBe(404);

      // Untouched, and still A's.
      const survivor = await read(manageToken, schedule.id);
      expect(survivor.enabled).toBe(true);
      expect(await owner.scheduledReport.count({ where: { id: schedule.id } })).toBe(1);
    });

    it('runs the full lifecycle end to end', async () => {
      const schedule = await seed({ group: 'leads', frequency: 'weekly' });

      const patched = await server.patch(
        at(schedule.id),
        { group: 'sales', frequency: 'monthly', recipients: [fx.a.agentEmail], enabled: false },
        auth(manageToken),
      );
      expect(patched.statusCode).toBe(200);

      const fetched = await read(manageToken, schedule.id);
      expect(fetched).toMatchObject({
        id: schedule.id,
        group: 'sales',
        frequency: 'monthly',
        recipients: [fx.a.agentEmail],
        enabled: false,
        created_at: schedule.created_at,
      });

      expect((await server.del(at(schedule.id), auth(manageToken))).statusCode).toBe(204);
      expect((await server.get(at(schedule.id), auth(manageToken))).statusCode).toBe(404);
    });
  });

  // --- Delivery history (07.9-sched-g) ---------------------------------------
  //
  // The sweep writes a run row for every period it claims — delivered and
  // failed alike — and until this endpoint existed nothing could read them
  // back, so NFR-M5's observability share was recorded and then lost.
  //
  // Three properties carry the surface:
  //
  //   - it reports what actually happened. A real sweep, then the endpoint: the
  //     delivered period comes back as `delivered` with the row and recipient
  //     counts the run recorded, and a failed one as `failed` with its reason.
  //     Asserting against the sweeper's own output rather than against
  //     hand-written rows is the point — a DTO wired to the wrong column would
  //     pass a test that inserted its own fixtures.
  //   - it sits behind `reports_read` while the definition stays behind
  //     `reports_manage`, and that is only defensible because a run carries
  //     `recipient_count` and never an address. So both halves are tested: the
  //     read scope gets in, and what it gets carries no mailbox.
  //   - another licence's id is 404, exactly as on the definition itself. A 404
  //     for the unknown and the foreign alike is what keeps the endpoint from
  //     answering "that schedule is real".
  describe('delivery history', () => {
    /** A Saturday: with `daily`, the previous complete period is 2026-08-07. */
    const NOW = new Date('2026-08-08T09:00:00.000Z');
    const IN_PERIOD = new Date('2026-08-07T12:00:00.000Z');
    const PERIOD_KEY = '2026-08-07';

    let appRole: PrismaClient;
    let mailer: FileMailer;
    let mailDir: string;
    let readToken: string;

    const runsAt = (id: string, query = '') => `${PATH}/${id}/runs${query}`;

    const history = async (
      token: string,
      id: string,
      query = '',
    ): Promise<ScheduledExportRun[]> => {
      const response = await server.get(runsAt(id, query), auth(token));
      expect(response.statusCode).toBe(200);
      return (response.json() as { items: ScheduledExportRun[] }).items;
    };

    /** A definition owned by `t`, written directly so the sweep can pick it up. */
    const defineFor = async (t: TenantFixture, group = 'team-performance'): Promise<string> => {
      const row = await owner.scheduledReport.create({
        data: {
          licenseId: t.licenseId,
          groupId: group,
          frequency: 'daily',
          format: 'csv',
          recipients: [t.agentEmail],
          enabled: true,
        },
        select: { id: true },
      });
      return row.id;
    };

    /**
     * One closed, assigned thread inside the period — a single
     * `team-performance` row, so `row_count` has something to be other than 0.
     */
    const seedAssignedThread = async (t: TenantFixture): Promise<void> => {
      const customer = await owner.customer.create({
        data: { organizationId: t.organizationId, name: 'History visitor' },
        select: { id: true },
      });
      const chatId = generateShortId();
      await owner.chat.create({
        data: {
          id: chatId,
          licenseId: t.licenseId,
          customerId: customer.id,
          active: false,
          createdAt: IN_PERIOD,
        },
      });
      await owner.thread.create({
        data: {
          id: generateShortId(),
          chatId,
          licenseId: t.licenseId,
          active: false,
          assigneeId: t.agentAccountId,
          createdAt: IN_PERIOD,
          closedAt: new Date(IN_PERIOD.getTime() + 60_000),
        },
      });
    };

    const sweep = (mail: Mailer = mailer) =>
      new ScheduledReportSweeper(appRole, mail).run({ now: NOW });

    /**
     * A run written straight to the table. Used only where the *shape* of the
     * history is under test (order, limit) and the sweep would be machinery
     * without a question — it can only produce one row per period per
     * definition, so a multi-row history cannot come from one.
     */
    const recordRun = async (
      scheduledReportId: string,
      periodKey: string,
      createdAt: Date,
      overrides: Record<string, unknown> = {},
    ): Promise<void> => {
      await owner.scheduledReportRun.create({
        data: {
          licenseId: fx.a.licenseId,
          scheduledReportId,
          periodKey,
          periodFrom: new Date(`${periodKey}T00:00:00.000Z`),
          periodTo: new Date(`${periodKey}T23:59:59.999Z`),
          status: 'sent',
          recipientCount: 1,
          rowCount: 0,
          createdAt,
          ...overrides,
        },
      });
    };

    beforeAll(async () => {
      const appUrl = process.env['DATABASE_APP_URL'];
      if (!appUrl) throw new Error('DATABASE_APP_URL must be set');
      appRole = new PrismaClient({ datasourceUrl: appUrl });
      mailDir = await mkdtemp(join(tmpdir(), 'nexa-sched-history-'));
      mailer = new FileMailer(mailDir);
    });

    afterAll(async () => {
      await appRole.$disconnect();
      await rm(mailDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
      await rm(mailDir, { recursive: true, force: true });
      readToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['reports_read'],
      });
    });

    // --- What the sweep recorded, read back (derived KK) ----------------------

    it('shows the delivered period with the counts the run recorded', async () => {
      const id = await defineFor(fx.a);
      await seedAssignedThread(fx.a);

      const report = await sweep();
      expect(report.totals).toMatchObject({ delivered: 1, failed: 0 });

      const [run] = await history(readToken, id);
      expect(run).toMatchObject({
        period_key: PERIOD_KEY,
        // `delivered`, not the row's stored `sent` — one word for one thing
        // across the sweep report, this endpoint and the settings screen.
        status: 'delivered',
        row_count: 1,
        recipient_count: 1,
        error: null,
      });
      expect(run?.period_from).toBe('2026-08-07T00:00:00.000Z');
      expect(run?.period_to).toBe('2026-08-07T23:59:59.999Z');
      // Wired to the run row rather than recomputed: the numbers the operator's
      // sweep report shows are the numbers the workspace reads back.
      const delivery = report.tenants.flatMap((t) => t.deliveries).find((d) => d.periodKey);
      expect(run?.row_count).toBe(delivery?.rowCount);
      expect(run?.recipient_count).toBe(delivery?.recipientCount);
    });

    it('shows a failed delivery with its reason rather than hiding it', async () => {
      const id = await defineFor(fx.a);
      await seedAssignedThread(fx.a);

      const report = await sweep(new BrokenMailer());
      expect(report.totals).toMatchObject({ delivered: 0, failed: 1 });

      const [run] = await history(readToken, id);
      expect(run?.status).toBe('failed');
      expect(run?.period_key).toBe(PERIOD_KEY);
      // The sanitised line the sweep stored — enough to name the cause.
      expect(run?.error).toContain('smtp: connection refused');
      // Nothing was delivered, and the history says so rather than reporting a
      // partial success.
      expect(run?.recipient_count).toBe(0);
    });

    it('is empty for a schedule that has never run — not a 404', async () => {
      // "No deliveries yet" and "no such schedule" are different facts, and the
      // settings screen has to be able to tell them apart.
      const id = await defineFor(fx.a);
      expect(await history(readToken, id)).toEqual([]);
    });

    // --- Permission-based visibility (FR-MOD-07.7 KK) -------------------------

    it('refuses a token without reports_read', async () => {
      const id = await defineFor(fx.a);
      const strangerToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:rw'],
      });

      expect((await server.get(runsAt(id), auth(strangerToken))).statusCode).toBe(403);
      expect((await server.get(runsAt(id))).statusCode).toBe(401);
    });

    it('lets reports_read in — and hands it no recipient mailbox', async () => {
      // The whole reason the history sits behind the read scope while the
      // definition stays behind `reports_manage`: a run counts recipients, it
      // does not name them. If that ever stops being true this gate is wrong.
      const id = await defineFor(fx.a);
      await seedAssignedThread(fx.a);
      await sweep();

      const response = await server.get(runsAt(id), auth(readToken));
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain(fx.a.agentEmail);
      expect(response.body).not.toContain(fx.a.ownerEmail);

      // And the read scope still cannot reach the definition that names them.
      expect((await server.get(`${PATH}/${id}`, auth(readToken))).statusCode).toBe(403);
    });

    // --- Missing, malformed and cross-tenant ids ------------------------------

    it('answers 404 for an id that never existed', async () => {
      const ghost = '00000000-0000-4000-8000-000000000000';
      expect((await server.get(runsAt(ghost), auth(readToken))).statusCode).toBe(404);
    });

    it('rejects a malformed id before it reaches the database', async () => {
      expect((await server.get(runsAt('not-a-uuid'), auth(readToken))).statusCode).toBe(400);
    });

    it("answers 404 — not 403 — for another licence's definition", async () => {
      const id = await defineFor(fx.a);
      await seedAssignedThread(fx.a);
      await sweep();
      // A's own history is there to be found, so the 404 below is about the
      // caller and not about an empty table.
      expect(await history(readToken, id)).toHaveLength(1);

      const bToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_read', 'reports_manage'],
      });

      // 404 even though B holds both reports scopes: the refusal is the tenant
      // boundary, not a missing permission, and 403 would confirm A's schedule
      // is real.
      expect((await server.get(runsAt(id), auth(bToken))).statusCode).toBe(404);
    });

    it("does not mix another licence's runs into the page", async () => {
      const aId = await defineFor(fx.a);
      const bId = await defineFor(fx.b);
      await seedAssignedThread(fx.a);
      await seedAssignedThread(fx.b);
      await sweep();

      const aRuns = await history(readToken, aId);
      expect(aRuns).toHaveLength(1);
      expect(await owner.scheduledReportRun.count({ where: { scheduledReportId: bId } })).toBe(1);
      // B swept too, so the single row A sees is a filter working rather than a
      // table with one row in it.
      expect(await owner.scheduledReportRun.count()).toBe(2);
    });

    // --- Ordering and the limit ----------------------------------------------

    it('returns the newest run first', async () => {
      const id = await defineFor(fx.a);
      await recordRun(id, '2026-08-05', new Date('2026-08-06T00:05:00.000Z'));
      await recordRun(id, '2026-08-07', new Date('2026-08-08T00:05:00.000Z'));
      await recordRun(id, '2026-08-06', new Date('2026-08-07T00:05:00.000Z'));

      expect((await history(readToken, id)).map((run) => run.period_key)).toEqual([
        '2026-08-07',
        '2026-08-06',
        '2026-08-05',
      ]);
    });

    it('honours limit, keeping the newest', async () => {
      const id = await defineFor(fx.a);
      await recordRun(id, '2026-08-05', new Date('2026-08-06T00:05:00.000Z'));
      await recordRun(id, '2026-08-06', new Date('2026-08-07T00:05:00.000Z'));
      await recordRun(id, '2026-08-07', new Date('2026-08-08T00:05:00.000Z'));

      expect((await history(readToken, id, '?limit=2')).map((run) => run.period_key)).toEqual([
        '2026-08-07',
        '2026-08-06',
      ]);
    });

    it('defaults to the 20 newest', async () => {
      const id = await defineFor(fx.a);
      for (let day = 1; day <= 21; day += 1) {
        const key = `2026-07-${String(day).padStart(2, '0')}`;
        await recordRun(id, key, new Date(`${key}T23:00:00.000Z`));
      }

      const page = await history(readToken, id);
      expect(page).toHaveLength(20);
      expect(page[0]?.period_key).toBe('2026-07-21');
      expect(page.at(-1)?.period_key).toBe('2026-07-02');
    });

    it('refuses a limit above the cap rather than silently clamping it', async () => {
      // A clamped page is indistinguishable from a complete one, so a caller
      // that asked for 500 would read 100 runs as the whole history.
      const id = await defineFor(fx.a);
      expect((await server.get(runsAt(id, '?limit=101'), auth(readToken))).statusCode).toBe(400);
      expect((await server.get(runsAt(id, '?limit=0'), auth(readToken))).statusCode).toBe(400);
      expect((await server.get(runsAt(id, '?limit=-1'), auth(readToken))).statusCode).toBe(400);
      expect((await server.get(runsAt(id, '?limit=2.5'), auth(readToken))).statusCode).toBe(400);
      expect((await server.get(runsAt(id, '?limit=all'), auth(readToken))).statusCode).toBe(400);
      expect((await server.get(runsAt(id, '?limit=100'), auth(readToken))).statusCode).toBe(200);
    });

    it('rejects an unknown query parameter rather than ignoring it', async () => {
      const id = await defineFor(fx.a);
      expect((await server.get(runsAt(id, '?offset=10'), auth(readToken))).statusCode).toBe(400);
    });
  });
});
