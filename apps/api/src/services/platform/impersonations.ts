/**
 * "Enter as the customer", the root panel's half (tm 389.15 · FR-ADMIN-21 ·
 * docs/platform-admin/design.md §G).
 *
 * A session names one live member of one workspace, a mode and a window. It is
 * opened here with a one-time handoff code — 32 random bytes, stored only as
 * its digest, good for {@link IMPERSONATION_HANDOFF_TTL_SECONDS} — which the
 * operator's browser trades at the tenant API for a token of the member's
 * (`auth_consume_impersonation_handoff`). Every time is the database's own
 * clock: the trade, the token's resolution and the window all compare against
 * `now()` there, so an application clock that drifts cannot stretch any of them.
 * `started_at` is that clock cut to the millisecond: it is the list's keyset
 * key, and a JavaScript `Date` cursor cannot carry microseconds.
 *
 * Ending one stamps `ended_at`; the tenant API reads that as the revocation of
 * every token the session was traded for, so nothing else has to be written.
 * The tenant API can end one too (the console banner, `auth_end_impersonation`)
 * — `end_reason` says which side did.
 *
 * **A session lasts no longer than its operator's standing (tm 430 · the
 * 2026-11-06 audit's F12).** Disabling an operator, moving them to a role that
 * may not hold a session's mode ({@link mayHoldImpersonation}) or revoking
 * their sessions ends their open sessions in the same transaction
 * ({@link endOperatorImpersonations}, called by `admin-directory.ts`) and
 * revokes the tokens they were traded for; `auth_resolve_token` refuses every
 * token of a disabled operator besides (20261227090000). A session being
 * opened while one of those changes commits re-reads its operator under the
 * operator's row lock ({@link startImpersonation}), so it either sees the
 * change or is committed before the change sweeps — never neither.
 *
 * Nothing here reads a workspace's content: ids, addresses, the
 * organization's name, the mode and the times.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  IMPERSONATION_HANDOFF_TTL_SECONDS,
  IMPERSONATION_MODES,
  isLicenseClosed,
  platformRoleHas,
  type ImpersonationEndReason,
  type ImpersonationMode,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { RevokedCredential } from '../realtime/publisher.js';
import { accountStateError } from './accounts.js';
import { workspaceStateError } from './workspace-actions.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const IMPERSONATION_LIST_DEFAULT = 50;
export const IMPERSONATION_LIST_MAX = 100;

export function isImpersonationId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** One session as the platform API answers it — `PlatformImpersonation`. */
export interface PlatformImpersonation {
  id: string;
  license_id: string;
  organization_name: string | null;
  account_id: string;
  account_email: string | null;
  admin_id: string;
  admin_email: string | null;
  mode: ImpersonationMode;
  started_at: string;
  ends_at: string;
  ended_at: string | null;
  end_reason: ImpersonationEndReason | null;
  active: boolean;
}

const SESSION_INCLUDE = {
  admin: { select: { email: true } },
  account: { select: { email: true } },
  license: { select: { organization: { select: { name: true } } } },
} as const;

type SessionRow = Prisma.PlatformImpersonationSessionGetPayload<{
  include: typeof SESSION_INCLUDE;
}>;

function sessionOf(row: SessionRow, now: Date): PlatformImpersonation {
  return {
    id: row.id,
    license_id: row.licenseId.toString(),
    organization_name: row.license.organization?.name ?? null,
    account_id: row.accountId,
    account_email: row.account.email,
    admin_id: row.adminId,
    admin_email: row.admin.email,
    mode: row.mode as ImpersonationMode,
    started_at: row.startedAt.toISOString(),
    ends_at: row.endsAt.toISOString(),
    ended_at: row.endedAt?.toISOString() ?? null,
    end_reason: (row.endReason as ImpersonationEndReason | null) ?? null,
    active: row.endedAt === null && row.endsAt.getTime() > now.getTime(),
  };
}

type Db = PrismaClient | Prisma.TransactionClient;

