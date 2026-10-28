/**
 * AI configuration versions (tm 316 · SiyahTuş analysis AI-20 · ADR-14b
 * `docs/adr/ai-config-versioning.md`).
 *
 * The editing tables are the draft; what the AI answers from is a published,
 * immutable package — one `ai_config_versions` row. A version is submitted
 * (`in_review`), approved by someone other than its submitter, published, and
 * superseded by the next one; a rejected one stays as it was.
 *
 * The lists below are the table's CHECKs (20261115090000_ai_config_versions);
 * widening one is expand-only.
 */

/** A version's life (ADR-14b §2.3, §2.10). */
export const AI_CONFIG_VERSION_STATUSES = [
  'in_review',
  'approved',
  'published',
  'superseded',
  'rejected',
] as const;
export type AiConfigVersionStatus = (typeof AI_CONFIG_VERSION_STATUSES)[number];

/** Awaiting publication — at most one per agent (partial unique index). */
export const AI_CONFIG_OPEN_VERSION_STATUSES = [
  'in_review',
  'approved',
] as const satisfies readonly AiConfigVersionStatus[];

/**
 * `package_format` of the v1 the migration wrote for every agent that existed
 * before versioning: an empty package standing for the editing tables as they
 * were, read and compiled — what the AI did until then. Sealed once with the
 * compiled package; never written by anything else.
 */
export const AI_CONFIG_PACKAGE_FORMAT_BASELINE = 0;

/** A version's name on screen: "v12", or "v12.1" for a fast-path minor (AI-20-S1). */
export function aiConfigVersionLabel(version: { number: number; minor: number }): string {
  return version.minor === 0 ? `v${version.number}` : `v${version.number}.${version.minor}`;
}

// ---------------------------------------------------------------------------
// The compiled package (tm 316.5 · ADR-14b §2.4, §2.10 (1)).
// ---------------------------------------------------------------------------

/** `package_format` of a package `config-compiler.ts` writes. */
export const AI_CONFIG_PACKAGE_FORMAT = 1;

/**
 * The largest package, as canonical JSON in bytes (ADR-14b §2.4's proposal):
 * a draft that compiles to more is refused (`package_too_large`).
 */
export const AI_CONFIG_PACKAGE_MAX_BYTES = 2 * 1024 * 1024;

/** The parts of a package a difference is told in, in the order a screen lists them. */
export const AI_CONFIG_SECTIONS = [
  'agent',
  'skills',
  'guidance',
  'guardrails',
  'handoff',
  'knowledge',
] as const;
export type AiConfigSection = (typeof AI_CONFIG_SECTIONS)[number];

/**
 * Why a difference needs the owner's approval (`touches_compliance`, AI-20
 * coding logic 2): the workspace's guardrails (AI-08) or a locked procedure
 * (AI-15 — self-exclusion, responsible gambling). The risk policy (AI-27)
 * joins the list with its table.
 */
export const AI_CONFIG_COMPLIANCE_REASONS = ['guardrails', 'locked_procedure'] as const;
export type AiConfigComplianceReason = (typeof AI_CONFIG_COMPLIANCE_REASONS)[number];

/** What stops a draft from being submitted. */
export const AI_CONFIG_PROBLEM_CODES = [
  'agent_not_found',
  'skill_steps_invalid',
  'skill_procedure_invalid',
  'guidance_locked_rule',
  'guidance_conflict',
  'handoff_target_unknown_team',
  'package_too_large',
] as const;
export type AiConfigProblemCode = (typeof AI_CONFIG_PROBLEM_CODES)[number];

/** What a submitter is told but not stopped by. */
export const AI_CONFIG_WARNING_CODES = [
  'guidance_duplicate',
  'handoff_rule_procedure_inactive',
  'knowledge_source_not_ready',
] as const;
export type AiConfigWarningCode = (typeof AI_CONFIG_WARNING_CODES)[number];

/**
 * One finding about a draft. `section` and `key` name the item as the
 * difference does (a skill's id, `rule:<id>`, …); the rest is the code's.
 */
export interface AiConfigFinding<Code extends string = AiConfigProblemCode | AiConfigWarningCode> {
  code: Code;
  section: AiConfigSection | null;
  key: string | null;
  message: string;
  details?: Record<string, string | number | null>;
}

