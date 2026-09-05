/**
 * Access review report (NFR-C6 · C6-e · SOC 2 CC6.1).
 *
 * CC6.1 — "logical access" — is one of the few SOC 2 controls whose evidence a
 * product can *produce* rather than merely assert. The auditor's question is
 * concrete: at this instant, who can reach this workspace, with what authority,
 * when did they last do so, and which non-human credentials can do the same. The
 * answer is a table, and a table is something code can generate truthfully.
 *
 * What this module deliberately does **not** do is judge (§C-A23). There is no
 * risk score, no "stale — consider revoking", no highlighting. Whether a
 * dormant admin or a two-year-old integration token is *appropriate* is the
 * human control the report exists to feed; a product that pre-answered it would
 * be substituting its own guess for the review an auditor is required to see
 * performed. Every column below is a fact read off a row, or a derivation whose
 * rule is stated here.
 *
 * Three shapes are worth reading twice.
 *
 * **Last sign-in comes from the audit trail, not from a column.** `accounts`
 * carries a `last_seen_at`, and since FR-MOD-04.3.4 (tm 191.3) something does
 * write it — but it is still the wrong column for this report, and now for a
 * sharper reason than "always null". It is *account-wide*: `accounts` is a
 * person, and a person may work for several workspaces, so a consultant who is
 * in another tenant's console every day carries a fresh stamp into this
 * report while never once having signed in here. The trail is per-licence,
 * which is exactly what CC6.1 asks about, and it records the act being reviewed
 * (`auth.login`, `auth.sso_login`) rather than mere activity. The cost is that
 * the trail is pruned on retention
 * (`RETENTION_AUDIT_DAYS`), so "no sign-in recorded" means *not since the trail
 * begins* — which is why `audit_trail_starts_at` travels with the report rather
 * than being left for the reader to assume.
 *
 * **The credential inventory lists every kind of bearer credential, including
 * bot tokens.** The item names PAT/OAuth/SCIM; bots are here anyway, because an
 * inventory that omits a kind of credential is not an inventory, and the gap
 * would sit exactly where an attacker would want it. What is *not* here is any
 * part of a token's value: only its id, owner, scopes and timestamps. The digest
 * is not returned either — it is not presentable, but publishing it would still
 * hand an offline attacker something to grind against.
 *
 * **Only credentials that can open the door today are listed.** Revoked and
 * expired rows are excluded, because the report's claim is present-tense: these
 * are the live access paths. Each row carries its own `expires_at` so a reviewer
 * can see which are about to lapse without the list being padded with ones that
 * already have.
 */
import type {
  AccessReviewLoginMethod,
  AccessReviewMemberStatus,
  AccessReviewProvisioning,
} from '@nexa/types';
import type { TenantClient } from '../../lib/tenant.js';
import type { CsvCell } from '../../routes/reports-export.js';

/** One membership of the workspace, as CC6.1 asks about it. */
export interface AccessReviewMember {
  account_id: string;
  name: string;
  email: string;
  role: string;
  /** Derived from the two booleans below; `suspended` wins. */
  status: AccessReviewMemberStatus;
  suspended: boolean;
  awaiting_approval: boolean;
  two_factor_enabled: boolean;
  provisioned_via: AccessReviewProvisioning;
  /** When the membership was created — access granted, not the account's birth. */
  member_since: string;
  /** Newest `auth.login`/`auth.sso_login` in the retained trail, or null. */
  last_login_at: string | null;
  last_login_method: AccessReviewLoginMethod | null;
}

