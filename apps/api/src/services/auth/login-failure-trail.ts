/**
 * The audit trail of a refused `/auth/login` (tm 422 · denetim F05).
 *
 * `/auth/login` selects no workspace, so unlike `/auth/authorize` it has no
 * workspace of its own to record a failure in. A password is the account's,
 * though, and the account's workspaces are the ones a guess at it threatens —
 * so a wrong password for a registered address is recorded as
 * `auth.login_failed` in each of them (`target: account:<id>`, actor
 * `system`), the way a password reset is recorded in each (`account-lifecycle`).
 * No address and no password in the entry: the target names the account, and
 * the address it was tried from is the entry's own `ip`. An unregistered
 * address has no workspace to be recorded in; the anonymous bucket and the
 * per-address budget (`login-attempts.ts`) still count it.
 *
 * **Written after the answer, not before it.** The route answers an unknown
 * address and a wrong password with the same 401 in the same time, so that
 * registered addresses cannot be enumerated (`login` in the contract). Writing
 * the entries before answering would make exactly the registered addresses a
 * few milliseconds slower. So the route starts the write and answers; the
 * write is kept here until it settles, and `idle()` is how the server's close
 * and the integration helper wait for it (a transaction still open when a test
 * resets the database deadlocks the TRUNCATE).
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { withTenant } from '../../lib/tenant.js';
import { writeAuditEntry, type AuditContext } from '../audit/audit-log.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The refused `/auth/login` trail — `idle()` for a test that reads it. */
    loginFailures: LoginFailureTrail;
  }
}

export class LoginFailureTrail {
  readonly #pending = new Set<Promise<void>>();

  constructor(private readonly db: PrismaClient) {}

  /**
   * Record a wrong password for `accountId` in each of its workspaces, without
   * holding the caller up. Never throws; a write that fails is logged.
   */
  record(input: {
    accountId: string;
    context: (licenseId: bigint) => AuditContext;
    log: FastifyBaseLogger;
  }): void {
    const work: Promise<void> = this.#write(input.accountId, input.context)
      .catch((err: unknown) => {
        input.log.warn({ err }, 'failed to record login failure in audit log');
      })
      .finally(() => {
        this.#pending.delete(work);
      });
    this.#pending.add(work);
  }

  /** Resolves once every entry started so far has been written (or has failed). */
  async idle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.allSettled([...this.#pending]);
  }

  async #write(accountId: string, context: (licenseId: bigint) => AuditContext): Promise<void> {
    // The same SECURITY DEFINER read `/auth/login` lists workspaces with: no
    // tenant context exists yet, and row level security would hide the rows.
    const workspaces = await this.db.$queryRaw<
      Array<{ license_id: bigint; organization_id: string }>
    >`SELECT license_id, organization_id FROM auth_list_memberships(${accountId}::uuid)`;
    for (const workspace of workspaces) {
      const tenant = { licenseId: workspace.license_id, organizationId: workspace.organization_id };
      await withTenant(this.db, tenant, (tx) =>
        writeAuditEntry(tx, context(workspace.license_id), {
          action: 'auth.login_failed',
          target: `account:${accountId}`,
          metadata: { reason: 'invalid_credentials' },
        }),
      );
    }
  }
}
