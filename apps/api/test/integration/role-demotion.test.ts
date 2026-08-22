/**
 * Demotion has to take authority away — SEC-2 (tm 146).
 *
 * `token-service` has always re-read the role from the membership on every
 * request, and said so: "revoking someone's admin rights must take effect on
 * their existing tokens immediately". It read `scopes` off the token row, and
 * `oauth-service.refresh` copied that list into every rotation, so the half of
 * the authorization decision that actually guarded the workspace-configuration
 * routes never moved. An admin demoted to agent kept a working admin session —
 * and `PATCH /settings/security`, the route that switches off IP allow-listing
 * and the two-factor requirement, was one of the routes it kept.
 *
 * Two mechanisms close it, and this file measures both separately because they
 * cover different credentials:
 *
 *   - a *session* is capped against the role its holder has now
 *     (`scopesWithinRole`), which is why the same access token stops working
 *     without being revoked — the answer is 403, not 401;
 *   - a *personal access token* keeps the list it was minted with, on purpose,
 *     and is stopped instead by the role gate the admin surfaces now carry.
 *
 * The promotion direction is here too. It is the cheap half to get wrong: a
 * ceiling that re-derived scopes instead of intersecting them would hand an old
 * credential authority nobody granted it.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deriveCodeChallenge, generateToken } from '../../src/lib/crypto.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  TEST_PASSWORD,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface Grant {
  access_token: string;
  refresh_token: string;
  scope: string;
}

describe('role change and credential authority', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;
  /** An admin who can sign in with a password — fixtures ship only owner + agent. */
  let adminId: string;
  let adminEmail: string;
  /** The owner's own credential, used only to move other people's roles. */
  let ownerToken: string;

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
    await clearRateLimits(server.app);
    // Brand-scoped settings rows resolve through the licence's default brand.
    await seedDefaultBrand(owner, fx.a.licenseId);

    // Reuse the fixture's already-computed hash rather than paying for another
    // password derivation: what matters is that this admin can go through the
    // real sign-in, not which password it is.
    const { passwordHash } = await owner.account.findUniqueOrThrow({
      where: { id: fx.a.ownerAccountId },
      select: { passwordHash: true },
    });
    adminEmail = `admin-${fx.a.licenseId}@example.test`;
    const account = await owner.account.create({
      data: { email: adminEmail, name: 'Admin', passwordHash },
      select: { id: true },
    });
    adminId = account.id;
    await owner.agentMembership.create({
      data: {
        licenseId: fx.a.licenseId,
        agentId: adminId,
        role: 'admin',
        routingStatus: 'accepting_chats',
      },
    });

    ownerToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents--all:rw'],
    });
  });

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  /** A PAT travels as Basic `account_id:token` (v2-03 §1.4). */
  const basic = (accountId: string, token: string) => ({
    authorization: `Basic ${Buffer.from(`${accountId}:${token}`).toString('base64')}`,
  });

  /** The real sign-in: authorize with PKCE, then exchange the code. */
  async function signIn(email: string): Promise<Grant> {
    const verifier = generateToken(48).slice(0, 64);
    const authorized = await server.post('/auth/authorize', {
      client_id: fx.a.clientId,
      redirect_uri: fx.a.redirectUri,
      code_challenge: deriveCodeChallenge(verifier),
      email,
      password: TEST_PASSWORD,
      license_id: fx.a.licenseId.toString(),
    });
    expect(authorized.statusCode).toBe(200);

    const granted = await server.post('/auth/token', {
      grant_type: 'authorization_code',
      code: authorized.json().code,
      code_verifier: verifier,
      client_id: fx.a.clientId,
      redirect_uri: fx.a.redirectUri,
    });
    expect(granted.statusCode).toBe(200);
    return granted.json() as Grant;
  }

  async function setRole(accountId: string, role: 'admin' | 'agent'): Promise<void> {
    const res = await server.put(`/agents/${accountId}/role`, { role }, bearer(ownerToken));
    expect(res.statusCode).toBe(200);
  }

  const scopesOf = async (token: string): Promise<string[]> => {
    const me = await server.get('/auth/me', bearer(token));
    expect(me.statusCode).toBe(200);
    return (me.json() as { scopes: string[] }).scopes;
  };

  const disableIpAllowlist = (headers: Record<string, string>) =>
    server.patch('/settings/security', { ip_allowlist_enforced: false }, headers);

  const enforcementFlag = async (): Promise<boolean> => {
    const row = await owner.securitySettings.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId },
      select: { ipAllowlistEnforced: true },
    });
    return row.ipAllowlistEnforced;
  };

  // =========================================================================
  // Demotion — the finding itself
  // =========================================================================

  describe('demotion', () => {
    it('closes the security settings to a session that is already open', async () => {
      const session = await signIn(adminEmail);
      // The session really did hold it: without this the 403 below could mean
      // anything, including that the route was never reachable.
      expect(await disableIpAllowlist(bearer(session.access_token))).toMatchObject({
        statusCode: 200,
      });
      await owner.securitySettings.updateMany({
        where: { licenseId: fx.a.licenseId },
        data: { ipAllowlistEnforced: true },
      });

      await setRole(adminId, 'agent');

      const after = await disableIpAllowlist(bearer(session.access_token));
      // 403, not 401: the credential is still perfectly valid. What changed is
      // who is holding it. Revoking the token instead would have logged them
      // out of the product for a change of rank, which is not what a demotion
      // means.
      expect(after.statusCode).toBe(403);
      expect(after.json().error.type).toBe('authorization');
      // The refusal wrote nothing — this is the setting the attack turns off.
      expect(await enforcementFlag()).toBe(true);
    });

    it('drops the admin scopes from the session rather than the session itself', async () => {
      const session = await signIn(adminEmail);
      expect(await scopesOf(session.access_token)).toContain('access_rules:rw');

      await setRole(adminId, 'agent');

      const scopes = await scopesOf(session.access_token);
      expect(scopes).not.toContain('access_rules:rw');
      // Everything an agent is entitled to survives: this narrows authority, it
      // does not end the session.
      expect(scopes).toContain('chats--access:rw');
      expect(scopes).toContain('accounts--my:ro');
    });

    it('closes every door that scope opened, not only the one that was reported', async () => {
      const session = await signIn(adminEmail);
      await setRole(adminId, 'agent');
      const headers = bearer(session.access_token);

      // Trusted domains decide which sites may mint widget credentials, and the
      // allow-list decides which networks may reach the console at all; both are
      // held by the same scope the security PATCH is.
      const domain = await server.post(
        '/settings/trusted-domains',
        { domain: 'attacker.example' },
        headers,
      );
      const allowlist = await server.post(
        '/settings/ip-allowlist',
        { entry: '127.0.0.0/8' },
        headers,
      );
      const brand = await server.post('/brands', { name: 'Rogue' }, headers);

      expect([domain.statusCode, allowlist.statusCode, brand.statusCode]).toEqual([403, 403, 403]);
      expect(await owner.trustedDomain.count({ where: { domain: 'attacker.example' } })).toBe(0);
      expect(await owner.ipAllowlistEntry.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });

    it('is not undone by refreshing — the rotation re-derives the ceiling', async () => {
      const session = await signIn(adminEmail);
      await setRole(adminId, 'agent');

      const refreshed = await server.post('/auth/token', {
        grant_type: 'refresh_token',
        refresh_token: session.refresh_token,
        client_id: fx.a.clientId,
      });
      expect(refreshed.statusCode).toBe(200);
      const next = refreshed.json() as Grant;

      // The record itself is honest, not merely the enforcement: the granted
      // `scope` and the row behind it no longer claim an authority the holder
      // does not have. Thirty days of rotations cannot re-inflate what is not
      // written down.
      expect(next.scope.split(',')).not.toContain('access_rules:rw');
      expect(next.scope.split(',')).toContain('chats--access:rw');
      expect((await disableIpAllowlist(bearer(next.access_token))).statusCode).toBe(403);
    });

    it('refuses a personal access token minted while its holder was an admin', async () => {
      const session = await signIn(adminEmail);
      const minted = await server.post(
        '/auth/personal-access-tokens',
        { name: 'deploy script' },
        bearer(session.access_token),
      );
      expect(minted.statusCode).toBe(201);
      const pat = minted.json() as { id: string; token: string };
      expect((await disableIpAllowlist(basic(adminId, pat.token))).statusCode).toBe(200);
      await owner.securitySettings.updateMany({
        where: { licenseId: fx.a.licenseId },
        data: { ipAllowlistEnforced: true },
      });

      await setRole(adminId, 'agent');

      const after = await disableIpAllowlist(basic(adminId, pat.token));
      expect(after.statusCode).toBe(403);
      expect(await enforcementFlag()).toBe(true);
      // And it is the *role* gate that refused, not the scope: a named
      // credential keeps the list somebody deliberately gave it, which is the
      // whole reason the route needed a role gate as well.
      const row = await owner.apiToken.findUniqueOrThrow({
        where: { id: pat.id },
        select: { scopes: true },
      });
      expect(row.scopes).toContain('access_rules:rw');
    });
  });

  // =========================================================================
  // Promotion — the direction a careless fix gets wrong
  // =========================================================================

  describe('promotion', () => {
    it('does not widen a session minted before the promotion', async () => {
      const session = await signIn(fx.a.agentEmail);
      expect(await scopesOf(session.access_token)).not.toContain('access_rules:rw');

      await setRole(fx.a.agentAccountId, 'admin');

      // The ceiling intersects; it never re-derives. A credential minted as an
      // agent's stays an agent's, and the new authority arrives with the next
      // sign-in — where somebody proves the password again.
      expect(await scopesOf(session.access_token)).not.toContain('access_rules:rw');
      expect((await disableIpAllowlist(bearer(session.access_token))).statusCode).toBe(403);

      const fresh = await signIn(fx.a.agentEmail);
      expect((await disableIpAllowlist(bearer(fresh.access_token))).statusCode).toBe(200);
    });

    it('does not let a caller ask for more than their role at sign-in', async () => {
      // `/auth/authorize` takes the scope list from the request body, and the
      // fixture's client registers no scope list of its own to narrow it
      // against — so before the ceiling this minted a session with whatever was
      // asked for, regardless of rank.
      const verifier = generateToken(48).slice(0, 64);
      const authorized = await server.post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        code_challenge: deriveCodeChallenge(verifier),
        scope: 'access_rules:rw,chats--access:rw',
        email: fx.a.agentEmail,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
      });
      expect(authorized.statusCode).toBe(200);
      const granted = await server.post('/auth/token', {
        grant_type: 'authorization_code',
        code: authorized.json().code,
        code_verifier: verifier,
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
      });
      expect(granted.statusCode).toBe(200);
      const session = granted.json() as Grant;

      expect(session.scope.split(',')).not.toContain('access_rules:rw');
      expect(await scopesOf(session.access_token)).not.toContain('access_rules:rw');
      expect((await disableIpAllowlist(bearer(session.access_token))).statusCode).toBe(403);
    });
  });

  // =========================================================================
  // Regressions — the ceiling must not narrow anything it should not
  // =========================================================================

  describe('regressions', () => {
    it('leaves a sitting admin exactly as they were', async () => {
      const session = await signIn(adminEmail);
      const headers = bearer(session.access_token);

      expect((await server.get('/settings/security', headers)).statusCode).toBe(200);
      expect((await disableIpAllowlist(headers)).statusCode).toBe(200);
      expect(
        (await server.post('/settings/trusted-domains', { domain: 'shop.example' }, headers))
          .statusCode,
      ).toBe(201);
      expect(await scopesOf(session.access_token)).toContain('access_rules:rw');
    });

    it('leaves the owner above the gate', async () => {
      const session = await signIn(fx.a.ownerEmail);
      expect((await disableIpAllowlist(bearer(session.access_token))).statusCode).toBe(200);
    });

    it('still answers a suspended membership with 401, not a narrowed session', async () => {
      // Suspension is a different refusal from demotion and must stay one: the
      // credential stops resolving at all rather than resolving with less.
      const session = await signIn(adminEmail);
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: adminId } },
        data: { suspended: true },
      });

      const after = await disableIpAllowlist(bearer(session.access_token));
      expect(after.statusCode).toBe(401);
    });

    it('does not touch a bot token, which has no membership to read a role from', async () => {
      const bot = await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Bot', kind: 'ai_agent', active: true },
        select: { id: true },
      });
      const botToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: bot.id,
        kind: 'bot',
        scopes: ['chats--all:rw', 'accounts--my:ro'],
      });

      const me = await server.get('/auth/me', bearer(botToken));
      expect(me.statusCode).toBe(200);
      expect((me.json() as { scopes: string[] }).scopes).toContain('chats--all:rw');
    });
  });
});
