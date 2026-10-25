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
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { PlatformRole } from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { generateToken, hashToken } from '../../lib/crypto.js';
import { PLATFORM_INVITE_TTL_HOURS } from './admin-auth.js';

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

  async setRole(adminId: string, role: PlatformRole): Promise<PlatformAdminView> {
    await this.#guarded(adminId, async (tx, admin, activeSuperadmins) => {
      if (admin.role === role) return;
      if (admin.role === 'superadmin' && admin.disabledAt === null && activeSuperadmins <= 1) {
        throw lastSuperadmin();
      }
      await tx.platformAdmin.update({ where: { id: adminId }, data: { role } });
      await tx.platformSession.deleteMany({ where: { adminId } });
    });
    return this.get(adminId);
  }

  async disable(adminId: string): Promise<PlatformAdminView> {
    await this.#guarded(adminId, async (tx, admin, activeSuperadmins) => {
      if (admin.disabledAt !== null) return;
      if (admin.role === 'superadmin' && activeSuperadmins <= 1) throw lastSuperadmin();
      await tx.platformAdmin.update({
        where: { id: adminId },
        data: { disabledAt: new Date(this.#options.now()) },
      });
      await tx.platformSession.deleteMany({ where: { adminId } });
    });
    return this.get(adminId);
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

  async revokeSessions(adminId: string): Promise<number> {
    const admin = await this.#db.platformAdmin.findUnique({
      where: { id: adminId },
      select: { id: true },
    });
    if (!admin) throw ApiError.notFound('Operator not found.');
    const { count } = await this.#db.platformSession.deleteMany({ where: { adminId } });
    return count;
  }

  // --- Internals -------------------------------------------------------------

  /**
   * Run a change that can lower the active-superadmin count, with the count
   * read under the same lock the change commits under.
   */
  async #guarded(
    adminId: string,
    change: (
      tx: Prisma.TransactionClient,
      admin: { role: string; disabledAt: Date | null },
      activeSuperadmins: number,
    ) => Promise<void>,
  ): Promise<void> {
    await this.#db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SUPERADMIN_LOCK}))`;
      const admin = await tx.platformAdmin.findUnique({
        where: { id: adminId },
        select: { role: true, disabledAt: true },
      });
      if (!admin) throw ApiError.notFound('Operator not found.');
      const activeSuperadmins = await tx.platformAdmin.count({
        where: { role: 'superadmin', disabledAt: null },
      });
      await change(tx, admin, activeSuperadmins);
    });
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
