/**
 * The conversation engine (PRD flow 3 · tm 292.2 · SiyahTuş analysis AI-01,
 * AI-19).
 *
 * `runTurn` decides one turn: it picks the first skill whose gate matches the
 * visitor's message and runs it, and returns what the turn would do — it
 * writes nothing (see `turn.ts`). Stored skills run as one-turn procedures
 * through the legacy adapter (`legacy-skill.ts`); there is no second engine.
 *
 * The outcome is one of three things, and the distinction matters to billing:
 *
 *   answered  — the AI replied and the conversation stands on its own. If the
 *               thread later closes with no agent-authored event this counts as
 *               an AI resolution (ADR-09), which is what the invoice meters.
 *   handed_off— the AI decided a human is needed and transferred, or the model
 *               could not answer (below).
 *   skipped   — no skill matched. Routing proceeds exactly as before.
 *
 * The engine never decides *not* to involve a human on its own. A `say` or
 * `answer_from_knowledge` step answers; only an explicit `handoff` step, or the
 * absence of any answer, changes who owns the conversation.
 *
 * A knowledge answer is written by the configured `LlmProvider` (tm 255.5) —
 * the in-process stub unless a deployment names a model. The engine runs its
 * database reads through a `TenantRunner` rather than inside one transaction
 * the caller opened, so that the model call happens *between* transactions: a
 * remote model may take up to `LLM_TIMEOUT_MS`, and holding a pooled connection
 * and an open transaction for that long would collide with
 * `TENANT_TRANSACTION_TIMEOUT_MS` (10 s) before the model did.
 *
 * **A model that cannot answer is a hand-off (tm 255.6).** Timeout, provider
 * error, open circuit or an empty reply — every `LlmProviderError` ends the same
 * way: the outcome is `handed_off`, the run is recorded as failed with the
 * failure's kind (never the provider's words — the run log is read in the admin
 * UI), and the AI says nothing more in this turn: a `say`, `collect` or
 * `answer_from_knowledge` after the failure is skipped, and a reply an earlier
 * step queued is withdrawn, because a half-finished automated exchange is worse
 * than a human starting clean. The steps that serve the human who takes over
 * still run — `tag`, `summarize` and a `handoff` the skill declares. With no
 * hand-over step the conversation stays with whoever routing gave it to when
 * it opened (`ChatService.start`), which is already a human: nothing here ever
 * took it away from one.
 *
 * **So is a knowledge search that could not run (tm 255.7).** The question is
 * embedded by the configured `EmbeddingProvider` before any transaction opens;
 * when that fails, retrieval has nothing, the model is never asked — a model
 * asked without passages is the silent wrong answer this rules out — and the
 * turn ends exactly as a model failure does, with `failure` naming the
 * embedding provider and its kind.
 *
 * **And so is a prompt over `LLM_MAX_PROMPT_CHARS` (tm 255.9).** It is refused
 * before the provider sees it — no request, no tokens — as `prompt_too_long`,
 * and ends the turn like every other failure: a transient outage, a refused key
 * and a refused prompt all leave the customer with a human, and only the
 * operator's log tells them apart (`failure.transient`, the provider's status
 * and code).
 *
 * **What the turn cost is returned with it (tm 255.9).** The model's input and
 * output tokens and the question's embedding tokens — from a success, and from
 * a failure that was billed anyway (`no_answer`) — are `decisions.usage`; the
 * live adapter writes them on the turn's `skill_runs` row (`skillRunRecord`).
 *
 * **Every model call is counted against the daily AI caps (tm 257.8).** The
 * engine calls through a `MeteredLlm` with the turn's workspace, on the meter
 * the turn's mode names (a simulation's on the test meter). A call the cap
 * refuses was never made; the turn ends as a model failure does — nothing more
 * is said, a human answers — but it is not a provider failure and is not filed
 * as one: `capped` names the cap, `failure` stays empty. A preview rethrows the
 * refusal, which its route answers with a 429. The question's embedding is
 * counted the same way on the embedding meter (tm 257.20), and a refusal there
 * ends the turn the same way, having cost nothing.
 *
 * **The model reads the conversation, not just the message (tm 292.3 ·
 * AI-01).** The turn's message carries its history (`TurnMessage.history`,
 * built by `context-loader.ts`), and the knowledge answer is asked with it: the
 * earlier exchange before the latest message, the connection's events and the
 * state digest in the instructions. The knowledge search still embeds the
 * latest message alone. The history is the part of the prompt that yields to
 * `LLM_MAX_PROMPT_CHARS`: a prompt over it is shortened, oldest message first,
 * the visitor's opening message last, before anything is refused — so a long
 * conversation never becomes a `prompt_too_long` hand-off on its own.
 */
import {
  matchIntent,
  stepProblemDetails,
  validateSteps,
  type StepProblemDetails,
} from '@siyahtus/ai-mock';
import {
  ANSWER_BUDGETS,
  DEFAULT_ANSWER_PASSAGES,
  DEFAULT_CLARIFY_THRESHOLDS,
  DEFAULT_DAY_BOUNDARY,
  DEFAULT_NO_ANSWER,
  maxQuestionsOf,
  readPersona,
  validateSkillProcedure,
  type AiConversationOutcome,
  type AiUsageSurface,
  type Persona,
  type PersonaLanguage,
  type PersonaStyle,
  type Procedure,
  type SkillProcedureFields,
} from '@siyahtus/types';
import type { TenantContext } from '../../../lib/tenant.js';
import {
  ANSWER_RETRIEVAL_LIMIT,
  type EmbeddedQuery,
  type KnowledgeService,
} from '../knowledge-service.js';
import { AiDailyCapError, type AiAttribution } from '../ai-daily-budget.js';
import { MeteredLlm } from '../metered-llm.js';
import { ProcedureExamples } from '../procedure-examples.js';
import { buildAnswerPrompt } from '../provider/answer-prompt.js';
import { buildComposePrompt } from '../provider/compose-prompt.js';
import { EmbeddingProviderError } from '../provider/embedding-error.js';
import { LlmProviderError } from '../provider/llm-error.js';
import { completeStructured } from '../provider/structured-output.js';
import {
  promptLength,
  refuseOverlongPrompt,
  type LlmCompletion,
  type LlmPrompt,
  type LlmProvider,
} from '../provider/llm-provider.js';
import { GAP_MARKER, shortenHistory } from './context-loader.js';
import {
  guidanceLayer,
  guidanceRecord,
  mergeGuidanceRecords,
  personaStyleLayer,
  renderLayers,
  selectGuidance,
  styleWarnings,
  type GuidanceRecord,
} from './guidance.js';
import {
  KNOWLEDGE_ANSWER_RESPONSE_FORMAT,
  NO_ANSWER_PHRASES,
  NO_ANSWER_SIGNAL,
  NO_FACT_TABLES,
  noAnswerCategory,
  noAnswerSignal,
  passageLabel,
  problemDetail,
  readKnowledgeAnswer,
  readNoAnswerMark,
  readOfferAnswer,
  rewriteNote,
  type KnowledgeAnswerReply,
  type KnowledgeFacts,
  type KnowledgeRecord,
  type ReadKnowledgeAnswer,
  type RiskReading,
  type UnansweredReason,
} from './knowledge-answer.js';
import {
  buildDigest,
  earlierTodayLines,
  recallLine,
  recallTarget,
  repeatsEarlierDetail,
  slotKnown,
  withEarlierToday,
} from './daily-memory.js';
import {
  adaptLegacySkill,
  stepLogName,
  type IntentGate,
  type ProcedureStep,
  type SingleTurnProcedure,
} from './legacy-skill.js';
import { NO_FACTS, slotSettled } from './procedure/conditions.js';
import {
  activeProcedure,
  procedureHash,
  readSuspended,
  runProcedureTurn,
  type ActiveProcedure,
  type ProcedureEnd,
  type ProcedureSnapshot,
  type SuspendedProcedure,
} from './procedure/executor.js';
import {
  rankProcedures,
  type CatalogueEntry,
  type PendingQuestion,
  type ProcedureUnderstanding,
} from './procedure/understanding.js';
import {
  CLARIFY_SIGNAL,
  clarifyQuestion,
  clarifySignal,
  decide,
  languageVerdict,
  readClarifyMark,
  type PolicyRecord,
} from './policy.js';
import {
  narrowCatalogue,
  needsPrefilter,
  prefilterDetail,
  type PrefilterRecord,
} from './prefilter.js';
import {
  buildUnderstandPrompt,
  readUnderstanding,
  understandCatalogue,
  understandGrounding,
  understoodDetail,
  understoodRecord,
  UNDERSTAND_RESPONSE_FORMAT,
  type UnderstandContextInput,
  type UnderstandReply,
} from './understand.js';
import type { AiStateObject } from './state-store.js';
import { readAndCompile } from './turn-config.js';
import {
  emptyTurnState,
  handoffOf,
  tookTurn,
  turnAgentId,
  turnsTaken,
  type TurnSkill,
  type SkillFailure,
  type SkillRunLogEntry,
  type SkillRunUsage,
  type TenantRunner,
  type TurnContext,
  type TurnDecisions,
  type TurnHistory,
  type TurnMessage,
  type TurnMode,
  type TurnResult,
  type TurnSideEffect,
  type TurnState,
  type UnderstoodRecord,
} from './turn.js';

export interface ConversationEngineOptions {
  /**
   * Writes the answer an `answer_from_knowledge` step composes. The server
   * passes a `MeteredLlm` (tm 257.8), so every call is counted against the
   * daily AI caps; a bare provider is counted by nothing (a unit test's).
   */
  llm: LlmProvider | MeteredLlm;
  /** `LLM_MAX_OUTPUT_TOKENS`, passed on every call. */
  maxOutputTokens: number;
  /** `LLM_TIMEOUT_MS`, passed on every call. */
  timeoutMs: number;
  /** `LLM_MAX_PROMPT_CHARS`: a longer prompt is never sent (tm 255.9). */
  maxPromptChars: number;
  /**
   * Finds the passages an answer is grounded in — the server's one instance,
   * over its configured embedding provider. Required: a default would be the
   * lexical stub, searching a space the knowledge base may no longer be in.
   */
  knowledge: KnowledgeService;
  /**
   * Where the catalogue narrowing reads its examples (tm 297.3); tests lower
   * its exact-search ceiling. Default: `new ProcedureExamples()`.
   */
  procedureExamples?: ProcedureExamples;
  /**
   * The AI-13 tables' answers (#310), asked before the knowledge base on the
   * knowledge path (tm 298 · AI-06 §3). Default: none (`NO_FACT_TABLES`).
   */
  facts?: KnowledgeFacts;
}

/** The meter each mode's spend is counted on (`TurnMode`). */
const SURFACE: Readonly<Record<TurnMode, AiUsageSurface>> = {
  live: 'ai_agent',
  preview: 'ai_agent',
  simulation: 'simulation',
};

const NOTHING_SPENT: SkillRunUsage = Object.freeze({
  llmInputTokens: 0,
  llmOutputTokens: 0,
  embeddingTokens: 0,
});

const NOTHING_DECIDED: TurnDecisions = {
  outcome: 'skipped',
  skillId: null,
  skillName: null,
  replyKind: null,
  failure: null,
  capped: null,
  usage: NOTHING_SPENT,
  log: [],
};

/** A preview's result: the turn, plus why the steps could not run at all. */
export type PreviewResult = TurnResult & { errors: string[]; error_details: StepProblemDetails[] };

/** What one executed procedure produced, before it becomes a turn. */
interface Executed {
  reply: string | null;
  decisions: TurnDecisions;
  sideEffects: TurnSideEffect[];
}

/** The procedure a turn runs, where it stands and what it starts the turn with (tm 296.3). */
interface ProcedureRun {
  skill: { id: string; name: string; aiAgentId: string | null };
  persona: Persona;
  answerIn: PersonaLanguage | null;
  snapshot: ProcedureSnapshot;
  hash: string;
  /** Null when the procedure starts with this turn. */
  at: { stepId: string | null } | null;
  slots: AiStateObject;
  signals: AiStateObject;
  procedureTurns: number;
  /** Null for a set-aside topic taken up again: its "evet" is not read for slots. */
  understanding: ProcedureUnderstanding | null;
  /** What `suspended` holds after the turn, as the selection left it. */
  suspended: SuspendedProcedure | null;
  log: SkillRunLogEntry[];
  /** The line recalling an earlier connection today (tm 294), on the connection's first turn. */
  recall: string | null;
  /** When the procedure's previous turn was taken. */
  lastTurnAt: Date | null;
  timeZone: string;
  currency: string;
  /** What the understanding call cost — the turn's first spend. */
  spent: SkillRunUsage;
  /** What it read, for the decision record. */
  understood?: UnderstoodRecord;
  /** Which rule of the decision order chose it (tm 297.2). */
  policy?: PolicyRecord;
}

