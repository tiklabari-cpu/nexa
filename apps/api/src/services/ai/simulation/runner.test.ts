/**
 * The scenario runner (tm 314.2 · SiyahTuş analysis AI-19 §2 "Koşu döngüsü")
 * against a scripted engine: what every turn is handed, and when the
 * conversation stops.
 *
 *   - every scenario starts from an empty conversation, and each turn reads
 *     the state the last one left;
 *   - every turn gets the run's configuration and version, the frozen clock
 *     (`simulated_now + n × 30 s`), the scenario's tool outputs as stubs, the
 *     simulation's meter and no chat — inside the simulation context, over a
 *     read-only transaction;
 *   - it stops on a hand-over, a resolution, `max_turns`, the end of the
 *     script, 60 s (here: a shortened limit), a failed turn or a spent test
 *     allowance — and says which;
 *   - a flag a turn raised holds for the turns after it; what was said is the
 *     next turn's history; the transcript carries each AI turn's trace.
 *
 * The live engine plays the same runner in `ai-testing-runner.test.ts`.
 */
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  readNoAnswerSettings,
  type AiTestExpectations,
  type ResolutionRecord,
} from '@siyahtus/types';
import { simulationScope } from '../../../lib/simulation-context.js';
import type { TenantContext } from '../../../lib/tenant.js';
import { AiDailyCapError } from '../ai-daily-budget.js';
import {
  emptyTurnState,
  type TurnContext,
  type TurnDecisions,
  type TurnMessage,
  type TurnResult,
  type TurnSideEffect,
  type TurnState,
} from '../conversation/turn.js';
import type { KnowledgeService } from '../knowledge-service.js';
import { MockLlmProvider } from '../provider/mock-llm-provider.js';
import {
  PLAYER_LINES_MAX,
  SIMULATION_NOTES,
  ScenarioRunner,
  turnMoment,
  type SimulatedScenario,
  type SimulationSetting,
  type TurnEngine,
} from './runner.js';

const TENANT: TenantContext = {
  licenseId: 9n,
  organizationId: '9b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d',
};
const AGENT = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const SKILL = '0b6c7a8e-1f2d-4c3b-9a4e-5d6f7a8b9c0d';
const SCENARIO = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
const SOURCE = '3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a';
const STARTED = new Date('2026-10-19T09:00:00Z');

const SETTING: SimulationSetting = {
  tenant: TENANT,
  aiAgentId: AGENT,
  config: { versionId: null, pkg: { skills: [] }, seq: null },
  timeZone: 'Europe/Istanbul',
  noAnswer: readNoAnswerSettings(null),
};

function scenario(overrides: Partial<SimulatedScenario> = {}): SimulatedScenario {
  return {
    key: SCENARIO,
    name: 'Papara yatırım geçmedi',
    mode: 'scripted',
    persona: 'normal',
    language: 'tr',
    turns: ['param yatmadı', 'Papara 13:40', 'evet'],
    goal: null,
    facts: {},
    expectations: { outcome: 'handoff', max_turns: 6 } satisfies AiTestExpectations,
    simulatedNow: new Date('2026-10-19T12:15:00Z'),
    toolOutputs: { deposit_lookup: { found: false } },
    brandId: null,
    ...overrides,
  };
}

function decisions(overrides: Partial<TurnDecisions> = {}): TurnDecisions {
  return {
    outcome: 'answered',
    skillId: SKILL,
    skillName: 'Yatırım geçmedi',
    replyKind: 'question',
    failure: null,
    capped: null,
    usage: { llmInputTokens: 10, llmOutputTokens: 5, embeddingTokens: 1 },
    log: [],
    ...overrides,
  };
}

/** A turn the AI took, leaving `state` with one more turn counted. */
function answered(
  state: TurnState,
  options: {
    reply?: string | null;
    decisions?: Partial<TurnDecisions>;
    sideEffects?: TurnSideEffect[];
    next?: Partial<TurnState>;
  } = {},
): TurnResult {
  const turns = (state.counters['turns'] as number | undefined) ?? 0;
  return {
    reply: options.reply === undefined ? 'Hangi yöntemle yatırım yaptınız?' : options.reply,
    decisions: decisions(options.decisions),
    nextState: {
      ...state,
      activeSkillId: SKILL,
      counters: { ...state.counters, turns: turns + 1 },
      ...options.next,
    },
    sideEffects: options.sideEffects ?? [],
  };
}

