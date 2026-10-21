/**
 * The scenario runner (tm 314.2 · SiyahTuş analysis AI-19 §2 "Koşu döngüsü"):
 * plays one test scenario through the live engine and judges it.
 *
 *   - **An empty conversation per scenario.** Every scenario starts from
 *     `emptyTurnState()` — what a new connection's row holds — in memory; two
 *     scenarios share nothing but the configuration.
 *   - **The configuration on every turn.** The run's configuration — the draft
 *     or the published one, read once for the run through the one seam
 *     (`AiConfigSource.forSimulation`) — goes with every turn with its version
 *     id, as a conversation's pinned version goes with every live turn.
 *   - **A frozen clock.** Turn n is taken at `simulated_now + n × 30 s`
 *     (`AI_TEST_TURN_SPACING_SECONDS`); a scenario without a moment starts
 *     when its run did. Time conditions read nothing else (`TurnContext.now`).
 *   - **Tool stubs.** The scenario's `tool_outputs` are the turn's
 *     `toolStubs` (AI-28): what a tool step would have returned.
 *   - **When it stops.** The engine handed over or resolved (`turnEnding`),
 *     `max_turns` AI turns were taken, the player had nothing more to say,
 *     60 s passed (`AI_TEST_SCENARIO_TIMEOUT_MS`), or a turn could not be
 *     played — the model failed, the test allowance was spent, an error.
 *
 * Every turn and every line of the player's runs inside the simulation context
 * (`lib/simulation-context.ts`) over a read-only tenant transaction: what the
 * turn would do to a conversation is recorded in the transcript and never
 * applied, and its tokens are counted on the test meter (`mode: 'simulation'`,
 * AI-19-S2). What the turns returned goes to the hard checks (`checks.ts`) as
 * it came.
 *
 * Mirrored from the live adapter (`ai-responder.ts`), so a scenario plays as a
 * conversation would: the connection is the AI's (`aiMode: 'ai'`); what was
 * said before is the turn's history; a risk flag a turn raised holds for the
 * turns after it (AI-27 §3); the workspace's zone and the agent's no-answer
 * setting are read as a live turn reads them. Not mirrored, because a verdict
 * must not depend on when it was run: whether anyone is accepting chats
 * (`handoffAvailable` stays unknown), and a day of earlier connections — a
 * simulated player has none.
 */
import type { PrismaClient } from '@prisma/client';
import {
  AI_TEST_SCENARIO_TIMEOUT_MS,
  AI_TEST_SCENARIO_TURNS_MAX,
  AI_TEST_TURN_SPACING_SECONDS,
  RISK_FLAG_DEFAULTS,
  readNoAnswerSettings,
  riskPolicy,
  type AiNoAnswerSettings,
  type AiTestCheck,
  type AiTestResultStatus,
  type AiTestStopReason,
  type AiTestTranscriptEntry,
  type AiTestTurnTrace,
  type RiskFlagType,
  type RiskPolicy,
  type ScenarioOutcome,
} from '@siyahtus/types';
import { runInSimulation, type SimulationScope } from '../../../lib/simulation-context.js';
import { withTenant, type TenantClient, type TenantContext } from '../../../lib/tenant.js';
import { readDayBoundary } from '../../chat/day-boundary.js';
import type {
  AccessAnswer,
  AccessInfoRead,
  AccessInfoSource,
} from '../../knowledge-tables/access-info.js';
import { AiDailyCapError } from '../ai-daily-budget.js';
import {
  DEFAULT_HISTORY_BUDGET,
  exchangeHistory,
  type ExchangeRole,
  type HistoryBudget,
} from '../conversation/context-loader.js';
import { ConversationEngine } from '../conversation/conversation-engine.js';
import { KnowledgeTableFacts } from '../conversation/facts.js';
import { readAndCompile, type AiConfigRead } from '../conversation/turn-config.js';
import {
  emptyTurnState,
  handoffOf,
  tookTurn,
  type TenantRunner,
  type TurnContext,
  type TurnMessage,
  type TurnResult,
  type TurnSideEffect,
  type TurnState,
} from '../conversation/turn.js';
import { resolveSimulatedTarget } from '../handoff-service.js';
import type { KnowledgeService } from '../knowledge-service.js';
import type { MeteredLlm } from '../metered-llm.js';
import { ProcedureExamples } from '../procedure-examples.js';
import type { LlmProvider } from '../provider/llm-provider.js';
import {
  resultStatus,
  runChecks,
  scenarioEnding,
  turnEnding,
  type CheckedScenario,
  type PlayedTurn,
} from './checks.js';
import { playerFor, SCRIPT_UNKNOWN_MAX, type PlayerScenario } from './simulated-player.js';
import { sourceTitles, turnTokens, turnTrace } from './trace.js';