/** The database's clock — what every window here is measured against. */
async function databaseNow(db: Db): Promise<Date> {
  const [row] = await db.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now`;
  return row!.now;
}

export async function readImpersonation(db: Db, id: string): Promise<PlatformImpersonation | null> {
  if (!isImpersonationId(id)) return null;
  const [row, now] = await Promise.all([
    db.platformImpersonationSession.findUnique({ where: { id }, include: SESSION_INCLUDE }),
    databaseNow(db),
  ]);
  return row ? sessionOf(row, now) : null;
}

/**
 * Whether an operator of `role` may hold a session of `mode`: what opening one
 * asks of them — `support.impersonate`, and `support.impersonate_full` as well
 * for `full` (`routes/platform/support.ts`). A role change keeps the sessions
 * this still allows and ends the rest (tm 430).
 */
export function mayHoldImpersonation(role: string, mode: ImpersonationMode): boolean {
  return (
    platformRoleHas(role, 'support.impersonate') &&
    (mode !== 'full' || platformRoleHas(role, 'support.impersonate_full'))
  );
}

/** The modes a session of an operator of `role` cannot be held in. */
export function impersonationModesBeyond(role: string): ImpersonationMode[] {
  return IMPERSONATION_MODES.filter((mode) => !mayHoldImpersonation(role, mode));
}

/** Why a change to the operator who opened it ended a session (tm 430). */
export type OperatorImpersonationEndReason = Extract<
  ImpersonationEndReason,
  'operator_disabled' | 'operator_role_changed' | 'operator_sessions_revoked'
>;

/** An open session a change to its operator ended. */
export interface EndedImpersonation {
  id: string;
  licenseId: bigint;
  organizationId: string;
  accountId: string;
  mode: ImpersonationMode;
  endReason: OperatorImpersonationEndReason;
  /** The workspace tokens it had been traded for, revoked with it — for the bus. */
  tokens: RevokedCredential[];
}

/**
 * End `adminId`'s open sessions of these modes inside the caller's transaction
 * — the one that changes the operator — and revoke the tokens each was traded
 * for (tm 430). Open is as {@link endImpersonation} reads it: not ended, window
 * not run out; a session past its window is over already and keeps its empty
 * `end_reason`.
 *
 * Stamping the session would be enough for the tenant API (`auth_resolve_token`
 * reads `ended_at` as every token's revocation); the tokens are revoked as well
 * so the rows say so themselves, and so the caller knows which sockets to
 * close (`principal_revoked`, after the commit). A session still waiting for
 * its handoff code ends with no token; its code can no longer be traded.
 *
 * The caller holds the operator's row lock (it has just updated the row, or
 * locked it) — or the operator was disabled already: {@link startImpersonation}
 * takes the same lock, so a session opened at this moment is committed before
 * this sweep reads, or reads the change and is refused.
 */
export async function endOperatorImpersonations(
  tx: Prisma.TransactionClient,
  adminId: string,
  modes: readonly ImpersonationMode[],
  endReason: OperatorImpersonationEndReason,
): Promise<EndedImpersonation[]> {
  if (modes.length === 0) return [];
  const sessions = await tx.$queryRaw<
    Array<{
      id: string;
      license_id: bigint;
      organization_id: string;
      account_id: string;
      mode: string;
    }>
  >`
    WITH ended AS (
      UPDATE platform_impersonation_sessions
         SET ended_at = now(), end_reason = ${endReason}
       WHERE admin_id = ${adminId}::uuid
         AND ended_at IS NULL
         AND ends_at > now()
         AND mode = ANY(${[...modes]}::text[])
      RETURNING id, license_id, account_id, mode
    )
    SELECT e.id::text AS id, e.license_id, l.organization_id::text AS organization_id,
           e.account_id::text AS account_id, e.mode
      FROM ended e
      JOIN licenses l ON l.id = e.license_id
     ORDER BY e.license_id, e.id`;
  if (sessions.length === 0) return [];

  const tokens = await tx.$queryRaw<
    Array<{ id: string; session_id: string; license_id: bigint; organization_id: string }>
  >`
    UPDATE api_tokens SET revoked_at = now()
     WHERE impersonation_session_id = ANY(${sessions.map((s) => s.id)}::uuid[])
       AND revoked_at IS NULL
    RETURNING id::text AS id, impersonation_session_id::text AS session_id, license_id,
              organization_id::text AS organization_id`;

  return sessions.map((session) => ({
    id: session.id,
    licenseId: session.license_id,
    organizationId: session.organization_id,
    accountId: session.account_id,
    mode: session.mode as ImpersonationMode,
    endReason,
    tokens: tokens
      .filter((token) => token.session_id === session.id)
      .map((token) => ({
        id: token.id,
        licenseId: token.license_id,
        organizationId: token.organization_id,
      })),
  }));
}

export interface StartImpersonationInput {
  adminId: string;
  /**
   * The root panel session the request came in on — still there under the
   * operator's row lock, or the operator's sessions were revoked meanwhile.
   */
  platformSessionId: string;
  licenseId: bigint;
  accountId: string;
  mode: ImpersonationMode;
  /** `PLATFORM_IMPERSONATION_TTL`, seconds. */
  ttlS: number;
  /** The digest of the handoff code — the code itself never comes here. */
  codeHash: string;
}

export interface StartedImpersonation {
  session: PlatformImpersonation;
  handoffExpiresAt: Date;
  /** The workspace's Founders, for the notice — after the commit. */
  owners: Array<{ email: string; locale: string | null }>;
  organizationName: string;
  memberEmail: string;
}

/**
 * Open a session, inside the caller's transaction (its audit entries commit
 * with it). Refuses a workspace the tenant API would refuse to serve, a
 * person who is not a live member of it, and a person the root panel
 * suspended — each of which would only mint a token that dies on its first
 * request.
 *
 * First of all it reads the operator again, under their row lock (tm 430):
 * the request's gate read them before the transaction, and a disable, a role
 * change or a revocation of their sessions committing in between would
 * otherwise sweep the operator's sessions before this one exists and leave it
 * open. `FOR SHARE` waits for such a change and then reads what it wrote; a
 * change that comes later waits for this commit, and its sweep ends this
 * session with the others.
 */
export async function startImpersonation(
  tx: Prisma.TransactionClient,
  input: StartImpersonationInput,
): Promise<StartedImpersonation> {
  await assertOperatorStands(tx, input);

  const license = await tx.license.findUnique({
    where: { id: input.licenseId },
    select: { status: true, organization: { select: { name: true } } },
  });
  if (!license) throw ApiError.notFound('Workspace not found.');
  if (isLicenseClosed(license.status)) {
    throw workspaceStateError(
      'workspace_closed',
      'This workspace is suspended or cancelled: nobody can sign in to it, so nobody can be entered as.',
    );
  }

  const membership = await tx.agentMembership.findUnique({
    where: { licenseId_agentId: { licenseId: input.licenseId, agentId: input.accountId } },
    select: {
      suspended: true,
      awaitingApproval: true,
      agent: { select: { email: true, platformSuspendedAt: true } },
    },
  });
  if (!membership || membership.suspended || membership.awaitingApproval) {
    throw ApiError.notFound('That person is not a member of this workspace.');
  }
  if (membership.agent.platformSuspendedAt !== null) {
    throw accountStateError(
      'account_suspended',
      'This person is suspended by SiyahTuş: lift the suspension before entering as them.',
    );
  }

  const [created] = await tx.$queryRaw<Array<{ id: string; handoff_expires_at: Date }>>`
    WITH clock AS (SELECT date_trunc('milliseconds', now()) AS at)
    INSERT INTO platform_impersonation_sessions
      (id, admin_id, license_id, account_id, mode, handoff_code_hash, handoff_expires_at,
       started_at, ends_at)
    SELECT gen_random_uuid(), ${input.adminId}::uuid, ${input.licenseId}, ${input.accountId}::uuid,
           ${input.mode}, ${input.codeHash},
           clock.at + make_interval(secs => ${IMPERSONATION_HANDOFF_TTL_SECONDS}),
           clock.at, clock.at + make_interval(secs => ${input.ttlS})
      FROM clock
    RETURNING id, handoff_expires_at`;

  const owners = await tx.agentMembership.findMany({
    where: { licenseId: input.licenseId, role: 'owner', suspended: false },
    select: { locale: true, agent: { select: { email: true } } },
    orderBy: { agentId: 'asc' },
  });

  const session = await readImpersonation(tx, created!.id);
  return {
    session: session!,
    handoffExpiresAt: created!.handoff_expires_at,
    owners: owners.map((owner) => ({ email: owner.agent.email, locale: owner.locale })),
    organizationName: license.organization?.name ?? '',
    memberEmail: membership.agent.email,
  };
}

/**
 * The operator opening a session still holds what it needs: not disabled, a
 * role that may hold the mode, and the session the request came in on. Two
 * statements on purpose — the row lock first, then the sessions with a
 * snapshot taken after it was granted: in one statement the subquery would
 * read the snapshot from before the wait, and miss a revocation that
 * committed during it.
 */
async function assertOperatorStands(
  tx: Prisma.TransactionClient,
  input: StartImpersonationInput,
): Promise<void> {
  const [operator] = await tx.$queryRaw<Array<{ role: string; disabled: boolean }>>`
    SELECT role, disabled_at IS NOT NULL AS disabled
      FROM platform_admins
     WHERE id = ${input.adminId}::uuid
       FOR SHARE`;
  const [signedIn] = operator
    ? await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id FROM platform_sessions
         WHERE id = ${input.platformSessionId}::uuid AND admin_id = ${input.adminId}::uuid`
    : [];
  if (!operator || operator.disabled || !signedIn) {
    throw ApiError.authentication('Your session has ended. Sign in again.');
  }
  if (!mayHoldImpersonation(operator.role, input.mode)) {
    throw ApiError.authorization('Your operator role does not allow this session.', {
      permission: input.mode === 'full' ? 'support.impersonate_full' : 'support.impersonate',
    });
  }
}

