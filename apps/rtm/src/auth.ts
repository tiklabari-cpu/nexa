/**
 * Socket authentication.
 *
 * Resolves the same opaque tokens the REST API issues, through the same
 * SECURITY DEFINER function, so a token revoked over HTTP stops working on the
 * socket immediately — two independent implementations would inevitably drift,
 * and the drift would be an authorization hole.
 *
 * Customer tokens are verified locally: they are HMAC-signed and stateless, so
 * checking one costs no database round-trip, which matters when every visitor
 * to a busy site opens a socket.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { REGIONS, scopesWithinRole, servesRegion, type AgentRole, type Region } from '@nexa/types';

export interface SocketPrincipal {
  kind: 'agent' | 'bot' | 'customer';
  actorId: string;
  licenseId: string;
  organizationId: string;
  scopes: string[];
  /** Teams the agent belongs to; empty for customers and unrestricted tokens. */
  groupIds: number[];
  /** True when the token may see every chat in the license. */
  unrestricted: boolean;
}

export type AuthFailure =
  | 'malformed'
  | 'unknown'
  | 'expired'
  | 'revoked'
  | 'membership_missing'
  | 'organization_mismatch'
  | 'region_mismatch';

/**
 * A refusal, and — for the one refusal that is not about the credential —
 * where the caller should have gone instead.
 *
 * `region_mismatch` carries its region because the socket answers it the same
 * way the REST edge does, with `misdirected_request` and the workspace's own
 * region in `details`. Every other failure deliberately tells the caller
 * nothing: distinguishing "expired" from "never existed" confirms which tokens
 * are real, whereas a residency answer is given to somebody already holding a
 * valid credential for that workspace.
 */
export type AuthResult =
  | { ok: true; principal: SocketPrincipal }
  | { ok: false; reason: Exclude<AuthFailure, 'region_mismatch'> }
  | { ok: false; reason: 'region_mismatch'; region: Region };

const CUSTOMER_PREFIX = 'nxc1';

interface ResolvedTokenRow {
  id: string;
  license_id: bigint;
  organization_id: string;
  owner_id: string;
  /**
   * Read straight out of `auth_resolve_token`, so this is what the *column*
   * says, not a promise about it. The API mints kinds this gateway has no
   * concept of ('scim', 'enrollment'), which is why `#authenticateAgent`
   * allow-lists the three below rather than assuming them.
   */
  kind: string;
  scopes: string[];
  expires_at: Date | null;
  revoked_at: Date | null;
  license_status: string;
  /** The tenant root's own column — see the residency check in `authenticate`. */
  organization_region: string;
}

export class SocketAuthenticator {
  constructor(
    private readonly db: PrismaClient,
    private readonly customerTokenSecret: string,
    /**
     * The region this gateway serves (`NEXA_REGION`), read from the same
     * variable and validated by the same schema as the API's (C4-a). It is the
     * left-hand side of every residency comparison below; the right-hand side
     * is always the workspace's own.
     */
    private readonly region: Region,
  ) {}

  /**
   * `organizationId` comes from the connection URL and is checked against the
   * token. Without that check a valid token could be used on a socket opened
   * for a different tenant, and every subsequent audience filter — which keys
   * on the connection's organization — would be evaluated against the wrong one.
   */
  async authenticate(rawToken: string, organizationId: string): Promise<AuthResult> {
    const token = rawToken.replace(/^Bearer\s+/i, '').trim();
    if (!token) return { ok: false, reason: 'malformed' };

    if (token.startsWith(`${CUSTOMER_PREFIX}.`)) {
      return this.#authenticateCustomer(token, organizationId);
    }
    return this.#authenticateAgent(token, organizationId);
  }

  async #authenticateAgent(token: string, organizationId: string): Promise<AuthResult> {
    const hash = createHash('sha256').update(token, 'utf8').digest('base64url');

