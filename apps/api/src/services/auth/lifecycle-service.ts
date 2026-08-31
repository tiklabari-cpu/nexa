/**
 * Account lifecycle: signup, password recovery, invitations.
 * PRD FR-MOD-00.2, 00.3, 04.3.1, 04.4.
 *
 * Everything here happens *before* a tenant context exists — signup is the
 * request that creates the tenant — so the database work goes through the
 * `auth_*` SECURITY DEFINER functions rather than through `withTenant`. That is
 * the same shape the widget-origin resolver uses: one narrow function per
 * pre-auth need, each returning the minimum, instead of relaxing row level
 * security for the application role.
 *
 * Tokens (reset and invite) are random 32-byte values. Only their hash is
 * stored, so a leaked backup of either table is not a set of working links.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../../lib/api-error.js';
import { withTenant, type TenantClient } from '../../lib/tenant.js';
import { hashPassword } from '../../lib/crypto.js';
import { type AgentRole, type Region } from '@nexa/types';
import { ROLE_RANK } from './principal.js';

export const TRIAL_DAYS = 14;
const RESET_TTL_MS = 60 * 60 * 1000; // one hour
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InvitableRole = 'admin' | 'agent';

export interface Membership {
  license_id: string;
  organization_id: string;
  organization_name: string;
  role: string;
  license_status: string;
  /** The workspace's OAuth client. Returned so the caller never guesses it. */
  client_id: string | null;
}

export interface Session {
  account: { id: string; email: string; name: string };
  memberships: Membership[];
}

export interface AcceptedInvitation {
  session: Session;
  /**
   * The membership this call itself created or reused — `session.memberships`
   * also lists any workspaces the account already belonged to, so it alone
   * cannot say which one was just joined (needed to scope the `member.joined`
   * audit entry, C6-a2).
   */
  licenseId: bigint;
}

export interface InvitationRecord {
  id: string;
  email: string;
  role: InvitableRole;
  invited_by_name: string | null;
  expires_at: string;
  created_at: string;
  accept_url?: string;
}

function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

