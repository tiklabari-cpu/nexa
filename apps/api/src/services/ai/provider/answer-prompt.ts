/**
 * The prompt a grounded knowledge answer is written from (FR-05-06.EK1 ·
 * FR-MOD-06.4).
 *
 * One builder, used by the skill engine's `send_message` step, so the model and
 * the in-process stub read the same thing. That matters in one direction
 * especially: the stub (`MockLlmProvider`) writes its answer from this prompt
 * *alone*. If the engine stopped putting the persona or the passages in, the
 * stub's answer would change and the persona suites would go red — so the
 * deterministic tests check the prompt a real model will receive, not just the
 * stub's own output.
 *
 * The instructions are prose, for the model. The grounding — passages and the
 * persona's settings — is also a single JSON line at the very end, after a
 * marker line. JSON because a passage is admin-written text that may contain
 * anything, newlines and quote marks included, and `JSON.stringify` keeps it on
 * one line whatever it holds; last because that is the one position no passage
 * content can push anything past.
 *
 * **The conversation so far (tm 292.3 · AI-01).** The earlier exchange travels
 * as the messages before the customer's latest one, in the roles the context
 * loader gave them; what happened to the connection and what the conversation
 * has settled go into the instructions, before the grounding. The answer is
 * still drawn from the passages alone — the history says what the customer
 * means, not what is true.
 *
 * **Cited, as an object (tm 298 · AI-06).** With `cite`, the passages carry
 * the labels a reply cites them by (`ids` in the grounding, beside
 * `passages`), the reply is asked for as the `knowledge_answer` object
 * (`conversation/knowledge-answer.ts`), every figure must come from a passage,
 * and a rewrite's notes go before the grounding — which stays the last line.
 */
import {
  ANSWER_BUDGETS,
  ANSWER_LENGTHS,
  PERSONA_LANGUAGES,
  PERSONA_TONES,
  type AnswerLength,
  type Persona,
  type PersonaLanguage,
  type PersonaTone,
} from '@siyahtus/types';
import type { LlmCompletionRequest, LlmMessage } from './llm-provider.js';

export const GROUNDING_MARKER = '--- grounding (JSON, last line) ---';

/** What the answer may draw on and how it must sound. */
export interface AnswerGrounding {
  /** Retrieved passages, best match first. */
  passages: string[];
  /** The label each passage is cited by, in the same order — a cited answer's (tm 298). */
  ids?: string[];
  tone: PersonaTone | null;
  answerLength: AnswerLength | null;
  /** The language to answer in, when the persona settled one. */
  answerIn: PersonaLanguage | null;
}

export interface AnswerPromptInput {
  /** The customer's message being answered. */
  message: string;
  passages: readonly string[];
  persona: Persona;
  answerIn: PersonaLanguage | null;
  /** The conversation before `message` (`TurnHistory`); none on a first message. */
  history?: AnswerHistory;
  /**
   * What the model is told of the day's earlier connections (tm 294 · AI-02),
   * already cut to the visitor's identity and worded by `daily-memory.ts`.
   */
  earlierToday?: readonly string[];
  /**
   * Ask for the cited `knowledge_answer` object (tm 298): each passage's
   * label, and what a rewrite is told about the draft before it.
   */
  cite?: { ids: readonly string[]; notes?: readonly string[] };
  /**
   * The behaviour rules and the persona's style, as layers (tm 299.1 ·
   * `guidance.ts` `renderLayers`); prose for the model, never in the JSON line.
   */
  rules?: readonly string[];
  /**
   * Who asks: a player in a live chat (absent), or an agent asking Copilot
   * (IN-09, tm 366.1) — the same passages and the same cited object, the
   * question framed as a colleague's rather than a customer's.
   */
  reader?: 'agent';
}

/** The part of a turn's history the prompt carries. */
export interface AnswerHistory {
  messages: readonly LlmMessage[];
  systemNotes: readonly string[];
  stateDigest: string;
}

