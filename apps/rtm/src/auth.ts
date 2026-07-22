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
  'malformed' | 'unknown' | 'expired' | 'revoked' | 'membership_missing' | 'organization_mismatch';

export type AuthResult =
  { ok: true; principal: SocketPrincipal } | { ok: false; reason: AuthFailure };

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
}

export class SocketAuthenticator {
  constructor(
    private readonly db: PrismaClient,
    private readonly customerTokenSecret: string,
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

    let payload: { sub?: unknown; org?: unknown; lic?: unknown; exp?: unknown };
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
    if (payload.exp * 1000 <= Date.now()) return { ok: false, reason: 'expired' };
    if (payload.org !== organizationId) return { ok: false, reason: 'organization_mismatch' };

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