/**
 * What the understanding call gave the turn (tm 297.1): the reading, or why
 * there is none — the model failed, or today's cap refused it — and its cost.
 */
type Understood =
  | {
      understanding: ProcedureUnderstanding;
      spent: SkillRunUsage;
      log: SkillRunLogEntry[];
      /** Absent when the turn was handed its understanding (a test, a simulation). */
      record?: UnderstoodRecord;
    }
  | {
      understanding: null;
      failure: SkillFailure | null;
      capped: AiDailyCapError | null;
      spent: SkillRunUsage;
      log: SkillRunLogEntry[];
    };

/**
 * A turn the decision order sent down the knowledge path (AI-05 §4.5): what
 * the understanding cost and read, for the skill that answers instead.
 */
interface NoProcedure {
  spent: SkillRunUsage;
  record?: UnderstoodRecord;
  policy: PolicyRecord;
  understanding: ProcedureUnderstanding;
  /** Whether the fallback may answer: no procedure reached `low` (AI-05 §5). */
  fallback: boolean;
  /** What the call read and the order decided — the log of a turn nothing takes. */
  log: SkillRunLogEntry[];
}

/** A knowledge search with no answer (AI-06): what it cost and why, for what answers instead. */
interface KnowledgeMiss {
  miss: true;
  spent: SkillRunUsage;
  reason: UnansweredReason;
  knowledge?: KnowledgeRecord;
  log: SkillRunLogEntry[];
}

/** A procedure skill the turn may start, its definition judged. */
interface ProcedureItem {
  entry: CatalogueEntry;
  skill: TurnSkill;
  procedure: Procedure;
}

/** A one-message skill, its steps judged and adapted. */
interface SingleItem {
  skill: TurnSkill;
  procedure: SingleTurnProcedure;
}

/** A skill id; a preview's unsaved procedure has none. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The reading a fallback procedure starts on when no call was made. */
const NOTHING_UNDERSTOOD: ProcedureUnderstanding = Object.freeze({
  intent: { procedure_key: null, confidence: 0 },
});

/** One piece of a procedure turn's message; `written` is where the composed part goes. */
type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'question'; at: string; text: string }
  | { kind: 'written' };

/** The workspace currency until it has a setting of its own (295.3). */
const DEFAULT_CURRENCY = 'TRY';

/** A silence this long inside a procedure is said to the compose call (AI-03 §8). */
const LONG_GAP_MS = 30 * 60_000;

const LONG_GAP_NOTE =
  'The player is back after a long break: greet them again briefly, and do not assume what was said before still holds.';

/**
 * The two sentences a procedure says itself (AI-03 §7): the question about
 * the set-aside topic, and the answer to a "no" to it.
 */
const PROCEDURE_PHRASES: Readonly<Record<PersonaLanguage, { offer: string; declined: string }>> = {
  tr: {
    offer: 'Önceki konuya dönelim mi?',
    declined: 'Peki. Başka bir konuda yardımcı olabileceğim bir şey var mı?',
  },
  en: {
    offer: 'Shall we go back to the earlier topic?',
    declined: 'All right. Is there anything else I can help you with?',
  },
  de: {
    offer: 'Sollen wir zum vorherigen Thema zurückkehren?',
    declined: 'In Ordnung. Kann ich Ihnen sonst noch helfen?',
  },
  fr: {
    offer: 'Voulez-vous revenir au sujet précédent ?',
    declined: 'D’accord. Puis-je vous aider pour autre chose ?',
  },
  es: {
    offer: '¿Volvemos al tema anterior?',
    declined: 'De acuerdo. ¿Puedo ayudarle con algo más?',
  },
};

/** A step's knowledge answer, or why there is none. */
interface KnowledgeAnswer {
  text: string | null;
  detail: string;
  failure?: SkillFailure;
  /** The daily AI cap refused a call (tm 257.8); nothing was asked. */
  capped?: AiDailyCapError;
  /** Tokens this step's provider calls cost, billed whether or not it answered. */
  spent?: Partial<SkillRunUsage>;
  /** `partial`: the passages answer part of it (AI-06 §7) — a person is offered. */
  grounded?: ReadKnowledgeAnswer['grounded'];
  /** What the decision record keeps of the search and the draft (tm 298). */
  record?: KnowledgeRecord;
  /** Why there is no answer, when there is none and nothing failed. */
  missed?: UnansweredReason;
  /** The behaviour rules the call carried (tm 299.1) — absent when none applied. */
  guidance?: GuidanceRecord;
}

export class ConversationEngine {
  readonly #knowledge: KnowledgeService;
  readonly #examples: ProcedureExamples;
  readonly #facts: KnowledgeFacts;
  readonly #llm: MeteredLlm;
  readonly #limits: { maxOutputTokens: number; timeoutMs: number };
  readonly #maxPromptChars: number;
  /**
   * The turn's one embedding (AI-05 §2): the narrowing embeds the message, and
   * the knowledge search of the same turn reuses it rather than asking again.
   */
  readonly #turnEmbeddings = new WeakMap<TurnMessage, { text: string; query: EmbeddedQuery }>();

  constructor(options: ConversationEngineOptions) {
    this.#knowledge = options.knowledge;
    this.#examples = options.procedureExamples ?? new ProcedureExamples();
    this.#facts = options.facts ?? NO_FACT_TABLES;
    this.#llm = MeteredLlm.wrap(options.llm);
    this.#limits = { maxOutputTokens: options.maxOutputTokens, timeoutMs: options.timeoutMs };
    this.#maxPromptChars = options.maxPromptChars;
  }

  /**
   * Decide one turn. Writes nothing: the reply, the side effects and the next
   * state are returned for the caller to apply, show or record.
   *
   * Only one skill runs per message. Running several would let two of them
   * reply to the same question, and an admin debugging why a customer got two
   * different answers has no way to see which fired first. A message nothing
   * takes is not a turn: the state comes back as it went in.
   *
   * The order (AI-05 §4): the player's answer to an offer of a person
   * (`#answerToOffer`); a procedure in progress or one the message selects,
   * or the decision order's own reply (`#procedureTurn`); then the knowledge
   * path (AI-06): the one-message skills whose gate matches, then the AI-13
   * tables and the knowledge base (`#knowledgeTurn`); then the fallback (§5);
   * then the no-answer reply (`#noAnswer`). Whatever the turn did, the
   * silence rule has the last word (`#neverSilent`, AI-06 §9).
   */
  async runTurn(state: TurnState, message: TurnMessage, ctx: TurnContext): Promise<TurnResult> {
    const offer = this.#answerToOffer(state, message, ctx);
    if (offer) return offer;
    return this.#neverSilent(state, message, ctx, await this.#takeTurn(state, message, ctx));
  }

  async #takeTurn(state: TurnState, message: TurnMessage, ctx: TurnContext): Promise<TurnResult> {
    const procedural = await this.#procedureTurn(state, message, ctx);
    if (procedural && 'nextState' in procedural) return procedural;
    // The understanding call ran and chose no procedure: its cost is the turn's
    // all the same, on whichever skill answers — and so is a knowledge search
    // that found no answer before the fallback did (AI-06).
    let spent = procedural?.spent ?? NOTHING_SPENT;
    let missed: KnowledgeMiss | null = null;
    const record = procedural?.record;
    const policy = procedural?.policy;
    const charged = (executed: Executed, rule?: 'fallback'): Executed =>
      procedural
        ? {
            ...executed,
            decisions: {
              ...executed.decisions,
              usage: addUsage(spent, executed.decisions.usage),
              ...(missed
                ? {
                    log: [...missed.log, ...executed.decisions.log],
                    ...(missed.knowledge ? { knowledge: missed.knowledge } : {}),
                  }
                : {}),
              ...(record ? { understood: record } : {}),
              ...(policy ? { policy: rule ? { ...policy, step: 6, rule } : policy } : {}),
            },
          }
        : executed;

    // The knowledge path (AI-05 §4.5): the one-message skills whose gate
    // matches, in their order. One with no gate matches everything, so it is
    // not here — it waits with the fallback, and no longer answers before a
    // skill written for the message (§5).
    const singles = singleSkills(ctx.config.skills);
    for (const item of singles) {
      if (item.skill.isFallback || item.procedure.whenToUse.length === 0) continue;
      const gate = intentGate(item.procedure.whenToUse, message.text);
      if (!gate.matched) continue;
      return this.#runSingle(state, message, ctx, item, gate.log, charged, procedural);
    }

