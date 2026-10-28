/**
 * The AI quality metrics (tm 320.2 · SiyahTuş analysis AI-25; owner
 * decisions K9, K10) through the real server and the real database:
 *
 *   - the acceptance fixture — ten connections (three confirmed, four
 *     assumed, one of them back about the same topic 48 hours later, three
 *     handed over, one by the responsible-gaming rule): 30% confirmed, 30%
 *     assumed, 1/7 false, 30% handed over, 100% mandatory compliance;
 *   - the finalize job: settled 72 hours after the end, the member's return
 *     about the same topic makes it false, any return marks `repeat_any`, a
 *     row with no member is "not measurable", a second run settles nothing,
 *     the last 72 hours' rows stay "not settled yet";
 *   - QA's missed mandatory hand-over drops compliance, listed by id;
 *   - v12 and v13 side by side; BSAT only where the AI was alone; what the AI
 *     claimed beside what the player answered (K9);
 *   - a Team Lead sees their own team only; an agent nothing;
 *   - the rollup equals the raw rows, and the SQL equals the types'
 *     reference definition; RLS and grants of `ai_metrics_daily`;
 *   - ADR-09a's billed `resolutions` is what it was (AI-25-S1).
 */
import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_AGENT_SCOPES,
  aiMetricCountsOf,
  generateShortId,
  localDayKey,
  localDayStart,
  shiftDayKey,
  type AiMetricRow,
  type AiOutcome,
  type AiOutcomeQaResult,
} from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { readDayBoundary } from '../../src/services/chat/day-boundary.js';
import {
  AiOutcomeFinalizer,
  readAiMetricCounts,
  readAiMetricsRollup,
  rollupAiMetrics,
} from '../../src/services/reports/ai-metrics.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Headers = Record<string, string>;