/** A turn that answered and asked nothing: a script past its end says no more. */
function said(state: TurnState): TurnResult {
  return answered(state, { reply: 'Anladım.', decisions: { replyKind: 'answer' } });
}

const handedToFinance: TurnSideEffect = {
  kind: 'handoff',
  team: null,
  groupId: 7,
  topic: 'finance',
  reason: 'expected_time_exceeded',
  reasons: ['procedure_rule'],
};

function resolved(outcome: 'resolved' | 'resolved_waiting'): ResolutionRecord {
  return {
    decision: 'resolved',
    reason: 'criteria_met',
    basis: 'platform',
    result: true,
    unknown: [],
    confirmation: 'yes',
    outcome,
  };
}

interface Call {
  state: TurnState;
  message: TurnMessage;
  ctx: TurnContext;
  scope: ReturnType<typeof simulationScope>;
}

/** An engine answering from `script`, one step per turn, recording what each turn was handed. */
function scripted(
  script: Array<(state: TurnState, ctx: TurnContext) => TurnResult | Promise<TurnResult>>,
): { engine: TurnEngine; calls: Call[] } {
  const calls: Call[] = [];
  const engine: TurnEngine = {
    async runTurn(state, message, ctx) {
      calls.push({ state, message, ctx, scope: simulationScope() });
      const step = script[Math.min(calls.length - 1, script.length - 1)]!;
      return step(state, ctx);
    },
  };
  return { engine, calls };
}