    // AI-06: the decision order sent the message down the knowledge path and
    // no skill took it — the tables, then the knowledge base, answer it.
    if (procedural) {
      const known = await this.#knowledgeTurn(state, message, ctx, {
        understanding: procedural.understanding,
        spent,
        log: procedural.log,
        decided: { ...(record ? { understood: record } : {}), ...(policy ? { policy } : {}) },
      });
      if (!('miss' in known)) return known;
      missed = known;
      spent = known.spent;
    }

    // The fallback (AI-05 §5): only when no procedure was even likely. The one
    // marked first, in order; then the one-message skills with no gate.
    if (procedural?.fallback !== false) {
      for (const candidate of fallbacks(ctx.config.skills, singles)) {
        if (candidate.kind === 'procedure') {
          return this.#enterProcedure(state, message, ctx, {
            starting: candidate.item,
            ongoing: null,
            resuming: false,
            active: null,
            suspendedSlots: {},
            suspendedNext: readSuspended(state.suspended),
            understanding: procedural?.understanding ?? NOTHING_UNDERSTOOD,
            log: [
              ...(missed?.log ?? []),
              {
                step: 'policy',
                detail: `nothing else took the message — the fallback ${candidate.item.skill.name}`,
                ok: true,
              },
            ],
            spent,
            ...(record ? { understood: record } : {}),
            ...(policy ? { policy: { ...policy, step: 6, rule: 'fallback' } } : {}),
          });
        }
        const gate = intentGate(candidate.item.procedure.whenToUse, message.text);
        if (!gate.matched) continue;
        return this.#runSingle(
          state,
          message,
          ctx,
          candidate.item,
          gate.log,
          (executed) => charged(executed, 'fallback'),
          procedural,
        );
      }
    }

    if (procedural) {
      // AI-05 §4.6 → AI-06 §8: nothing took it, and the knowledge base has no
      // answer — the AI says so (AI-22 collects these).
      return this.#noAnswer(state, message, ctx, {
        base: null,
        understanding: procedural.understanding,
        reason: missed?.reason ?? 'no_passages',
        decided: {
          usage: spent,
          log: [...procedural.log, ...(missed?.log ?? [])],
          ...(missed?.knowledge ? { knowledge: missed.knowledge } : {}),
          ...(record ? { understood: record } : {}),
          ...(policy ? { policy: { ...policy, step: 6, rule: 'unmatched' } } : {}),
        },
      });
    }

    if (ctx.aiMode === 'ai' && ctx.config.skills.length > 0) {
      // No procedure to decide by, no skill took it, and the connection is the
      // AI's: the knowledge base answers it, or the AI says it cannot (AI-06 §9).
      const known = await this.#knowledgeTurn(state, message, ctx, {
        understanding: null,
        spent: NOTHING_SPENT,
        log: [],
        decided: {},
      });
      if (!('miss' in known)) return known;
      return this.#noAnswer(state, message, ctx, {
        base: null,
        understanding: null,
        reason: known.reason,
        decided: {
          usage: known.spent,
          log: known.log,
          ...(known.knowledge ? { knowledge: known.knowledge } : {}),
        },
      });
    }

    // Not the AI's connection yet, and nothing took the message: no turn —
    // the person routing gave it to answers.
    return { reply: null, decisions: NOTHING_DECIDED, nextState: state, sideEffects: [] };
  }

  /** A one-message skill's turn: the persona's language, the day's recall, the steps. */
  async #runSingle(
    state: TurnState,
    message: TurnMessage,
    ctx: TurnContext,
    item: SingleItem,
    gateLog: SkillRunLogEntry[],
    charged: (executed: Executed) => Executed,
    procedural: NoProcedure | null,
  ): Promise<TurnResult> {
    const { skill, procedure } = item;
    const language = languageVerdict(
      message.text,
      skill.persona,
      procedural?.understanding.language,
    );
    const identity = { id: skill.id, name: skill.name, aiAgentId: skill.aiAgentId };
    const intent = procedure.whenToUse[0]?.intent ?? null;

    if (language.unsupported) {
      // AI-05 §7: not a silence — a person answers (AI-09).
      return forcedHandoff(state, message, identity, {
        log: gateLog,
        detected: language.detected,
        decided: charged({ reply: null, decisions: NOTHING_DECIDED, sideEffects: [] }).decisions,
        intent,
      });
    }

    // The day's earlier connections (tm 294 · AI-02), on the connection's
    // first turn: the slots an earlier one on this topic collected are the
    // turn's from its start, and the recall — written here, not by the model
    // (K5) — opens whatever the turn says.
    const earlier = message.earlierToday;
    const before = earlier ? withEarlierToday(state, earlier, skill.id) : state;
    const target = earlier ? recallTarget(earlier, skill.id) : null;
    const recall = earlier && target ? recallLine(target, earlier.trust, language.answerIn) : null;

    const executed = charged(
      withRecall(
        await this.#execute(procedure, {
          skill: identity,
          message,
          gateLog,
          persona: skill.persona,
          answerIn: language.answerIn,
          ctx,
          slots: before.slots,
          recalled: recall !== null,
        }),
        recall,
      ),
    );

    return { ...executed, nextState: afterTurn(before, message, executed, identity, intent) };
  }

  /**
   * Dry run for the editor's Preview (FR-MOD-06.2.5).
   *
   * The same turn, no writes: an admin needs to see what the skill would
   * actually do, and a preview that runs different logic is worse than none.
   */
  async preview(
    db: TenantRunner,
    tenant: TenantContext,
    input: {
      steps: unknown;
      message: string;
      aiAgentId?: string | null;
      /**
       * A procedure's definition (tm 296.4), already judged as a save would
       * judge it: `steps` is then not read, and the message must select it.
       */
      definition?: SkillProcedureFields;
      /** The exchange before `message` (`exchangeHistory`); not replayed. */
      history?: TurnHistory;
    },
  ): Promise<PreviewResult> {
    const nothing = (log: SkillRunLogEntry[] = []): TurnResult => ({
      reply: null,
      decisions: { ...NOTHING_DECIDED, log },
      nextState: emptyTurnState(),
      sideEffects: [],
    });
    const message: TurnMessage = input.history
      ? { text: input.message, history: input.history }
      : { text: input.message };

    if (input.definition) {
      const draft = await db((tx) =>
        readAndCompile.forDraft(tx, {
          steps: [],
          aiAgentId: input.aiAgentId ?? null,
          definition: input.definition,
        }),
      );
      const result = await this.runTurn(emptyTurnState(), message, {
        tenant,
        db,
        now: new Date(),
        mode: 'preview',
        chatId: null,
        configVersionId: draft.versionId,
        config: draft.pkg,
        toolStubs: {},
      });
      if (result.decisions.capped) throw result.decisions.capped;
      if (result.decisions.skillId === null) {
        // As with a one-message skill's gate: the author asked about this
        // procedure and is owed the reason it did not start.
        return {
          ...nothing([
            {
              step: 'procedure',
              detail: 'the message did not select this procedure (its when_to_use and examples)',
              ok: false,
            },
          ]),
          errors: [],
          error_details: [],
        };
      }
      return { ...result, errors: [], error_details: [] };
    }

    const parsed = validateSteps(input.steps);
    if (!parsed.ok) {
      return {
        ...nothing(),
        errors: [parsed.index >= 0 ? `Step ${parsed.index + 1}: ${parsed.reason}` : parsed.reason],
        // The same refusal as a code, for a console that words it in its own language.
        error_details: [stepProblemDetails(parsed)],
      };
    }

    // Said here rather than left to the turn: a live message no skill matches
    // shows nothing, but the author asked about this one skill and is owed the
    // reason it did not fire.
    const gate = intentGate(adaptLegacySkill(parsed.steps).whenToUse, input.message);
    if (!gate.matched) return { ...nothing(gate.log), errors: [], error_details: [] };

    const draft = await db((tx) =>
      readAndCompile.forDraft(tx, { steps: input.steps, aiAgentId: input.aiAgentId ?? null }),
    );
    const result = await this.runTurn(emptyTurnState(), message, {
      tenant,
      db,
      now: new Date(),
      mode: 'preview',
      // A preview answers no conversation; its spend is the AI agent's.
      chatId: null,
      configVersionId: draft.versionId,
      config: draft.pkg,
      toolStubs: {},
    });
    // A preview the cap stopped is not a result to show: what the skill would
    // say is unknown, and the author is told why instead (429, tm 257.8).
    if (result.decisions.capped) throw result.decisions.capped;

    return { ...result, errors: [], error_details: [] };
  }

  /** Run a one-turn procedure's steps in order. */
  async #execute(
    procedure: SingleTurnProcedure,
    input: {
      skill: { id: string; name: string; aiAgentId: string | null };
      message: TurnMessage;
      gateLog: SkillRunLogEntry[];
      persona: Persona;
      answerIn: PersonaLanguage | null;
      ctx: TurnContext;
      /** What the conversation knows already — collected, or carried from earlier today. */
      slots: AiStateObject;
      /** The reply will open with the recall line (tm 294). */
      recalled: boolean;
    },
  ): Promise<Executed> {
    const log = [...input.gateLog];
    const sideEffects: TurnSideEffect[] = [];
    let reply: string | null = null;
    let replyKind: TurnDecisions['replyKind'] = null;
    let handedOver = false;
    let failure: SkillFailure | null = null;
    let capped: AiDailyCapError | null = null;
    let usage = NOTHING_SPENT;
    let knowledge: KnowledgeRecord | undefined;
    let guidance: GuidanceRecord | undefined;

    for (const step of procedure.steps) {
      const name = stepLogName(step);

      // A hand-over ends the procedure: everything after it would be acting on
      // a conversation the AI no longer owns.
      if (handedOver) {
        log.push({ step: name, detail: 'skipped — already handed off', ok: true });
        continue;
      }

      // A failed model call ends the AI's side of the exchange, not the
      // procedure: what it would still *say* is skipped, what a human needs
      // still runs. A call the daily cap refused ends it the same way (tm 257.8).
      if ((failure || capped) && speaks(step)) {
        log.push({
          step: name,
          detail: capped
            ? "skipped — today's AI cap is reached, a human replies"
            : 'skipped — the model could not answer, a human replies',
          ok: true,
        });
        continue;
      }

      switch (step.type) {
        case 'tag':
          sideEffects.push({ kind: 'tag', tag: step.tag });
          log.push({ step: name, detail: `tagged "${step.tag}"`, ok: true });
          break;

        case 'collect': {
          // Only ask if the answer is not already known — collected, or
          // carried from an earlier connection today (tm 294) — or in the
          // message. Asking a customer for an order number they just gave is
          // the single most irritating thing an automated agent does.
          if (slotKnown(input.slots, step.slot)) {
            log.push({ step: name, detail: `${step.slot} already known`, ok: true });
          } else if (looksSupplied(input.message.text, step.slot)) {
            log.push({ step: name, detail: `${step.slot} already provided`, ok: true });
          } else {
            reply = step.prompt;
            replyKind = 'question';
            log.push({ step: name, detail: `asked for ${step.slot}`, ok: true });
          }
          break;
        }

        case 'summarize':
          sideEffects.push({
            kind: 'summary',
            text: buildSummary(
              input.message.text,
              input.message.history,
              input.message.earlierToday?.contact ?? 1,
            ),
          });
          log.push({ step: name, detail: 'summary written', ok: true });
          break;

        case 'say':
          // Deliberately unshaped (FR-MOD-06.4 · `#### K06.4`). A fixed reply is
          // wording an admin typed by hand and asked to be sent; trimming it to
          // an answer-length budget or prefixing it with a tone would rewrite
          // their words behind their back. The persona shapes what the
          // assistant *composes* — the passages retrieval found — never what a
          // human wrote.
          reply = step.text;
          replyKind = 'answer';
          log.push({ step: name, detail: 'sent the fixed reply', ok: true });
          break;

        case 'answer_from_knowledge': {
          const answer = await this.#answerFromKnowledge({
            turn: input.message,
            message: input.message.text,
            history: input.message.history,
            earlierToday: input.message.earlierToday
              ? earlierTodayLines(input.message.earlierToday, input.recalled)
              : [],
            skill: input.skill,
            persona: input.persona,
            answerIn: input.answerIn,
            ctx: input.ctx,
          });
          usage = addUsage(usage, answer.spent);
          knowledge = mergeKnowledge(knowledge, answer.record);
          guidance = mergeGuidanceRecords(guidance, answer.guidance);
          if (answer.failure || answer.capped) {
            failure = answer.failure ?? null;
            capped = answer.capped ?? null;
            // Withdrawn, not just left unset: a question a `collect` queued
            // earlier would reach the customer as the AI's last word before a
            // silence (see the file header).
            reply = null;
            replyKind = null;
          } else if (answer.text) {
            // K5 (an earlier connection's detail) is the answer's own check
            // (`#answerFromKnowledge`): a draft that repeats one comes back
            // withheld, as a knowledge miss.
            reply = answer.text;
            replyKind = 'answer';
          }
          log.push({ step: name, detail: answer.detail, ok: answer.text !== null });
          break;
        }

        case 'handoff':
          handedOver = true;
          sideEffects.push({ kind: 'handoff', team: step.target });
          log.push({ step: name, detail: `handing over to ${step.target}`, ok: true });
          break;
      }
    }

    return {
      reply,
      decisions: {
        outcome: handedOver || failure || capped ? 'handed_off' : reply ? 'answered' : 'skipped',
        skillId: input.skill.id,
        skillName: input.skill.name,
        replyKind,
        failure,
        capped,
        usage,
        log,
        ...(knowledge ? { knowledge } : {}),
        ...(guidance ? { guidance } : {}),
      },
      sideEffects,
    };
  }

  /**
   * A procedure turn (tm 296.3 · AI-03), a turn the decision order answers
   * without one (tm 297.2 · AI-05 §4: a clarifying question, a small-talk
   * reply, a forced hand-over), or — when the order sends the message down the
   * knowledge path — what the understanding cost and decided, for the
   * one-message skills and the fallback to carry. Null when no procedure is in
   * progress, set aside or selectable: the understanding call is not made.
   * Which rule applies is `decide`'s; one turn of a procedure is
   * `runProcedureTurn`'s; what is left here needs the providers.
   */
  async #procedureTurn(
    state: TurnState,
    message: TurnMessage,
    ctx: TurnContext,
  ): Promise<TurnResult | NoProcedure | null> {
    const catalogue = procedureCatalogue(ctx.config.skills);
    // The fallback is not the call's to choose (AI-05 §5).
    const selectable = catalogue.filter((item) => !item.skill.isFallback);
    const active = activeProcedure(state);
    const suspended = readSuspended(state.suspended);
    if (selectable.length === 0 && active === null && suspended === null) return null;

    const data = ctx.procedure ?? {};
    const timeZone = ctx.timeZone ?? DEFAULT_DAY_BOUNDARY.timezone;
    const currency = data.currency ?? DEFAULT_CURRENCY;
    const entries = selectable.map((item) => item.entry);
    const understood: Understood = data.understanding
      ? { understanding: data.understanding, spent: NOTHING_SPENT, log: [] }
      : await this.#understandNarrowed(message, ctx, active?.skillId ?? null, {
          message: message.text,
          catalogue: understandCatalogue({
            procedures: selectable.map((item) => ({ entry: item.entry })),
            active: active ? snapshotEntry(active) : null,
          }),
          active: active
            ? {
                key: active.skillId,
                name: active.snapshot.skill_name,
                procedure: active.snapshot.procedure,
              }
            : null,
          pending: active ? pendingQuestion(active, state.slots) : null,
          ...(data.options ? { options: data.options } : {}),
          now: ctx.now,
          timeZone,
          currency,
        });
    if (understood.understanding === null) {
      return notUnderstood(state, message, active, understood);
    }
    const { understanding } = understood;
    const thresholds = ctx.config.clarifyThresholds ?? DEFAULT_CLARIFY_THRESHOLDS;
    const decided = decide({
      understanding,
      catalogue: entries,
      active,
      suspended,
      slots: state.slots,
      now: ctx.now,
      thresholds,
      clarified: readClarifyMark(state.signals),
      turnsTaken: turnsTaken(state),
    });
    const { decision, record: policy } = decided;
    const record = understood.record;
    const log = [...understood.log, ...decided.log];
    const spentSoFar = {
      usage: understood.spent,
      ...(record ? { understood: record } : {}),
      policy,
    };

    if (decision.kind === 'knowledge') {
      return {
        spent: understood.spent,
        ...(record ? { record } : {}),
        policy,
        understanding,
        log,
        // AI-05 §5: the fallback answers only when no procedure was likely.
        fallback: rankProcedures(understanding, entries, thresholds.low).length === 0,
      };
    }

    if (decision.kind === 'clarify' || decision.kind === 'smalltalk') {
      // Said for the agent, not for a skill: its persona and its language.
      const persona = agentPersona(ctx.config.skills);
      const language = languageVerdict(message.text, persona, understanding.language);
      if (language.unsupported) {
        return forcedHandoff(state, message, null, {
          log,
          detected: language.detected,
          decided: spentSoFar,
        });
      }
      const clarifying = decision.kind === 'clarify';
      const executed: Executed = {
        reply: clarifying
          ? clarifyQuestion(decision.options, language.answerIn)
          : SMALLTALK_PHRASES[language.answerIn ?? 'tr'],
        decisions: {
          ...NOTHING_DECIDED,
          ...spentSoFar,
          outcome: 'answered',
          replyKind: clarifying ? 'question' : 'answer',
          log: [
            ...log,
            ...(clarifying
              ? []
              : [
                  {
                    step: 'policy',
                    detail: 'small talk — a short reply, nothing searched',
                    ok: true,
                  },
                ]),
          ],
        },
        sideEffects: [],
      };
      const turn = turnsTaken(state) + 1;
      return {
        ...executed,
        nextState: {
          ...state,
          suspended: decided.suspended as unknown as AiStateObject | null,
          signals: clarifying
            ? { ...state.signals, [CLARIFY_SIGNAL]: clarifySignal(decision.options, turn) }
            : state.signals,
          counters: { ...state.counters, turns: turn },
          lastProcessedEventSeq: Math.max(state.lastProcessedEventSeq, message.throughSeq ?? 0),
        },
      };
    }

    if (decision.kind === 'declined') {
      // "Hayır" to the set-aside topic: it is let go, and the AI says so.
      const identity = {
        id: decision.skillId,
        name: decision.skillName,
        aiAgentId: null,
      };
      const persona = personaFor(ctx.config.skills, decision.skillId, null);
      const { answerIn } = languageVerdict(message.text, persona, understanding.language);
      const line = PROCEDURE_PHRASES[answerIn ?? 'tr'].declined;
      const executed: Executed = {
        reply: line,
        decisions: {
          ...NOTHING_DECIDED,
          ...spentSoFar,
          outcome: 'answered',
          skillId: identity.id,
          skillName: identity.name,
          replyKind: 'answer',
          log,
          trace: [],
        },
        sideEffects: [],
      };
      return {
        ...executed,
        nextState: afterTurn({ ...state, suspended: null }, message, executed, identity, null),
      };
    }

    const starting =
      decision.kind === 'start'
        ? (selectable.find((item) => item.entry.key === decision.key) ?? null)
        : null;
    const ongoing: ActiveProcedure | null = decision.kind === 'start' ? null : decision.active;
    if (!starting && !ongoing) return null;
    return this.#enterProcedure(state, message, ctx, {
      starting,
      ongoing,
      resuming: decision.kind === 'resume',
      active,
      suspendedSlots: suspended?.slots ?? {},
      suspendedNext: decided.suspended,
      understanding,
      log,
      spent: understood.spent,
      ...(record ? { understood: record } : {}),
      policy,
    });
  }

  /**
   * The procedure the turn runs — one starting now, or the one in progress or
   * set aside going on — from the decision to its turn: the persona's language
   * (AI-05 §7: unsupported is a hand-over), where it starts, its run.
   */
  async #enterProcedure(
    state: TurnState,
    message: TurnMessage,
    ctx: TurnContext,
    input: {
      starting: ProcedureItem | null;
      ongoing: ActiveProcedure | null;
      resuming: boolean;
      /** The procedure in progress before the turn. */
      active: ActiveProcedure | null;
      /** A set-aside topic's slots, for `resuming`. */
      suspendedSlots: AiStateObject;
      suspendedNext: SuspendedProcedure | null;
      understanding: ProcedureUnderstanding;
      log: SkillRunLogEntry[];
      spent: SkillRunUsage;
      understood?: UnderstoodRecord;
      policy?: PolicyRecord;
    },
  ): Promise<TurnResult> {
    const { starting, ongoing, resuming, understanding } = input;
    const data = ctx.procedure ?? {};
    const timeZone = ctx.timeZone ?? DEFAULT_DAY_BOUNDARY.timezone;
    const currency = data.currency ?? DEFAULT_CURRENCY;
    const skill = starting
      ? { id: starting.skill.id, name: starting.skill.name, aiAgentId: starting.skill.aiAgentId }
      : {
          id: (ongoing as ActiveProcedure).skillId,
          name: (ongoing as ActiveProcedure).snapshot.skill_name,
          aiAgentId: (ongoing as ActiveProcedure).snapshot.ai_agent_id,
        };

    const persona = starting
      ? starting.skill.persona
      : personaFor(ctx.config.skills, skill.id, skill.aiAgentId);
    const language = languageVerdict(message.text, persona, understanding.language);
    if (language.unsupported) {
      // AI-05 §7 → AI-09: a person answers. The procedure stays where it
      // stood — nothing of it ran — and goes on if the conversation comes back.
      return forcedHandoff(state, message, skill, {
        log: input.log,
        detected: language.detected,
        decided: {
          usage: input.spent,
          ...(input.understood ? { understood: input.understood } : {}),
          ...(input.policy ? { policy: input.policy } : {}),
        },
      });
    }

    // Where it starts: a new procedure pins its definition now (AI-03 §3) and
    // takes, on the connection's first turn, what an earlier connection on
    // the same topic collected today (tm 294).
    const earlier = starting ? message.earlierToday : undefined;
    const fresh: TurnState = { ...state, slots: {} };
    const before = earlier ? withEarlierToday(fresh, earlier, skill.id) : fresh;
    const target = earlier ? recallTarget(earlier, skill.id) : null;
    const snapshot: ProcedureSnapshot = starting
      ? {
          skill_name: starting.skill.name,
          ai_agent_id: starting.skill.aiAgentId,
          locked: starting.entry.locked,
          procedure: starting.procedure,
        }
      : (ongoing as ActiveProcedure).snapshot;

    return this.#runProcedure(state, message, ctx, {
      skill,
      persona,
      answerIn: language.answerIn,
      snapshot,
      hash: starting ? procedureHash(starting.procedure) : (ongoing as ActiveProcedure).hash,
      at: starting ? null : { stepId: (ongoing as ActiveProcedure).stepId },
      slots: starting ? before.slots : resuming ? input.suspendedSlots : state.slots,
      signals: starting ? before.signals : state.signals,
      procedureTurns: starting ? 0 : (ongoing as ActiveProcedure).procedureTurns,
      // An `ai` answer is keyed by the step or slot it was asked for, and it
      // was asked for the procedure in progress: a procedure starting now
      // reads none of them (its ids may be the same words).
      understanding: resuming
        ? null
        : starting && starting.entry.key !== input.active?.skillId
          ? { ...understanding, ai_conditions: {} }
          : understanding,
      suspended: input.suspendedNext,
      log: input.log,
      recall: earlier && target ? recallLine(target, earlier.trust, language.answerIn) : null,
      lastTurnAt: starting ? null : lastTurnAt(state),
      timeZone,
      currency,
      spent: input.spent,
      ...(input.understood ? { understood: input.understood } : {}),
      ...(input.policy ? { policy: input.policy } : {}),
    });
  }

  /**
   * The understanding call over the catalogue as narrowed (tm 297.3 · AI-05
   * §2): what the narrowing cost and said comes first in the turn's spend and
   * log, and its counts go in the decision record beside the reading.
   */
  async #understandNarrowed(
    message: TurnMessage,
    ctx: TurnContext,
    activeKey: string | null,
    input: UnderstandContextInput,
  ): Promise<Understood> {
    const narrowed = await this.#narrow(message, ctx, input.catalogue, activeKey);
    const understood = await this.#understand(message, ctx, {
      ...input,
      catalogue: narrowed.catalogue,
    });
    const spent = addUsage(narrowed.spent, understood.spent);
    const log = [...narrowed.log, ...understood.log];
    if (understood.understanding === null) return { ...understood, spent, log };
    return {
      ...understood,
      spent,
      log,
      ...(understood.record && narrowed.record
        ? { record: { ...understood.record, prefilter: narrowed.record } }
        : {}),
    };
  }

  /**
   * The catalogue narrowing (tm 297.3 · AI-05 §2 · `prefilter.ts`): past 15
   * procedures, the turn's message is embedded — once; the knowledge search
   * reuses it — and the call is offered the nearest by example, the locked
   * and the active. A narrowing that cannot run (the embedding failed or did
   * not fit today's cap) offers the whole catalogue and says so: it is an
   * economy, and its failure is not the player's.
   */
  async #narrow(
    message: TurnMessage,
    ctx: TurnContext,
    catalogue: readonly CatalogueEntry[],
    activeKey: string | null,
  ): Promise<{
    catalogue: CatalogueEntry[];
    spent: SkillRunUsage;
    log: SkillRunLogEntry[];
    record?: PrefilterRecord;
  }> {
    if (!needsPrefilter(catalogue))
      return { catalogue: [...catalogue], spent: NOTHING_SPENT, log: [] };
    let query: EmbeddedQuery;
    try {
      query = await this.#embedTurn(message, message.text, ctx);
    } catch (error) {
      if (error instanceof AiDailyCapError) {
        return {
          catalogue: [...catalogue],
          spent: NOTHING_SPENT,
          log: [
            {
              step: 'prefilter',
              detail: `not narrowed — today's AI cap is reached (${error.scope})`,
              ok: false,
            },
          ],
        };
      }
      if (!(error instanceof EmbeddingProviderError)) throw error;
      return {
        catalogue: [...catalogue],
        spent: addUsage(NOTHING_SPENT, { embeddingTokens: error.usage?.inputTokens ?? 0 }),
        log: [
          {
            step: 'prefilter',
            detail: `not narrowed — the message could not be embedded (${error.kind})`,
            ok: false,
          },
        ],
      };
    }
    // A preview's unsaved procedure has no id, so no examples: unranked, kept.
    const skillIds = catalogue.map((entry) => entry.key).filter((key) => UUID.test(key));
    const ranking = await ctx.db((tx) => this.#examples.rank(tx, ctx.tenant, query, skillIds));
    const narrowed = narrowCatalogue({
      catalogue,
      ranked: ranking.ranked,
      activeKey,
      strategy: ranking.strategy,
    });
    const spent = addUsage(NOTHING_SPENT, { embeddingTokens: query.usage.inputTokens });
    if (!narrowed.record) return { catalogue: narrowed.catalogue, spent, log: [] };
    return {
      catalogue: narrowed.catalogue,
      spent,
      log: [{ step: 'prefilter', detail: prefilterDetail(narrowed.record), ok: true }],
      record: narrowed.record,
    };
  }

  /**
   * The turn's message embedded — or `text`, a step's search with a hint —
   * asked of the provider once per turn and text (AI-05 §2: one embedding per
   * turn). A second ask returns the same vector at no cost: its tokens were
   * counted where it was first asked. A failure is not kept.
   */
  async #embedTurn(turn: TurnMessage, text: string, ctx: TurnContext): Promise<EmbeddedQuery> {
    const done = this.#turnEmbeddings.get(turn);
    if (done && done.text === text) return { ...done.query, usage: { inputTokens: 0 } };
    const query = await this.#knowledge.embedQuery(text, ctx.tenant, {
      surface: SURFACE[ctx.mode],
      chatId: ctx.chatId,
      configVersionId: ctx.configVersionId,
    });
    if (!done) this.#turnEmbeddings.set(turn, { text, query });
    return query;
  }

  /**
   * The understanding call (tm 297.1 · AI-05 §3 · `understand.ts`): one
   * structured call on the fast tier, counted on the turn's meter like every
   * other call. A reply that fails the schema twice, any other provider
   * failure and today's cap end in the same place as a failed answer — no
   * reading, and a person is sent (AI-09 `ai_failure`).
   */
  async #understand(
    message: TurnMessage,
    ctx: TurnContext,
    input: UnderstandContextInput,
  ): Promise<Understood> {
    const attribution: AiAttribution = {
      surface: SURFACE[ctx.mode],
      chatId: ctx.chatId,
      configVersionId: ctx.configVersionId,
    };
    const grounding = understandGrounding(input);
    const prompt = fitHistory(
      (history) => buildUnderstandPrompt({ grounding, ...(history ? { history } : {}) }),
      message.history,
      this.#maxPromptChars,
    );
    try {
      refuseOverlongPrompt(prompt, this.#maxPromptChars);
      const { value, usage, tries } = await completeStructured<UnderstandReply>(
        this.#llm.forTenant(ctx.tenant, attribution),
        { ...prompt, ...this.#limits, tier: 'fast', responseFormat: UNDERSTAND_RESPONSE_FORMAT },
      );
      const read = readUnderstanding(value, grounding);
      return {
        understanding: read.understanding,
        record: understoodRecord(read.understanding, tries),
        spent: addUsage(NOTHING_SPENT, {
          llmInputTokens: usage.inputTokens,
          llmOutputTokens: usage.outputTokens,
        }),
        log: [
          { step: 'understand', detail: understoodDetail(read.understanding, tries), ok: true },
          ...read.dropped.map((detail) => ({
            step: 'understand',
            detail: `dropped — ${detail}`,
            ok: false,
          })),
        ],
      };
    } catch (error) {
      if (error instanceof AiDailyCapError) {
        return {
          understanding: null,
          failure: null,
          capped: error,
          spent: NOTHING_SPENT,
          log: [
            {
              step: 'understand',
              detail: `today's AI cap is reached (${error.scope}) — handed to a human`,
              ok: false,
            },
          ],
        };
      }
      if (!(error instanceof LlmProviderError)) throw error;
      return {
        understanding: null,
        failure: { provider: 'llm', kind: error.kind, ...failureFacts(error) },
        capped: null,
        // A `no_answer` was generated — both tries of it — so it was billed.
        spent: addUsage(NOTHING_SPENT, {
          llmInputTokens: error.usage?.inputTokens ?? 0,
          llmOutputTokens: error.usage?.outputTokens ?? 0,
        }),
        log: [
          {
            step: 'understand',
            detail: `the model could not read the message (${error.kind}) — handed to a human`,
            ok: false,
          },
        ],
      };
    }
  }

  /** One turn of the chosen procedure, with its message written and its next state. */
  async #runProcedure(
    state: TurnState,
    message: TurnMessage,
    ctx: TurnContext,
    run: ProcedureRun,
  ): Promise<TurnResult> {
    const data = ctx.procedure ?? {};
    const turn = turnsTaken(state) + 1;
    const log: SkillRunLogEntry[] = [...run.log];
    const longGap =
      run.lastTurnAt !== null && ctx.now.getTime() - run.lastTurnAt.getTime() > LONG_GAP_MS;
    if (longGap) {
      // AI-03 §8: no timer inside a procedure; a long silence is said, not acted on.
      log.push({
        step: 'procedure',
        detail: `the player is back after more than ${LONG_GAP_MS / 60_000} minutes`,
        ok: true,
      });
    }

    const result = runProcedureTurn({
      procedure: run.snapshot.procedure,
      at: run.at,
      slots: run.slots,
      procedureTurns: run.procedureTurns,
      turn,
      understanding: run.understanding,
      messages: [message.text],
      ...(message.attachments ? { attachments: message.attachments } : {}),
      now: ctx.now,
      timeZone: run.timeZone,
      currency: run.currency,
      facts: data.facts ?? NO_FACTS,
      ...(data.options ? { options: data.options } : {}),
      language: run.answerIn,
      // AI-07 `max_questions_per_message`: the executor's, not the model's.
      maxQuestions: maxQuestionsOf(styleOf(ctx.config.skills, run.skill.aiAgentId)),
    });
    log.push(...result.log);

    // The message, in the order the steps produced it (AI-03 §5): texts as
    // they are, knowledge answers asked for, and every instruction written in
    // one call, in place of the first.
    const segments: Segment[] = [];
    const instructions: Array<{ at: string; text: string }> = [];
    let usage = run.spent;
    let knowledge: KnowledgeRecord | undefined;
    let guidance: GuidanceRecord | undefined;
    let failure: SkillFailure | null = null;
    let capped: AiDailyCapError | null = null;
    let failedAt: string | null = null;
    for (const part of result.parts) {
      if (failure || capped) break;
      switch (part.kind) {
        case 'template':
          segments.push({ kind: 'text', text: part.text });
          break;
        case 'question':
          segments.push({ kind: 'question', at: part.at, text: part.text });
          break;
        case 'instruction':
          if (instructions.length === 0) segments.push({ kind: 'written' });
          instructions.push({ at: part.at, text: part.text });
          break;
        case 'knowledge': {
          const answer = await this.#answerFromKnowledge({
            turn: message,
            message: message.text,
            ...(part.queryHint ? { query: `${part.queryHint}\n${message.text}` } : {}),
            history: message.history,
            earlierToday: message.earlierToday
              ? earlierTodayLines(message.earlierToday, run.recall !== null)
              : [],
            skill: run.skill,
            persona: run.persona,
            answerIn: run.answerIn,
            ctx,
          });
          usage = addUsage(usage, answer.spent);
          knowledge = mergeKnowledge(knowledge, answer.record);
          guidance = mergeGuidanceRecords(guidance, answer.guidance);
          if (answer.failure || answer.capped) {
            failure = answer.failure ?? null;
            capped = answer.capped ?? null;
            failedAt = part.at;
          } else if (answer.text) {
            // K5 (tm 294) is the answer's own check (`#answerFromKnowledge`).
            segments.push({ kind: 'text', text: answer.text });
          }
          log.push({ step: part.at, detail: answer.detail, ok: answer.text !== null });
          break;
        }
      }
    }

    if (!failure && !capped && instructions.length > 0) {
      const at = (instructions[0] as { at: string }).at;
      const written = await this.#compose({
        message,
        instructions: instructions.map((instruction) => instruction.text),
        alongside: segments.flatMap((segment) =>
          segment.kind === 'written' ? [] : [segment.text],
        ),
        notes: longGap ? [LONG_GAP_NOTE] : [],
        persona: run.persona,
        answerIn: run.answerIn,
        skill: run.skill,
        ctx,
      });
      usage = addUsage(usage, written.spent);
      guidance = mergeGuidanceRecords(guidance, written.guidance);
      log.push({ step: at, detail: written.detail, ok: written.text !== null });
      if (written.failure || written.capped) {
        failure = written.failure ?? null;
        capped = written.capped ?? null;
        failedAt = at;
      } else if (written.text) {
        const index = segments.findIndex((segment) => segment.kind === 'written');
        segments[index] = { kind: 'text', text: written.text };
      }
    }

    // A model that could not answer ends the AI's side of it (tm 255.6): what
    // the turn would have said is withdrawn and a person is sent — the steps'
    // own hand-over, when the procedure was ending in one anyway.
    const aborted = failure !== null || capped !== null;
    let end: ProcedureEnd = result.end;
    if (aborted && end.kind !== 'handoff') {
      end = {
        kind: 'handoff',
        stepId: failedAt,
        reason: failure ? `${failure.provider}_failure` : 'ai_cap_reached',
        target: null,
      };
    }

    let reply = aborted ? null : joinSegments(segments);
    let suspendedNext = run.suspended;
    if (
      !aborted &&
      (end.kind === 'resolved' || end.kind === 'finished') &&
      suspendedNext &&
      !suspendedNext.offered
    ) {
      // AI-03 §7: the new topic is done and one waits — ask before going back.
      const offer = PROCEDURE_PHRASES[run.answerIn ?? 'tr'].offer;
      reply = reply ? `${reply}\n${offer}` : offer;
      suspendedNext = { ...suspendedNext, offered: true };
      log.push({
        step: 'procedure',
        detail: `asked whether to go back to ${suspendedNext.snapshot.skill_name}`,
        ok: true,
      });
    }

    const sideEffects: TurnSideEffect[] = result.tags.map((tag) => ({ kind: 'tag', tag }));
    if (end.kind === 'handoff') sideEffects.push(handoffEffect(end));
    const handedOff = end.kind === 'handoff';
    const executed = withRecall(
      {
        reply,
        decisions: {
          outcome: handedOff ? 'handed_off' : reply ? 'answered' : 'skipped',
          skillId: run.skill.id,
          skillName: run.skill.name,
          replyKind: reply === null ? null : end.kind === 'awaiting' ? 'question' : 'answer',
          failure,
          capped,
          usage,
          log,
          handoffReason: handedOff && !aborted ? (end as { reason: string }).reason : null,
          trace: result.trace,
          procedureHash: run.hash,
          ...(knowledge ? { knowledge } : {}),
          ...(guidance ? { guidance } : {}),
          ...(run.understood ? { understood: run.understood } : {}),
          ...(run.policy ? { policy: run.policy } : {}),
        },
        sideEffects,
      },
      run.recall,
    );

    const goingOn = end.kind === 'awaiting' || end.kind === 'paused';
    const pinned = goingOn || handedOff;
    const next: TurnState = {
      ...state,
      // Ended by a hand-over, the procedure stays named — where it stopped,
      // `done` — for the card and a hand-back; resolved, it is cleared (AI-03 §4).
      activeSkillId: pinned ? run.skill.id : null,
      procedureSnapshot: pinned ? (run.snapshot as unknown as AiStateObject) : null,
      procedureSnapshotHash: pinned ? run.hash : null,
      stepId:
        end.kind === 'awaiting' || end.kind === 'paused'
          ? end.stepId
          : end.kind === 'handoff'
            ? (end.stepId ?? run.at?.stepId ?? null)
            : null,
      stepStatus:
        end.kind === 'awaiting'
          ? 'awaiting_answer'
          : end.kind === 'paused'
            ? 'ready'
            : handedOff
              ? 'done'
              : null,
      slots: result.slots,
      suspended: suspendedNext as unknown as AiStateObject | null,
      signals: run.signals,
      counters: {
        ...state.counters,
        turns: turn,
        procedure_turns: run.procedureTurns + 1,
        last_turn_at: ctx.now.toISOString(),
      },
      lastProcessedEventSeq: Math.max(state.lastProcessedEventSeq, message.throughSeq ?? 0),
    };
    const digest = buildDigest(state.digest, next, {
      skill: run.skill,
      intent: null,
      outcome: executed.decisions.outcome,
      reply: executed.reply,
      replyKind: executed.decisions.replyKind,
      sideEffects,
      ended: endedAs(end, executed.reply),
    });
    return { ...executed, nextState: { ...next, digest: digest as unknown as AiStateObject } };
  }

  /**
   * The written part of a procedure turn (AI-03 §5): one model call for every
   * instruction the turn's steps left, with the rest of the message beside it
   * so it neither repeats nor contradicts it. Counted like the knowledge
   * answer, and failing like it.
   */
  async #compose(input: {
    message: TurnMessage;
    instructions: readonly string[];
    alongside: readonly string[];
    notes: readonly string[];
    persona: Persona;
    answerIn: PersonaLanguage | null;
    /** The procedure's skill: whose rules and style apply (tm 299.1). */
    skill: { id: string; aiAgentId: string | null };
    ctx: TurnContext;
  }): Promise<KnowledgeAnswer> {
    const { ctx } = input;
    const attribution: AiAttribution = {
      surface: SURFACE[ctx.mode],
      chatId: ctx.chatId,
      configVersionId: ctx.configVersionId,
    };
    const rules = this.#rules(ctx, input.skill);
    const prompt = fitHistory(
      (history) =>
        buildComposePrompt({
          message: input.message.text,
          instructions: input.instructions,
          alongside: input.alongside,
          notes: input.notes,
          persona: input.persona,
          answerIn: input.answerIn,
          rules: rules.lines,
          ...(history ? { history } : {}),
        }),
      input.message.history,
      this.#maxPromptChars,
    );
    let completion: LlmCompletion;
    try {
      refuseOverlongPrompt(prompt, this.#maxPromptChars);
      completion = await this.#llm.complete(
        ctx.tenant,
        { ...prompt, ...this.#limits },
        attribution,
      );
    } catch (error) {
      if (error instanceof AiDailyCapError) {
        return {
          text: null,
          capped: error,
          detail: `today's AI cap is reached (${error.scope}) — handed to a human`,
        };
      }
      if (!(error instanceof LlmProviderError)) throw error;
      return {
        text: null,
        failure: { provider: 'llm', kind: error.kind, ...failureFacts(error) },
        spent: {
          llmInputTokens: error.usage?.inputTokens ?? 0,
          llmOutputTokens: error.usage?.outputTokens ?? 0,
        },
        detail: `the model could not write the reply (${error.kind}) — handed to a human`,
      };
    }
    const asked = personaRequest(input.persona, input.answerIn);
    const strayed = styleWarnings(completion.text, rules.style);
    return {
      text: completion.text,
      spent: {
        llmInputTokens: completion.usage.inputTokens,
        llmOutputTokens: completion.usage.outputTokens,
      },
      ...(rules.record ? { guidance: rules.record } : {}),
      detail: [
        `wrote ${input.instructions.length} instruction(s)`,
        `written by ${this.#llm.id}`,
        asked ? `persona: ${asked}` : '',
        rules.note,
        strayed.length > 0 ? `style warning: ${strayed.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }

  /**
   * The rules and style a written call carries (tm 299.1 · AI-07 §1–§3): the
   * agent's behaviour rules in this call's scope — its procedure, the
   * conversation's brand once a turn knows it (#309) — under the turn's
   * budget, then the persona's address form and emoji, as prompt layers.
   */
  #rules(
    ctx: TurnContext,
    skill: { id?: string | null; aiAgentId: string | null },
  ): {
    lines: string[];
    record: GuidanceRecord | null;
    style: PersonaStyle | undefined;
    note: string;
  } {
    const selection = selectGuidance(ctx.config.guidance ?? [], {
      aiAgentId: skill.aiAgentId,
      skillId: skill.id ?? null,
    });
    const style = styleOf(ctx.config.skills, skill.aiAgentId);
    return {
      lines: renderLayers([guidanceLayer(selection.rules), personaStyleLayer(style)]),
      record: guidanceRecord(selection),
      style,
      note: [
        selection.rules.length > 0 ? `${selection.rules.length} behaviour rule(s)` : '',
        selection.dropped.length > 0
          ? `guidance_truncated — ${selection.dropped.length} lower-priority rule(s) left out`
          : '',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }

  async #answerFromKnowledge(input: {
    /** The turn's message — whose embedding the narrowing may already have. */
    turn: TurnMessage;
    message: string;
    /** What is searched for, when not the message alone (a step's `query_hint`). */
    query?: string;
    history: TurnHistory | undefined;
    /** What the model is told of the day's earlier connections (tm 294). */
    earlierToday: readonly string[];
    /** Whose knowledge, rules and style; `id` the skill the answer is for, if any. */
    skill: { id?: string | null; aiAgentId: string | null };
    persona: Persona;
    answerIn: PersonaLanguage | null;
    ctx: TurnContext;
  }): Promise<KnowledgeAnswer> {
    const { ctx } = input;
    const attribution: AiAttribution = {
      surface: SURFACE[ctx.mode],
      chatId: ctx.chatId,
      configVersionId: ctx.configVersionId,
    };

    // Outside any transaction, like the model call below (see the file header).
    let question: EmbeddedQuery;
    try {
      question = await this.#embedTurn(input.turn, input.query ?? input.message, ctx);
    } catch (error) {
      if (error instanceof AiDailyCapError) {
        // The question's embedding did not fit today's cap (tm 257.20): nothing
        // was asked of any provider, so the turn cost nothing, and with nothing
        // retrieved the model is not asked either — as at the model's own cap.
        return {
          text: null,
          capped: error,
          spent: { embeddingTokens: 0 },
          detail: `today's AI cap is reached (${error.scope}) — handed to a human`,
        };
      }
      if (!(error instanceof EmbeddingProviderError)) throw error;
      // Nothing retrieved, so nothing to ground an answer in: the model is not
      // asked at all. The provider logged its status and code; its message
      // never travels (`embedding-error.ts`).
      return {
        text: null,
        failure: { provider: 'embedding', kind: error.kind, ...failureFacts(error) },
        spent: { embeddingTokens: error.usage?.inputTokens ?? 0 },
        detail: `the knowledge search could not run (${error.kind}) — handed to a human`,
      };
    }
    const embeddingTokens = question.usage.inputTokens;

    const passages = passageBudget(input.persona);
    const { chunks: hits, chunksInScope } = await ctx.db((tx) =>
      this.#knowledge.search(tx, ctx.tenant, question, {
        ...(input.skill.aiAgentId ? { aiAgentId: input.skill.aiAgentId } : {}),
        // Never below the two this always fetched, so an unset persona issues the
        // identical query; a `long` answer is the only thing that widens it.
        limit: Math.max(ANSWER_RETRIEVAL_LIMIT, passages),
      }),
    );

    if (hits.length === 0) {
      // Answering from an unrelated article is worse than admitting there is no
      // answer. Below the threshold the model is not asked at all (AI-06 §5).
      return {
        text: null,
        spent: { embeddingTokens },
        missed: 'no_passages',
        record: { grounded: 'none', cited_ids: [], source_ids: [] },
        detail:
          chunksInScope === 0
            ? // Said apart from a miss, because it is read by whoever has to fix
              // it: an empty knowledge base, or one still stored in another
              // embedding space than the one questions are asked in (PLAN §D182).
              `nothing searchable in the knowledge base — empty, or not yet re-embedded for ${question.space}`
            : `nothing in the knowledge base above ${this.#knowledge.threshold} similarity`,
      };
    }

    // The answer is an object (tm 298 · AI-06 §6): the reply, whether the
    // passages answer it, and which of them it is drawn from — by the labels
    // the prompt gives them. Outside any transaction (see the file header).
    // The persona travels in the prompt: the provider — model or stub — is
    // what applies it, so the run log records what was *asked for*.
    const labels = hits.map((_, index) => passageLabel(index));
    const sources = hits.map((hit) => hit.text);
    const rules = this.#rules(ctx, input.skill);
    const llm = this.#llm.forTenant(ctx.tenant, attribution);
    const draft = (notes: readonly string[]) => {
      const prompt = fitHistory(
        (history) =>
          buildAnswerPrompt({
            message: input.message,
            passages: sources,
            persona: input.persona,
            answerIn: input.answerIn,
            rules: rules.lines,
            cite: { ids: labels, notes },
            ...(history ? { history } : {}),
            ...(input.earlierToday.length > 0 ? { earlierToday: input.earlierToday } : {}),
          }),
        input.history,
        this.#maxPromptChars,
      );
      // Measured where the prompt is whole, so the refusal comes before the
      // provider — any provider — is reached (tm 255.9).
      refuseOverlongPrompt(prompt, this.#maxPromptChars);
      return completeStructured<KnowledgeAnswerReply>(llm, {
        ...prompt,
        ...this.#limits,
        tier: 'default',
        responseFormat: KNOWLEDGE_ANSWER_RESPONSE_FORMAT,
      });
    };

    let spent: Partial<SkillRunUsage> = { embeddingTokens };
    const bill = (usage: { inputTokens: number; outputTokens: number } | null | undefined) => {
      spent = {
        embeddingTokens,
        llmInputTokens: (spent.llmInputTokens ?? 0) + (usage?.inputTokens ?? 0),
        llmOutputTokens: (spent.llmOutputTokens ?? 0) + (usage?.outputTokens ?? 0),
      };
    };
    let read: ReadKnowledgeAnswer;
    let drafts: 1 | 2 = 1;
    const repeated = (answer: ReadKnowledgeAnswer): KnowledgeAnswer | null => {
      if (answer.grounded === 'none') return null;
      const leaked = repeatsEarlierDetail(
        answer.reply,
        input.turn.earlierToday,
        saidSoFar(input.turn),
      );
      if (leaked.length === 0) return null;
      return {
        text: null,
        spent,
        missed: 'withheld',
        record: {
          grounded: 'none',
          cited_ids: [],
          source_ids: [],
          ...(drafts === 2 ? { drafts } : {}),
        },
        detail: `withheld — it repeated ${leaked.length} detail(s) from an earlier conversation today the player has not given again`,
      };
    };
    try {
      const first = await draft([]);
      bill(first.usage);
      read = readKnowledgeAnswer(first.value, { labels, sources });
      // K5 (tm 294) first: an amount, an IBAN or a transaction id from an
      // earlier connection the player has not given again is not the AI's to
      // say — withheld, and a person answers, with no second draft asked for.
      const leakedFirst = repeated(read);
      if (leakedFirst) return leakedFirst;
      if (read.problems.length > 0) {
        // A citation it was not given, nothing cited, a figure no passage
        // gives (AI-06 §6, §11): written once more with the rule named — the
        // AI-08 output check's rewrite (#301) — and withheld if it breaks one
        // again. A guess never reaches the player.
        drafts = 2;
        const second = await draft([rewriteNote(read.problems)]);
        bill(second.usage);
        const again = readKnowledgeAnswer(second.value, { labels, sources });
        if (again.problems.length > 0) {
          return {
            text: null,
            spent,
            missed: 'withheld',
            record: {
              grounded: 'none',
              cited_ids: [],
              source_ids: [],
              drafts,
              withheld: again.problems.map((problem) => problem.kind),
            },
            detail: `withheld — written twice, and still ${problemDetail(again.problems)}`,
          };
        }
        read = again;
        const leakedAgain = repeated(read);
        if (leakedAgain) return leakedAgain;
      }
    } catch (error) {
      if (error instanceof AiDailyCapError) {
        // Refused before any provider was reached (tm 257.8): what was asked
        // before the refusal is the turn's only cost, and the refusal was
        // logged once where the cap decided it (`ai-daily-budget.ts`).
        return {
          text: null,
          capped: error,
          spent,
          detail: `today's AI cap is reached (${error.scope}) — handed to a human`,
        };
      }
      // A defect is not a provider failure: it propagates to the responder's
      // catch and is logged with its stack rather than filed as a hand-off.
      if (!(error instanceof LlmProviderError)) throw error;
      // The kind is all the run log keeps; the facts beside it go to the
      // operator's log (`ai-responder.ts`). The provider's message never
      // travels (`llm-error.ts`). A `no_answer` was generated, so it was
      // billed; the other kinds carry no usage and cost 0 here.
      bill(error.usage);
      return {
        text: null,
        failure: { provider: 'llm', kind: error.kind, ...failureFacts(error) },
        spent,
        detail: `the model could not answer (${error.kind}) — handed to a human`,
      };
    }

    if (read.grounded === 'none') {
      // The model read the passages and they do not answer it (AI-06 §7):
      // nothing of its reply is used.
      return {
        text: null,
        spent,
        missed: 'not_grounded',
        record: {
          grounded: 'none',
          cited_ids: [],
          source_ids: [],
          ...(drafts === 2 ? { drafts } : {}),
        },
        detail: `the passages found do not answer it (best "${hits[0]!.sourceName}", ${hits[0]!.score})`,
      };
    }

    const cited = read.cited.map((label) => hits[labels.indexOf(label)]!);
    const best = cited[0]!;
    const asked = personaRequest(input.persona, input.answerIn);
    const strayed = styleWarnings(read.reply, rules.style);
    return {
      text: read.reply,
      grounded: read.grounded,
      spent,
      record: {
        grounded: read.grounded,
        cited_ids: cited.map((hit) => hit.id),
        source_ids: [...new Set(cited.map((hit) => hit.sourceId))],
        ...(drafts === 2 ? { drafts } : {}),
      },
      ...(rules.record ? { guidance: rules.record } : {}),
      detail: [
        `answered from "${best.sourceName}" (${best.score})`,
        cited.length > 1 ? `+ ${cited.length - 1} more passage(s)` : '',
        read.grounded === 'partial' ? 'in part' : '',
        drafts === 2 ? 'written again' : '',
        `written by ${this.#llm.id}`,
        asked ? `persona: ${asked}` : '',
        rules.note,
        strayed.length > 0 ? `style warning: ${strayed.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }

  /**
   * The knowledge path's own answer (tm 298 · AI-06): no procedure took the
   * message and no one-message skill answered it, so the AI-13 tables are
   * asked, then the knowledge base, in the agent's persona and language. A
   * provider failure or today's cap hands over (the silence rule); a question
   * the knowledge base does not answer comes back as a miss, for the fallback
   * and then the no-answer reply ({@link #noAnswer}).
   */
  async #knowledgeTurn(
    state: TurnState,
    message: TurnMessage,
    ctx: TurnContext,
    input: {
      understanding: ProcedureUnderstanding | null;
      spent: SkillRunUsage;
      log: SkillRunLogEntry[];
      decided: Partial<TurnDecisions>;
    },
  ): Promise<TurnResult | KnowledgeMiss> {
    const persona = agentPersona(ctx.config.skills);
    const language = languageVerdict(message.text, persona, input.understanding?.language);
    if (language.unsupported) {
      return forcedHandoff(state, message, null, {
        log: input.log,
        detected: language.detected,
        decided: { ...input.decided, usage: input.spent },
      });
    }
    const { answerIn } = language;
    const taken = (executed: Executed, signals: AiStateObject = state.signals): TurnResult => ({
      ...executed,
      nextState: {
        ...state,
        signals,
        counters: { ...state.counters, turns: turnsTaken(state) + 1 },
        lastProcessedEventSeq: Math.max(state.lastProcessedEventSeq, message.throughSeq ?? 0),
      },
    });

    // A row of the AI-13 tables before any passage (AI-06 §3): its value, exact.
    const fact = await this.#facts.answer({
      message: message.text,
      understanding: input.understanding,
      language: answerIn,
    });
    if (fact) {
      return taken({
        reply: fact.text,
        decisions: {
          ...NOTHING_DECIDED,
          ...input.decided,
          outcome: 'answered',
          replyKind: 'answer',
          usage: input.spent,
          log: [
            ...input.log,
            {
              step: 'knowledge',
              detail: `answered from ${fact.factIds.length} table row(s)`,
              ok: true,
            },
          ],
        },
        sideEffects: [],
      });
    }

    const answer = await this.#answerFromKnowledge({
      turn: message,
      message: message.text,
      ...knowledgeQuery(message),
      history: message.history,
      earlierToday: message.earlierToday ? earlierTodayLines(message.earlierToday, false) : [],
      skill: { aiAgentId: turnAgentId(ctx.config.skills) },
      persona,
      answerIn,
      ctx,
    });
    const spent = addUsage(input.spent, answer.spent);
    const line: SkillRunLogEntry = {
      step: 'knowledge',
      detail: answer.detail,
      ok: answer.text !== null,
    };
    const knowledge = {
      ...(answer.record ? { knowledge: answer.record } : {}),
      ...(answer.guidance ? { guidance: answer.guidance } : {}),
    };

    if (answer.failure || answer.capped) {
      // The model or the search could not answer: a person does (tm 255.6),
      // and says so by taking it over — not by a silence (AI-06 §9).
      const failure = answer.failure ?? null;
      return taken({
        reply: null,
        decisions: {
          ...NOTHING_DECIDED,
          ...input.decided,
          ...knowledge,
          outcome: 'handed_off',
          failure,
          capped: answer.capped ?? null,
          usage: spent,
          log: [...input.log, line],
        },
        sideEffects: [
          {
            kind: 'handoff',
            team: null,
            reason: failure ? `${failure.provider}_failure` : 'ai_cap_reached',
          },
        ],
      });
    }

    if (answer.text !== null) {
      // Partial (AI-06 §7): the answer, and a person offered for the rest —
      // a "yes" on the next turn hands over (`#answerToOffer`). K5 was the
      // answer's own check (`#answerFromKnowledge`).
      const partial = answer.grounded === 'partial';
      return taken(
        {
          reply: partial
            ? `${answer.text}\n${NO_ANSWER_PHRASES[answerIn ?? 'tr'].offer}`
            : answer.text,
          decisions: {
            ...NOTHING_DECIDED,
            ...input.decided,
            ...knowledge,
            outcome: 'answered',
            replyKind: 'answer',
            usage: spent,
            log: [...input.log, line],
          },
          sideEffects: [],
        },
        partial
          ? { ...state.signals, [NO_ANSWER_SIGNAL]: noAnswerSignal(turnsTaken(state) + 1) }
          : state.signals,
      );
    }
    return { miss: true, spent, reason: answer.missed ?? 'no_passages', ...knowledge, log: [line] };
  }

  /**
   * The answer when there is none (tm 298 · AI-06 §8, AI-06-S1): the AI says it
   * cannot answer — never a guess, never a silence — and, by the question's
   * group and the agent's `no_answer` setting, hands over at once (reason
   * `no_knowledge`) or asks once whether to. A group set to ask is asked once
   * per conversation: a second miss hands over without asking. Built on
   * `base` when a skill ran and said nothing — its tags and summary stay.
   */
  #noAnswer(
    state: TurnState,
    message: TurnMessage,
    ctx: TurnContext,
    input: {
      base: TurnResult | null;
      understanding: RiskReading | null;
      reason: UnansweredReason;
      decided: Partial<TurnDecisions>;
    },
  ): TurnResult {
    const { base } = input;
    const persona = agentPersona(ctx.config.skills);
    const { answerIn } = languageVerdict(message.text, persona, input.understanding?.language);
    const settings = ctx.noAnswer ?? DEFAULT_NO_ANSWER;
    const category = noAnswerCategory(message.text, input.understanding);
    const before: TurnState =
      base && tookTurn(base)
        ? base.nextState
        : {
            ...state,
            counters: { ...state.counters, turns: turnsTaken(state) + 1 },
            lastProcessedEventSeq: Math.max(state.lastProcessedEventSeq, message.throughSeq ?? 0),
          };
    const askedBefore = readNoAnswerMark(state.signals) !== null;
    const policy =
      settings.policy_by_category[category] === 'ask' && !askedBefore ? 'ask' : 'handoff';
    const phrases = NO_ANSWER_PHRASES[answerIn ?? 'tr'];
    const handingOff = policy === 'handoff';
    const decisions = base?.decisions ?? NOTHING_DECIDED;
    return {
      reply: handingOff ? (settings.text ?? phrases.handoff) : phrases.ask,
      decisions: {
        ...decisions,
        ...input.decided,
        outcome: handingOff ? 'handed_off' : 'answered',
        replyKind: handingOff ? 'answer' : 'question',
        handoffReason: handingOff ? 'no_knowledge' : null,
        log: [
          ...(input.decided.log ?? decisions.log),
          {
            step: 'no_answer',
            detail: handingOff
              ? `no answer in the knowledge base (${category}) — said so and handed to a human`
              : `no answer in the knowledge base (${category}) — said so and asked whether to hand over`,
            ok: true,
          },
        ],
        unanswered: {
          language: answerIn,
          category,
          policy,
          reason: input.reason,
        },
      },
      sideEffects: [
        ...(base?.sideEffects ?? []),
        ...(handingOff ? [{ kind: 'handoff' as const, team: null, reason: 'no_knowledge' }] : []),
      ],
      nextState: handingOff
        ? before
        : {
            ...before,
            signals: { ...before.signals, [NO_ANSWER_SIGNAL]: noAnswerSignal(turnsTaken(before)) },
          },
    };
  }

  /**
   * The player's "yes" or "no" to the offer of a person the AI made on its
   * previous turn (tm 298 · AI-06 §7–§8): "yes" hands over (`no_knowledge`),
   * "no" is answered. Anything else is an ordinary message — null — and the
   * offer stays made: it is not made twice.
   */
  #answerToOffer(state: TurnState, message: TurnMessage, ctx: TurnContext): TurnResult | null {
    const mark = readNoAnswerMark(state.signals);
    if (!mark || mark.turn !== turnsTaken(state) || ctx.config.skills.length === 0) return null;
    const said = readOfferAnswer(message.text);
    if (said === null) return null;
    const { answerIn } = languageVerdict(message.text, agentPersona(ctx.config.skills), null);
    const phrases = NO_ANSWER_PHRASES[answerIn ?? 'tr'];
    const yes = said === 'yes';
    return {
      reply: yes ? phrases.handingOver : phrases.declined,
      decisions: {
        ...NOTHING_DECIDED,
        outcome: yes ? 'handed_off' : 'answered',
        replyKind: 'answer',
        handoffReason: yes ? 'no_knowledge' : null,
        log: [
          {
            step: 'no_answer',
            detail: yes
              ? 'the player accepted the offer of a person — handed to a human'
              : 'the player declined the offer of a person',
            ok: true,
          },
        ],
      },
      sideEffects: yes ? [{ kind: 'handoff', team: null, reason: 'no_knowledge' }] : [],
      nextState: {
        ...state,
        counters: { ...state.counters, turns: turnsTaken(state) + 1 },
        lastProcessedEventSeq: Math.max(state.lastProcessedEventSeq, message.throughSeq ?? 0),
      },
    };
  }

  /**
   * The silence rule (tm 298 · AI-06 §9 — tested in one place,
   * `ai-knowledge-answer.test.ts`): on a connection that is the AI's, and on
   * every turn the decision order sent down the knowledge path, the turn ends
   * with a message to the player or a hand-over. A turn that failed or was
   * capped without one hands over; one that said nothing gets the no-answer
   * reply. An AI with nothing to run takes no turn at all.
   */
  #neverSilent(
    state: TurnState,
    message: TurnMessage,
    ctx: TurnContext,
    result: TurnResult,
  ): TurnResult {
    const knowledgePath = (result.decisions.policy?.step ?? 0) >= 5;
    if ((ctx.aiMode !== 'ai' && !knowledgePath) || ctx.config.skills.length === 0) return result;
    if (result.reply !== null || handoffOf(result.sideEffects) !== null) return result;
    const { decisions } = result;
    if (decisions.failure || decisions.capped) {
      return {
        ...result,
        decisions: { ...decisions, outcome: 'handed_off' },
        sideEffects: [
          ...result.sideEffects,
          {
            kind: 'handoff',
            team: null,
            reason: decisions.failure ? `${decisions.failure.provider}_failure` : 'ai_cap_reached',
          },
        ],
      };
    }
    return this.#noAnswer(state, message, ctx, {
      base: result,
      understanding: null,
      reason: 'nothing_answered',
      decided: {},
    });
  }
}