    const rows = await this.db.$queryRaw<ResolvedTokenRow[]>`
      SELECT * FROM auth_resolve_token(${hash})
    `;
    const row = rows[0];
    if (!row) return { ok: false, reason: 'unknown' };
    if (row.revoked_at) return { ok: false, reason: 'revoked' };
    if (row.expires_at && row.expires_at.getTime() <= Date.now()) {
      return { ok: false, reason: 'expired' };
    }
    if (row.organization_id !== organizationId) {
      return { ok: false, reason: 'organization_mismatch' };
    }
    // Only the three credential kinds that mean "a person or a bot working in
    // this workspace" open a socket. The API mints others — a SCIM provisioning
    // token, and since S11-2FA-k a two-factor enrollment ticket — and both are
    // refused at the REST edge by the route's `principals` list, a mechanism
    // this process does not have. Without this line they would fall through to
    // the `kind === 'bot' ? 'bot' : 'agent'` below and be handed an agent
    // socket: "refused over HTTP, live over the socket" is the same split the
    // residency check three lines down exists to prevent.
    //
    // An allow-list rather than a deny-list, so the next kind somebody adds is
    // closed here until it is deliberately opened.
    if (row.kind !== 'pat' && row.kind !== 'oauth' && row.kind !== 'bot') {
      return { ok: false, reason: 'unknown' };
    }
    // Data residency (NFR-C4 · C4-b). The API refuses the same credential at its
    // own edge; this gateway is a *separate process* and would otherwise keep
    // serving a workspace the REST surface has stopped answering for — the
    // "refused over HTTP, live over the socket" split that makes a residency
    // guarantee worthless. Before the membership and group reads below, because
    // those already read the workspace's data.
    if (!servesRegion(this.region, row.organization_region)) {
      return { ok: false, reason: 'region_mismatch', region: row.organization_region as Region };
    }
    if (row.license_status === 'canceled') return { ok: false, reason: 'expired' };

    // Role and suspension live on the membership, so a suspended agent's
    // existing socket credential stops working at once — and, since tm 146, so
    // does a demoted one's reach. Read before the visibility decision below,
    // which now depends on it; it used to run after, which cost a needless
    // group query for a credential that was about to be refused anyway.
    let role: AgentRole | null = null;
    if (row.kind !== 'bot') {
      role = await this.#membershipRole(row.license_id, row.organization_id, row.owner_id);
      if (!role) return { ok: false, reason: 'membership_missing' };
    }

    // `chats--all` is what widens a socket from "my teams" to "the whole
    // workspace", and on a session it is a role-derived scope. The REST edge
    // caps those against the role the account holds now
    // (`services/auth/token-service.ts`), so the socket does the same, through
    // the same shared function: an admin demoted to agent who is refused the
    // workspace's chats over HTTP must not keep being pushed them over the
    // socket. A personal access token keeps its list here for the same reason
    // it does there — see `scopesWithinRole` (@nexa/types).
    const scopes = role && row.kind === 'oauth' ? scopesWithinRole(role, row.scopes) : row.scopes;

    const unrestricted = scopes.some((s) => s === 'chats--all:ro' || s === 'chats--all:rw');
    const groupIds = unrestricted
      ? []
      : await this.#groupsFor(row.license_id, row.organization_id, row.owner_id);

