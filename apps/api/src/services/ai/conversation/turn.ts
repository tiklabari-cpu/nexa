/**
 * The turn contract (tm 292.2 · SiyahTuş analysis AI-01, AI-19).
 *
 *   runTurn(state, message, ctx) → { reply, decisions, nextState, sideEffects }
 *
 * One turn is the AI reading one visitor message against where the
 * conversation stands and deciding what to do. The function that does it
 * (`ConversationEngine.runTurn`) writes nothing: what the turn would change is
 * *returned* — the reply, the hand-over, the tags, the summary, the next
 * state — and whoever called it decides what happens to that. The live
 * adapter (`AiResponder`) applies it to the conversation; the editor's
 * preview shows it; the multi-turn simulator (AI-19) will only record it.
 * Because all three run the same function, a preview or a simulation cannot
 * promise behaviour the live conversation does not have.
 *
 * What the turn may still do is read (the knowledge search) and spend (the
 * model and embedding calls, each counted against the daily caps on the meter
 * `ctx.mode` names). Spending is not a side effect in this sense: it is the
 * cost of thinking, and a simulation is counted on its own meter.
 *
 * The state is the part of the `ai_conversations` row a turn reads and
 * writes ({@link TurnState}); the row's identity, its lock counter and its
 * pinned configuration version stay with the store (`state-store.ts`).
 */
import type {
  DailyMemorySettings,
  Persona,
  SkillMode,
  SkillProcedureFields,
} from '@siyahtus/types';
import type { TenantClient, TenantContext } from '../../../lib/tenant.js';
import type { AiDailyCapError } from '../ai-daily-budget.js';
import type { EmbeddingFailureKind } from '../provider/embedding-error.js';
import type { LlmFailureKind } from '../provider/llm-error.js';
import type { LlmMessage } from '../provider/llm-provider.js';
import type { EarlierToday } from './daily-memory.js';
import type { ProcedureFacts } from './procedure/conditions.js';
import type { StepDecision } from './procedure/executor.js';
import type { ProcedureUnderstanding } from './procedure/understanding.js';
import type { SlotAttachment } from './slots/extract.js';
import type { SlotEnumOption } from './slots/validators.js';
import type {
  AiConversationPatch,
  AiConversationPatchField,
  AiConversationState,
  AiStateObject,
} from './state-store.js';

/**
 * Runs `fn` in a tenant-scoped transaction — `request.withTenant`, in the
 * shape a turn needs so each database step gets its own short transaction and
 * the model call waits in none of them.
 */
export type TenantRunner = <T>(fn: (tx: TenantClient) => Promise<T>) => Promise<T>;

/** The `ai_conversations` fields a turn reads and may change. */
export const TURN_STATE_FIELDS = [
  'mode',
  'activeSkillId',
  'procedureSnapshot',
  'procedureSnapshotHash',
  'stepId',
  'stepStatus',
  'slots',
  'suspended',
  'counters',
  'signals',
  'digest',
  'outcome',
  'lastProcessedEventSeq',
] as const satisfies ReadonlyArray<AiConversationPatchField>;
export type TurnStateField = (typeof TURN_STATE_FIELDS)[number];

/** Where the conversation stands, as a turn sees it. */
export type TurnState = Pick<AiConversationState, TurnStateField>;

/**
 * A conversation the AI has not opened: what a new `ai_conversations` row
 * holds (the column defaults). A simulation starts every scenario here.
 */
export function emptyTurnState(): TurnState {
  return {
    mode: 'ai',
    activeSkillId: null,
    procedureSnapshot: null,
    procedureSnapshotHash: null,
    stepId: null,
    stepStatus: null,
    slots: {},
    suspended: null,
    counters: {},
    signals: {},
    digest: null,
    outcome: null,
    lastProcessedEventSeq: 0,
  };
}

/** The turn's view of a stored conversation — the row without its identity and lock. */
export function toTurnState(row: AiConversationState): TurnState {
  return Object.fromEntries(TURN_STATE_FIELDS.map((field) => [field, row[field]])) as TurnState;
}

/**
 * The fields `after` changed, as a store patch. Compared by value, so a
 * structured column rebuilt with the same content is not a change.
 */
export function turnStatePatch(before: TurnState, after: TurnState): AiConversationPatch {
  const patch: Record<string, unknown> = {};
  for (const field of TURN_STATE_FIELDS) {
    if (!sameValue(before[field], after[field])) patch[field] = after[field];
  }
  return patch as AiConversationPatch;
}

