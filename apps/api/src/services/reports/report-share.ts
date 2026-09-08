/**
 * Shareable report links (FR-MOD-07.3.1) — minting, listing, revoking and the
 * one anonymous resolution.
 *
 * The acceptance criterion behind the Overview header reads "Share export/link".
 * The export half hands a file to somebody who is already signed in; this half
 * hands a URL to somebody who is not. That is a different security question, and
 * everything in this file exists to answer it narrowly:
 *
 *   * **Scope-limited.** A link names one report group and one window, both
 *     fixed at creation. It cannot be widened afterwards — there is no update
 *     path — and it resolves to exactly the table `GET /reports/export` would
 *     produce for the same group and window, never more.
 *   * **Time-limited.** `expiresAt` is not optional anywhere: not in the input,
 *     not in the column, not in the CHECK constraint. The longest a caller may
 *     ask for is {@link SHARE_LINK_MAX_DAYS}; the default when they ask for
 *     nothing is the short one.
 *   * **Revocable, and the revocation is a stamp.** A withdrawn grant stays in
 *     the table with `revokedAt` set, because an access review wants to see that
 *     it existed and was withdrawn.
 *   * **Bounded in number.** {@link MAX_LIVE_SHARE_LINKS} un-revoked links per
 *     workspace. The bound matters more than its exact value: an unbounded set
 *     of standing anonymous credentials is what this feature would decay into
 *     otherwise, and a refusal is the only limit that does not depend on
 *     somebody remembering to tidy up.
 *
 * The token follows the personal-access-token rules exactly (`routes/auth.ts`,
 * `ApiToken`): 256 bits from `generateToken`, returned once, stored only as a
 * `hashToken` digest. {@link ReportShareLink.token_last_four} is the only part a
 * row can ever show again, and it is there so the management list is legible
 * rather than a column of identical dates.
 *
 * Resolution is the one cross-tenant read: an anonymous holder has no session,
 * so the token has to name its own workspace. It goes through the SECURITY
 * DEFINER `reports_resolve_share_link`, which is also where the 404 policy lives
 * — revoked, expired, cancelled and never-existed all come back as no row, so
 * nothing downstream is *able* to tell them apart (NFR-S5).
 */
import type { PrismaClient } from '@prisma/client';
import type { ReportShareLink, ReportShareLinkCreated } from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import { generateToken, hashToken } from '../../lib/crypto.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { reportGroup } from '../../routes/reports-export.js';

/** How long a link lives when the caller names no lifetime. */
export const SHARE_LINK_DEFAULT_DAYS = 7;

/**
 * The longest lifetime a caller may ask for.
 *
 * A quarter, not a year: the window a link exposes is itself pinned, so a link
 * that outlives the period it reports on is answering a question nobody is still
 * asking while remaining a live credential. Minting a fresh one costs one click.
 */
export const SHARE_LINK_MAX_DAYS = 90;

/**
 * Un-revoked links one workspace may hold at once.
 *
 * Small on purpose. Every row is a URL that reads workspace data with no
 * account behind it, and the failure mode of "just one more" is a workspace
 * that has no idea how many are outstanding. Revoking one makes room, which is
 * the hygiene this bound is really buying.
 */
export const MAX_LIVE_SHARE_LINKS = 25;

const DAY_MS = 86_400_000;

export interface ShareLinkInput {
  /** A `REPORT_GROUPS` id; validated against the catalogue here. */
  group: string;
  from: Date;
  to: Date;
  expiresInDays: number;
  /** The agent minting it, kept as a soft reference. A bot token leaves it unset. */
  createdByAgentId?: string;
}

/** What a token resolves to — everything the shared read needs, and nothing else. */
export interface ResolvedShareLink {
  shareId: string;
  tenant: TenantContext;
  group: string;
  from: Date;
  to: Date;
  expiresAt: Date;
}

interface ShareLinkRow {
  id: string;
  groupId: string;
  tokenLastFour: string;
  rangeFrom: Date;
  rangeTo: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

/**
 * The last four characters of a token.
 *
 * Deliberately the *tail*: a base64url token's leading characters are as random
 * as its trailing ones, but the tail is what a person sees at the end of a
 * pasted URL, so it is the half that lets them match a row to a link they still
 * have in a chat window.
 */
export function tokenLastFour(token: string): string {
  return token.slice(-4);
}

function toDto(row: ShareLinkRow, now: Date): ReportShareLink {
  return {
    id: row.id,
    group: row.groupId,
    from: row.rangeFrom.toISOString(),
    to: row.rangeTo.toISOString(),
    token_last_four: row.tokenLastFour,
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
    revoked_at: row.revokedAt ? row.revokedAt.toISOString() : null,
    // Derived here rather than left to the client: a browser whose clock is
    // wrong would otherwise paint a dead link as live, and the one thing this
    // list has to be right about is which links still work.
    expired: row.expiresAt.getTime() <= now.getTime(),
  };
}

export class ReportShareService {
  /**
   * The workspace's un-revoked links, newest first.
   *
   * Expired ones are included and flagged rather than filtered out: "why did my
   * link stop working?" has to be answerable from the screen, and a row that
   * silently disappears the moment it lapses answers it with nothing. Revoked
   * ones are excluded because the list's question is "who can read our numbers",
   * and a revoked row's answer to that is no — its record lives on in the table
   * and in the audit trail.
   */
  async list(
    tx: TenantClient,
    tenant: TenantContext,
    now: Date,
  ): Promise<{ items: ReportShareLink[] }> {
    const rows = await tx.reportShareLink.findMany({
      where: { licenseId: tenant.licenseId, revokedAt: null },
      orderBy: [{ createdAt: 'desc' }],
    });
    return { items: rows.map((row) => toDto(row, now)) };
  }

