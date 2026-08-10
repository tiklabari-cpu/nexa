/**
 * Partner app registration — FR-MOD-09.4 (v2, Could).
 *
 * This is a self-service *credential factory*: it writes `oauth_clients` rows,
 * and every row it writes is something `POST /auth/authorize` and
 * `POST /auth/token` will later trust. The properties under test are therefore
 * security properties first, and the negatives lead — refusing a forged,
 * over-scoped, cross-tenant or open-redirect registration is the whole point.
 *
 *   - Isolation: another organization's client is invisible, and its id answers
 *     404 rather than 403 (NFR-S4/S5).
 *   - `redirect_uris` are an allowlist: http, wildcards, fragments, embedded
 *     credentials, relative and non-canonical URIs are all refused (NFR-S3).
 *   - Scopes have a ceiling: a session cannot register a client stronger than
 *     itself, on create *or* update (NFR-S5).
 *   - The secret is returned once and stored only as `sha256(secret)` (NFR-S2),
 *     and rotation replaces it with no overlap window — the old one is dead the
 *     moment the new one exists.
 *
 * The last test is the one the whole slice rests on: a client registered
 * *through this API* completes a real OAuth 2.1 authorize → token exchange. It
 * is what proves the stored `secret_hash` is in the format
 * `OauthService.#authenticateClient` verifies against — a mismatch there
 * produces a client that registers cleanly and then fails to authenticate for
 * no visible reason.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deriveCodeChallenge, generateToken, hashToken } from '../../src/lib/crypto.js';
import { grantToken, ownerClient, seedFixtures, TEST_PASSWORD, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface PartnerApp {
  client_id: string;
  display_name: string;
  client_type: 'public' | 'confidential';
  redirect_uris: string[];
  scopes: string[];
  created_at: string;
}
interface PartnerAppRegistration extends PartnerApp {
  client_secret?: string;
}

/** A fresh, valid PKCE pair. */
function pkce(): { verifier: string; challenge: string } {
  const verifier = generateToken(48).slice(0, 64);
  return { verifier, challenge: deriveCodeChallenge(verifier) };
}

const CALLBACK = 'https://partner-a.example.test/callback';