export function buildAnswerPrompt(
  input: AnswerPromptInput,
): Pick<LlmCompletionRequest, 'system' | 'messages'> {
  const grounding: AnswerGrounding = {
    passages: [...input.passages],
    ...(input.cite ? { ids: [...input.cite.ids] } : {}),
    tone: input.persona.tone,
    answerLength: input.persona.answerLength,
    answerIn: input.answerIn,
  };

  const budget = grounding.answerLength ? ANSWER_BUDGETS[grounding.answerLength] : null;
  const lines = [
    ...(input.reader === 'agent'
      ? [
          "You are Copilot, the assistant of this business's support agents. An agent is asking you a question; your answer goes to the agent, never to a customer.",
          "Answer the agent's question using only the passages in the grounding below. Do not add facts they do not contain.",
        ]
      : [
          "You are this business's customer-support assistant, replying in a live chat.",
          "Answer the customer's message using only the passages in the grounding below. Do not add facts they do not contain, and do not mention that you were given passages.",
        ]),
    ...(input.rules ?? []),
    budget
      ? `Length (${grounding.answerLength}): at most ${budget.sentences} sentence(s) and ${budget.maxChars} characters, drawing on at most ${budget.passages} passage(s).`
      : 'Length: answer from the first passage, briefly.',
    grounding.tone ? `Tone: ${grounding.tone}.` : 'Tone: plain; add no greeting.',
    grounding.answerIn
      ? `Reply in this language: ${grounding.answerIn}.`
      : input.reader === 'agent'
        ? 'Reply in the language the question is written in.'
        : 'Reply in the language the customer wrote in.',
    ...(input.cite
      ? [
          'Reply with one JSON object. reply: the answer, as plain text — no markdown, no links the passages do not contain. grounded: "full" when the passages answer the whole question, "partial" when they answer part of it, "none" when they do not answer it (reply is then empty). cited_ids: the ids of the passages the reply is drawn from.',
          'Every amount, limit, duration, percentage or multiplier in the reply must be one a passage gives. Never estimate one: when the passages do not give it, say less, or set grounded to "none".',
        ]
      : ['Write plain text: no markdown, no links the passages do not contain.']),
    ...(input.earlierToday ?? []),
    ...historyLines(input.history),
    ...(input.cite?.notes ?? []),
    GROUNDING_MARKER,
    JSON.stringify(grounding),
  ];

  return {
    system: lines.join('\n'),
    messages: conversation(input.history?.messages ?? [], input.message),
  };
}

/** The instructions the history adds; none when there is no history. */
function historyLines(history: AnswerHistory | undefined): string[] {
  if (!history) return [];
  const lines: string[] = [];
  if (history.messages.length > 0) {
    lines.push(
      "The earlier messages of this conversation come before the customer's latest one. Use them to understand what the customer means; an agent's message is marked [Agent].",
    );
  }
  if (history.systemNotes.length > 0) {
    lines.push(`Conversation events: ${history.systemNotes.join('; ')}.`);
  }
  if (history.stateDigest) lines.push(`Conversation state:\n${history.stateDigest}`);
  return lines;
}

/**
 * The earlier messages, then the customer's latest — merged into the last one
 * when that was the customer's too, so the roles alternate.
 */
function conversation(earlier: readonly LlmMessage[], message: string): LlmMessage[] {
  const messages = earlier.map((entry) => ({ ...entry }));
  const last = messages.at(-1);
  if (last?.role === 'user') last.content = `${last.content}\n${message}`;
  else messages.push({ role: 'user', content: message });
  return messages;
}

/**
 * The grounding `buildAnswerPrompt` wrote into `system`, or `null` when the
 * prompt was not built by it. Validates every field rather than casting: the
 * stub answering from a half-read prompt would be a silent regression.
 *
 * The line after the last marker line: a structured call's second try appends
 * its note below it (`completeStructured`).
 */
export function readAnswerGrounding(system: string): AnswerGrounding | null {
  const marker = system.lastIndexOf(`\n${GROUNDING_MARKER}\n`);
  if (marker < 0) return null;
  const start = marker + GROUNDING_MARKER.length + 2;
  const end = system.indexOf('\n', start);

  let parsed: unknown;
  try {
    parsed = JSON.parse(system.slice(start, end < 0 ? undefined : end));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;

  const passages = candidate['passages'];
  if (!Array.isArray(passages) || !passages.every((p) => typeof p === 'string')) return null;
  const tone = oneOf(candidate['tone'], PERSONA_TONES);
  const answerLength = oneOf(candidate['answerLength'], ANSWER_LENGTHS);
  const answerIn = oneOf(candidate['answerIn'], PERSONA_LANGUAGES);
  if (tone === undefined || answerLength === undefined || answerIn === undefined) return null;
  const ids = candidate['ids'];
  if (
    ids !== undefined &&
    (!Array.isArray(ids) ||
      ids.length !== passages.length ||
      !ids.every((id) => typeof id === 'string'))
  ) {
    return null;
  }

  return {
    passages: passages as string[],
    ...(ids ? { ids: ids as string[] } : {}),
    tone,
    answerLength,
    answerIn,
  };
}

/** `null` stays `null`; a listed value is kept; anything else is `undefined` (invalid). */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}