/** The procedure's gates; all of them must match. */
function intentGate(
  gates: readonly IntentGate[],
  message: string,
): { matched: boolean; log: SkillRunLogEntry[] } {
  // No gate means the procedure applies to everything — which is a legitimate
  // choice for a single catch-all skill.
  if (gates.length === 0) return { matched: true, log: [] };

  const log: SkillRunLogEntry[] = [];
  let matched = true;

  for (const gate of gates) {
    const result = matchIntent(message, gate.intent, [...gate.phrases]);
    log.push({
      step: 'detect_intent',
      detail: result.matched
        ? `matched "${gate.intent}" (${result.score}) on ${result.hits.join(', ')}`
        : `no match for "${gate.intent}" (${result.score})`,
      ok: result.matched,
    });
    if (!result.matched) matched = false;
  }

  return { matched, log };
}

/** Whether a step would say something to the visitor. */
function speaks(step: ProcedureStep): boolean {
  return step.type === 'say' || step.type === 'collect' || step.type === 'answer_from_knowledge';
}

/**
 * The state after a turn the AI took: one more turn counted (AI-03 §6), and
 * the visitor's messages it answered marked processed (AI-01 §5 — never moved
 * back). A one-turn procedure leaves no step active behind it; what it did
 * goes into the connection's summary (`digest`, tm 294).
 */
