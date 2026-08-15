/**
 * Bearer credential issuance and resolution.
 *
 * Tokens are opaque and stored only as SHA-256 digests (I2). The plaintext
 * exists exactly once, in the response that creates it; a database dump yields
 * nothing an attacker can present.
 *
 * Resolution runs through the SECURITY DEFINER `auth_resolve_token` function
 * because it is the step that *determines* the tenant, so it cannot already be
 * inside a tenant context.
 */
import type { PrismaClient } from '@prisma/client';
import type { AgentRole, Region } from '@nexa/types';
import { generateToken, hashToken } from '../../lib/crypto.js';
import { withTenant, type TenantClient } from '../../lib/tenant.js';
import type { Principal } from './principal.js';

/** v2-03 §8.6: at most 25 live access tokens per (client, user). */
export const MAX_ACTIVE_TOKENS_PER_OWNER = 25;

export interface IssuedToken {
  /** Returned to the caller once and never recoverable afterwards. */
  token: string;
  id: string;
  expiresAt: Date | null;
  scopes: string[];
}

/** Every bearer credential this product mints, by what it is allowed to reach. */
export type TokenKind = 'pat' | 'oauth' | 'bot' | 'scim';

interface ResolvedTokenRow {
  id: string;
  license_id: bigint;
  organization_id: string;
  owner_id: string;
  kind: TokenKind;
  scopes: string[];
  client_id: string | null;
  family_id: string | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  license_status: string;
  organization_region: string;
}

export type TokenRejection =
  'unknown' | 'revoked' | 'expired' | 'idle_expired' | 'license_expired' | 'membership_missing';

export type TokenResolution =
  /**
   * `region` is the *workspace's* region (`organizations.region`), which is
   * what the residency gate in `plugins/auth.ts` compares against. It is not
   * the region this process serves — telling the two apart is the whole of
   * C4-b.
   */
  | { ok: true; principal: Principal; licenseStatus: string; region: Region }
  | { ok: false; reason: TokenRejection };

