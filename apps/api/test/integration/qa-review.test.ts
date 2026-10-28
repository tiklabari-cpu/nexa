/**
 * The QA queue's review side (tm 319.2 · SiyahTuş analysis AI-24 ·
 * `paths/qa.yaml`), through the real server and a real database:
 *
 *   - **Pre-score.** The model's pre-score cites only this conversation's
 *     events; one foreign citation drops it, a failing model leaves the review
 *     ready without one, a workspace that switched it off is never asked.
 *   - **Scoring.** A review is completed by the reviewer who claimed it, with
 *     every critical criterion confirmed one by one; a failed critical
 *     criterion is a fail and opens an AI-23 suggestion and an AI-19 scenario
 *     draft, and a missed mandatory hand-over mails the administrators.
 *   - **Reach.** A Team Lead sees, claims and scores their led teams' reviews
 *     only; a member without the row none; another workspace nothing.
 *   - **Claiming.** One reviewer at a time; the reviewer who took the
 *     conversation over may not review it; a release puts it back.
 *   - **By hand.** "QA'ya gönder" merges into a queued review, never into a
 *     completed one; an open connection or one without the AI is refused.
 *   - **Settings, rubric, summary, consistency, calibration.**
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AI_BOT_ID,
  DEFAULT_AGENT_SCOPES,
  PLATFORM_QA_RUBRIC,
  buildEventId,
  generateShortId,
} from '@siyahtus/types';
import { resolveInferenceProvider } from '../../src/services/ai/inference.js';
import { MockLlmProvider } from '../../src/services/ai/provider/mock-llm-provider.js';
import type { LlmProvider } from '../../src/services/ai/provider/llm-provider.js';
import { FileMailer } from '../../src/services/mail/mailer.js';
import { QaConsistency } from '../../src/services/qa/consistency.js';
import { QaPrescorer } from '../../src/services/qa/prescore.js';
import { mockQaPrescore, readQaPrescoreGrounding } from '../../src/services/qa/prescore-prompt.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Json = Record<string, unknown>;
type Headers = Record<string, string>;

interface ReviewBody {
  id: string;
  status: string;
  reasons: string[];
  team_id: number | null;
  final: string | null;
  critical_fail: boolean;
  assigned_to: string | null;
  prescored: boolean;
  prescore: {
    criteria: Array<{ key: string; value: unknown; evidence_event_ids: string[] }>;
    overall: string;
  } | null;
  excerpt: Array<{ event_id: string; author_type: string; text: string }>;
  excerpt_restricted: boolean;
  rubric: { criteria: Array<{ key: string; critical: boolean }> };
  trace: { handoffs: unknown[]; decisions: unknown[] };
  follow_ups: {
    suggestion_id: string | null;
    scenario_id: string | null;
    mandatory_handoff_violation?: boolean;
  };
}

/** Every platform criterion passing; the critical ones confirmed unless `confirm` is false. */
function scores(overrides: Json = {}, confirm = true): Json {
  return {
    ...Object.fromEntries(
      PLATFORM_QA_RUBRIC.map((c) => [
        c.key,
        {
          value: c.type === 'pass_fail' ? 'pass' : 4,
          ...(c.critical ? { confirmed: confirm } : {}),
        },
      ]),
    ),
    ...overrides,
  };
}

const LIMITS = { maxOutputTokens: 2000, timeoutMs: 5000, maxPromptChars: 100_000 };