function afterTurn(
  state: TurnState,
  message: TurnMessage,
  executed: Executed,
  skill: { id: string; name: string },
  intent: string | null,
): TurnState {
  const next: TurnState = {
    ...state,
    counters: { ...state.counters, turns: turnsTaken(state) + 1 },
    lastProcessedEventSeq: Math.max(state.lastProcessedEventSeq, message.throughSeq ?? 0),
  };
  // The connection's summary for the day's later connections (tm 294 · AI-02),
  // rebuilt every turn so a connection that dies mid-way still leaves one.
  const digest = buildDigest(state.digest, next, {
    skill,
    intent,
    outcome: executed.decisions.outcome,
    reply: executed.reply,
    replyKind: executed.decisions.replyKind,
    sideEffects: executed.sideEffects,
  });
  return { ...next, digest: digest as unknown as AiStateObject };
}

/**
 * The turn with the recall line in front of what it says (tm 294 · AI-02 §6):
 * before its reply, or alone when it hands over without one. Nothing when the
 * AI could not answer — a person starts clean (the file header).
 */
function withRecall(executed: Executed, recall: string | null): Executed {
  const { decisions } = executed;
  if (!recall || decisions.failure || decisions.capped) return executed;
  if (executed.reply) return { ...executed, reply: `${recall}\n${executed.reply}` };
  if (decisions.outcome !== 'handed_off') return executed;
  return { ...executed, reply: recall, decisions: { ...decisions, replyKind: 'answer' } };
}

