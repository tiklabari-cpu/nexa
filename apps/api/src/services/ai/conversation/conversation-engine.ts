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
  personaLanguageVerdict,
  type AiUsageSurface,
  type Persona,
  type PersonaLanguage,
} from '@siyahtus/types';
import type { TenantContext } from '../../../lib/tenant.js';
import {
  ANSWER_RETRIEVAL_LIMIT,
  type EmbeddedQuery,
  type KnowledgeService,
} from '../knowledge-service.js';
import { AiDailyCapError, type AiAttribution } from '../ai-daily-budget.js';
import { MeteredLlm } from '../metered-llm.js';
import { buildAnswerPrompt } from '../provider/answer-prompt.js';
import { EmbeddingProviderError } from '../provider/embedding-error.js';
import { LlmProviderError } from '../provider/llm-error.js';
import {
  promptLength,
  refuseOverlongPrompt,
  type LlmCompletion,
  type LlmPrompt,
  type LlmProvider,
} from '../provider/llm-provider.js';
import { GAP_MARKER, shortenHistory } from './context-loader.js';
import {
  adaptLegacySkill,
  stepLogName,
  type IntentGate,
  type ProcedureStep,
  type SingleTurnProcedure,
} from './legacy-skill.js';
import { readAndCompile } from './turn-config.js';
import {
  emptyTurnState,
  turnsTaken,
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

/** A step's knowledge answer, or why there is none. */
interface KnowledgeAnswer {
  text: string | null;
  detail: string;
  failure?: SkillFailure;
  /** The daily AI cap refused a call (tm 257.8); nothing was asked. */
  capped?: AiDailyCapError;
  /** Tokens this step's provider calls cost, billed whether or not it answered. */
  spent?: Partial<SkillRunUsage>;
}

export class ConversationEngine {
  readonly #knowledge: KnowledgeService;
  readonly #llm: MeteredLlm;
  readonly #limits: { maxOutputTokens: number; timeoutMs: number };
  readonly #maxPromptChars: number;

  constructor(options: ConversationEngineOptions) {
    this.#knowledge = options.knowledge;
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
   * different answers has no way to see which fired first. A message no skill
   * matches is not a turn: the state comes back as it went in.
   */
  async runTurn(state: TurnState, message: TurnMessage, ctx: TurnContext): Promise<TurnResult> {
    for (const skill of ctx.config.skills) {
      const parsed = validateSteps(skill.steps);
      if (!parsed.ok) {
        // A malformed skill is skipped rather than crashing the message path —
        // a customer must never lose a message because an admin saved a broken
        // step list.
        continue;
      }
      const procedure = adaptLegacySkill(parsed.steps);

      const gate = intentGate(procedure.whenToUse, message.text);
      if (!gate.matched) continue;

      const language = personaLanguageVerdict(message.text, skill.persona);
      const identity = { id: skill.id, name: skill.name, aiAgentId: skill.aiAgentId };

      // The persona names the languages this assistant speaks. A message
      // confidently in another one is the case the setting exists for, and the
      // honest answer is not a reply in the wrong language — there is no
      // translation here, only knowledge in whatever language the admin loaded.
      // Declining leaves the outcome `skipped`, so routing proceeds exactly as
      // it would with no AI and a human picks the conversation up.
      const executed = language.unsupported
        ? declined(identity, gate.log, language.detected)
        : await this.#execute(procedure, {
            skill: identity,
            message,
            gateLog: gate.log,
            persona: skill.persona,
            answerIn: language.answerIn,
            ctx,
          });

      return { ...executed, nextState: afterTurn(state) };
    }

    return { reply: null, decisions: NOTHING_DECIDED, nextState: state, sideEffects: [] };
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
    input: { steps: unknown; message: string; aiAgentId?: string | null },
  ): Promise<PreviewResult> {
    const nothing = (log: SkillRunLogEntry[] = []): TurnResult => ({
      reply: null,
      decisions: { ...NOTHING_DECIDED, log },
      nextState: emptyTurnState(),
      sideEffects: [],
    });

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
    const result = await this.runTurn(
      emptyTurnState(),
      { text: input.message },
      {
        tenant,
        db,
        now: new Date(),
        mode: 'preview',
        // A preview answers no conversation; its spend is the AI agent's.
        chatId: null,
        configVersionId: draft.versionId,
        config: draft.pkg,
        toolStubs: {},
      },
    );
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
          // Only ask if the answer is not already in the message. Asking a
          // customer for an order number they just gave is the single most
          // irritating thing an automated agent does.
          if (looksSupplied(input.message.text, step.slot)) {
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
            text: buildSummary(input.message.text, input.message.history),
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
            message: input.message.text,
            history: input.message.history,
            skill: input.skill,
            persona: input.persona,
            answerIn: input.answerIn,
            ctx: input.ctx,
          });
          usage = addUsage(usage, answer.spent);
          if (answer.failure || answer.capped) {
            failure = answer.failure ?? null;
            capped = answer.capped ?? null;
            // Withdrawn, not just left unset: a question a `collect` queued
            // earlier would reach the customer as the AI's last word before a
            // silence (see the file header).
            reply = null;
            replyKind = null;
          } else if (answer.text) {
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
      },
      sideEffects,
    };
  }

  async #answerFromKnowledge(input: {
    message: string;
    history: TurnHistory | undefined;
    skill: { aiAgentId: string | null };
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
      question = await this.#knowledge.embedQuery(input.message, ctx.tenant, attribution);
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
      // answer. Returning no text leaves the outcome as `skipped`, so a human
      // picks the conversation up.
      return {
        text: null,
        spent: { embeddingTokens },
        detail:
          chunksInScope === 0
            ? // Said apart from a miss, because it is read by whoever has to fix
              // it: an empty knowledge base, or one still stored in another
              // embedding space than the one questions are asked in (PLAN §D182).
              `nothing searchable in the knowledge base — empty, or not yet re-embedded for ${question.space}`
            : `nothing in the knowledge base above ${this.#knowledge.threshold} similarity`,
      };
    }

    const best = hits[0]!;
    // Outside any transaction (see the file header). The persona travels in the
    // prompt: the provider — model or stub — is what applies it now, so the
    // run log records what was *asked for* rather than what a trimmer did.
    const prompt = fitHistory(
      (history) =>
        buildAnswerPrompt({
          message: input.message,
          passages: hits.map((hit) => hit.text),
          persona: input.persona,
          answerIn: input.answerIn,
          ...(history ? { history } : {}),
        }),
      input.history,
      this.#maxPromptChars,
    );
    let completion: LlmCompletion;
    try {
      // Measured where the prompt is whole, so the refusal comes before the
      // provider — any provider — is reached (tm 255.9).
      refuseOverlongPrompt(prompt, this.#maxPromptChars);
      completion = await this.#llm.complete(
        ctx.tenant,
        { ...prompt, ...this.#limits },
        attribution,
      );
    } catch (error) {
      if (error instanceof AiDailyCapError) {
        // Refused before any provider was reached (tm 257.8): the question's
        // embedding is the turn's only cost, and the refusal was logged once
        // where the cap decided it (`ai-daily-budget.ts`).
        return {
          text: null,
          capped: error,
          spent: { embeddingTokens },
          detail: `today's AI cap is reached (${error.scope}) — handed to a human`,
        };
      }
      // A defect is not a provider failure: it propagates to the responder's
      // catch and is logged with its stack rather than filed as a hand-off.
      if (!(error instanceof LlmProviderError)) throw error;
      // The kind is all the run log keeps; the facts beside it go to the
      // operator's log (`ai-responder.ts`). The provider's message never
      // travels (`llm-error.ts`).
      return {
        text: null,
        failure: { provider: 'llm', kind: error.kind, ...failureFacts(error) },
        // A `no_answer` was generated, so it was billed; the other kinds carry
        // no usage and cost 0 here.
        spent: {
          embeddingTokens,
          llmInputTokens: error.usage?.inputTokens ?? 0,
          llmOutputTokens: error.usage?.outputTokens ?? 0,
        },
        detail: `the model could not answer (${error.kind}) — handed to a human`,
      };
    }
    const cited = hits.slice(0, Math.min(passages, hits.length));
    const asked = personaRequest(input.persona, input.answerIn);

    return {
      text: completion.text,
      spent: {
        embeddingTokens,
        llmInputTokens: completion.usage.inputTokens,
        llmOutputTokens: completion.usage.outputTokens,
      },
      detail: [
        `answered from "${best.sourceName}" (${best.score})`,
        cited.length > 1 ? `+ ${cited.length - 1} more passage(s)` : '',
        `written by ${this.#llm.id}`,
        asked ? `persona: ${asked}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    };
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
 * The state after a turn the AI took: one more turn counted (AI-03 §6). A
 * one-turn procedure leaves nothing active behind it — no step waits for an
 * answer — so nothing else moves.
 */
function afterTurn(state: TurnState): TurnState {
  return { ...state, counters: { ...state.counters, turns: turnsTaken(state) + 1 } };
}

/**
 * The turn where the persona declined to answer, because the customer wrote in
 * a language it does not speak (FR-MOD-06.4).
 *
 * `ok: true` on the log entry, and so a *succeeded* run: nothing failed. The
 * skill was asked a question outside the persona's declared languages and did
 * the one correct thing with it — nothing — which is a decision, not a fault,
 * and an admin reading the run log needs it to read that way. The outcome is
 * `skipped`, which is the engine's existing word for "a human owns this now".
 */
function declined(
  skill: { id: string; name: string },
  gateLog: SkillRunLogEntry[],
  detected: string | null,
): Executed {
  return {
    reply: null,
    decisions: {
      ...NOTHING_DECIDED,
      skillId: skill.id,
      skillName: skill.name,
      log: [
        ...gateLog,
        {
          step: 'persona',
          detail: `left for a human — the message is in ${detected ?? 'another language'}, which this persona does not speak`,
          ok: true,
        },
      ],
    },
    sideEffects: [],
  };
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
function buildSummary(message: string, history: TurnHistory | undefined): string {
  const opened = history?.messages
    .find((entry) => entry.role === 'user')
    ?.content.split('\n')
    .find((line) => line.trim() && line !== GAP_MARKER);
  const count = (history?.visitorMessages ?? 0) + 1;
  const first = opened ?? message;
  const opening = first.length > 160 ? `${first.slice(0, 157)}…` : first;
  return count > 1
    ? `Customer opened with: ${opening} (${count} messages so far)`
    : `Customer asked: ${opening}`;
}
