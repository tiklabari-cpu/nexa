/**
 * The AI decision record (tm 288.2 · SiyahTuş analysis ID-08).
 *
 * What has to hold, each asserted on its own because each can fail alone:
 *
 *   1. Isolation — another workspace's record cannot be read, and a writer
 *      handed the wrong tenant cannot file a record under somebody else's
 *      licence (row level security, as the runtime role).
 *   2. The record is a record — `siyahtus_app` cannot edit one, and the
 *      database refuses a decision outside the list, conversation text in
 *      `details`, and `details` over the ceiling.
 *   3. It lives as long as the conversation (ID-08-S1) — the retention sweep
 *      takes a record with its thread, takes one with no connection by age
 *      under the same window, keeps the rest, and leaves the other tenant alone.
 *   4. Erasing the customer erases their records.
 *   5. The AI path writes one — a widget message the AI answers leaves a row
 *      naming the conversation, the request, the event it answered and the one
 *      it wrote, and `skill_runs` names the connection; a message no skill
 *      matched leaves none.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_DECISION_DETAILS_MAX_BYTES, AI_DECISIONS } from '@siyahtus/types';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { recordAiDecision } from '../../src/services/ai/decision-log.js';
import type { TenantRunner } from '../../src/services/ai/conversation/turn.js';
import { eraseCustomer } from '../../src/services/retention/erasure.js';
import { type RetentionPolicy } from '../../src/services/retention/policy.js';
import { RetentionRunner } from '../../src/services/retention/retention.js';
import {
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const POLICY: RetentionPolicy = { threadDays: 365, visitDays: 90, mailDays: 30, auditDays: 30 };
const DAY = 86_400_000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY);

describe('ai_decision_logs (ID-08)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let fx: Fixtures;
  let seq = 0;

  const ctx = (t: TenantFixture): TenantContext => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });
  const runnerFor =
    (t: TenantFixture): TenantRunner =>
    (fn) =>
      withTenant(appRole, ctx(t), fn);
  const silentLog = () => ({ error: vi.fn() });

  const nextId = (prefix: string): string => {
    seq += 1;
    return prefix + String(seq).padStart(11, '0');
  };

  async function seedChat(
    t: TenantFixture,
    options: { closedAt?: Date; active?: boolean } = {},
  ): Promise<{ chatId: string; threadId: string }> {
    const at = options.closedAt ?? new Date();
    const active = options.active ?? options.closedAt === undefined;
    const chatId = nextId('c');
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: t.customerId, active, createdAt: at },
    });
    const threadId = nextId('t');
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: t.licenseId,
        active,
        closedAt: active ? null : at,
        createdAt: at,
      },
    });
    return { chatId, threadId };
  }

  /** Planted as the owner so a scenario can set `created_at` on either side of a window. */
  async function seedDecision(
    t: TenantFixture,
    data: { chatId?: string; threadId?: string; customerId?: string; createdAt?: Date } = {},
  ): Promise<string> {
    const row = await owner.aiDecisionLog.create({
      data: { licenseId: t.licenseId, decision: 'answered', ...data },
      select: { id: true },
    });
    return row.id;
  }

  const decisionExists = async (id: string): Promise<boolean> =>
    (await owner.aiDecisionLog.findUnique({ where: { id } })) !== null;

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
  });

  // --- 1. Isolation ----------------------------------------------------------

  describe('isolation', () => {
    it("never shows one workspace another workspace's decision record (NFR-S4)", async () => {
      const { chatId, threadId } = await seedChat(fx.a);
      const id = await recordAiDecision(
        runnerFor(fx.a),
        ctx(fx.a),
        { decision: 'answered', chatId, threadId, customerId: fx.a.customerId },
        silentLog(),
      );
      expect(id).not.toBeNull();

      const seenByB = await withTenant(appRole, ctx(fx.b), (tx) =>
        Promise.all([
          tx.aiDecisionLog.findUnique({ where: { id: id! } }),
          tx.aiDecisionLog.count(),
          tx.aiDecisionLog.count({ where: { chatId } }),
        ]),
      );
      expect(seenByB).toEqual([null, 0, 0]);

      const seenByA = await withTenant(appRole, ctx(fx.a), (tx) =>
        tx.aiDecisionLog.findUnique({ where: { id: id! }, select: { chatId: true } }),
      );
      expect(seenByA).toEqual({ chatId });
    });

    it("cannot file a record under another workspace's licence", async () => {
      // B's session writing a row that names A's licence: the policy's WITH
      // CHECK refuses it, and the writer turns the refusal into a log line.
      const log = silentLog();
      const id = await recordAiDecision(runnerFor(fx.b), ctx(fx.a), { decision: 'silent' }, log);
      expect(id).toBeNull();
      expect(log.error).toHaveBeenCalledTimes(1);
      expect(await owner.aiDecisionLog.count()).toBe(0);
    });

    it('cannot be read outside a tenant session', async () => {
      await seedDecision(fx.a);
      expect(await appRole.aiDecisionLog.count()).toBe(0);
    });
  });

  // --- 2. A record is a record ---------------------------------------------

  describe('the table', () => {
    it('refuses the runtime role an edit', async () => {
      const id = await seedDecision(fx.a);
      await expect(
        withTenant(appRole, ctx(fx.a), (tx) =>
          tx.aiDecisionLog.update({ where: { id }, data: { decision: 'silent' } }),
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('refuses a decision outside AI_DECISIONS', async () => {
      await expect(
        owner.aiDecisionLog.create({ data: { licenseId: fx.a.licenseId, decision: 'maybe' } }),
      ).rejects.toThrow(/ai_decision_logs_decision_check/);
    });

    it('accepts exactly the decisions AI_DECISIONS names', async () => {
      // The CHECK and the shared list are written twice; a word added to one
      // and not the other is a turn that cannot be recorded.
      for (const decision of AI_DECISIONS) {
        await owner.aiDecisionLog.create({ data: { licenseId: fx.a.licenseId, decision } });
      }
      expect(await owner.aiDecisionLog.count()).toBe(AI_DECISIONS.length);
    });

    it('refuses conversation text in details', async () => {
      for (const key of ['text', 'message', 'reply', 'prompt']) {
        await expect(
          owner.aiDecisionLog.create({
            data: { licenseId: fx.a.licenseId, decision: 'answered', details: { [key]: 'x' } },
          }),
        ).rejects.toThrow(/ai_decision_logs_details_no_text_check/);
      }
    });

    it('refuses details over the ceiling, and the writer trims to fit instead', async () => {
      const blob = 'x'.repeat(AI_DECISION_DETAILS_MAX_BYTES);
      await expect(
        owner.aiDecisionLog.create({
          data: { licenseId: fx.a.licenseId, decision: 'answered', details: { blob } },
        }),
      ).rejects.toThrow(/ai_decision_logs_details_check/);

      const id = await recordAiDecision(
        runnerFor(fx.a),
        ctx(fx.a),
        { decision: 'answered', details: { blob, text: 'never kept' } },
        silentLog(),
      );
      const row = await owner.aiDecisionLog.findUnique({ where: { id: id! } });
      expect(row?.details).toEqual({ truncated: true, bytes: expect.any(Number) });
    });

    it('keeps every column the writer is given', async () => {
      const { chatId, threadId } = await seedChat(fx.a);
      const source = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
      const id = await recordAiDecision(
        runnerFor(fx.a),
        ctx(fx.a),
        {
          decision: 'handoff',
          chatId,
          threadId,
          customerId: fx.a.customerId,
          triggerEventId: `${threadId}_1`,
          replyEventId: `${threadId}_2`,
          requestId: 'req-0123456789',
          jobId: 'job:1',
          procedureId: source,
          procedureVersion: 2,
          step: 'transfer_to_team',
          knowledgeSourceIds: [source],
          chunkIds: [source],
          retrievalScores: [0.82],
          guardrailHits: ['pii'],
          handoffReason: 'transfer_to_team',
          riskFlags: ['minor'],
          model: 'mock',
          llmInputTokens: 10,
          llmOutputTokens: 5,
          latencyMs: 40,
          errorType: 'llm:timeout',
          details: { outcome: 'handed_off' },
          configVersionId: source,
        },
        silentLog(),
      );
      const row = await owner.aiDecisionLog.findUnique({ where: { id: id! } });
      expect(row).toMatchObject({
        licenseId: fx.a.licenseId,
        decision: 'handoff',
        chatId,
        threadId,
        customerId: fx.a.customerId,
        requestId: 'req-0123456789',
        knowledgeSourceIds: [source],
        retrievalScores: [0.82],
        riskFlags: ['minor'],
        latencyMs: 40,
        details: { outcome: 'handed_off' },
      });
    });
  });

  // --- 3. Retention ----------------------------------------------------------

  describe('retention (ID-08-S1)', () => {
    const runner = () =>
      new RetentionRunner(appRole, {
        policy: POLICY,
        mailDir: 'Z:/does-not-exist',
        auditChainSecret: testEnv().AUDIT_CHAIN_SECRET,
      });

    it('keeps a record exactly as long as its conversation (NFR-C8)', async () => {
      // On an expired, closed connection: goes with the thread.
      const expired = await seedChat(fx.a, { closedAt: daysAgo(400) });
      const withExpired = await seedDecision(fx.a, { ...expired, createdAt: daysAgo(400) });
      // On a live connection, however old: stays with it.
      const live = await seedChat(fx.a, { active: true });
      const withLive = await seedDecision(fx.a, { ...live, createdAt: daysAgo(400) });
      // On no connection: by age, under the same window.
      const oldLoose = await seedDecision(fx.a, { createdAt: daysAgo(400) });
      const recentLoose = await seedDecision(fx.a, { createdAt: daysAgo(10) });
      // The other workspace's identical rows are not this sweep's to touch.
      const theirs = await seedDecision(fx.b, { createdAt: daysAgo(400) });

      const dry = await runner().run({ dryRun: true });
      const dryA = dry.tenants.find((t) => t.licenseId === fx.a.licenseId.toString());
      expect(dryA?.aiDecisions).toBe(1);
      expect(await decisionExists(oldLoose)).toBe(true);

      const report = await runner().run({ dryRun: false });
      const a = report.tenants.find((t) => t.licenseId === fx.a.licenseId.toString());
      expect(a?.aiDecisions).toBe(1);
      expect(a?.threads).toBe(1);

      expect(await decisionExists(withExpired)).toBe(false);
      expect(await decisionExists(oldLoose)).toBe(false);
      expect(await decisionExists(withLive)).toBe(true);
      expect(await decisionExists(recentLoose)).toBe(true);

      // B is swept by its own pass, under its own context — and only its own
      // rows: A's pass above could not have reached it.
      expect(await decisionExists(theirs)).toBe(false);
      const b = report.tenants.find((t) => t.licenseId === fx.b.licenseId.toString());
      expect(b?.aiDecisions).toBe(1);

      const entry = await owner.auditLogEntry.findFirst({
        where: { licenseId: fx.a.licenseId, action: 'data.retention_pruned' },
      });
      expect(entry?.metadata).toMatchObject({ ai_decisions: 1, threads: 1 });

      // Idempotent.
      const again = await runner().run({ dryRun: false });
      expect(again.totals.aiDecisions).toBe(0);
    });

    it('keeps every record when the workspace keeps conversations without limit', async () => {
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { retentionThreadWindow: 'unlimited' },
      });
      const loose = await seedDecision(fx.a, { createdAt: daysAgo(4000) });
      const report = await runner().run({ dryRun: false });
      expect(
        report.tenants.find((t) => t.licenseId === fx.a.licenseId.toString())?.aiDecisions,
      ).toBe(0);
      expect(await decisionExists(loose)).toBe(true);
    });
  });

  // --- 4. Erasure ------------------------------------------------------------

  it("erasing a customer erases the AI's records about them (NFR-C8)", async () => {
    const closed = await seedChat(fx.a, { closedAt: daysAgo(1) });
    const onThread = await seedDecision(fx.a, { ...closed, customerId: fx.a.customerId });
    const onChatOnly = await seedDecision(fx.a, { chatId: closed.chatId });
    const onCustomerOnly = await seedDecision(fx.a, { customerId: fx.a.customerId });
    const unrelated = await seedDecision(fx.a);

    await withTenant(appRole, ctx(fx.a), (tx) => eraseCustomer(tx, fx.a.customerId, new Date()));

    expect(await decisionExists(onThread)).toBe(false);
    expect(await decisionExists(onChatOnly)).toBe(false);
    expect(await decisionExists(onCustomerOnly)).toBe(false);
    expect(await decisionExists(unrelated)).toBe(true);
  });
});

