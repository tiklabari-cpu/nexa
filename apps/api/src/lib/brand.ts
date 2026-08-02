/**
 * Brand resolution for brand-scoped writes (Multibrand, PRD §5.3).
 *
 * A brand-scoped singleton — widget/security/inbox settings, and a website's
 * home brand — must land on exactly one brand. `X-Nexa-Brand` names it when
 * present (folded into the tenant context as `brandId`); when absent, the
 * request operates license-wide, and the row it writes belongs to the license
 * *default* brand. Every license has exactly one default brand — the migration
 * backfill, the seed and `auth_signup` all lay it down — so a request that names
 * no brand still resolves to a single, real brand: the sole brand of a
 * single-brand workspace.
 *
 * Call inside the request's `withTenant`. When `brandId` is already set the
 * lookup is skipped entirely; only the license-wide case costs a query, and that
 * query runs under the license-wide context so RLS returns this license's
 * default brand and no other.
 */
import { ApiError } from './api-error.js';
import type { TenantClient } from './tenant.js';

export async function resolveBrandId(
  tx: TenantClient,
  brandId: string | undefined,
): Promise<string> {
  if (brandId) return brandId;
  const brand = await tx.brand.findFirst({ where: { isDefault: true }, select: { id: true } });
  // The invariant is guaranteed in production; throwing rather than inventing a
  // brand keeps a broken workspace loud instead of silently writing unscoped.
  if (!brand) throw ApiError.validation('This workspace has no default brand.');
  return brand.id;
}