/** The most lines one player says: a whole script and its "I don't know"s. */
export const PLAYER_LINES_MAX = AI_TEST_SCENARIO_TURNS_MAX + SCRIPT_UNKNOWN_MAX;

/**
 * What the transcript says, as a `system` line, when a scenario could not be
 * played to its end. Codes and kinds only — never a provider's words.
 */
export const SIMULATION_NOTES = {
  timeout: 'The scenario ran out of time and was stopped.',
  capped: "Today's test allowance is spent; the scenario was stopped.",
  error: 'The scenario could not be played; the server log has the error.',
  failed: (what: string) => `The AI could not answer (${what}); the scenario was stopped.`,
} as const;

/** The conversation a simulated turn's risk flags are raised in — no chat of the workspace's. */
const SIMULATED_CHAT = 'simulation';

/** Where a run plays: the workspace, the agent, its configuration and what a live turn reads besides. */
export interface SimulationSetting {
  readonly tenant: TenantContext;
  readonly aiAgentId: string;
  /** The configuration every turn runs on, and its version — read once for a run. */
  readonly config: AiConfigRead;
  /** The workspace's zone (`inbox_settings.day_boundary_tz`). */
  readonly timeZone: string;
  /** The agent's `no_answer` setting (AI-06 §8). */
  readonly noAnswer: AiNoAnswerSettings;
}

/** A scenario as the runner plays it: a workspace's (`ai_test_scenarios`) or the compliance pack's. */
export interface SimulatedScenario extends PlayerScenario, CheckedScenario {
  /** The result's `scenario_key`: the scenario's id, or `compliance:G<n>:<lang>`. */
  readonly key: string;
  readonly name: string;
  /** The frozen clock's start; null — the run's start. */
  readonly simulatedNow: Date | null;
  /** What a tool step would have returned, by tool key (AI-28). */
  readonly toolOutputs: Readonly<Record<string, unknown>>;
  /** The brand the conversation comes in through; null — not known. */
  readonly brandId: string | null;
}

/** One played scenario: its verdict and what the result row keeps. */
export interface ScenarioPlay {
  readonly status: AiTestResultStatus;
  readonly stopReason: AiTestStopReason;
  readonly outcome: ScenarioOutcome | null;
  /** The team its hand-over went to; null — none, or routing decides. */
  readonly handoffTeamId: number | null;
  readonly transcript: AiTestTranscriptEntry[];
  readonly checks: AiTestCheck[];
  /** The player's and the turns' tokens, counted on the test meter. */
  readonly tokens: number;
  readonly durationMs: number;
  /** Today's test allowance refused a call: nothing more can be played today. */
  readonly capped: boolean;
}

/** One simulated turn's input — a run's, or a sandbox session's. */
export interface SimulatedTurnInput {
  readonly state: TurnState;
  /** What was said before the message, oldest first. */
  readonly transcript: readonly AiTestTranscriptEntry[];
  /** The player's message, masked (AI-26). */
  readonly text: string;
  /** The turn's clock. */
  readonly at: Date;
  readonly brandId: string | null;
  readonly toolStubs: Readonly<Record<string, unknown>>;
  /** The risk flags the conversation's earlier turns raised: they hold for this one. */
  readonly raised: ReadonlySet<RiskFlagType>;
}

export interface SimulatedTurn {
  readonly result: TurnResult;
  /** Where its hand-over would land; null — routing decides. Absent: no hand-over. */
  readonly teamId?: number | null;
  /** What its access answers said, verbatim (K13) — G14 lets them through. */
  readonly access: readonly string[];
  readonly trace: AiTestTurnTrace;
}

export interface SimulationLogger {
  error(object: Record<string, unknown>, message: string): void;
}

/** What plays a turn: the live engine (`ConversationEngine`), or a test's. */
export interface TurnEngine {
  runTurn(state: TurnState, message: TurnMessage, ctx: TurnContext): Promise<TurnResult>;
}

