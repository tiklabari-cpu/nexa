/**
 * Copilot's drawer question (IN-09, tm 366.1 · `POST /copilot/ask`).
 *
 * One question, asked from any screen of the console, answered one of two
 * ways — and the first thing done is to tell which:
 *
 *   - **A report question** (`bi`) is answered by the BI command
 *     (`CopilotService.answerBi`, ADR-09: the figure is read out of the
 *     Overview report, never computed here), and only for a caller holding
 *     `reports_read` (RL-02). Without it the answer is a refusal, and no
 *     report is read.
 *   - **A knowledge question** is searched in the one knowledge store, in
 *     every source Copilot may use (tm 309 · K11), and written up from the
 *     passages found as the cited `knowledge_answer` object the AI agent's
 *     answers are (tm 298 · AI-06) — the same gate on a draft: a citation of
 *     a passage it was not given, nothing cited, a figure no passage gives.
 *     When nothing answers it, Copilot says it does not know (`unknown`).
 *
 * **Telling them apart** (ADR LLM §6a.2: the model gives a candidate, the code
 * decides). The BI dictionary first (`resolveBiQuestion`): a question it
 * places is a report question and no model is asked. Otherwise the model is
 * asked, on the `fast` tier, for `{ kind: 'bi' | 'kb' }` — the
 * `copilot_question_kind` object. The stub answers from the question by the
 * word rule `looksLikeReportQuestion`, and so does this when the model does
 * not answer: a classification is not worth a 503 when a fixed rule can make
 * it (§6a.4.4, the item's own fallback).
 *
 * **What is kept.** Nothing of the words: the drawer holds the conversation
 * for the session (IN-09 question 2). The route writes one `copilot.ask` audit
 * entry with the `kind`, and the model calls are counted where every model
 * call is (`MeteredLlm`, surface `copilot`).
 */
import { looksLikeReportQuestion, resolveBiQuestion } from '@siyahtus/ai-mock';
import { NO_PERSONA } from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import type { BiAnswer } from './copilot-service.js';
import {
  KNOWLEDGE_ANSWER_RESPONSE_FORMAT,
  passageLabel,
  readKnowledgeAnswer,
  rewriteNote,
  type KnowledgeAnswerReply,
  type ReadKnowledgeAnswer,
} from './conversation/knowledge-answer.js';
import type { TenantRunner } from './conversation/turn.js';
import {
  ANSWER_RETRIEVAL_LIMIT,
  type KnowledgeService,
  type QueryEmbedding,
} from './knowledge-service.js';
import type { MeteredLlm } from './metered-llm.js';
import { buildAnswerPrompt } from './provider/answer-prompt.js';
import { EmbeddingProviderError } from './provider/embedding-error.js';
import { LlmProviderError } from './provider/llm-error.js';
import { completeStructured } from './provider/structured-output.js';
import {
  buildQuestionKindPrompt,
  QUESTION_KIND_FORMAT,
  QUESTION_KIND_MAX_OUTPUT_TOKENS,
  type QuestionKind,
} from './copilot-question-kind.js';

/** The contract's cap on a question (`POST /copilot/ask`). */
export const ASK_QUESTION_MAX_CHARS = 2_000;

export const COPILOT_ASK_KINDS = ['kb', 'bi', 'unknown'] as const;
export type CopilotAskKind = (typeof COPILOT_ASK_KINDS)[number];

export const COPILOT_ASK_REASONS = [
  'not_permitted',
  'not_understood',
  'no_data',
  'no_answer',
] as const;
export type CopilotAskReason = (typeof COPILOT_ASK_REASONS)[number];

export interface CopilotAskSource {
  id: string;
  title: string;
  reviewed_at: string;
}

export interface CopilotAskAnswer {
  answer: string;
  sources: CopilotAskSource[];
  kind: CopilotAskKind;
  reason?: CopilotAskReason;
}