/** What the player has said in this connection: the message and their earlier lines. */
function saidSoFar(message: TurnMessage): string {
  const earlier = (message.history?.messages ?? [])
    .filter((entry) => entry.role === 'user')
    .map((entry) => entry.content);
  return [...earlier, message.text].join('\n');
}

/**
 * A hand-over the decision order forces (AI-05 §4.1, §7 → AI-09): the message
 * is in a language the persona does not speak. Not a silence — a person
 * answers. `ok: true` on the log entry: nothing failed, the AI did the one
 * correct thing with a message it cannot serve. A procedure in progress stays
 * where it stood: nothing of it ran.
 */
function forcedHandoff(
  state: TurnState,
  message: TurnMessage,
  skill: { id: string; name: string } | null,
  input: {
    log: readonly SkillRunLogEntry[];
    detected: string | null;
    /** What the turn already decided and cost: the understanding, the rule. */
    decided: Partial<TurnDecisions>;
    intent?: string | null;
  },
): TurnResult {
  const executed: Executed = {
    reply: null,
    decisions: {
      ...NOTHING_DECIDED,
      ...input.decided,
      outcome: 'handed_off',
      skillId: skill?.id ?? null,
      skillName: skill?.name ?? null,
      replyKind: null,
      failure: null,
      capped: null,
      handoffReason: 'unsupported_language',
      log: [
        ...input.log,
        {
          step: 'persona',
          detail: `handed to a human — the message is in ${input.detected ?? 'another language'}, which this persona does not speak`,
          ok: true,
        },
      ],
    },
    sideEffects: [{ kind: 'handoff', team: null, reason: 'unsupported_language' }],
  };
  const nextState = skill
    ? afterTurn(state, message, executed, skill, input.intent ?? null)
    : {
        ...state,
        counters: { ...state.counters, turns: turnsTaken(state) + 1 },
        lastProcessedEventSeq: Math.max(state.lastProcessedEventSeq, message.throughSeq ?? 0),
      };
  return { ...executed, nextState };
}

