/**
 * The AI configuration change history (tm 315 · SiyahTuş analysis AI-21).
 *
 * A player says "the AI told me yesterday that…": the workspace has to be
 * able to show what the AI was configured to say at that moment. Every save
 * of an AI editing table (ADR-14b §2.5 step 3 · `docs/adr/ai-config-versioning.md`)
 * writes one `ai_config_changes` row — the entity before and after, the
 * JSON-path difference, who and in which role — append-only, kept five years
 * (AI-21-S1), outside the audit log's prune.
 *
 * The lists below are the table's CHECKs (20261114090000_ai_config_changes)
 * and the contract's enums; widening one is expand-only.
 */

/** What changed. `config_version` is the versioning's own rows (tm 316). */
export const AI_CONFIG_ENTITY_TYPES = [
  'persona',
  'guidance_rule',
  'procedure',
  'skill',
  'knowledge_source',
  'knowledge_table_row',
  'handoff_rule',
  'handoff_route',
  'guardrail',
  'risk_policy',
  'access_info',
  'config_version',
] as const;
export type AiConfigEntityType = (typeof AI_CONFIG_ENTITY_TYPES)[number];

/**
 * How it changed. The editing tables write `created`/`updated`/`deleted`;
 * `paused`/`resumed` are the agent's switch (ADR-14b §2.10 item 6); the
 * review states belong to versioning (tm 316) and `crawled` to a website
 * refresh (AI-17).
 */
export const AI_CONFIG_CHANGE_ACTIONS = [
  'created',
  'updated',
  'deleted',
  'submitted',
  'approved',
  'rejected',
  'published',
  'rolled_back',
  'paused',
  'resumed',
  'crawled',
] as const;
export type AiConfigChangeAction = (typeof AI_CONFIG_CHANGE_ACTIONS)[number];

/**
 * A customer never configures the AI, and the root panel's own actions are
 * audited on its side. `platform` is an operator signed in as a member
 * (impersonation) writing through the workspace API.
 */
export const AI_CONFIG_ACTOR_TYPES = ['agent', 'bot', 'system', 'platform'] as const;
export type AiConfigActorType = (typeof AI_CONFIG_ACTOR_TYPES)[number];

/** AI-21-S1: five years by default (the legal question of erasure vs. retention stays open, 07). */
export const AI_CONFIG_HISTORY_DAYS = 1825;

/**
 * A text up to this many UTF-8 bytes is kept as it is; a longer one is kept as
 * its digest and length ({@link AiConfigOmittedText}) — the text itself is in
 * the version's package (AI-20) or the knowledge source.
 */
export const AI_CONFIG_TEXT_LIMIT_BYTES = 20 * 1024;

/** What stands in for a text longer than {@link AI_CONFIG_TEXT_LIMIT_BYTES}. */
export interface AiConfigOmittedText {
  omitted: 'too_large';
  sha256: string;
  /** Characters of the original. */
  length: number;
}

export function isAiConfigOmittedText(value: unknown): value is AiConfigOmittedText {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { omitted?: unknown }).omitted === 'too_large' &&
    typeof (value as { sha256?: unknown }).sha256 === 'string'
  );
}

/**
 * Fields that change no answer (ADR-14b §2.2): they are recorded, but a change
 * of these alone does not move the draft revision (tm 316).
 */
export const AI_CONFIG_META_FIELDS = [
  'owner_id',
  'reviewed_at',
  'review_interval_days',
  'created_by',
  'updated_by',
  'added_by',
] as const;

/**
 * One leaf of the difference. `path` is dotted with array indexes in
 * brackets — `persona.welcome`, `procedure.steps[2].target` — on the row's
 * database column names.
 */
export interface AiConfigDiffEntry {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}

/** The top-level fields a difference touches, in order of first appearance. */
export function aiConfigDiffFields(diff: readonly AiConfigDiffEntry[]): string[] {
  const fields: string[] = [];
  for (const entry of diff) {
    const field = entry.path.split(/[.[]/, 1)[0] ?? entry.path;
    if (!fields.includes(field)) fields.push(field);
  }
  return fields;
}

/** True when every field a difference touches is a meta field. */
export function isAiConfigMetaOnly(diff: readonly AiConfigDiffEntry[]): boolean {
  const meta: readonly string[] = AI_CONFIG_META_FIELDS;
  return diff.length > 0 && aiConfigDiffFields(diff).every((field) => meta.includes(field));
}

/**
 * Where a path points inside a procedure's step list — `steps[2].target`
 * or `procedure.steps[2]` is step 3 — so a summary can say "Adım 3: …".
 * Null for a path outside a step list.
 */
export function aiConfigStepOf(path: string): { step: number; rest: string } | null {
  const match = /(?:^|\.)steps\[(\d+)\](?:\.(.+))?$/.exec(path);
  if (!match) return null;
  return { step: Number(match[1]) + 1, rest: match[2] ?? '' };
}

/** `GET /ai/changes` page size bounds. */
export const AI_CONFIG_CHANGES_PAGE_DEFAULT = 50;
export const AI_CONFIG_CHANGES_PAGE_MAX = 100;
/** The CSV export's ceiling of change rows (each may give several lines). */
export const AI_CONFIG_CHANGES_EXPORT_MAX = 10_000;
