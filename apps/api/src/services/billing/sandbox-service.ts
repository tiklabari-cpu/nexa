/**
 * The sandbox workspace (FR-MOD-11.5 · 11.5-f).
 *
 * A sandbox is a **second tenant**, not a mode: its own organization, its own
 * licence, its own row level security scope, linked to the workspace that pays
 * for it by exactly one column (`licenses.sandbox_of_license_id`). The
 * migration explains why it is a whole organization rather than a sibling
 * licence — short version: `customers` is scoped to the organization and
 * carries no licence column, so a sandbox sharing one would have read the
 * production customer directory.
 *
 * Almost none of the isolation is implemented here, and that is the point. A
 * sandbox's chats, reports, seats and settings are invisible to the parent
 * because RLS already narrows every tenant query to one licence — no report
 * builder, no counter and no settings route had to learn the word "sandbox".
 * What this file holds is the small remainder: the two lifecycle calls, and the
 * one read that lets a workspace see the sandbox it owns.
 *
 * Both lifecycle calls go through SECURITY DEFINER functions and take the bare
 * client rather than a `TenantClient`. That is deliberate twice over: creating
 * a workspace in an organization that does not exist yet has no tenant context
 * to run under (`auth_signup` has the same shape), and resetting one deletes
 * the very licence row the caller's transaction would be scoped to.
 */
import type { PrismaClient } from '@prisma/client';
import type { SandboxSummary } from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

/** Rows the caller may see: their own licence, and the sandbox it owns. */
interface SandboxRows {
  /** True when the caller's own licence is a sandbox. */
  isSandbox: boolean;
  /** The sandbox this licence owns, or null. Always null inside a sandbox. */
  sandbox: SandboxSummary | null;
}

/**
 * Read the caller's sandbox position in one query.
 *
 * Both halves of the answer come from `licenses`, and RLS is what makes the
 * same statement mean different things at each end. The parent's context
 * matches its own row (organization) and its sandbox's row (the clause the
 * migration adds); a sandbox's context matches only itself, because nothing
 * points *at* a sandbox and nesting is refused. So the leak this would
 * otherwise be — "tell me about the licence I belong to" — is closed by the
 * policy rather than by a filter written here.
 *
 * `region` is not read from the sandbox's organization: the parent cannot see
 * that row and does not need to, because a sandbox inherits its parent's region
 * and the region is immutable (C4-a). The caller's own region is the answer, and
 * it is passed in rather than queried.
 */
export async function readSandbox(
  tx: TenantClient,
  tenant: TenantContext,
  region: SandboxSummary['region'],
): Promise<SandboxRows> {
  const rows = await tx.license.findMany({
    where: { OR: [{ id: tenant.licenseId }, { sandboxOfLicenseId: tenant.licenseId }] },
    select: { id: true, sandboxOfLicenseId: true, sandboxResetAt: true, createdAt: true },
  });

  const self = rows.find((row) => row.id === tenant.licenseId);
  const child = rows.find((row) => row.sandboxOfLicenseId === tenant.licenseId);

  return {
    isSandbox: self?.sandboxOfLicenseId != null,
    sandbox: child
      ? {
          license_id: child.id.toString(),
          region,
          created_at: child.createdAt.toISOString(),
          reset_at: child.sandboxResetAt?.toISOString() ?? null,
        }
      : null,
  };
}

/**
 * Is this licence a sandbox?
 *
 * One indexed primary-key lookup, asked by the paths that must treat a sandbox
 * differently rather than merely separately — the billing gate and the meter.
 * Addressed by id rather than `findFirst`. RLS narrows to the organization, and
 * since the sandbox widening a parent's context can see two licence rows —
 * "whichever comes back first" would be a coin flip between them.
 *
 * Answers `false` for a licence it cannot see. That direction is chosen: the
 * only caller who can reach this holds a credential for the licence in
 * question, so an invisible row means something is already badly wrong, and the
 * safe failure is to treat the workspace as real — bill it, meter it — rather
 * than to silently hand somebody a free, unmetered workspace.
 */
export async function isSandboxLicense(tx: TenantClient, licenseId: bigint): Promise<boolean> {
  const row = await tx.license.findUnique({
    where: { id: licenseId },
    select: { sandboxOfLicenseId: true },
  });
  return row?.sandboxOfLicenseId != null;
}

/**
 * Create the sandbox for a production licence.
 *
 * Everything that can go wrong is decided inside `sandbox_create` — it holds a
 * lock on the parent row while it checks, so two owners clicking at once
 * serialise instead of racing. The mapping back to HTTP happens here, one arm
 * per refusal, because a caller who gets "internal error" for "you already have
 * one" cannot act on it.
 */
export async function createSandbox(
  db: PrismaClient,
  parentLicenseId: bigint,
  ownerAccountId: string,
): Promise<{ licenseId: bigint; organizationId: string }> {
  let rows: Array<{ created_license: bigint; created_organization: string }>;
  try {
    rows = await db.$queryRaw`
      SELECT * FROM sandbox_create(${parentLicenseId}, ${ownerAccountId}::uuid)`;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/nexa_sandbox_exists/.test(message)) {
      throw new ApiError(
        'sandbox_exists',
        'This workspace already has a sandbox. Reset it from inside instead of creating a second one.',
      );
    }
    if (/nexa_sandbox_nested/.test(message)) {
      throw new ApiError(
        'not_allowed',
        'A sandbox cannot have a sandbox of its own. Create it from the production workspace.',
      );
    }
    throw error;
  }

  const row = rows[0];
  if (!row) throw ApiError.internal('Sandbox creation produced no workspace.');
  return { licenseId: row.created_license, organizationId: row.created_organization };
}

/**
 * Empty a sandbox and return the moment it was emptied.
 *
 * Refused on anything that is not a sandbox — the one guard that matters here,
 * since this call deletes a whole workspace's data and the mistake it is
 * guarding against is somebody pointing it at a real one. Enforced in the
 * function rather than only at the route, so it holds for any future caller.
 */
export async function resetSandbox(db: PrismaClient, licenseId: bigint): Promise<Date> {
  let rows: Array<{ reset_at: Date }>;
  try {
    rows = await db.$queryRaw`SELECT sandbox_reset(${licenseId}) AS reset_at`;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/nexa_not_a_sandbox/.test(message)) throw sandboxResetRefused();
    throw error;
  }

  const row = rows[0];
  if (!row) throw ApiError.internal('Sandbox reset reported nothing.');
  return row.reset_at;
}

/**
 * The refusal a production workspace gets when it asks to be wiped.
 *
 * Named and shared so the route's pre-check and the database's own guard give the
 * same sentence — a caller must not be able to tell which layer stopped them,
 * because that difference is only ever a hint about how to get past one of them.
 */
export function sandboxResetRefused(): ApiError {
  return new ApiError(
    'not_allowed',
    'Only a sandbox can be reset, and only from inside it. This is a production workspace — sign in to the sandbox to reset it.',
  );
}