export interface ScenarioRunnerDeps {
  readonly db: PrismaClient;
  readonly knowledge: KnowledgeService;
  /** The server's `MeteredLlm`; a bare provider counts nothing (a unit test's). */
  readonly llm: LlmProvider | MeteredLlm;
  /** `LLM_MAX_OUTPUT_TOKENS`, `LLM_TIMEOUT_MS`, `LLM_MAX_PROMPT_CHARS`. */
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly maxPromptChars: number;
  /** `AI_HISTORY_MAX_MESSAGES`, `AI_HISTORY_MAX_CHARS`. */
  readonly historyBudget?: HistoryBudget;
  /** The server's access information (K13); absent — none, as for an engine built without it. */
  readonly access?: AccessInfoSource;
  /** One scenario's wall-clock limit — {@link AI_TEST_SCENARIO_TIMEOUT_MS}; a test shortens it. */
  readonly scenarioTimeoutMs?: number;
  readonly logger?: SimulationLogger;
  /**
   * The engine a scenario plays on, given its access source. Absent: the live
   * `ConversationEngine` over these deps — a unit test hands in its own.
   */
  readonly engine?: (access: AccessInfoSource | undefined) => TurnEngine;
}

/** What a run plays on, read once in the run's transaction. */
export async function readSimulationSetting(
  tx: TenantClient,
  tenant: TenantContext,
  input: { aiAgentId: string; target: 'draft' | 'published' },
): Promise<SimulationSetting> {
  const config = await readAndCompile.forSimulation(tx, input);
  const { timezone } = await readDayBoundary(tx);
  const handoff = await tx.aiHandoffSettings.findUnique({
    where: { aiAgentId: input.aiAgentId },
    select: { noAnswer: true },
  });
  return {
    tenant,
    aiAgentId: input.aiAgentId,
    config,
    timeZone: timezone,
    noAnswer: readNoAnswerSettings(handoff?.noAnswer ?? null),
  };
}

/** Turn `index`'s moment on the frozen clock. */
export function turnMoment(origin: Date, index: number): Date {
  return new Date(origin.getTime() + index * AI_TEST_TURN_SPACING_SECONDS * 1000);
}

/** What the conversation's raised flags mean for its next turn (AI-27 §3) — as its own flags. */
function raisedRisk(raised: ReadonlySet<RiskFlagType>): RiskPolicy {
  return riskPolicy(
    [...raised].map((type) => ({
      type,
      scope: RISK_FLAG_DEFAULTS[type].scope,
      chat_id: SIMULATED_CHAT,
    })),
    SIMULATED_CHAT,
  );
}

/** The transcript as the turn's history reads it: the player's and the AI's words. */
function exchangeOf(
  transcript: readonly AiTestTranscriptEntry[],
): Array<{ role: ExchangeRole; text: string }> {
  return transcript.flatMap((entry): Array<{ role: ExchangeRole; text: string }> =>
    entry.role === 'player'
      ? [{ role: 'visitor', text: entry.text }]
      : entry.role === 'ai' && entry.text !== ''
        ? [{ role: 'ai', text: entry.text }]
        : [],
  );
}

class ScenarioTimeout extends Error {
  constructor() {
    super('the scenario ran out of time');
    this.name = 'ScenarioTimeout';
  }
}

/**
 * `work`, or {@link ScenarioTimeout} once `deadline` passes. The work goes on
 * in the background — a turn cannot be called back — and what it returns is
 * dropped; it is still inside the simulation context, so it writes nothing.
 */
async function within<T>(deadline: number, work: Promise<T>): Promise<T> {
  const left = deadline - performance.now();
  if (left <= 0) throw new ScenarioTimeout();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ScenarioTimeout()), left);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The server's access source, keeping what it answered for the checks (G14). */
class AccessRecorder implements AccessInfoSource {
  #said: string[] = [];

  constructor(private readonly source: AccessInfoSource) {}

  async resolve(input: AccessInfoRead): Promise<AccessAnswer> {
    const answer = await this.source.resolve(input);
    if (answer.kind === 'answer') this.#said.push(answer.text);
    return answer;
  }

  /** What was said since the last call. */
  take(): string[] {
    const said = this.#said;
    this.#said = [];
    return said;
  }
}

type Handoff = Extract<TurnSideEffect, { kind: 'handoff' }>;

export class ScenarioRunner {
  readonly #deps: ScenarioRunnerDeps;
  readonly #tables = new KnowledgeTableFacts();
  readonly #examples = new ProcedureExamples();
  readonly #historyBudget: HistoryBudget;
  readonly #timeoutMs: number;

