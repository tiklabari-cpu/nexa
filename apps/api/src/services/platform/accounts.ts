/**
 * The root panel's accounts (tm 389.11 · FR-ADMIN-11 · design.md §C accounts) —
 * the person behind one or more memberships: an operator who cannot sign in,
 * a lost authenticator, a request to be forgotten.
 *
 * An account is not a workspace. It may belong to several, so an action on it
 * reaches all of them: the route records one platform entry and the tenant
 * half in every workspace the person belongs to (`PlatformAuditEntry.workspaces`).
 *
 * The actions follow `workspace-actions.ts`'s three rules: each runs inside the
 * caller's transaction with its audit entries, **locks the account row first**
 * (`FOR UPDATE` — nothing holds a key-share lock on an account for long, unlike
 * a licence), and is **idempotent** (asking for what is already so answers
 * `unchanged: true` and records nothing). A state that refuses an action is 409
 * `platform_account_state` with a `details.reason`.
 *
 * What leaves this module about a person is their profile, their memberships
 * and counts — never a workspace's content, never a token or its hash, never
 * the operator's reason for a suspension in anything the person receives.
 *
 * Runs as `siyahtus_platform` (BYPASSRLS): every statement names its account.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from '../../lib/api-error.js';

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

export const ACCOUNT_LIST_DEFAULT = 25;
export const ACCOUNT_LIST_MAX = 50;

/** Why an account's state refused an action — `details.reason` of the 409. */
export const ACCOUNT_STATE_REASONS = [
  /** The account is the Founder of a workspace: transfer the ownership first. */
  'account_is_sole_owner',
] as const;
export type AccountStateReason = (typeof ACCOUNT_STATE_REASONS)[number];

export function accountStateError(
  reason: AccountStateReason,
  message: string,
  details: Record<string, unknown> = {},
): ApiError {
  return new ApiError('platform_account_state', message, { details: { reason, ...details } });
}

/** What an action did — `payload` lands in the audit entry when something changed. */
export interface AccountActionOutcome {
  unchanged: boolean;
  payload: Record<string, unknown>;
  /** Every workspace the account belongs to — each gets the tenant half of the entry. */
  workspaces: bigint[];
}

export class AccountCursorError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAccountId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

const iso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null;

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(1, Math.floor(value)), max);
}

