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
import type { AgentRole } from '@nexa/types';
import { generateToken, hashToken } from '../../lib/crypto.js';
import { withTenant } from '../../lib/tenant.js';
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

interface ResolvedTokenRow {
  id: string;
  license_id: bigint;
  organization_id: string;
  owner_id: string;
  kind: 'pat' | 'oauth' | 'bot';
  scopes: string[];
  client_id: string | null;
  family_id: string | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  license_status: string;
  organization_region: string;
}

export type TokenRejection =
  'unknown' | 'revoked' | 'expired' | 'license_expired' | 'membership_missing';

export type TokenResolution =
  | { ok: true; principal: Principal; licenseStatus: string; region: string }
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

    if (row.kind === 'bot') {
      return {
        ok: true,
        licenseStatus: row.license_status,
        region: row.organization_region,
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

    // The role lives on the membership, not the token: revoking someone's admin
    // rights must take effect on their existing tokens immediately, not when
    // they next sign in.
    const membership = await withTenant(
      this.db,
      { licenseId: row.license_id, organizationId: row.organization_id },
      (tx) =>
        tx.agentMembership.findUnique({
          where: { licenseId_agentId: { licenseId: row.license_id, agentId: row.owner_id } },
          select: { role: true, suspended: true, awaitingApproval: true },
        }),
    );

    if (!membership || membership.suspended || membership.awaitingApproval) {
      return { ok: false, reason: 'membership_missing' };
    }

    return {
      ok: true,
      licenseStatus: row.license_status,
      region: row.organization_region,
      principal: {
        kind: 'agent',
        accountId: row.owner_id,
        licenseId: row.license_id,
        organizationId: row.organization_id,
        role: membership.role as AgentRole,
        scopes: row.scopes,
        tokenId: row.id,
        tokenKind: row.kind,
      },
    };
  }

  /** Fire-and-forget: a failed bookkeeping update must not fail the request. */
  touch(tokenId: string): void {
    void this.db.$executeRaw`SELECT auth_touch_token(${tokenId}::uuid)`.catch(() => undefined);
  }

  async issue(input: {
    licenseId: bigint;
    organizationId: string;
    ownerId: string;
    kind: 'pat' | 'oauth' | 'bot';
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

  async revokeByToken(token: string): Promise<boolean> {
    const resolution = await this.resolve(token);
    if (!resolution.ok) return false;
    const { principal } = resolution;
    if (principal.kind === 'customer') return false;
    return this.revoke({
      licenseId: principal.licenseId,
      organizationId: principal.organizationId,
      tokenId: principal.tokenId,
    });
  }

  async list(input: {
    licenseId: bigint;
    organizationId: string;
    ownerId: string;
    kind?: 'pat' | 'oauth' | 'bot';
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
   * Enforce the per-owner cap by revoking the oldest surviving tokens.
   *
   * Only OAuth access tokens are pruned. Personal access tokens are named,
   * long-lived credentials a human pasted into a script — silently revoking one
   * because a browser session refreshed 25 times would be a mystery outage.
   */
  async #pruneOldest(
    tx: { apiToken: PrismaClient['apiToken'] },
    licenseId: bigint,
    ownerId: string,
    kind: 'pat' | 'oauth' | 'bot',
  ): Promise<void> {
    if (kind !== 'oauth') return;

    const live = await tx.apiToken.findMany({
      where: { licenseId, ownerId, kind: 'oauth', revokedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      skip: MAX_ACTIVE_TOKENS_PER_OWNER,
    });
    if (live.length === 0) return;

    await tx.apiToken.updateMany({
      where: { id: { in: live.map((t) => t.id) } },
      data: { revokedAt: new Date() },
    });
  }
}