/** How the question was told apart — for the log line, never the answer. */
export type QuestionKindBy = 'dictionary' | 'model' | 'rule';

// ---------------------------------------------------------------------------
// The fixed sentences
// ---------------------------------------------------------------------------

/** A report question without `reports_read` (RL-02). The drawer words it in the panel's language. */
export const NOT_PERMITTED_ANSWER =
  "You don't have permission to ask report questions — that needs access to Reports.";

/** Nothing in the knowledge store answers it (AI-06's principle: say so, never invent). */
export const NO_ANSWER_ANSWER =
  "I don't know — none of the knowledge sources Copilot uses answers this.";

// ---------------------------------------------------------------------------
// The question
// ---------------------------------------------------------------------------

export interface CopilotAskInput {
  question: string;
  /** May the caller read reports — `reports_read` among their scopes. */
  mayReadReports: boolean;
  /**
   * The conversation asked about (`context.chat_id`), already proved visible
   * to the caller, and its brand: the knowledge searched is that brand's and
   * every brand's. Absent: every brand's.
   */
  chat?: { id: string; brandId: string | null };
  now: Date;
}

export interface CopilotAskDeps {
  db: TenantRunner;
  tenant: TenantContext;
  knowledge: KnowledgeService;
  /** Copilot's own model instance (`routes/copilot.ts`), counted against the daily caps. */
  llm: MeteredLlm;
  /** The BI command's answer — `CopilotService.answerBi`. */
  answerBi: (tx: TenantClient, question: string, now: Date) => Promise<BiAnswer>;
  limits: { maxOutputTokens: number; timeoutMs: number };
}

export interface CopilotAskResult extends CopilotAskAnswer {
  /** For the log line: how the question was told apart. */
  classifiedBy: QuestionKindBy;
}

export async function askCopilot(
  deps: CopilotAskDeps,
  input: CopilotAskInput,
): Promise<CopilotAskResult> {
  const { kind, by } = await classifyQuestion(deps, input);
  if (kind === 'bi') return { ...(await answerReport(deps, input)), classifiedBy: by };
  return { ...(await answerFromKnowledge(deps, input)), classifiedBy: by };
}

/**
 * Report or knowledge — the dictionary, then the model, then the word rule.
 * A cap refusal (`AiDailyCapError`) is not a provider failure and propagates:
 * the caller is told today's allowance is used up, as every Copilot surface is.
 */
async function classifyQuestion(
  deps: CopilotAskDeps,
  input: CopilotAskInput,
): Promise<{ kind: QuestionKind; by: QuestionKindBy }> {
  if (resolveBiQuestion(input.question).metric !== null) return { kind: 'bi', by: 'dictionary' };
  try {
    const { value } = await completeStructured<{ kind: QuestionKind }>(
      deps.llm.forTenant(deps.tenant, { surface: 'copilot', chatId: input.chat?.id ?? null }),
      {
        ...buildQuestionKindPrompt(input.question),
        maxOutputTokens: QUESTION_KIND_MAX_OUTPUT_TOKENS,
        timeoutMs: deps.limits.timeoutMs,
        tier: 'fast',
        responseFormat: QUESTION_KIND_FORMAT,
      },
    );
    return { kind: value.kind, by: 'model' };
  } catch (error) {
    if (!(error instanceof LlmProviderError)) throw error;
    return { kind: looksLikeReportQuestion(input.question) ? 'bi' : 'kb', by: 'rule' };
  }
}

/** A report question: refused without `reports_read`, else the BI command's answer. */
async function answerReport(
  deps: CopilotAskDeps,
  input: CopilotAskInput,
): Promise<CopilotAskAnswer> {
  if (!input.mayReadReports) {
    return { answer: NOT_PERMITTED_ANSWER, sources: [], kind: 'bi', reason: 'not_permitted' };
  }
  const bi = await deps.db((tx) => deps.answerBi(tx, input.question, input.now));
  return {
    answer: bi.answer,
    sources: [],
    kind: 'bi',
    ...(bi.kind === 'not_understood' ? { reason: 'not_understood' as const } : {}),
    ...(bi.kind === 'no_data' ? { reason: 'no_data' as const } : {}),
  };
}