  /**
   * Mint a link and return its token — the only time the token exists outside
   * the recipient's URL.
   *
   * The caller's authority over the group is checked in the route, next to the
   * principal; what this validates is that the group is real and that the
   * workspace is not already over its ceiling.
   */
  async issue(
    tx: TenantClient,
    tenant: TenantContext,
    input: ShareLinkInput,
    now: Date,
  ): Promise<ReportShareLinkCreated> {
    // A 400, not a 404, for the same reason the export endpoint gives one: the
    // group is a request parameter the caller got wrong, not a resource whose
    // existence is a tenant secret.
    const group = reportGroup(input.group);
    if (!group) throw ApiError.validation(`group: unknown report group: ${input.group}.`);

    // Counted inside the caller's transaction, so two simultaneous mints cannot
    // both read "24" — the count and the insert see the same snapshot.
    const live = await tx.reportShareLink.count({
      where: { licenseId: tenant.licenseId, revokedAt: null },
    });
    if (live >= MAX_LIVE_SHARE_LINKS) {
      throw ApiError.validation(
        `A workspace may hold ${MAX_LIVE_SHARE_LINKS} share links at once; revoke one first.`,
      );
    }

    const token = generateToken();
    const expiresAt = new Date(now.getTime() + input.expiresInDays * DAY_MS);

    const created = await tx.reportShareLink.create({
      data: {
        licenseId: tenant.licenseId,
        groupId: group.id,
        // The raw token is never written. This digest is the whole of what the
        // database knows, and `reports_resolve_share_link` compares against it.
        tokenHash: hashToken(token),
        tokenLastFour: tokenLastFour(token),
        rangeFrom: input.from,
        rangeTo: input.to,
        expiresAt,
        ...(input.createdByAgentId ? { createdByAgentId: input.createdByAgentId } : {}),
      },
    });

    return { ...toDto(created, now), token };
  }

  /**
   * Withdraw a link.
   *
   * `revokedAt: null` in the `where` is not decoration: without it a second
   * revoke would succeed and move the stamp, rewriting when access actually
   * ended. A zero-row update is the same 404 an unknown id gets — and an id
   * belonging to another workspace is invisible under RLS, so it takes that same
   * path rather than a 403 that would confirm the id names something.
   */
  async revoke(tx: TenantClient, tenant: TenantContext, id: string, now: Date): Promise<void> {
    const { count } = await tx.reportShareLink.updateMany({
      where: { id, licenseId: tenant.licenseId, revokedAt: null },
      data: { revokedAt: now },
    });
    if (count === 0) throw ApiError.notFound('Share link not found.');
  }
}

/**
 * Turn a share token into the grant it names, or `null` for every miss.
 *
 * Runs outside any tenant transaction, because there is none yet — the same
 * shape `resolvePublicKbWorkspace` uses, and for the same reason. Revoked,
 * expired, cancelled-licence and never-existed are all filtered inside the
 * SECURITY DEFINER function, so they arrive here as one undifferentiated `null`
 * and the caller turns it into the single indistinguishable 404 (NFR-S5). Which
 * miss occurred never reaches this layer, so it cannot leak past it.
 *
 * Only the digest crosses into the database: the raw token is not a query
 * parameter anywhere, so it cannot surface in `pg_stat_statements` or a slow
 * query log.
 */
export async function resolveShareLink(
  db: PrismaClient,
  token: string,
): Promise<ResolvedShareLink | null> {
  const rows = await db.$queryRaw<
    Array<{
      share_id: string;
      license_id: bigint;
      organization_id: string;
      group_id: string;
      range_from: Date;
      range_to: Date;
      expires_at: Date;
    }>
  >`SELECT * FROM reports_resolve_share_link(${hashToken(token)})`;

  const match = rows[0];
  if (!match) return null;
  return {
    shareId: match.share_id,
    tenant: { licenseId: match.license_id, organizationId: match.organization_id },
    group: match.group_id,
    from: match.range_from,
    to: match.range_to,
    expiresAt: match.expires_at,
  };
}
