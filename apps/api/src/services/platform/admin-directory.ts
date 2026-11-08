/**
 * Operator management for the root panel (tm 389.4 · FR-ADMIN-03/04).
 *
 * Operators are never deleted — they are disabled, so every attribution
 * (`invited_by`, the platform audit chain's `admin_id`) keeps pointing at
 * somebody. The only ways in are the bootstrap CLI (the first superadmin,
 * `bootstrap-admin.ts`) and an invitation accepted with a password and an
 * authenticator (`admin-auth.ts acceptInvite`).
 *
 * **The last active superadmin stays.** Disabling them, or moving them to
 * another role, would leave a deployment nobody can administer except through
 * psql — the gap this panel exists to close. The check and the change run in
 * one transaction under one advisory lock, so two superadmins demoting each
 * other at the same moment cannot both pass a count that each read before the
 * other's change.
 *
 * Every mutation here ends the target's sessions when it changes what those
 * sessions may do (disable, role, second-factor reset): the next request signs
 * in again under the new facts rather than finishing its shift under the old.
 *
 * **And what they opened as a member (tm 430 · the 2026-11-06 audit's F12).**
 * Disabling an operator, revoking their sessions, or moving them to a role
 * that may not hold a session's mode ends their open impersonation sessions
 * and revokes the workspace tokens those were traded for, in the same
 * transaction (`impersonations.ts endOperatorImpersonations`) — a disabled
 * superadmin's `full` session no longer outlives them by its window. A role
 * change ends only what the new role may not hold: superadmin → support keeps
 * a read-only session and ends a full one. The route records each ended
 * session in both trails inside that transaction ({@link OperatorChangeRecorder})
 * and closes its sockets after the commit.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { IMPERSONATION_MODES, type PlatformRole } from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { generateToken, hashToken } from '../../lib/crypto.js';
import { PLATFORM_INVITE_TTL_HOURS } from './admin-auth.js';
import {
  endOperatorImpersonations,
  impersonationModesBeyond,
  type EndedImpersonation,
} from './impersonations.js';

/** `pg_advisory_xact_lock` key for every change that can reduce the superadmin count. */
const SUPERADMIN_LOCK = 'siyahtus:platform:superadmins';

export interface PlatformAdminView {
  id: string;
  email: string;
  role: string;
  totp_enrolled: boolean;
  totp_enrolled_at: string | null;
  disabled_at: string | null;
  invited_by: string | null;
  created_at: string;
  /** Sessions that have not run out — the "signed in" indicator. */
  active_sessions: number;
  last_seen_at: string | null;
}

export interface PlatformInviteView {
  id: string;
  email: string;
  role: string;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
}

export interface CreatedInvite {
  invite: PlatformInviteView;
  /** The plain token — mailed, and returned only when the mail did not go. */
  token: string;
}

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

function lastSuperadmin(): ApiError {
  return new ApiError(
    'platform_last_superadmin',
    'This would leave the platform without an active superadmin. Promote or enable another one first.',
  );
}

export interface DirectoryOptions {
  now: () => number;
  idleTtlS: number;
}

/** What a disable, a role change or a revocation of sessions did (tm 430). */
export interface OperatorChange {
  /** The operator's role before the change — the role after, unless it changed it. */
  previousRole: string;
  /** Root panel sessions it deleted. */
  sessionsEnded: number;
  /** The operator's open impersonation sessions it ended, with the tokens it revoked. */
  impersonations: EndedImpersonation[];
}

/**
 * The route's audit entries for a change, written inside the change's
 * transaction: an ended impersonation session's workspace trail must commit
 * with the session's end, or neither (`platform-audit.ts`).
 */
export type OperatorChangeRecorder = (
  tx: Prisma.TransactionClient,
  change: OperatorChange,
) => Promise<void>;

export interface OperatorChangeResult extends OperatorChange {
  admin: PlatformAdminView;
}

export class PlatformAdminDirectory {
  readonly #db: PrismaClient;
  readonly #options: DirectoryOptions;

  constructor(db: PrismaClient, options: DirectoryOptions) {
    this.#db = db;
    this.#options = options;
  }