/** One live bearer credential of the workspace. Never its value. */
export interface AccessReviewCredential {
  id: string;
  /** `pat` · `oauth` · `bot` · `scim`. */
  kind: string;
  name: string | null;
  scopes: string[];
  /**
   * The raw owner reference as stored: an account uuid for `pat`/`oauth`/`scim`,
   * a bot id for `bot`, or the `system:scim` sentinel for a provisioning token
   * minted by something that was not a person.
   */
  owner_id: string;
  /** Resolved only when `owner_id` is a current member of this workspace. */
  owner_name: string | null;
  owner_email: string | null;
  /**
   * False for a bot/system credential — and, more interestingly, for a token
   * whose human owner is no longer a member. A workspace can revoke a person's
   * membership and leave their personal access token alive; that is precisely
   * the orphan CC6.1 asks after, so it is surfaced as a fact rather than left
   * for the reader to join two tables to find.
   */
  owner_is_member: boolean;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

export interface AccessReviewReport {
  /** When the snapshot was taken. A review is evidence *as of* an instant. */
  generated_at: string;
  /**
   * The oldest entry still in this workspace's audit trail, or null when the
   * trail is empty. A `last_login_at` of null below means "nothing since this
   * instant", never "never" — retention, not absence of activity, is the usual
   * reason.
   */
  audit_trail_starts_at: string | null;
  members: AccessReviewMember[];
  credentials: AccessReviewCredential[];
}

/** The trail actions that count as a sign-in, and what each one means. */
const LOGIN_ACTIONS: Readonly<Record<string, AccessReviewLoginMethod>> = {
  'auth.login': 'password',
  'auth.sso_login': 'sso',
};

/**
 * Build the report for the caller's workspace.
 *
 * `tx` must come from `withTenant`: every query below is unfiltered by licence
 * on purpose, exactly as the audit reader is — RLS is the tenant boundary, and a
 * hand-written `where` beside it would suggest the clause is what protects the
 * tenant. `now` is a parameter rather than a `new Date()` so the snapshot is a
 * pure function of its inputs and a test can pin the instant that decides which
 * credentials count as expired.
 */
export async function buildAccessReview(tx: TenantClient, now: Date): Promise<AccessReviewReport> {
  const [memberships, logins, trailStart, tokens] = await Promise.all([
    tx.agentMembership.findMany({
      select: {
        agentId: true,
        role: true,
        suspended: true,
        awaitingApproval: true,
        twoFactorEnabled: true,
        scimExternalId: true,
        createdAt: true,
        agent: { select: { name: true, email: true } },
      },
      // Grant order, then id — two memberships created in the same statement
      // share a timestamp, and a report whose row order shifts between runs
      // cannot be diffed against last quarter's copy.
      orderBy: [{ createdAt: 'asc' }, { agentId: 'asc' }],
    }),
    // One grouped pass rather than a query per member: the newest of each
    // sign-in action per actor, served by the `(license_id, action, created_at)`
    // index. No lower date bound — the whole retained trail is the window, and
    // `audit_trail_starts_at` reports where it begins.
    tx.auditLogEntry.groupBy({
      by: ['actorId', 'action'],
      where: { action: { in: Object.keys(LOGIN_ACTIONS) }, actorType: 'agent' },
      _max: { createdAt: true },
    }),
    tx.auditLogEntry.aggregate({ _min: { createdAt: true } }),
    tx.apiToken.findMany({
      where: {
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: {
        id: true,
        kind: true,
        name: true,
        scopes: true,
        ownerId: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);

  const lastLogin = newestLoginByActor(logins);
  const membersById = new Map(memberships.map((row) => [row.agentId, row]));

  return {
    generated_at: now.toISOString(),
    audit_trail_starts_at: trailStart._min.createdAt?.toISOString() ?? null,
    members: memberships.map((row) => {
      const login = lastLogin.get(row.agentId);
      return {
        account_id: row.agentId,
        name: row.agent.name,
        email: row.agent.email,
        role: row.role,
        status: memberStatus(row),
        suspended: row.suspended,
        awaiting_approval: row.awaitingApproval,
        two_factor_enabled: row.twoFactorEnabled,
        // The presence of a directory id *is* the fact that the directory
        // manages this membership — there is no second flag to disagree with.
        provisioned_via: row.scimExternalId === null ? 'manual' : 'scim',
        member_since: row.createdAt.toISOString(),
        last_login_at: login?.at.toISOString() ?? null,
        last_login_method: login?.method ?? null,
      };
    }),
    credentials: tokens.map((row) => {
      const owner = membersById.get(row.ownerId);
      return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        scopes: row.scopes,
        owner_id: row.ownerId,
        owner_name: owner?.agent.name ?? null,
        owner_email: owner?.agent.email ?? null,
        owner_is_member: owner !== undefined,
        created_at: row.createdAt.toISOString(),
        last_used_at: row.lastUsedAt?.toISOString() ?? null,
        expires_at: row.expiresAt?.toISOString() ?? null,
      };
    }),
  };
}

/**
 * One value per membership, `suspended` first.
 *
 * Order matters and is not arbitrary: a suspended member who is also awaiting
 * approval cannot get in, so reporting them as `awaiting_approval` would
 * overstate their access. Overstating is the safe direction for a *warning* and
 * the wrong one for an inventory, where the reader is counting doors.
 */
function memberStatus(row: {
  suspended: boolean;
  awaitingApproval: boolean;
}): AccessReviewMemberStatus {
  if (row.suspended) return 'suspended';
  if (row.awaitingApproval) return 'awaiting_approval';
  return 'active';
}

/**
 * Collapse the grouped `(actor, action) → max(created_at)` rows into one newest
 * sign-in per actor, keeping which action it was.
 *
 * A member who signs in both ways keeps the later of the two, so the column
 * reads as "last seen" rather than "last seen this particular way". Rows with a
 * null actor (a failed sign-in never resolved to a person) cannot belong to a
 * membership and are dropped.
 */
function newestLoginByActor(
  rows: ReadonlyArray<{ actorId: string | null; action: string; _max: { createdAt: Date | null } }>,
): Map<string, { at: Date; method: AccessReviewLoginMethod }> {
  const out = new Map<string, { at: Date; method: AccessReviewLoginMethod }>();
  for (const row of rows) {
    const at = row._max.createdAt;
    const method = LOGIN_ACTIONS[row.action];
    if (row.actorId === null || at === null || method === undefined) continue;

    const current = out.get(row.actorId);
    if (current === undefined || at > current.at) out.set(row.actorId, { at, method });
  }
  return out;
}

/** A header row and body rows, ready for `toCsv`/`toPdf`. */
export interface AccessReviewTable {
  headers: string[];
  rows: CsvCell[][];
}

/**
 * The membership table as CSV columns.
 *
 * Booleans serialise as `true`/`false` rather than 1/0: a spreadsheet reader is
 * the audience, and a bare 1 in a `two_factor_enabled` column has been read as
 * "one device" often enough to be worth the extra characters. Timestamps stay
 * ISO-8601 UTC — the same strings the JSON carries, so the two artefacts of one
 * snapshot cannot disagree.
 */
export function accessReviewMemberTable(report: AccessReviewReport): AccessReviewTable {
  return {
    headers: [
      'account_id',
      'name',
      'email',
      'role',
      'status',
      'two_factor_enabled',
      'provisioned_via',
      'member_since',
      'last_login_at',
      'last_login_method',
    ],
    rows: report.members.map((member) => [
      member.account_id,
      member.name,
      member.email,
      member.role,
      member.status,
      String(member.two_factor_enabled),
      member.provisioned_via,
      member.member_since,
      member.last_login_at,
      member.last_login_method,
    ]),
  };
}

/**
 * The credential table as CSV columns.
 *
 * `scopes` collapses to a space-separated list in one cell. Space rather than
 * comma because the cell would otherwise need quoting in every single row, and
 * scope strings contain no spaces by construction (`resource--access:permission`),
 * so the join is reversible.
 */
export function accessReviewCredentialTable(report: AccessReviewReport): AccessReviewTable {
  return {
    headers: [
      'credential_id',
      'kind',
      'name',
      'owner_id',
      'owner_email',
      'owner_is_member',
      'scopes',
      'created_at',
      'last_used_at',
      'expires_at',
    ],
    rows: report.credentials.map((credential) => [
      credential.id,
      credential.kind,
      credential.name,
      credential.owner_id,
      credential.owner_email,
      String(credential.owner_is_member),
      credential.scopes.join(' '),
      credential.created_at,
      credential.last_used_at,
      credential.expires_at,
    ]),
  };
}

/**
 * `nexa-access-review-<section>-<YYYY-MM-DD>.csv`.
 *
 * Named for the day rather than a window, because unlike every other report
 * export this one has no reporting range — it is a snapshot of *now*. Two
 * reviews taken on different days therefore land as different files in a
 * downloads folder, which is what an evidence trail wants; two taken on the same
 * day are the same evidence and may overwrite each other.
 */
export function accessReviewFilename(section: string, generatedAt: Date): string {
  return `nexa-access-review-${section}-${generatedAt.toISOString().slice(0, 10)}.csv`;
}