/** A Prisma client that records its transactions; the reads a hand-over and a citation make. */
function fakeDb() {
  const statements: string[] = [];
  const tx = {
    $executeRawUnsafe: vi.fn(async (sql: string) => {
      statements.push(sql);
      return 0;
    }),
    $executeRaw: vi.fn(async () => 0),
    group: { findUnique: vi.fn(async () => ({ id: 7n })), findFirst: vi.fn(async () => null) },
    handoffRoute: { findFirst: vi.fn(async () => null) },
    routingRule: { findFirst: vi.fn(async () => null) },
    aiHandoff: { findFirst: vi.fn(async () => null) },
    knowledgeSource: {
      findMany: vi.fn(async () => [{ id: SOURCE, name: 'Yatırım rehberi' }]),
    },
  };
  const db = {
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { db: db as unknown as PrismaClient, tx, statements, transactions: db.$transaction };
}

function runner(
  engine: TurnEngine,
  options: { db?: PrismaClient; timeoutMs?: number; logger?: { error: () => void } } = {},
): ScenarioRunner {
  return new ScenarioRunner({
    db: options.db ?? fakeDb().db,
    knowledge: {} as KnowledgeService,
    llm: new MockLlmProvider(),
    maxOutputTokens: 400,
    timeoutMs: 1_000,
    maxPromptChars: 16_000,
    engine: () => engine,
    ...(options.timeoutMs !== undefined ? { scenarioTimeoutMs: options.timeoutMs } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
  });
}

describe('what every turn is handed (AI-19 §2)', () => {
  it('starts every scenario from an empty conversation, and each turn reads the state the last one left', async () => {
    const { engine, calls } = scripted([(state) => answered(state)]);
    const play = runner(engine);
    await play.play(SETTING, scenario(), { startedAt: STARTED });
    await play.play(SETTING, scenario({ key: 'other' }), { startedAt: STARTED });
    const firsts = calls.filter((call) => call.message.text === 'param yatmadı');
    expect(firsts).toHaveLength(2);
    for (const call of firsts) expect(call.state).toEqual(emptyTurnState());
    const second = calls.find((call) => call.message.text === 'Papara 13:40')!;
    expect(second.state.counters).toEqual({ turns: 1 });
    expect(second.state.activeSkillId).toBe(SKILL);
  });

  it('runs on the frozen clock: simulated_now plus 30 s a turn; without a moment, from the run’s start', async () => {
    // Answers, not questions: the script's three lines and nothing after them.
    const { engine, calls } = scripted([(state) => said(state)]);
    await runner(engine).play(SETTING, scenario(), { startedAt: STARTED });
    expect(calls.map((call) => call.ctx.now.toISOString())).toEqual([
      '2026-10-19T12:15:00.000Z',
      '2026-10-19T12:15:30.000Z',
      '2026-10-19T12:16:00.000Z',
    ]);
    calls.length = 0;
    await runner(engine).play(SETTING, scenario({ simulatedNow: null }), { startedAt: STARTED });
    expect(calls.map((call) => call.ctx.now.toISOString())).toEqual([
      '2026-10-19T09:00:00.000Z',
      '2026-10-19T09:00:30.000Z',
      '2026-10-19T09:01:00.000Z',
    ]);
    expect(turnMoment(STARTED, 4).toISOString()).toBe('2026-10-19T09:02:00.000Z');
  });

  it('hands every turn the run’s configuration and version, the tool stubs, the simulation’s meter and no chat', async () => {
    const config = {
      versionId: '4e5f6a7b-8c9d-4e0f-9a1b-2c3d4e5f6a7b',
      pkg: { skills: [], batchWindowSeconds: 5 },
      seq: 3,
    };
    const { engine, calls } = scripted([(state) => answered(state)]);
    await runner(engine).play(
      { ...SETTING, config },
      scenario({ brandId: '5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c' }),
      { startedAt: STARTED },
    );
    for (const { ctx } of calls) {
      expect(ctx).toMatchObject({
        tenant: TENANT,
        mode: 'simulation',
        chatId: null,
        configVersionId: config.versionId,
        config: config.pkg,
        toolStubs: { deposit_lookup: { found: false } },
        brandId: '5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c',
        timeZone: 'Europe/Istanbul',
        aiMode: 'ai',
        noAnswer: SETTING.noAnswer,
      });
      // A verdict must not depend on who is online when it is played.
      expect(ctx.handoffAvailable).toBeUndefined();
    }
  });

  it('plays every turn inside the simulation context, reading through a read-only transaction', async () => {
    const fake = fakeDb();
    const { engine, calls } = scripted([
      async (state, ctx) => {
        await ctx.db(async () => undefined);
        return said(state);
      },
    ]);
    await runner(engine, { db: fake.db }).play(SETTING, scenario(), { startedAt: STARTED });
    for (const call of calls) expect(call.scope).toEqual({ kind: 'test_run', licenseId: 9n });
    expect(fake.statements.filter((sql) => sql === 'SET TRANSACTION READ ONLY')).toHaveLength(3);
    expect(simulationScope()).toBeNull();
  });

  it('gives the next turn what was said as its history, with the state the conversation is in', async () => {
    const { engine, calls } = scripted([(state) => answered(state)]);
    await runner(engine).play(SETTING, scenario(), { startedAt: STARTED });
    expect(calls[0]!.message.history).toBeUndefined();
    const third = calls[2]!.message.history!;
    expect(third.messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'param yatmadı'],
      ['assistant', 'Hangi yöntemle yatırım yaptınız?'],
      ['user', 'Papara 13:40'],
      ['assistant', 'Hangi yöntemle yatırım yaptınız?'],
    ]);
  });

  it('holds a flag a turn raised for the turns after it (AI-27)', async () => {
    const { engine, calls } = scripted([
      (state) =>
        answered(state, {
          decisions: {
            guardrails: { catalog_version: '1', hits: [], risk_flags: ['rg_signal'] },
          },
        }),
      (state) => answered(state),
    ]);
    await runner(engine).play(SETTING, scenario(), { startedAt: STARTED });
    expect(calls[0]!.ctx.risk).toBeUndefined();
    expect(calls[1]!.ctx.riskFlags).toEqual(['rg_signal']);
    expect(calls[1]!.ctx.risk).toMatchObject({
      noBonusTalk: true,
      noPromotions: true,
      mustHandoff: true,
    });
  });
});

