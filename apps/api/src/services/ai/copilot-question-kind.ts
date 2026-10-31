/**
 * Copilot's question sorting (IN-09, tm 366.1 · ADR LLM §6a.1
 * `copilot_question_kind`): is a drawer question a report question (`bi`) or a
 * knowledge question (`kb`)?
 *
 * The prompt, its schema, and the stub's answer — apart from `copilot-ask.ts`
 * because the stub (`provider/mock-llm-provider.ts`) reads them, and the stub
 * is loaded by `llm-provider.ts`: this file imports no service, so the two
 * cannot form a cycle.
 *
 * The model's answer is a candidate (§6a.2): `copilot-ask.ts` asks it only for
 * a question the BI dictionary did not place, routes on it, and falls back to
 * the word rule when the model does not answer.
 */
import { looksLikeReportQuestion } from '@siyahtus/ai-mock';
import type { JsonSchema } from './provider/json-schema.js';
import type { LlmCompletionRequest, LlmResponseFormat } from './provider/llm-provider.js';

export const QUESTION_KIND_RESPONSE_NAME = 'copilot_question_kind';

export const QUESTION_KINDS = ['bi', 'kb'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const QUESTION_KIND_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind'],
  properties: { kind: { type: 'string', enum: QUESTION_KINDS } },
};

export const QUESTION_KIND_FORMAT: LlmResponseFormat = {
  name: QUESTION_KIND_RESPONSE_NAME,
  schema: QUESTION_KIND_SCHEMA,
};

/** A one-word object: the reply's ceiling is a few tokens, whatever the deployment's. */
export const QUESTION_KIND_MAX_OUTPUT_TOKENS = 20;

export const QUESTION_KIND_MARKER = '--- copilot question (JSON, last line) ---';

/** What the prompt carries for the stub to read back: the question. */
export interface QuestionKindGrounding {
  question: string;
}

/**
 * The classification prompt. The question travels twice: as the user message,
 * for the model, and as the JSON line after the marker — last, so nothing in
 * the question can push anything past it — for the stub (the `answer-prompt.ts`
 * convention).
 */
export function buildQuestionKindPrompt(
  question: string,
): Pick<LlmCompletionRequest, 'system' | 'messages'> {
  const grounding: QuestionKindGrounding = { question };
  return {
    system: [
      "You sort the questions a support agent asks this business's Copilot.",
      'kind "bi": the question asks for a figure about the business\'s own support activity — how many chats, tickets or complaints, response times, satisfaction, resolutions, over some period.',
      'kind "kb": anything else — a rule, a limit, a procedure, how a product works, what to tell a customer.',
      'Reply with one JSON object: {"kind": "bi"} or {"kind": "kb"}.',
      QUESTION_KIND_MARKER,
      JSON.stringify(grounding),
    ].join('\n'),
    messages: [{ role: 'user', content: question }],
  };
}

/**
 * The grounding {@link buildQuestionKindPrompt} wrote, or null when it did not
 * write this prompt. The line after the last marker: a structured call's second
 * try appends its note below it (`completeStructured`).
 */
export function readQuestionKindGrounding(system: string): QuestionKindGrounding | null {
  const marker = system.lastIndexOf(`\n${QUESTION_KIND_MARKER}\n`);
  if (marker < 0) return null;
  const start = marker + QUESTION_KIND_MARKER.length + 2;
  const end = system.indexOf('\n', start);
  try {
    const parsed = JSON.parse(system.slice(start, end < 0 ? undefined : end)) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const question = (parsed as Record<string, unknown>)['question'];
    return typeof question === 'string' ? { question } : null;
  } catch {
    return null;
  }
}

/** The stub's sorting (ADR LLM §6a.6): the word rule, deterministic. */
export function mockQuestionKind(grounding: QuestionKindGrounding): { kind: QuestionKind } {
  return { kind: looksLikeReportQuestion(grounding.question) ? 'bi' : 'kb' };
}
