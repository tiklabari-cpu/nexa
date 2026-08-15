/**
 * HIPAA scope — the one place that answers "is this workspace covered?" (NFR-C4).
 *
 * `C4-d` records an acceptance; this is what reads it. The distinction matters,
 * because a signed BAA is not a *permission* a workspace gains — it is a
 * **constraint** it takes on, and the constraint has three consequences that
 * have to move together (PLAN §5.1.2):
 *
 *   1. **A retention ceiling.** A covered workspace cannot keep conversation
 *      content indefinitely; its configured window is capped, and "unlimited"
 *      is not on the menu. `services/retention/policy.ts`.
 *   2. **Harder PII masking in logs and telemetry.** See `lib/log-redact.ts` —
 *      applied unconditionally, for the reason given there.
 *   3. **No inference outside the region.** A model call that would leave the
 *      workspace's region is refused. `services/ai/inference.ts`.
 *
 * Split apart, those produce the account this requirement exists to prevent: a
 * signed BAA whose transcripts are summarised by a model in another country, or
 * kept forever. So they share one predicate rather than three lookups that can
 * drift.
 *
 * The predicate is deliberately just "is the timestamp set". The other half of
 * NFR-C4's condition — US hosting — is not re-checked here because it cannot be
 * false: `licenses_baa_requires_us_region` (C4-d) refuses to let the timestamp
 * exist on a licence whose organization is not `us`, on INSERT and on UPDATE,
 * including a move of the licence between organizations. A second check in
 * TypeScript would be a second opinion about a fact the database already holds
 * as an invariant, and the interesting failure mode is the one where the two
 * disagree.
 */
import type { TenantClient } from './tenant.js';

/** The shape any caller needs to decide scope; a licence row, or nothing. */
export interface HipaaScopeSource {
  hipaaBaaSignedAt: Date | null;
}

/**
 * Whether a licence is inside HIPAA scope.
 *
 * A missing row answers `false` rather than throwing: every caller here is
 * deciding whether to *tighten* something, and a workspace nobody can find is
 * not a workspace to relax a constraint for — but it is also not one to crash a
 * retention sweep over.
 */
export function inHipaaScope(licence: HipaaScopeSource | null | undefined): boolean {
  return licence?.hipaaBaaSignedAt != null;
}

/**
 * Read the scope for one licence inside an established tenant context.
 *
 * Addressed by id rather than `findFirst`, for the reason `GET
 * /settings/compliance` gives: one organization may hold several licences and
 * RLS narrows to the organization, so "the first row back" is not necessarily
 * the licence whose data is about to be swept or inferred over.
 */
export async function readHipaaScope(tx: TenantClient, licenseId: bigint): Promise<boolean> {
  const licence = await tx.license.findUnique({
    where: { id: licenseId },
    select: { hipaaBaaSignedAt: true },
  });
  return inHipaaScope(licence);
}