/**
 * Close a session from the root panel, inside the caller's transaction. A
 * session already over — ended from either side, or past its window — is
 * `unchanged` and records nothing.
 */
export async function endImpersonation(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<{ unchanged: boolean; session: PlatformImpersonation }> {
  if (!isImpersonationId(id)) throw ApiError.notFound('Impersonation session not found.');
  const [locked] = await tx.$queryRaw<Array<{ id: string; open: boolean }>>`
    SELECT id, (ended_at IS NULL AND ends_at > now()) AS open
      FROM platform_impersonation_sessions
     WHERE id = ${id}::uuid
       FOR UPDATE`;
  if (!locked) throw ApiError.notFound('Impersonation session not found.');
  if (locked.open) {
    const reason: ImpersonationEndReason = 'ended_by_operator';
    await tx.$executeRaw`
      UPDATE platform_impersonation_sessions
         SET ended_at = now(), end_reason = ${reason}
       WHERE id = ${id}::uuid`;
  }
  const session = await readImpersonation(tx, id);
  return { unchanged: !locked.open, session: session! };
}

export class ImpersonationCursorError extends Error {}

function encodeCursor(row: { startedAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.startedAt.toISOString(), row.id]), 'utf8').toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): { startedAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [at, id] = parsed as [unknown, unknown];
      const startedAt = typeof at === 'string' ? new Date(at) : null;
      if (startedAt && !Number.isNaN(startedAt.getTime()) && isImpersonationId(id)) {
        return { startedAt, id };
      }
    }
  } catch {
    // Falls through to the refusal below.
  }
  throw new ImpersonationCursorError('not a cursor of this list');
}

export interface ImpersonationListFilter {
  /** Open sessions only: not ended, window not run out. */
  active?: boolean;
  licenseId?: bigint;
  cursor?: string;
  limit?: number;
}

/** Newest first; keyset on (started_at, id). */
export async function listImpersonations(
  db: PrismaClient,
  filter: ImpersonationListFilter,
): Promise<{ data: PlatformImpersonation[]; next_cursor: string | null }> {
  const limit = Math.min(
    Math.max(1, Math.floor(filter.limit ?? IMPERSONATION_LIST_DEFAULT)),
    IMPERSONATION_LIST_MAX,
  );
  const after = filter.cursor ? decodeCursor(filter.cursor) : null;
  const now = await databaseNow(db);
  const rows = await db.platformImpersonationSession.findMany({
    where: {
      ...(filter.licenseId !== undefined ? { licenseId: filter.licenseId } : {}),
      ...(filter.active ? { endedAt: null, endsAt: { gt: now } } : {}),
      ...(after
        ? {
            OR: [
              { startedAt: { lt: after.startedAt } },
              { startedAt: after.startedAt, id: { lt: after.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: SESSION_INCLUDE,
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    data: page.map((row) => sessionOf(row, now)),
    next_cursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}
