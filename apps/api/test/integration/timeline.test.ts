/**
 * The conversation timeline (ID-09 · tm 334.1): `GET /chats/{chatId}/timeline`
 * and `POST /chats/{chatId}/timeline/export`.
 *
 * What the analysis' acceptance asks of the API half:
 *   - messages, notes, the AI's decisions (procedure, sources, hand-over
 *     reason), assignment, transfer, tag, closing and rating in the right
 *     order — whatever order the sources were written in, and across pages;
 *   - an Ekip Üyesi cannot open another team's timeline (404), and by default
 *     only their own conversations' (ID-09-S1);
 *   - the CSV masks the player's email and username by default, the export is
 *     in the audit log, unmasked is the Founder's alone (S2, S3);
 *   - a conversation older than the audit retention says so instead of failing.
 *
 * Rows are written straight to their tables, in scrambled order, at fixed
 * offsets from one base instant — the order is the read's, not the writes'.
 */
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultScopesForRole, generateShortId } from '@siyahtus/types';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Headers = Record<string, string>;

interface TimelineBody {
  chat_id: string;
  thread_id: string | null;
  items: Array<{
    id: string;
    at: string;
    kind: string;
    actor: { type: string; id: string | null; name: string | null };
    chat_id: string;
    thread_id: string | null;
    event_id?: string;
    text?: string;
    details: Record<string, unknown>;
  }>;
  next_page_id?: string;
  audit: 'included' | 'not_permitted';
  audit_retained_since: string;
  audit_expired: boolean;
}

const EMAIL = 'ayse.player@example.test';
const USERNAME = 'ayse_k77';
const PLAYER = 'Ayşe Oyuncu';

