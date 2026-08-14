/**
 * The claims S11 is closed on (NFR-S11 · S11-i).
 *
 * The eight subtasks before this one each proved their own piece. This file
 * proves the pieces are one product, and it is deliberately not a summary of
 * them — every test here asserts something no single subtask could, because it
 * needs two of them at once:
 *
 *   - **The directory and the front door agree.** SCIM provisions somebody, they
 *     sign in with SAML, SCIM deprovisions them, and the *same* sign-in is
 *     refused. `scim.test.ts` proved deprovisioning suspends a membership;
 *     `sso-login.test.ts` proved a suspended membership cannot sign in. Nobody
 *     had yet run one into the other, which is the only form in which the
 *     feature is ever bought: "when a leaver is removed from Okta, do they lose
 *     Nexa?"
 *   - **The rejection matrix survives the wiring.** `saml.test.ts` exhausts the
 *     verifier in isolation against a frozen clock and an injected replay guard.
 *     Here the same five families are refused through the real endpoint, real
 *     Redis and the real certificate off the connection row — because the way
 *     this feature realistically breaks is not a verifier bug but an endpoint
 *     that hands the verifier the wrong expectations.
 *   - **Cross-tenant, across both halves.** A person A's directory provisioned
 *     is not somebody B's identity provider can vouch for.
 *   - **The anonymous read exists and stays thin.** `GET /auth/sso/{id}` is what
 *     an IdP-initiated arrival uses to start a login; it must answer with the
 *     client id and nothing about the trust anchor.
 */
import { PrismaClient } from '@prisma/client';
import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { issueAssertion, MOCK_IDP_CERTIFICATE, MOCK_IDP_ENTITY_ID } from '../helpers/mock-idp.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { deriveCodeChallenge, generateToken } from '../../src/lib/crypto.js';
import { API_PREFIX } from '../../src/server.js';

const IDP_SSO_URL = 'https://idp.example.test/saml/sso';
const SCIM_JSON = 'application/scim+json';
/** The person A's directory hires for the length of one test. */
const NEW_HIRE = 'newcomer@corp.example.test';

interface Connection {
  id: string;
  entityId: string;
  acsUrl: string;
}