/** How many turns the AI has taken on the conversation (AI-03 §6 `counters.turns`). */
export function turnsTaken(state: TurnState): number {
  const turns = (state.counters as AiStateObject)['turns'];
  return typeof turns === 'number' && Number.isInteger(turns) && turns >= 0 ? turns : 0;
}

/**
 * What came before the message on its connection, as the context loader
 * (`context-loader.ts`, tm 292.3) built it. Masked at the source; never logged.
 */
export interface TurnHistory {
  /**
   * The earlier exchange, oldest first, cut to the history budget: the
   * visitor's messages as `user`, the AI's and agents' as `assistant`,
   * consecutive ones of a role merged. The visitor's opening message is first
   * whenever the connection has one.
   */
  readonly messages: readonly LlmMessage[];
  /** Short timed notes of what happened to the connection ("Chat transferred"). */
  readonly systemNotes: readonly string[];
  /** What the conversation has settled — the step and the slots; empty when nothing is. */
  readonly stateDigest: string;
  /** Earlier messages were left out to fit the budget. */
  readonly omitted: boolean;
  /** How many of the visitor's earlier messages the history holds, before merging. */
  readonly visitorMessages: number;
}

/**
 * What the visitor said that the turn answers — every message they wrote since
 * the last turn, merged (AI-01 §4). Masked at the source; never logged.
 */
export interface TurnMessage {
  readonly text: string;
  /** The conversation so far; absent on a turn with none (a preview, a first message). */
  readonly history?: TurnHistory;
  /**
   * The connection's `event_sequence` of the newest visitor message in `text`
   * (tm 292.4). A turn the AI takes records it as the next state's
   * `lastProcessedEventSeq` — the messages up to it are answered, and the jobs
   * they set off find nothing left to do. Absent outside a live connection.
   */
  readonly throughSeq?: number;
  /**
   * The day's earlier connections, on a connection's first turn (tm 294 ·
   * AI-02), already cut to what the visitor's identity allows. Absent on
   * later turns, outside a live connection, and with the agent's same-day
   * memory off.
   */
  readonly earlierToday?: EarlierToday;
  /**
   * Files the visitor sent with `text` — what fills a procedure's `file` slot
   * (AI-04 §8): received, never read. Absent: none.
   */
  readonly attachments?: readonly SlotAttachment[];
}

/**
 * Who the turn is for, and so where its spend is counted:
 *
 *   - `live`       — a visitor's message; spend on the AI Agent's meter.
 *   - `preview`    — the skill editor's dry run (FR-MOD-06.2.5); the AI
 *                    Agent's meter too, as it always was: a real call on the
 *                    deployment's key.
 *   - `simulation` — a test scenario (AI-19); counted on the test meter, so
 *                    testing never eats the live allowance.
 */
export const TURN_MODES = ['live', 'preview', 'simulation'] as const;
export type TurnMode = (typeof TURN_MODES)[number];

/** One AI skill the turn may run, as the configuration holds it. */
export interface TurnSkill {
  readonly id: string;
  readonly name: string;
  readonly aiAgentId: string | null;
  /** The skill's stored step list, unvalidated: a malformed one is skipped, never fatal. */
  readonly steps: unknown;
  /** The persona of the agent that owns the skill (FR-MOD-06.4). */
  readonly persona: Persona;
  /** `single` when absent — the step list above is what runs (tm 296.2). */
  readonly mode?: SkillMode;
  /**
   * A `procedure` skill's definition as stored (tm 296.3): its own fields and
   * its `procedure`, unvalidated — `validateSkillProcedure` reads them, and a
   * definition that does not pass is skipped like a malformed step list.
   */
  readonly definition?: SkillProcedureFields;
  /** A locked template copy (AI-15): it goes before every other topic. */
  readonly locked?: boolean;
}

/**
 * The configuration a turn runs on (ADR-14b §2.6). The caller resolves it —
 * the live tables today (`turn-config.ts`), the pinned published package once
 * versions exist (tm 316), the draft for a simulation — so the turn never
 * reads configuration tables itself.
 */
