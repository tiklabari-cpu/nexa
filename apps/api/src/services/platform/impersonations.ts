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
 * Nothing here reads a workspace's content: ids, addresses, the
 * organization's name, the mode and the times.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  IMPERSONATION_HANDOFF_TTL_SECONDS,
  isLicenseClosed,
  type ImpersonationEndReason,
  type ImpersonationMode,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
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

export interface StartImpersonationInput {
  adminId: string;
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
 */
export async function startImpersonation(
  tx: Prisma.TransactionClient,
  input: StartImpersonationInput,
): Promise<StartedImpersonation> {
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
