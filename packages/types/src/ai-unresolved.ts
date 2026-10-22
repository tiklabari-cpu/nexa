/**
 * The unresolved questions' vocabulary (tm 317 · SiyahTuş analysis AI-22) —
 * shared by the two tables' CHECKs (`20261022120000_ai_unresolved`), the
 * capture (tm 317.1: the AI's turn and the close of a conversation), the
 * clustering job (tm 317.2) and the report (tm 317.3), and by AI-25's
 * hand-over metrics, which read the same reasons (one definition).
 *
 *   - An **item** is one message the AI could not resolve: why
 *     ({@link UNRESOLVED_REASONS}), the player's words masked (AI-26) with the
 *     player's message before them, the language, the embedding the turn's
 *     search already made, and the cluster it was put in.
 *   - A **cluster** is a group of items that ask the same thing, per AI agent
 *     and embedding space: its title, its counts and whether the workspace
 *     ignored it or fixed it.
 *
 * The player's words live at most {@link UNRESOLVED_TEXT_RETENTION_DAYS} days,
 * and never longer than the conversation they came from (AI-22-S1); a
 * cluster's title and counts stay.
 */

import type { GuardrailId } from './guardrails.js';
import type { HandoffReason } from './handoff.js';

// ---------------------------------------------------------------------------
// Closed lists — each is a CHECK in the migration.
// ---------------------------------------------------------------------------

/**
 * Why a message is on the list (05 § AI-22 "Kodlama mantığı" §1):
 *
 *   - `no_procedure_match`    — the decision order found no procedure, no skill
 *                               took the message and the knowledge base had
 *                               no passage for it;
 *   - `no_knowledge`          — an agent with no procedures searched its
 *                               knowledge and found nothing;
 *   - `low_confidence`        — passages came back, but none of them answers
 *                               the question (the answer was not grounded);
 *   - `said_dont_know`        — the AI said it cannot answer: its draft was
 *                               withheld, or nothing it ran said anything;
 *   - `unsupported_language`  — a language the persona does not speak;
 *   - `not_understood_handoff`— handed over after the turns it could not
 *                               understand (AI-09 `not_understood`);
 *   - `player_abandoned`      — the conversation closed on the AI's question,
 *                               unanswered, with no hand-over;
 *   - `asked_human_after_ai`  — the player asked for a person after the AI
 *                               had answered;
 *   - `agent_flagged`         — an agent marked the AI's answer (AI-23).
 */
export const UNRESOLVED_REASONS = [
  'no_procedure_match',
  'no_knowledge',
  'low_confidence',
  'said_dont_know',
  'unsupported_language',
  'not_understood_handoff',
  'player_abandoned',
  'asked_human_after_ai',
  'agent_flagged',
] as const;
export type UnresolvedReason = (typeof UNRESOLVED_REASONS)[number];

export function isUnresolvedReason(value: unknown): value is UnresolvedReason {
  return (UNRESOLVED_REASONS as readonly unknown[]).includes(value);
}

/** Where a cluster stands: on the list, ignored (still counted), or fixed. */
export const UNRESOLVED_CLUSTER_STATUSES = ['open', 'ignored', 'resolved'] as const;
export type UnresolvedClusterStatus = (typeof UNRESOLVED_CLUSTER_STATUSES)[number];

/** Who wrote a cluster's title: the fast model, or the lexical labeller (`topics.ts`). */
export const UNRESOLVED_LABEL_SOURCES = ['llm', 'lexical'] as const;
export type UnresolvedLabelSource = (typeof UNRESOLVED_LABEL_SOURCES)[number];

// ---------------------------------------------------------------------------
// Limits — the migration's CHECKs use the same numbers.
// ---------------------------------------------------------------------------

/** AI-22-S1: the masked words are kept at most this long. */
export const UNRESOLVED_TEXT_RETENTION_DAYS = 90;

/** The longest stored text (`text_masked`, `context_masked`); longer is cut. */
export const UNRESOLVED_TEXT_MAX = 1000;

