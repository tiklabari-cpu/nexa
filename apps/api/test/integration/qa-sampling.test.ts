/**
 * The QA sampler (tm 319.1 · SiyahTuş analysis AI-24 §2) against a real
 * database, run as the API's role (RLS on):
 *
 *   - **When.** Before 02:00 on the workspace's clock the previous day is not
 *     sampled; after it, it is — once: the next pass finds the day marked.
 *   - **What.** Every connection in a mandatory category is queued whatever
 *     the draw (a risk flag, the player's bad rating of the AI's own
 *     connection, a repeat contact within 72 hours, a guardrail on the AI's
 *     draft, a compliance hand-over, an insufficient hand-over card); a
 *     connection without the AI, with a rule bot only, still open, or closed
 *     another day is not. `random` is exactly the hash draw.
 *   - **How.** Reasons merge into a review already in the queue, never into a
 *     completed one; priority and due date follow the reasons (risk: two
 *     business days); the excerpt is masked and stops after the third agent
 *     message; the rubric is the platform's version 1.
 *   - **The rate.** 1,000 AI connections at 5 % queue the connections the
 *     draw picks — about 50 — and sampling the day again picks the same list.
 *   - **The tables.** The CHECKs are `@siyahtus/types`' lists; RLS keeps a
 *     workspace to its rows; another workspace's agent is refused; retention
 *     taking the connection leaves the review.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AI_BOT_ID,
  PLATFORM_QA_RUBRIC,
  QA_FINALS,
  QA_REASONS,
  QA_REVIEW_STATUSES,
  buildEventId,
  generateShortId,
} from '@siyahtus/types';
import { withTenant, type TenantClient, type TenantContext } from '../../src/lib/tenant.js';
import { QaSampler, qaDueAt, qaSampledAtRandom } from '../../src/services/qa/sampler.js';
import {
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';

const TZ = 'Europe/Istanbul';
/** 2026-10-19 on the workspace's clock (UTC+3): [10-18 21:00Z, 10-19 21:00Z). */
const DAY = '2026-10-19';
const DAY_NOON = Date.parse('2026-10-19T09:00:00.000Z');
/** 01:30 on 10-20 in Istanbul: the 19th is over, but it is not 02:00 yet. */
const BEFORE_TWO = new Date('2026-10-19T22:30:00.000Z');
/** 02:30 on Tuesday 10-20 in Istanbul. */
const AFTER_TWO = new Date('2026-10-19T23:30:00.000Z');

type Line = { by: 'customer' | 'ai' | 'agent' | 'rule_bot'; text: string };