  constructor(deps: ScenarioRunnerDeps) {
    this.#deps = deps;
    this.#historyBudget = deps.historyBudget ?? DEFAULT_HISTORY_BUDGET;
    this.#timeoutMs = deps.scenarioTimeoutMs ?? AI_TEST_SCENARIO_TIMEOUT_MS;
  }

  /** Play one scenario to its end and judge it. Never throws for the scenario's sake: it errors. */
  async play(
    setting: SimulationSetting,
    scenario: SimulatedScenario,
    options: { startedAt: Date },
  ): Promise<ScenarioPlay> {
    const started = performance.now();
    const deadline = started + this.#timeoutMs;
    const origin = scenario.simulatedNow ?? options.startedAt;
    const scope: SimulationScope = { kind: 'test_run', licenseId: setting.tenant.licenseId };
    const recorder = this.#deps.access ? new AccessRecorder(this.#deps.access) : null;
    const engine = this.#engine(recorder);
    const deps = this.#deps;
    const player = playerFor(scenario, {
      llm: deps.llm,
      tenant: setting.tenant,
      configVersionId: setting.config.versionId,
      maxOutputTokens: deps.maxOutputTokens,
      timeoutMs: deps.timeoutMs,
      maxPromptChars: deps.maxPromptChars,
    });

    const transcript: AiTestTranscriptEntry[] = [];
    const played: PlayedTurn[] = [];
    const raised = new Set<RiskFlagType>();
    let state = emptyTurnState();
    let tokens = 0;
    let aiTurns = 0;
    let capped = false;
    let stop: AiTestStopReason = 'script_end';

    for (let index = 0; ; index += 1) {
      const at = turnMoment(origin, index);
      const note = (text: string): void => {
        transcript.push({ role: 'system', text, at: at.toISOString() });
      };
      if (index >= PLAYER_LINES_MAX) {
        stop = 'max_turns';
        break;
      }
      let turn: SimulatedTurn;
      try {
        const line = await within(
          deadline,
          runInSimulation(scope, () => player.next(transcript)),
        );
        tokens += line.usage.inputTokens + line.usage.outputTokens;
        if (line.text === null) {
          stop = 'script_end';
          break;
        }
        const earlier = [...transcript];
        transcript.push({ role: 'player', text: line.text, at: at.toISOString() });
        turn = await within(
          deadline,
          this.#turn(engine, recorder, setting, scope, {
            state,
            transcript: earlier,
            text: line.text,
            at,
            brandId: scenario.brandId,
            toolStubs: scenario.toolOutputs,
            raised,
          }),
        );
        played.push({
          message: line.text,
          result: turn.result,
          ...(turn.teamId !== undefined ? { teamId: turn.teamId } : {}),
          ...(turn.access.length > 0 ? { access: turn.access } : {}),
        });
      } catch (error) {
        stop = error instanceof ScenarioTimeout ? 'timeout' : 'error';
        if (error instanceof ScenarioTimeout) note(SIMULATION_NOTES.timeout);
        else if (error instanceof AiDailyCapError) {
          capped = true;
          note(SIMULATION_NOTES.capped);
        } else {
          note(SIMULATION_NOTES.error);
          deps.logger?.error(
            {
              err: error,
              scenario_key: scenario.key,
              license_id: String(setting.tenant.licenseId),
            },
            'a test scenario could not be played',
          );
        }
        break;
      }

      const { result } = turn;
      tokens += turnTokens(result);
      if (tookTurn(result)) {
        aiTurns += 1;
        transcript.push({
          role: 'ai',
          text: result.reply ?? '',
          at: at.toISOString(),
          trace: turn.trace,
        });
      }
      for (const flag of turn.trace.flags) raised.add(flag);
      state = result.nextState;

