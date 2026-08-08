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
 * And underneath both, the failure most easily shipped unseen: one tenant
 * listing another's schedules — which would expose not just that a schedule
 * exists but the mailboxes it delivers to.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
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
});