/**
 * SHA-256, not a password KDF.
 *
 * These tokens are 256 bits of machine-generated randomness, so there is no
 * guessing to slow down; the hash exists only so the stored form is useless if
 * read. A slow KDF here would add latency to every reset and invite lookup
 * without adding security.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class LifecycleService {
  readonly #db: PrismaClient;
  readonly #appUrl: string;

  constructor(db: PrismaClient, appUrl: string) {
    this.#db = db;
    this.#appUrl = appUrl.replace(/\/+$/, '');
  }

  async signup(input: {
    email: string;
    password: string;
    name: string;
    organizationName: string;
    /**
     * Immutable from here on (C4-a), and already checked against the region
     * this deployment serves (C4-h) — which is why it is required rather than
     * defaulted here. A default in this layer would be a second answer to
     * "where does an unspecified workspace land", and the route's answer is the
     * only one that can also refuse.
     */
    region: Region;
  }): Promise<Session> {
    const passwordHash = await hashPassword(input.password);

    let created: Array<{ created_account: string; created_license: bigint }>;
    try {
      // Always passed explicitly, never left to the function's own default, so
      // "where does an unspecified workspace land" is answered once — in the
      // route, where the answer can also be a refusal (C4-h).
      created = await this.#db.$queryRaw`
        SELECT * FROM auth_signup(
          ${input.email}::citext, ${input.name}, ${passwordHash},
          ${input.organizationName}, ${TRIAL_DAYS}::int, ${input.region}
        )`;
    } catch (error) {
      if (isAccountExists(error)) {
        // Deliberately distinguishable, unlike password recovery. Hiding it
        // would answer "check your inbox" to someone who already has an
        // account and simply needs to sign in.
        throw new ApiError('account_exists', 'An account already exists for that email.');
      }
      throw error;
    }

    const row = created[0];
    if (!row) throw ApiError.internal('Signup produced no workspace.');

    // Read before seeding rather than on the way out: this is the only place
    // the new workspace's organization id surfaces, and the seed needs it to
    // open a tenant context.
    const memberships = await this.#membershipsOf(row.created_account);
    await this.#seedDefaultTeam(row.created_license, row.created_account, memberships);

    return {
      account: { id: row.created_account, email: input.email, name: input.name },
      memberships,
    };
  }

  /**
   * The team a new workspace routes its first conversation to (FR-MOD-04.5).
   *
   * Routing resolves an agent through `group_agents` (ADR-08 step 2), and
   * `defaultGroupIds` falls back to "the first team" when no routing rule is
   * configured — but *only* if a team exists. A workspace opened with none had
   * no such fallback: its first chat was created with an empty `chat_access`,
   * which no agent can see. So this is not a convenience seed like the demo
   * data; it is what makes a brand-new workspace able to receive work at all.
   *
   * Deliberately no fallback `routing_rules` row: the owner-in-one-team shape
   * is the minimum that works, and `defaultGroupIds` already reaches it. A rule
   * is a configuration choice, and inventing one here would put a row in the
   * routing screen that nobody asked for.
   *
   * Outside `auth_signup` rather than inside it: the function is an applied
   * migration shared with the invitation path, and this is one insert pair that
   * reads plainly next to the code that depends on it. A failure here surfaces
   * — a workspace that cannot route is not a workspace that signed up
   * successfully.
   *
   * But *inside* `withTenant`, which is the whole reason this method takes the
   * memberships. Everything else in this file reaches the database through the
   * `auth_*` SECURITY DEFINER functions precisely because signup runs before a
   * tenant context exists, and `#db` is the non-owner `nexa_app` role — writing
   * `groups` straight through it hits `groups_tenant`'s `WITH CHECK
   * (license_id = nexa_current_license())` against an unset setting and fails.
   * The same trap `#membershipsOf` documents below, one step louder: a read
   * comes back empty, a write raises and takes signup down with it. The tenant
   * this opens is the one the transaction above just created, so the context is
   * legitimate rather than a way around the policy.
   */
  async #seedDefaultTeam(
    licenseId: bigint,
    ownerAccountId: string,
    memberships: Membership[],
  ): Promise<void> {
    const membership = memberships.find((m) => m.license_id === licenseId.toString());
    if (!membership) throw ApiError.internal('Signup produced no membership for its workspace.');

    await withTenant(
      this.#db,
      { licenseId, organizationId: membership.organization_id },
      async (tx) => {
        const group = await tx.group.create({
          data: { licenseId, name: 'General' },
          select: { id: true },
        });
        await tx.groupAgent.create({
          data: { licenseId, groupId: group.id, agentId: ownerAccountId, priority: 'primary' },
        });
      },
    );
  }

  /**
   * Records a reset token, if the address is real.
   *
   * Returns the token for the mock mailer to deliver; the *route* is what keeps
   * the answer uniform. Callers must not vary their response on whether this
   * returned null — that is exactly the enumeration channel FR-MOD-00.3 closes.
   */
  async requestPasswordReset(email: string): Promise<string | null> {
    const { token, hash } = newToken();
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);

    // The function reports whether it recorded anything. Working that out here
    // instead — with a plain `SELECT ... FROM accounts` — is what broke this
    // once: that query runs as the application role with no tenant context, row
    // level security returned nothing every time, and the link was never sent
    // to anyone while the token sat in the table looking correct.
    //
    // Knowing is fine. The *route* is what has to answer identically either
    // way, and it does.
    const [row] = await this.#db.$queryRaw<Array<{ recorded: boolean }>>`
      SELECT auth_request_password_reset(${email}::citext, ${hash}, ${expiresAt}) AS recorded`;

    return row?.recorded ? token : null;
  }

  /** Returns the id of the account whose password was changed, for auditing. */
  async confirmPasswordReset(token: string, password: string): Promise<string> {
    const passwordHash = await hashPassword(password);
    const rows = await this.#db.$queryRaw<Array<{ reset_account: string }>>`
      SELECT * FROM auth_consume_password_reset(${hashToken(token)}, ${passwordHash})`;

    const row = rows[0];
    if (!row) {
      // Unknown, expired and already-used are one answer: each distinction
      // would tell someone holding a stale link something about the account.
      throw ApiError.authentication('This reset link is no longer valid.');
    }
    return row.reset_account;
  }

  /**
   * The tenants an account can sign in to, so an account-level event — a
   * password change — can be recorded in each affected workspace's audit log.
   * Reuses the same SECURITY DEFINER function login does, so it runs before any
   * tenant context exists.
   */
  async membershipTenants(
    accountId: string,
  ): Promise<Array<{ licenseId: bigint; organizationId: string }>> {
    const rows = await this.#db.$queryRaw<
      Array<{ license_id: bigint; organization_id: string }>
    >`SELECT license_id, organization_id FROM auth_list_memberships(${accountId}::uuid)`;
    return rows.map((r) => ({ licenseId: r.license_id, organizationId: r.organization_id }));
  }

  /**
   * `tx` is a tenant-scoped client, not the bare connection.
   *
   * `invitations` is a tenant table with a RLS `WITH CHECK`, so an insert made
   * outside `withTenant` is refused — `nexa_current_license()` is null there.
   * Everything else in this service is pre-auth and cannot use a tenant context;
   * this one call is inside a workspace and must.
   */
  async createInvitations(
    tx: TenantClient,
    tenant: { licenseId: bigint; organizationId: string },
    inviter: { accountId: string; role: AgentRole },
    emails: string[],
    role: InvitableRole,
  ): Promise<InvitationRecord[]> {
    // An agent minting an owner or admin invitation would be promoting
    // themselves through the side door.
    if (ROLE_RANK[role] > ROLE_RANK[inviter.role]) {
      throw ApiError.authorization('You cannot invite someone above your own role.');
    }

    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];

    const records: InvitationRecord[] = [];
    for (const email of unique) {
      const { token, hash } = newToken();

      // Replaces any outstanding invitation for the same address rather than
      // adding a second live link to the same workspace.
      const [row] = await tx.$queryRaw<Array<{ id: string; created_at: Date; expires_at: Date }>>`
        INSERT INTO invitations
          (id, license_id, organization_id, email, role, token_hash, invited_by_id, expires_at)
        VALUES
          (gen_random_uuid(), ${tenant.licenseId}, ${tenant.organizationId}::uuid,
           ${email}::citext, ${role}, ${hash}, ${inviter.accountId}::uuid, ${expiresAt})
        ON CONFLICT (license_id, email) WHERE accepted_at IS NULL
        DO UPDATE SET token_hash = EXCLUDED.token_hash,
                      role       = EXCLUDED.role,
                      expires_at = EXCLUDED.expires_at,
                      created_at = now()
        RETURNING id, created_at, expires_at`;

      if (!row) continue;
      records.push({
        id: row.id,
        email,
        role,
        invited_by_name: null,
        expires_at: row.expires_at.toISOString(),
        created_at: row.created_at.toISOString(),
        accept_url: this.acceptUrl(token),
      });
    }

    return records;
  }

  /** The shareable link behind "Copy invite link" (FR-MOD-04.3.1). */
  acceptUrl(token: string): string {
    return `${this.#appUrl}/join?token=${encodeURIComponent(token)}`;
  }

  async previewInvitation(token: string): Promise<{
    organization_name: string;
    email: string;
    role: InvitableRole;
    needs_password: boolean;
  }> {
    const rows = await this.#db.$queryRaw<
      Array<{
        organization_name: string;
        email: string;
        role: InvitableRole;
        needs_password: boolean;
      }>
    >`SELECT * FROM auth_preview_invitation(${hashToken(token)})`;

    const row = rows[0];
    if (!row) throw ApiError.authentication('This invitation is no longer valid.');
    return row;
  }

  async acceptInvitation(input: {
    token: string;
    name?: string;
    password?: string;
  }): Promise<AcceptedInvitation> {
    const passwordHash = input.password ? await hashPassword(input.password) : null;

    // The function returns the account's email and name as well as its id. The
    // obvious follow-up query would run with no tenant context — the person has
    // only just joined — and row level security would filter it away, failing
    // the request *after* the invitation had been consumed.
    const rows = await this.#db.$queryRaw<
      Array<{
        joined_account: string;
        joined_license: bigint;
        joined_email: string;
        joined_name: string;
      }>
    >`SELECT * FROM auth_accept_invitation(
        ${hashToken(input.token)}, ${input.name ?? null}, ${passwordHash})`;

    const row = rows[0];
    if (!row) throw ApiError.authentication('This invitation is no longer valid.');

    return {
      session: {
        account: { id: row.joined_account, email: row.joined_email, name: row.joined_name },
        memberships: await this.#membershipsOf(row.joined_account),
      },
      licenseId: row.joined_license,
    };
  }

  /**
   * Reuses the same SECURITY DEFINER function login does.
   *
   * A hand-written query here would run as the application role with no tenant
   * context, and row level security would quietly return an empty list — which
   * is exactly what happened before this was changed: signup succeeded and
   * reported the new owner as belonging to no workspace.
   */
  async #membershipsOf(accountId: string): Promise<Membership[]> {
    return this.#db.$queryRaw<Membership[]>`
      SELECT license_id::text AS license_id,
             organization_id::text AS organization_id,
             organization_name,
             role,
             license_status,
             client_id
      FROM auth_list_memberships(${accountId}::uuid)`;
  }
}

function isAccountExists(error: unknown): boolean {
  return error instanceof Error && /nexa_account_exists/.test(error.message);
}

/** Constant-time compare, kept here so the token path never reaches for `===`. */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
