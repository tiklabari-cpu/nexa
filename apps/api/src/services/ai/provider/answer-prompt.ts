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
import type { LlmCompletionRequest } from './llm-provider.js';

export const GROUNDING_MARKER = '--- grounding (JSON, last line) ---';

/** What the answer may draw on and how it must sound. */
export interface AnswerGrounding {
  /** Retrieved passages, best match first. */
  passages: string[];
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
}

export function buildAnswerPrompt(
  input: AnswerPromptInput,
): Pick<LlmCompletionRequest, 'system' | 'messages'> {
  const grounding: AnswerGrounding = {
    passages: [...input.passages],
    tone: input.persona.tone,
    answerLength: input.persona.answerLength,
    answerIn: input.answerIn,
  };

  const budget = grounding.answerLength ? ANSWER_BUDGETS[grounding.answerLength] : null;
  const lines = [
    "You are this business's customer-support assistant, replying in a live chat.",
    "Answer the customer's message using only the passages in the grounding below. Do not add facts they do not contain, and do not mention that you were given passages.",
    budget
      ? `Length (${grounding.answerLength}): at most ${budget.sentences} sentence(s) and ${budget.maxChars} characters, drawing on at most ${budget.passages} passage(s).`
      : 'Length: answer from the first passage, briefly.',
    grounding.tone ? `Tone: ${grounding.tone}.` : 'Tone: plain; add no greeting.',
    grounding.answerIn
      ? `Reply in this language: ${grounding.answerIn}.`
      : 'Reply in the language the customer wrote in.',
    'Write plain text: no markdown, no links the passages do not contain.',
    GROUNDING_MARKER,
    JSON.stringify(grounding),
  ];

  return {
    system: lines.join('\n'),
    messages: [{ role: 'user', content: input.message }],
  };
}

/**
 * The grounding `buildAnswerPrompt` wrote into `system`, or `null` when the
 * prompt was not built by it. Validates every field rather than casting: the
 * stub answering from a half-read prompt would be a silent regression.
 */
export function readAnswerGrounding(system: string): AnswerGrounding | null {
  const lastBreak = system.lastIndexOf('\n');
  if (lastBreak < 0) return null;
  const before = system.slice(0, lastBreak);
  if (before.slice(before.lastIndexOf('\n') + 1) !== GROUNDING_MARKER) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(system.slice(lastBreak + 1));
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

  return { passages: passages as string[], tone, answerLength, answerIn };
}

/** `null` stays `null`; a listed value is kept; anything else is `undefined` (invalid). */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}