describe('the QA sampler (tm 319.1 · AI-24)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;
  let aiAgentA: string;

  const tenant = (t: TenantFixture): TenantContext => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });
  const asTenant = <T>(t: TenantFixture, fn: (tx: TenantClient) => Promise<T>) =>
    withTenant(app, tenant(t), fn);

  beforeAll(() => {
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: process.env['DATABASE_APP_URL'] });
  });

  afterAll(async () => {
    await app.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    aiAgentA = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, kind: 'ai_agent', name: 'Ada', active: true },
        select: { id: true },
      })
    ).id;
  });

  let seq = 0;

  /**
   * A closed connection of `t` with `lines`, closed `closedAt` (default: the
   * sampled day, `seq` minutes past its noon). `ai` lines are the AI's own
   * messages; `aiConversation` adds the AI's conversation row without one.
   */
  async function connection(
    t: TenantFixture,
    lines: Line[],
    options: {
      customerId?: string;
      closedAt?: Date | null;
      createdAt?: Date;
      riskFlags?: string[];
      aiConversation?: boolean;
      groupId?: bigint;
    } = {},
  ) {
    seq += 1;
    const customerId =
      options.customerId ??
      (
        await owner.customer.create({
          data: { organizationId: t.organizationId, name: `Oyuncu ${seq}` },
          select: { id: true },
        })
      ).id;
    const closedAt =
      options.closedAt === undefined ? new Date(DAY_NOON + seq * 60_000) : options.closedAt;
    const createdAt = options.createdAt ?? new Date((closedAt?.getTime() ?? DAY_NOON) - 600_000);
    const chatId = generateShortId();
    const threadId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId, active: closedAt === null },
    });
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: t.licenseId,
        active: closedAt === null,
        closedAt,
        createdAt,
        groupId: options.groupId ?? null,
        riskFlagTypes: options.riskFlags ?? [],
      },
    });
    if (options.aiConversation) {
      await owner.aiConversation.create({ data: { licenseId: t.licenseId, chatId, threadId } });
    }
    const ids: string[] = [];
    for (const [index, line] of lines.entries()) {
      const id = buildEventId(threadId, index + 1);
      ids.push(id);
      const author =
        line.by === 'customer'
          ? { authorType: 'customer', authorId: customerId }
          : line.by === 'ai'
            ? { authorType: 'bot', authorId: AI_BOT_ID }
            : line.by === 'rule_bot'
              ? { authorType: 'bot', authorId: 'rule-bot' }
              : { authorType: 'agent', authorId: t.agentAccountId };
      await owner.event.create({
        data: {
          id,
          threadId,
          chatId,
          licenseId: t.licenseId,
          type: 'message',
          recipients: 'all',
          text: line.text,
          createdAt: new Date(createdAt.getTime() + (index + 1) * 1000),
          ...author,
        },
      });
    }
    return { chatId, threadId, customerId, ids };
  }

  const aiLines: Line[] = [
    { by: 'customer', text: 'Çekimim ne zaman gelir?' },
    { by: 'ai', text: 'Çekimler 24 saat içinde işlenir.' },
  ];

  async function handoff(
    t: TenantFixture,
    at: { chatId: string; threadId: string },
    reasons: string[],
    feedback?: 'insufficient',
  ) {
    const id = randomUUID();
    await owner.aiHandoff.create({
      data: {
        id,
        licenseId: t.licenseId,
        chatId: at.chatId,
        threadId: at.threadId,
        summary: 'Oyuncu çekim soruyor.',
        reasonCodes: reasons,
        primaryReason: reasons[0]!,
        priority: 'normal',
        cardText: 'Devir kartı',
      },
    });
    // A card is written unjudged; the agent's verdict comes after.
    if (feedback) {
      await owner.aiHandoff.update({
        where: { id },
        data: { feedback, feedbackBy: t.agentAccountId, feedbackAt: new Date(DAY_NOON) },
      });
    }
  }

  const reviewOf = (threadId: string) =>
    owner.qaReview.findFirst({ where: { threadId } }).then((row) => row!);

  it('samples the previous day at 02:00 on the workspace clock, once, with every mandatory category and the exact draw (AI-24 KK 1–2)', async () => {
    const plain = await connection(fx.a, aiLines);
    const risk = await connection(
      fx.a,
      [
        { by: 'customer', text: 'Kartım 4111 1111 1111 1111, hesabımı kapatın.' },
        { by: 'ai', text: 'Sizi bir temsilciye aktarıyorum.' },
        { by: 'agent', text: 'Merhaba, ben Ayşe.' },
        { by: 'customer', text: 'Kendimi sınırlamak istiyorum.' },
        { by: 'agent', text: 'Hemen yardımcı oluyorum.' },
        { by: 'agent', text: 'Hesabınız kapatıldı.' },
        { by: 'agent', text: 'Başka bir şey var mı?' },
      ],
      { riskFlags: ['self_exclusion_request'] },
    );
    const badAi = await connection(fx.a, aiLines);
    await owner.rating.create({
      data: {
        chatId: badAi.chatId,
        threadId: badAi.threadId,
        licenseId: fx.a.licenseId,
        value: 'bad',
      },
    });
    // A bad rating once a person answered is not the AI's (BSAT).
    const badHuman = await connection(fx.a, [
      ...aiLines,
      { by: 'agent', text: 'Kontrol ediyorum.' },
    ]);
    await owner.rating.create({
      data: {
        chatId: badHuman.chatId,
        threadId: badHuman.threadId,
        licenseId: fx.a.licenseId,
        value: 'bad',
      },
    });
    // The player's earlier AI connection closed 10 hours before this one began.
    const first = await connection(fx.a, aiLines, {
      closedAt: new Date(DAY_NOON - 12 * 3_600_000),
    });
    const repeat = await connection(fx.a, aiLines, {
      customerId: first.customerId,
      createdAt: new Date(DAY_NOON - 2 * 3_600_000),
    });
    const guardrail = await connection(fx.a, aiLines);
    await owner.aiGuardrailHit.create({
      data: {
        licenseId: fx.a.licenseId,
        chatId: guardrail.chatId,
        threadId: guardrail.threadId,
        turnId: randomUUID(),
        ruleKey: 'G4',
        stage: 'output',
        actionTaken: 'rewrite',
        catalogVersion: '1',
      },
    });
    // An input-stage hand-over hit is the compliance hand-over's, not a scan.
    const mandatory = await connection(fx.a, [{ by: 'customer', text: 'Kumar bağımlısıyım.' }], {
      aiConversation: true,
    });
    await owner.aiGuardrailHit.create({
      data: {
        licenseId: fx.a.licenseId,
        chatId: mandatory.chatId,
        threadId: mandatory.threadId,
        turnId: randomUUID(),
        ruleKey: 'G1',
        stage: 'input',
        actionTaken: 'handoff',
        catalogVersion: '1',
      },
    });
    await handoff(fx.a, mandatory, ['guardrail_rg']);
    const insufficient = await connection(fx.a, aiLines);
    await handoff(fx.a, insufficient, ['no_knowledge'], 'insufficient');
    // Not the AI's, not closed, or not that day.
    const noAi = await connection(fx.a, [{ by: 'agent', text: 'Merhaba' }], {
      riskFlags: ['fraud_suspected'],
    });
    const ruleBot = await connection(fx.a, [{ by: 'rule_bot', text: 'Menü' }], {
      riskFlags: ['fraud_suspected'],
    });
    const open = await connection(fx.a, aiLines, { closedAt: null, riskFlags: ['rg_signal'] });
    const dayBefore = await connection(fx.a, aiLines, {
      closedAt: new Date(DAY_NOON - 24 * 3_600_000),
      riskFlags: ['rg_signal'],
    });
    // Already queued by hand, and already reviewed.
    const rubric = await owner.qaRubric.create({
      data: {
        id: randomUUID(),
        licenseId: fx.a.licenseId,
        version: 1,
        criteria: PLATFORM_QA_RUBRIC as never,
        active: true,
      },
    });
    const manual = await connection(fx.a, aiLines, { riskFlags: ['rg_signal'] });
    const done = await connection(fx.a, aiLines, { riskFlags: ['rg_signal'] });
    const handDue = new Date('2026-10-30T00:00:00.000Z');
    for (const [at, status] of [
      [manual, 'ready'],
      [done, 'completed'],
    ] as const) {
      await owner.qaReview.create({
        data: {
          id: randomUUID(),
          licenseId: fx.a.licenseId,
          chatId: at.chatId,
          threadId: at.threadId,
          aiAgentId: aiAgentA,
          reasons: ['manual'],
          status,
          dueAt: handDue,
          rubricId: rubric.id,
          ...(status === 'completed' ? { final: 'pass', reviewedAt: new Date(DAY_NOON) } : {}),
        },
      });
    }

    const sampler = new QaSampler(app);
    // 01:30: the 19th is not due — the three days before it are, and the
    // 18th holds the connection that closed then.
    const early = await sampler.run({ now: BEFORE_TWO });
    const earlyA = early.tenants.find((r) => r.licenseId === fx.a.licenseId.toString())!;
    expect(earlyA.days.map((d) => d.day)).toEqual(['2026-10-16', '2026-10-17', '2026-10-18']);
    expect(await owner.qaReview.count({ where: { sampleDay: new Date(`${DAY}T00:00:00Z`) } })).toBe(
      0,
    );
    const before = await reviewOf(dayBefore.threadId);
    expect(before.reasons).toContain('risk_flag');
    expect(before.sampleDay?.toISOString().slice(0, 10)).toBe('2026-10-18');

    // 02:30: the 19th, and only it.
    const report = await sampler.run({ now: AFTER_TWO });
    const dayA = report.tenants.find((r) => r.licenseId === fx.a.licenseId.toString())!.days;
    expect(dayA.map((d) => [d.day, d.sampled])).toEqual([[DAY, true]]);

    const drawn = (threadId: string) =>
      qaSampledAtRandom(fx.a.licenseId, DAY, threadId, 5) ? (['random'] as const) : [];
    const expected: Array<[{ threadId: string }, string[]]> = [
      [risk, [...drawn(risk.threadId), 'risk_flag']],
      [badAi, [...drawn(badAi.threadId), 'low_bsat']],
      [repeat, [...drawn(repeat.threadId), 'repeat_72h']],
      [guardrail, [...drawn(guardrail.threadId), 'guardrail_scan']],
      [mandatory, [...drawn(mandatory.threadId), 'mandatory_handoff']],
      [insufficient, [...drawn(insufficient.threadId), 'handoff_insufficient']],
    ];
    for (const [at, reasons] of expected) {
      expect((await reviewOf(at.threadId)).reasons, at.threadId).toEqual(reasons);
    }
    for (const at of [plain, badHuman, first]) {
      const row = await owner.qaReview.findFirst({ where: { threadId: at.threadId } });
      expect(row?.reasons ?? [], at.threadId).toEqual([...drawn(at.threadId)]);
    }
    for (const at of [noAi, ruleBot, open]) {
      expect(await owner.qaReview.count({ where: { threadId: at.threadId } })).toBe(0);
    }

    // Merged into the hand-added review; the completed one is left as it was.
    const merged = await reviewOf(manual.threadId);
    expect(merged.reasons).toEqual([...drawn(manual.threadId), 'risk_flag', 'manual']);
    expect(merged.priority).toBe(2);
    expect(merged.status).toBe('ready');
    const kept = await reviewOf(done.threadId);
    expect(kept.reasons).toEqual(['manual']);
    expect(kept.priority).toBe(0);

    // Priority, due date, status, rubric, the connection's labels.
    const riskRow = await reviewOf(risk.threadId);
    expect(riskRow).toMatchObject({
      priority: 2,
      status: 'pending_prescore',
      aiAgentId: aiAgentA,
      rubricId: rubric.id,
      chatId: risk.chatId,
    });
    // Tuesday 02:30 + two business days = Thursday 02:30, Istanbul.
    expect(riskRow.dueAt.toISOString()).toBe('2026-10-21T23:30:00.000Z');
    expect(riskRow.dueAt).toEqual(qaDueAt(AFTER_TWO, 'risk', TZ));
    expect((await reviewOf(guardrail.threadId)).priority).toBe(1);
    expect((await reviewOf(mandatory.threadId)).priority).toBe(1);
    const badRow = await reviewOf(badAi.threadId);
    expect(badRow.priority).toBe(0);
    expect(badRow.dueAt.toISOString()).toBe('2026-10-26T23:30:00.000Z');

    // The excerpt: masked, and the third agent message is its last.
    const excerpt = riskRow.excerptMasked as Array<{
      event_id: string;
      author_type: string;
      is_ai: boolean;
      text: string;
    }>;
    expect(excerpt.map((m) => m.event_id)).toEqual(risk.ids.slice(0, 6));
    expect(excerpt[1]).toMatchObject({ author_type: 'bot', is_ai: true });
    expect(excerpt[0]!.text).not.toContain('4111 1111 1111 1111');

    // The run's mark and volumes.
    const run = await owner.qaSamplingRun.findFirst({
      where: { licenseId: fx.a.licenseId, day: new Date(`${DAY}T00:00:00Z`) },
    });
    const pickedRandom = [
      plain,
      risk,
      badAi,
      badHuman,
      first,
      repeat,
      guardrail,
      mandatory,
      insufficient,
      manual,
      done,
    ].filter((at) => drawn(at.threadId).length > 0).length;
    expect(run).toMatchObject({
      samplePercent: 5,
      eligible: 11,
      mandatory: 8,
      random: pickedRandom,
    });

    // The next pass finds the day marked and leaves it alone.
    const again = await sampler.run({ now: new Date(AFTER_TWO.getTime() + 15 * 60_000) });
    expect(again.totals.days).toBe(0);
    expect(again.totals.queued).toBe(0);
  });

  it('1,000 AI connections at 5 % queue the draw’s ~50, and the same day sampled again picks the same list (AI-24 KK 1)', async () => {
    const t = fx.b;
    await owner.aiAgent.create({
      data: { licenseId: t.licenseId, kind: 'ai_agent', name: 'Bora', active: true },
    });
    const customers = Array.from({ length: 1000 }, () => randomUUID());
    await owner.customer.createMany({
      data: customers.map((id, i) => ({ id, organizationId: t.organizationId, name: `P${i}` })),
    });
    const chats = customers.map(() => generateShortId());
    const threads = customers.map(() => generateShortId());
    await owner.chat.createMany({
      data: chats.map((id, i) => ({
        id,
        licenseId: t.licenseId,
        customerId: customers[i]!,
        active: false,
      })),
    });
    await owner.thread.createMany({
      data: threads.map((id, i) => ({
        id,
        chatId: chats[i]!,
        licenseId: t.licenseId,
        active: false,
        createdAt: new Date(DAY_NOON - 3_600_000),
        closedAt: new Date(DAY_NOON + i * 1000),
      })),
    });
    await owner.aiConversation.createMany({
      data: threads.map((threadId, i) => ({ licenseId: t.licenseId, chatId: chats[i]!, threadId })),
    });
    const expected = threads.filter((id) => qaSampledAtRandom(t.licenseId, DAY, id, 5)).sort();
    expect(expected.length).toBeGreaterThan(20);
    expect(expected.length).toBeLessThan(90);

    const listed = async () =>
      (
        await owner.qaReview.findMany({
          where: { licenseId: t.licenseId },
          select: { threadId: true, reasons: true },
        })
      )
        .map((r) => r.threadId)
        .sort();

    const first = await new QaSampler(app).run({ now: AFTER_TWO });
    const dayB = first.tenants.find((r) => r.licenseId === t.licenseId.toString())!.days;
    expect(dayB.find((d) => d.day === DAY)).toMatchObject({
      eligible: 1000,
      random: expected.length,
      mandatory: 0,
      queued: expected.length,
    });
    expect(await listed()).toEqual(expected);

    // Sampled again from scratch: the same list.
    await owner.qaReview.deleteMany({ where: { licenseId: t.licenseId } });
    await owner.qaSamplingRun.deleteMany({ where: { licenseId: t.licenseId } });
    await new QaSampler(app).run({ now: new Date(AFTER_TWO.getTime() + 3_600_000) });
    expect(await listed()).toEqual(expected);
  });

  it('a workspace whose 02:00 has not come is not sampled while another’s has', async () => {
    // B's day ends in New York (UTC−4): at 23:30Z it is 19:30 on the 19th there.
    await owner.inboxSettings.create({
      data: {
        licenseId: fx.b.licenseId,
        brandId: await seedDefaultBrand(owner, fx.b.licenseId),
        dayBoundaryTz: 'America/New_York',
      },
    });
    await owner.aiAgent.create({
      data: { licenseId: fx.b.licenseId, kind: 'ai_agent', name: 'Bora', active: true },
    });
    const b = await connection(fx.b, aiLines, { riskFlags: ['rg_signal'] });
    const a = await connection(fx.a, aiLines, { riskFlags: ['rg_signal'] });
    await new QaSampler(app).run({ now: AFTER_TWO });
    expect(await owner.qaReview.count({ where: { threadId: a.threadId } })).toBe(1);
    expect(await owner.qaReview.count({ where: { threadId: b.threadId } })).toBe(0);
    // 06:30Z on the 20th is 02:30 in New York: now B's 19th is due.
    await new QaSampler(app).run({ now: new Date('2026-10-20T06:30:00.000Z') });
    expect(await owner.qaReview.count({ where: { threadId: b.threadId } })).toBe(1);
  });

  it('checks the same lists @siyahtus/types names, keeps a workspace to its rows, and outlives the connection', async () => {
    const constraint = async (name: string) =>
      (
        await owner.$queryRaw<Array<{ def: string }>>`
          SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`
      )[0]!.def;
    const listed = (def: string) =>
      [...def.matchAll(/'([a-z_0-9]+)'::text/g)].map((m) => m[1]!).sort();
    expect(listed(await constraint('qa_reviews_reasons_check'))).toEqual([...QA_REASONS].sort());
    expect(listed(await constraint('qa_reviews_status_check'))).toEqual(
      [...QA_REVIEW_STATUSES].sort(),
    );
    expect(listed(await constraint('qa_reviews_final_check'))).toEqual([...QA_FINALS].sort());

    const at = await connection(fx.a, aiLines, { riskFlags: ['rg_signal'] });
    await new QaSampler(app).run({ now: AFTER_TWO });
    expect(await asTenant(fx.a, (tx) => tx.qaReview.count())).toBe(1);
    expect(await asTenant(fx.b, (tx) => tx.qaReview.count())).toBe(0);
    expect(await asTenant(fx.b, (tx) => tx.qaRubric.count())).toBe(0);
    // Each workspace's days are marked, B's empty ones too — each sees its own.
    const runsOf = async (t: TenantFixture) =>
      (await asTenant(t, (tx) => tx.qaSamplingRun.findMany())).map((r) => r.licenseId);
    expect(await runsOf(fx.a)).toEqual([fx.a.licenseId, fx.a.licenseId, fx.a.licenseId]);
    expect(await runsOf(fx.b)).toEqual([fx.b.licenseId, fx.b.licenseId, fx.b.licenseId]);
    // The platform rubric, version 1, made on first use.
    const rubric = await asTenant(fx.a, (tx) => tx.qaRubric.findFirstOrThrow());
    expect(rubric).toMatchObject({ version: 1, active: true });
    expect(rubric.criteria).toEqual(PLATFORM_QA_RUBRIC);

    // Another workspace's agent is not this review's to name.
    const foreign = await owner.aiAgent.create({
      data: { licenseId: fx.b.licenseId, kind: 'ai_agent', name: 'B', active: true },
      select: { id: true },
    });
    const other = await connection(fx.a, aiLines);
    await expect(
      asTenant(
        fx.a,
        (tx) =>
          tx.$executeRaw`INSERT INTO qa_reviews (id, license_id, chat_id, thread_id, ai_agent_id, reasons, due_at, rubric_id)
                       VALUES (gen_random_uuid(), ${fx.a.licenseId}, ${other.chatId}, ${other.threadId},
                               ${foreign.id}::uuid, ARRAY['manual'], now(), ${rubric.id}::uuid)`,
      ),
    ).rejects.toThrow();
    // A completed review has its verdict; a critical failure is a fail.
    await expect(
      owner.qaReview.update({
        where: { licenseId_threadId: { licenseId: fx.a.licenseId, threadId: at.threadId } },
        data: { status: 'completed' },
      }),
    ).rejects.toThrow();
    await expect(
      owner.qaReview.update({
        where: { licenseId_threadId: { licenseId: fx.a.licenseId, threadId: at.threadId } },
        data: { criticalFail: true },
      }),
    ).rejects.toThrow();

    // Retention takes the connection; the review and its excerpt stay.
    await owner.thread.delete({ where: { id: at.threadId } });
    expect(await owner.qaReview.count({ where: { threadId: at.threadId } })).toBe(1);
    // Erasure takes the chat, and the review with it.
    await owner.chat.delete({ where: { id: at.chatId } });
    expect(await owner.qaReview.count({ where: { threadId: at.threadId } })).toBe(0);
  });
});