export class TokenService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Resolve a bearer token to a principal.
   *
   * Returns a reason rather than throwing so the caller can log precisely why a
   * token failed while still answering the client with one undifferentiated
   * `authentication` error — distinguishing "expired" from "never existed" in
   * the response would confirm which tokens are real.
   */
  async resolve(token: string): Promise<TokenResolution> {
    const rows = await this.db.$queryRaw<ResolvedTokenRow[]>`
      SELECT * FROM auth_resolve_token(${hashToken(token)})
    `;
    const row = rows[0];
    if (!row) return { ok: false, reason: 'unknown' };
    if (row.revoked_at) return { ok: false, reason: 'revoked' };
    if (row.expires_at && row.expires_at.getTime() <= Date.now()) {
      return { ok: false, reason: 'expired' };
    }
    if (row.license_status === 'canceled') return { ok: false, reason: 'license_expired' };

    // The column is `TEXT` in the row type because that is what Postgres hands
    // back; the CHECK constraint on `organizations.region` is what makes the
    // narrowing true, and `region.test.ts` reads that constraint back against
    // `REGIONS` so the two cannot drift apart unnoticed.
    const region = row.organization_region as Region;

    if (row.kind === 'bot') {
      return {
        ok: true,
        licenseStatus: row.license_status,
        region,
        principal: {
          kind: 'bot',
          botId: row.owner_id,
          licenseId: row.license_id,
          organizationId: row.organization_id,
          scopes: row.scopes,
          tokenId: row.id,
          tokenKind: 'bot',
        },
      };
    }

    // A SCIM token belongs to a workspace's directory connector, not to a
    // person, so it resolves without a membership lookup — and, crucially,
    // *before* the one below. `owner_id` on these rows records which admin
    // minted the credential; falling through would resolve that admin's
    // membership and hand a provisioning connector their role, which is
    // precisely the escalation this branch exists to make impossible. What the
    // token may then reach is decided by the route's `principals` list, in
    // `plugins/auth.ts`, like every other principal kind.
    if (row.kind === 'scim') {
      return {
        ok: true,
        licenseStatus: row.license_status,
        region,
        principal: {
          kind: 'scim',
          licenseId: row.license_id,
          organizationId: row.organization_id,
          tokenId: row.id,
          tokenKind: 'scim',
          scopes: [],
        },
      };
    }

    // The role lives on the membership, not the token: revoking someone's admin
    // rights must take effect on their existing tokens immediately, not when
    // they next sign in. The same transaction also enforces the idle-session
    // policy for oauth tokens, so reading `last_used_at` and revoking on expiry
    // commit together.
    const context = { licenseId: row.license_id, organizationId: row.organization_id };
    const check = await withTenant(
      this.db,
      context,
      async (
        tx,
      ): Promise<{ ok: false; reason: TokenRejection } | { ok: true; role: AgentRole }> => {
        const membership = await tx.agentMembership.findUnique({
          where: { licenseId_agentId: { licenseId: row.license_id, agentId: row.owner_id } },
          select: { role: true, suspended: true, awaitingApproval: true },
        });
        if (!membership || membership.suspended || membership.awaitingApproval) {
          return { ok: false, reason: 'membership_missing' };
        }
        // Idle timeout is a *session* policy: it governs oauth access tokens — the
        // credential a browser sign-in mints and refreshes. Personal access and
        // bot tokens are named, long-lived credentials a human pasted into a
        // script; expiring one for inactivity would be a mystery outage, the same
        // reason #pruneOldest leaves them alone.
        if (row.kind === 'oauth' && (await this.#idleExpired(tx, row.id))) {
          return { ok: false, reason: 'idle_expired' };
        }
        return { ok: true, role: membership.role as AgentRole };
      },
    );

    if (!check.ok) return { ok: false, reason: check.reason };

    return {
      ok: true,
      licenseStatus: row.license_status,
      region,
      principal: {
        kind: 'agent',
        accountId: row.owner_id,
        licenseId: row.license_id,
        organizationId: row.organization_id,
        role: check.role,
        scopes: row.scopes,
        tokenId: row.id,
        tokenKind: row.kind,
      },
    };
  }

  /**
   * Whether an oauth session has been idle past its licence's configured window,
   * revoking it in the caller's transaction when so. A null window (the default)
   * disables the policy, so behaviour is byte-identical to before it was set.
   *
   * `last_used_at` is written by touch() (plugins/auth.ts) fire-and-forget AFTER
   * resolve() returns, so the value read here is the *previous* request's
   * activity — exactly the window "idle" measures. Two concurrent requests may
   * read the same pre-touch value; that is safe because the comparison is
   * monotonic in `lastActive`: a staler read can only push a session over the
   * edge, never admit one that should have expired. The race is fail-closed.
   */
  async #idleExpired(tx: TenantClient, tokenId: string): Promise<boolean> {
    const settings = await tx.securitySettings.findFirst({
      select: { sessionIdleTimeoutSeconds: true },
    });
    const timeoutSeconds = settings?.sessionIdleTimeoutSeconds ?? null;
    // Common case: no policy set, so nothing further to read or enforce.
    if (timeoutSeconds === null) return false;

    const token = await tx.apiToken.findUnique({
      where: { id: tokenId },
      select: { lastUsedAt: true, createdAt: true },
    });
    if (!token) return false;

    // A token that has never been used measures inactivity from when it was minted.
    const lastActive = token.lastUsedAt ?? token.createdAt;
    if (Date.now() - lastActive.getTime() <= timeoutSeconds * 1000) return false;

    // The session is over. Revoke durably so every later request fails with the
    // undifferentiated `revoked` reason without recomputing the window; the null
    // guard keeps it idempotent under the concurrent-request race above.
    await tx.apiToken.updateMany({
      where: { id: tokenId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return true;
  }

  /** Fire-and-forget: a failed bookkeeping update must not fail the request. */
  touch(tokenId: string): void {
    void this.db.$executeRaw`SELECT auth_touch_token(${tokenId}::uuid)`.catch(() => undefined);
  }

  async issue(input: {
    licenseId: bigint;
    organizationId: string;
    ownerId: string;
    kind: TokenKind;
    scopes: string[];
    name?: string;
    clientId?: string;
    familyId?: string;
    ttlSeconds?: number;
  }): Promise<IssuedToken> {
    const token = generateToken();
    const expiresAt = input.ttlSeconds ? new Date(Date.now() + input.ttlSeconds * 1000) : null;

    const created = await withTenant(
      this.db,
      { licenseId: input.licenseId, organizationId: input.organizationId },
      async (tx) => {
        const record = await tx.apiToken.create({
          data: {
            licenseId: input.licenseId,
            organizationId: input.organizationId,
            ownerId: input.ownerId,
            kind: input.kind,
            tokenHash: hashToken(token),
            scopes: input.scopes,
            name: input.name ?? null,
            clientId: input.clientId ?? null,
            familyId: input.familyId ?? null,
            expiresAt,
          },
          select: { id: true, expiresAt: true, scopes: true },
        });

        await this.#pruneOldest(tx, input.licenseId, input.ownerId, input.kind);
        return record;
      },
    );

    return { token, id: created.id, expiresAt: created.expiresAt, scopes: created.scopes };
  }

  async revoke(input: {
    licenseId: bigint;
    organizationId: string;
    tokenId: string;
  }): Promise<boolean> {
    const result = await withTenant(
      this.db,
      { licenseId: input.licenseId, organizationId: input.organizationId },
      (tx) =>
        tx.apiToken.updateMany({
          where: { id: input.tokenId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
    );
    return result.count > 0;
  }

  /**
   * Resolve and revoke by presented token, returning what was revoked — the
   * tenant and token id `/auth/revoke` needs to record `auth.token_revoked`
   * (C6-a2). `null` covers both "no such token" and "already revoked", which
   * RFC 7009 requires this endpoint to answer identically either way.
   */
  async revokeByToken(
    token: string,
  ): Promise<{ id: string; licenseId: bigint; organizationId: string } | null> {
    const resolution = await this.resolve(token);
    if (!resolution.ok) return null;
    const { principal } = resolution;
    if (principal.kind === 'customer') return null;
    const revoked = await this.revoke({
      licenseId: principal.licenseId,
      organizationId: principal.organizationId,
      tokenId: principal.tokenId,
    });
    if (!revoked) return null;
    return {
      id: principal.tokenId,
      licenseId: principal.licenseId,
      organizationId: principal.organizationId,
    };
  }

  async list(input: {
    licenseId: bigint;
    organizationId: string;
    ownerId: string;
    kind?: TokenKind;
  }) {
    return withTenant(
      this.db,
      { licenseId: input.licenseId, organizationId: input.organizationId },
      (tx) =>
        tx.apiToken.findMany({
          where: {
            ownerId: input.ownerId,
            ...(input.kind ? { kind: input.kind } : {}),
            revokedAt: null,
          },
          select: {
            id: true,
            name: true,
            kind: true,
            scopes: true,
            createdAt: true,
            lastUsedAt: true,
            expiresAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
    );
  }

  /**
   * Every live token of one kind in a workspace, regardless of who minted it.
   *
   * Its own method rather than an optional `ownerId` on `list()`: that one is
   * the personal-access-token surface, where dropping the owner filter would
   * turn "my tokens" into "everybody's" the first time a caller forgot an
   * argument. A SCIM credential genuinely belongs to the workspace and not to a
   * person, so the widening is stated here, once, on purpose.
   */
  async listWorkspaceTokens(input: { licenseId: bigint; organizationId: string; kind: TokenKind }) {
    return withTenant(
      this.db,
      { licenseId: input.licenseId, organizationId: input.organizationId },
      (tx) =>
        tx.apiToken.findMany({
          where: { kind: input.kind, revokedAt: null },
          select: {
            id: true,
            name: true,
            ownerId: true,
            createdAt: true,
            lastUsedAt: true,
            expiresAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
    );
  }

  /**
   * Enforce the per-owner concurrent-session cap by revoking the oldest
   * surviving tokens.
   *
   * Only OAuth access tokens are pruned. Personal access tokens are named,
   * long-lived credentials a human pasted into a script — silently revoking one
   * because a browser session refreshed 25 times would be a mystery outage.
   *
   * The cap is the licence's `max_concurrent_sessions`; a null column falls back
   * to the fixed ceiling, so behaviour is unchanged until a workspace sets one.
   */
  async #pruneOldest(
    tx: TenantClient,
    licenseId: bigint,
    ownerId: string,
    kind: TokenKind,
  ): Promise<void> {
    if (kind !== 'oauth') return;

    // Serialize concurrent mints for this owner. `withTenant` runs at READ
    // COMMITTED, so without this two parallel issue() calls each insert their
    // token and then count the live set *without seeing the other's uncommitted
    // row* — both under-prune and the survivors settle one over the cap. A
    // transaction-scoped advisory lock keyed on (license, owner) makes
    // count-then-revoke a critical section: the second mint blocks until the
    // first commits, then counts a view that includes it. The lock releases
    // automatically at commit/rollback, and each owner takes a distinct key, so
    // it neither deadlocks nor serializes unrelated mints.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext('nexa.session-cap'), hashtext(${`${licenseId}:${ownerId}`}))
    `;

    // Read the cap inside the locked transaction so a concurrent policy change
    // cannot race the prune it governs.
    const settings = await tx.securitySettings.findFirst({
      select: { maxConcurrentSessions: true },
    });
    const cap = settings?.maxConcurrentSessions ?? MAX_ACTIVE_TOKENS_PER_OWNER;

    const live = await tx.apiToken.findMany({
      where: { licenseId, ownerId, kind: 'oauth', revokedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      skip: cap,
    });
    if (live.length === 0) return;

    await tx.apiToken.updateMany({
      where: { id: { in: live.map((t) => t.id) } },
      data: { revokedAt: new Date() },
    });
  }
}