const NO_ANSWER: CopilotAskAnswer = {
  answer: NO_ANSWER_ANSWER,
  sources: [],
  kind: 'unknown',
  reason: 'no_answer',
};

/**
 * A knowledge question: searched, then written up from the passages, cited.
 * A draft that breaks the gate is written once more with the rule named; a
 * second that breaks one is withheld, and Copilot does not know. The embedding
 * and the model are called with no transaction open (tm 255.7).
 */
async function answerFromKnowledge(
  deps: CopilotAskDeps,
  input: CopilotAskInput,
): Promise<CopilotAskAnswer> {
  const attribution = { surface: 'copilot' as const, chatId: input.chat?.id ?? null };

  let query: QueryEmbedding;
  try {
    query = await deps.knowledge.embedQuery(input.question, deps.tenant, attribution);
  } catch (error) {
    if (!(error instanceof EmbeddingProviderError)) throw error;
    throw new ApiError(
      'service_unavailable',
      `The knowledge sources could not be searched: the embedding provider did not answer (${error.kind}). Try again in a moment.`,
      { details: { kind: error.kind } },
    );
  }

  const hits = await deps.db((tx) =>
    deps.knowledge.retrieve(tx, deps.tenant, query, {
      reader: {
        audience: 'copilot',
        ...(input.chat ? { brandId: input.chat.brandId } : {}),
      },
      limit: ANSWER_RETRIEVAL_LIMIT,
    }),
  );
  // Below the threshold the model is not asked at all (AI-06 §5).
  if (hits.length === 0) return NO_ANSWER;

  const labels = hits.map((_, index) => passageLabel(index));
  const passages = hits.map((hit) => hit.text);
  const draft = async (notes: readonly string[]): Promise<ReadKnowledgeAnswer> => {
    const { value } = await completeStructured<KnowledgeAnswerReply>(
      deps.llm.forTenant(deps.tenant, attribution),
      {
        ...buildAnswerPrompt({
          message: input.question,
          passages,
          persona: NO_PERSONA,
          answerIn: null,
          cite: { ids: labels, notes },
          reader: 'agent',
        }),
        ...deps.limits,
        tier: 'default',
        responseFormat: KNOWLEDGE_ANSWER_RESPONSE_FORMAT,
      },
    );
    return readKnowledgeAnswer(value, { labels, sources: passages });
  };

  let read: ReadKnowledgeAnswer;
  try {
    read = await draft([]);
    if (read.grounded !== 'none' && read.problems.length > 0) {
      read = await draft([rewriteNote(read.problems)]);
      if (read.problems.length > 0) return NO_ANSWER;
    }
  } catch (error) {
    if (!(error instanceof LlmProviderError)) throw error;
    throw new ApiError(
      'service_unavailable',
      `Copilot could not write the answer: the model did not answer (${error.kind}). Try again in a moment.`,
      { details: { kind: error.kind } },
    );
  }
  if (read.grounded === 'none' || read.reply === '') return NO_ANSWER;

  // The sources the reply cites, in the order cited, each once — with when a
  // person last confirmed it (AI-14-S3), so a stale one shows as stale.
  const citedSourceIds = [
    ...new Set(read.cited.map((label) => hits[labels.indexOf(label)]!.sourceId)),
  ];
  const rows = await deps.db((tx) =>
    tx.knowledgeSource.findMany({
      where: { id: { in: citedSourceIds } },
      select: { id: true, name: true, reviewedAt: true },
    }),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const sources = citedSourceIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [{ id: row.id, title: row.name, reviewed_at: row.reviewedAt.toISOString() }] : [];
  });

  return { answer: read.reply, sources, kind: 'kb' };
}
