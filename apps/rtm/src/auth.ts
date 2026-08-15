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
import { REGIONS, servesRegion, type Region } from '@nexa/types';

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
  kind: 'pat' | 'oauth' | 'bot';
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

    const unrestricted = row.scopes.some((s) => s === 'chats--all:ro' || s === 'chats--all:rw');
    const groupIds = unrestricted
      ? []
      : await this.#groupsFor(row.license_id, row.organization_id, row.owner_id);

    if (row.kind !== 'bot') {
      // Role and suspension live on the membership, so a suspended agent's
      // existing socket credential stops working at once.
      const membership = await this.#membership(row.license_id, row.organization_id, row.owner_id);
      if (!membership) return { ok: false, reason: 'membership_missing' };
    }

    return {
      ok: true,
      principal: {
        kind: row.kind === 'bot' ? 'bot' : 'agent',
        actorId: row.owner_id,
        licenseId: row.license_id.toString(),
        organizationId: row.organization_id,
        scopes: row.scopes,
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

  async #membership(licenseId: bigint, organizationId: string, agentId: string): Promise<boolean> {
    const rows = await this.#scoped(
      licenseId,
      organizationId,
      (tx) =>
        tx.$queryRaw<Array<{ ok: boolean }>>`
        SELECT true AS ok FROM agent_memberships
        WHERE license_id = ${licenseId} AND agent_id = ${agentId}::uuid
          AND NOT suspended AND NOT awaiting_approval
        LIMIT 1
      `,
    );
    return rows.length > 0;
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
