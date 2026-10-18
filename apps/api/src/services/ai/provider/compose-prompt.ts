/**
 * The prompt a procedure turn's written part comes from (tm 296.3 · AI-03 §5).
 *
 * A procedure turn's message is assembled from what its steps produced, in
 * order: filled templates, the `collect` questions, knowledge answers. Those
 * are text already and go out as they are — a `verbatim` template above all,
 * which the model never sees as something to rewrite. What is not text yet is
 * a `say` step with no template it could send — its instruction ("explain the
 * third-party payment rule briefly") — and this prompt is the one model call
 * that writes all of them for the turn. The rest of the message travels in the
 * prompt as context, so the written part neither repeats it nor contradicts it,
 * and the code puts the written part in place of the first instruction.
 *
 * Like `answer-prompt.ts`, the instructions are prose for the model and, after
 * a marker line, one JSON line at the very end for the in-process stub
 * (`MockLlmProvider`): it writes the instructions back joined, which is what a
 * deterministic stand-in can honestly do with "write this".
 */
import {
  PERSONA_LANGUAGES,
  PERSONA_TONES,
  type Persona,
  type PersonaLanguage,
  type PersonaTone,
} from '@siyahtus/types';
import type { AnswerHistory } from './answer-prompt.js';
import type { LlmCompletionRequest, LlmMessage } from './llm-provider.js';

export const COMPOSE_MARKER = '--- compose (JSON, last line) ---';

/** What the written part must cover and how it must sound. */
export interface ComposeGrounding {
  /** The steps' instructions, in order. */
  instructions: string[];
  tone: PersonaTone | null;
  answerIn: PersonaLanguage | null;
}

export interface ComposePromptInput {
  /** The player's message the turn answers. */
  message: string;
  instructions: readonly string[];
  /** The rest of the message, as it will be sent. */
  alongside: readonly string[];
  /** Short notes the turn adds ("the player is back after a long break"). */
  notes?: readonly string[];
  persona: Persona;
  answerIn: PersonaLanguage | null;
  history?: AnswerHistory;
}

export function buildComposePrompt(
  input: ComposePromptInput,
): Pick<LlmCompletionRequest, 'system' | 'messages'> {
  const grounding: ComposeGrounding = {
    instructions: [...input.instructions],
    tone: input.persona.tone,
    answerIn: input.answerIn,
  };
  const lines = [
    "You are this business's customer-support assistant, replying in a live chat.",
    'Write the part of your next message that these instructions ask for, as one short passage:',
    ...input.instructions.map((instruction, n) => `${n + 1}. ${instruction}`),
    ...(input.alongside.length > 0
      ? [
          'The same message also says the following, word for word. Do not repeat or contradict it:',
          ...input.alongside.map((text) => `> ${text.replace(/\n/g, '\n> ')}`),
        ]
      : []),
    'Do not promise times, amounts or outcomes the instructions do not state. Ask no questions the instructions do not ask.',
    grounding.tone ? `Tone: ${grounding.tone}.` : 'Tone: plain; add no greeting.',
    grounding.answerIn
      ? `Reply in this language: ${grounding.answerIn}.`
      : 'Reply in the language the customer wrote in.',
    'Write plain text: no markdown, no links.',
    ...(input.notes ?? []),
    ...historyLines(input.history),
    COMPOSE_MARKER,
    JSON.stringify(grounding),
  ];
  return {
    system: lines.join('\n'),
    messages: conversation(input.history?.messages ?? [], input.message),
  };
}

function historyLines(history: AnswerHistory | undefined): string[] {
  if (!history) return [];
  const lines: string[] = [];
  if (history.messages.length > 0) {
    lines.push(
      "The earlier messages of this conversation come before the customer's latest one; an agent's message is marked [Agent].",
    );
  }
  if (history.systemNotes.length > 0) {
    lines.push(`Conversation events: ${history.systemNotes.join('; ')}.`);
  }
  if (history.stateDigest) lines.push(`Conversation state:\n${history.stateDigest}`);
  return lines;
}

function conversation(earlier: readonly LlmMessage[], message: string): LlmMessage[] {
  const messages = earlier.map((entry) => ({ ...entry }));
  const last = messages.at(-1);
  if (last?.role === 'user') last.content = `${last.content}\n${message}`;
  else messages.push({ role: 'user', content: message });
  return messages;
}

/** The grounding `buildComposePrompt` wrote into `system`, or `null` for any other prompt. */
export function readComposeGrounding(system: string): ComposeGrounding | null {
  const lastBreak = system.lastIndexOf('\n');
  if (lastBreak < 0) return null;
  const before = system.slice(0, lastBreak);
  if (before.slice(before.lastIndexOf('\n') + 1) !== COMPOSE_MARKER) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(system.slice(lastBreak + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  const instructions = candidate['instructions'];
  if (
    !Array.isArray(instructions) ||
    instructions.length === 0 ||
    !instructions.every((instruction) => typeof instruction === 'string')
  ) {
    return null;
  }
  const tone = oneOf(candidate['tone'], PERSONA_TONES);
  const answerIn = oneOf(candidate['answerIn'], PERSONA_LANGUAGES);
  if (tone === undefined || answerIn === undefined) return null;
  return { instructions: instructions as string[], tone, answerIn };
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}
