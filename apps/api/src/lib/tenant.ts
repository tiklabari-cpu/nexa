/**
 * Tenant-scoped database access (NFR-S4).
 *
 * Every query that touches tenant data runs inside `withTenant`, which opens a
 * transaction and sets `app.current_license`, `app.current_organization` and —
 * for the Multibrand surface (PRD §5.3) — `app.current_brand` via `SET LOCAL`.
 * The RLS policies read those settings.
 *
 * Why a transaction rather than a connection-level SET: the pool hands
 * connections to whoever asks next. A session variable set outside a
 * transaction would leak to the next request that borrowed the same connection
 * — the worst possible bug, because it produces a *plausible* wrong tenant
 * rather than an error. `SET LOCAL` is scoped to the transaction and unwinds
 * automatically, so it cannot outlive the request.
 *
 * The values are cast to bigint/uuid inside the SQL, so a malformed tenant id
 * raises rather than silently matching nothing.
 *
 * `brandId` is optional: absent (an empty `app.current_brand`) means "every
 * brand of the license" — the single-brand default — so a workspace that never
 * touches Multibrand behaves exactly as before. When set, brand-scoped tables
 * (channels) narrow to that one brand on top of the license match.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

export interface TenantContext {
  licenseId: bigint;
  organizationId: string;
  brandId?: string;
}

export type TenantClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * How long a tenant transaction may run before Prisma rolls it back.
 *
 * Named rather than inlined because one other place has to reason about it: an
 * audit row's `created_at` is `CURRENT_TIMESTAMP`, which in Postgres is the
 * *start* of the transaction that wrote it, so a committed entry can carry a
 * timestamp up to this long before the moment it becomes visible. The SIEM
 * export's horizon is derived from that bound (`services/audit/audit-export.ts`)
 * and would silently start skipping entries if the two drifted apart.
 */
export const TENANT_TRANSACTION_TIMEOUT_MS = 10_000;

function assertValidContext(context: TenantContext): void {
  if (typeof context.licenseId !== 'bigint' || context.licenseId <= 0n) {
    throw new TypeError(`invalid tenant license id: ${String(context.licenseId)}`);
  }
  if (!UUID_RE.test(context.organizationId)) {
    throw new TypeError(`invalid tenant organization id: ${context.organizationId}`);
  }
  // A brand is optional (absent = license-wide), but if one is named it must be a
  // valid uuid — a malformed brand raises here rather than silently matching
  // nothing, the same contract the license/organization ids hold to.
  if (context.brandId !== undefined && !UUID_RE.test(context.brandId)) {
    throw new TypeError(`invalid tenant brand id: ${context.brandId}`);
  }
}

/**
 * Run `fn` with the tenant context established for its whole transaction.
 *
 * Anything `fn` does through the provided client is subject to RLS, so a
 * missing WHERE clause returns nothing instead of another tenant's rows.
 */
export async function withTenant<T>(
  db: PrismaClient,
  context: TenantContext,
  fn: (tx: TenantClient) => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  assertValidContext(context);

  return db.$transaction(
    async (tx) => {
      // set_config(..., true) is the function form of SET LOCAL: scoped to this
      // transaction, discarded on commit or rollback.
      await tx.$executeRaw`SELECT set_config('app.current_license', ${context.licenseId.toString()}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_organization', ${context.organizationId}, true)`;
      // '' means no brand selected → the license-wide view. Transaction-scoped
      // like the other two, so it never leaks to the pooled connection.
      await tx.$executeRaw`SELECT set_config('app.current_brand', ${context.brandId ?? ''}, true)`;
      return fn(tx);
    },
    { timeout: options.timeoutMs ?? TENANT_TRANSACTION_TIMEOUT_MS },
  );
}

/**
 * Base class for repositories. Holding the context as a field means a caller
 * cannot construct a repository without deciding whose data it may see.
 */
export abstract class TenantScopedRepository {
  constructor(
    protected readonly db: PrismaClient,
    protected readonly context: TenantContext,
  ) {
    assertValidContext(context);
  }

  protected run<T>(fn: (tx: TenantClient) => Promise<T>): Promise<T> {
    return withTenant(this.db, this.context, fn);
  }

  get licenseId(): bigint {
    return this.context.licenseId;
  }

  get organizationId(): string {
    return this.context.organizationId;
  }

  /** The active brand, or undefined when the repository runs license-wide. */
  get brandId(): string | undefined {
    return this.context.brandId;
  }
}

/**
 * Escape hatch for the pre-authentication path only — resolving a bearer token
 * is what *determines* the tenant, so it cannot already be inside one.
 *
 * Everything reachable this way goes through the SECURITY DEFINER `auth_*`
 * functions defined in the RLS migration, each of which answers a single
 * question and returns only the columns needed. Nothing else should call this.
 */
export function unscoped(db: PrismaClient): Pick<PrismaClient, '$queryRaw' | '$executeRaw'> {
  return db;
}

export type { Prisma };
