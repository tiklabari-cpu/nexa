/**
 * Skill execution (PRD flow 3).
 *
 * Runs an active skill's steps against an incoming customer message. The
 * outcome is one of three things, and the distinction matters to billing:
 *
 *   answered  — the AI replied and the conversation stands on its own. If the
 *               thread later closes with no agent-authored event this counts as
 *               an AI resolution (ADR-09), which is what the invoice meters.
 *   handed_off— the AI decided a human is needed and transferred, or the model
 *               could not answer (below).
 *   skipped   — no skill matched. Routing proceeds exactly as before.
 *
 * The engine never decides *not* to involve a human on its own. `send_message`
 * answers; only an explicit `transfer_to_team` step, or the absence of any
 * answer, changes who owns the conversation.
 *
 * A knowledge answer is written by the configured `LlmProvider` (tm 255.5) —
 * the in-process stub unless a deployment names a model. The engine runs its
 * database work through a `TenantRunner` rather than inside one transaction the
 * caller opened, so that the model call happens *between* transactions: a
 * remote model may take up to `LLM_TIMEOUT_MS`, and holding a pooled connection
 * and an open transaction for that long would collide with
 * `TENANT_TRANSACTION_TIMEOUT_MS` (10 s) before the model did.
 *
 * **A model that cannot answer is a hand-off (tm 255.6).** Timeout, provider
 * error, open circuit or an empty reply — every `LlmProviderError` ends the same
 * way: the outcome is `handed_off`, the run is recorded as failed with the
 * failure's kind (never the provider's words — the run log is read in the admin
 * UI), and the AI says nothing more in this run: a `send_message` or
 * `request_info` after the failure is skipped, and a reply an earlier step
 * queued is withdrawn, because a half-finished automated exchange is worse
 * than a human starting clean. The steps that serve the human who takes over
 * still run — `tag`, `summarize` and a `transfer_to_team` the skill declares.
 * With no transfer step the conversation stays with whoever routing gave it to
 * when it opened (`ChatService.start`), which is already a human: nothing here
 * ever took it away from one.
 *
 * **So is a knowledge search that could not run (tm 255.7).** The question is
 * embedded by the configured `EmbeddingProvider` before any transaction opens;
 * when that fails, retrieval has nothing, the model is never asked — a model
 * asked without passages is the silent wrong answer this rules out — and the
 * run ends exactly as a model failure does, with `failure` naming the
 * embedding provider and its kind.
 *
 * **And so is a prompt over `LLM_MAX_PROMPT_CHARS` (tm 255.9).** It is refused
 * before the provider sees it — no request, no tokens — as `prompt_too_long`,
 * and ends the run like every other failure: a transient outage, a refused key
 * and a refused prompt all leave the customer with a human, and only the
 * operator's log tells them apart (`failure.transient`, the provider's status
 * and code).
 *
 * **What the run cost is written on the run (tm 255.9).** The model's input and
 * output tokens and the question's embedding tokens — from a success, and from
 * a failure that was billed anyway (`no_answer`) — go into the `skill_runs` row
 * in the same transaction that counts the run, so the AI Agent report reads
 * runs and their cost from one place and the two cannot drift.
 *
 * **Every model call is counted against the daily AI caps (tm 257.8).** The
 * engine calls through a `MeteredLlm` with the run's workspace. A call the cap
 * refuses was never made; the run ends as a model failure does — nothing more
 * is said, a human answers — but it is not a provider failure and is not filed
 * as one: `capped` names the cap, `failure` stays empty. A live run is still
 * recorded (its question was embedded, and that cost is on the run); a preview
 * rethrows the refusal, which its route answers with a 429. The question's
 * embedding is counted the same way on the embedding meter (tm 257.20), and a
 * refusal there ends the run the same way, having cost nothing.
 */
