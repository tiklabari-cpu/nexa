/**
 * Session policy enforcement (FR-MOD-08.9.6-g).
 *
 * Two per-licence policies, both null (off) by default so a workspace that never
 * sets them behaves exactly as before:
 *
 *   - session_idle_timeout_seconds — an oauth session that has gone quiet longer
 *     than the window is over. resolve() revokes the token durably and answers
 *     with the same undifferentiated 401 as any other dead credential, because
 *     telling a caller their token is "idle" rather than "unknown" confirms it
 *     was real.
 *   - max_concurrent_sessions — a per-owner cap on live oauth sessions. Minting
 *     one past the cap closes the oldest. The cap is a true invariant even under
 *     parallel mints, which is the property most easily lost and the one tested
 *     hardest here.
 *
 * Personal access and bot tokens are named, long-lived credentials; neither
 * policy touches them. Enforcement runs against real Postgres + RLS rather than
 * a mocked repository — the race the idle read and the prune have to survive
 * lives in the database, not the handler.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../src/lib/crypto.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const MINUTE = 60_000;

describe('session policies', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const get = (path: string, headers: Record<string, string> = {}) => server.get(path, headers);
  const message = (res: { json: () => unknown }) =>
    (res.json() as { error: { message: string } }).error.message;
  const errorType = (res: { json: () => unknown }) =>
    (res.json() as { error: { type: string } }).error.type;

  /** Set (or clear) a tenant's session policy straight through RLS. */
  async function setPolicy(
    tenant: TenantFixture,
    policy: { idleSeconds?: number | null; maxSessions?: number | null },
  ): Promise<void> {
    const data = {
      sessionIdleTimeoutSeconds: policy.idleSeconds ?? null,
      maxConcurrentSessions: policy.maxSessions ?? null,
    };
    // security_settings is keyed by (license, brand) now — write the default
    // brand's row, the one the brandless session-policy read resolves to.
    const brand = await owner.brand.findFirstOrThrow({
      where: { licenseId: tenant.licenseId, isDefault: true },
      select: { id: true },
    });
    await owner.securitySettings.upsert({
      where: { licenseId_brandId: { licenseId: tenant.licenseId, brandId: brand.id } },
      create: { licenseId: tenant.licenseId, brandId: brand.id, ...data },
      update: data,
    });
  }

  const revokedAtOf = (token: string) =>
    owner.apiToken
      .findFirstOrThrow({ where: { tokenHash: hashToken(token) }, select: { revokedAt: true } })
      .then((row) => row.revokedAt);

  const liveOauthCount = (tenant: TenantFixture, ownerId: string) =>
    owner.apiToken.count({
      where: { licenseId: tenant.licenseId, ownerId, kind: 'oauth', revokedAt: null },
    });

  /** Mint a live oauth access token through the service under test. */
  const issueOauth = (tenant: TenantFixture, ownerId: string) =>
    server.app.tokens.issue({
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId,
      kind: 'oauth',
      scopes: ['accounts--my:ro'],
    });

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    // setPolicy() writes each license's default brand security_settings row.
    await Promise.all([
      seedDefaultBrand(owner, fx.a.licenseId),
      seedDefaultBrand(owner, fx.b.licenseId),
    ]);
    await clearRateLimits(server.app);
  });

  // ==========================================================================
  // Idle timeout — rejections first: this decides whether a session is alive.
  // ==========================================================================

  describe('idle timeout', () => {
    it('rejects an oauth session idle past the window and revokes it durably', async () => {
      await setPolicy(fx.a, { idleSeconds: 15 * 60 });
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:ro'],
        kind: 'oauth',
        lastUsedAt: new Date(Date.now() - 16 * MINUTE),
      });

      const res = await get('/auth/me', bearer(token));
      expect(res.statusCode).toBe(401);
      expect(errorType(res)).toBe('authentication');
      // Durable: the revoke committed with the resolve, so it is on the row now.
      expect(await revokedAtOf(token)).not.toBeNull();
    });

    it('does not distinguish an idle-expired session from one that never existed', async () => {
      await setPolicy(fx.a, { idleSeconds: 15 * 60 });
      const idle = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:ro'],
        kind: 'oauth',
        lastUsedAt: new Date(Date.now() - 16 * MINUTE),
      });

      const expired = await get('/auth/me', bearer(idle));
      const unknown = await get('/auth/me', bearer('never-existed'));
      // A different message for "idle" than "unknown" would confirm the token was real.
      expect(message(expired)).toBe(message(unknown));
    });

    it('leaves a session inside the window working and untouched', async () => {
      await setPolicy(fx.a, { idleSeconds: 15 * 60 });
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:ro'],
        kind: 'oauth',
        lastUsedAt: new Date(Date.now() - 1 * MINUTE),
      });

      const res = await get('/auth/me', bearer(token));
      expect(res.statusCode).toBe(200);
      expect(await revokedAtOf(token)).toBeNull();
    });

    it('measures inactivity from mint time for a session never used', async () => {
      await setPolicy(fx.a, { idleSeconds: 15 * 60 });
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:ro'],
        kind: 'oauth',
        lastUsedAt: null,
        createdAt: new Date(Date.now() - 16 * MINUTE),
      });

      const res = await get('/auth/me', bearer(token));
      expect(res.statusCode).toBe(401);
      expect(await revokedAtOf(token)).not.toBeNull();
    });

    it('never expires a personal access token for inactivity', async () => {
      await setPolicy(fx.a, { idleSeconds: 15 * 60 });
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:ro'],
        kind: 'pat',
        lastUsedAt: new Date(Date.now() - 365 * 24 * MINUTE * 60),
      });

      const basic = Buffer.from(`${fx.a.ownerAccountId}:${token}`).toString('base64');
      const res = await get('/auth/me', { authorization: `Basic ${basic}` });
      expect(res.statusCode).toBe(200);
      expect(await revokedAtOf(token)).toBeNull();
    });

    it('enforces nothing while the idle window is null (regression)', async () => {
      // No policy row at all — the default state every existing test runs under.
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:ro'],
        kind: 'oauth',
        lastUsedAt: new Date(Date.now() - 365 * 24 * MINUTE * 60),
      });

      const res = await get('/auth/me', bearer(token));
      expect(res.statusCode).toBe(200);
      expect(await revokedAtOf(token)).toBeNull();
    });
  });

  // ==========================================================================
  // Concurrent session limit.
  // ==========================================================================

  describe('concurrent session limit', () => {
    it('closes the oldest session when a new one exceeds the cap', async () => {
      await setPolicy(fx.a, { maxSessions: 1 });
      const first = await issueOauth(fx.a, fx.a.ownerAccountId);
      const second = await issueOauth(fx.a, fx.a.ownerAccountId);

      // The cap is 1, so minting the second closes the first.
      expect((await get('/auth/me', bearer(first.token))).statusCode).toBe(401);
      expect((await get('/auth/me', bearer(second.token))).statusCode).toBe(200);
    });

    it('leaves a personal access token alive when the cap prunes sessions', async () => {
      await setPolicy(fx.a, { maxSessions: 1 });
      const pat = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:ro'],
        kind: 'pat',
      });

      await issueOauth(fx.a, fx.a.ownerAccountId);
      await issueOauth(fx.a, fx.a.ownerAccountId);

      // Pruning oauth sessions must not sweep up the owner's PAT.
      expect(await revokedAtOf(pat)).toBeNull();
      const basic = Buffer.from(`${fx.a.ownerAccountId}:${pat}`).toString('base64');
      expect((await get('/auth/me', { authorization: `Basic ${basic}` })).statusCode).toBe(200);
    });

    it('holds the cap as an invariant under parallel mints', async () => {
      const cap = 2;
      await setPolicy(fx.a, { maxSessions: cap });
      // Each round fires a burst of simultaneous mints far over the cap. Without
      // the advisory lock, any two that interleave both count a view missing the
      // other's uncommitted row, both under-prune, and the survivors settle above
      // the cap; several rounds make that interleaving reliable to hit. With the
      // lock the count-then-prune is a critical section, so every round lands
      // back at exactly the cap.
      for (let round = 0; round < 4; round++) {
        await Promise.all(Array.from({ length: 8 }, () => issueOauth(fx.a, fx.a.ownerAccountId)));
        expect(await liveOauthCount(fx.a, fx.a.ownerAccountId)).toBe(cap);
      }
    });

    it('enforces the fixed ceiling, not a prune, while the cap is null (regression)', async () => {
      // No policy row: the cap falls back to 25, far above three sessions.
      await issueOauth(fx.a, fx.a.ownerAccountId);
      await issueOauth(fx.a, fx.a.ownerAccountId);
      await issueOauth(fx.a, fx.a.ownerAccountId);
      expect(await liveOauthCount(fx.a, fx.a.ownerAccountId)).toBe(3);
    });
  });

  // ==========================================================================
  // Cross-tenant: one workspace's policy is not another's.
  // ==========================================================================

  describe('cross-tenant isolation', () => {
    it("does not let one licence's idle window invalidate another's session", async () => {
      await setPolicy(fx.a, { idleSeconds: 15 * 60 });
      // B sets no policy; a long-idle B session must stay alive.
      const tokenB = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['accounts--my:ro'],
        kind: 'oauth',
        lastUsedAt: new Date(Date.now() - 24 * 60 * MINUTE),
      });

      const res = await get('/auth/me', bearer(tokenB));
      expect(res.statusCode).toBe(200);
      expect(await revokedAtOf(tokenB)).toBeNull();
    });

    it("does not let one licence's session cap prune another's sessions", async () => {
      await setPolicy(fx.a, { maxSessions: 1 });
      // B has no cap (falls back to 25); minting three for B prunes none of them,
      // proving the prune reads B's own policy, not A's.
      await issueOauth(fx.b, fx.b.ownerAccountId);
      await issueOauth(fx.b, fx.b.ownerAccountId);
      await issueOauth(fx.b, fx.b.ownerAccountId);
      expect(await liveOauthCount(fx.b, fx.b.ownerAccountId)).toBe(3);
    });
  });
});