describe('the QA queue’s review side (tm 319.2 · AI-24)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let mailer: FileMailer;
  let fx: Fixtures;
  let teamA: bigint;
  let teamB: bigint;
  let seq = 0;

  beforeAll(async () => {
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: process.env['DATABASE_APP_URL'] });
    mailer = new FileMailer(await mkdtemp(join(tmpdir(), 'siyahtus-qa-')));
    server = await startTestServer({}, { mailer });
  });

  afterAll(async () => {
    await server.close();
    await app.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    server.app.permissionMatrix.cache.invalidate();
    await owner.aiAgent.create({
      data: { licenseId: fx.a.licenseId, kind: 'ai_agent', name: 'Ada', active: true },
    });
    teamA = (await owner.group.create({ data: { licenseId: fx.a.licenseId, name: 'Finans' } })).id;
    teamB = (await owner.group.create({ data: { licenseId: fx.a.licenseId, name: 'VIP' } })).id;
  });

  async function member(
    role: 'admin' | 'team_lead' | 'agent',
    teams: bigint[] = [],
    leads: bigint[] = [],
    t: TenantFixture = fx.a,
  ): Promise<{ accountId: string; auth: Headers }> {
    seq += 1;
    const account = await owner.account.create({
      data: { email: `qa-${role}-${seq}-${Date.now()}@example.test`, name: `Üye ${role} ${seq}` },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: t.licenseId, agentId: account.id, role },
    });
    for (const groupId of teams) {
      await owner.groupAgent.create({
        data: {
          licenseId: t.licenseId,
          groupId,
          agentId: account.id,
          isLead: leads.includes(groupId),
        },
      });
    }
    const token = await grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: account.id,
      scopes: [...DEFAULT_AGENT_SCOPES, 'agents-bot--all:rw', 'chats--all:rw'].filter(
        (scope) =>
          role === 'admin' || (!scope.startsWith('chats--all') && scope !== 'agents-bot--all:rw'),
      ),
    });
    return { accountId: account.id, auth: { authorization: `Bearer ${token}` } };
  }

  /**
   * A closed AI connection of team `groupId`: the player, the AI, and (unless
   * `agentId` is null) an agent's reply — `[player, ai, agent?]` event ids.
   */
  async function conversation(
    groupId: bigint,
    options: { agentId?: string | null; active?: boolean; ai?: boolean; closedAt?: Date } = {},
  ) {
    const t = fx.a;
    const chatId = generateShortId();
    const threadId = generateShortId();
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name: 'Ali Veli' },
      select: { id: true },
    });
    const active = options.active ?? false;
    const closedAt = active ? null : (options.closedAt ?? new Date(Date.now() - 3_600_000));
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: customer.id, active },
    });
    await owner.thread.create({
      data: { id: threadId, chatId, licenseId: t.licenseId, groupId, active, closedAt },
    });
    await owner.chatAccess.create({ data: { chatId, groupId } });
    const lines: Array<{ authorType: string; authorId: string; text: string }> = [
      {
        authorType: 'customer',
        authorId: customer.id,
        text: 'Hesabımı kapatın, kartım 4111 1111 1111 1111',
      },
      ...(options.ai === false
        ? []
        : [{ authorType: 'bot', authorId: AI_BOT_ID, text: 'Bonusunuzu kullanmaya devam edin!' }]),
      ...(options.agentId === null
        ? []
        : [
            {
              authorType: 'agent',
              authorId: options.agentId ?? t.agentAccountId,
              text: 'Merhaba.',
            },
          ]),
    ];
    const ids: string[] = [];
    for (const [index, line] of lines.entries()) {
      const id = buildEventId(threadId, index + 1);
      ids.push(id);
      await owner.event.create({
        data: {
          id,
          threadId,
          chatId,
          licenseId: t.licenseId,
          type: 'message',
          recipients: 'all',
          createdAt: new Date((closedAt?.getTime() ?? Date.now()) - 60_000 + index * 1000),
          ...line,
        },
      });
    }
    return { chatId, threadId, ids };
  }

  const prescorer = (llm: LlmProvider = new MockLlmProvider()) =>
    new QaPrescorer(app, { llm, limits: LIMITS, inference: resolveInferenceProvider(testEnv()) });

  /** Queued by an administrator by hand, then pre-scored by the stub: `ready`. */
  async function queued(
    admin: Headers,
    at: { chatId: string; threadId: string },
    prescore = true,
  ): Promise<ReviewBody> {
    const made = await server.post(
      '/qa/reviews',
      { chat_id: at.chatId, thread_id: at.threadId },
      admin,
    );
    expect(made.statusCode, made.body).toBe(201);
    const body = made.json() as ReviewBody;
    if (prescore) await prescorer().run();
    return body;
  }

  const read = async (auth: Headers, id: string) => {
    const response = await server.get(`/qa/reviews/${id}`, auth);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as ReviewBody;
  };
  const claim = (auth: Headers, id: string) => server.post(`/qa/reviews/${id}/claim`, {}, auth);
  const put = (auth: Headers, id: string, body: Json) =>
    server.put(`/qa/reviews/${id}`, body, auth);

  it('pre-scores with this conversation’s events only; a foreign citation drops it, a failing model leaves it ready without one (AI-24 KK 3)', async () => {
    const admin = await member('admin');
    const first = await conversation(teamA);
    const review = await queued(admin.auth, first, false);
    expect(review.status).toBe('pending_prescore');
    const report = await prescorer().run();
    expect(report.totals).toMatchObject({ scored: 1, dropped: 0, failed: 0 });
    const scored = await read(admin.auth, review.id);
    expect(scored.status).toBe('ready');
    expect(scored.prescore?.criteria).toHaveLength(PLATFORM_QA_RUBRIC.length);
    for (const criterion of scored.prescore!.criteria) {
      for (const id of criterion.evidence_event_ids) expect(first.ids).toContain(id);
    }

    // A model citing another conversation's message: the whole pre-score goes.
    const other = await conversation(teamA);
    const second = await conversation(teamA);
    const foreign: LlmProvider = {
      id: 'mock',
      async complete(request) {
        const reply = mockQaPrescore(readQaPrescoreGrounding(request.system)!);
        reply.criteria[0]!.evidence_event_ids = [other.ids[1]!];
        return { text: JSON.stringify(reply), usage: { inputTokens: 0, outputTokens: 0 } };
      },
    };
    const dropped = await queued(admin.auth, second, false);
    expect((await prescorer(foreign).run()).totals).toMatchObject({ dropped: 1, scored: 0 });
    expect(await read(admin.auth, dropped.id)).toMatchObject({
      status: 'ready',
      prescored: false,
      prescore: null,
    });

    // A model that fails: ready, without a pre-score.
    const third = await conversation(teamA);
    const failing = await queued(admin.auth, third, false);
    const broken: LlmProvider = {
      id: 'mock',
      async complete() {
        throw new Error('provider down');
      },
    };
    expect((await prescorer(broken).run()).totals).toMatchObject({ failed: 1 });
    expect(await read(admin.auth, failing.id)).toMatchObject({ status: 'ready', prescore: null });

    // Switched off: released without asking the model.
    expect(
      (await server.put('/qa/settings', { prescore_enabled: false }, admin.auth)).statusCode,
    ).toBe(200);
    const fourth = await conversation(teamA);
    const made = await server.post(
      '/qa/reviews',
      { chat_id: fourth.chatId, thread_id: fourth.threadId },
      admin.auth,
    );
    expect((made.json() as ReviewBody).status).toBe('ready');
  });

  it('completes only with every critical criterion confirmed; a critical failure opens an AI-23 suggestion and an AI-19 scenario draft and mails the administrators (AI-24 KK 4–5)', async () => {
    const admin = await member('admin');
    const lead = await member('team_lead', [teamA], [teamA]);
    const at = await conversation(teamA);
    const review = await queued(admin.auth, at);

    // Not claimed yet: nothing to score.
    expect((await put(lead.auth, review.id, { action: 'save' })).statusCode).toBe(409);
    const claimed = await claim(lead.auth, review.id);
    expect(claimed.statusCode, claimed.body).toBe(200);
    expect((claimed.json() as ReviewBody).status).toBe('in_review');

    // The pre-score filled nothing in: the critical criteria are unconfirmed.
    const unconfirmed = await put(lead.auth, review.id, {
      action: 'complete',
      scores: scores({}, false),
      final: 'pass',
    });
    expect(unconfirmed.statusCode, unconfirmed.body).toBe(400);
    expect(unconfirmed.json()).toMatchObject({
      error: {
        details: {
          problems: [
            { field: 'scores.guardrails.confirmed', code: 'unconfirmed' },
            { field: 'scores.handoff_timing.confirmed', code: 'unconfirmed' },
          ],
        },
      },
    });

    // A failed critical criterion cannot be a pass.
    const failing = scores({ handoff_timing: { value: 'fail', confirmed: true } });
    const contradicts = await put(lead.auth, review.id, {
      action: 'complete',
      scores: failing,
      final: 'pass',
    });
    expect(contradicts.statusCode).toBe(400);

    // Saved in between: still in review, the values kept.
    expect(
      (
        await put(lead.auth, review.id, {
          action: 'save',
          scores: failing,
          comments: 'Devretmedi.',
        })
      ).statusCode,
    ).toBe(200);

    const done = await put(lead.auth, review.id, { action: 'complete', final: 'fail' });
    expect(done.statusCode, done.body).toBe(200);
    const body = done.json() as ReviewBody;
    expect(body).toMatchObject({ status: 'completed', final: 'fail', critical_fail: true });
    expect(body.follow_ups.mandatory_handoff_violation).toBe(true);
    expect(body.follow_ups.suggestion_id).not.toBeNull();
    expect(body.follow_ups.scenario_id).not.toBeNull();

    const suggestion = await owner.aiSuggestion.findUniqueOrThrow({
      where: { id: body.follow_ups.suggestion_id! },
    });
    expect(suggestion).toMatchObject({
      source: 'qa_finding',
      kind: 'should_have_handed_off',
      status: 'new',
      teamId: teamA,
      threadId: at.threadId,
      createdBy: lead.accountId,
    });
    const scenario = await owner.aiTestScenario.findUniqueOrThrow({
      where: { id: body.follow_ups.scenario_id! },
    });
    expect(scenario).toMatchObject({ origin: 'from_qa', originRef: review.id, active: false });
    expect(JSON.stringify(scenario.turns)).not.toContain('4111 1111 1111 1111');
    expect(scenario.expectations).toMatchObject({ outcome: 'handoff' });

    // The administrators are mailed — the owner among them, nobody's words in it.
    await server.app.backgroundMail.settled();
    const mails = (await mailer.outbox()).filter(
      (m) => m.subject.includes('hand-over') || m.subject.includes('devir'),
    );
    expect(mails.map((m) => m.to)).toEqual(expect.arrayContaining([expect.stringContaining('@')]));
    for (const mail of mails) expect(mail.body).not.toContain('4111');

    // Completed is final.
    expect((await put(lead.auth, review.id, { action: 'save' })).statusCode).toBe(409);
    expect((await claim(admin.auth, review.id)).statusCode).toBe(409);
  });

  it('a Team Lead sees, claims and scores the teams they lead and no other; a member none (AI-24 KK 6)', async () => {
    const admin = await member('admin');
    const leadA = await member('team_lead', [teamA], [teamA]);
    const agent = await member('agent', [teamA]);
    const inA = await queued(admin.auth, await conversation(teamA));
    const inB = await queued(admin.auth, await conversation(teamB));

    const listA = await server.get('/qa/reviews', leadA.auth);
    expect(listA.statusCode, listA.body).toBe(200);
    expect(
      (listA.json() as { reviews: ReviewBody[]; open_count: number }).reviews.map((r) => r.id),
    ).toEqual([inA.id]);
    expect((await server.get(`/qa/reviews/${inB.id}`, leadA.auth)).statusCode).toBe(404);
    expect((await claim(leadA.auth, inB.id)).statusCode).toBe(404);
    expect((await put(leadA.auth, inB.id, { action: 'save' })).statusCode).toBe(404);

    const all = (await server.get('/qa/reviews', admin.auth)).json() as { reviews: ReviewBody[] };
    expect(all.reviews.map((r) => r.id).sort()).toEqual([inA.id, inB.id].sort());

    const refused = await server.get('/qa/reviews', agent.auth);
    expect(refused.statusCode).toBe(403);
    expect((await server.get('/qa/summary', agent.auth)).statusCode).toBe(403);
  });

  it('one reviewer at a time; whoever took the conversation over may not review it; a release puts it back', async () => {
    const admin = await member('admin');
    const leadA = await member('team_lead', [teamA], [teamA]);
    const leadA2 = await member('team_lead', [teamA], [teamA]);
    const review = await queued(admin.auth, await conversation(teamA));

    expect((await claim(leadA.auth, review.id)).statusCode).toBe(200);
    expect((await claim(leadA.auth, review.id)).statusCode).toBe(200);
    const taken = await claim(leadA2.auth, review.id);
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({
      error: { type: 'qa_review_state', details: { reason: 'claimed' } },
    });
    expect((await put(leadA2.auth, review.id, { action: 'save' })).statusCode).toBe(409);
    expect((await put(leadA.auth, review.id, { action: 'release' })).statusCode).toBe(200);
    expect((await claim(leadA2.auth, review.id)).statusCode).toBe(200);

    // The lead answered the player in this conversation.
    const own = await queued(admin.auth, await conversation(teamA, { agentId: leadA.accountId }));
    const conflict = await claim(leadA.auth, own.id);
    expect(conflict.statusCode).toBe(403);
    expect(conflict.json()).toMatchObject({
      error: { details: { reason: 'conflict_of_interest' } },
    });
    // With the check off, they may.
    await server.put('/qa/settings', { conflict_check: false }, admin.auth);
    expect((await claim(leadA.auth, own.id)).statusCode).toBe(200);
  });

  it('"QA\'ya gönder" merges into a queued review, never a completed one; an open or AI-less connection is refused', async () => {
    const admin = await member('admin');
    const lead = await member('team_lead', [teamA], [teamA]);
    const at = await conversation(teamA);
    const first = await server.post(
      '/qa/reviews',
      { chat_id: at.chatId, thread_id: at.threadId, note: 'Kart 4111 1111 1111 1111 yazdı' },
      lead.auth,
    );
    expect(first.statusCode, first.body).toBe(201);
    const body = first.json() as ReviewBody & { comments: string };
    expect(body.reasons).toEqual(['manual']);
    expect(body.team_id).toBe(Number(teamA));
    expect(body.comments).not.toContain('4111 1111 1111 1111');
    // A second send changes nothing but stays one review.
    const again = await server.post(
      '/qa/reviews',
      { chat_id: at.chatId, thread_id: at.threadId },
      lead.auth,
    );
    expect((again.json() as ReviewBody).id).toBe(body.id);

    const open = await conversation(teamA, { active: true });
    expect(
      (
        await server.post(
          '/qa/reviews',
          { chat_id: open.chatId, thread_id: open.threadId },
          lead.auth,
        )
      ).statusCode,
    ).toBe(400);
    const human = await conversation(teamA, { ai: false });
    expect(
      (
        await server.post(
          '/qa/reviews',
          { chat_id: human.chatId, thread_id: human.threadId },
          lead.auth,
        )
      ).statusCode,
    ).toBe(400);
    const elsewhere = await conversation(teamB);
    expect(
      (
        await server.post(
          '/qa/reviews',
          { chat_id: elsewhere.chatId, thread_id: elsewhere.threadId },
          lead.auth,
        )
      ).statusCode,
    ).toBe(404);

    // Completed: a later send is refused.
    await prescorer().run();
    await claim(admin.auth, body.id);
    expect(
      (await put(admin.auth, body.id, { action: 'complete', scores: scores(), final: 'pass' }))
        .statusCode,
    ).toBe(200);
    const late = await server.post(
      '/qa/reviews',
      { chat_id: at.chatId, thread_id: at.threadId },
      admin.auth,
    );
    expect(late.statusCode).toBe(409);
    expect(late.json()).toMatchObject({ error: { details: { reason: 'completed' } } });
  });

  it('keeps a responsible-gaming conversation’s text to the administrators and the RG team', async () => {
    const admin = await member('admin');
    const lead = await member('team_lead', [teamA], [teamA]);
    const at = await conversation(teamA);
    await owner.aiHandoff.create({
      data: {
        id: randomUUID(),
        licenseId: fx.a.licenseId,
        chatId: at.chatId,
        threadId: at.threadId,
        summary: 'Oyuncu kendini sınırlamak istiyor.',
        reasonCodes: ['guardrail_rg'],
        primaryReason: 'guardrail_rg',
        priority: 'normal',
        cardText: 'Devir kartı',
      },
    });
    const review = await queued(admin.auth, at);
    const asLead = await read(lead.auth, review.id);
    expect(asLead.excerpt_restricted).toBe(true);
    expect(asLead.excerpt.every((m) => m.text === '')).toBe(true);
    expect(asLead.excerpt.map((m) => m.event_id)).toEqual(at.ids);
    expect(asLead.trace.handoffs).toHaveLength(1);
    const asAdmin = await read(admin.auth, review.id);
    expect(asAdmin.excerpt_restricted).toBe(false);
    expect(asAdmin.excerpt[0]!.text.length).toBeGreaterThan(0);

    // The lead joins the Responsible Gaming team: they read it.
    await owner.riskFlagSettings.upsert({
      where: { licenseId: fx.a.licenseId },
      create: { licenseId: fx.a.licenseId, rgGroupId: teamB },
      update: { rgGroupId: teamB },
    });
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: teamB, agentId: lead.accountId },
    });
    expect((await read(lead.auth, review.id)).excerpt_restricted).toBe(false);
  });

  it('settings and rubric: an administrator changes them, the platform’s critical criteria stay', async () => {
    const admin = await member('admin');
    const lead = await member('team_lead', [teamA], [teamA]);
    const defaults = await server.get('/qa/settings', admin.auth);
    expect(defaults.json()).toMatchObject({
      sample_percent: 5,
      prescore_enabled: true,
      conflict_check: true,
    });
    expect((await server.put('/qa/settings', { sample_percent: 21 }, admin.auth)).statusCode).toBe(
      400,
    );
    expect((await server.put('/qa/settings', { sample_percent: 10 }, lead.auth)).statusCode).toBe(
      403,
    );
    const saved = await server.put('/qa/settings', { sample_percent: 10 }, admin.auth);
    expect(saved.json()).toMatchObject({ sample_percent: 10, prescore_enabled: true });

    const rubric = (await server.get('/qa/rubric', admin.auth)).json() as {
      version: number;
      criteria: Json[];
    };
    expect(rubric.version).toBe(1);
    const withoutGuardrails = rubric.criteria.filter((c) => c['key'] !== 'guardrails');
    expect(
      (await server.put('/qa/rubric', { criteria: withoutGuardrails }, admin.auth)).statusCode,
    ).toBe(400);
    const extended = [
      ...rubric.criteria,
      {
        key: 'empathy',
        label: 'Empati',
        type: 'score_1_5',
        weight: 1,
        critical: false,
        locked: false,
      },
    ];
    const next = await server.put('/qa/rubric', { criteria: extended }, admin.auth);
    expect(next.statusCode, next.body).toBe(200);
    expect(next.json()).toMatchObject({ version: 2 });
    expect(await owner.qaRubric.count({ where: { licenseId: fx.a.licenseId, active: true } })).toBe(
      1,
    );
  });

  it('the summary carries QA’s verdicts to AI-25: mandatory hand-overs missed, guardrail breaches confirmed, false resolutions (AI-24 KK 7)', async () => {
    const admin = await member('admin');
    const at = await conversation(teamA);
    await owner.aiConversation.create({
      data: {
        licenseId: fx.a.licenseId,
        chatId: at.chatId,
        threadId: at.threadId,
        outcome: 'resolved',
      },
    });
    const review = await queued(admin.auth, at);
    await claim(admin.auth, review.id);
    const done = await put(admin.auth, review.id, {
      action: 'complete',
      scores: scores({
        guardrails: { value: 'fail', confirmed: true },
        handoff_timing: { value: 'fail', confirmed: true },
      }),
      final: 'fail',
    });
    expect(done.statusCode, done.body).toBe(200);
    const summary = await server.get('/qa/summary', admin.auth);
    expect(summary.statusCode, summary.body).toBe(200);
    expect(summary.json()).toMatchObject({
      completed: 1,
      failed: 1,
      critical_failed: 1,
      by_reason: { manual: 1 },
      criteria_failed: { guardrails: 1, handoff_timing: 1 },
      mandatory_handoff: { violations: 1 },
      guardrail_violations_confirmed: 1,
      false_resolutions: 1,
    });
  });

  it('the weekly consistency job queues a group the AI answered two ways, as a pair, once', async () => {
    const lastWeek = new Date(Date.now() - 7 * 86_400_000);
    const procedure = randomUUID();
    const settled = await conversation(teamA, { closedAt: lastWeek, agentId: null });
    const handedOver = await conversation(teamA, { closedAt: lastWeek, agentId: null });
    const alone = await conversation(teamA, { closedAt: lastWeek, agentId: null });
    for (const [at, outcome, proc] of [
      [settled, 'resolved', procedure],
      [handedOver, 'handed_off', procedure],
      [alone, 'resolved', randomUUID()],
    ] as const) {
      await owner.aiConversation.create({
        data: {
          licenseId: fx.a.licenseId,
          chatId: at.chatId,
          threadId: at.threadId,
          outcome,
          slots: { method: 'papara' },
        },
      });
      await owner.aiDecisionLog.create({
        data: {
          licenseId: fx.a.licenseId,
          chatId: at.chatId,
          threadId: at.threadId,
          decision: 'answered',
          procedureId: proc,
        },
      });
    }
    const first = await new QaConsistency(app).run();
    expect(first.totals).toMatchObject({ pairs: 1, queued: 2 });
    const queuedRows = await owner.qaReview.findMany({ where: { licenseId: fx.a.licenseId } });
    expect(queuedRows.map((r) => r.threadId).sort()).toEqual(
      [settled.threadId, handedOver.threadId].sort(),
    );
    expect(queuedRows.every((r) => r.reasons.includes('consistency'))).toBe(true);
    const again = await new QaConsistency(app).run();
    expect(again.totals).toMatchObject({ pairs: 1, queued: 0 });
  });

  it('a calibration round shows per criterion how far the leads agreed (AI-24 KK 8)', async () => {
    const admin = await member('admin');
    const leadA = await member('team_lead', [teamA], [teamA]);
    const leadB = await member('team_lead', [teamB], [teamB]);
    expect((await server.post('/qa/calibrations', {}, admin.auth)).statusCode).toBe(400);
    const one = await queued(admin.auth, await conversation(teamA));
    const two = await queued(admin.auth, await conversation(teamB));
    for (const review of [one, two]) {
      await claim(admin.auth, review.id);
      await put(admin.auth, review.id, { action: 'complete', scores: scores(), final: 'pass' });
    }
    expect((await server.post('/qa/calibrations', {}, leadA.auth)).statusCode).toBe(403);
    const opened = await server.post('/qa/calibrations', {}, admin.auth);
    expect(opened.statusCode, opened.body).toBe(201);
    const round = opened.json() as { id: string; reviews: number };
    expect(round.reviews).toBe(2);
    expect((await server.post('/qa/calibrations', {}, admin.auth)).statusCode).toBe(409);

    const score = (auth: Headers, reviewId: string, body: Json) =>
      server.post(`/qa/calibrations/${round.id}/scores`, { review_id: reviewId, ...body }, auth);
    // The calibration's rule is the review's: critical criteria confirmed.
    expect(
      (await score(leadA.auth, one.id, { scores: scores({}, false), final: 'pass' })).statusCode,
    ).toBe(400);
    for (const reviewId of [one.id, two.id]) {
      expect(
        (await score(leadA.auth, reviewId, { scores: scores(), final: 'pass' })).statusCode,
      ).toBe(200);
      expect(
        (await score(admin.auth, reviewId, { scores: scores(), final: 'pass' })).statusCode,
      ).toBe(200);
    }
    // Lead B sees the other team's conversation here — and disagrees on tone in one.
    expect(
      (await score(leadB.auth, one.id, { scores: scores({ tone: { value: 2 } }), final: 'pass' }))
        .statusCode,
    ).toBe(200);

    const asLead = (await server.get(`/qa/calibrations/${round.id}`, leadA.auth)).json() as Json;
    expect(asLead['report']).toBeNull();
    const asAdmin = (await server.get(`/qa/calibrations/${round.id}`, admin.auth)).json() as {
      report: { criteria: Array<{ key: string; agreement_percent: number }> };
    };
    const agreement = Object.fromEntries(
      asAdmin.report.criteria.map((c) => [c.key, c.agreement_percent]),
    );
    expect(agreement['topic']).toBe(100);
    // tone: one 2 of 3 + two 2 of 2 → 4/5 = 80 %.
    expect(agreement['tone']).toBe(80);

    const closed = await server.post(`/qa/calibrations/${round.id}/close`, {}, admin.auth);
    expect(closed.statusCode).toBe(200);
    const afterClose = (
      await server.get(`/qa/calibrations/${round.id}`, leadA.auth)
    ).json() as Json;
    expect(afterClose['report']).not.toBeNull();
    const late = await score(leadA.auth, one.id, { scores: scores(), final: 'pass' });
    expect(late.json()).toMatchObject({ error: { details: { reason: 'calibration_closed' } } });
  });

  it('keeps a workspace to its own reviews (NFR-S4)', async () => {
    const admin = await member('admin');
    const review = await queued(admin.auth, await conversation(teamA));
    const other = await member('admin', [], [], fx.b);
    expect((await server.get(`/qa/reviews/${review.id}`, other.auth)).statusCode).toBe(404);
    expect(((await server.get('/qa/reviews', other.auth)).json() as { total: number }).total).toBe(
      0,
    );
  });
});
