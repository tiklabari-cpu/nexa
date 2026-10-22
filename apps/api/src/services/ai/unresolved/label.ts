/**
 * A cluster's title (tm 317.2 · SiyahTuş analysis AI-22 §5): when it opens,
 * and again each time it has grown by half (`unresolvedLabelDue`), the `fast`
 * model reads up to `UNRESOLVED_LABEL_SAMPLES` of its newest items — masked
 * already, twice (AI-26) — and writes a Turkish title of at most eight words
 * and the action it suggests (`UNRESOLVED_SUGGESTED_ACTIONS`).
 *
 * **The lexical labeller is the floor.** With no model (`LLM_PROVIDER=mock`),
 * a workspace whose content may not leave its region (NFR-C4), a spent
 * allowance or a reply that is not a title, the cluster is named by its
 * distinguishing words against the agent's other questions — `topics.ts`'
 * method (`labelTopic`), never a digit — and suggests nothing. A title is a
 * guess either way: the report always shows the items under it.
 *
 * Like the other structured calls the samples are one JSON line after a
 * marker at the end of the instructions.
 */
import { labelTopic } from '@siyahtus/ai-mock';
import {
  UNRESOLVED_LABEL_WORDS_MAX,
  UNRESOLVED_SUGGESTED_ACTIONS,
  isUnresolvedSuggestedAction,
  unresolvedLabelOf,
  type UnresolvedLabelSource,
  type UnresolvedSuggestedAction,
} from '@siyahtus/types';
import { maskForWrite } from '../../../lib/sensitive-mask.js';
import type { JsonSchema } from '../provider/json-schema.js';
import type { LlmCompletionRequest, LlmResponseFormat } from '../provider/llm-provider.js';

/** `response_format.json_schema.name`. */
export const UNRESOLVED_LABEL_RESPONSE_NAME = 'unresolved_cluster_label';

export const UNRESOLVED_LABEL_MARKER = '--- unresolved questions (JSON, last line) ---';

/** A title and one word: its ceiling, in tokens. */
export const UNRESOLVED_LABEL_MAX_OUTPUT_TOKENS = 120;

/** Each sample the model reads is cut to this. */
export const UNRESOLVED_LABEL_SAMPLE_MAX = 300;

/** The title of a cluster nothing else could name. */
export const UNRESOLVED_LABEL_FALLBACK = 'Adsız soru grubu';

/** What the lexical labeller reads of each word: three, like a topic's name. */
const LEXICAL_TERMS = 3;

export interface UnresolvedClusterTitle {
  label: string;
  source: UnresolvedLabelSource;
  action: UnresolvedSuggestedAction | null;
}

const ACTION_TEXT: Readonly<Record<UnresolvedSuggestedAction, string>> = {
  add_knowledge: 'the answer is information the assistant lacks — add it to its knowledge',
  add_examples:
    'an existing procedure covers it but did not recognise these wordings — add them as its examples',
  new_procedure: 'it is a request no procedure handles — write one',
  review: 'none of these fits, or the questions are too mixed to say',
};

const LABEL_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    label: {
      type: 'string',
      description: `A Turkish title for what the players ask, at most ${UNRESOLVED_LABEL_WORDS_MAX} words, without numbers or personal data.`,
    },
    action: {
      type: 'string',
      enum: UNRESOLVED_SUGGESTED_ACTIONS,
      description: 'What the workspace should do about these questions.',
    },
  },
  required: ['label', 'action'],
  additionalProperties: false,
};

export const UNRESOLVED_LABEL_RESPONSE_FORMAT: LlmResponseFormat = {
  name: UNRESOLVED_LABEL_RESPONSE_NAME,
  schema: LABEL_SCHEMA,
};

export function buildUnresolvedLabelPrompt(
  samples: readonly string[],
): Pick<LlmCompletionRequest, 'system' | 'messages'> {
  const lines = [
    'Players of an online gaming site asked its support assistant the questions below, and the assistant could not resolve them. They were grouped because they ask about the same thing.',
    `Write a short Turkish title naming what they ask — at most ${UNRESOLVED_LABEL_WORDS_MAX} words, no numbers, no names, nothing personal — and choose the action that would help most:`,
    ...UNRESOLVED_SUGGESTED_ACTIONS.map((action) => `- ${action}: ${ACTION_TEXT[action]}.`),
    'Reply with one JSON object: label and action.',
    UNRESOLVED_LABEL_MARKER,
    JSON.stringify(samples.map((text) => text.slice(0, UNRESOLVED_LABEL_SAMPLE_MAX))),
  ];
  return {
    system: lines.join('\n'),
    messages: [{ role: 'user', content: 'Name these questions.' }],
  };
}

/** The samples `buildUnresolvedLabelPrompt` wrote, or null for any other prompt. */
export function readUnresolvedLabelSamples(system: string): string[] | null {
  const lines = system.split('\n');
  const at = lines.lastIndexOf(UNRESOLVED_LABEL_MARKER);
  if (at < 0 || at + 1 >= lines.length) return null;
  try {
    const parsed: unknown = JSON.parse(lines[at + 1]!);
    return Array.isArray(parsed) && parsed.every((text) => typeof text === 'string')
      ? (parsed as string[])
      : null;
  } catch {
    return null;
  }
}

/**
 * The model's title as the cluster keeps it, or null when it is not one: masked
 * like a player's message — it may quote one — then held to eight words with
 * no digit (`unresolvedLabelOf`).
 */
export function readUnresolvedLabelReply(value: unknown): UnresolvedClusterTitle | null {
  if (typeof value !== 'object' || value === null) return null;
  const reply = value as Record<string, unknown>;
  if (typeof reply['label'] !== 'string' || !isUnresolvedSuggestedAction(reply['action'])) {
    return null;
  }
  const label = unresolvedLabelOf(maskForWrite(reply['label'], 'customer').text);
  return label ? { label, source: 'llm', action: reply['action'] } : null;
}

/**
 * The lexical title: the samples' distinguishing words against `others` (the
 * agent's other questions); failing that the newest sample's first words
 * without a digit; failing that {@link UNRESOLVED_LABEL_FALLBACK}.
 */
export function lexicalUnresolvedLabel(
  samples: readonly string[],
  others: readonly string[],
): UnresolvedClusterTitle {
  const named = unresolvedLabelOf(labelTopic(samples, others, LEXICAL_TERMS).label);
  if (named) return { label: named, source: 'lexical', action: null };
  const words = (samples[0] ?? '')
    .split(/\s+/u)
    .filter((word) => /\p{L}/u.test(word) && !/[\p{N}*]/u.test(word));
  return {
    label: unresolvedLabelOf(words.join(' ')) ?? UNRESOLVED_LABEL_FALLBACK,
    source: 'lexical',
    action: null,
  };
}