/**
 * One knowledge source as a version sees it (`ai_config_versions.knowledge_manifest`,
 * ADR-14b §2.4): which generation of its chunks, and the scope the live
 * search reads from here rather than from the source row.
 */
export interface AiConfigKnowledgeManifestEntry {
  source_id: string;
  generation: number;
  /**
   * The generation's chunks when the package was compiled (tm 316.2): a
   * rollback that finds fewer of them has lost some to the clean-up and is
   * refused (ADR-14b §2.10 (7)).
   */
  chunk_count: number;
  type: string;
  audiences: string[];
  ai_agent_ids: string[];
  brand_ids: string[];
  language: string | null;
  /** ISO 8601; null: no end. Judged against the turn's own clock. */
  valid_until: string | null;
}

export type AiConfigDiffKind = 'added' | 'removed' | 'changed';

/** At most this many items a section's difference names; the counts are always whole. */
export const AI_CONFIG_DIFF_ITEMS_MAX = 200;

export interface AiConfigSectionDiff {
  section: AiConfigSection;
  added: number;
  removed: number;
  changed: number;
  /** Ordered by key; cut at {@link AI_CONFIG_DIFF_ITEMS_MAX}. */
  items: Array<{ key: string; kind: AiConfigDiffKind }>;
}

/** `ai_config_versions.diff_summary`: a package against the published one it is based on. */
export interface AiConfigDiffSummary {
  /** The version compared against; null: the agent had none published. */
  base_version_id: string | null;
  /**
   * The base was the migration's uncompiled v1 (`package_format` 0), so the
   * package is told against nothing — every item reads as added.
   */
  from_baseline: boolean;
  /** Items added, removed or changed, all sections together — "Taslak 7 değişiklik". */
  changes: number;
  /** Only the sections with a change, in {@link AI_CONFIG_SECTIONS} order. */
  sections: AiConfigSectionDiff[];
  touches_compliance: boolean;
  compliance: AiConfigComplianceReason[];
}

// ---------------------------------------------------------------------------
// The review line (tm 316.2 · ADR-14b §2.10, §2.11).
// ---------------------------------------------------------------------------

/**
 * Why a version step was refused — `409 ai_config_version_state`,
 * `details.reason`:
 *
 *   - `compliance_pack` — the draft revision's latest pre-publish run has not
 *     passed the whole compliance pack (AI-19-S1), or the version's run no
 *     longer counts (another pack version);
 *   - `no_changes` — the draft compiles to the published package;
 *   - `not_open` — the version is not awaiting review;
 *   - `stale_base` — another version was published over the one it was
 *     based on, and the two touch the same thing: it was rejected, submit again;
 *   - `rollback_current` — the version is the one in production;
 *   - `rollback_unpublished` — the version never was in production;
 *   - `rollback_baseline` — the migration's v1 holds no package to copy;
 *   - `knowledge_purged` — chunks the version answered from are gone.
 */
export const AI_CONFIG_VERSION_STATE_REASONS = [
  'compliance_pack',
  'no_changes',
  'not_open',
  'stale_base',
  'rollback_current',
  'rollback_unpublished',
  'rollback_baseline',
  'knowledge_purged',
] as const;
export type AiConfigVersionStateReason = (typeof AI_CONFIG_VERSION_STATE_REASONS)[number];

/**
 * The `review_note` the system writes on a version it rejects itself: a new
 * submission replaced it (one open version per agent), or it was based on a
 * version published over before it could go out.
 */
export const AI_CONFIG_SYSTEM_REVIEW_NOTES = ['superseded_by_submit', 'stale_base'] as const;
export type AiConfigSystemReviewNote = (typeof AI_CONFIG_SYSTEM_REVIEW_NOTES)[number];

/** A reviewer's, submitter's or pauser's note — the table's CHECK on `review_note`. */
export const AI_CONFIG_NOTE_MAX = 2000;

/** How far ahead an approval may schedule its publication (AI-20-S4). */
export const AI_CONFIG_SCHEDULE_MAX_DAYS = 30;

/** At most this many versions a list page holds. */
export const AI_CONFIG_VERSIONS_PAGE_MAX = 100;

/** The permission matrix row the approve and reject routes check (`capabilities.ts`). */
export const AI_CONFIG_PUBLISH_CAPABILITY = 'ai.config.publish' as const;