/** A cluster's title: at most eight words (AI-22 §5), and this many characters. */
export const UNRESOLVED_LABEL_MAX = 120;

/** Why the workspace ignored a cluster. */
export const UNRESOLVED_IGNORE_REASON_MAX = 500;

/** Fewer letters and digits than this and a message says nothing worth grouping. */
export const UNRESOLVED_MIN_CHARS = 3;

// ---------------------------------------------------------------------------
// What is never on the list
// ---------------------------------------------------------------------------

/**
 * The platform rules whose hand-overs and warnings are compliance, not a gap
 * in the AI's knowledge (AI-22 §1): self-exclusion and problem gambling (G1,
 * G2, G6), self-harm (G3), no promotion to a player at risk (G4), a minor
 * (G5), account security (G13), complaints (G15). A turn any of them touched
 * is AI-27's and AI-24's to report, never this list's.
 */
export const UNRESOLVED_EXCLUDED_GUARDRAILS = [
  'G1',
  'G2',
  'G3',
  'G4',
  'G5',
  'G6',
  'G13',
  'G15',
] as const satisfies readonly GuardrailId[];

/**
 * The hand-over reasons (`HANDOFF_REASONS`) that keep a turn off the list:
 * the excluded rules' own, a stored risk flag's and abuse — none is a question
 * the AI should have known the answer to.
 */
export const UNRESOLVED_EXCLUDED_HANDOFF_REASONS = [
  'guardrail_self_harm',
  'guardrail_minor',
  'guardrail_rg',
  'risk_flag',
  'guardrail_account_security',
  'guardrail_complaint',
  'abuse',
] as const satisfies readonly HandoffReason[];

/**
 * The player's message as the list keeps it, or null when it says nothing
 * worth grouping (AI-22 §2): fewer than {@link UNRESOLVED_MIN_CHARS} letters
 * and digits, a single word ("merhaba", "?"), only emoji or punctuation.
 * Whitespace is collapsed and the text cut to {@link UNRESOLVED_TEXT_MAX}.
 * Not masked — the writer masks (AI-26).
 */
export function unresolvedTextOf(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null;
  const collapsed = text.replace(/\s+/gu, ' ').trim();
  const words = collapsed.split(' ').filter((word) => /[\p{L}\p{N}]/u.test(word));
  if (words.length < 2) return null;
  if ((collapsed.match(/[\p{L}\p{N}]/gu) ?? []).length < UNRESOLVED_MIN_CHARS) return null;
  return collapsed.length > UNRESOLVED_TEXT_MAX
    ? collapsed.slice(0, UNRESOLVED_TEXT_MAX).trimEnd()
    : collapsed;
}

// ---------------------------------------------------------------------------
// Clustering (tm 317.2 · AI-22 §4–§8)
// ---------------------------------------------------------------------------

/**
 * The cosine an item must reach to join a cluster's centre (τ), by kind of
 * space. A model's space (`openai:…`) puts two wordings of one question at
 * about 0.85 and a neighbouring question at 0.6–0.75: 0.8 is the analysis's
 * starting value, held by the fixture of 30 "Papara ile yatırdım gözükmüyor"
 * sentences (`unresolved-assign.test.ts`). The lexical stub (`mock:…`) is
 * `topics.ts`' space, and its floor is the topic report's
 * (`TOPIC_SIMILARITY_THRESHOLD`).
 */
export const UNRESOLVED_CLUSTER_SIMILARITY = { model: 0.8, lexical: 0.3 } as const;

/**
 * The cosine two clusters' centres must reach for the nightly pass to merge
 * them (τ_merge) — above τ: only clusters the greedy pass split by the order
 * the items came in, never two neighbouring questions.
 */
export const UNRESOLVED_MERGE_SIMILARITY = { model: 0.9, lexical: 0.6 } as const;

/** The kind of space a vector lives in: the stub's lexical one, or a model's. */
export type UnresolvedSpaceKind = keyof typeof UNRESOLVED_CLUSTER_SIMILARITY;

