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
import {
  REGIONS,
  capabilitiesForRole,
  credentialGrantFor,
  narrowsChatReach,
  scopesForCredential,
  servesRegion,
  type AgentRole,
  type CredentialGrant,
  type LogContext,
  type PermissionMatrixCache,
  type Region,
} from '@siyahtus/types';

/**
 * What a member's socket was authorised from, kept on the connection so its
 * reach can be derived again when the permission matrix moves (RL-02 · tm
 * 325.3) — without the token, which the gateway does not keep.
 */
export interface SocketAuthority {
  /** Which rule the token follows (`credential-scopes.ts`); fixed by the token. */
  grant: CredentialGrant;
  /** The token row's own list — what `scopesForCredential` reads. */
  stored: readonly string[];
  /** The matrix version the socket's current reach was derived at. */
  version: number;
}

/** How far a member's socket reaches: what the fan-out and the reads key on. */
export interface SocketReach {
  scopes: string[];
  groupIds: number[];
  unrestricted: boolean;
  version: number;
}

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
  /** A member's socket's basis for re-derivation; null for bots and customers. */
  authority: SocketAuthority | null;
}

/** The identity half of a log line written for this principal (ID-08 · `LOG_KEYS`). */
export function principalLogContext(principal: SocketPrincipal): LogContext {
  return {
    license_id: principal.licenseId,
    organization_id: principal.organizationId,
    actor_type: principal.kind,
    actor_id: principal.actorId,
  };
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
  /** The OAuth client a session was issued to — which rule it follows (tm 325.3). */
  client_id: string | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  license_status: string;
  /** The tenant root's own column — see the residency check in `authenticate`. */
  organization_region: string;
}

/** The membership facts a member's socket is decided by, read in one statement. */
interface MemberFacts {
  /** Null when the membership is gone, suspended or still awaiting approval. */
  role: string | null;
  version: number;
  sign_in_client: boolean;
}

export class SocketAuthenticator {
  constructor(
    private readonly db: PrismaClient,
    private readonly customerTokenSecret: string,
    /**
     * The region this gateway serves (`SIYAHTUS_REGION`), read from the same
     * variable and validated by the same schema as the API's (C4-a). It is the
     * left-hand side of every residency comparison below; the right-hand side
     * is always the workspace's own.
     */
    private readonly region: Region,
    /**
     * Each workspace's permission matrix (RL-02 · tm 325.3) — the same cache
     * class and rules the API resolves a token through, with this process's
     * loader, so a socket and a REST call holding one token reach one answer.
     */
    private readonly matrix: PermissionMatrixCache,
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

    // A bot has no membership and no role: its scopes are its whole answer.
    if (row.kind === 'bot') {
      const unrestricted = row.scopes.some((s) => s === 'chats--all:ro' || s === 'chats--all:rw');
      const groupIds = unrestricted
        ? []
        : await this.#groupsFor(row.license_id, row.organization_id, row.owner_id);
      return {
        ok: true,
        principal: {
          kind: 'bot',
          actorId: row.owner_id,
          licenseId: row.license_id.toString(),
          organizationId: row.organization_id,
          scopes: row.scopes,
          groupIds,
          unrestricted,
          authority: null,
        },
      };
    }

    // Role and suspension live on the membership, so a suspended agent's
    // existing socket credential stops working at once — and, since tm 146, so
    // does a demoted one's reach. Read before the visibility decision below,
    // which depends on it, together with the permission matrix's version and
    // whether the token came from the workspace's sign-in client (tm 325.3).
    const facts = await this.#memberFacts(
      row.license_id,
      row.organization_id,
      row.owner_id,
      row.client_id,
    );
    if (!facts?.role) return { ok: false, reason: 'membership_missing' };

