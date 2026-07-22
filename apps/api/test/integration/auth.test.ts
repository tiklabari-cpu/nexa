/**
 * Authentication and authorization.
 *
 * Attacks first, happy path last. Every one of these corresponds to a way the
 * flow can be subverted rather than merely fail: stolen codes, downgraded PKCE,
 * replayed refresh tokens, tokens used across tenants, scopes escalated by the
 * holder of a weaker token.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deriveCodeChallenge, generateToken, hashToken } from '../../src/lib/crypto.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  TEST_PASSWORD,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/** A fresh, valid PKCE pair. */
function pkce(): { verifier: string; challenge: string } {
  const verifier = generateToken(48).slice(0, 64);
  return { verifier, challenge: deriveCodeChallenge(verifier) };
}

describe('auth', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;

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
  });

  const post = (path: string, payload?: unknown, headers: Record<string, string> = {}) =>
    server.post(path, payload, headers);

  const get = (path: string, headers: Record<string, string> = {}) => server.get(path, headers);

  const del = (path: string, headers: Record<string, string> = {}) => server.del(path, headers);

  /** Drive the full authorize → token exchange, returning the grant. */
  async function signIn(tenant = fx.a, email = fx.a.ownerEmail) {
    const { verifier, challenge } = pkce();
    const authorized = await post('/auth/login', { email, password: TEST_PASSWORD });
    expect(authorized.statusCode).toBe(200);

    const codeResponse = await post('/auth/authorize', {
      client_id: tenant.clientId,
      redirect_uri: tenant.redirectUri,
      code_challenge: challenge,
      email,
      password: TEST_PASSWORD,
      license_id: tenant.licenseId.toString(),
    });
    expect(codeResponse.statusCode).toBe(200);
    const { code } = codeResponse.json();

    const tokenResponse = await post('/auth/token', {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: tenant.clientId,
      redirect_uri: tenant.redirectUri,
    });
    expect(tokenResponse.statusCode).toBe(200);
    return tokenResponse.json() as {
      access_token: string;
      refresh_token: string;
      scope: string;
      expires_in: number;
    };
  }

  // =========================================================================
  // Negative: credentials
  // =========================================================================

  describe('login', () => {
    it('gives the same answer for a wrong password and an unknown account', async () => {
      const wrongPassword = await post('/auth/login', {
        email: fx.a.ownerEmail,
        password: 'not-the-password',
      });
      const unknownAccount = await post('/auth/login', {
        email: 'nobody@example.test',
        password: 'not-the-password',
      });

      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownAccount.statusCode).toBe(401);
      // Identical bodies: any difference would let an attacker enumerate which
      // addresses are registered.
      expect(unknownAccount.json().error.message).toBe(wrongPassword.json().error.message);
      expect(unknownAccount.json().error.type).toBe(wrongPassword.json().error.type);
    });

    it('spends comparable time on a missing account as on a wrong password', async () => {
      // A short-circuit return for "no such user" would make sign-up status
      // measurable from the outside, regardless of the response body.
      const time = async (email: string) => {
        const started = performance.now();
        await post('/auth/login', { email, password: 'not-the-password' });
        return performance.now() - started;
      };

      const known = await time(fx.a.ownerEmail);
      const unknown = await time('nobody@example.test');
      const ratio = Math.max(known, unknown) / Math.max(1, Math.min(known, unknown));
      expect(ratio).toBeLessThan(3);
    });

    it('rejects a malformed email before touching the database', async () => {
      const response = await post('/auth/login', { email: 'not-an-email', password: 'x' });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.type).toBe('validation');
    });

    it('lists only the workspaces the account belongs to', async () => {
      const response = await post('/auth/login', {
        email: fx.a.ownerEmail,
        password: TEST_PASSWORD,
      });
      const memberships = response.json().memberships as Array<{ organization_id: string }>;
      expect(memberships).toHaveLength(1);
      expect(memberships[0]!.organization_id).toBe(fx.a.organizationId);
    });

    it('hides suspended memberships', async () => {
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        data: { suspended: true },
      });

      const response = await post('/auth/login', {
        email: fx.a.agentEmail,
        password: TEST_PASSWORD,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().memberships).toHaveLength(0);
    });
  });

  // =========================================================================
  // Negative: authorization request
  // =========================================================================

  describe('authorize', () => {
    it('refuses an unregistered redirect_uri', async () => {
      const { challenge } = pkce();
      const response = await post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: 'https://attacker.example/steal',
        code_challenge: challenge,
        email: fx.a.ownerEmail,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toMatch(/redirect_uri/);
    });

    it('refuses a redirect_uri that merely starts with a registered one', async () => {
      // The platform being cloned accepted prefix matches. That turns any open
      // redirect on the client's own domain into a code exfiltration channel.
      const { challenge } = pkce();
      const response = await post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: `${fx.a.redirectUri}/../evil`,
        code_challenge: challenge,
        email: fx.a.ownerEmail,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
      });
      expect(response.statusCode).toBe(400);
    });

    it('validates the redirect before spending a password check', async () => {
      const { challenge } = pkce();
      const response = await post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: 'https://attacker.example/steal',
        code_challenge: challenge,
        email: fx.a.ownerEmail,
        password: 'wrong-password',
        license_id: fx.a.licenseId.toString(),
      });
      // 400 (bad redirect), not 401 (bad password) — the request could never
      // have succeeded, so it is rejected before any credential work.
      expect(response.statusCode).toBe(400);
    });

    it('refuses to issue a code for a workspace the account cannot access', async () => {
      const { challenge } = pkce();
      const response = await post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        code_challenge: challenge,
        email: fx.a.ownerEmail,
        password: TEST_PASSWORD,
        // Valid credentials, someone else's workspace.
        license_id: fx.b.licenseId.toString(),
      });
      // 404 rather than 403 so valid credentials cannot enumerate workspaces.
      expect(response.statusCode).toBe(404);
    });

    it('refuses a client belonging to another organization', async () => {
      const { challenge } = pkce();
      const response = await post('/auth/authorize', {
        client_id: fx.b.clientId,
        redirect_uri: fx.b.redirectUri,
        code_challenge: challenge,
        email: fx.a.ownerEmail,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
      });
      expect(response.statusCode).toBe(404);
    });

    it('requires a code_challenge', async () => {
      const response = await post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        email: fx.a.ownerEmail,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
      });
      expect(response.statusCode).toBe(400);
    });

    it('refuses the plain PKCE method', async () => {
      const { verifier } = pkce();
      const response = await post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        code_challenge: verifier,
        code_challenge_method: 'plain',
        email: fx.a.ownerEmail,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
      });
      expect(response.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // Negative: code exchange
  // =========================================================================

  describe('token exchange', () => {
    async function issueCode(tenant = fx.a) {
      const { verifier, challenge } = pkce();
      const response = await post('/auth/authorize', {
        client_id: tenant.clientId,
        redirect_uri: tenant.redirectUri,
        code_challenge: challenge,
        email: tenant.ownerEmail,
        password: TEST_PASSWORD,
        license_id: tenant.licenseId.toString(),
      });
      return { code: response.json().code as string, verifier };
    }

    it('rejects a wrong code_verifier', async () => {
      const { code } = await issueCode();
      const response = await post('/auth/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: pkce().verifier,
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.details.oauth_error).toBe('invalid_grant');
    });

    it('rejects a code_verifier of the wrong shape', async () => {
      const { code } = await issueCode();
      const response = await post('/auth/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: 'too-short',
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects an unknown code', async () => {
      const response = await post('/auth/token', {
        grant_type: 'authorization_code',
        code: generateToken(),
        code_verifier: pkce().verifier,
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects a code redeemed with a different redirect_uri', async () => {
      const { code, verifier } = await issueCode();
      const response = await post('/auth/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: fx.a.clientId,
        redirect_uri: 'http://localhost:5173/callback',
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects a code redeemed by a different client', async () => {
      const { code, verifier } = await issueCode();
      const response = await post('/auth/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: fx.b.clientId,
        redirect_uri: fx.a.redirectUri,
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects an expired code', async () => {
      const { code, verifier } = await issueCode();
      await owner.oauthAuthorizationCode.update({
        where: { codeHash: hashToken(code) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const response = await post('/auth/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
      });
      expect(response.statusCode).toBe(401);
    });

    it('burns a code on first use and revokes what it produced on replay', async () => {
      const { code, verifier } = await issueCode();
      const body = {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
      };

      const first = await post('/auth/token', body);
      expect(first.statusCode).toBe(200);
      const grant = first.json();

      const replay = await post('/auth/token', body);
      expect(replay.statusCode).toBe(401);

      // A replayed code means it leaked. The token it already minted must die
      // too, or the attacker keeps whatever the first exchange produced.
      const afterReplay = await get('/auth/me', {
        authorization: `Bearer ${grant.access_token}`,
      });
      expect(afterReplay.statusCode).toBe(401);
    });

    it('stores codes hashed, never in plaintext', async () => {
      const { code } = await issueCode();
      const stored = await owner.oauthAuthorizationCode.findMany({ select: { codeHash: true } });
      expect(stored.map((c) => c.codeHash)).toContain(hashToken(code));
      expect(stored.map((c) => c.codeHash)).not.toContain(code);
    });
  });

  // =========================================================================
  // Negative: refresh rotation
  // =========================================================================

  describe('refresh rotation', () => {
    it('invalidates the old refresh token when it rotates', async () => {
      const first = await signIn();

      const rotated = await post('/auth/token', {
        grant_type: 'refresh_token',
        refresh_token: first.refresh_token,
        client_id: fx.a.clientId,
      });
      expect(rotated.statusCode).toBe(200);
      expect(rotated.json().refresh_token).not.toBe(first.refresh_token);

      const reuse = await post('/auth/token', {
        grant_type: 'refresh_token',
        refresh_token: first.refresh_token,
        client_id: fx.a.clientId,
      });
      expect(reuse.statusCode).toBe(401);
    });

    it('revokes the whole family when a rotated token is reused', async () => {
      const first = await signIn();
      const second = (
        await post('/auth/token', {
          grant_type: 'refresh_token',
          refresh_token: first.refresh_token,
          client_id: fx.a.clientId,
        })
      ).json();

      // Presenting the superseded token is the fingerprint of a stolen refresh
      // token: the thief and the legitimate client both hold one. Killing only
      // the presented token would leave the attacker's copy working.
      await post('/auth/token', {
        grant_type: 'refresh_token',
        refresh_token: first.refresh_token,
        client_id: fx.a.clientId,
      });

      const stillValid = await post('/auth/token', {
        grant_type: 'refresh_token',
        refresh_token: second.refresh_token,
        client_id: fx.a.clientId,
      });
      expect(stillValid.statusCode).toBe(401);

      const accessAfter = await get('/auth/me', {
        authorization: `Bearer ${second.access_token}`,
      });
      expect(accessAfter.statusCode).toBe(401);
    });

    it('rejects a refresh token presented by another client', async () => {
      const grant = await signIn();
      const response = await post('/auth/token', {
        grant_type: 'refresh_token',
        refresh_token: grant.refresh_token,
        client_id: fx.b.clientId,
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects an expired refresh token', async () => {
      const grant = await signIn();
      await owner.oauthRefreshToken.updateMany({
        where: { tokenHash: hashToken(grant.refresh_token) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const response = await post('/auth/token', {
        grant_type: 'refresh_token',
        refresh_token: grant.refresh_token,
        client_id: fx.a.clientId,
      });
      expect(response.statusCode).toBe(401);
    });
  });

  // =========================================================================
  // Negative: bearer tokens across tenants and scopes
  // =========================================================================

  describe('token authorization', () => {
    it('refuses a request with no Authorization header', async () => {
      const response = await get('/auth/me');
      expect(response.statusCode).toBe(401);
      expect(response.json().error.type).toBe('authentication');
    });

    it.each([
      ['garbage', 'Bearer not-a-real-token'],
      ['empty bearer', 'Bearer '],
      ['unknown scheme', 'Digest abc'],
      ['no scheme', 'abcdef'],
    ])('refuses a %s credential', async (_label, header) => {
      const response = await get('/auth/me', { authorization: header });
      expect(response.statusCode).toBe(401);
    });

    it('refuses a revoked token', async () => {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:ro'],
        revokedAt: new Date(),
      });
      const response = await get('/auth/me', { authorization: `Bearer ${token}` });
      expect(response.statusCode).toBe(401);
    });

    it('refuses an expired token', async () => {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:ro'],
        expiresAt: new Date(Date.now() - 1000),
      });
      const response = await get('/auth/me', { authorization: `Bearer ${token}` });
      expect(response.statusCode).toBe(401);
    });

    it('does not distinguish an expired token from one that never existed', async () => {
      const expired = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:ro'],
        expiresAt: new Date(Date.now() - 1000),
      });

      const a = await get('/auth/me', { authorization: `Bearer ${expired}` });
      const b = await get('/auth/me', { authorization: 'Bearer never-existed' });
      expect(a.json().error.message).toBe(b.json().error.message);
    });

    it('stops working the moment the membership is suspended', async () => {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['accounts--my:ro'],
      });
      expect((await get('/auth/me', { authorization: `Bearer ${token}` })).statusCode).toBe(200);

      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        data: { suspended: true },
      });

      // Suspension must bite immediately, not at next sign-in — otherwise a
      // departing employee keeps access for the token's whole lifetime.
      expect((await get('/auth/me', { authorization: `Bearer ${token}` })).statusCode).toBe(401);
    });

    it('reflects a role change on existing tokens', async () => {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['accounts--my:ro'],
      });
      expect((await get('/auth/me', { authorization: `Bearer ${token}` })).json().role).toBe(
        'agent',
      );

      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        data: { role: 'admin' },
      });

      // The role is read from the membership per request, not baked into the
      // token, so a demotion cannot be outlived by an old credential.
      expect((await get('/auth/me', { authorization: `Bearer ${token}` })).json().role).toBe(
        'admin',
      );
    });

    it('scopes a token to the tenant it was issued for', async () => {
      const tokenA = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:ro'],
      });

      const me = await get('/auth/me', { authorization: `Bearer ${tokenA}` });
      expect(me.json().organization_id).toBe(fx.a.organizationId);
      expect(me.json().organization_id).not.toBe(fx.b.organizationId);
    });

    it('refuses a token whose scopes do not cover the route', async () => {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--access:ro'],
      });
      const response = await get('/auth/personal-access-tokens', {
        authorization: `Bearer ${token}`,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.type).toBe('authorization');
    });

    it('honours scope implication rather than demanding an exact string', async () => {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:rw'],
      });
      // The route asks for `accounts--my:ro`; rw covers it.
      const response = await get('/auth/personal-access-tokens', {
        authorization: `Bearer ${token}`,
      });
      expect(response.statusCode).toBe(200);
    });

    it('rejects a mismatched region', async () => {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:ro'],
      });
      const response = await get('/auth/me', {
        authorization: `Bearer ${token}`,
        'x-region': 'dal',
      });
      expect(response.statusCode).toBe(421);
      expect(response.json().error.type).toBe('misdirected_request');
      expect(response.json().error.details.region).toBe('eu');
    });

    it('accepts a personal access token over Basic auth', async () => {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:ro'],
        kind: 'pat',
      });
      const basic = Buffer.from(`${fx.a.ownerAccountId}:${token}`).toString('base64');
      const response = await get('/auth/me', { authorization: `Basic ${basic}` });
      expect(response.statusCode).toBe(200);
    });
  });

  // =========================================================================
  // Negative: privilege escalation via PAT creation
  // =========================================================================

  describe('personal access tokens', () => {
    it('refuses to mint a token stronger than the session creating it', async () => {
      const weak = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['accounts--my:rw'],
      });

      const response = await post(
        '/auth/personal-access-tokens',
        { name: 'escalation attempt', scopes: ['chats--all:rw', 'billing_manage'] },
        { authorization: `Bearer ${weak}` },
      );
      expect(response.statusCode).toBe(403);
      expect(response.json().error.message).toMatch(/does not hold/);
    });

    it('returns the secret exactly once and stores only its hash', async () => {
      const grant = await signIn();
      const created = await post(
        '/auth/personal-access-tokens',
        { name: 'ci deploy', scopes: ['chats--access:rw'] },
        { authorization: `Bearer ${grant.access_token}` },
      );
      expect(created.statusCode).toBe(201);
      const { token, id } = created.json();
      expect(token).toBeTruthy();

      const stored = await owner.apiToken.findUnique({ where: { id } });
      expect(stored?.tokenHash).toBe(hashToken(token));
      // The plaintext must appear nowhere in the row. `licenseId` is a bigint,
      // which JSON.stringify refuses outright, so stringify it explicitly.
      const serialised = JSON.stringify(stored, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
      expect(serialised).not.toContain(token);

      const listed = await get('/auth/personal-access-tokens', {
        authorization: `Bearer ${grant.access_token}`,
      });
      expect(JSON.stringify(listed.json())).not.toContain(token);
    });

    it("will not let an agent revoke a colleague's token", async () => {
      const victim = await owner.apiToken.create({
        data: {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.ownerAccountId,
          kind: 'pat',
          tokenHash: hashToken(generateToken()),
          scopes: ['chats--all:rw'],
        },
        select: { id: true },
      });

      const attacker = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['accounts--my:rw'],
      });

      const response = await del(`/auth/personal-access-tokens/${victim.id}`, {
        authorization: `Bearer ${attacker}`,
      });
      expect(response.statusCode).toBe(404);
      expect((await owner.apiToken.findUnique({ where: { id: victim.id } }))?.revokedAt).toBeNull();
    });

    it('will not let a token from tenant B revoke one in tenant A', async () => {
      const victim = await owner.apiToken.create({
        data: {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.ownerAccountId,
          kind: 'pat',
          tokenHash: hashToken(generateToken()),
          scopes: [],
        },
        select: { id: true },
      });

      const foreign = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['accounts--my:rw'],
      });

      const response = await del(`/auth/personal-access-tokens/${victim.id}`, {
        authorization: `Bearer ${foreign}`,
      });
      expect(response.statusCode).toBe(404);
      expect((await owner.apiToken.findUnique({ where: { id: victim.id } }))?.revokedAt).toBeNull();
    });
  });

  // =========================================================================
  // Negative: customer tokens (I4 — must not reach the agent surface)
  // =========================================================================

  describe('customer tokens', () => {
    const widgetOrigin = (host: string) => ({ origin: `https://${host}` });

    it('refuses a request with no Origin header', async () => {
      const response = await post('/customer/token', { organization_id: fx.a.organizationId });
      expect(response.statusCode).toBe(403);
    });

    it('refuses an origin that is not a trusted domain', async () => {
      const response = await post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        widgetOrigin('attacker.example'),
      );
      expect(response.statusCode).toBe(403);
    });

    it('refuses a trusted domain belonging to a different organization', async () => {
      const response = await post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        widgetOrigin(fx.b.trustedDomain),
      );
      expect(response.statusCode).toBe(403);
    });

    it('does not treat a lookalike domain as a subdomain', async () => {
      // `evil-shop-a.example.test` must not satisfy a rule for
      // `shop-a.example.test` — the match has to be anchored at a dot.
      const response = await post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        widgetOrigin(`evil-${fx.a.trustedDomain}`),
      );
      expect(response.statusCode).toBe(403);
    });

    it('accepts a real subdomain when subdomains are enabled', async () => {
      const response = await post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        widgetOrigin(`checkout.${fx.a.trustedDomain}`),
      );
      expect(response.statusCode).toBe(200);
    });

    it("issues a fresh identity when handed another tenant's customer id", async () => {
      const response = await post(
        '/customer/token',
        { organization_id: fx.a.organizationId, customer_id: fx.b.customerId },
        widgetOrigin(fx.a.trustedDomain),
      );
      expect(response.statusCode).toBe(200);
      // Silently reissuing avoids turning the endpoint into a probe for valid
      // customer ids, while still refusing to cross the tenant boundary.
      expect(response.json().customer_id).not.toBe(fx.b.customerId);
    });

    it('refuses a banned customer', async () => {
      await owner.customer.update({
        where: { id: fx.a.customerId },
        data: { bannedAt: new Date() },
      });
      const response = await post(
        '/customer/token',
        { organization_id: fx.a.organizationId, customer_id: fx.a.customerId },
        widgetOrigin(fx.a.trustedDomain),
      );
      expect(response.statusCode).toBe(403);
      expect(response.json().error.type).toBe('customer_banned');
    });

    it('cannot reach an agent-only route', async () => {
      const issued = await post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        widgetOrigin(fx.a.trustedDomain),
      );
      const { token } = issued.json();

      // 404, not 403: the agent API should not even acknowledge itself to a
      // widget token.
      const response = await get('/auth/personal-access-tokens', {
        authorization: `Bearer ${token}`,
      });
      expect(response.statusCode).toBe(404);
    });

    it('rejects a tampered customer token', async () => {
      const issued = await post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        widgetOrigin(fx.a.trustedDomain),
      );
      const { token } = issued.json();

      const [prefix, body, signature] = token.split('.');
      const forgedBody = Buffer.from(
        JSON.stringify({
          sub: fx.b.customerId,
          org: fx.b.organizationId,
          lic: fx.b.licenseId.toString(),
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString('base64url');

      const response = await get('/auth/me', {
        authorization: `Bearer ${prefix}.${forgedBody}.${signature}`,
      });
      expect(response.statusCode).toBe(401);
    });

    it('identifies itself as a customer, with no scopes', async () => {
      const issued = await post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        widgetOrigin(fx.a.trustedDomain),
      );
      const me = await get('/auth/me', { authorization: `Bearer ${issued.json().token}` });
      expect(me.statusCode).toBe(200);
      expect(me.json().kind).toBe('customer');
      expect(me.json().scopes).toEqual([]);
      expect(me.json().organization_id).toBe(fx.a.organizationId);
    });
  });

  // =========================================================================
  // Positive: the flow works end to end
  // =========================================================================

  describe('happy path', () => {
    it('signs in, exchanges a code, and identifies the caller', async () => {
      const grant = await signIn();
      expect(grant.expires_in).toBeLessThanOrEqual(3600);

      const me = await get('/auth/me', { authorization: `Bearer ${grant.access_token}` });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({
        kind: 'agent',
        email: fx.a.ownerEmail,
        role: 'owner',
        organization_id: fx.a.organizationId,
        license_id: fx.a.licenseId.toString(),
        region: 'eu',
      });
    });

    it('caps the access token lifetime at an hour', async () => {
      // The source platform issued 8-hour tokens; a shorter window limits the
      // value of a captured one (NFR-S2).
      const grant = await signIn();
      expect(grant.expires_in).toBe(3600);
    });

    it('marks token responses uncacheable', async () => {
      const response = await post('/auth/login', {
        email: fx.a.ownerEmail,
        password: TEST_PASSWORD,
      });
      expect(response.statusCode).toBe(200);

      const { verifier, challenge } = pkce();
      const code = (
        await post('/auth/authorize', {
          client_id: fx.a.clientId,
          redirect_uri: fx.a.redirectUri,
          code_challenge: challenge,
          email: fx.a.ownerEmail,
          password: TEST_PASSWORD,
          license_id: fx.a.licenseId.toString(),
        })
      ).json().code;

      const tokenResponse = await post('/auth/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
      });
      expect(tokenResponse.headers['cache-control']).toBe('no-store');
    });

    it('revokes an access token', async () => {
      const grant = await signIn();
      expect(
        (await get('/auth/me', { authorization: `Bearer ${grant.access_token}` })).statusCode,
      ).toBe(200);

      const revoked = await post('/auth/revoke', { token: grant.access_token });
      expect(revoked.statusCode).toBe(200);
      expect(revoked.json().revoked).toBe(true);

      expect(
        (await get('/auth/me', { authorization: `Bearer ${grant.access_token}` })).statusCode,
      ).toBe(401);
    });

    it('answers 200 when revoking a token that never existed', async () => {
      // RFC 7009: the caller's goal is "this must not work". Reporting whether
      // it was real would make the endpoint an oracle.
      const response = await post('/auth/revoke', { token: 'never-existed' });
      expect(response.statusCode).toBe(200);
      expect(response.json().revoked).toBe(false);
    });

    it('creates and then revokes a personal access token', async () => {
      const grant = await signIn();
      const headers = { authorization: `Bearer ${grant.access_token}` };

      const created = await post(
        '/auth/personal-access-tokens',
        { name: 'reporting job', scopes: ['chats--access:rw'] },
        headers,
      );
      expect(created.statusCode).toBe(201);
      const { id, token } = created.json();

      const usable = await get('/auth/me', { authorization: `Bearer ${token}` });
      expect(usable.statusCode).toBe(200);
      expect(usable.json().scopes).toEqual(['chats--access:rw']);

      const deleted = await del(`/auth/personal-access-tokens/${id}`, headers);
      expect(deleted.statusCode).toBe(204);

      expect((await get('/auth/me', { authorization: `Bearer ${token}` })).statusCode).toBe(401);
    });

    it('records when a token was last used', async () => {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:ro'],
      });
      await get('/auth/me', { authorization: `Bearer ${token}` });

      await new Promise((resolve) => setTimeout(resolve, 150)); // touch is async
      const stored = await owner.apiToken.findFirst({ where: { tokenHash: hashToken(token) } });
      expect(stored?.lastUsedAt).not.toBeNull();
    });
  });

  // =========================================================================
  // Rate limiting (ADR-07)
  // =========================================================================

  describe('rate limiting', () => {
    it('reports the remaining budget on every response', async () => {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:ro'],
      });
      const response = await get('/auth/me', { authorization: `Bearer ${token}` });
      expect(response.headers['x-ratelimit-limit']).toBe('180');
      expect(Number(response.headers['x-ratelimit-remaining'])).toBeLessThan(180);
    });

    it('returns 429 with Retry-After once the budget is spent', async () => {
      const server429 = await startTestServer({ RATE_LIMIT_AGENT_PER_MIN: '3' });
      try {
        await clearRateLimits(server429.app);
        const token = await grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.ownerAccountId,
          scopes: ['accounts--my:ro'],
        });
        const headers = { authorization: `Bearer ${token}` };
        const call = () => server429.get('/auth/me', headers);

        expect((await call()).statusCode).toBe(200);
        expect((await call()).statusCode).toBe(200);
        expect((await call()).statusCode).toBe(200);

        const limited = await call();
        expect(limited.statusCode).toBe(429);
        expect(limited.json().error.type).toBe('too_many_requests');
        // The source platform omitted Retry-After entirely, leaving clients to
        // guess. Every 429 here carries one.
        expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      } finally {
        await clearRateLimits(server429.app);
        await server429.close();
      }
    });

    it('does not rate limit the health probe', async () => {
      const server429 = await startTestServer({ RATE_LIMIT_AGENT_PER_MIN: '1' });
      try {
        for (let i = 0; i < 5; i++) {
          const response = await server429.get('/health');
          expect(response.statusCode).toBe(200);
        }
      } finally {
        await server429.close();
      }
    });
  });
});