/** `LIKE` treats `%`, `_` and the escape itself as patterns; a typed prefix means them literally. */
function likePrefix(value: string): string {
  return `${value.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// --- Search ------------------------------------------------------------------

export interface PlatformAccountSummary {
  id: string;
  email: string;
  name: string;
  created_at: string;
  email_verified_at: string | null;
  platform_suspended_at: string | null;
  membership_count: number;
}

interface SummaryRow {
  id: string;
  email: string;
  name: string;
  created_at: Date;
  email_verified_at: Date | null;
  platform_suspended_at: Date | null;
  membership_count: bigint;
}

function encodeCursor(email: string): string {
  return Buffer.from(JSON.stringify({ e: email }), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): string {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    const email = (parsed as { e?: unknown } | null)?.e;
    if (typeof email === 'string' && email.length > 0 && email.length <= 320) return email;
  } catch {
    // fall through
  }
  throw new AccountCursorError('not a cursor of this list');
}

/**
 * Accounts by address or name, alphabetically by address, keyset on it (the
 * address is unique). `q` matches an address exactly (citext `=`, the unique
 * index) or as a prefix, a name as a prefix, or an id exactly — prefixes, not
 * substrings, so the scan is bounded by what was typed rather than the table.
 */
export async function searchAccounts(
  db: Db,
  options: { q?: string; cursor?: string; limit?: number },
): Promise<{ data: PlatformAccountSummary[]; next_cursor: string | null }> {
  const limit = clamp(options.limit, ACCOUNT_LIST_DEFAULT, ACCOUNT_LIST_MAX);
  const after = options.cursor ? decodeCursor(options.cursor) : null;
  const q = options.q?.trim() ?? '';
  const prefix = likePrefix(q);
  const id = isAccountId(q) ? q : null;
  const rows = await db.$queryRaw<SummaryRow[]>`
    SELECT a.id, a.email::text AS email, a.name, a.created_at, a.email_verified_at,
           a.platform_suspended_at,
           (SELECT count(*) FROM agent_memberships m WHERE m.agent_id = a.id) AS membership_count
      FROM accounts a
     WHERE (${q} = ''
            OR a.email = ${q}::citext
            OR lower(a.email::text) LIKE ${prefix}
            OR lower(a.name) LIKE ${prefix}
            OR a.id = ${id}::uuid)
       AND (${after}::citext IS NULL OR a.email > ${after}::citext)
     ORDER BY a.email
     LIMIT ${limit + 1}`;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    data: page.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      created_at: row.created_at.toISOString(),
      email_verified_at: iso(row.email_verified_at),
      platform_suspended_at: iso(row.platform_suspended_at),
      membership_count: Number(row.membership_count),
    })),
    next_cursor: rows.length > limit && last ? encodeCursor(last.email) : null,
  };
}

// --- Detail ------------------------------------------------------------------

export interface PlatformAccountMembership {
  license_id: string;
  organization_name: string;
  role: string;
  suspended: boolean;
  awaiting_approval: boolean;
  license_status: string;
  sandbox: boolean;
  two_factor_required: boolean;
  joined_at: string;
}

export interface PlatformAccountDetail {
  id: string;
  email: string;
  name: string;
  created_at: string;
  email_verified_at: string | null;
  last_seen_at: string | null;
  /** When a session was last opened for it — the newest sign-in token. */
  last_sign_in_at: string | null;
  password_set: boolean;
  platform_suspended_at: string | null;
  platform_suspended_reason: string | null;
  two_factor: { enabled: boolean; enabled_at: string | null; recovery_codes_left: number };
  /** Live credentials — counts, never the tokens. */
  credentials: { sessions: number; personal_tokens: number };
  memberships: PlatformAccountMembership[];
}

/** The account row and the facts the panel shows about it, or null when there is none. */
export async function accountDetail(
  db: Db,
  accountId: string,
  now: Date,
): Promise<PlatformAccountDetail | null> {
  if (!isAccountId(accountId)) return null;
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      emailVerifiedAt: true,
      lastSeenAt: true,
      passwordHash: true,
      platformSuspendedAt: true,
      platformSuspendedReason: true,
      twoFactor: { select: { activatedAt: true } },
    },
  });
  if (!account) return null;

  const live = {
    ownerId: accountId,
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
  const [memberships, recoveryLeft, sessions, personal, lastSession] = await Promise.all([
    db.$queryRaw<
      Array<{
        license_id: bigint;
        organization_name: string;
        role: string;
        suspended: boolean;
        awaiting_approval: boolean;
        license_status: string;
        sandbox: boolean;
        two_factor_required: boolean;
        joined_at: Date;
      }>
    >`
      SELECT m.license_id, o.name AS organization_name, m.role, m.suspended, m.awaiting_approval,
             l.status AS license_status, l.sandbox_of_license_id IS NOT NULL AS sandbox,
             EXISTS (SELECT 1 FROM security_settings ss
                      WHERE ss.license_id = m.license_id AND ss.require_two_factor)
               AS two_factor_required,
             m.created_at AS joined_at
        FROM agent_memberships m
        JOIN licenses l ON l.id = m.license_id
        JOIN organizations o ON o.id = l.organization_id
       WHERE m.agent_id = ${accountId}::uuid
       ORDER BY m.license_id`,
    db.twoFactorRecoveryCode.count({ where: { accountId, usedAt: null } }),
    db.apiToken.count({ where: { ...live, kind: 'oauth' } }),
    db.apiToken.count({ where: { ...live, kind: 'pat' } }),
    db.apiToken.findFirst({
      where: { ownerId: accountId, kind: 'oauth' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);
  const enabled = account.twoFactor?.activatedAt != null;
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    created_at: account.createdAt.toISOString(),
    email_verified_at: iso(account.emailVerifiedAt),
    last_seen_at: iso(account.lastSeenAt),
    last_sign_in_at: iso(lastSession?.createdAt),
    password_set: account.passwordHash !== null,
    platform_suspended_at: iso(account.platformSuspendedAt),
    platform_suspended_reason: account.platformSuspendedReason,
    two_factor: {
      enabled,
      enabled_at: enabled ? iso(account.twoFactor?.activatedAt) : null,
      recovery_codes_left: enabled ? recoveryLeft : 0,
    },
    credentials: { sessions, personal_tokens: personal },
    memberships: memberships.map((row) => ({
      license_id: row.license_id.toString(),
      organization_name: row.organization_name,
      role: row.role,
      suspended: row.suspended,
      awaiting_approval: row.awaiting_approval,
      license_status: row.license_status,
      sandbox: row.sandbox,
      two_factor_required: row.two_factor_required,
      joined_at: row.joined_at.toISOString(),
    })),
  };
}

// --- Actions -----------------------------------------------------------------

interface LockedAccount {
  id: string;
  email: string;
  email_verified_at: Date | null;
  platform_suspended_at: Date | null;
}

/** The account, locked for this transaction, and its workspaces — or 404. */
async function lockAccount(
  tx: Tx,
  accountId: string,
): Promise<{ account: LockedAccount; workspaces: bigint[] }> {
  if (!isAccountId(accountId)) throw ApiError.notFound('Account not found.');
  const [account] = await tx.$queryRaw<LockedAccount[]>`
    SELECT id, email::text AS email, email_verified_at, platform_suspended_at
      FROM accounts WHERE id = ${accountId}::uuid FOR UPDATE`;
  if (!account) throw ApiError.notFound('Account not found.');
  const memberships = await tx.agentMembership.findMany({
    where: { agentId: accountId },
    orderBy: { licenseId: 'asc' },
    select: { licenseId: true },
  });
  return { account, workspaces: memberships.map((m) => m.licenseId) };
}

const outcome = (
  workspaces: bigint[],
  changed: boolean,
  payload: Record<string, unknown> = {},
): AccountActionOutcome => ({ unchanged: !changed, payload, workspaces });

/**
 * End every session the account holds: the access tokens a sign-in minted,
 * the enrolment tickets a password opened, and every refresh token, in every
 * workspace — what `auth_revoke_refresh_family` does to one family, for all of
 * them at once. Personal access tokens are not sessions and stay.
 */
async function endSessions(tx: Tx, accountId: string, now: Date): Promise<number> {
  const access = await tx.apiToken.updateMany({
    where: { ownerId: accountId, kind: { in: ['oauth', 'enrollment'] }, revokedAt: null },
    data: { revokedAt: now },
  });
  const refresh = await tx.oauthRefreshToken.updateMany({
    where: { accountId, revokedAt: null },
    data: { revokedAt: now },
  });
  return access.count + refresh.count;
}

/** Where the mail to this person goes, and in which language. */
export interface AccountMailTarget {
  email: string;
  locale: string | null;
}

async function mailTarget(tx: Tx, account: LockedAccount): Promise<AccountMailTarget> {
  const membership = await tx.agentMembership.findFirst({
    where: { agentId: account.id, locale: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { locale: true },
  });
  return { email: account.email, locale: membership?.locale ?? null };
}

/**
 * Spend the account's earlier verification link and record a new one — the
 * person's own resend (`auth_issue_email_verification`). A verified address
 * is `unchanged`: there is nothing to prove.
 */
export async function issueVerification(
  tx: Tx,
  accountId: string,
  link: { hash: string; expiresAt: Date },
): Promise<AccountActionOutcome & { mailTo: AccountMailTarget | null }> {
  const { account, workspaces } = await lockAccount(tx, accountId);
  if (account.email_verified_at !== null) {
    return { ...outcome(workspaces, false), mailTo: null };
  }
  const [row] = await tx.$queryRaw<Array<{ recorded_account: string | null }>>`
    SELECT recorded_account
      FROM auth_issue_email_verification(${account.email}::citext, ${link.hash}, ${link.expiresAt})`;
  if (!row?.recorded_account) return { ...outcome(workspaces, false), mailTo: null };
  return { ...outcome(workspaces, true), mailTo: await mailTarget(tx, account) };
}

/**
 * End every session and mail a reset link (`auth_request_password_reset`, the
 * person's own "forgot password"): whoever holds the password now is out, and
 * only the mailbox's owner gets back in. The password itself is untouched
 * until the link is used — which also ends the personal tokens it opened.
 */
export async function forcePasswordReset(
  tx: Tx,
  accountId: string,
  link: { hash: string; expiresAt: Date },
  now: Date,
): Promise<AccountActionOutcome & { mailTo: AccountMailTarget }> {
  const { account, workspaces } = await lockAccount(tx, accountId);
  const sessions = await endSessions(tx, account.id, now);
  await tx.$queryRaw`
    SELECT auth_request_password_reset(${account.email}::citext, ${link.hash}, ${link.expiresAt})`;
  return {
    ...outcome(workspaces, true, { sessions_ended: sessions }),
    mailTo: await mailTarget(tx, account),
  };
}

/** Sign the person out everywhere. */
export async function revokeSessions(
  tx: Tx,
  accountId: string,
  now: Date,
): Promise<AccountActionOutcome> {
  const { account, workspaces } = await lockAccount(tx, accountId);
  const sessions = await endSessions(tx, account.id, now);
  return outcome(workspaces, sessions > 0, { sessions_ended: sessions });
}

/** Sessions and personal access tokens alike — every credential the person holds. */
export async function revokeCredentials(
  tx: Tx,
  accountId: string,
  now: Date,
): Promise<AccountActionOutcome> {
  const { account, workspaces } = await lockAccount(tx, accountId);
  const sessions = await endSessions(tx, account.id, now);
  const personal = await tx.apiToken.updateMany({
    where: { ownerId: account.id, kind: 'pat', revokedAt: null },
    data: { revokedAt: now },
  });
  return outcome(workspaces, sessions + personal.count > 0, {
    sessions_ended: sessions,
    personal_revoked: personal.count,
  });
}

/**
 * Remove the authenticator and its recovery codes (`auth_two_factor_disable`).
 * The next sign-in asks for no code — or, in a workspace that requires a
 * second factor, for a new one to be set up before anything else.
 */
export async function resetTwoFactor(tx: Tx, accountId: string): Promise<AccountActionOutcome> {
  const { account, workspaces } = await lockAccount(tx, accountId);
  const [row] = await tx.$queryRaw<Array<{ removed: boolean }>>`
    SELECT auth_two_factor_disable(${account.id}::uuid) AS removed`;
  return outcome(workspaces, row?.removed === true);
}

/**
 * The person is out of every workspace until it is lifted: sessions end now,
 * and every sign-in, token and socket is refused while the column is set
 * (`accounts.platform_suspended_at`). Memberships do not change.
 */
export async function suspendAccount(
  tx: Tx,
  accountId: string,
  reason: string,
  now: Date,
): Promise<AccountActionOutcome> {
  const { account, workspaces } = await lockAccount(tx, accountId);
  if (account.platform_suspended_at !== null) return outcome(workspaces, false);
  await tx.account.update({
    where: { id: account.id },
    data: { platformSuspendedAt: now, platformSuspendedReason: reason },
  });
  const sessions = await endSessions(tx, account.id, now);
  return outcome(workspaces, true, { sessions_ended: sessions });
}

export async function unsuspendAccount(tx: Tx, accountId: string): Promise<AccountActionOutcome> {
  const { account, workspaces } = await lockAccount(tx, accountId);
  if (account.platform_suspended_at === null) return outcome(workspaces, false);
  await tx.account.update({
    where: { id: account.id },
    data: { platformSuspendedAt: null, platformSuspendedReason: null },
  });
  return outcome(workspaces, true, {
    suspended_at: account.platform_suspended_at.toISOString(),
  });
}

/** The format marker of {@link exportAccount}'s document. */
export const ACCOUNT_EXPORT_FORMAT = 'siyahtus.account-export.v1';

export interface AccountExport {
  format: typeof ACCOUNT_EXPORT_FORMAT;
  generated_at: string;
  account: {
    id: string;
    email: string;
    name: string;
    avatar_url: string | null;
    created_at: string;
    email_verified_at: string | null;
    last_seen_at: string | null;
    password_set: boolean;
    suspended: boolean;
    two_factor: { enabled: boolean; enabled_at: string | null };
  };
  memberships: Array<{
    license_id: string;
    organization_name: string;
    role: string;
    suspended: boolean;
    awaiting_approval: boolean;
    joined_at: string;
    locale: string | null;
  }>;
  personal_tokens: Array<{
    name: string | null;
    license_id: string;
    created_at: string;
    last_used_at: string | null;
    expires_at: string | null;
    revoked_at: string | null;
  }>;
  /** How many entries the person's own actions left in each workspace's trail. */
  audit_summary: Array<{
    license_id: string;
    entries: number;
    first_at: string | null;
    last_at: string | null;
  }>;
}

/**
 * Everything the platform holds about the person as a person (GDPR Art. 15/20):
 * the profile, the memberships, the personal tokens' names and dates, and a
 * count of their trail in each workspace. Not a workspace's content — a
 * message the person wrote belongs to the workspace, which exports its own
 * (`/reports/export`, `/audit-log/export`) — and not the operator's reason for
 * a suspension. `account.exported` is recorded with the counts.
 */
export async function exportAccount(
  tx: Tx,
  accountId: string,
  now: Date,
): Promise<AccountActionOutcome & { document: AccountExport }> {
  const { account: locked, workspaces } = await lockAccount(tx, accountId);
  const account = await tx.account.findUniqueOrThrow({
    where: { id: locked.id },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      createdAt: true,
      emailVerifiedAt: true,
      lastSeenAt: true,
      passwordHash: true,
      platformSuspendedAt: true,
      twoFactor: { select: { activatedAt: true } },
      memberships: {
        orderBy: { licenseId: 'asc' },
        select: {
          licenseId: true,
          role: true,
          suspended: true,
          awaitingApproval: true,
          createdAt: true,
          locale: true,
          license: { select: { organization: { select: { name: true } } } },
        },
      },
    },
  });
  const [tokens, audit] = await Promise.all([
    tx.apiToken.findMany({
      where: { ownerId: account.id, kind: 'pat' },
      orderBy: { createdAt: 'asc' },
      select: {
        name: true,
        licenseId: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    }),
    workspaces.length === 0
      ? Promise.resolve([])
      : tx.$queryRaw<
          Array<{
            license_id: bigint;
            entries: bigint;
            first_at: Date | null;
            last_at: Date | null;
          }>
        >`
          SELECT license_id, count(*) AS entries, min(created_at) AS first_at,
                 max(created_at) AS last_at
            FROM audit_log
           WHERE license_id = ANY(${workspaces}::bigint[]) AND actor_id = ${account.id}
           GROUP BY license_id
           ORDER BY license_id`,
  ]);
  const enabled = account.twoFactor?.activatedAt != null;
  const document: AccountExport = {
    format: ACCOUNT_EXPORT_FORMAT,
    generated_at: now.toISOString(),
    account: {
      id: account.id,
      email: account.email,
      name: account.name,
      avatar_url: account.avatarUrl,
      created_at: account.createdAt.toISOString(),
      email_verified_at: iso(account.emailVerifiedAt),
      last_seen_at: iso(account.lastSeenAt),
      password_set: account.passwordHash !== null,
      suspended: account.platformSuspendedAt !== null,
      two_factor: { enabled, enabled_at: enabled ? iso(account.twoFactor?.activatedAt) : null },
    },
    memberships: account.memberships.map((m) => ({
      license_id: m.licenseId.toString(),
      organization_name: m.license.organization.name,
      role: m.role,
      suspended: m.suspended,
      awaiting_approval: m.awaitingApproval,
      joined_at: m.createdAt.toISOString(),
      locale: m.locale,
    })),
    personal_tokens: tokens.map((t) => ({
      name: t.name,
      license_id: t.licenseId.toString(),
      created_at: t.createdAt.toISOString(),
      last_used_at: iso(t.lastUsedAt),
      expires_at: iso(t.expiresAt),
      revoked_at: iso(t.revokedAt),
    })),
    audit_summary: audit.map((row) => ({
      license_id: row.license_id.toString(),
      entries: Number(row.entries),
      first_at: iso(row.first_at),
      last_at: iso(row.last_at),
    })),
  };
  return {
    ...outcome(workspaces, true, {
      memberships: document.memberships.length,
      personal: document.personal_tokens.length,
    }),
    document,
  };
}

/**
 * Forget the person (GDPR Art. 17): `platform_erase_account` deletes the row
 * and everything that hangs off it. `confirmEmail` must be the address, typed
 * — the panel's guard against erasing the wrong tab's account, held here too.
 * Refused while the person is a workspace's Founder (not a sandbox's): that
 * workspace would be left with nobody able to hold it — force the transfer
 * first (`force-ownership-transfer`, tm 389.10).
 */
export async function eraseAccount(
  tx: Tx,
  accountId: string,
  confirmEmail: string,
): Promise<AccountActionOutcome> {
  const { account, workspaces } = await lockAccount(tx, accountId);
  if (confirmEmail.trim().toLowerCase() !== account.email.toLowerCase()) {
    throw ApiError.validation('confirm_email does not match the account’s address.', {
      reason: 'confirm_email_mismatch',
    });
  }
  const owned = await tx.agentMembership.findMany({
    where: { agentId: account.id, role: 'owner', license: { sandboxOfLicenseId: null } },
    orderBy: { licenseId: 'asc' },
    select: { licenseId: true },
  });
  if (owned.length > 0) {
    throw accountStateError(
      'account_is_sole_owner',
      'The account is the Founder of a workspace — transfer the ownership first.',
      { license_ids: owned.map((m) => m.licenseId.toString()) },
    );
  }
  await tx.$queryRaw`SELECT platform_erase_account(${account.id}::uuid)`;
  return outcome(workspaces, true, {
    license_ids: workspaces.map((id) => id.toString()),
  });
}