describe('when the conversation stops (AI-19 §2)', () => {
  it('on a hand-over — with the team it lands in, the trace and every check', async () => {
    const fake = fakeDb();
    const { engine, calls } = scripted([
      (state) => answered(state),
      (state) =>
        answered(state, {
          reply: 'Bilgilerinizi finans ekibimize iletiyorum.',
          decisions: {
            outcome: 'handed_off',
            replyKind: 'answer',
            handoffReason: 'expected_time_exceeded',
            handoffReasons: ['procedure_rule'],
          },
          sideEffects: [handedToFinance],
          next: {
            slots: {
              yontem: { status: 'filled', value: 'Papara', display: 'Papara', source: 'player' },
            },
          },
        }),
    ]);
    const play = await runner(engine, { db: fake.db }).play(
      SETTING,
      scenario({
        expectations: { outcome: 'handoff', team_id: 7, topic: 'finance', max_turns: 6 },
      }),
      { startedAt: STARTED },
    );
    expect(calls).toHaveLength(2);
    expect(play).toMatchObject({
      status: 'passed',
      stopReason: 'handoff',
      outcome: 'handoff',
      handoffTeamId: 7,
      capped: false,
    });
    expect(play.checks.every((check) => check.passed)).toBe(true);
    const ai = play.transcript.filter((entry) => entry.role === 'ai');
    expect(ai[1]!.trace).toEqual({
      decision: 'handoff',
      procedure: { skill_id: SKILL, name: 'Yatırım geçmedi', reason: 'intent_match' },
      slots: { yontem: 'Papara' },
      sources: [],
      guardrails: [],
      handoff: { reason: 'expected_time_exceeded', topic: 'finance', team_id: 7 },
      flags: [],
      tokens: 16,
    });
    // The team is the live order's answer, read as the turn read.
    expect(fake.tx.group.findUnique).toHaveBeenCalled();
  });

  it('on a resolution the AI claims (K9) — its waiting outcome too', async () => {
    const { engine } = scripted([
      (state) => answered(state),
      (state) =>
        answered(state, {
          reply: 'Biraz bekleyelim.',
          decisions: { replyKind: 'answer', resolution: resolved('resolved_waiting') },
        }),
    ]);
    const play = await runner(engine).play(
      SETTING,
      scenario({ expectations: { outcome: 'resolved_waiting', max_turns: 6 } }),
      { startedAt: STARTED },
    );
    expect(play).toMatchObject({
      status: 'passed',
      stopReason: 'resolved',
      outcome: 'resolved_waiting',
    });
    expect(play.transcript.filter((entry) => entry.role === 'player')).toHaveLength(2);
  });

  it('at max_turns AI turns, with the turn count failing', async () => {
    const { engine, calls } = scripted([(state) => answered(state)]);
    const play = await runner(engine).play(
      SETTING,
      scenario({ expectations: { outcome: 'handoff', max_turns: 2 } }),
      { startedAt: STARTED },
    );
    expect(calls).toHaveLength(2);
    expect(play).toMatchObject({ status: 'failed', stopReason: 'max_turns', outcome: null });
    expect(play.checks.find((check) => check.kind === 'turn_count')).toMatchObject({
      passed: false,
      detail: 'stopped by max_turns before the conversation ended',
    });
  });

  it('when the script runs out — after "I don’t know" to the AI’s open questions', async () => {
    const { engine, calls } = scripted([(state) => answered(state)]);
    const play = await runner(engine).play(SETTING, scenario({ turns: ['param yatmadı'] }), {
      startedAt: STARTED,
    });
    // One line, then "Bilmiyorum." twice to the AI's questions, then nothing.
    expect(calls.map((call) => call.message.text)).toEqual([
      'param yatmadı',
      'Bilmiyorum.',
      'Bilmiyorum.',
    ]);
    expect(play).toMatchObject({ stopReason: 'script_end', status: 'failed' });
  });

  it('never past the most lines a player says, whatever the AI does', async () => {
    // The AI never takes a turn, so `max_turns` never counts one.
    const { engine, calls } = scripted([
      (state) => ({
        reply: null,
        decisions: decisions({
          outcome: 'skipped',
          skillId: null,
          skillName: null,
          replyKind: null,
        }),
        nextState: state,
        sideEffects: [],
      }),
    ]);
    const lines = Array.from({ length: 40 }, (_, i) => `satır ${i + 1}`);
    const play = await runner(engine).play(SETTING, scenario({ turns: lines }), {
      startedAt: STARTED,
    });
    expect(calls).toHaveLength(PLAYER_LINES_MAX);
    expect(play.stopReason).toBe('max_turns');
    // A turn the AI did not take leaves no AI line in the transcript.
    expect(play.transcript.filter((entry) => entry.role === 'ai')).toEqual([]);
  });

  it('past its time limit: errored, saying so', async () => {
    const { engine } = scripted([
      async (state) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return answered(state);
      },
    ]);
    const play = await runner(engine, { timeoutMs: 40 }).play(SETTING, scenario(), {
      startedAt: STARTED,
    });
    expect(play).toMatchObject({ status: 'errored', stopReason: 'timeout' });
    expect(play.transcript.at(-1)).toMatchObject({
      role: 'system',
      text: SIMULATION_NOTES.timeout,
    });
  });

  it('on a turn that throws: errored, and the log has it', async () => {
    const error = vi.fn();
    const { engine } = scripted([
      () => {
        throw new Error('boom');
      },
    ]);
    const play = await runner(engine, { logger: { error } }).play(SETTING, scenario(), {
      startedAt: STARTED,
    });
    expect(play).toMatchObject({ status: 'errored', stopReason: 'error' });
    expect(play.transcript.at(-1)).toMatchObject({ role: 'system', text: SIMULATION_NOTES.error });
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ scenario_key: SCENARIO, license_id: '9' }),
      'a test scenario could not be played',
    );
  });

  it('on a model failure: errored, naming the failure’s kind and nothing of the provider’s', async () => {
    const { engine } = scripted([
      (state) =>
        answered(state, {
          reply: null,
          decisions: {
            outcome: 'handed_off',
            failure: {
              provider: 'llm',
              kind: 'timeout',
              transient: true,
              status: null,
              code: null,
              requestId: null,
              reason: null,
            },
          },
        }),
    ]);
    const play = await runner(engine).play(SETTING, scenario(), { startedAt: STARTED });
    expect(play).toMatchObject({ status: 'errored', stopReason: 'error', capped: false });
    expect(play.transcript.at(-1)).toMatchObject({
      role: 'system',
      text: SIMULATION_NOTES.failed('llm: timeout'),
    });
  });

  it('on the test allowance spent: errored and capped — the run plays nothing more today', async () => {
    const { engine } = scripted([
      (state) =>
        answered(state, {
          reply: null,
          decisions: {
            outcome: 'handed_off',
            capped: new AiDailyCapError('llm_test', 'workspace', 60),
          },
        }),
    ]);
    const play = await runner(engine).play(SETTING, scenario(), { startedAt: STARTED });
    expect(play).toMatchObject({ status: 'errored', stopReason: 'error', capped: true });
    expect(play.transcript.at(-1)).toMatchObject({ text: SIMULATION_NOTES.capped });
  });
});