describe('sso end-to-end verification', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let apiBase: string;
  let scimA: string;
  let scimB: string;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
    apiBase = `${testEnv().API_BASE_URL}${API_PREFIX}`;
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    scimA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      kind: 'scim',
      scopes: [],
    });
    scimB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      kind: 'scim',
      scopes: [],
    });
  });

  // --- Helpers ---------------------------------------------------------------

  async function connect(
    overrides: Record<string, unknown> = {},
    tenant = fx.a,
  ): Promise<Connection> {
    const row = await owner.ssoConnection.create({
      data: {
        licenseId: tenant.licenseId,
        name: 'Okta (corp)',
        idpEntityId: MOCK_IDP_ENTITY_ID,
        idpSsoUrl: IDP_SSO_URL,
        idpCertificatePem: MOCK_IDP_CERTIFICATE,
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

  /** Walk the outbound leg, returning what the assertion has to answer with. */
  async function startLogin(
    connection: Connection,
    tenant = fx.a,
  ): Promise<{ relayState: string; requestId: string; verifier: string }> {
    const verifier = generateToken(48).slice(0, 64);
    const search = new URLSearchParams({
      client_id: tenant.clientId,
      redirect_uri: tenant.redirectUri,
      code_challenge: deriveCodeChallenge(verifier),
    });
    const res = await server.get(`/auth/saml/${connection.id}/login?${search.toString()}`);
    expect(res.statusCode).toBe(302);

    const url = new URL(res.headers['location'] as string);
    const xml = inflateRawSync(
      Buffer.from(url.searchParams.get('SAMLRequest') ?? '', 'base64'),
    ).toString('utf8');
    return {
      relayState: url.searchParams.get('RelayState') ?? '',
      requestId: /ID="([^"]+)"/.exec(xml)?.[1] ?? '',
      verifier,
    };
  }

  const acs = (connectionId: string, body: Record<string, string>) =>
    server.app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/saml/${connectionId}/acs`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(body).toString(),
    });

  /** Start a login and finish it with `subject`, returning the ACS response. */
  async function signInAs(
    connection: Connection,
    subject: string,
    tenant = fx.a,
  ): Promise<{ status: number; location: string; verifier: string }> {
    const login = await startLogin(connection, tenant);
    const assertion = issueAssertion({
      subject,
      audience: connection.entityId,
      destination: connection.acsUrl,
      inResponseTo: login.requestId,
    });
    const res = await acs(connection.id, {
      SAMLResponse: assertion.samlResponseBase64,
      RelayState: login.relayState,
    });
    return {
      status: res.statusCode,
      location: (res.headers['location'] as string) ?? '',
      verifier: login.verifier,
    };
  }

  /** The reasons a license recorded, oldest first. */
  async function failureReasons(licenseId = fx.a.licenseId): Promise<string[]> {
    const entries = await owner.auditLogEntry.findMany({
      where: { licenseId, action: 'auth.sso_login_failed' },
      orderBy: { createdAt: 'asc' },
    });
    return entries.map((entry) => (entry.metadata as { reason?: string } | null)?.reason ?? '?');
  }

  const scimHeaders = (token: string) => ({
    authorization: `Bearer ${token}`,
    'content-type': SCIM_JSON,
  });

  // =========================================================================
  // The directory and the front door, as one system
  // =========================================================================

  describe('SCIM lifecycle joined to SAML sign-in', () => {
    it('provisions a person who can then sign in, and deprovisions one who cannot', async () => {
      const connection = await connect();

      // 1. The directory hires somebody. Nobody has signed in as them, and no
      //    invitation was sent — the workspace's IdP is the only thing that
      //    knows they exist.
      const provisioned = await server.post(
        '/scim/v2/Users',
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: NEW_HIRE,
          displayName: 'Nadia Farouk',
          active: true,
        },
        scimHeaders(scimA),
      );
      expect(provisioned.statusCode).toBe(201);
      const scimId = (provisioned.json() as { id: string }).id;

      // 2. They sign in with SAML, and the session is genuinely theirs — proven
      //    through the ordinary token exchange, not by reading the redirect.
      const first = await signInAs(connection, NEW_HIRE);
      expect(first.status).toBe(302);

      const granted = await server.post('/auth/token', {
        grant_type: 'authorization_code',
        code: new URL(first.location).searchParams.get('code'),
        code_verifier: first.verifier,
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
      });
      expect(granted.statusCode).toBe(200);
      const { access_token: accessToken } = granted.json() as { access_token: string };

      const me = await server.get('/auth/me', { authorization: `Bearer ${accessToken}` });
      expect(me.statusCode).toBe(200);
      expect((me.json() as { email: string }).email).toBe(NEW_HIRE);

      // 3. They leave, and the directory says so. DELETE suspends rather than
      //    removes — the membership carries history — but the effect a customer
      //    buys this for is the next line.
      const removed = await server.del(`/scim/v2/Users/${scimId}`, scimHeaders(scimA));
      expect(removed.statusCode).toBe(204);

      // 4. The same sign-in, with the same identity provider still vouching for
      //    them, is refused. This is the whole feature in one assertion.
      const after = await signInAs(connection, NEW_HIRE);
      expect(after.status).toBe(401);
      expect(await failureReasons()).toEqual(['membership_not_active']);

      // And the live session is dead too: membership is re-read on every
      // request, so there is no window in which a leaver keeps working.
      const stale = await server.get('/auth/me', { authorization: `Bearer ${accessToken}` });
      expect(stale.statusCode).toBe(401);
    });

    it('lets the directory put somebody back, and the door opens again', async () => {
      const connection = await connect();
      const created = await server.post(
        '/scim/v2/Users',
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: NEW_HIRE,
          active: true,
        },
        scimHeaders(scimA),
      );
      const scimId = (created.json() as { id: string }).id;

      expect((await server.del(`/scim/v2/Users/${scimId}`, scimHeaders(scimA))).statusCode).toBe(
        204,
      );
      expect((await signInAs(connection, NEW_HIRE)).status).toBe(401);

      // Reinstated through the ordinary attribute write, not a bespoke endpoint.
      const reinstated = await server.patch(
        `/scim/v2/Users/${scimId}`,
        {
          schemas: ['urn:ietf:params:scim:PatchOp'],
          Operations: [{ op: 'replace', path: 'active', value: true }],
        },
        scimHeaders(scimA),
      );
      expect(reinstated.statusCode).toBe(200);
      expect((await signInAs(connection, NEW_HIRE)).status).toBe(302);
    });
  });

  // =========================================================================
  // The rejection matrix, through the endpoint
  // =========================================================================

  describe('rejection matrix at the ACS', () => {
    it('refuses an assertion with no signature at all', async () => {
      const connection = await connect();
      const login = await startLogin(connection);
      const assertion = issueAssertion({
        subject: fx.a.agentEmail,
        audience: connection.entityId,
        destination: connection.acsUrl,
        inResponseTo: login.requestId,
      });

      // The genuine document with its `ds:Signature` cut out. Everything else —
      // the audience, the destination, the timestamps, the subject — is exactly
      // what a valid login carries, so the only thing left to refuse it on is
      // the missing proof.
      const stripped = assertion.xml.replace(/<(\w+:)?Signature[\s\S]*?<\/(\w+:)?Signature>/, '');
      expect(stripped).not.toContain('SignatureValue');

      const res = await acs(connection.id, {
        SAMLResponse: Buffer.from(stripped, 'utf8').toString('base64'),
        RelayState: login.relayState,
      });
      expect(res.statusCode).toBe(401);
      expect(await failureReasons()).toEqual(['unsigned']);
    });

    it('refuses a wrong audience and an expired assertion', async () => {
      const connection = await connect();

      const wrongAudience = await startLogin(connection);
      expect(
        (
          await acs(connection.id, {
            SAMLResponse: issueAssertion({
              subject: fx.a.agentEmail,
              audience: 'https://somebody-else.example.test/saml',
              destination: connection.acsUrl,
              inResponseTo: wrongAudience.requestId,
            }).samlResponseBase64,
            RelayState: wrongAudience.relayState,
          })
        ).statusCode,
      ).toBe(401);

      const stale = await startLogin(connection);
      expect(
        (
          await acs(connection.id, {
            SAMLResponse: issueAssertion({
              subject: fx.a.agentEmail,
              audience: connection.entityId,
              destination: connection.acsUrl,
              inResponseTo: stale.requestId,
              notOnOrAfter: new Date(Date.now() - 60 * 60_000),
            }).samlResponseBase64,
            RelayState: stale.relayState,
          })
        ).statusCode,
      ).toBe(401);

      expect(await failureReasons()).toEqual(['audience_mismatch', 'expired']);
    });

    it('spends an assertion once, against real Redis', async () => {
      // Unsolicited, because that is the only shape in which the *same*
      // assertion can be presented twice: a solicited one is bound to a relay
      // handle, and the handle is consumed first, so the second attempt would be
      // refused a layer above the replay guard and prove nothing about it.
      const connection = await connect({ allowIdpInitiated: true });
      const assertion = issueAssertion({
        subject: fx.a.agentEmail,
        audience: connection.entityId,
        destination: connection.acsUrl,
        inResponseTo: null,
      });

      const first = await acs(connection.id, { SAMLResponse: assertion.samlResponseBase64 });
      expect(first.statusCode).toBe(302);

      const second = await acs(connection.id, { SAMLResponse: assertion.samlResponseBase64 });
      expect(second.statusCode).toBe(401);
      expect(await failureReasons()).toEqual(['replay']);
    });

    it('signs in the subject the signature covered, not the one wrapped around it', async () => {
      // XSW, through the endpoint: a forged assertion naming the owner, placed
      // where a naive reader looks first — before the signed one. The signature
      // is untouched and still verifies, which is exactly what makes this class
      // of attack work against implementations that read the parsed document.
      const connection = await connect();
      const login = await startLogin(connection);
      const genuine = issueAssertion({
        subject: fx.a.agentEmail,
        audience: connection.entityId,
        destination: connection.acsUrl,
        inResponseTo: login.requestId,
      });
      const forged = issueAssertion({
        subject: fx.a.ownerEmail,
        audience: connection.entityId,
        destination: connection.acsUrl,
        inResponseTo: login.requestId,
      });

      // The forgery, unsigned, inserted ahead of the signed assertion.
      const forgedAssertion = /<saml:Assertion[\s\S]*<\/saml:Assertion>/
        .exec(forged.xml.replace(/<(\w+:)?Signature[\s\S]*?<\/(\w+:)?Signature>/, ''))?.[0];
      expect(forgedAssertion).toBeDefined();
      const wrapped = genuine.xml.replace('<saml:Assertion', `${forgedAssertion!}<saml:Assertion`);

      const res = await acs(connection.id, {
        SAMLResponse: Buffer.from(wrapped, 'utf8').toString('base64'),
        RelayState: login.relayState,
      });

      // Accepted — the signature is genuine — but as the person it covers.
      expect(res.statusCode).toBe(302);
      const granted = await server.post('/auth/token', {
        grant_type: 'authorization_code',
        code: new URL(res.headers['location'] as string).searchParams.get('code'),
        code_verifier: login.verifier,
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
      });
      expect(granted.statusCode).toBe(200);

      const me = await server.get('/auth/me', {
        authorization: `Bearer ${(granted.json() as { access_token: string }).access_token}`,
      });
      expect((me.json() as { email: string }).email).toBe(fx.a.agentEmail);
      expect((me.json() as { email: string }).email).not.toBe(fx.a.ownerEmail);
    });
  });

  // =========================================================================
  // Cross-tenant
  // =========================================================================

  describe('cross-tenant', () => {
    it('cannot get a leaver back into the workspace that removed them', async () => {
      // The loophole worth checking, because it is the one a federated product
      // actually has: B federates the *same* identity provider, so a person A
      // deprovisioned can still obtain a genuine, correctly-signed assertion —
      // just one addressed to B. Signing in at B is allowed and does provision
      // them there (that is what B's own IdP vouching for somebody means), and
      // the question is whether any of it reaches back into A.
      const a = await connect();
      const b = await connect(
        { allowIdpInitiated: true, idpEntityId: MOCK_IDP_ENTITY_ID },
        fx.b,
      );

      const hired = await server.post(
        '/scim/v2/Users',
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: NEW_HIRE,
          active: true,
        },
        scimHeaders(scimA),
      );
      expect(hired.statusCode).toBe(201);
      const scimId = (hired.json() as { id: string }).id;

      expect((await signInAs(a, NEW_HIRE)).status).toBe(302);
      expect((await server.del(`/scim/v2/Users/${scimId}`, scimHeaders(scimA))).statusCode).toBe(
        204,
      );
      expect((await signInAs(a, NEW_HIRE)).status).toBe(401);

      // The same person, in at B.
      const atB = await acs(b.id, {
        SAMLResponse: issueAssertion({
          subject: NEW_HIRE,
          audience: b.entityId,
          destination: b.acsUrl,
          inResponseTo: null,
        }).samlResponseBase64,
      });
      // Unsolicited, so B hands them back to the app to start a login of their
      // own rather than completing one nobody proved they asked for — either
      // way, a session at B and only at B.
      expect(atB.statusCode).toBe(302);
      const bLogin = await signInAs(b, NEW_HIRE, fx.b);
      expect(bLogin.status).toBe(302);

      const granted = await server.post('/auth/token', {
        grant_type: 'authorization_code',
        code: new URL(bLogin.location).searchParams.get('code'),
        code_verifier: bLogin.verifier,
        client_id: fx.b.clientId,
        redirect_uri: fx.b.redirectUri,
      });
      expect(granted.statusCode).toBe(200);
      const me = await server.get('/auth/me', {
        authorization: `Bearer ${(granted.json() as { access_token: string }).access_token}`,
      });
      // B's workspace, not A's. A token is scoped to the license it was minted
      // in, and no assertion can move it.
      expect((me.json() as { license_id: string }).license_id).toBe(String(fx.b.licenseId));

      // A's answer is unchanged: still suspended, still refused.
      const membership = await owner.agentMembership.findFirst({
        where: { licenseId: fx.a.licenseId, agent: { email: NEW_HIRE } },
      });
      expect(membership?.suspended).toBe(true);
      expect((await signInAs(a, NEW_HIRE)).status).toBe(401);

      // And B's directory never saw A's roster in the first place.
      const search = await server.get(
        `/scim/v2/Users?filter=${encodeURIComponent(`userName eq "${fx.a.agentEmail}"`)}`,
        { authorization: `Bearer ${scimB}` },
      );
      expect(search.statusCode).toBe(200);
      expect((search.json() as { totalResults: number }).totalResults).toBe(0);
    });

    it('refuses an assertion minted for one workspace at the other workspace’s ACS', async () => {
      const a = await connect();
      const b = await connect({ allowIdpInitiated: true }, fx.b);

      const login = await startLogin(a);
      const forA = issueAssertion({
        subject: fx.a.agentEmail,
        audience: a.entityId,
        destination: a.acsUrl,
        inResponseTo: login.requestId,
      });

      expect((await acs(b.id, { SAMLResponse: forA.samlResponseBase64 })).statusCode).toBe(401);
      expect(await failureReasons(fx.b.licenseId)).toEqual(['destination_mismatch']);
      // Nothing was written into A's trail by a request aimed at B.
      expect(await failureReasons()).toEqual([]);
    });
  });

  // =========================================================================
  // The anonymous read a converted login starts from
  // =========================================================================

  describe('GET /auth/sso/:connectionId', () => {
    it('answers with the client to start a login with, and nothing about the trust anchor', async () => {
      const connection = await connect();
      const res = await server.get(`/auth/sso/${connection.id}`);

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body).toEqual({
        id: connection.id,
        organization_name: expect.any(String),
        client_id: fx.a.clientId,
      });
      // The certificate, the IdP URL and the entity id name the trust anchor and
      // stay behind the admin read (`GET /settings/sso`).
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('CERTIFICATE');
      expect(serialized).not.toContain(IDP_SSO_URL);
      expect(serialized).not.toContain(MOCK_IDP_ENTITY_ID);
    });

    it('is a 404 for an unknown, disabled or canceled connection', async () => {
      expect((await server.get('/auth/sso/11111111-2222-4333-8444-555555555555')).statusCode).toBe(
        404,
      );

      // Distinct entity ids: one license may federate several providers, and
      // `(license_id, idp_entity_id)` is unique.
      const off = await connect({ enabled: false, idpEntityId: `${MOCK_IDP_ENTITY_ID}/off` });
      expect((await server.get(`/auth/sso/${off.id}`)).statusCode).toBe(404);

      const live = await connect();
      expect((await server.get(`/auth/sso/${live.id}`)).statusCode).toBe(200);
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { status: 'canceled' },
      });
      expect((await server.get(`/auth/sso/${live.id}`)).statusCode).toBe(404);
    });
  });
});