      if (result.decisions.capped) {
        capped = true;
        stop = 'error';
        note(SIMULATION_NOTES.capped);
        break;
      }
      const failure = result.decisions.failure;
      if (failure) {
        stop = 'error';
        note(SIMULATION_NOTES.failed(`${failure.provider}: ${failure.kind}`));
        break;
      }
      const ending = turnEnding(result);
      if (ending) {
        stop = ending === 'handoff' ? 'handoff' : 'resolved';
        break;
      }
      if (aiTurns >= scenario.expectations.max_turns) {
        stop = 'max_turns';
        break;
      }
    }

    const guardrails = setting.config.pkg.guardrails;
    const checks = runChecks(
      scenario,
      { turns: played, stop },
      {
        aiAgentId: setting.aiAgentId,
        brandId: scenario.brandId,
        ...(guardrails ? { guardrails } : {}),
      },
    );
    const ending = scenarioEnding(played);
    const endTurn = ending.turn === null ? null : played[ending.turn]!;
    let handoffTeamId: number | null = null;
    if (ending.outcome === 'handoff' && endTurn) {
      handoffTeamId =
        endTurn.teamId !== undefined
          ? endTurn.teamId
          : (handoffOf(endTurn.result.sideEffects)?.groupId ?? null);
    }
    return {
      status: resultStatus(stop, checks),
      stopReason: stop,
      outcome: ending.outcome,
      handoffTeamId,
      transcript,
      checks,
      tokens,
      durationMs: Math.round(performance.now() - started),
      capped,
    };
  }

  /**
   * One turn on a person's message — the sandbox's "talk like a player"
   * (AI-19 §8): the same turn a run takes, in the same context.
   */
  async turn(setting: SimulationSetting, input: SimulatedTurnInput): Promise<SimulatedTurn> {
    const recorder = this.#deps.access ? new AccessRecorder(this.#deps.access) : null;
    const scope: SimulationScope = { kind: 'sandbox', licenseId: setting.tenant.licenseId };
    return this.#turn(this.#engine(recorder), recorder, setting, scope, input);
  }

  /** The live engine, with the server's sources — and an access source that records. */
  #engine(access: AccessRecorder | null): TurnEngine {
    const deps = this.#deps;
    if (deps.engine) return deps.engine(access ?? undefined);
    return new ConversationEngine({
      knowledge: deps.knowledge,
      llm: deps.llm,
      maxOutputTokens: deps.maxOutputTokens,
      timeoutMs: deps.timeoutMs,
      maxPromptChars: deps.maxPromptChars,
      procedureExamples: this.#examples,
      facts: this.#tables,
      tables: this.#tables,
      ...(access ? { access } : {}),
    });
  }

  /** A read-only tenant transaction: what a simulated turn reads through. */
  #reads(tenant: TenantContext): TenantRunner {
    return (fn) => withTenant(this.#deps.db, tenant, fn, { readOnly: true });
  }

  async #turn(
    engine: TurnEngine,
    recorder: AccessRecorder | null,
    setting: SimulationSetting,
    scope: SimulationScope,
    input: SimulatedTurnInput,
  ): Promise<SimulatedTurn> {
    const reads = this.#reads(setting.tenant);
    const history = exchangeHistory(exchangeOf(input.transcript), this.#historyBudget, input.state);
    const ctx: TurnContext = {
      tenant: setting.tenant,
      db: reads,
      now: input.at,
      mode: 'simulation',
      chatId: null,
      brandId: input.brandId,
      configVersionId: setting.config.versionId,
      config: setting.config.pkg,
      toolStubs: input.toolStubs,
      timeZone: setting.timeZone,
      aiMode: 'ai',
      noAnswer: setting.noAnswer,
      ...(input.raised.size > 0
        ? { risk: raisedRisk(input.raised), riskFlags: [...input.raised] }
        : {}),
    };
    recorder?.take();
    return runInSimulation(scope, async () => {
      const result = await engine.runTurn(
        input.state,
        { text: input.text, ...(history ? { history } : {}) },
        ctx,
      );
      const access = recorder?.take() ?? [];
      const handoff = handoffOf(result.sideEffects);
      // Where the hand-over lands and what the cited sources are called — read
      // as the turn read, and only when there is something to read.
      const cited = (result.decisions.knowledge?.source_ids.length ?? 0) > 0;
      const { teamId, titles } =
        handoff || cited
          ? await reads(async (tx) => ({
              teamId: handoff ? await this.#teamOf(tx, setting, handoff, input.brandId) : undefined,
              titles: await sourceTitles(tx, [result]),
            }))
          : { teamId: undefined, titles: new Map<string, string>() };
      return {
        result,
        ...(teamId !== undefined ? { teamId } : {}),
        access,
        trace: turnTrace(result, { teamId: teamId ?? null, titles }),
      };
    });
  }

  /** Where a hand-over would land, by the live order (AI-12), read-only. */
  async #teamOf(
    tx: TenantClient,
    setting: SimulationSetting,
    handoff: Handoff,
    brandId: string | null,
  ): Promise<number | null> {
    const target = await resolveSimulatedTarget(
      tx,
      setting.tenant.licenseId,
      handoff,
      setting.config.pkg.handoff?.routes ?? [],
      brandId,
    );
    return target.groupId === null ? null : Number(target.groupId);
  }
}