import {
  matchIntent,
  stepProblemDetails,
  validateSteps,
  type SendMessageStep,
  type SkillStep,
  type StepProblemDetails,
} from '@siyahtus/ai-mock';
import {
  ANSWER_BUDGETS,
  DEFAULT_ANSWER_PASSAGES,
  personaLanguageVerdict,
  readPersona,
  type Persona,
  type PersonaLanguage,
} from '@siyahtus/types';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import {
  ANSWER_RETRIEVAL_LIMIT,
  type EmbeddedQuery,
  type KnowledgeService,
} from './knowledge-service.js';
import { AiDailyCapError } from './ai-daily-budget.js';
import { MeteredLlm } from './metered-llm.js';
import { buildAnswerPrompt } from './provider/answer-prompt.js';
import { EmbeddingProviderError, type EmbeddingFailureKind } from './provider/embedding-error.js';
import { LlmProviderError, type LlmFailureKind } from './provider/llm-error.js';
import {
  refuseOverlongPrompt,
  type LlmCompletion,
  type LlmProvider,
} from './provider/llm-provider.js';

/**
 * Runs `fn` in a tenant-scoped transaction — `request.withTenant`, in the
 * shape the engine needs so each database step gets its own short transaction.
 */
export type TenantRunner = <T>(fn: (tx: TenantClient) => Promise<T>) => Promise<T>;

export interface SkillEngineOptions {
  /**
   * Writes the answer a knowledge `send_message` step composes. The server
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
 * What a run's inference cost, in tokens, as the providers reported it
 * (tm 255.9). Written on the run's `skill_runs` row. A stub reports 0.
 */
export interface SkillRunUsage {
  llmInputTokens: number;
  llmOutputTokens: number;
  embeddingTokens: number;
}

const NOTHING_SPENT: SkillRunUsage = Object.freeze({
  llmInputTokens: 0,
  llmOutputTokens: 0,
  embeddingTokens: 0,
});

export interface SkillRunLogEntry {
  step: string;
  detail: string;
  /** False when the step could not do its job — surfaced in the run log UI. */
  ok: boolean;
}

export interface SkillRunResult {
  outcome: SkillOutcome;
  skillId: string | null;
  skillName: string | null;
  /** Text the AI wants to send, if any. The caller writes it as an event. */
  reply: string | null;
  /** Tags to apply to the thread. */
  tags: string[];
  /** Team to transfer to, when the skill handed off. */
  transferTo: string | null;
  summary: string | null;
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
  /** Tokens the run's provider calls cost — recorded on the run. */
  usage: SkillRunUsage;
  log: SkillRunLogEntry[];
}

const NOTHING_RAN: SkillRunResult = {
  outcome: 'skipped',
  skillId: null,
  skillName: null,
  reply: null,
  tags: [],
  transferTo: null,
  summary: null,
  failure: null,
  capped: null,
  usage: NOTHING_SPENT,
  log: [],
};

export class SkillEngine {
  readonly #knowledge: KnowledgeService;
  readonly #llm: MeteredLlm;
  readonly #limits: { maxOutputTokens: number; timeoutMs: number };
  readonly #maxPromptChars: number;

  constructor(options: SkillEngineOptions) {
    this.#knowledge = options.knowledge;
    this.#llm = MeteredLlm.wrap(options.llm);
    this.#limits = { maxOutputTokens: options.maxOutputTokens, timeoutMs: options.timeoutMs };
    this.#maxPromptChars = options.maxPromptChars;
  }

  /**
   * Pick and run the first matching skill.
   *
   * Only one skill runs per message. Running several would let two of them
   * reply to the same question, and an admin debugging why a customer got two
   * different answers has no way to see which fired first.
   */
  async run(
    db: TenantRunner,
    tenant: TenantContext,
    input: { message: string; chatId: string; history?: string[] },
  ): Promise<SkillRunResult> {
    const skills = await db((tx) =>
      tx.skill.findMany({
        where: { active: true, kind: 'ai_agent', aiAgent: { active: true } },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          steps: true,
          aiAgentId: true,
          // The persona travels with the skill because it belongs to the agent
          // that owns it: two agents in one workspace answer in two voices, so
          // "which persona applies" is only decidable once a skill has been
          // picked (FR-MOD-06.4).
          aiAgent: { select: { tone: true, languages: true, persona: true } },
        },
      }),
    );

