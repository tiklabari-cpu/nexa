/**
 * The ticket first-response SLA (HD-05 · tm 360).
 *
 * What is pinned, in the task's own terms:
 *
 *   - "Acil: 60 dk": answered at minute 45 is no miss; no answer at minute 61
 *     is a miss the sweep marks and announces;
 *   - an internal note does not stop the clock;
 *   - with business hours on, closed time is not counted;
 *   - the list says how long is left and sorts the nearest first;
 *   - Reports → Cases gives the mean first-response time.
 *
 * And the rules around them: the default (no ticket target) measures nothing,
 * the chat target is not borrowed; a ticket opened from a chat is outside the
 * clock; a priority change moves the due moment and never the start;
 * reopening resumes rather than resets; a merged ticket's clock stops; a
 * recorded miss stays recorded.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WORK_SCHEDULE_DAYS, generateShortId, type TicketSla } from '@siyahtus/types';
import { withTenant } from '../../src/lib/tenant.js';
import { FileMailer } from '../../src/services/mail/mailer.js';
import { SlaSweeper } from '../../src/services/sla/sla-sweep.js';
import { TicketMessageService } from '../../src/services/tickets/ticket-message-service.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

interface TicketBody {
  id: string;
  priority: number;
  status: string;
  sla: TicketSla;
}

describe('ticket first-response SLA (HD-05)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let mailDir: string;
  let token: string;
  let settingsToken: string;
  let playerId: string;
  let keySeq = 0;

  const auth = (value: string) => ({ authorization: `Bearer ${value}` });
  const tenant = (t: TenantFixture = fx.a) => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });
  const sweep = (now = new Date()) => new SlaSweeper(appRole, new FileMailer(mailDir)).run({ now });
  const breaches = () =>
    owner.slaBreach.findMany({
      where: { licenseId: fx.a.licenseId, subjectType: 'ticket' },
      orderBy: { detectedAt: 'asc' },
    });

  async function savePolicy(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await server.put(
      '/settings/sla',
      {
        first_response_minutes: null,
        resolution_minutes: null,
        business_hours_only: false,
        ...body,
      },
      auth(settingsToken),
    );
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as Record<string, unknown>;
  }

  /** Urgent tickets: 60 minutes, the task's example. Others are not measured. */
  const urgent60 = () =>
    savePolicy({
      ticket_targets_by_priority: {
        urgent: { first_response_minutes: 60, resolution_minutes: null },
      },
    });

  async function makeTicket(
    options: { priority?: number; ageMinutes?: number; sourceChatId?: string } = {},
  ): Promise<string> {
    const response = await server.post(
      '/tickets',
      { subject: 'Çekimim gelmedi', customer_id: playerId },
      auth(token),
    );
    expect(response.statusCode, response.body).toBe(201);
    const { id } = response.json() as { id: string };
    if (options.priority !== undefined) {
      const patched = await server.patch(
        `/tickets/${id}`,
        { priority: options.priority },
        auth(token),
      );
      expect(patched.statusCode, patched.body).toBe(200);
    }
    if (options.ageMinutes !== undefined || options.sourceChatId !== undefined) {
      // Backdated (and, for the chat case, linked) by the owner; the sweep's
      // refresh then re-derives the due moment from the new creation.
      await owner.ticket.update({
        where: { id },
        data: {
          ...(options.ageMinutes !== undefined
            ? { createdAt: new Date(Date.now() - options.ageMinutes * MINUTE) }
            : {}),
          ...(options.sourceChatId !== undefined ? { sourceChatId: options.sourceChatId } : {}),
        },
      });
    }
    return id;
  }

  async function get(id: string): Promise<TicketBody> {
    const response = await server.get(`/tickets/${id}`, auth(token));
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as TicketBody;
  }

  function write(id: string, kind: 'reply' | 'note', extra: Record<string, unknown> = {}) {
    return server.post(
      `/tickets/${id}/messages`,
      { kind, text: 'Bakıyoruz.', idempotency_key: `k-${Date.now()}-${++keySeq}`, ...extra },
      auth(token),
    );
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner, { plan: 'enterprise' });
    await clearRateLimits(server.app);
    mailDir = await mkdtemp(join(tmpdir(), 'siyahtus-ticket-sla-mail-'));
    const player = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'Ayşe', email: 'ayse@example.test' },
      select: { id: true },
    });
    playerId = player.id;
    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['tickets--all:rw', 'tickets--all:ro', 'reports_read'],
    });
    settingsToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:ro', 'access_rules:rw'],
    });
  });

  afterEach(async () => {
    await rm(mailDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // The policy
  // ==========================================================================

  it('saves the ticket targets apart from the chat ones, and keeps them when a client leaves them out', async () => {
    const saved = await savePolicy({
      first_response_minutes: 30,
      ticket_first_response_minutes: 240,
      ticket_resolution_minutes: 2880,
      ticket_targets_by_priority: {
        urgent: { first_response_minutes: 60, resolution_minutes: null },
        low: { first_response_minutes: null, resolution_minutes: null },
      },
    });
    expect(saved).toMatchObject({
      first_response_minutes: 30,
      ticket_first_response_minutes: 240,
      ticket_resolution_minutes: 2880,
      // A priority with neither target is the same as one left out.
      ticket_targets_by_priority: {
        urgent: { first_response_minutes: 60, resolution_minutes: null },
      },
      active: true,
    });

    // A client written before HD-05 sends the three chat fields only.
    const older = await savePolicy({ first_response_minutes: 15 });
    expect(older).toMatchObject({
      first_response_minutes: 15,
      ticket_first_response_minutes: 240,
      ticket_targets_by_priority: { urgent: { first_response_minutes: 60 } },
    });

    const cleared = await savePolicy({ ticket_targets_by_priority: null });
    expect(cleared['ticket_targets_by_priority']).toBeNull();

    const bad = await server.put(
      '/settings/sla',
      {
        first_response_minutes: null,
        resolution_minutes: null,
        business_hours_only: false,
        ticket_targets_by_priority: {
          urgent: { first_response_minutes: 0, resolution_minutes: null },
        },
      },
      auth(settingsToken),
    );
    expect(bad.statusCode).toBe(400);
  });

  it('measures no ticket by default, and never against the chat target', async () => {
    await savePolicy({ first_response_minutes: 5 });
    const id = await makeTicket({ priority: 100, ageMinutes: 120 });
    await sweep();

    expect((await get(id)).sla).toEqual({
      first_response_at: null,
      first_response_due_at: null,
      first_response_breached: false,
    });
    expect(await breaches()).toHaveLength(0);
  });

  // ==========================================================================
  // The acceptance cases
  // ==========================================================================

  it('"Urgent: 60 min" answered at minute 45 is no miss (HD-05)', async () => {
    await urgent60();
    const id = await makeTicket({ priority: 100, ageMinutes: 45 });
    await sweep();
    const before = await get(id);
    expect(before.sla.first_response_due_at).not.toBeNull();
    expect(before.sla.first_response_breached).toBe(false);

    const reply = await write(id, 'reply');
    expect(reply.statusCode, reply.body).toBe(201);

    const after = await get(id);
    expect(after.sla.first_response_at).not.toBeNull();
    expect(after.sla.first_response_due_at).toBeNull();
    expect(after.sla.first_response_breached).toBe(false);
    await sweep();
    expect(await breaches()).toHaveLength(0);
  });

  it('no answer at minute 61 is a miss the sweep marks and announces (HD-05)', async () => {
    await urgent60();
    const id = await makeTicket({ priority: 100, ageMinutes: 61 });
    const report = await sweep();

    expect(report.tenants.find((t) => t.licenseId === fx.a.licenseId.toString())).toMatchObject({
      measured: true,
      marked: 1,
      notified: 1,
    });
    const rows = await breaches();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subjectId: id,
      target: 'first_response',
      targetMinutes: 60,
      elapsedMinutes: 61,
    });
    expect((await get(id)).sla.first_response_breached).toBe(true);
    const outbox = await new FileMailer(mailDir).outbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.body).toContain(id);
  });

  it('a reply that lands late marks the miss as the clock stops, and the miss stays', async () => {
    await urgent60();
    const id = await makeTicket({ priority: 100, ageMinutes: 90 });

    expect((await write(id, 'reply')).statusCode).toBe(201);
    const rows = await breaches();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subjectId: id, target: 'first_response' });

    // A later target does not undo a recorded miss.
    await savePolicy({ ticket_first_response_minutes: 600, ticket_targets_by_priority: null });
    expect((await get(id)).sla.first_response_breached).toBe(true);
  });

  it('an internal note does not stop the clock (HD-05)', async () => {
    await urgent60();
    const id = await makeTicket({ priority: 100, ageMinutes: 61 });

    expect((await write(id, 'note')).statusCode).toBe(201);
    const after = await get(id);
    expect(after.sla.first_response_at).toBeNull();
    expect(after.sla.first_response_due_at).not.toBeNull();

    await sweep();
    expect((await breaches()).map((row) => row.subjectId)).toEqual([id]);
  });

  it('does not count time outside business hours (HD-05)', async () => {
    // Open only during the hour that started two hours ago: of a 3-hour wait,
    // 60 minutes were open — not more than the target.
    const now = new Date();
    const start = new Date(now.getTime() - 2 * HOUR);
    const hh = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:00`;
    const end = new Date(start.getTime() + HOUR);
    const day = WORK_SCHEDULE_DAYS[(start.getUTCDay() + 6) % 7]!;
    // Skipped across midnight, where one slot would need two days.
    if (start.getUTCHours() > 21) return;
    await owner.workSchedule.create({
      data: {
        licenseId: fx.a.licenseId,
        agentId: fx.a.ownerAccountId,
        timezone: 'UTC',
        schedule: WORK_SCHEDULE_DAYS.map((d) => ({
          day: d,
          start: hh(start),
          end: hh(end),
          enabled: d === day,
        })),
      },
    });
    await savePolicy({
      business_hours_only: true,
      ticket_targets_by_priority: {
        urgent: { first_response_minutes: 60, resolution_minutes: null },
      },
    });
    const id = await makeTicket({ priority: 100, ageMinutes: 3 * 60 });
    await sweep(now);

    expect(await breaches()).toHaveLength(0);
    const sla = (await get(id)).sla;
    expect(sla.first_response_breached).toBe(false);
    // Due on the next open day, not 60 calendar minutes after creation.
    expect(Date.parse(sla.first_response_due_at!)).toBeGreaterThan(now.getTime());

    // The same wait by the calendar is a miss.
    await savePolicy({
      business_hours_only: false,
      ticket_targets_by_priority: {
        urgent: { first_response_minutes: 60, resolution_minutes: null },
      },
    });
    await sweep(now);
    expect((await breaches()).map((row) => row.subjectId)).toEqual([id]);
  });

  it('a priority change moves the due moment; the start stays the creation', async () => {
    await savePolicy({
      ticket_targets_by_priority: {
        urgent: { first_response_minutes: 60, resolution_minutes: null },
        normal: { first_response_minutes: 480, resolution_minutes: null },
      },
    });
    const id = await makeTicket({ ageMinutes: 90 });
    await sweep();
    const normal = await get(id);
    const created = Date.parse(
      (await owner.ticket.findUniqueOrThrow({ where: { id } })).createdAt.toISOString(),
    );
    const minuteOf = (iso: string) => Math.floor(Date.parse(iso) / MINUTE);
    expect(minuteOf(normal.sla.first_response_due_at!)).toBe(Math.floor(created / MINUTE) + 481);
    expect(normal.sla.first_response_breached).toBe(false);

    const patched = await server.patch(`/tickets/${id}`, { priority: 100 }, auth(token));
    expect(patched.statusCode).toBe(200);
    const urgent = patched.json() as TicketBody;
    expect(minuteOf(urgent.sla.first_response_due_at!)).toBe(Math.floor(created / MINUTE) + 61);
    expect(urgent.sla.first_response_breached).toBe(true);

    // Bulk does the same.
    const bulk = await server.post('/tickets/bulk', { ticket_ids: [id], priority: 0 }, auth(token));
    expect(bulk.statusCode, bulk.body).toBe(200);
    expect(minuteOf((await get(id)).sla.first_response_due_at!)).toBe(
      Math.floor(created / MINUTE) + 481,
    );
  });

  it('lists how long is left and sorts the nearest first (HD-05)', async () => {
    await savePolicy({
      ticket_targets_by_priority: {
        urgent: { first_response_minutes: 60, resolution_minutes: null },
        high: { first_response_minutes: 240, resolution_minutes: null },
      },
    });
    const high = await makeTicket({ priority: 50 });
    const unmeasured = await makeTicket();
    const urgent = await makeTicket({ priority: 100 });
    const answered = await makeTicket({ priority: 100 });
    expect((await write(answered, 'reply')).statusCode).toBe(201);

    const asc = await server.get('/tickets?sort=sla&order=asc', auth(token));
    expect(asc.statusCode, asc.body).toBe(200);
    const items = (asc.json() as { items: TicketBody[] }).items;
    expect(items.map((t) => t.id).slice(0, 2)).toEqual([urgent, high]);
    // Not running: last, in both directions.
    expect(
      items
        .slice(2)
        .map((t) => t.id)
        .sort(),
    ).toEqual([answered, unmeasured].sort());
    expect(items[0]!.sla.first_response_due_at).not.toBeNull();

    const desc = await server.get('/tickets?sort=sla&order=desc', auth(token));
    expect((desc.json() as { items: TicketBody[] }).items.map((t) => t.id).slice(0, 2)).toEqual([
      high,
      urgent,
    ]);

    // Keyset pages across the empty tail without repeating or skipping.
    const seen: string[] = [];
    let page = '';
    for (let i = 0; i < 5; i++) {
      const response = await server.get(
        `/tickets?sort=sla&order=asc&limit=1${page ? `&page_id=${page}` : ''}`,
        auth(token),
      );
      const body = response.json() as { items: TicketBody[]; next_page_id?: string };
      seen.push(...body.items.map((t) => t.id));
      if (!body.next_page_id) break;
      page = body.next_page_id;
    }
    expect(seen.slice(0, 2)).toEqual([urgent, high]);
    expect([...seen].sort()).toEqual([high, unmeasured, urgent, answered].sort());
  });

  // ==========================================================================
  // What the clock leaves out
  // ==========================================================================

  it('leaves a ticket opened from a chat outside the clock', async () => {
    await urgent60();
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: fx.a.licenseId, customerId: playerId, active: false },
    });
    const id = await makeTicket({ priority: 100, ageMinutes: 120, sourceChatId: chatId });
    await sweep();

    expect((await get(id)).sla.first_response_due_at).toBeNull();
    expect((await write(id, 'reply')).statusCode).toBe(201);
    expect(await breaches()).toHaveLength(0);
  });

  it('solving stops the clock; the player reopening resumes it from the creation', async () => {
    await urgent60();
    const id = await makeTicket({ priority: 100, ageMinutes: 30 });
    await sweep();
    const due = (await get(id)).sla.first_response_due_at;
    expect(due).not.toBeNull();

    const solved = await server.patch(`/tickets/${id}`, { status: 'solved' }, auth(token));
    expect((solved.json() as TicketBody).sla.first_response_due_at).toBeNull();

    await withTenant(server.app.db, tenant(), (tx) =>
      new TicketMessageService().recordCustomerMessage(
        tx,
        tenant(),
        {
          licenseId: fx.a.licenseId,
          chainSecret: testEnv().AUDIT_CHAIN_SECRET,
          actorId: null,
          actorType: 'system',
        },
        { ticketId: id, text: 'Hâlâ gelmedi.' },
      ),
    );
    const reopened = await get(id);
    expect(reopened.status).toBe('open');
    expect(reopened.sla.first_response_due_at).toBe(due);
  });

  it('stops a merged ticket’s clock without carrying it to the primary', async () => {
    await urgent60();
    const primary = await makeTicket();
    const secondary = await makeTicket({ priority: 100, ageMinutes: 120 });
    await sweep();
    // The sweep marked the secondary while it stood alone.
    expect((await breaches()).map((row) => row.subjectId)).toEqual([secondary]);

    const merged = await server.post(`/tickets/${secondary}/merge`, { into: primary }, auth(token));
    expect(merged.statusCode, merged.body).toBe(200);
    expect((merged.json() as TicketBody).sla.first_response_due_at).toBeNull();
    expect((await get(primary)).sla.first_response_due_at).toBeNull();
  });

  // ==========================================================================
  // Reports
  // ==========================================================================

  it('reports the mean and median first response and the misses (HD-05)', async () => {
    await urgent60();
    const fast = await makeTicket({ priority: 100, ageMinutes: 20 });
    const slow = await makeTicket({ priority: 100, ageMinutes: 100 });
    await makeTicket({ priority: 100 });
    expect((await write(fast, 'reply')).statusCode).toBe(201);
    expect((await write(slow, 'reply')).statusCode).toBe(201);

    const from = new Date(Date.now() - 3 * HOUR).toISOString();
    const response = await server.get(`/reports/cases?from=${from}`, auth(token));
    expect(response.statusCode, response.body).toBe(200);
    const block = (response.json() as { first_response: Record<string, number | null> })
      .first_response;
    expect(block['answered']).toBe(2);
    expect(block['avg_minutes']).toBeGreaterThanOrEqual(59.9);
    expect(block['avg_minutes']).toBeLessThanOrEqual(60.2);
    expect(block['median_minutes']).toBe(block['avg_minutes']);
    expect(block['breached_count']).toBe(1);
  });
});