/**
 * The reply to small talk (AI-05 §4.5): short, in the persona's language,
 * nothing searched and no model asked — a greeting is not worth a call.
 */
const SMALLTALK_PHRASES: Readonly<Record<PersonaLanguage, string>> = {
  tr: 'Buradayım — size nasıl yardımcı olabilirim?',
  en: 'I’m here — how can I help you?',
  de: 'Ich bin für Sie da — wie kann ich helfen?',
  fr: 'Je suis là — comment puis-je vous aider ?',
  es: 'Aquí estoy — ¿en qué puedo ayudarle?',
};

/**
 * What the knowledge path searches for (AI-06 §2): the player's message — and,
 * when the AI's last message asked something, that question before it, so
 * "Papara" is searched as the answer it is. The message alone is the turn's
 * embedding, reused; with a question it is one more.
 */
function knowledgeQuery(message: TurnMessage): { query?: string } {
  const last = message.history?.messages.at(-1);
  if (last?.role !== 'assistant') return {};
  const question = last.content.split('\n').at(-1)?.trim() ?? '';
  if (!question.endsWith('?') || question.length > 200) return {};
  return { query: `${question}\n${message.text}` };
}

/** The persona a turn with no skill speaks in: the agent's, read off its first skill. */
function agentPersona(skills: readonly TurnSkill[]): Persona {
  return skills[0]?.persona ?? readPersona(null);
}