    const authority: SocketAuthority = {
      grant: credentialGrantFor(row.kind, facts.sign_in_client),
      stored: row.scopes,
      version: facts.version,
    };
    const reach = await this.#reach(
      row.license_id,
      row.organization_id,
      row.owner_id,
      facts.role,
      authority,
      facts.version,
    );

    return {
      ok: true,
      principal: {
        kind: 'agent',
        actorId: row.owner_id,
        licenseId: row.license_id.toString(),
        organizationId: row.organization_id,
        scopes: reach.scopes,
        groupIds: reach.groupIds,
        unrestricted: reach.unrestricted,
        authority: { ...authority, version: reach.version },
      },
    };
  }

  /**
   * A member's socket's reach derived again from the role and the matrix as
   * they stand now — what an open socket gets when the matrix moves, so a
   * Founder's change reaches it without a new login (RL-02 · tm 325.3). A
   * membership that is gone narrows the socket to nothing rather than leaving
   * it as it was; the next login is refused outright.
   */
  async reassess(target: {
    licenseId: string;
    organizationId: string;
    actorId: string;
    authority: SocketAuthority;
  }): Promise<SocketReach> {
    const licenseId = BigInt(target.licenseId);
    const facts = await this.#memberFacts(licenseId, target.organizationId, target.actorId, null);
    if (!facts?.role) {
      return {
        scopes: [],
        groupIds: [],
        unrestricted: false,
        version: facts?.version ?? target.authority.version,
      };
    }
    return this.#reach(
      licenseId,
      target.organizationId,
      target.actorId,
      facts.role,
      target.authority,
      facts.version,
    );
  }

  /** The workspace's current permission-matrix version — what the gateway's sweep compares. */
  async matrixVersion(licenseId: string, organizationId: string): Promise<number> {
    const id = BigInt(licenseId);
    const rows = await this.#scoped(
      id,
      organizationId,
      (tx) =>
        tx.$queryRaw<Array<{ version: number }>>`
        SELECT permissions_version AS version FROM licenses WHERE id = ${id}
      `,
    );
    return rows[0]?.version ?? 0;
  }

  /**
   * The scopes and the chat reach of a member's socket, by the rule the REST
   * edge resolves the same token with (`credential-scopes.ts`, tm 145): a
   * sign-in session follows the matrix both ways, a partner grant and a
   * personal token keep their own list less what the matrix takes from the
   * role. `chats--all` widens a socket from "my teams" to the whole workspace —
   * unless the member's own `chats.view` level is `own` or `none`, which keeps
   * the socket to the chats they are in, exactly as the inbox's visibility
   * rule does (`apps/api/src/services/chat/access.ts`).
   */
  async #reach(
    licenseId: bigint,
    organizationId: string,
    agentId: string,
    role: string,
    authority: SocketAuthority,
    version: number,
  ): Promise<SocketReach> {
    const snapshot = await this.matrix.get({ licenseId, organizationId }, version);
    const scopes = scopesForCredential({
      grant: authority.grant,
      role,
      stored: authority.stored,
      overrides: snapshot.overrides,
    });
    const narrowed = narrowsChatReach(capabilitiesForRole(role, snapshot.overrides)['chats.view']);
    const unrestricted =
      !narrowed && scopes.some((s) => s === 'chats--all:ro' || s === 'chats--all:rw');
    const groupIds =
      unrestricted || narrowed ? [] : await this.#groupsFor(licenseId, organizationId, agentId);
    return { scopes, groupIds, unrestricted, version: snapshot.version };
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
        authority: null,
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

  /**
   * The facts a member's socket is decided by, in one statement — the REST
   * edge reads the same three in one (`token-service.ts`): the role behind a
   * live membership (null when there is none to speak of), the permission
   * matrix's version, and whether `clientId` is the workspace's sign-in
   * client (registered with no scope list of its own). From the licence, so a
   * missing membership still answers with the version.
   */
  async #memberFacts(
    licenseId: bigint,
    organizationId: string,
    agentId: string,
    clientId: string | null,
  ): Promise<MemberFacts | null> {
    const rows = await this.#scoped(
      licenseId,
      organizationId,
      (tx) =>
        tx.$queryRaw<MemberFacts[]>`
        SELECT m.role, l.permissions_version AS version,
               COALESCE(cardinality(c.scopes) = 0, false) AS sign_in_client
          FROM licenses l
          LEFT JOIN agent_memberships m
                 ON m.license_id = l.id AND m.agent_id = ${agentId}::uuid
                AND NOT m.suspended AND NOT m.awaiting_approval
          LEFT JOIN oauth_clients c ON c.id = ${clientId}
         WHERE l.id = ${licenseId}
      `,
    );
    return rows[0] ?? null;
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