    for (const skill of skills) {
      const parsed = validateSteps(skill.steps);
      if (!parsed.ok) {
        // A malformed skill is skipped rather than crashing the message path —
        // a customer must never lose a message because an admin saved a broken
        // step list.
        continue;
      }

      const gate = this.#intentGate(parsed.steps, input.message);
      if (!gate.matched) continue;

      const persona = readPersona(skill.aiAgent);
      const language = personaLanguageVerdict(input.message, persona);
      const identity = { id: skill.id, name: skill.name, aiAgentId: skill.aiAgentId };

      // The persona names the languages this assistant speaks. A message
      // confidently in another one is the case the setting exists for, and the
      // honest answer is not a reply in the wrong language — there is no
      // translation here, only knowledge in whatever language the admin loaded.
      // Declining leaves the outcome `skipped`, so routing proceeds exactly as
      // it would with no AI and a human picks the conversation up.
      const result = language.unsupported
        ? declined(identity, gate.log, language.detected)
        : await this.#execute(db, tenant, {
            skill: identity,
            steps: parsed.steps,
            message: input.message,
            history: input.history ?? [],
            gateLog: gate.log,
            persona,
            answerIn: language.answerIn,
          });

      await this.#record(db, tenant, skill.id, input.chatId, result);
      return result;
    }

    return NOTHING_RAN;
  }

  /**
   * Dry run for the editor's Preview (FR-MOD-06.2.5).
   *
   * Same code path, no writes: an admin needs to see what the skill would
   * actually do, and a preview that runs different logic is worse than none.
   */
  async preview(
    db: TenantRunner,
    tenant: TenantContext,
    input: { steps: unknown; message: string; aiAgentId?: string | null },
  ): Promise<SkillRunResult & { errors: string[]; error_details: StepProblemDetails[] }> {
    const parsed = validateSteps(input.steps);
    if (!parsed.ok) {
      return {
        ...NOTHING_RAN,
        errors: [parsed.index >= 0 ? `Step ${parsed.index + 1}: ${parsed.reason}` : parsed.reason],
        // The same refusal as a code, for a console that words it in its own language.
        error_details: [stepProblemDetails(parsed)],
      };
    }

    const gate = this.#intentGate(parsed.steps, input.message);
    if (!gate.matched) {
      return {
        ...NOTHING_RAN,
        log: gate.log,
        errors: [],
        error_details: [],
      };
    }

    // The preview loads the same persona the live path would, for the same
    // reason the preview shares this method at all: a preview that shows an
    // unshaped answer promises something the product does not do.
    const aiAgentId = input.aiAgentId;
    const agent = aiAgentId
      ? await db((tx) =>
          tx.aiAgent.findFirst({
            where: { id: aiAgentId },
            select: { tone: true, languages: true, persona: true },
          }),
        )
      : null;
    const persona = readPersona(agent);
    const language = personaLanguageVerdict(input.message, persona);
    const identity = { id: 'preview', name: 'Preview', aiAgentId: input.aiAgentId ?? null };

    if (language.unsupported) {
      return { ...declined(identity, gate.log, language.detected), errors: [], error_details: [] };
    }

    const result = await this.#execute(db, tenant, {
      skill: identity,
      steps: parsed.steps,
      message: input.message,
      history: [],
      gateLog: gate.log,
      persona,
      answerIn: language.answerIn,
    });
    // A preview the cap stopped is not a result to show: what the skill would
    // say is unknown, and the author is told why instead (429, tm 257.8).
    if (result.capped) throw result.capped;

    return { ...result, errors: [], error_details: [] };
  }

  /** `detect_intent` steps gate the whole skill; all of them must match. */
  #intentGate(steps: SkillStep[], message: string): { matched: boolean; log: SkillRunLogEntry[] } {
    const gates = steps.filter((step) => step.type === 'detect_intent');
    // No gate means the skill applies to everything — which is a legitimate
    // choice for a single catch-all skill.
    if (gates.length === 0) return { matched: true, log: [] };

    const log: SkillRunLogEntry[] = [];
    let matched = true;

    for (const gate of gates) {
      const result = matchIntent(message, gate.intent, gate.phrases ?? []);
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

  async #execute(
    db: TenantRunner,
    tenant: TenantContext,
    input: {
      skill: { id: string; name: string; aiAgentId: string | null };
      steps: SkillStep[];
      message: string;
      history: string[];
      gateLog: SkillRunLogEntry[];
      persona: Persona;
      answerIn: PersonaLanguage | null;
    },
  ): Promise<SkillRunResult> {
    const log = [...input.gateLog];
    const tags: string[] = [];
    let reply: string | null = null;
    let transferTo: string | null = null;
    let summary: string | null = null;
    let failure: SkillFailure | null = null;
    let capped: AiDailyCapError | null = null;
    let usage = NOTHING_SPENT;

    for (const step of input.steps) {
      // A transfer ends the skill: everything after it would be acting on a
      // conversation the AI no longer owns.
      if (transferTo) {
        log.push({ step: step.type, detail: 'skipped — already handed off', ok: true });
        continue;
      }

      // A failed model call ends the AI's side of the exchange, not the skill:
      // what it would still *say* is skipped, what a human needs still runs.
      // A call the daily cap refused ends it the same way (tm 257.8).
      if ((failure || capped) && (step.type === 'send_message' || step.type === 'request_info')) {
        log.push({
          step: step.type,
          detail: capped
            ? "skipped — today's AI cap is reached, a human replies"
            : 'skipped — the model could not answer, a human replies',
          ok: true,
        });
        continue;
      }

      switch (step.type) {
        case 'detect_intent':
          break; // Already evaluated as the gate.

        case 'tag':
          tags.push(step.tag);
          log.push({ step: 'tag', detail: `tagged "${step.tag}"`, ok: true });
          break;

        case 'request_info': {
          // Only ask if the answer is not already in the message. Asking a
          // customer for an order number they just gave is the single most
          // irritating thing an automated agent does.
          const supplied = looksSupplied(input.message, step.field);
          if (supplied) {
            log.push({
              step: 'request_info',
              detail: `${step.field} already provided`,
              ok: true,
            });
          } else {
            reply = step.prompt;
            log.push({ step: 'request_info', detail: `asked for ${step.field}`, ok: true });
          }
          break;
        }

        case 'summarize':
          summary = buildSummary(input.message, input.history);
          log.push({ step: 'summarize', detail: 'summary written', ok: true });
          break;

        case 'send_message': {
          const outcome = await this.#sendMessage(db, tenant, step, {
            message: input.message,
            skill: input.skill,
            persona: input.persona,
            answerIn: input.answerIn,
          });
          usage = addUsage(usage, outcome.spent);
          if (outcome.failure || outcome.capped) {
            failure = outcome.failure ?? null;
            capped = outcome.capped ?? null;
            // Withdrawn, not just left unset: a question a `request_info` queued
            // earlier would reach the customer as the AI's last word before a
            // silence (see the file header).
            reply = null;
          } else if (outcome.text) {
            reply = outcome.text;
          }
          log.push({ step: 'send_message', detail: outcome.detail, ok: outcome.text !== null });
          break;
        }

        case 'transfer_to_team':
          transferTo = step.group;
          log.push({
            step: 'transfer_to_team',
            detail: `handing over to ${step.group}`,
            ok: true,
          });
          break;
      }
    }

    return {
      outcome: transferTo || failure || capped ? 'handed_off' : reply ? 'answered' : 'skipped',
      skillId: input.skill.id,
      skillName: input.skill.name,
      reply,
      tags,
      transferTo,
      summary,
      failure,
      capped,
      usage,
      log,
    };
  }

  async #sendMessage(
    db: TenantRunner,
    tenant: TenantContext,
    step: SendMessageStep,
    input: {
      message: string;
      skill: { aiAgentId: string | null };
      persona: Persona;
      answerIn: PersonaLanguage | null;
    },
  ): Promise<{
    text: string | null;
    detail: string;
    failure?: SkillFailure;
    /** The daily AI cap refused the model call (tm 257.8); nothing was asked. */
    capped?: AiDailyCapError;
    /** Tokens this step's provider calls cost, billed whether or not it answered. */
    spent?: Partial<SkillRunUsage>;
  }> {
    if (step.source === 'text') {
      // Deliberately unshaped (FR-MOD-06.4 · `#### K06.4`). A fixed reply is
      // wording an admin typed by hand and asked to be sent; trimming it to an
      // answer-length budget or prefixing it with a tone would rewrite their
      // words behind their back. The persona shapes what the assistant
      // *composes* — the passages retrieval found — never what a human wrote.
      return { text: step.text ?? null, detail: 'sent the fixed reply' };
    }

    // Outside any transaction, like the model call below (see the file header).
    let question: EmbeddedQuery;
    try {
      question = await this.#knowledge.embedQuery(input.message, tenant);
    } catch (error) {
      if (error instanceof AiDailyCapError) {
        // The question's embedding did not fit today's cap (tm 257.20): nothing
        // was asked of any provider, so the run cost nothing, and with nothing
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

    const passages = this.#passageBudget(input.persona);
    const { chunks: hits, chunksInScope } = await db((tx) =>
      this.#knowledge.search(tx, tenant, question, {
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
    const prompt = buildAnswerPrompt({
      message: input.message,
      passages: hits.map((hit) => hit.text),
      persona: input.persona,
      answerIn: input.answerIn,
    });
    let completion: LlmCompletion;
    try {
      // Measured where the prompt is whole, so the refusal comes before the
      // provider — any provider — is reached (tm 255.9).
      refuseOverlongPrompt(prompt, this.#maxPromptChars);
      completion = await this.#llm.complete(tenant, { ...prompt, ...this.#limits });
    } catch (error) {
      if (error instanceof AiDailyCapError) {
        // Refused before any provider was reached (tm 257.8): the question's
        // embedding is the run's only cost, and the refusal was logged once
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

  /** How many retrieved passages this persona's answer length pays for. */
  #passageBudget(persona: Persona): number {
    return persona.answerLength
      ? ANSWER_BUDGETS[persona.answerLength].passages
      : DEFAULT_ANSWER_PASSAGES;
  }

  async #record(
    db: TenantRunner,
    tenant: TenantContext,
    skillId: string,
    chatId: string,
    result: SkillRunResult,
  ): Promise<void> {
    await db((tx) => this.#writeRun(tx, tenant, skillId, chatId, result));
  }

  async #writeRun(
    tx: TenantClient,
    tenant: TenantContext,
    skillId: string,
    chatId: string,
    result: SkillRunResult,
  ): Promise<void> {
    // `status` answers "did the run complete?" — the schema constrains it to
    // succeeded/failed/aborted. The conversation outcome is a different
    // question ("what did it do to the chat?") and lives in the log beside the
    // steps, rather than being forced into a column that does not mean it.
    // A knowledge miss is a successful run that chose not to answer.
    await tx.skillRun.create({
      data: {
        skillId,
        chatId,
        licenseId: tenant.licenseId,
        status: result.log.some((entry) => !entry.ok && entry.step !== 'detect_intent')
          ? 'failed'
          : 'succeeded',
        log: { outcome: result.outcome, entries: result.log } as unknown as object,
        // What the run cost, on the row that counts the run (tm 255.9) — the AI
        // Agent report sums these beside `skill_runs`, never from a second tally.
        llmInputTokens: result.usage.llmInputTokens,
        llmOutputTokens: result.usage.llmOutputTokens,
        embeddingTokens: result.usage.embeddingTokens,
      },
    });
    // The count an admin sees in the Playbook list. Incremented in the same
    // transaction so it cannot drift from the run log beside it.
    await tx.skill.update({ where: { id: skillId }, data: { runsCount: { increment: 1 } } });
  }
}

/**
 * The run where the persona declined to answer, because the customer wrote in a
 * language it does not speak (FR-MOD-06.4).
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
): SkillRunResult {
  return {
    ...NOTHING_RAN,
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
  };
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

/** A one-line summary for the agent who picks the conversation up. */
function buildSummary(message: string, history: string[]): string {
  const lines = [...history, message].filter(Boolean);
  const first = lines[0] ?? message;
  const opening = first.length > 160 ? `${first.slice(0, 157)}…` : first;
  return lines.length > 1
    ? `Customer opened with: ${opening} (${lines.length} messages so far)`
    : `Customer asked: ${opening}`;
}