/** How many retrieved passages this persona's answer length pays for. */
function passageBudget(persona: Persona): number {
  return persona.answerLength
    ? ANSWER_BUDGETS[persona.answerLength].passages
    : DEFAULT_ANSWER_PASSAGES;
}

/** The operator's half of a {@link SkillFailure}: everything but the kind. */
function failureFacts(
  error: LlmProviderError | EmbeddingProviderError,
): Omit<SkillFailure, 'provider' | 'kind'> {
  return {
    transient: error.transient,
    status: error.status,
    code: error.code,
    requestId: error.requestId,
    reason: error.reason,
  };
}

/**
 * The turn's knowledge record with one more search's: every chunk and source
 * cited, once; the grounding of the last search that answered.
 */
function mergeKnowledge(
  total: KnowledgeRecord | undefined,
  next: KnowledgeRecord | undefined,
): KnowledgeRecord | undefined {
  if (!next) return total;
  if (!total) return next;
  return {
    ...total,
    ...next,
    grounded: next.grounded === 'none' ? total.grounded : next.grounded,
    cited_ids: [...new Set([...total.cited_ids, ...next.cited_ids])],
    source_ids: [...new Set([...total.source_ids, ...next.source_ids])],
  };
}

/** A running total plus one step's spend. */
function addUsage(total: SkillRunUsage, spent: Partial<SkillRunUsage> = {}): SkillRunUsage {
  return {
    llmInputTokens: total.llmInputTokens + (spent.llmInputTokens ?? 0),
    llmOutputTokens: total.llmOutputTokens + (spent.llmOutputTokens ?? 0),
    embeddingTokens: total.embeddingTokens + (spent.embeddingTokens ?? 0),
  };
}

/**
 * The persona settings the answer was asked to follow, for the run log, or
 * `''` when it asked for nothing. Stated as a request because that is all the
 * engine knows: the provider applies it.
 */
function personaRequest(persona: Persona, answerIn: PersonaLanguage | null): string {
  return [
    persona.answerLength ? `${persona.answerLength} answer` : '',
    persona.tone ? `${persona.tone} tone` : '',
    answerIn ? `in ${answerIn}` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Whether the message already carries the field being asked for.
 *
 * Deliberately shallow — it looks for a plausible value, not a validated one.
 * The cost of a false positive is one unasked question; the cost of a false
 * negative is asking a customer for something they just typed.
 */
function looksSupplied(message: string, field: string): boolean {
  if (/order|reference|tracking|invoice/i.test(field)) {
    // An order number is a run of digits, or letters-and-digits together.
    return /\b(?=[a-z0-9-]*\d)[a-z0-9-]{5,}\b/i.test(message);
  }
  if (/email/i.test(field)) return /\S+@\S+\.\S+/.test(message);
  if (/phone|number/i.test(field)) return /\+?\d[\d\s-]{6,}/.test(message);
  return false;
}

/**
 * The prompt with as much of the history as fits `maxPromptChars` — all of it
 * when it fits, none when not even the shortest does (the refusal is then the
 * passages' and the message's, and `refuseOverlongPrompt` makes it).
 */
function fitHistory(
  build: (history: TurnHistory | undefined) => LlmPrompt,
  history: TurnHistory | undefined,
  maxPromptChars: number,
): LlmPrompt {
  let current = history;
  let prompt = build(current);
  while (current && promptLength(prompt) > maxPromptChars) {
    current = shortenHistory(current);
    prompt = build(current);
  }
  return prompt;
}

/**
 * A one-line summary for the agent who picks the conversation up: the
 * visitor's opening message — the history's first visitor line — and how many
 * messages they have written.
 */
function buildSummary(message: string, history: TurnHistory | undefined, contact: number): string {
  const opened = history?.messages
    .find((entry) => entry.role === 'user')
    ?.content.split('\n')
    .find((line) => line.trim() && line !== GAP_MARKER);
  const count = (history?.visitorMessages ?? 0) + 1;
  const first = opened ?? message;
  const opening = first.length > 160 ? `${first.slice(0, 157)}…` : first;
  const said =
    count > 1
      ? `Customer opened with: ${opening} (${count} messages so far)`
      : `Customer asked: ${opening}`;
  // The card says when the member is back the same day (tm 294 · AI-02).
  return contact > 1 ? `Same day, contact ${contact} · ${said}` : said;
}

/**
 * The procedure skills the turn may start, their definitions judged: one that
 * does not pass is skipped, as a malformed step list is — a customer must not
 * lose a message to a definition stored past the API.
 */
function procedureCatalogue(skills: readonly TurnSkill[]): ProcedureItem[] {
  const catalogue: ProcedureItem[] = [];
  for (const skill of skills) {
    if (skill.mode !== 'procedure' || skill.definition === undefined) continue;
    const parsed = validateSkillProcedure(skill.definition);
    if (!parsed.ok) continue;
    catalogue.push({
      entry: {
        key: skill.id,
        name: skill.name,
        whenToUse: parsed.procedure.when_to_use,
        examples: parsed.procedure.examples,
        priority: parsed.procedure.priority,
        locked: skill.locked === true,
      },
      skill,
      procedure: parsed.procedure,
    });
  }
  return catalogue;
}

/**
 * The one-message skills, in their order, their steps judged: a malformed list
 * is skipped rather than crashing the message path — a customer must never
 * lose a message because an admin saved a broken step list.
 */
function singleSkills(skills: readonly TurnSkill[]): SingleItem[] {
  const items: SingleItem[] = [];
  for (const skill of skills) {
    if (skill.mode === 'procedure') continue;
    const parsed = validateSteps(skill.steps);
    if (!parsed.ok) continue;
    items.push({ skill, procedure: adaptLegacySkill(parsed.steps) });
  }
  return items;
}

type FallbackCandidate =
  { kind: 'procedure'; item: ProcedureItem } | { kind: 'single'; item: SingleItem };

/**
 * What answers when nothing else does (AI-05 §5), in the order tried: the
 * skills marked `is_fallback` — one per agent, though rows from before the
 * rule may hold more — then the one-message skills with no gate.
 */
function fallbacks(
  skills: readonly TurnSkill[],
  singles: readonly SingleItem[],
): FallbackCandidate[] {
  const procedures = new Map(procedureCatalogue(skills).map((item) => [item.skill.id, item]));
  const ones = new Map(singles.map((item) => [item.skill.id, item]));
  const marked: FallbackCandidate[] = [];
  for (const skill of skills) {
    if (!skill.isFallback) continue;
    const procedure = procedures.get(skill.id);
    const single = ones.get(skill.id);
    if (procedure) marked.push({ kind: 'procedure', item: procedure });
    else if (single) marked.push({ kind: 'single', item: single });
  }
  const open = singles
    .filter((item) => !item.skill.isFallback && item.procedure.whenToUse.length === 0)
    .map((item): FallbackCandidate => ({ kind: 'single', item }));
  return [...marked, ...open];
}

/** The procedure in progress as the understanding call sees it: its pinned definition. */
function snapshotEntry(active: ActiveProcedure): CatalogueEntry {
  const { procedure } = active.snapshot;
  return {
    key: active.skillId,
    name: active.snapshot.skill_name,
    whenToUse: procedure.when_to_use,
    examples: procedure.examples,
    priority: procedure.priority,
    locked: active.snapshot.locked,
  };
}

/**
 * The turn when the message could not be understood (AI-05 §3 → AI-09
 * `ai_failure`): nothing is said, a person is sent, and a procedure in
 * progress stays where it stood — nothing of it ran, so it can go on if the
 * conversation is handed back.
 */
function notUnderstood(
  state: TurnState,
  message: TurnMessage,
  active: ActiveProcedure | null,
  understood: Extract<Understood, { understanding: null }>,
): TurnResult {
  const skill = active ? { id: active.skillId, name: active.snapshot.skill_name } : null;
  const executed: Executed = {
    reply: null,
    decisions: {
      ...NOTHING_DECIDED,
      outcome: 'handed_off',
      skillId: skill?.id ?? null,
      skillName: skill?.name ?? null,
      failure: understood.failure,
      capped: understood.capped,
      usage: understood.spent,
      log: understood.log,
      ...(active ? { trace: [], procedureHash: active.hash } : {}),
    },
    sideEffects: [
      {
        kind: 'handoff',
        team: null,
        reason: understood.failure ? `${understood.failure.provider}_failure` : 'ai_cap_reached',
      },
    ],
  };
  const nextState = skill
    ? afterTurn(state, message, executed, skill, null)
    : {
        ...state,
        counters: { ...state.counters, turns: turnsTaken(state) + 1 },
        lastProcessedEventSeq: Math.max(state.lastProcessedEventSeq, message.throughSeq ?? 0),
      };
  return { ...executed, nextState };
}

/**
 * The persona a procedure in progress answers in: its skill's, or — the skill
 * turned off since it started — any skill's of the same agent, or none.
 */
function personaFor(
  skills: readonly TurnSkill[],
  skillId: string,
  aiAgentId: string | null,
): Persona {
  const own =
    skills.find((skill) => skill.id === skillId) ??
    (aiAgentId === null ? undefined : skills.find((skill) => skill.aiAgentId === aiAgentId));
  return own?.persona ?? readPersona(null);
}

/**
 * The style of the agent a call speaks for (tm 299.1): read off its first
 * skill, as its persona is; absent when the agent has no skill in the turn.
 */
function styleOf(skills: readonly TurnSkill[], aiAgentId: string | null): PersonaStyle | undefined {
  if (aiAgentId === null) return skills[0]?.style;
  return skills.find((skill) => skill.aiAgentId === aiAgentId)?.style;
}

/** The question an awaiting `collect` asked: its slots still open. */
function pendingQuestion(active: ActiveProcedure, slots: AiStateObject): PendingQuestion | null {
  if (active.stepStatus !== 'awaiting_answer') return null;
  const { procedure } = active.snapshot;
  const step = procedure.steps.find((candidate) => candidate.id === active.stepId);
  if (step?.type !== 'collect') return null;
  return {
    defs: procedure.slots as PendingQuestion['defs'],
    slots,
    asked: step.slots.filter((name) => !slotSettled(slots, name)),
    key: active.skillId,
  };
}

/** The message: one line per part, a collect's questions on one line (AI-04 §7). */
function joinSegments(segments: readonly Segment[]): string | null {
  const lines: string[] = [];
  let previous: Segment | null = null;
  for (const segment of segments) {
    if (segment.kind === 'written') continue;
    if (
      segment.kind === 'question' &&
      previous?.kind === 'question' &&
      previous.at === segment.at &&
      lines.length > 0
    ) {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${segment.text}`;
    } else {
      lines.push(segment.text);
    }
    previous = segment;
  }
  const text = lines.join('\n').trim();
  return text ? text : null;
}

/** A procedure's hand-over as the turn's side effect: by team id, by topic, or to routing. */
function handoffEffect(end: Extract<ProcedureEnd, { kind: 'handoff' }>): TurnSideEffect {
  const { target } = end;
  return {
    kind: 'handoff',
    team: null,
    ...(target && 'group_id' in target ? { groupId: target.group_id } : {}),
    ...(target && 'topic' in target ? { topic: target.topic } : {}),
    reason: end.reason,
  };
}

/** How the connection stands after a procedure turn, for its summary (AI-02). */
function endedAs(end: ProcedureEnd, reply: string | null): AiConversationOutcome | null {
  switch (end.kind) {
    case 'handoff':
      return 'handed_off';
    case 'resolved':
      return end.outcome;
    case 'finished':
      return reply ? 'resolved' : null;
    default:
      return null;
  }
}

/** When the procedure's previous turn was taken (`counters.last_turn_at`). */
function lastTurnAt(state: TurnState): Date | null {
  const raw = state.counters['last_turn_at'];
  if (typeof raw !== 'string') return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}
