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
import type { TenantClient } from '../../lib/tenant.js';
import { hashPassword } from '../../lib/crypto.js';
import type { AgentRole } from '@nexa/types';
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
  }): Promise<Session> {
    const passwordHash = await hashPassword(input.password);

    let created: Array<{ created_account: string; created_license: bigint }>;
    try {
      created = await this.#db.$queryRaw`
        SELECT * FROM auth_signup(
          ${input.email}::citext, ${input.name}, ${passwordHash},
          ${input.organizationName}, ${TRIAL_DAYS}::int
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

    return {
      account: { id: row.created_account, email: input.email, name: input.name },
      memberships: await this.#membershipsOf(row.created_account),
    };
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

  async confirmPasswordReset(token: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    const rows = await this.#db.$queryRaw<Array<{ reset_account: string }>>`
      SELECT * FROM auth_consume_password_reset(${hashToken(token)}, ${passwordHash})`;

    if (rows.length === 0) {
      // Unknown, expired and already-used are one answer: each distinction
      // would tell someone holding a stale link something about the account.
      throw ApiError.authentication('This reset link is no longer valid.');
    }
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
  }): Promise<Session> {
    const passwordHash = input.password ? await hashPassword(input.password) : null;

    // The function returns the account's email and name as well as its id. The
    // obvious follow-up query would run with no tenant context — the person has
    // only just joined — and row level security would filter it away, failing
    // the request *after* the invitation had been consumed.
    const rows = await this.#db.$queryRaw<
      Array<{ joined_account: string; joined_email: string; joined_name: string }>
    >`SELECT * FROM auth_accept_invitation(
        ${hashToken(input.token)}, ${input.name ?? null}, ${passwordHash})`;

    const row = rows[0];
    if (!row) throw ApiError.authentication('This invitation is no longer valid.');

    return {
      account: { id: row.joined_account, email: row.joined_email, name: row.joined_name },
      memberships: await this.#membershipsOf(row.joined_account),
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