describe('partner apps (FR-MOD-09.4)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  /** Holds the admin write scope plus two grantable scopes. */
  let adminToken: string;
  let readToken: string;
  let adminTokenB: string;
  /** Admin rights but nothing else — the ceiling test's weak session. */
  let narrowToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

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

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw', 'chats--all:rw', 'customers:ro'],
    });
    readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:ro'],
    });
    adminTokenB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['access_rules:rw', 'chats--all:rw'],
    });
    narrowToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw'],
    });
  });

  const body = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    display_name: 'Partner App',
    client_type: 'confidential',
    redirect_uris: [CALLBACK],
    scopes: ['chats--all:rw'],
    ...overrides,
  });

  const register = (overrides: Record<string, unknown> = {}, token = adminToken) =>
    server.post('/partner/apps', body(overrides), auth(token));

  const registered = async (
    overrides: Record<string, unknown> = {},
  ): Promise<PartnerAppRegistration> => {
    const res = await register(overrides);
    expect(res.statusCode, res.payload).toBe(201);
    return res.json() as PartnerAppRegistration;
  };

  // --- Redirect URI allowlist (negative first, NFR-S3) -----------------------

  describe('registration refuses an unusable or unsafe redirect_uri', () => {
    it('rejects a non-https scheme away from localhost', async () => {
      for (const uri of [
        'http://evil.example.test/callback',
        'http://partner-a.example.test/callback',
        'ftp://partner-a.example.test/callback',
      ]) {
        const res = await register({ redirect_uris: [uri] });
        expect(res.statusCode, uri).toBe(400);
      }
    });

    it('rejects wildcards, fragments, traversal and embedded credentials', async () => {
      for (const uri of [
        'https://partner-a.example.test/*',
        'https://partner-a.example.test/callback#token',
        'https://partner-a.example.test/a/../callback',
        'https://evil.example.test@partner-a.example.test/callback',
      ]) {
        const res = await register({ redirect_uris: [uri] });
        expect(res.statusCode, uri).toBe(400);
      }
    });

    it('rejects a relative URI and a non-network scheme', async () => {
      for (const uri of ['/callback', 'javascript:alert(1)', 'data:text/html,x']) {
        const res = await register({ redirect_uris: [uri] });
        expect(res.statusCode, uri).toBe(400);
      }
    });

    /**
     * The literal `..` check is not enough on its own: `%2e%2e` reads as a
     * traversal segment to the URL parser but not to `String.includes`. It is
     * the canonical-form rule below that catches it — asserted here so that
     * relaxing one guard cannot quietly reopen the other.
     */
    it('rejects percent-encoded traversal and a homograph host', async () => {
      for (const uri of [
        'https://partner-a.example.test/%2e%2e/callback',
        // Cyrillic "а" — punycodes to a different host than it reads as.
        'https://pаrtner-a.example.test/callback',
      ]) {
        const res = await register({ redirect_uris: [uri] });
        expect(res.statusCode, uri).toBe(400);
      }
    });

    /**
     * The rule that prevents silent breakage rather than attack: sign-in
     * compares raw strings, so a URI that only matches after normalising is a
     * registration that can never be used.
     */
    it('rejects a URI that is not already in canonical form', async () => {
      for (const uri of [
        'https://partner-a.example.test:443/callback',
        'https://PARTNER-A.example.test/callback',
        'https://partner-a.example.test',
      ]) {
        const res = await register({ redirect_uris: [uri] });
        expect(res.statusCode, uri).toBe(400);
      }
    });

    it('rejects duplicates and an over-long list', async () => {
      expect((await register({ redirect_uris: [CALLBACK, CALLBACK] })).statusCode).toBe(400);
      const many = Array.from(
        { length: 11 },
        (_, i) => `https://partner-a.example.test/cb-${i}`,
      );
      expect((await register({ redirect_uris: many })).statusCode).toBe(400);
      expect((await register({ redirect_uris: [] })).statusCode).toBe(400);
    });

    it('accepts http on localhost, the development exception the OAuth flow already makes', async () => {
      const app = await registered({
        redirect_uris: ['http://localhost:5173/auth/callback', 'http://127.0.0.1:5173/cb'],
      });
      expect(app.redirect_uris).toEqual([
        'http://localhost:5173/auth/callback',
        'http://127.0.0.1:5173/cb',
      ]);
    });
  });

  // --- Scope ceiling (negative first, NFR-S5) --------------------------------

  describe('scopes cannot exceed the registering session', () => {
    it('refuses a scope the session does not hold', async () => {
      const res = await register({ scopes: ['chats--all:rw'] }, narrowToken);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.message).toContain('chats--all:rw');
    });

    it('refuses an unknown scope string', async () => {
      expect((await register({ scopes: ['not_a_real_scope'] })).statusCode).toBe(403);
    });

    it('refuses an empty scope list — an unscoped client is unbounded, not restricted', async () => {
      // `POST /auth/authorize` reads an empty `client.scopes` as "no ceiling",
      // so this is the opposite of what an empty list looks like it means.
      expect((await register({ scopes: [] })).statusCode).toBe(400);
    });

    it('allows a scope the session holds only by implication (`:rw` covers `:ro`)', async () => {
      const app = await registered({ scopes: ['chats--all:ro'] });
      expect(app.scopes).toEqual(['chats--all:ro']);
    });

    it('applies the same ceiling on update, not just on create', async () => {
      const app = await registered({ scopes: ['access_rules:rw'] });
      const res = await server.patch(
        `/partner/apps/${app.client_id}`,
        { scopes: ['chats--all:rw'] },
        auth(narrowToken),
      );
      expect(res.statusCode).toBe(403);
    });
  });

  // --- Authentication and scope gate -----------------------------------------

  describe('the surface is admin-gated', () => {
    it('refuses an unauthenticated caller with 401', async () => {
      expect((await server.get('/partner/apps')).statusCode).toBe(401);
      expect((await server.post('/partner/apps', body())).statusCode).toBe(401);
    });

    it('refuses a read-only token on every write with 403', async () => {
      const app = await registered();
      expect((await register({}, readToken)).statusCode).toBe(403);
      expect(
        (
          await server.patch(
            `/partner/apps/${app.client_id}`,
            { display_name: 'Renamed' },
            auth(readToken),
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (await server.del(`/partner/apps/${app.client_id}`, auth(readToken))).statusCode,
      ).toBe(403);
    });

    it('refuses a token with no admin scope at all with 403', async () => {
      const noScope = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: [],
      });
      expect((await server.get('/partner/apps', auth(noScope))).statusCode).toBe(403);
    });
  });

  // --- The secret is never re-exposed (NFR-S2) -------------------------------

  describe('the client secret leaves exactly once', () => {
    it('is absent from list and get, and stored only as a hash', async () => {
      const app = await registered();
      expect(app.client_secret).toMatch(/^nxcs_/);

      const list = await server.get('/partner/apps', auth(readToken));
      const { items } = list.json() as { items: PartnerApp[] };
      const mine = items.find((i) => i.client_id === app.client_id)!;
      expect(mine).not.toHaveProperty('client_secret');
      expect(list.payload).not.toContain(app.client_secret);

      const one = await server.get(`/partner/apps/${app.client_id}`, auth(readToken));
      expect(one.statusCode).toBe(200);
      expect(one.json()).not.toHaveProperty('client_secret');
      expect(one.payload).not.toContain(app.client_secret);

      // Storage keeps the digest the token endpoint compares against — never
      // the plaintext.
      const row = await owner.oauthClient.findUnique({ where: { id: app.client_id } });
      expect(row?.secretHash).toBe(hashToken(app.client_secret!));
      expect(row?.secretHash).not.toBe(app.client_secret);
    });

    it('is never minted for a public client', async () => {
      const app = await registered({ client_type: 'public' });
      expect(app.client_secret).toBeUndefined();

      const row = await owner.oauthClient.findUnique({ where: { id: app.client_id } });
      expect(row?.secretHash).toBeNull();
    });

    it('marks the register response uncacheable', async () => {
      const res = await register();
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  // --- Cross-tenant isolation (NFR-S4/S5) ------------------------------------

  describe("another organization's client is invisible, not forbidden", () => {
    it('answers 404 — never 403 — to get, patch and delete', async () => {
      const mine = await registered();

      for (const res of [
        await server.get(`/partner/apps/${mine.client_id}`, auth(adminTokenB)),
        await server.patch(
          `/partner/apps/${mine.client_id}`,
          { display_name: 'Stolen' },
          auth(adminTokenB),
        ),
        await server.del(`/partner/apps/${mine.client_id}`, auth(adminTokenB)),
      ]) {
        expect(res.statusCode).toBe(404);
        expect(res.json().error.type).toBe('not_found');
      }

      // And nothing was actually touched.
      const still = await server.get(`/partner/apps/${mine.client_id}`, auth(readToken));
      expect((still.json() as PartnerApp).display_name).toBe('Partner App');
    });

    it('never lists a client belonging to the other organization', async () => {
      const mine = await registered();
      const theirs = (
        await server.post(
          '/partner/apps',
          body({ display_name: 'Theirs', redirect_uris: ['https://partner-b.example.test/cb'] }),
          auth(adminTokenB),
        )
      ).json() as PartnerAppRegistration;

      const listA = await server.get('/partner/apps', auth(readToken));
      const idsA = (listA.json() as { items: PartnerApp[] }).items.map((i) => i.client_id);
      expect(idsA).toContain(mine.client_id);
      expect(idsA).not.toContain(theirs.client_id);

      const listB = await server.get('/partner/apps', auth(adminTokenB));
      const idsB = (listB.json() as { items: PartnerApp[] }).items.map((i) => i.client_id);
      expect(idsB).toContain(theirs.client_id);
      expect(idsB).not.toContain(mine.client_id);
    });

    /**
     * The isolation the CRUD tests assert is enforced by RLS on the portal
     * surface. `POST /auth/authorize` is public and looks its client up
     * *without* a tenant context — a different code path, and the one that
     * actually hands out authorization codes. Asserted here so a registered
     * client stays confined to its own workspace on both surfaces.
     */
    it("refuses to authorize against another organization's client", async () => {
      const theirsRedirect = 'https://partner-b.example.test/cb';
      const theirs = (
        await server.post(
          '/partner/apps',
          body({ display_name: 'Theirs', redirect_uris: [theirsRedirect] }),
          auth(adminTokenB),
        )
      ).json() as PartnerAppRegistration;

      const { challenge } = pkce();
      const response = await server.post('/auth/authorize', {
        client_id: theirs.client_id,
        redirect_uri: theirsRedirect,
        code_challenge: challenge,
        // Valid credentials and a workspace this account really belongs to —
        // just not the one the client was registered in.
        email: fx.a.ownerEmail,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
      });
      // 404, not 403: a 403 would confirm the client id is real, which is how
      // an attacker enumerates other workspaces' apps (NFR-S5).
      expect(response.statusCode, response.payload).toBe(404);
      expect(response.json().error.type).toBe('not_found');
    });
  });

  // --- The workspace's own sign-in client is not a partner app ---------------

  describe("the workspace's own sign-in client is protected", () => {
    it('cannot be edited or deleted, though it is listed', async () => {
      // The fixture's client is the organization's oldest — exactly what
      // `auth_list_memberships` hands the agent app as its `client_id`.
      const list = await server.get('/partner/apps', auth(readToken));
      const ids = (list.json() as { items: PartnerApp[] }).items.map((i) => i.client_id);
      expect(ids).toContain(fx.a.clientId);

      const patched = await server.patch(
        `/partner/apps/${fx.a.clientId}`,
        { redirect_uris: ['https://elsewhere.example.test/callback'] },
        auth(adminToken),
      );
      expect(patched.statusCode).toBe(400);

      const deleted = await server.del(`/partner/apps/${fx.a.clientId}`, auth(adminToken));
      expect(deleted.statusCode).toBe(400);

      // Sign-in still works through it.
      const row = await owner.oauthClient.findUnique({ where: { id: fx.a.clientId } });
      expect(row?.redirectUris).toContain(fx.a.redirectUri);
    });
  });

  // --- CRUD ------------------------------------------------------------------

  describe('register, read, update, remove', () => {
    it('registers with a random client_id that leaks nothing about the workspace', async () => {
      const app = await registered();
      expect(app.client_id).toMatch(/^[0-9a-f]{32}$/);
      expect(app.client_id).not.toContain(fx.a.organizationId);
      expect(app.display_name).toBe('Partner App');
      expect(app.client_type).toBe('confidential');
      expect(app.redirect_uris).toEqual([CALLBACK]);
      expect(app.scopes).toEqual(['chats--all:rw']);
    });

    it('updates name, redirect_uris and scopes, and returns the stored row', async () => {
      const app = await registered();
      const res = await server.patch(
        `/partner/apps/${app.client_id}`,
        {
          display_name: 'Renamed',
          redirect_uris: ['https://partner-a.example.test/v2/callback'],
          scopes: ['customers:ro'],
        },
        auth(adminToken),
      );
      expect(res.statusCode).toBe(200);

      const updated = res.json() as PartnerApp;
      expect(updated.display_name).toBe('Renamed');
      expect(updated.redirect_uris).toEqual(['https://partner-a.example.test/v2/callback']);
      expect(updated.scopes).toEqual(['customers:ro']);
      // client_type stays put — it is not patchable.
      expect(updated.client_type).toBe('confidential');

      const reread = await server.get(`/partner/apps/${app.client_id}`, auth(readToken));
      expect(reread.json()).toEqual(updated);
    });

    it('refuses an empty patch, an unknown field and a client_type change', async () => {
      const app = await registered();
      for (const patch of [
        {},
        { display_nmae: 'typo' },
        { client_type: 'public' },
        { redirect_uris: ['http://evil.example.test/cb'] },
      ]) {
        const res = await server.patch(`/partner/apps/${app.client_id}`, patch, auth(adminToken));
        expect(res.statusCode, JSON.stringify(patch)).toBe(400);
      }
    });

    it('removes a client and answers 404 afterwards', async () => {
      const app = await registered();
      expect((await server.del(`/partner/apps/${app.client_id}`, auth(adminToken))).statusCode).toBe(
        204,
      );
      expect((await server.get(`/partner/apps/${app.client_id}`, auth(readToken))).statusCode).toBe(
        404,
      );
      expect((await server.del(`/partner/apps/${app.client_id}`, auth(adminToken))).statusCode).toBe(
        404,
      );
    });
  });

  // --- The claim the whole slice rests on ------------------------------------

  it('mints a client that completes a real OAuth 2.1 authorize → token exchange', async () => {
    const app = await registered();
    const { verifier, challenge } = pkce();

    const authorized = await server.post('/auth/authorize', {
      client_id: app.client_id,
      redirect_uri: CALLBACK,
      code_challenge: challenge,
      email: fx.a.ownerEmail,
      password: TEST_PASSWORD,
      license_id: fx.a.licenseId.toString(),
    });
    expect(authorized.statusCode, authorized.payload).toBe(200);
    const { code } = authorized.json() as { code: string };

    const granted = await server.post('/auth/token', {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: app.client_id,
      client_secret: app.client_secret,
      redirect_uri: CALLBACK,
    });
    // The proof that `secret_hash` is stored in the format
    // `#authenticateClient` verifies against.
    expect(granted.statusCode, granted.payload).toBe(200);

    const grant = granted.json() as { access_token: string; scope: string };
    expect(grant.access_token).toBeTruthy();
    // And the registered scope list is the ceiling: an owner's session would
    // otherwise carry the whole admin set.
    expect(grant.scope.split(' ').filter(Boolean).sort()).toEqual(['chats--all:rw']);
  });

  it('refuses the exchange when the client secret is wrong or missing', async () => {
    const app = await registered();

    for (const secret of [undefined, 'nxcs_not-the-real-secret']) {
      const { verifier, challenge } = pkce();
      const authorized = await server.post('/auth/authorize', {
        client_id: app.client_id,
        redirect_uri: CALLBACK,
        code_challenge: challenge,
        email: fx.a.ownerEmail,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
      });
      expect(authorized.statusCode).toBe(200);

      const granted = await server.post('/auth/token', {
        grant_type: 'authorization_code',
        code: (authorized.json() as { code: string }).code,
        code_verifier: verifier,
        client_id: app.client_id,
        ...(secret === undefined ? {} : { client_secret: secret }),
        redirect_uri: CALLBACK,
      });
      expect(granted.statusCode, String(secret)).toBe(401);
      expect(granted.json().error.details.oauth_error).toBe('invalid_client');
    }
  });

  // --- The registered scope set bounds the grant (09.4-g) --------------------

  /**
   * Registration caps a client against the *session* that registered it; these
   * cap the grant against the *client*. Both are needed: without this one, a
   * client registered for a single read scope would still receive the owner's
   * whole admin set the moment that owner signed into it, and the registration
   * ceiling would be decoration.
   */
  describe('the grant is bounded by what the client registered, not by who signs in', () => {
    const authorize = async (app: PartnerAppRegistration, scope?: string) => {
      const { verifier, challenge } = pkce();
      const response = await server.post('/auth/authorize', {
        client_id: app.client_id,
        redirect_uri: CALLBACK,
        code_challenge: challenge,
        email: fx.a.ownerEmail,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
        ...(scope === undefined ? {} : { scope }),
      });
      return { response, verifier };
    };

    it('narrows a request that asks for more than the client holds', async () => {
      const app = await registered({ scopes: ['chats--all:ro'] });
      // The signer is the workspace owner, so `customers:ro` is theirs to give;
      // it is the client that never registered for it.
      const { response, verifier } = await authorize(app, 'chats--all:ro,customers:ro');
      expect(response.statusCode, response.payload).toBe(200);

      const granted = await server.post('/auth/token', {
        grant_type: 'authorization_code',
        code: (response.json() as { code: string }).code,
        code_verifier: verifier,
        client_id: app.client_id,
        client_secret: app.client_secret,
        redirect_uri: CALLBACK,
      });
      expect(granted.statusCode, granted.payload).toBe(200);

      const grant = granted.json() as { access_token: string; scope: string };
      expect(grant.scope.split(' ').filter(Boolean)).toEqual(['chats--all:ro']);

      // The dropped scope is unusable, not merely unreported — the narrowing is
      // enforced by the route gate, not just written into the response body.
      const denied = await server.get('/customers', auth(grant.access_token));
      expect(denied.statusCode, denied.payload).toBe(403);
    });

    it('refuses outright when nothing requested is registered', async () => {
      const app = await registered({ scopes: ['chats--all:ro'] });
      const { response } = await authorize(app, 'customers:ro');
      // Better than issuing an empty grant: a token with no scopes would sail
      // through the exchange and fail confusingly at the first real call.
      expect(response.statusCode, response.payload).toBe(400);
      expect(response.json().error.message).toMatch(/scopes/i);
    });

    it('falls back to the registered set when the request names no scope at all', async () => {
      const app = await registered({ scopes: ['customers:ro'] });
      const { response, verifier } = await authorize(app);
      expect(response.statusCode, response.payload).toBe(200);

      const granted = await server.post('/auth/token', {
        grant_type: 'authorization_code',
        code: (response.json() as { code: string }).code,
        code_verifier: verifier,
        client_id: app.client_id,
        client_secret: app.client_secret,
        redirect_uri: CALLBACK,
      });
      expect(granted.statusCode, granted.payload).toBe(200);
      expect((granted.json() as { scope: string }).scope.split(' ').filter(Boolean)).toEqual([
        'customers:ro',
      ]);
    });
  });

  // --- Secret rotation (09.4-d) ----------------------------------------------

  describe('rotating a client secret', () => {
    const rotate = (clientId: string, token = adminToken) =>
      server.post(`/partner/apps/${clientId}/rotate-secret`, undefined, auth(token));

    /** A full authorize → token exchange with the given secret. */
    const exchange = async (clientId: string, secret: string | undefined) => {
      const { verifier, challenge } = pkce();
      const authorized = await server.post('/auth/authorize', {
        client_id: clientId,
        redirect_uri: CALLBACK,
        code_challenge: challenge,
        email: fx.a.ownerEmail,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
      });
      expect(authorized.statusCode, authorized.payload).toBe(200);

      return server.post('/auth/token', {
        grant_type: 'authorization_code',
        code: (authorized.json() as { code: string }).code,
        code_verifier: verifier,
        client_id: clientId,
        ...(secret === undefined ? {} : { client_secret: secret }),
        redirect_uri: CALLBACK,
      });
    };

    it('refuses a public client — there is no secret to rotate', async () => {
      const app = await registered({ client_type: 'public' });
      const res = await rotate(app.client_id);
      expect(res.statusCode, res.payload).toBe(400);

      // And nothing was minted behind the refusal: a stored hash on a public
      // client would be a credential the token endpoint never asks for.
      const row = await owner.oauthClient.findUnique({ where: { id: app.client_id } });
      expect(row?.secretHash).toBeNull();
    });

    it("refuses another organization's client with 404, leaving its secret intact", async () => {
      const mine = await registered();
      const before = await owner.oauthClient.findUnique({ where: { id: mine.client_id } });

      const res = await rotate(mine.client_id, adminTokenB);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.type).toBe('not_found');

      const after = await owner.oauthClient.findUnique({ where: { id: mine.client_id } });
      expect(after?.secretHash).toBe(before?.secretHash);
    });

    it("refuses the workspace's own sign-in client", async () => {
      expect((await rotate(fx.a.clientId)).statusCode).toBe(400);
    });

    it('is admin-gated: 401 unauthenticated, 403 read-only', async () => {
      const app = await registered();
      expect(
        (await server.post(`/partner/apps/${app.client_id}/rotate-secret`)).statusCode,
      ).toBe(401);
      expect((await rotate(app.client_id, readToken)).statusCode).toBe(403);
    });

    it('answers 404 for a client that does not exist', async () => {
      expect((await rotate('0'.repeat(32))).statusCode).toBe(404);
    });

    it('invalidates the old secret immediately and mints a working new one', async () => {
      const app = await registered();

      const res = await rotate(app.client_id);
      expect(res.statusCode, res.payload).toBe(200);
      const rotated = res.json() as PartnerAppRegistration;

      expect(rotated.client_secret).toMatch(/^nxcs_/);
      expect(rotated.client_secret).not.toBe(app.client_secret);
      // Everything else about the app is untouched — rotation re-keys, it does
      // not re-register: the client_id survives, so existing authorizations do.
      expect(rotated.client_id).toBe(app.client_id);
      expect(rotated.redirect_uris).toEqual([CALLBACK]);
      expect(rotated.scopes).toEqual(['chats--all:rw']);

      // No overlap window: the leaked secret is dead the moment this commits.
      const withOld = await exchange(app.client_id, app.client_secret);
      expect(withOld.statusCode).toBe(401);
      expect(withOld.json().error.details.oauth_error).toBe('invalid_client');

      // And the new one really authenticates — the same `secret_hash` format
      // claim registration makes, re-asserted for the rotation path.
      const withNew = await exchange(app.client_id, rotated.client_secret);
      expect(withNew.statusCode, withNew.payload).toBe(200);
    });

    it('stores only the new hash, and never re-exposes it', async () => {
      const app = await registered();
      const rotated = (await rotate(app.client_id)).json() as PartnerAppRegistration;

      const row = await owner.oauthClient.findUnique({ where: { id: app.client_id } });
      expect(row?.secretHash).toBe(hashToken(rotated.client_secret!));
      expect(row?.secretHash).not.toBe(hashToken(app.client_secret!));

      const one = await server.get(`/partner/apps/${app.client_id}`, auth(readToken));
      expect(one.json()).not.toHaveProperty('client_secret');
      expect(one.payload).not.toContain(rotated.client_secret);

      const list = await server.get('/partner/apps', auth(readToken));
      expect(list.payload).not.toContain(rotated.client_secret);
    });

    it('marks the rotate response uncacheable', async () => {
      const app = await registered();
      expect((await rotate(app.client_id)).headers['cache-control']).toBe('no-store');
    });
  });

  it('refuses an authorization request for a redirect_uri it never registered', async () => {
    const app = await registered();
    const { challenge } = pkce();

    const authorized = await server.post('/auth/authorize', {
      client_id: app.client_id,
      redirect_uri: 'https://partner-a.example.test/other',
      code_challenge: challenge,
      email: fx.a.ownerEmail,
      password: TEST_PASSWORD,
      license_id: fx.a.licenseId.toString(),
    });
    expect(authorized.statusCode).toBe(400);
  });
});