describe('conversation timeline (ID-09 · tm 334.1)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let sales: bigint;
  let billing: bigint;
  let ownerAuth: Headers;
  let adminAuth: Headers;
  let leadAuth: Headers;
  let agentAuth: Headers;

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
    server.app.permissionMatrix.cache.invalidate();
    await clearRateLimits(server.app);

    const group = async (name: string): Promise<bigint> =>
      (
        await owner.group.create({
          data: { licenseId: fx.a.licenseId, name },
          select: { id: true },
        })
      ).id;
    sales = await group('Sales');
    billing = await group('Billing');
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: sales, agentId: fx.a.agentAccountId },
    });

    const member = async (role: string, groupId?: bigint): Promise<Headers> => {
      const account = await owner.account.create({
        data: { email: `${role}-${fx.a.licenseId}@example.test`, name: `The ${role}` },
        select: { id: true },
      });
      await owner.agentMembership.create({
        data: { licenseId: fx.a.licenseId, agentId: account.id, role },
      });
      if (groupId !== undefined) {
        await owner.groupAgent.create({
          data: { licenseId: fx.a.licenseId, groupId, agentId: account.id, isLead: true },
        });
      }
      return session(fx.a, account.id, role);
    };
    adminAuth = await member('admin');
    leadAuth = await member('team_lead', sales);
    ownerAuth = await session(fx.a, fx.a.ownerAccountId, 'owner');
    agentAuth = await session(fx.a, fx.a.agentAccountId, 'agent');
  });

  afterEach(async () => {
    await server.app.backgroundMail.settled();
  });

  async function session(t: TenantFixture, accountId: string, role: string): Promise<Headers> {
    const token = await grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: accountId,
      kind: 'oauth',
      scopes: defaultScopesForRole(role),
    });
    return { authorization: `Bearer ${token}` };
  }

  interface Day {
    chatId: string;
    threadId: string;
    secondThreadId: string;
    base: number;
  }

  /**
   * A day routed to `groupId` with two connections and one row of every kind
   * on the first, written newest first. `members` joined the chat.
   */
  async function day(
    groupId: bigint,
    options: { members?: string[]; createdAt?: Date } = {},
  ): Promise<Day> {
    const licenseId = fx.a.licenseId;
    const base = Date.now() - 120_000;
    const at = (offset: number) => new Date(base + offset);
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: PLAYER, email: EMAIL, username: USERNAME },
      select: { id: true },
    });
    const chatId = generateShortId();
    const threadId = generateShortId();
    const secondThreadId = generateShortId();
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId,
        customerId: customer.id,
        active: false,
        createdAt: options.createdAt ?? at(0),
      },
    });
    await owner.chatAccess.create({ data: { chatId, groupId } });
    for (const userId of options.members ?? []) {
      await owner.chatUser.create({ data: { chatId, userId, userType: 'agent' } });
    }
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId,
        active: false,
        createdAt: at(0),
        closedAt: at(7_000),
      },
    });
    await owner.thread.create({
      data: {
        id: secondThreadId,
        chatId,
        licenseId,
        active: false,
        createdAt: at(20_000),
        closedAt: at(30_000),
      },
    });

    const event = (
      thread: string,
      seq: number,
      offset: number,
      data: {
        type?: string;
        text: string;
        authorType: string;
        recipients?: string;
        properties?: object;
      },
    ) =>
      owner.event.create({
        data: {
          id: `${thread}_${seq}`,
          threadId: thread,
          chatId,
          licenseId,
          type: data.type ?? 'message',
          text: data.text,
          authorType: data.authorType,
          authorId: data.authorType === 'agent' ? fx.a.agentAccountId : null,
          recipients: data.recipients ?? 'all',
          properties: data.properties ?? {},
          createdAt: at(offset),
        },
      });

    // Newest first: the timeline's order is the read's.
    await owner.ticket.create({
      data: {
        id: generateShortId(),
        licenseId,
        subject: 'Withdrawal follow-up',
        sourceChatId: chatId,
        sourceThreadId: threadId,
        createdAt: at(10_000),
      },
    });
    await owner.slaBreach.create({
      data: {
        licenseId,
        subjectType: 'thread',
        subjectId: threadId,
        target: 'first_response',
        targetMinutes: 5,
        elapsedMinutes: 9,
        businessHoursOnly: false,
        detectedAt: at(9_000),
      },
    });
    await owner.rating.create({
      data: { chatId, licenseId, threadId, value: 'good', comment: 'Thanks', createdAt: at(8_000) },
    });
    // In the hand-over's millisecond: the decision is listed before the line.
    await event(threadId, 6, 6_000, {
      type: 'system_message',
      text: 'Chat archived',
      authorType: 'system',
      properties: { system_event: 'chat_deactivated' },
    });
    await owner.aiDecisionLog.create({
      data: {
        licenseId,
        chatId,
        threadId,
        decision: 'handoff',
        procedureId: randomUUID(),
        procedureVersion: 3,
        step: 'collect_txid',
        knowledgeSourceIds: [randomUUID()],
        handoffReason: 'player_asked_for_human',
        createdAt: at(6_000),
      },
    });
    const tag = await owner.tag.create({ data: { licenseId, name: `vip-${chatId}` } });
    await owner.threadTag.create({ data: { threadId, tagId: tag.id, taggedAt: at(5_000) } });
    await event(threadId, 4, 4_000, {
      type: 'system_message',
      text: 'Chat transferred',
      authorType: 'system',
      properties: { system_event: 'chat_transferred' },
    });
    await owner.queueEntry.create({
      data: {
        licenseId,
        threadId,
        groupId,
        enteredAt: at(1_000),
        leftAt: at(3_000),
        outcome: 'assigned',
      },
    });
    await event(threadId, 3, 2_000, {
      text: 'Internal: check the KYC file',
      authorType: 'agent',
      recipients: 'agents',
    });
    // The message and the AI's decision about it in one millisecond: the
    // message is listed first.
    await owner.aiDecisionLog.create({
      data: {
        licenseId,
        chatId,
        threadId,
        decision: 'answered',
        triggerEventId: `${threadId}_1`,
        createdAt: at(0),
      },
    });
    await event(threadId, 1, 0, {
      text: `Hi, I am ${EMAIL}, my username is ${USERNAME}`,
      authorType: 'customer',
    });
    await event(secondThreadId, 1, 20_000, { text: 'Back again', authorType: 'customer' });
    return { chatId, threadId, secondThreadId, base };
  }

  async function timeline(chatId: string, auth: Headers, query = ''): Promise<TimelineBody> {
    const response = await server.get(`/chats/${chatId}/timeline${query}`, auth);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as TimelineBody;
  }

  const EXPECTED_ORDER = [
    'message',
    'ai_decision',
    'assignment', // queued
    'note',
    'assignment', // left the queue: assigned
    'transfer',
    'tag',
    'ai_decision', // the hand-over
    'system', // archived
    'rating',
    'sla_breach',
    'ticket',
    'message', // the second connection
  ];

  it('lists every kind in time order, the message before the decision about it (ID-09 KK1)', async () => {
    const d = await day(sales);
    const body = await timeline(d.chatId, ownerAuth);

    expect(body.chat_id).toBe(d.chatId);
    expect(body.thread_id).toBeNull();
    expect(body.next_page_id).toBeUndefined();
    expect(body.audit).toBe('included');
    expect(body.audit_expired).toBe(false);
    expect(body.items.map((item) => item.kind)).toEqual(EXPECTED_ORDER);
    expect(body.items.map((item) => item.at)).toEqual(
      [...body.items.map((item) => item.at)].sort(),
    );

    const [message, decision] = body.items;
    expect(message!.at).toBe(decision!.at);
    expect(message!.actor).toMatchObject({ type: 'customer', name: PLAYER });
    expect(decision!.event_id).toBe(message!.event_id);

    const handoff = body.items[7]!;
    expect(handoff.actor.type).toBe('ai');
    expect(handoff.details).toMatchObject({
      decision: 'handoff',
      procedure_version: 3,
      step: 'collect_txid',
      handoff_reason: 'player_asked_for_human',
    });
    expect(handoff.details.knowledge_source_ids).toHaveLength(1);
    expect(handoff.text).toContain('player_asked_for_human');

    const note = body.items[3]!;
    expect(note).toMatchObject({ kind: 'note', actor: { type: 'agent', id: fx.a.agentAccountId } });
    expect(note.actor.name).toMatch(/^Agent /);
    expect(body.items[4]!.details).toMatchObject({ action: 'left_queue', outcome: 'assigned' });
    expect(body.items[6]!.text).toBe(`vip-${d.chatId}`);
    expect(body.items[9]!.details).toMatchObject({ value: 'good', comment: 'Thanks' });
    expect(body.items.at(-1)!.thread_id).toBe(d.secondThreadId);
  });

  it('pages without a gap or a repeat, also through rows of one millisecond', async () => {
    const d = await day(sales);
    // Five more notes in the second connection's millisecond.
    for (let seq = 2; seq <= 6; seq += 1) {
      await owner.event.create({
        data: {
          id: `${d.secondThreadId}_${seq}`,
          threadId: d.secondThreadId,
          chatId: d.chatId,
          licenseId: fx.a.licenseId,
          type: 'message',
          text: `note ${seq}`,
          authorType: 'agent',
          authorId: fx.a.agentAccountId,
          recipients: 'agents',
          createdAt: new Date(d.base + 20_000),
        },
      });
    }
    const whole = (await timeline(d.chatId, ownerAuth)).items.map((item) => item.id);
    expect(whole).toHaveLength(EXPECTED_ORDER.length + 5);

    for (const limit of [1, 2, 3, 5]) {
      const seen: string[] = [];
      let pageId: string | undefined;
      for (let guard = 0; guard < 50; guard += 1) {
        const page = await timeline(
          d.chatId,
          ownerAuth,
          `?limit=${limit}${pageId ? `&page_id=${pageId}` : ''}`,
        );
        expect(page.items.length).toBeLessThanOrEqual(limit);
        seen.push(...page.items.map((item) => item.id));
        pageId = page.next_page_id;
        if (pageId === undefined) break;
      }
      expect(seen, `limit ${limit}`).toEqual(whole);
    }

    const bad = await server.get(`/chats/${d.chatId}/timeline?page_id=not-a-cursor`, ownerAuth);
    expect(bad.statusCode).toBe(400);
  });

  it('keeps the kinds asked for, and one connection when asked (ID-09)', async () => {
    const d = await day(sales);
    const decisions = await timeline(d.chatId, ownerAuth, '?kinds=ai_decision,rating');
    expect(decisions.items.map((item) => item.kind)).toEqual([
      'ai_decision',
      'ai_decision',
      'rating',
    ]);
    expect(
      (await server.get(`/chats/${d.chatId}/timeline?kinds=bogus`, ownerAuth)).statusCode,
    ).toBe(400);

    const second = await timeline(d.chatId, ownerAuth, `?thread_id=${d.secondThreadId}`);
    expect(second.thread_id).toBe(d.secondThreadId);
    expect(second.items.map((item) => item.text)).toEqual(['Back again']);

    const other = await day(sales);
    const foreign = await server.get(
      `/chats/${d.chatId}/timeline?thread_id=${other.threadId}`,
      ownerAuth,
    );
    expect(foreign.statusCode).toBe(404);
  });

  it("keeps an Ekip Üyesi to their own conversations and another team's away from them (ID-09-S1 · ID-09 KK3 · NFR-S5 · FR-MOD-04.RBAC)", async () => {
    // Their team's, but not theirs: `own` by default.
    const teams = await day(sales);
    expect((await server.get(`/chats/${teams.chatId}/timeline`, agentAuth)).statusCode).toBe(404);
    // Theirs.
    const mine = await day(sales, { members: [fx.a.agentAccountId] });
    expect((await timeline(mine.chatId, agentAuth)).items).toHaveLength(EXPECTED_ORDER.length);
    // Another team's.
    const billingDay = await day(billing);
    expect((await server.get(`/chats/${billingDay.chatId}/timeline`, agentAuth)).statusCode).toBe(
      404,
    );
    // Another workspace's.
    expect(
      (
        await server.get(
          `/chats/${mine.chatId}/timeline`,
          await session(fx.b, fx.b.ownerAccountId, 'owner'),
        )
      ).statusCode,
    ).toBe(404);

    // The Ekip Lideri reads their team's without being in it, never another's,
    // and without the audit rows.
    const lead = await timeline(teams.chatId, leadAuth);
    expect(lead.audit).toBe('not_permitted');
    expect(lead.items.some((item) => item.kind === 'audit')).toBe(false);
    expect((await server.get(`/chats/${billingDay.chatId}/timeline`, leadAuth)).statusCode).toBe(
      404,
    );

    // The Founder lowers the Ekip Üyesi cell to none: refused outright.
    await owner.roleCapabilityOverride.create({
      data: {
        licenseId: fx.a.licenseId,
        role: 'agent',
        capability: 'timeline.view',
        value: 'none',
      },
    });
    server.app.permissionMatrix.cache.invalidate();
    const refused = await server.get(`/chats/${mine.chatId}/timeline`, agentAuth);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({
      error: { details: { reason: 'capability_required', capability: 'timeline.view' } },
    });
  });

  it('exports a masked CSV by default, under the "Thread ID (chat_id)" header, and audits it (ID-09 KK4 · ID-09-S2)', async () => {
    const d = await day(sales);
    const response = await server.post(
      `/chats/${d.chatId}/timeline/export`,
      { format: 'csv' },
      adminAuth,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain(`siyahtus-timeline-${d.chatId}.csv`);

    const lines = response.body.trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'At (UTC),Kind,Actor type,Actor,Thread ID (chat_id),Chat ID (thread_id),Event ID,Text,Details',
    );
    // A Yönetici reads the audit rows: this export's own entry, written first, is the last row.
    expect(lines).toHaveLength(1 + EXPECTED_ORDER.length + 1);
    expect(lines.at(-1)).toContain('chat.timeline_exported');
    expect(response.body).not.toContain(EMAIL);
    expect(response.body).not.toContain(USERNAME);
    expect(response.body).not.toContain(PLAYER);
    expect(lines[1]).toContain('Hi, I am');

    const entry = await owner.auditLogEntry.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, action: 'chat.timeline_exported' },
    });
    expect(entry.target).toBe(`chat:${d.chatId}`);
    expect(entry.metadata).toMatchObject({ format: 'csv', masked: true });

    // The export is on the timeline itself, for whoever may read the audit log.
    const after = await timeline(d.chatId, ownerAuth, '?kinds=audit');
    expect(after.items.map((item) => item.text)).toEqual(['chat.timeline_exported']);
  });

  it('keeps the export to Yönetici and Kurucu, and unmasked to the Kurucu (ID-09-S2 · ID-09-S3 · FR-MOD-04.RBAC)', async () => {
    const d = await day(sales);
    const asLead = await server.post(
      `/chats/${d.chatId}/timeline/export`,
      { format: 'csv' },
      leadAuth,
    );
    expect(asLead.statusCode).toBe(403);
    expect(asLead.json()).toMatchObject({ error: { details: { capability: 'timeline.export' } } });

    const adminUnmasked = await server.post(
      `/chats/${d.chatId}/timeline/export`,
      { format: 'csv', mask_pii: false },
      adminAuth,
    );
    expect(adminUnmasked.statusCode).toBe(403);
    expect(adminUnmasked.json()).toMatchObject({
      error: { details: { capability: 'timeline.export_unmasked' } },
    });
    expect(
      await owner.auditLogEntry.count({
        where: { licenseId: fx.a.licenseId, action: 'chat.timeline_exported' },
      }),
    ).toBe(0);

    const unmasked = await server.post(
      `/chats/${d.chatId}/timeline/export`,
      { format: 'ndjson', mask_pii: false },
      ownerAuth,
    );
    expect(unmasked.statusCode).toBe(200);
    const rows = unmasked.body
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as { kind: string; text?: string });
    // The owner reads the audit rows too, and the entry of this export is written first.
    expect(rows.map((row) => row.kind)).toEqual([...EXPECTED_ORDER, 'audit']);
    expect(rows[0]!.text).toContain(EMAIL);

    const text = await server.post(
      `/chats/${d.chatId}/timeline/export`,
      { format: 'txt' },
      ownerAuth,
    );
    expect(text.statusCode).toBe(200);
    expect(text.body.split('\n')[0]).toBe(`Thread ID (chat_id): ${d.chatId}`);
    // A separator before each connection.
    expect(text.body).toContain(`---- Chat ID (thread_id): ${d.threadId} ----`);
    expect(text.body).toContain(`---- Chat ID (thread_id): ${d.secondThreadId} ----`);
    expect(text.body).not.toContain(EMAIL);

    // Outside the exporter's reach the chat is absent, as everywhere.
    const foreign = await server.post(
      `/chats/${d.chatId}/timeline/export`,
      { format: 'csv' },
      await session(fx.b, fx.b.ownerAccountId, 'owner'),
    );
    expect(foreign.statusCode).toBe(404);
  });

  it('says the audit trail has expired for a conversation older than its retention, without failing (ID-09 KK5)', async () => {
    const old = await day(sales, { createdAt: new Date(Date.now() - 400 * 86_400_000) });
    const body = await timeline(old.chatId, ownerAuth);
    expect(body.audit_expired).toBe(true);
    expect(new Date(body.audit_retained_since).getTime()).toBeGreaterThan(
      Date.now() - 60 * 86_400_000,
    );
    expect(body.items).toHaveLength(EXPECTED_ORDER.length);
  });
});
