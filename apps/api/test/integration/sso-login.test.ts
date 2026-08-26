/**
 * SAML sign-in end to end through the SP endpoints (S11-d).
 *
 * `sso.test.ts` covers configuring a connection. This covers *using* one: the
 * browser leaves for the identity provider at `/auth/saml/{id}/login` and comes
 * back to `/auth/saml/{id}/acs` with a signed assertion, which either becomes a
 * session or is refused with a reason only the workspace's audit log sees.
 *
 * What is worth pinning here, and why:
 *
 *   - **The session comes out of the ordinary OAuth path.** The ACS ends with an
 *     authorization code redeemed at `/auth/token` with the PKCE verifier the
 *     browser kept. If a second token-minting path ever appears, the assertion
 *     below — sign in, then call `/auth/me` with the resulting token — is what
 *     stops it from being an unnoticed one.
 *   - **The rejection matrix is wired in, not re-proved.** `saml.test.ts` (S11-b)
 *     exhausts the verifier against 23 refusals. Here each family gets one case,
 *     because what is under test is that the endpoint hands the verifier the
 *     right expectations — this connection's certificate, this connection's
 *     audience, this login's `InResponseTo` — and records what came back.
 *   - **JIT provisioning cannot be used to take anything over.** A workspace's
 *     IdP may add a member to its own workspace; it may not rename somebody,
 *     clear their password, lift their suspension or reset their role.
 *   - **Cross-tenant.** An assertion minted for one workspace is worthless at
 *     another's ACS, even when both federate the same identity provider.
 *
 * Rejections first: this is the front door.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { VALID_CERTIFICATE_PEM } from '../helpers/certificates.js';
import {
  issueAssertion,
  MOCK_IDP_CERTIFICATE,
  MOCK_IDP_ENTITY_ID,
  type IssueAssertionOptions,
} from '../helpers/mock-idp.js';
import { ownerClient, seedFixtures, testEnv, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { deriveCodeChallenge, generateToken } from '../../src/lib/crypto.js';
import { API_PREFIX } from '../../src/server.js';

const IDP_SSO_URL = 'https://idp.example.test/saml/sso';

describe('saml sign-in', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let apiBase: string;
  let webAppUrl: string;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
    const env = testEnv();
    apiBase = `${env.API_BASE_URL}${API_PREFIX}`;
    webAppUrl = env.WEB_APP_URL;
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
  });

  // --- Fixtures --------------------------------------------------------------

  /**
   * A live connection, trusting the mock IdP's certificate.
   *
   * The two domains this workspace's IdP is authoritative for: the fixtures'
   * own (`owner-a@example.test`) and the one the JIT tests provision newcomers
   * from. Anything else is outside the connection's authority — which is what
   * the `verified domains` cases below measure (§D116 MEDIUM (a)).
   */
  async function connect(
    overrides: Record<string, unknown> = {},
    tenant = fx.a,
  ): Promise<{ id: string; entityId: string; acsUrl: string }> {
    const row = await owner.ssoConnection.create({
      data: {
        licenseId: tenant.licenseId,
        name: 'Okta (corp)',
        idpEntityId: MOCK_IDP_ENTITY_ID,
        idpSsoUrl: IDP_SSO_URL,
        idpCertificatePem: MOCK_IDP_CERTIFICATE,
        verifiedDomains: ['example.test', 'corp.example.test'],
        enabled: true,
        ...overrides,
      },
      select: { id: true },
    });
    return {
      id: row.id,
      entityId: `${apiBase}/auth/saml/${row.id}`,
      acsUrl: `${apiBase}/auth/saml/${row.id}/acs`,
    };
  }

  const pkce = () => {
    const verifier = generateToken(48).slice(0, 64);
    return { verifier, challenge: deriveCodeChallenge(verifier) };
  };

  interface StartedLogin {
    relayState: string;
    requestId: string;
    verifier: string;
    location: string;
  }

  /** Walk the outbound leg and hand back what the response has to answer with. */
  async function startLogin(
    connection: { id: string },
    query: Record<string, string> = {},
    tenant = fx.a,
  ): Promise<StartedLogin> {
    const { verifier, challenge } = pkce();
    const search = new URLSearchParams({
      client_id: tenant.clientId,
      redirect_uri: tenant.redirectUri,
      code_challenge: challenge,
      ...query,
    });

    const res = await server.get(`/auth/saml/${connection.id}/login?${search.toString()}`);
    expect(res.statusCode).toBe(302);

    const location = res.headers['location'] as string;
    const url = new URL(location);
    const xml = inflateRawSync(
      Buffer.from(url.searchParams.get('SAMLRequest') ?? '', 'base64'),
    ).toString('utf8');

    return {
      relayState: url.searchParams.get('RelayState') ?? '',
      requestId: /ID="([^"]+)"/.exec(xml)?.[1] ?? '',
      verifier,
      location,
    };
  }

  /** Everything a happy-path assertion for this connection needs. */
  function goodAssertion(
    connection: { entityId: string; acsUrl: string },
    login: { requestId: string } | null,
    overrides: IssueAssertionOptions = {},
  ) {
    return issueAssertion({
      subject: fx.a.agentEmail,
      audience: connection.entityId,
      destination: connection.acsUrl,
      inResponseTo: login?.requestId ?? null,
      ...overrides,
    });
  }

  const acs = (connectionId: string, body: Record<string, string>) =>
    server.app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/saml/${connectionId}/acs`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(body).toString(),
    });

  /** The reasons recorded against a license, oldest first. */
  async function failureReasons(licenseId = fx.a.licenseId): Promise<string[]> {
    const entries = await owner.auditLogEntry.findMany({
      where: { licenseId, action: 'auth.sso_login_failed' },
      orderBy: { createdAt: 'asc' },
    });
    return entries.map((entry) => (entry.metadata as { reason?: string } | null)?.reason ?? '?');
  }

  async function successEntries(licenseId = fx.a.licenseId) {
    return owner.auditLogEntry.findMany({
      where: { licenseId, action: 'auth.sso_login' },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Redeem the code on a completed sign-in, returning the grant. */
  async function redeem(location: string, verifier: string, tenant = fx.a) {
    const code = new URL(location).searchParams.get('code');
    expect(code).not.toBeNull();

    const res = await server.post('/auth/token', {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: tenant.clientId,
      redirect_uri: tenant.redirectUri,
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { access_token: string; scope: string };
  }

  // =========================================================================
  // Starting a login
  // =========================================================================

  describe('GET /auth/saml/:id/login', () => {
    it('refuses a connection that does not exist, is off, or is not ours', async () => {
      const missing = await server.get(
        `/auth/saml/00000000-0000-4000-8000-000000000000/login?client_id=x&redirect_uri=https://a.test/cb&code_challenge=${'a'.repeat(43)}`,
      );
      expect(missing.statusCode).toBe(404);

      // Disabled reads exactly like missing. A connection id travels in URLs, so
      // "no such connection" and "that workspace has SSO switched off" must not
      // be distinguishable from outside.
      const disabled = await connect({ enabled: false });
      const off = await server.get(
        `/auth/saml/${disabled.id}/login?client_id=${fx.a.clientId}&redirect_uri=${encodeURIComponent(fx.a.redirectUri)}&code_challenge=${'a'.repeat(43)}`,
      );
      expect(off.statusCode).toBe(404);
    });

    it('refuses another workspace’s client and an unregistered redirect', async () => {
      const connection = await connect();

      // Tenant B's client against tenant A's connection: the code would be
      // minted for a client of a workspace the person is not signing in to.
      const foreign = await server.get(
        `/auth/saml/${connection.id}/login?client_id=${fx.b.clientId}&redirect_uri=${encodeURIComponent(fx.b.redirectUri)}&code_challenge=${'a'.repeat(43)}`,
      );
      expect(foreign.statusCode).toBe(400);

      const unregistered = await server.get(
        `/auth/saml/${connection.id}/login?client_id=${fx.a.clientId}&redirect_uri=${encodeURIComponent('https://evil.example.test/callback')}&code_challenge=${'a'.repeat(43)}`,
      );
      expect(unregistered.statusCode).toBe(400);
    });

    it('requires PKCE before the browser leaves', async () => {
      const connection = await connect();

      const noChallenge = await server.get(
        `/auth/saml/${connection.id}/login?client_id=${fx.a.clientId}&redirect_uri=${encodeURIComponent(fx.a.redirectUri)}`,
      );
      expect(noChallenge.statusCode).toBe(400);

      const plain = await server.get(
        `/auth/saml/${connection.id}/login?client_id=${fx.a.clientId}&redirect_uri=${encodeURIComponent(fx.a.redirectUri)}&code_challenge=${'a'.repeat(43)}&code_challenge_method=plain`,
      );
      expect(plain.statusCode).toBe(400);
    });

    it('redirects to the IdP with a request addressed to this connection', async () => {
      const connection = await connect();
      const login = await startLogin(connection);
      const url = new URL(login.location);

      expect(`${url.origin}${url.pathname}`).toBe(IDP_SSO_URL);
      expect(login.relayState).not.toBe('');
      expect(login.requestId).toMatch(/^_[0-9a-f]{32}$/);

      const xml = inflateRawSync(
        Buffer.from(url.searchParams.get('SAMLRequest') ?? '', 'base64'),
      ).toString('utf8');
      expect(xml).toContain(`<saml:Issuer>${connection.entityId}</saml:Issuer>`);
      expect(xml).toContain(`AssertionConsumerServiceURL="${connection.acsUrl}"`);

      // The relay handle is opaque and carries none of what it stands for — the
      // client, the redirect and the challenge stay on our side of the IdP.
      expect(login.location).not.toContain(fx.a.redirectUri);
      expect(login.location).not.toContain(fx.a.clientId);
    });
  });

  // =========================================================================
  // Consuming an assertion — refusals
  // =========================================================================

  describe('POST /auth/saml/:id/acs — refusals', () => {
    it('records why, and tells the caller nothing', async () => {
      const connection = await connect();
      const login = await startLogin(connection);

      const wrongAudience = goodAssertion(connection, login, {
        audience: 'https://somebody-else.example.test/saml',
      });
      const res = await acs(connection.id, {
        SAMLResponse: wrongAudience.samlResponseBase64,
        RelayState: login.relayState,
      });

      expect(res.statusCode).toBe(401);
      // Which half of the forgery to fix is exactly what a refusal must not say.
      expect(res.json()).toMatchObject({ error: { message: 'Single sign-on failed.' } });
      expect(JSON.stringify(res.json())).not.toContain('audience');
      // The workspace's own admins read the reason, where it is useful.
      expect(await failureReasons()).toEqual(['audience_mismatch']);
    });

    it('refuses one case from each family the verifier rejects', async () => {
      const connection = await connect();

      const submit = async (overrides: IssueAssertionOptions) => {
        const login = await startLogin(connection);
        const assertion = goodAssertion(connection, login, overrides);
        const res = await acs(connection.id, {
          SAMLResponse: assertion.samlResponseBase64,
          RelayState: login.relayState,
        });
        expect(res.statusCode).toBe(401);
      };

      // Minted for a different service provider.
      await submit({ destination: `${apiBase}/auth/saml/somewhere-else/acs` });
      // Already expired when it arrived.
      await submit({ notOnOrAfter: new Date(Date.now() - 60 * 60_000) });
      // Answering a request that was not the one we sent.
      await submit({ inResponseTo: '_not-the-request-we-sent' });

      const garbage = await startLogin(connection);
      const notBase64 = await acs(connection.id, {
        SAMLResponse: 'this is not base64 at all',
        RelayState: garbage.relayState,
      });
      expect(notBase64.statusCode).toBe(401);

      expect(await failureReasons()).toEqual([
        'destination_mismatch',
        'expired',
        'in_response_to_mismatch',
        'malformed_base64',
      ]);
    });

    it('refuses a relay handle it does not recognise, and spends each one once', async () => {
      const connection = await connect();
      const login = await startLogin(connection);

      const unknown = await acs(connection.id, {
        SAMLResponse: goodAssertion(connection, login).samlResponseBase64,
        RelayState: '_never-issued',
      });
      expect(unknown.statusCode).toBe(401);

      // A real login, then the same relay handle again. One AuthnRequest must
      // not authorise two sessions, even with two genuine assertions.
      const first = await acs(connection.id, {
        SAMLResponse: goodAssertion(connection, login).samlResponseBase64,
        RelayState: login.relayState,
      });
      expect(first.statusCode).toBe(302);

      const second = await acs(connection.id, {
        SAMLResponse: goodAssertion(connection, login).samlResponseBase64,
        RelayState: login.relayState,
      });
      expect(second.statusCode).toBe(401);
      expect(await failureReasons()).toEqual(['unknown_relay_state', 'unknown_relay_state']);
    });

    it('refuses an unsolicited assertion unless the workspace asked for them', async () => {
      const closed = await connect();
      const refused = await acs(closed.id, {
        SAMLResponse: goodAssertion(closed, null).samlResponseBase64,
      });
      expect(refused.statusCode).toBe(401);
      expect(await failureReasons()).toEqual(['idp_initiated_not_allowed']);
    });

    it('refuses a suspended member, and does not un-suspend them', async () => {
      const connection = await connect();
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        data: { suspended: true },
      });

      const login = await startLogin(connection);
      const res = await acs(connection.id, {
        SAMLResponse: goodAssertion(connection, login).samlResponseBase64,
        RelayState: login.relayState,
      });

      expect(res.statusCode).toBe(401);
      expect(await failureReasons()).toEqual(['membership_not_active']);
      // The IdP still vouches for them; suspension is *our* answer, and a
      // sign-in must not quietly overrule it.
      const membership = await owner.agentMembership.findUnique({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
      });
      expect(membership?.suspended).toBe(true);
    });

    it('refuses an assertion whose subject is not an address', async () => {
      const connection = await connect();
      const login = await startLogin(connection);
      const assertion = issueAssertion({
        subject: 'not-an-address',
        attributes: {},
        audience: connection.entityId,
        destination: connection.acsUrl,
        inResponseTo: login.requestId,
      });

      const res = await acs(connection.id, {
        SAMLResponse: assertion.samlResponseBase64,
        RelayState: login.relayState,
      });
      expect(res.statusCode).toBe(401);
      expect(await failureReasons()).toEqual(['email_invalid']);
    });
  });

  // =========================================================================
  // Cross-tenant
  // =========================================================================

  it('is worthless at another workspace’s ACS, same IdP or not', async () => {
    // Both workspaces federate the *same* identity provider, so the signature
    // verifies at either — B is even set to accept unsolicited responses, so
    // nothing stops the assertion from being examined in full. What separates
    // them is that the destination and the audience name one connection rather
    // than the deployment.
    const a = await connect();
    const b = await connect({ allowIdpInitiated: true }, fx.b);

    const login = await startLogin(a);
    const forA = goodAssertion(a, login);

    const atB = await acs(b.id, { SAMLResponse: forA.samlResponseBase64 });
    expect(atB.statusCode).toBe(401);

    // A's relay handle is equally worthless at B: it names A's connection.
    const relayAtB = await acs(b.id, {
      SAMLResponse: forA.samlResponseBase64,
      RelayState: login.relayState,
    });
    expect(relayAtB.statusCode).toBe(401);

    expect(await failureReasons(fx.b.licenseId)).toEqual([
      'destination_mismatch',
      'unknown_relay_state',
    ]);
    // And nothing was written into A's trail by a request aimed at B.
    expect(await successEntries()).toHaveLength(0);
    expect(await failureReasons()).toEqual([]);
  });

  // =========================================================================
  // Consuming an assertion — the sign-in
  // =========================================================================

  describe('POST /auth/saml/:id/acs — sign-in', () => {
    it('ends in a code that becomes a session through the ordinary token path', async () => {
      const connection = await connect();
      const login = await startLogin(connection, { state: 'app-state-123' });

      const res = await acs(connection.id, {
        SAMLResponse: goodAssertion(connection, login).samlResponseBase64,
        RelayState: login.relayState,
      });
      expect(res.statusCode).toBe(302);

      const location = new URL(res.headers['location'] as string);
      expect(`${location.origin}${location.pathname}`).toBe(fx.a.redirectUri);
      expect(location.searchParams.get('state')).toBe('app-state-123');
      // No token is ever handed to a redirect — that is the flow OAuth 2.1
      // removed, and the reason the ACS stops at a code.
      expect(location.searchParams.get('access_token')).toBeNull();

      const grant = await redeem(location.toString(), login.verifier);
      const me = await server.get('/auth/me', { authorization: `Bearer ${grant.access_token}` });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({
        email: fx.a.agentEmail,
        role: 'agent',
        license_id: fx.a.licenseId.toString(),
      });

      const entries = await successEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: fx.a.agentAccountId,
        target: `sso_connection:${connection.id}`,
      });
      expect(entries[0]?.metadata).toMatchObject({ role: 'agent', jit_provisioned: false });
    });

    it('refuses the code to anybody who did not start the login (PKCE)', async () => {
      const connection = await connect();
      const login = await startLogin(connection);

      const res = await acs(connection.id, {
        SAMLResponse: goodAssertion(connection, login).samlResponseBase64,
        RelayState: login.relayState,
      });
      const code = new URL(res.headers['location'] as string).searchParams.get('code');

      // An attacker holding the code — from a proxy log, a shared machine — has
      // no verifier, and the assertion did not help them get one.
      const stolen = await server.post('/auth/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: pkce().verifier,
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
      });
      expect(stolen.statusCode).toBe(401);
    });

    it('provisions an unknown person as an agent, once', async () => {
      const connection = await connect();
      const email = 'newcomer@corp.example.test';

      const first = await startLogin(connection);
      const res = await acs(connection.id, {
        SAMLResponse: goodAssertion(connection, first, {
          subject: email,
          attributes: { email: [email], displayName: ['Ada Lovelace'] },
        }).samlResponseBase64,
        RelayState: first.relayState,
      });
      expect(res.statusCode).toBe(302);

      const account = await owner.account.findUnique({ where: { email } });
      expect(account).toMatchObject({ name: 'Ada Lovelace', passwordHash: null });
      const membership = await owner.agentMembership.findUnique({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: account!.id } },
      });
      expect(membership).toMatchObject({ role: 'agent', suspended: false });

      const grant = await redeem(res.headers['location'] as string, first.verifier);
      const me = await server.get('/auth/me', { authorization: `Bearer ${grant.access_token}` });
      expect(me.json()).toMatchObject({ email, role: 'agent' });

      // A second sign-in is not a second provisioning.
      const again = await startLogin(connection);
      const repeat = await acs(connection.id, {
        SAMLResponse: goodAssertion(connection, again, {
          subject: email,
          attributes: { email: [email] },
        }).samlResponseBase64,
        RelayState: again.relayState,
      });
      expect(repeat.statusCode).toBe(302);

      const entries = await successEntries();
      expect(
        entries.map((e) => (e.metadata as { jit_provisioned?: boolean }).jit_provisioned),
      ).toEqual([true, false]);
      expect(await owner.account.count({ where: { email } })).toBe(1);
    });

    it('refuses an address outside the domains the connection has verified', async () => {
      // The finding this closes (§D116 MEDIUM (a)): a workspace that configures
      // its own identity provider could assert *any* address and have it
      // provisioned — adopting a stranger's existing account into its tenant, or
      // squatting the account row of somebody who never signed up. The IdP
      // vouches for its own domains; nothing gave it authority over the rest of
      // the internet, and the connection now has to say which those are.
      const connection = await connect();
      const outsider = 'victim@unrelated.example.test';

      const login = await startLogin(connection);
      const res = await acs(connection.id, {
        SAMLResponse: goodAssertion(connection, login, {
          subject: outsider,
          attributes: { email: [outsider] },
        }).samlResponseBase64,
        RelayState: login.relayState,
      });

      expect(res.statusCode).toBe(401);
      expect(await failureReasons()).toEqual(['email_domain_unverified']);
      // The refusal is not merely a 401 on the way out: nothing was written, so
      // the address is still free for its real owner to sign up with.
      expect(await owner.account.count({ where: { email: outsider } })).toBe(0);
    });

    it('matches a verified domain exactly, and never by suffix', async () => {
      // `acme.test` being verified must not admit `acme.test.attacker.example`
      // (a suffix an attacker registers) or `mail.acme.test` (a subdomain the
      // workspace may not control). Both are refused; the domain itself passes,
      // so this measures the boundary rather than a blanket refusal.
      const connection = await connect({ verifiedDomains: ['acme.test'] });

      for (const email of ['a@acme.test.attacker.example', 'b@mail.acme.test', 'c@notacme.test']) {
        const login = await startLogin(connection);
        const res = await acs(connection.id, {
          SAMLResponse: goodAssertion(connection, login, {
            subject: email,
            attributes: { email: [email] },
          }).samlResponseBase64,
          RelayState: login.relayState,
        });
        expect(res.statusCode, email).toBe(401);
      }
      expect(await failureReasons()).toEqual([
        'email_domain_unverified',
        'email_domain_unverified',
        'email_domain_unverified',
      ]);

      // Case is not part of a domain: an IdP that upper-cases the address is
      // still asserting the domain it verified.
      const login = await startLogin(connection);
      const accepted = await acs(connection.id, {
        SAMLResponse: goodAssertion(connection, login, {
          subject: 'Ada@ACME.test',
          attributes: { email: ['Ada@ACME.test'] },
        }).samlResponseBase64,
        RelayState: login.relayState,
      });
      expect(accepted.statusCode).toBe(302);
    });

    it('never edits an account it did not create, and never resets a role', async () => {
      // Both fixture workspaces are on `example.test`, so this connection has
      // genuinely verified the domain B's owner lives in — which is the case
      // the domain gate is *supposed* to admit (two workspaces of one company).
      // What is under test is what stays true once it is admitted.
      const connection = await connect();
      // Tenant B's owner, asserted by tenant A's identity provider. A's admin
      // could have invited them anyway, so the membership is fair; touching the
      // person themselves is not, and neither is deciding their role here.
      const before = await owner.account.findUnique({ where: { id: fx.b.ownerAccountId } });

      const login = await startLogin(connection);
      const res = await acs(connection.id, {
        SAMLResponse: goodAssertion(connection, login, {
          subject: fx.b.ownerEmail,
          attributes: { email: [fx.b.ownerEmail], displayName: ['Renamed By A'] },
        }).samlResponseBase64,
        RelayState: login.relayState,
      });
      expect(res.statusCode).toBe(302);

      const after = await owner.account.findUnique({ where: { id: fx.b.ownerAccountId } });
      expect(after?.name).toBe(before?.name);
      expect(after?.passwordHash).toBe(before?.passwordHash);
      // In A they are a plain agent; in B they are still the owner.
      const inA = await owner.agentMembership.findUnique({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.b.ownerAccountId } },
      });
      const inB = await owner.agentMembership.findUnique({
        where: { licenseId_agentId: { licenseId: fx.b.licenseId, agentId: fx.b.ownerAccountId } },
      });
      expect(inA?.role).toBe('agent');
      expect(inB?.role).toBe('owner');

      // And the owner of *this* workspace keeps their rank across an SSO login.
      const ownerLogin = await startLogin(connection);
      const ownerRes = await acs(connection.id, {
        SAMLResponse: goodAssertion(connection, ownerLogin, { subject: fx.a.ownerEmail })
          .samlResponseBase64,
        RelayState: ownerLogin.relayState,
      });
      expect(ownerRes.statusCode).toBe(302);
      const grant = await redeem(ownerRes.headers['location'] as string, ownerLogin.verifier);
      expect(
        (await server.get('/auth/me', { authorization: `Bearer ${grant.access_token}` })).json(),
      ).toMatchObject({ role: 'owner' });
    });

    it('reads the attribute the connection configured, and only that one', async () => {
      const connection = await connect({ attributeMapping: { email: 'mail' } });

      const mapped = await startLogin(connection);
      const viaMail = await acs(connection.id, {
        SAMLResponse: goodAssertion(connection, mapped, {
          subject: 'ignored@corp.example.test',
          attributes: { mail: [fx.a.agentEmail], email: ['someone-else@corp.example.test'] },
        }).samlResponseBase64,
        RelayState: mapped.relayState,
      });
      expect(viaMail.statusCode).toBe(302);
      const grant = await redeem(viaMail.headers['location'] as string, mapped.verifier);
      expect(
        (await server.get('/auth/me', { authorization: `Bearer ${grant.access_token}` })).json(),
      ).toMatchObject({ email: fx.a.agentEmail });

      // The mapped attribute is absent: falling back to `email` would let a
      // claim the admin did not choose decide who signs in.
      const absent = await startLogin(connection);
      const res = await acs(connection.id, {
        SAMLResponse: goodAssertion(connection, absent, {
          subject: 'ignored@corp.example.test',
          attributes: { email: [fx.a.agentEmail] },
        }).samlResponseBase64,
        RelayState: absent.relayState,
      });
      expect(res.statusCode).toBe(401);
      expect(await failureReasons()).toEqual(['email_missing']);
    });

    it('honours a rotation overlap, and the certificate that replaced it', async () => {
      // The IdP is mid key-roll: the workspace has moved to a new certificate
      // but kept the old one trusted for a bounded window (§C-A17.1), and the
      // IdP is still signing with the old key.
      const connection = await connect({
        idpCertificatePem: VALID_CERTIFICATE_PEM,
        previousCertificatePem: MOCK_IDP_CERTIFICATE,
        previousCertificateExpiresAt: new Date(Date.now() + 3 * 3_600_000),
      });

      const login = await startLogin(connection);
      const res = await acs(connection.id, {
        SAMLResponse: goodAssertion(connection, login).samlResponseBase64,
        RelayState: login.relayState,
      });
      expect(res.statusCode).toBe(302);

      // Once the window lapses the same assertion is worth nothing — the row
      // keeps the bytes, but a lapsed overlap reads as no overlap.
      await owner.ssoConnection.update({
        where: { id: connection.id },
        data: { previousCertificateExpiresAt: new Date(Date.now() - 1_000) },
      });
      const after = await startLogin(connection);
      const lapsed = await acs(connection.id, {
        SAMLResponse: goodAssertion(connection, after).samlResponseBase64,
        RelayState: after.relayState,
      });
      expect(lapsed.statusCode).toBe(401);
      expect(await failureReasons()).toEqual(['invalid_signature']);
    });

    it('hands an accepted unsolicited login back to the app instead of completing it', async () => {
      const connection = await connect({ allowIdpInitiated: true });
      const assertion = goodAssertion(connection, null);

      const res = await acs(connection.id, { SAMLResponse: assertion.samlResponseBase64 });
      expect(res.statusCode).toBe(302);
      // No PKCE verifier exists behind an unsolicited response, so no code is
      // minted: the browser is sent to start an ordinary SP-initiated login,
      // which is silent against the IdP session it already has (§C-A17.6).
      expect(res.headers['location']).toBe(`${webAppUrl}/login?sso=${connection.id}`);
      expect(await successEntries()).toHaveLength(0);

      // Replayed: the assertion was spent even though it did not sign anybody in.
      const replay = await acs(connection.id, { SAMLResponse: assertion.samlResponseBase64 });
      expect(replay.statusCode).toBe(401);
      expect(await failureReasons()).toEqual(['replay']);
    });

    it('refuses to sign anybody into a canceled workspace', async () => {
      const connection = await connect();
      const login = await startLogin(connection);
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { status: 'canceled' },
      });

      const res = await acs(connection.id, {
        SAMLResponse: goodAssertion(connection, login).samlResponseBase64,
        RelayState: login.relayState,
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