/** `EmbeddingProvider.space` is `<provider>:<model>`; the stub's provider is `mock`. */
export function unresolvedSpaceKind(space: string): UnresolvedSpaceKind {
  return space.startsWith('mock:') ? 'lexical' : 'model';
}

/** The items the clustering job embeds, or assigns, per workspace and pass. */
export const UNRESOLVED_CLUSTER_BATCH = 500;

/** A cluster's title is written from at most this many of its newest items. */
export const UNRESOLVED_LABEL_SAMPLES = 10;

/** A title is at most this many words (AI-22 §5). */
export const UNRESOLVED_LABEL_WORDS_MAX = 8;

/**
 * A cluster is titled again once it has grown by half since its title was
 * written (AI-22 §5): `item_count * 2 >= labelled_count * 3`.
 */
export function unresolvedLabelDue(itemCount: number, labelledCount: number): boolean {
  return labelledCount === 0 ? itemCount > 0 : itemCount * 2 >= labelledCount * 3;
}

/**
 * What the title writer suggests doing about a cluster (AI-22 §5): add
 * knowledge (AI-23), add example sentences to a procedure (AI-03), write a new
 * procedure, or only look at it. The lexical labeller suggests nothing.
 */
export const UNRESOLVED_SUGGESTED_ACTIONS = [
  'add_knowledge',
  'add_examples',
  'new_procedure',
  'review',
] as const;
export type UnresolvedSuggestedAction = (typeof UNRESOLVED_SUGGESTED_ACTIONS)[number];

export function isUnresolvedSuggestedAction(value: unknown): value is UnresolvedSuggestedAction {
  return (UNRESOLVED_SUGGESTED_ACTIONS as readonly unknown[]).includes(value);
}

/**
 * A title as the list keeps it, or null when it is not one: whitespace and
 * wrapping quotes gone, at most {@link UNRESOLVED_LABEL_WORDS_MAX} words and
 * {@link UNRESOLVED_LABEL_MAX} characters. A digit or a mask's star makes it
 * null — a title never carries an amount, an order or a card number.
 */