  async list(): Promise<PlatformAdminView[]> {
    const admins = await this.#db.platformAdmin.findMany({ orderBy: { createdAt: 'asc' } });
    const sessions = await this.#liveSessions(admins.map((a) => a.id));
    return admins.map((admin) => this.#view(admin, sessions.get(admin.id)));
  }

  async get(adminId: string): Promise<PlatformAdminView> {
    const admin = await this.#db.platformAdmin.findUnique({ where: { id: adminId } });
    if (!admin) throw ApiError.notFound('Operator not found.');
    const sessions = await this.#liveSessions([admin.id]);
    return this.#view(admin, sessions.get(admin.id));
  }

  // --- Invitations -----------------------------------------------------------

  async listInvites(): Promise<PlatformInviteView[]> {
    const rows = await this.#db.platformAdminInvite.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date(this.#options.now()) } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(inviteView);
  }

  /**
   * A 72-hour, single-use invitation for `email` with `role`. An address that
   * already belongs to an operator is refused (re-enable them instead); an
   * earlier pending invitation for the same address is withdrawn, so only the
   * newest link works.
   */
  async invite(input: {
    email: string;
    role: PlatformRole;
    invitedBy: string;
  }): Promise<CreatedInvite> {
    const now = new Date(this.#options.now());
    const token = generateToken();
    const row = await this.#db.$transaction(async (tx) => {
      const existing = await tx.platformAdmin.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      if (existing) {
        throw new ApiError('account_exists', 'An operator with this address already exists.');
      }
      // No revoked_at column: a withdrawn invitation is one that has expired.
      await tx.platformAdminInvite.updateMany({
        where: { email: input.email, acceptedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now },
      });
      return tx.platformAdminInvite.create({
        data: {
          email: input.email,
          role: input.role,
          tokenHash: hashToken(token),
          invitedBy: input.invitedBy,
          createdAt: now,
          expiresAt: new Date(now.getTime() + PLATFORM_INVITE_TTL_HOURS * 3_600_000),
        },
      });
    });
    return { invite: inviteView(row), token };
  }

  async revokeInvite(inviteId: string): Promise<void> {
    const now = new Date(this.#options.now());
    const { count } = await this.#db.platformAdminInvite.updateMany({
      where: { id: inviteId, acceptedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
    if (count === 0) throw ApiError.notFound('No pending invitation with that id.');
  }

  // --- Changes to an operator ------------------------------------------------

  /**
   * A role the operator already holds changes nothing. Any other ends their
   * root panel sessions, and those of their impersonation sessions whose mode
   * the new role may not hold (`mayHoldImpersonation`).
   */
  async setRole(
    adminId: string,
    role: PlatformRole,
    record?: OperatorChangeRecorder,
  ): Promise<OperatorChangeResult> {
    const change = await this.#guarded(
      adminId,
      async (tx, admin, activeSuperadmins) => {
        const unchanged: OperatorChange = {
          previousRole: admin.role,
          sessionsEnded: 0,
          impersonations: [],
        };
        if (admin.role === role) return unchanged;
        if (admin.role === 'superadmin' && admin.disabledAt === null && activeSuperadmins <= 1) {
          throw lastSuperadmin();
        }
        await tx.platformAdmin.update({ where: { id: adminId }, data: { role } });
        const sessions = await tx.platformSession.deleteMany({ where: { adminId } });
        return {
          ...unchanged,
          sessionsEnded: sessions.count,
          impersonations: await endOperatorImpersonations(
            tx,
            adminId,
            impersonationModesBeyond(role),
            'operator_role_changed',
          ),
        };
      },
      record,
    );
    return { ...change, admin: await this.get(adminId) };
  }

  /**
   * Disabling a disabled operator changes nothing about them, and still ends
   * whatever they have open: an operator disabled some other way (psql) keeps
   * no session that only `auth_resolve_token` stands in front of. That sweep
   * needs no row lock — a session being opened for a disabled operator reads
   * `disabled_at` under its own and is refused.
   */
  async disable(adminId: string, record?: OperatorChangeRecorder): Promise<OperatorChangeResult> {
    const change = await this.#guarded(
      adminId,
      async (tx, admin, activeSuperadmins) => {
        if (admin.disabledAt === null) {
          if (admin.role === 'superadmin' && activeSuperadmins <= 1) throw lastSuperadmin();
          await tx.platformAdmin.update({
            where: { id: adminId },
            data: { disabledAt: new Date(this.#options.now()) },
          });
        }
        const sessions = await tx.platformSession.deleteMany({ where: { adminId } });
        return {
          previousRole: admin.role,
          sessionsEnded: sessions.count,
          impersonations: await endOperatorImpersonations(
            tx,
            adminId,
            IMPERSONATION_MODES,
            'operator_disabled',
          ),
        };
      },
      record,
    );
    return { ...change, admin: await this.get(adminId) };
  }

  async enable(adminId: string): Promise<PlatformAdminView> {
    const { count } = await this.#db.platformAdmin.updateMany({
      where: { id: adminId },
      data: { disabledAt: null },
    });
    if (count === 0) throw ApiError.notFound('Operator not found.');
    return this.get(adminId);
  }