// --- 5. The AI path ----------------------------------------------------------

describe('ai_decision_logs on the AI path (ID-08)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;

  const customerAuth = async (): Promise<Record<string, string>> => {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    const { token } = response.json() as { token: string };
    return { authorization: `Bearer ${token}` };
  };

  async function createSkill(steps: unknown[]): Promise<string> {
    const skill = await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name: 'Order status',
        kind: 'ai_agent',
        steps: steps as object,
        active: true,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    return skill.id;
  }

  async function send(text: string, requestId?: string) {
    const headers = await customerAuth();
    const response = await server.post(
      '/customer/chat/events',
      { text },
      { ...headers, ...(requestId ? { 'x-request-id': requestId } : {}) },
    );
    expect(response.statusCode).toBe(201);
    return response.json() as { chat_id: string; event: { id: string; thread_id: string } };
  }

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
    const agent = await owner.aiAgent.create({
      data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
      select: { id: true },
    });
    aiAgentId = agent.id;
  });

  it('records the turn a widget message gets answered on, with every id it has', async () => {
    const skillId = await createSkill([
      { type: 'tag', tag: 'shipping' },
      { type: 'send_message', source: 'text', text: 'On it.' },
    ]);

    const sent = await send('Where is my parcel?', 'widget-req-288-2');

    const rows = await owner.aiDecisionLog.findMany({ where: { licenseId: fx.a.licenseId } });
    expect(rows).toHaveLength(1);
    const reply = await owner.event.findFirst({
      where: { chatId: sent.chat_id, authorType: 'bot' },
      select: { id: true },
    });
    expect(rows[0]).toMatchObject({
      decision: 'answered',
      chatId: sent.chat_id,
      threadId: sent.event.thread_id,
      customerId: expect.any(String),
      triggerEventId: sent.event.id,
      replyEventId: reply?.id,
      requestId: 'widget-req-288-2',
      procedureId: skillId,
      step: 'send_message',
      details: { outcome: 'answered', steps: ['tag', 'send_message'], failed_steps: [] },
    });
    expect(rows[0]?.latencyMs).toBeGreaterThanOrEqual(0);
    // The words stay in the transcript, never in the record.
    expect(
      JSON.stringify(rows[0], (_, v: unknown) => (typeof v === 'bigint' ? `${v}` : v)),
    ).not.toMatch(/parcel|On it/);

    const run = await owner.skillRun.findFirst({ where: { skillId } });
    expect(run?.threadId).toBe(sent.event.thread_id);
  });

  it('files a question as asked', async () => {
    await createSkill([
      { type: 'request_info', field: 'order_number', prompt: 'What is your order number?' },
    ]);
    await send('Where is my parcel?');
    const row = await owner.aiDecisionLog.findFirst({ where: { licenseId: fx.a.licenseId } });
    expect(row?.decision).toBe('asked');
  });

  it('leaves no record for a message no skill matched — the AI took no turn', async () => {
    await createSkill([
      { type: 'detect_intent', intent: 'refund', phrases: ['refund'] },
      { type: 'send_message', source: 'text', text: 'Refunds take 5 days.' },
    ]);
    await send('Hello there');
    expect(await owner.aiDecisionLog.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
  });
});