export function unresolvedLabelOf(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null;
  const words = text
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^["'“”‘’«»]+|["'“”‘’«».]+$/gu, '')
    .trim()
    .split(' ')
    .filter((word) => word.length > 0)
    .slice(0, UNRESOLVED_LABEL_WORDS_MAX);
  const label = words.join(' ').slice(0, UNRESOLVED_LABEL_MAX).trim();
  if (!/[\p{L}]/u.test(label) || /[\p{N}*]/u.test(label)) return null;
  return label;
}

// ---------------------------------------------------------------------------
// Counting and the alarm (AI-22 §6–§8, AI-22-S2)
// ---------------------------------------------------------------------------

/** The report's window: a cluster's `count_7d`. */
export const UNRESOLVED_RECENT_DAYS = 7;

/** A cluster younger than this is "new" (AI-22 §6). */
export const UNRESOLVED_NEW_HOURS = 48;

/** The reasons that are a hand-over in themselves; any other item counts one when its connection was handed over. */
export const UNRESOLVED_HANDOFF_REASONS = [
  'unsupported_language',
  'not_understood_handoff',
  'asked_human_after_ai',
] as const satisfies readonly UnresolvedReason[];

/** AI-22-S2: the window a cluster's surge is counted in. */
export const UNRESOLVED_SPIKE_WINDOW_MINUTES = 60;

/** AI-22-S2: the surge that alarms, unless the workspace set its own. */
export const UNRESOLVED_SPIKE_THRESHOLD_DEFAULT = 20;

/** The workspace's own surge threshold is between these (`ai_unresolved_settings`). */
export const UNRESOLVED_SPIKE_THRESHOLD_MIN = 5;
export const UNRESOLVED_SPIKE_THRESHOLD_MAX = 1000;

/** A cluster alarms at most once in this many hours (AI-22 §8). */
export const UNRESOLVED_ALERT_REPEAT_HOURS = 6;

/**
 * A fixed cluster that collects this many new items after its fix is open
 * again, and says so (AI-22 §7).
 */
export const UNRESOLVED_REOPEN_AFTER_FIX = 5;

/** Why the people who read the report are told of a cluster. */
export const UNRESOLVED_ALERT_KINDS = ['spike', 'reopened'] as const;
export type UnresolvedAlertKind = (typeof UNRESOLVED_ALERT_KINDS)[number];

/**
 * The in-app notice (`RTM_PUSH_ACTIONS` `ai_unresolved_alert`) to the
 * workspace's Team Leads and up (admin and up until RL-01): a cluster surged
 * past the threshold in the last hour, or came back after its fix. Carries
 * the cluster's title — what the report shows the same people — and numbers;
 * never an item's words.
 */
export interface AiUnresolvedAlertPush {
  kind: UnresolvedAlertKind;
  cluster_id: string;
  ai_agent_id: string;
  label: string;
  /** `spike`: items in the window; `reopened`: items since the fix. */
  count: number;
  /** `spike`: the workspace's threshold; `reopened`: {@link UNRESOLVED_REOPEN_AFTER_FIX}. */
  threshold: number;
  /** `spike`: {@link UNRESOLVED_SPIKE_WINDOW_MINUTES}; `reopened`: null. */
  window_minutes: number | null;
}

// ---------------------------------------------------------------------------
// The report (tm 317.3 · AI-22 §6, `paths/ai-unresolved.yaml`)
// ---------------------------------------------------------------------------

/**
 * What the report is ordered by (AI-22 §6): the last seven days' count (the
 * default), the share of the cluster's items that ended in a hand-over, the
 * share that were abandoned, the first or the last sighting.
 */
export const UNRESOLVED_LIST_SORTS = [
  'count_7d',
  'handoff_rate',
  'abandon_rate',
  'first_seen',
  'last_seen',
] as const;
export type UnresolvedListSort = (typeof UNRESOLVED_LIST_SORTS)[number];

/**
 * Which clusters the report lists: `open` is the default view — the ones to
 * work on, an ignored cluster still counted but out of the way (AI-22 KK 4);
 * `all` is every one.
 */
export const UNRESOLVED_LIST_STATUSES = ['open', 'ignored', 'resolved', 'all'] as const;
export type UnresolvedListStatus = (typeof UNRESOLVED_LIST_STATUSES)[number];

/** The report's page. */
export const UNRESOLVED_LIST_LIMIT_DEFAULT = 50;
export const UNRESOLVED_LIST_LIMIT_MAX = 100;

/** A cluster's detail shows this many of its newest masked examples — always, the title may mislead (AI-22 notes). */
export const UNRESOLVED_EXAMPLES_PER_CLUSTER = 50;

/** …and a trend of this many days. */
export const UNRESOLVED_TREND_DAYS = 14;

/** A merge folds at most this many clusters into one. */
export const UNRESOLVED_MERGE_SOURCES_MAX = 20;

/** Sentences "add examples" (AI-03) takes in one request, and the ones "add knowledge" prefills. */
export const UNRESOLVED_ADD_EXAMPLES_MAX = 10;
export const UNRESOLVED_KNOWLEDGE_QUESTIONS_MAX = 10;

/** A cluster's share of hand-overs or abandonments: 0–1, three decimals; 0 for an empty cluster. */
export function unresolvedRate(count: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.round((Math.min(count, itemCount) / itemCount) * 1000) / 1000;
}

/** Whether a cluster first seen at `firstSeen` still wears the "new" badge (AI-22 §6). */
export function unresolvedIsNew(firstSeen: Date | string, now: Date = new Date()): boolean {
  const at = typeof firstSeen === 'string' ? new Date(firstSeen) : firstSeen;
  return now.getTime() - at.getTime() < UNRESOLVED_NEW_HOURS * 3_600_000;
}