  /**
   * Remove the operator's authenticator and recovery sheet. Their next
   * sign-in is a password-stage session that can only enroll a new one.
   */
  async resetTwoFactor(adminId: string): Promise<PlatformAdminView> {
    await this.#db.$transaction(async (tx) => {
      const { count } = await tx.platformAdmin.updateMany({
        where: { id: adminId },
        data: { totpSecretCiphertext: null, totpEnrolledAt: null, totpLastUsedStep: null },
      });
      if (count === 0) throw ApiError.notFound('Operator not found.');
      await tx.platformAdminRecoveryCode.deleteMany({ where: { adminId } });
      await tx.platformSession.deleteMany({ where: { adminId } });
    });
    return this.get(adminId);
  }

  /**
   * Sign the operator out everywhere: their root panel sessions and their open
   * impersonation sessions. The operator's row is locked first — it is the
   * lock a session being opened at this moment takes too.
   */
  async revokeSessions(adminId: string, record?: OperatorChangeRecorder): Promise<OperatorChange> {
    return this.#db.$transaction(
      async (tx) => {
        const admin = await this.#lockOperator(tx, adminId);
        const sessions = await tx.platformSession.deleteMany({ where: { adminId } });
        const change: OperatorChange = {
          previousRole: admin.role,
          sessionsEnded: sessions.count,
          impersonations: await endOperatorImpersonations(
            tx,
            adminId,
            IMPERSONATION_MODES,
            'operator_sessions_revoked',
          ),
        };
        await record?.(tx, change);
        return change;
      },
      { timeout: 30_000 },
    );
  }

  // --- Internals -------------------------------------------------------------

  /**
   * Run a change that can lower the active-superadmin count, with the count
   * read under the same lock the change commits under — and then `record`, in
   * the same transaction.
   */
  async #guarded(
    adminId: string,
    change: (
      tx: Prisma.TransactionClient,
      admin: { role: string; disabledAt: Date | null },
      activeSuperadmins: number,
    ) => Promise<OperatorChange>,
    record?: OperatorChangeRecorder,
  ): Promise<OperatorChange> {
    return this.#db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SUPERADMIN_LOCK}))`;
        const admin = await tx.platformAdmin.findUnique({
          where: { id: adminId },
          select: { role: true, disabledAt: true },
        });
        if (!admin) throw ApiError.notFound('Operator not found.');
        const activeSuperadmins = await tx.platformAdmin.count({
          where: { role: 'superadmin', disabledAt: null },
        });
        const changed = await change(tx, admin, activeSuperadmins);
        await record?.(tx, changed);
        return changed;
      },
      { timeout: 30_000 },
    );
  }

  /**
   * The operator's row, locked against a session being opened in their name
   * (`impersonations.ts startImpersonation` reads it `FOR SHARE`) — or 404.
   */
  async #lockOperator(tx: Prisma.TransactionClient, adminId: string): Promise<{ role: string }> {
    const [admin] = await tx.$queryRaw<Array<{ role: string }>>`
      SELECT role FROM platform_admins WHERE id = ${adminId}::uuid FOR NO KEY UPDATE`;
    if (!admin) throw ApiError.notFound('Operator not found.');
    return admin;
  }

  async #liveSessions(
    adminIds: string[],
  ): Promise<Map<string, { count: number; lastSeenAt: Date | null }>> {
    const out = new Map<string, { count: number; lastSeenAt: Date | null }>();
    if (adminIds.length === 0) return out;
    const now = this.#options.now();
    const rows = await this.#db.platformSession.findMany({
      where: {
        adminId: { in: adminIds },
        expiresAt: { gt: new Date(now) },
        lastSeenAt: { gt: new Date(now - this.#options.idleTtlS * 1000) },
      },
      select: { adminId: true, lastSeenAt: true },
    });
    for (const row of rows) {
      const entry = out.get(row.adminId) ?? { count: 0, lastSeenAt: null };
      entry.count += 1;
      if (!entry.lastSeenAt || row.lastSeenAt > entry.lastSeenAt) entry.lastSeenAt = row.lastSeenAt;
      out.set(row.adminId, entry);
    }
    return out;
  }

  #view(
    admin: {
      id: string;
      email: string;
      role: string;
      totpEnrolledAt: Date | null;
      disabledAt: Date | null;
      invitedBy: string | null;
      createdAt: Date;
    },
    sessions: { count: number; lastSeenAt: Date | null } | undefined,
  ): PlatformAdminView {
    return {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      totp_enrolled: admin.totpEnrolledAt !== null,
      totp_enrolled_at: iso(admin.totpEnrolledAt),
      disabled_at: iso(admin.disabledAt),
      invited_by: admin.invitedBy,
      created_at: admin.createdAt.toISOString(),
      active_sessions: sessions?.count ?? 0,
      last_seen_at: iso(sessions?.lastSeenAt ?? null),
    };
  }
}

function inviteView(row: {
  id: string;
  email: string;
  role: string;
  invitedBy: string | null;
  createdAt: Date;
  expiresAt: Date;
}): PlatformInviteView {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    invited_by: row.invitedBy,
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
  };
}
