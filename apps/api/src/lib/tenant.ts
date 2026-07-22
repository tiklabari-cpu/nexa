/**
 * Tenant-scoped database access (NFR-S4).
 *
 * Every query that touches tenant data runs inside `withTenant`, which opens a
 * transaction and sets `app.current_license` / `app.current_organization` via
 * `SET LOCAL`. The RLS policies read those settings.
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
 */
import type { Prisma, PrismaClient } from '@prisma/client';

export interface TenantContext {
  licenseId: bigint;
  organizationId: string;
}

export type TenantClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertValidContext(context: TenantContext): void {
  if (typeof context.licenseId !== 'bigint' || context.licenseId <= 0n) {
    throw new TypeError(`invalid tenant license id: ${String(context.licenseId)}`);
  }
  if (!UUID_RE.test(context.organizationId)) {
    throw new TypeError(`invalid tenant organization id: ${context.organizationId}`);
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
      return fn(tx);
    },
    { timeout: options.timeoutMs ?? 10_000 },
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