    return {
      ok: true,
      principal: {
        kind: row.kind === 'bot' ? 'bot' : 'agent',
        actorId: row.owner_id,
        licenseId: row.license_id.toString(),
        organizationId: row.organization_id,
        scopes,
        groupIds,
        unrestricted,
      },
    };
  }

  #authenticateCustomer(token: string, organizationId: string): AuthResult {
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'malformed' };
    const [, body, signature] = parts as [string, string, string];

    const expected = createHmac('sha256', this.customerTokenSecret)
      .update(`${CUSTOMER_PREFIX}.${body}`)
      .digest('base64url');

    // Signature before parse: never interpret a payload that has not been
    // authenticated.
    if (!constantTimeEqual(expected, signature)) return { ok: false, reason: 'unknown' };

    let payload: { sub?: unknown; org?: unknown; lic?: unknown; rgn?: unknown; exp?: unknown };
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return { ok: false, reason: 'malformed' };
    }

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.org !== 'string' ||
      typeof payload.lic !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      return { ok: false, reason: 'malformed' };
    }
    // The mint wrote the workspace's region into the signed payload (C4-b), so
    // this gateway reaches the API's answer without a database round-trip —
    // which is the whole reason customer tokens are stateless. A token with no
    // region claim is refused rather than assumed to be local: "no claim means
    // here" is the reading under which a token minted in another region passes.
    if (!REGIONS.includes(payload.rgn as Region)) return { ok: false, reason: 'malformed' };
    if (payload.exp * 1000 <= Date.now()) return { ok: false, reason: 'expired' };
    if (payload.org !== organizationId) return { ok: false, reason: 'organization_mismatch' };
    if (!servesRegion(this.region, payload.rgn as Region)) {
      return { ok: false, reason: 'region_mismatch', region: payload.rgn as Region };
    }

    return {
      ok: true,
      principal: {
        kind: 'customer',
        actorId: payload.sub,
        licenseId: payload.lic,
        organizationId: payload.org,
        scopes: [],
        groupIds: [],
        unrestricted: false,
      },
    };
  }

  /**
   * Resolve a bearer token to the role behind it, with no organization to bind
   * to (M-SEC-b2 · §D116 MEDIUM (b)). `/health` is an ops surface reporting on
   * *this process*, not any one tenant's data, so the residency and
   * organization-match checks `authenticate` enforces for a chat socket do not
   * apply — there is no `organization_id` for a health probe to have gotten
   * right or wrong. Customer tokens are never staff and resolve to `null`
   * without a lookup; a bot token has no membership to hold a role, likewise
   * `null`.
   */
  async resolveAdminRole(rawToken: string): Promise<AgentRole | null> {
    const token = rawToken.replace(/^Bearer\s+/i, '').trim();
    if (!token || token.startsWith(`${CUSTOMER_PREFIX}.`)) return null;

    const hash = createHash('sha256').update(token, 'utf8').digest('base64url');
    const rows = await this.db.$queryRaw<ResolvedTokenRow[]>`
      SELECT * FROM auth_resolve_token(${hash})
    `;
    const row = rows[0];
    if (!row) return null;
    if (row.revoked_at) return null;
    if (row.expires_at && row.expires_at.getTime() <= Date.now()) return null;
    if (row.license_status === 'canceled') return null;
    // Same allow-list as `#authenticateAgent`, and for the same reason: a bot
    // token has no membership to hold a role, and a SCIM or enrollment
    // credential (S11-2FA-k) must not be able to read an ops surface the API
    // would refuse it. Only the two kinds a *person* presents get this far.
    if (row.kind !== 'pat' && row.kind !== 'oauth') return null;

    return this.#membershipRole(row.license_id, row.organization_id, row.owner_id);
  }

  /**
   * The role behind a live membership, or `null` when there is none to speak
   * of — removed, suspended, or still awaiting approval. One read answers both
   * questions the login needs (may this credential connect at all, and how far
   * may it see), so the two can never be answered from different rows.
   */
  async #membershipRole(
    licenseId: bigint,
    organizationId: string,
    agentId: string,
  ): Promise<AgentRole | null> {
    const rows = await this.#scoped(
      licenseId,
      organizationId,
      (tx) =>
        tx.$queryRaw<Array<{ role: string }>>`
        SELECT role FROM agent_memberships
        WHERE license_id = ${licenseId} AND agent_id = ${agentId}::uuid
          AND NOT suspended AND NOT awaiting_approval
        LIMIT 1
      `,
    );
    return (rows[0]?.role as AgentRole | undefined) ?? null;
  }

  async #groupsFor(licenseId: bigint, organizationId: string, agentId: string): Promise<number[]> {
    const rows = await this.#scoped(
      licenseId,
      organizationId,
      (tx) =>
        tx.$queryRaw<Array<{ group_id: bigint }>>`
        SELECT group_id FROM group_agents WHERE agent_id = ${agentId}::uuid
      `,
    );
    return rows.map((r) => Number(r.group_id));
  }

  /** Reads through the same tenant context the REST API uses, so RLS applies. */
  async #scoped<T>(
    licenseId: bigint,
    organizationId: string,
    fn: (tx: PrismaClient) => Promise<T>,
  ): Promise<T> {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_license', ${licenseId.toString()}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_organization', ${organizationId}, true)`;
      return fn(tx as unknown as PrismaClient);
    });
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // Comparing digests keeps the timing uniform even for a length mismatch.
    const l = createHash('sha256').update(left).digest();
    const r = createHash('sha256').update(right).digest();
    timingSafeEqual(l, r);
    return false;
  }
  return timingSafeEqual(left, right);
}