export interface TurnConfig {
  /** In the order they are tried; the first that matches is the only one that runs. */
  readonly skills: readonly TurnSkill[];
  /**
   * How long the AI waits for the visitor to stop typing, in seconds — the
   * agent's own setting (`batch_window_seconds`). Absent when no agent set one:
   * the workspace default (`AI_BATCH_WINDOW_MS`) applies. With several agents
   * the longest wins; the wait comes before any skill is picked.
   */
  readonly batchWindowSeconds?: number;
  /**
   * The agents' same-day memory setting (`daily_memory`, tm 294). Absent: the
   * default (`DEFAULT_DAILY_MEMORY`). With several agents the stricter one
   * wins — off if any is off, `on_topic_only` if any asks for it.
   */
  readonly dailyMemory?: DailyMemorySettings;
}

export interface TurnContext {
  readonly tenant: TenantContext;
  /** For reads (the knowledge search). A turn never writes through it. */
  readonly db: TenantRunner;
  /**
   * The turn's clock. Time conditions (AI-03 `elapsed_minutes`) read this,
   * never the wall clock, so a simulation can run a scenario at any hour.
   */
  readonly now: Date;
  readonly mode: TurnMode;
  /** The conversation the spend is for (the usage ledger's `chat_id`); null outside a live one. */
  readonly chatId: string | null;
  /** The configuration version the turn runs on — null before versioning (tm 316). */
  readonly configVersionId: string | null;
  readonly config: TurnConfig;
  /**
   * What a tool step would have returned, by tool key (AI-28). The slot is
   * passive in F1: no step calls a tool yet.
   */
  readonly toolStubs: Readonly<Record<string, unknown>>;
  /**
   * The workspace's zone (`inbox_settings.day_boundary_tz`, ID-04): where a
   * procedure reads "13:40" and shows a moment. Absent: Europe/Istanbul.
   */
  readonly timeZone?: string;
  /** What a procedure turn reads besides the conversation (tm 296.3). */
  readonly procedure?: ProcedureTurnData;
}

/**
 * What a procedure turn is told rather than finds out (tm 296.3). Each part
 * has a stand-in until its own task: the caller passes what it has, a
 * simulation (AI-19) or a test its fixture.
 */
export interface ProcedureTurnData {
  /**
   * The understanding call's answer for this message (#297). Absent: the
   * interim reading (`procedure/understanding.ts`).
   */
  readonly understanding?: ProcedureUnderstanding;
  /** What the AI-13 tables know (#310). Absent: nothing (`NO_FACTS`). */
  readonly facts?: ProcedureFacts;
  /** Table-sourced enum options by slot name (#310). Absent: none. */
  readonly options?: Readonly<Record<string, readonly SlotEnumOption[]>>;
  /** The workspace's currency (ISO 4217). Absent: TRY. */
  readonly currency?: string;
}

export type SkillOutcome = 'answered' | 'handed_off' | 'skipped';

/**
 * Which provider could not do its part, and how — never its words.
 *
 * The product does one thing with every failure (a human answers), so what
 * follows the kind is for the operator only (tm 255.9): whether another attempt
 * could have worked, and the provider's HTTP status, error code and request id
 * — the facts its support desk asks for — plus the adapter's detail inside the
 * kind. All of them already passed the error class's own filter
 * (`llm-error.ts`); none is the provider's prose.
 */
export type SkillFailure = (
  { provider: 'llm'; kind: LlmFailureKind } | { provider: 'embedding'; kind: EmbeddingFailureKind }
) & {
  transient: boolean;
  status: number | null;
  code: string | null;
  requestId: string | null;
  reason: string | null;
};

/**
 * What a turn's inference cost, in tokens, as the providers reported it
 * (tm 255.9). Written on the turn's `skill_runs` row. A stub reports 0.
 */
export interface SkillRunUsage {
  llmInputTokens: number;
  llmOutputTokens: number;
  embeddingTokens: number;
}

export interface SkillRunLogEntry {
  step: string;
  detail: string;
  /** False when the step could not do its job — surfaced in the run log UI. */
  ok: boolean;
}