describe('what the transcript keeps', () => {
  it('each player line and AI turn on the frozen clock, the AI’s with its trace; the tokens summed', async () => {
    const { engine } = scripted([
      (state) =>
        answered(state, {
          decisions: {
            knowledge: { grounded: 'full', cited_ids: ['c1'], source_ids: [SOURCE] },
            guardrails: {
              catalog_version: '1',
              hits: [
                {
                  rule_key: 'G4',
                  stage: 'output',
                  action: 'rewrite',
                  evidence: 'bonus',
                  pattern_index: 0,
                },
                {
                  rule_key: 'G4',
                  stage: 'output',
                  action: 'rewrite',
                  evidence: 'promosyon',
                  pattern_index: 1,
                },
              ],
              risk_flags: [],
            },
            policy: { step: 3, rule: 'start', high: 0.8, low: 0.5 },
          },
        }),
    ]);
    const play = await runner(engine).play(SETTING, scenario({ turns: ['param yatmadı'] }), {
      startedAt: STARTED,
    });
    expect(play.transcript[0]).toEqual({
      role: 'player',
      text: 'param yatmadı',
      at: '2026-10-19T12:15:00.000Z',
    });
    expect(play.transcript[1]).toMatchObject({
      role: 'ai',
      text: 'Hangi yöntemle yatırım yaptınız?',
      at: '2026-10-19T12:15:00.000Z',
      trace: {
        decision: 'asked',
        procedure: { skill_id: SKILL, reason: 'start' },
        sources: [{ source_id: SOURCE, title: 'Yatırım rehberi', page: null }],
        // One line per rule and action; the evidence stays out.
        guardrails: [{ rule_key: 'G4', action: 'rewrite' }],
      },
    });
    // Three AI turns (the script, then two "Bilmiyorum."), 16 tokens each; a script costs none.
    expect(play.tokens).toBe(48);
  });

  it('a simulated player’s lines are the fast model’s (the mock in every suite), masked', async () => {
    const { engine, calls } = scripted([(state) => answered(state)]);
    const play = await runner(engine).play(
      SETTING,
      scenario({
        mode: 'simulated',
        turns: [],
        goal: 'Papara ile yaptığım yatırım hesaba geçmedi.',
        facts: { yontem: 'Papara', saat: '13:40' },
        expectations: { outcome: 'handoff', max_turns: 3 },
      }),
      { startedAt: STARTED },
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]!.message.text).toContain('Papara');
    const players = play.transcript.filter((entry) => entry.role === 'player');
    expect(players.length).toBe(calls.length);
  });
});
