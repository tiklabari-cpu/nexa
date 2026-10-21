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