describe('the AI quality metrics (AI-25 · tm 320.2)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let teamA: bigint;
  let teamB: bigint;
  let v12: string;
  let v13: string;
  let chatId: string;
  let admin: Headers;
  let seq = 0;
  /** The main fixture's ends: five days ago, so every row is settled. */
  let t0: Date;

  const tenant = (): TenantContext => ({
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
  });

  beforeAll(async () => {
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: process.env['DATABASE_APP_URL'] });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    server.app.permissionMatrix.cache.invalidate();
    t0 = new Date(Math.floor((Date.now() - 5 * DAY) / 1000) * 1000);
    teamA = (await owner.group.create({ data: { licenseId: fx.a.licenseId, name: 'Finans' } })).id;
    teamB = (await owner.group.create({ data: { licenseId: fx.a.licenseId, name: 'VIP' } })).id;
    const aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, kind: 'ai_agent', name: 'Ada', active: true },
        select: { id: true },
      })
    ).id;
    const version = async (number: number, status: string): Promise<string> =>
      (
        await owner.aiConfigVersion.create({
          data: {
            licenseId: fx.a.licenseId,
            aiAgentId,
            number,
            seq: BigInt(number),
            status,
            snapshot: { agent: {} },
            snapshotHash: String(number % 10).repeat(64),
            packageFormat: 1,
            draftRevision: 1n,
            publishedAt: new Date(),
          },
          select: { id: true },
        })
      ).id;
    v12 = await version(12, 'superseded');
    v13 = await version(13, 'superseded');
    chatId = await chatOf(fx.a.customerId);
    admin = {
      authorization: `Bearer ${await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['reports_read'],
      })}`,
    };
  });

  async function customer(): Promise<string> {
    seq += 1;
    return (
      await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: `Oyuncu ${seq}` },
        select: { id: true },
      })
    ).id;
  }

  async function chatOf(customerId: string, createdAt?: Date): Promise<string> {
    return (
      await owner.chat.create({
        data: {
          id: generateShortId(),
          licenseId: fx.a.licenseId,
          customerId,
          ...(createdAt ? { createdAt } : {}),
        },
        select: { id: true },
      })
    ).id;
  }

  /** A connection of the member's, with no AI on it, opened at `at`. */
  async function humanThread(customerId: string, at: Date): Promise<void> {
    const chat = await chatOf(customerId, at);
    await owner.thread.create({
      data: { id: generateShortId(), chatId: chat, licenseId: fx.a.licenseId, createdAt: at },
    });
  }

  interface Row {
    endedAt?: Date | null;
    startedAt?: Date;
    outcome?: AiOutcome | null;
    member?: string | null;
    team?: bigint;
    version?: string;
    intent?: string | null;
    aiTurns?: number;
    claimed?: boolean;
    confirmation?: 'yes' | 'no' | null;
    handoffAfter?: number;
    reason?: string;
    rule?: string;
    replyAfter?: number;
    card?: 'sufficient' | 'insufficient';
    reasked?: boolean;
    bsat?: 'good' | 'bad';
    csat?: 'good' | 'bad';
    qa?: AiOutcomeQaResult;
    violation?: boolean;
  }

  async function outcome(row: Row): Promise<{ id: string; threadId: string }> {
    const endedAt = row.endedAt === undefined ? t0 : row.endedAt;
    const startedAt = row.startedAt ?? new Date((endedAt ?? new Date()).getTime() - 10 * 60_000);
    const handoffAt =
      row.handoffAfter === undefined ? null : new Date(startedAt.getTime() + row.handoffAfter);
    const created = await owner.aiConversationOutcome.create({
      data: {
        licenseId: fx.a.licenseId,
        chatId,
        threadId: generateShortId(),
        memberKey: row.member === undefined ? await customer() : row.member,
        teamId: row.team ?? teamA,
        configVersionId: row.version ?? v12,
        language: 'tr',
        intent: row.intent === undefined ? 'withdrawal' : row.intent,
        startedAt,
        endedAt,
        aiTurns: row.aiTurns ?? 2,
        playerTurns: 2,
        outcome: row.outcome === undefined ? 'assumed_pending' : row.outcome,
        aiClaimedResolved: row.claimed ?? false,
        resolutionConfirmation: row.confirmation ?? null,
        confirmedAt: row.confirmation ? startedAt : null,
        handoffAt,
        handoffReason: row.reason ?? null,
        handoffMandatoryRule: row.rule ?? null,
        firstHumanReplyAt:
          handoffAt && row.replyAfter !== undefined
            ? new Date(handoffAt.getTime() + row.replyAfter * 1000)
            : null,
        handoffCardRating: row.card ?? null,
        agentReasked: row.reasked ?? null,
        bsat: row.bsat ?? null,
        csatAfterHandoff: row.csat ?? null,
        qaResult: row.qa ?? null,
        mandatoryHandoffViolation: row.violation ?? false,
      },
      select: { id: true, threadId: true },
    });
    return created;
  }

  /**
   * The acceptance fixture (ends at `t0`): three confirmed (two the AI said
   * were solved), four assumed — one member back about the same topic 48
   * hours later, one member back about something else, one with no member —
   * and three hand-overs, one by the responsible-gaming rule.
   */
  async function acceptanceFixture() {
    const back = await customer();
    const elsewhere = await customer();
    const rows = {
      c1: await outcome({
        outcome: 'confirmed_resolved',
        confirmation: 'yes',
        claimed: true,
        bsat: 'good',
      }),
      c2: await outcome({
        outcome: 'confirmed_resolved',
        confirmation: 'yes',
        claimed: true,
        bsat: 'good',
      }),
      c3: await outcome({ outcome: 'confirmed_resolved', confirmation: 'yes', bsat: 'bad' }),
      a4: await outcome({ member: elsewhere, intent: 'deposit' }),
      a5: await outcome({ intent: 'deposit' }),
      a6: await outcome({ member: null, intent: 'deposit', version: v13 }),
      f7: await outcome({ member: back, intent: 'bonus', version: v13 }),
      h8: await outcome({
        outcome: 'handed_off',
        intent: 'bonus',
        version: v13,
        handoffAfter: 60_000,
        reason: 'guardrail_rg',
        rule: 'guardrail_rg',
        replyAfter: 60,
        card: 'sufficient',
        reasked: false,
        // Never BSAT: a person took it.
        bsat: 'bad',
        csat: 'good',
      }),
      h9: await outcome({
        outcome: 'handed_off',
        intent: 'bonus',
        version: v13,
        handoffAfter: 60_000,
        reason: 'no_knowledge',
        replyAfter: 120,
        card: 'insufficient',
        reasked: true,
      }),
      h10: await outcome({
        outcome: 'handed_off',
        intent: 'bonus',
        version: v13,
        handoffAfter: 60_000,
        reason: 'no_knowledge',
        replyAfter: 600,
      }),
    };
    // The member came back 48 hours later about the same topic, the AI answered.
    const returned = await outcome({
      member: back,
      intent: 'bonus',
      outcome: 'confirmed_resolved',
      startedAt: new Date(t0.getTime() + 48 * HOUR),
      endedAt: new Date(t0.getTime() + 48 * HOUR + 5 * 60_000),
    });
    // Another member opened a connection with a person 10 hours later.
    await humanThread(elsewhere, new Date(t0.getTime() + 10 * HOUR));
    return { ...rows, returned };
  }

  const window = (from: Date, to: Date): string =>
    `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  const main = (): string => window(new Date(t0.getTime() - HOUR), new Date(t0.getTime() + HOUR));

  async function quality(query: string, headers: Headers = admin) {
    const response = await server.get(`/reports/ai-agent?${query}`, headers);
    expect(response.statusCode).toBe(200);
    return response.json() as {
      resolutions: number;
      quality: Record<string, unknown> & {
        counts: Record<string, number>;
        claims: Record<string, number>;
        handoff_reasons: { reason: string; count: number }[];
        handoff_wait: { all: Record<string, number | null>; in_hours: unknown };
        mandatory_violations: { thread_id: string }[];
      };
    };
  }

  const finalize = (now = new Date()) => new AiOutcomeFinalizer(owner).run({ now });

  it('the acceptance fixture: 30% confirmed, 30% assumed, 1/7 false, 30% handed over, 100% compliance', async () => {
    const rows = await acceptanceFixture();
    const report = await finalize();
    expect(report.totals.finalized).toBe(10);
    // The returned connection ended 71 h 55 min ago: not yet.
    const settled = await owner.aiConversationOutcome.findMany({
      where: { licenseId: fx.a.licenseId },
      select: {
        id: true,
        outcome: true,
        repeatAny72h: true,
        repeatSameIntent72h: true,
        repeatOfId: true,
        finalizedAt: true,
      },
    });
    const byId = new Map(settled.map((row) => [row.id, row]));
    expect(byId.get(rows.f7.id)).toMatchObject({
      outcome: 'false_resolved',
      repeatSameIntent72h: true,
      repeatAny72h: true,
      repeatOfId: rows.returned.id,
    });
    expect(byId.get(rows.a4.id)).toMatchObject({
      outcome: 'assumed_resolved',
      repeatAny72h: true,
      repeatSameIntent72h: false,
    });
    expect(byId.get(rows.a5.id)).toMatchObject({
      outcome: 'assumed_resolved',
      repeatAny72h: false,
      repeatSameIntent72h: false,
    });
    // No member: settled, the repeat not measurable.
    expect(byId.get(rows.a6.id)).toMatchObject({
      outcome: 'assumed_resolved',
      repeatAny72h: null,
      repeatSameIntent72h: null,
    });
    expect(byId.get(rows.c1.id)).toMatchObject({ outcome: 'confirmed_resolved' });
    expect(byId.get(rows.returned.id)?.finalizedAt).toBeNull();
    // Idempotent: a settled row is never read again.
    expect((await finalize()).totals.finalized).toBe(0);

    const { quality: q } = await quality(main());
    expect(q).toMatchObject({
      conversations: 10,
      confirmed_resolution: 0.3,
      assumed_resolution: 0.3,
      false_resolution: 0.1429,
      handoff_rate: 0.3,
      mandatory_handoff_compliance: 1,
      containment: 0.7,
      handoff_quality: 0.5,
      reask_rate: 0.5,
      bsat: 0.6667,
      csat_after_handoff: 1,
      unsettled: 0,
      repeat_unmeasured: 1,
      low_sample: true,
      // withdrawal 3 settled, deposit 3 settled, bonus 1 settled + 2 handed
      // over (the RG hand-over left out): 9 pairs, 7 agree.
      consistency: 0.7778,
    });
    // K9: what the AI said, what the player answered.
    expect(q.claims).toEqual({
      ai_claimed_resolved: 2,
      player_confirmed: 3,
      player_denied: 0,
      claimed_unanswered: 0,
    });
    expect(q.handoff_reasons).toEqual([
      { reason: 'no_knowledge', count: 2 },
      { reason: 'guardrail_rg', count: 1 },
    ]);
    expect(q.handoff_wait.all).toEqual({ count: 3, median_seconds: 120, p90_seconds: 504 });
    // No work schedule saved: no business hours to split by.
    expect(q.handoff_wait.in_hours).toBeNull();
    expect(q.mandatory_violations).toEqual([]);

    // The list behind a figure, by id, the same predicate as the count.
    const falseList = await server.get(
      `/reports/ai-agent/conversations?${main()}&metric=false_resolution`,
      admin,
    );
    expect(falseList.statusCode).toBe(200);
    expect(
      (falseList.json() as { conversations: { thread_id: string }[] }).conversations.map(
        (c) => c.thread_id,
      ),
    ).toEqual([rows.f7.threadId]);
  });

  it('the last 72 hours’ assumed rows are "not settled yet", in N but in no resolution', async () => {
    const pending = await outcome({ endedAt: new Date(Date.now() - 10 * HOUR) });
    expect((await finalize()).totals.finalized).toBe(0);
    const { quality: q } = await quality(
      window(new Date(Date.now() - 11 * HOUR), new Date(Date.now())),
    );
    expect(q).toMatchObject({ conversations: 1, unsettled: 1, assumed_resolution: 0 });
    const list = await server.get(
      `/reports/ai-agent/conversations?${window(new Date(Date.now() - 11 * HOUR), new Date())}&metric=unsettled`,
      admin,
    );
    expect(
      (list.json() as { conversations: { id: string; finalized_at: string | null }[] })
        .conversations,
    ).toMatchObject([{ id: pending.id, finalized_at: null }]);
  });

  it('a mandatory hand-over QA found missed drops compliance below 100%, listed by id', async () => {
    const rows = await acceptanceFixture();
    await finalize();
    // QA's `handoff_timing` failure on an assumed one (recordOutcomeQa writes it).
    await owner.aiConversationOutcome.update({
      where: { id: rows.a5.id },
      data: { mandatoryHandoffViolation: true, qaResult: 'fail' },
    });
    const { quality: q } = await quality(main());
    expect(q.mandatory_handoff_compliance).toBe(0.5);
    expect(q.mandatory_violations.map((v) => v.thread_id)).toEqual([rows.a5.threadId]);
    const list = await server.get(
      `/reports/ai-agent/conversations?${main()}&metric=mandatory_handoff_violation`,
      admin,
    );
    expect(
      (list.json() as { conversations: { thread_id: string }[] }).conversations.map(
        (c) => c.thread_id,
      ),
    ).toEqual([rows.a5.threadId]);
  });

  it('v12 and v13 side by side, and the other breakdowns', async () => {
    await acceptanceFixture();
    await finalize();
    const response = await server.get(`/reports/ai-agent/breakdown?${main()}&by=version`, admin);
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      total: { conversations: number };
      rows: { key: string; label: string; quality: Record<string, unknown> }[];
    };
    expect(body.total.conversations).toBe(10);
    const byLabel = Object.fromEntries(body.rows.map((row) => [row.label, row]));
    expect(Object.keys(byLabel).sort()).toEqual(['v12', 'v13']);
    expect(byLabel['v12']).toMatchObject({
      key: v12,
      quality: { conversations: 5, confirmed_resolution: 0.6, handoff_rate: 0 },
    });
    expect(byLabel['v13']).toMatchObject({
      key: v13,
      quality: { conversations: 5, confirmed_resolution: 0, handoff_rate: 0.6 },
    });

    const reasons = await server.get(`/reports/ai-agent/breakdown?${main()}&by=reason`, admin);
    expect(
      (
        reasons.json() as { rows: { key: string | null; quality: { conversations: number } }[] }
      ).rows.map((row) => [row.key, row.quality.conversations]),
    ).toEqual([
      [null, 7],
      ['no_knowledge', 2],
      ['guardrail_rg', 1],
    ]);
    const team = await server.get(`/reports/ai-agent/breakdown?${main()}&by=team`, admin);
    expect((team.json() as { rows: { label: string }[] }).rows.map((row) => row.label)).toEqual([
      'Finans',
    ]);
    // A filter narrows the total.
    const deposit = await server.get(
      `/reports/ai-agent/breakdown?${main()}&by=intent&intent=deposit`,
      admin,
    );
    expect((deposit.json() as { total: { conversations: number } }).total.conversations).toBe(3);
    expect(
      (await server.get(`/reports/ai-agent/breakdown?${main()}&by=day`, admin)).statusCode,
    ).toBe(400);
  });

  it('pages the list behind a figure newest first, by keyset', async () => {
    const rows = await acceptanceFixture();
    await finalize();
    const first = await server.get(
      `/reports/ai-agent/conversations?${main()}&metric=handed_off&limit=2`,
      admin,
    );
    const page = first.json() as { conversations: { id: string }[]; next_cursor: string | null };
    expect(page.conversations).toHaveLength(2);
    expect(page.next_cursor).not.toBeNull();
    const second = await server.get(
      `/reports/ai-agent/conversations?${main()}&metric=handed_off&limit=2&cursor=${page.next_cursor}`,
      admin,
    );
    const rest = second.json() as { conversations: { id: string }[]; next_cursor: string | null };
    expect(rest.next_cursor).toBeNull();
    expect([...page.conversations, ...rest.conversations].map((c) => c.id).sort()).toEqual(
      [rows.h8.id, rows.h9.id, rows.h10.id].sort(),
    );
    expect(
      (
        await server.get(
          `/reports/ai-agent/conversations?${main()}&metric=handed_off&cursor=bm9wZQ`,
          admin,
        )
      ).statusCode,
    ).toBe(400);
  });

  async function member(role: 'team_lead' | 'agent', leads: bigint[]): Promise<Headers> {
    seq += 1;
    const account = await owner.account.create({
      data: { email: `met-${role}-${seq}-${Date.now()}@example.test`, name: `Üye ${seq}` },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: fx.a.licenseId, agentId: account.id, role },
    });
    for (const groupId of leads) {
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId, agentId: account.id, isLead: true },
      });
    }
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: account.id,
      scopes: [...DEFAULT_AGENT_SCOPES],
    });
    return { authorization: `Bearer ${token}` };
  }

  it('a Team Lead sees their own team only; an agent nothing (RL-02)', async () => {
    await acceptanceFixture();
    await outcome({
      team: teamB,
      outcome: 'confirmed_resolved',
      endedAt: new Date(t0.getTime() - 3 * HOUR),
    });
    await finalize();
    const wide = window(new Date(t0.getTime() - 4 * HOUR), new Date(t0.getTime() + HOUR));
    const total = async (headers: Headers): Promise<number> => {
      const response = await server.get(`/reports/ai-agent/breakdown?${wide}&by=team`, headers);
      expect(response.statusCode).toBe(200);
      return (response.json() as { total: { conversations: number } }).total.conversations;
    };
    expect(await total(admin)).toBe(11);
    const leadA = await member('team_lead', [teamA]);
    const leadB = await member('team_lead', [teamB]);
    expect(await total(leadA)).toBe(10);
    expect(await total(leadB)).toBe(1);
    // A lead's list holds no other team's connection either.
    const list = await server.get(
      `/reports/ai-agent/conversations?${wide}&metric=confirmed_resolved`,
      leadB,
    );
    expect((list.json() as { conversations: { team_id: string }[] }).conversations).toEqual([
      expect.objectContaining({ team_id: String(teamB) }),
    ]);
    // The workspace report stays `reports_read`'s.
    expect((await server.get(`/reports/ai-agent?${wide}`, leadA)).statusCode).toBe(403);
    const agent = await member('agent', []);
    expect(
      (await server.get(`/reports/ai-agent/breakdown?${wide}&by=team`, agent)).statusCode,
    ).toBe(403);
  });

  it('the rollup equals the raw rows, and the SQL the types’ definition', async () => {
    await acceptanceFixture();
    await outcome({
      team: teamB,
      outcome: 'confirmed_resolved',
      endedAt: new Date(t0.getTime() - 3 * HOUR),
    });
    await outcome({ endedAt: new Date(Date.now() - 10 * HOUR) });
    await finalize();
    const first = await withTenant(app, tenant(), (tx) => rollupAiMetrics(tx, fx.a.licenseId));
    expect(first.days).toBeGreaterThan(0);
    // Nothing changed: the next run still re-reads the last hour's writes, and rebuilds the same.
    await withTenant(app, tenant(), (tx) => rollupAiMetrics(tx, fx.a.licenseId));

    const boundary = await withTenant(app, tenant(), (tx) => readDayBoundary(tx));
    const firstDay = localDayKey(
      new Date(t0.getTime() - 4 * HOUR),
      boundary.timezone,
      boundary.hour,
    );
    const lastDay = localDayKey(new Date(), boundary.timezone, boundary.hour);
    const [rolled, raw] = await withTenant(app, tenant(), async (tx) => [
      await readAiMetricsRollup(tx, firstDay, lastDay),
      await readAiMetricCounts(
        tx,
        localDayStart(firstDay, boundary.timezone, boundary.hour),
        localDayStart(shiftDayKey(lastDay, 1), boundary.timezone, boundary.hour),
      ),
    ]);
    expect(rolled).toEqual(raw);
    expect(raw.conversations).toBe(13);

    // A later QA result reaches its day on the next run.
    await owner.aiConversationOutcome.updateMany({
      where: { licenseId: fx.a.licenseId, outcome: 'assumed_resolved', memberKey: null },
      data: { qaResult: 'unresolved', updatedAt: new Date() },
    });
    await withTenant(app, tenant(), (tx) => rollupAiMetrics(tx, fx.a.licenseId));
    const after = await withTenant(app, tenant(), (tx) =>
      readAiMetricsRollup(tx, firstDay, lastDay),
    );
    expect(after.false_in_settled).toBe(raw.false_in_settled + 1);

    // The SQL's counts are `aiMetricCountsOf`'s over the same rows.
    const rows = await owner.aiConversationOutcome.findMany({
      where: { licenseId: fx.a.licenseId },
    });
    const reference = aiMetricCountsOf(
      rows
        .filter(
          (row) =>
            row.endedAt &&
            row.endedAt >= new Date(t0.getTime() - HOUR) &&
            row.endedAt < new Date(t0.getTime() + HOUR),
        )
        .map((row): AiMetricRow => ({
          outcome: row.outcome as AiOutcome | null,
          ai_turns: row.aiTurns,
          ended: row.endedAt !== null,
          member_key: row.memberKey,
          human_replied: row.firstHumanReplyAt !== null,
          handed_over: row.handoffAt !== null,
          handoff_mandatory_rule: row.handoffMandatoryRule,
          mandatory_handoff_violation: row.mandatoryHandoffViolation,
          handoff_card_rating: row.handoffCardRating,
          agent_reasked: row.agentReasked,
          guardrail_violations_confirmed: row.guardrailViolationsConfirmed,
          guardrail_hits: Array.isArray(row.guardrailHits) ? row.guardrailHits.length : 0,
          bsat: row.bsat,
          csat_after_handoff: row.csatAfterHandoff,
          clarification_turns: row.clarificationTurns,
          required_slots_total: row.requiredSlotsTotal,
          required_slots_filled: row.requiredSlotsFilled,
          repeat_same_intent_72h: row.repeatSameIntent72h,
          repeat_any_72h: row.repeatAny72h,
          qa_result: row.qaResult as AiOutcomeQaResult | null,
        })),
    );
    const sql = await withTenant(app, tenant(), (tx) =>
      readAiMetricCounts(tx, new Date(t0.getTime() - HOUR), new Date(t0.getTime() + HOUR)),
    );
    expect(sql).toEqual(reference);
  });

  it('ai_metrics_daily: RLS keeps license B out, and the app never updates a row in place', async () => {
    await acceptanceFixture();
    await finalize();
    await withTenant(app, tenant(), (tx) => rollupAiMetrics(tx, fx.a.licenseId));
    const seen = await withTenant(
      app,
      { licenseId: fx.b.licenseId, organizationId: fx.b.organizationId },
      (tx) => tx.aiMetricsDaily.count(),
    );
    expect(seen).toBe(0);
    await expect(
      withTenant(app, tenant(), (tx) => tx.$executeRaw`UPDATE ai_metrics_daily SET confirmed = 99`),
    ).rejects.toThrow(/permission denied/);
  });

  it("ADR-09a's billed resolutions are what they were (AI-25-S1) (FR-MOD-07.4)", async () => {
    // Two connections closed with no agent message: the invoice's AI resolutions.
    for (let i = 0; i < 2; i += 1) {
      await owner.thread.create({
        data: {
          id: generateShortId(),
          chatId,
          licenseId: fx.a.licenseId,
          active: false,
          createdAt: new Date(t0.getTime() - 30 * 60_000),
          closedAt: t0,
        },
      });
    }
    const before = await quality(main());
    expect(before.resolutions).toBe(2);
    expect(before.quality.conversations).toBe(0);
    await acceptanceFixture();
    await finalize();
    await withTenant(app, tenant(), (tx) => rollupAiMetrics(tx, fx.a.licenseId));
    const after = await quality(main());
    const { quality: _before, ...billedBefore } = before;
    const { quality: _after, ...billedAfter } = after;
    expect(billedAfter).toEqual(billedBefore);
    expect(after.quality.conversations).toBe(10);
  });
});
