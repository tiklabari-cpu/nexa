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