/** What the turn decided and why — the run log, the decision record and the operator's facts. */
export interface TurnDecisions {
  outcome: SkillOutcome;
  skillId: string | null;
  skillName: string | null;
  /**
   * What wrote `reply`: a question (a `collect` step) or an answer (`say`,
   * `answer_from_knowledge`) — the decision record's `asked` and `answered`
   * (tm 288.2). Null when there is no reply.
   */
  replyKind: 'question' | 'answer' | null;
  /**
   * Why the AI could not answer, when that is what handed the conversation
   * off: the model failed, or the knowledge search it needed could not run.
   */
  failure: SkillFailure | null;
  /**
   * The daily AI cap that refused the model call, when that is what stopped
   * the AI (tm 257.8). Not a `failure`: no provider was asked.
   */
  capped: AiDailyCapError | null;
  /** Tokens the turn's provider calls cost — recorded on the run. */
  usage: SkillRunUsage;
  log: SkillRunLogEntry[];
  /**
   * Why the turn handed the conversation over, when a procedure did (tm 296.3):
   * its `reason_code`, `max_turns`, `procedure_condition`, `slot_refused`.
   * Absent for the single-message skills, whose reason the record derives.
   */
  handoffReason?: string | null;
  /** A procedure turn's step decisions (ID-08: step_id, type, cond_result, detail). */
  trace?: StepDecision[];
  /**
   * The sha256 of the definition the procedure turn ran on (`procedure_snapshot_hash`,
   * ADR-14b §2.9) — which version decided, until #290 numbers them.
   */
  procedureHash?: string | null;
}

/**
 * Something the turn wants done to the conversation besides the reply. The
 * live adapter applies these; a preview shows them; a simulation records them.
 * Risk flags (AI-27) join this list when they land.
 */
export type TurnSideEffect =
  | { readonly kind: 'tag'; readonly tag: string }
  | { readonly kind: 'summary'; readonly text: string }
  /**
   * Hand the conversation over: to a team by name (a single-message skill's
   * `transfer_to_team`), by id or routing topic (a procedure's target), or —
   * all three absent — to whoever routing gives it (tm 296.3).
   */
  | {
      readonly kind: 'handoff';
      readonly team: string | null;
      readonly groupId?: number;
      readonly topic?: string;
      /** The procedure's reason, for the card (AI-10). */
      readonly reason?: string;
    };

export interface TurnResult {
  /** Text for the visitor, or null. The live adapter sends it as the bot. */
  reply: string | null;
  decisions: TurnDecisions;
  /** Where the conversation stands after the turn; the input state when no turn was taken. */
  nextState: TurnState;
  sideEffects: TurnSideEffect[];
}

/** Whether the AI took a turn at all: a skill ran (a message no skill matched is not a turn). */
export function tookTurn(result: TurnResult): boolean {
  return result.decisions.skillId !== null || result.decisions.capped !== null;
}

/** The turn's hand-over, if it has one. */
export function handoffOf(
  effects: readonly TurnSideEffect[],
): Extract<TurnSideEffect, { kind: 'handoff' }> | null {
  for (const effect of effects) if (effect.kind === 'handoff') return effect;
  return null;
}

/** The side effects as the preview and the run's callers read them. */
export function describeSideEffects(effects: readonly TurnSideEffect[]): {
  tags: string[];
  transferTo: string | null;
  summary: string | null;
} {
  const tags: string[] = [];
  let transferTo: string | null = null;
  let summary: string | null = null;
  for (const effect of effects) {
    if (effect.kind === 'tag') tags.push(effect.tag);
    else if (effect.kind === 'handoff') transferTo = effect.team;
    else summary = effect.text;
  }
  return { tags, transferTo, summary };
}

/** The `skill_runs` row a live turn is recorded as, minus the ids the adapter adds. */
export interface SkillRunRecord {
  skillId: string;
  status: 'succeeded' | 'failed';
  log: { outcome: SkillOutcome; entries: SkillRunLogEntry[] };
  llmInputTokens: number;
  llmOutputTokens: number;
  embeddingTokens: number;
}

/**
 * The run row for a turn, or null when no skill ran.
 *
 * `status` answers "did the run complete?" — the schema constrains it to
 * succeeded/failed/aborted. The conversation outcome is a different question
 * ("what did it do to the chat?") and lives in the log beside the steps,
 * rather than being forced into a column that does not mean it. A knowledge
 * miss is a successful run that chose not to answer. What the run cost goes on
 * the same row (tm 255.9): the AI Agent report sums these beside `skill_runs`,
 * never from a second tally.
 */
export function skillRunRecord(decisions: TurnDecisions): SkillRunRecord | null {
  if (decisions.skillId === null) return null;
  return {
    skillId: decisions.skillId,
    status: decisions.log.some((entry) => !entry.ok && entry.step !== 'detect_intent')
      ? 'failed'
      : 'succeeded',
    log: { outcome: decisions.outcome, entries: decisions.log },
    llmInputTokens: decisions.usage.llmInputTokens,
    llmOutputTokens: decisions.usage.llmOutputTokens,
    embeddingTokens: decisions.usage.embeddingTokens,
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
