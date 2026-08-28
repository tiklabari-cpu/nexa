/**
 * Installing a second factor proves the *account*, not the session
 * (NFR-S11 · FR-MOD-00.1 · M-SEC-d2 · tm 172).
 *
 * The audit tm 157 ran found a chain, and every link of it was already
 * deliberate:
 *
 *   a just-in-time SAML membership gets the `agent` role;
 *   `DEFAULT_AGENT_SCOPES` carries `accounts--my:rw` (tm 152.10);
 *   the SAML path is deliberately *not* subject to `enforceSecondFactor`;
 *   `/auth/2fa/enroll` and `/auth/2fa/activate` accept an ordinary session;
 *   `account_two_factor` is keyed `PRIMARY KEY (account_id)` — above the tenant.
 *
 * Put together, a workspace whose identity provider can vouch for an address
 * could install *its own* authenticator as that person's account-global second
 * factor, and take the ten recovery codes out of the response body. The victim
 * was then refused at every password sign-in, in every workspace, with no way
 * back: `DELETE /auth/2fa` needs a session, a session needs `/auth/authorize`,
 * and `/auth/authorize` needs the code the attacker holds.
 *
 * The whole chain is walked below rather than asserted at its narrowest point,
 * because each link on its own reads defensible — the finding only exists where
 * they meet. `two-factor-enrollment.test.ts` owns the endpoints' own behaviour;
 * this file owns the question of *whose* account a caller may write.
 *
 * The rule the fix installs, and the shape of the three branches here:
 *
 *   **The account has a password.** It is required, exactly as it is for
 *   removing the factor. A session minted by somebody else's identity provider
 *   never proved it, so the chain stops at the first link a workspace does not
 *   own.
 *
 *   **The account has none, and the caller holds an `enrollment` ticket.** The
 *   ticket is minted at `/auth/authorize`, one call after a password was
 *   verified (S11-2FA-k). It is a password proof, delegated.
 *
 *   **The account has none and belongs to exactly one workspace.** That
 *   workspace's identity provider is the account's only authority and there is
 *   no second workspace to be shut out of, so enrollment stands — which is what
 *   keeps §D116's "policy shut them out; enrollment shut them out" loop closed.
 *   The moment a second membership exists, that stops being true.
 */
import { PrismaClient } from '@prisma/client';
import { inflateRawSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { issueAssertion, MOCK_IDP_CERTIFICATE, MOCK_IDP_ENTITY_ID } from '../helpers/mock-idp.js';
import {
  grantToken,
  ownerClient,
  proveSsoDomains,
  seedDefaultBrand,
  seedFixtures,
  testEnv,
  TEST_PASSWORD,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { FileMailer } from '../../src/services/mail/mailer.js';
import { generateTotp } from '../../src/lib/totp.js';
import { deriveCodeChallenge, generateToken } from '../../src/lib/crypto.js';
import { API_PREFIX } from '../../src/server.js';

const IDP_SSO_URL = 'https://idp.example.test/saml/sso';

describe('two-factor enrollment proves the account (M-SEC-d2)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let apiBase: string;

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
  });

  const auth = (bearer: string): Record<string, string> => ({ authorization: `Bearer ${bearer}` });

  // --- The attacking workspace's federation ---------------------------------

  /**
   * A live, *legitimately configured* connection on tenant B.
   *
   * The domain is proven, not merely claimed (§D134 · tm 171): this finding is
   * not about a forged claim. `example.test` is the fixtures' own domain, so
   * tenant B's identity provider is authoritative for an address that tenant A's
   * agent also signs in with — the consultant who belongs to two workspaces,
   * which is the shape that survives tm 171 untouched.
   */
  async function federate(tenant: TenantFixture) {
    const row = await owner.ssoConnection.create({
      data: {
        licenseId: tenant.licenseId,
        name: 'Okta (attacker)',
        idpEntityId: MOCK_IDP_ENTITY_ID,
        idpSsoUrl: IDP_SSO_URL,
        idpCertificatePem: MOCK_IDP_CERTIFICATE,
        verifiedDomains: ['example.test'],
        enabled: true,
      },
      select: { id: true },
    });
    await proveSsoDomains(owner, row.id);
    return {
      id: row.id,
      entityId: `${apiBase}/auth/saml/${row.id}`,
      acsUrl: `${apiBase}/auth/saml/${row.id}/acs`,
    };
  }

  /**
   * Sign `email` in through `tenant`'s identity provider and hand back the
   * access token that comes out — the credential the finding's attacker holds.
   */
  async function samlSession(
    tenant: TenantFixture,
    connection: { id: string; entityId: string; acsUrl: string },
    email: string,
  ): Promise<string> {
    const verifier = generateToken(48).slice(0, 64);
    const started = await server.get(
      `/auth/saml/${connection.id}/login?client_id=${tenant.clientId}` +
        `&redirect_uri=${encodeURIComponent(tenant.redirectUri)}` +
        `&code_challenge=${deriveCodeChallenge(verifier)}`,
    );
    expect(started.statusCode).toBe(302);
    const request = new URL(started.headers['location'] as string);
    const xml = inflateRawSync(
      Buffer.from(request.searchParams.get('SAMLRequest') ?? '', 'base64'),
    ).toString('utf8');

    const acs = await server.app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/saml/${connection.id}/acs`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        SAMLResponse: issueAssertion({
          subject: email,
          audience: connection.entityId,
          destination: connection.acsUrl,
          inResponseTo: /ID="([^"]+)"/.exec(xml)?.[1] ?? '',
        }).samlResponseBase64,
        RelayState: request.searchParams.get('RelayState') ?? '',
      }).toString(),
    });
    expect(acs.statusCode, 'the assertion should have been accepted').toBe(302);

    const code = new URL(acs.headers['location'] as string).searchParams.get('code');
    const granted = await server.post('/auth/token', {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: tenant.clientId,
      redirect_uri: tenant.redirectUri,
    });
    expect(granted.statusCode).toBe(200);
    return granted.json().access_token as string;
  }

  /** An ordinary password sign-in, as far as the authorization code. */
  function authorize(tenant: TenantFixture, email: string, extra: Record<string, unknown> = {}) {
    const verifier = generateToken(48).slice(0, 64);
    return server.post('/auth/authorize', {
      client_id: tenant.clientId,
      redirect_uri: tenant.redirectUri,
      code_challenge: deriveCodeChallenge(verifier),
      email,
      password: TEST_PASSWORD,
      license_id: tenant.licenseId.toString(),
      ...extra,
    });
  }

  /** A session for an account, minted directly — no sign-in surface involved. */
  function session(tenant: TenantFixture, accountId: string): Promise<string> {
    return grantToken(owner, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: accountId,
      scopes: ['accounts--my:rw'],
    });
  }

  // =========================================================================
  // The chain, walked
  // =========================================================================

  describe('a session minted by another workspace’s identity provider', () => {
    it('cannot install a second factor on an account that holds a password', async () => {
      const connection = await federate(fx.b);
      const bearer = await samlSession(fx.b, connection, fx.a.agentEmail);

      // The session is real and reaches its own account: this is a refusal
      // about the *write*, not about the credential being rejected outright.
      const me = await server.get('/auth/me', auth(bearer));
      expect(me.statusCode).toBe(200);
      expect(me.json().two_factor).toEqual({
        enabled: false,
        pending: false,
        recovery_codes_remaining: 0,
      });

      const enroll = await server.post('/auth/2fa/enroll', {}, auth(bearer));
      expect(enroll.statusCode).toBe(400);
      expect(enroll.json().error.type).toBe('validation');

      // And a guess at the password is refused as one, not as a validation
      // error — the two are different answers and a client shows different
      // screens for them.
      const guessed = await server.post(
        '/auth/2fa/enroll',
        { password: 'not-the-password' },
        auth(bearer),
      );
      expect(guessed.statusCode).toBe(401);
      expect(guessed.json().error.type).toBe('authentication');

      // Nothing was begun by either attempt.
      const after = await server.get('/auth/me', auth(bearer));
      expect(after.json().two_factor.pending).toBe(false);
    });

    it('leaves the victim’s own workspace enterable — the end of the chain', async () => {
      const connection = await federate(fx.b);
      const bearer = await samlSession(fx.b, connection, fx.a.agentEmail);

      // The whole attack, run to the end and *not* asserted step by step: what
      // matters is not which call refuses it, only that the last one cannot
      // happen. Before the fix both of these answered 200 and the attacker
      // walked away with ten recovery codes.
      const enroll = await server.post('/auth/2fa/enroll', {}, auth(bearer));
      if (enroll.statusCode === 200) {
        await server.post(
          '/auth/2fa/activate',
          { code: generateTotp(enroll.json().secret as string, Date.now()) },
          auth(bearer),
        );
      }

      // The end of the chain: the victim's own workspace, with the password
      // they have always used and no code anybody could have given them. Before
      // the fix this answered 401 `two_factor_required` — permanently, since
      // turning the factor off needs a session this refusal is the only way to.
      const signIn = await authorize(fx.a, fx.a.agentEmail);
      expect(signIn.statusCode).toBe(200);
      expect(await server.get('/auth/me', auth(bearer)).then((r) => r.json().two_factor)).toEqual({
        enabled: false,
        pending: false,
        recovery_codes_remaining: 0,
      });
    });

    it('cannot confirm one either, so the two gates cannot be split', async () => {
      const connection = await federate(fx.b);
      const bearer = await samlSession(fx.b, connection, fx.a.agentEmail);

      // Reach past `enroll` by beginning the enrollment out of band — the
      // pending secret exists, and `activate` is the only thing left between it
      // and a live factor.
      const legitimate = await session(fx.a, fx.a.agentAccountId);
      const started = await server.post(
        '/auth/2fa/enroll',
        { password: TEST_PASSWORD },
        auth(legitimate),
      );
      expect(started.statusCode).toBe(200);
      const secret = started.json().secret as string;

      const stolen = await server.post(
        '/auth/2fa/activate',
        { code: generateTotp(secret, Date.now()) },
        auth(bearer),
      );
      expect(stolen.statusCode).toBe(400);
      expect(stolen.json().error.type).toBe('validation');
    });
  });

  // =========================================================================
  // The three branches of the proof
  // =========================================================================

  describe('an account that holds a password', () => {
    it('enrolls and activates with it, and is refused without it', async () => {
      const bearer = await session(fx.a, fx.a.agentAccountId);

      expect((await server.post('/auth/2fa/enroll', {}, auth(bearer))).statusCode).toBe(400);

      const enroll = await server.post(
        '/auth/2fa/enroll',
        { password: TEST_PASSWORD },
        auth(bearer),
      );
      expect(enroll.statusCode).toBe(200);
      const secret = enroll.json().secret as string;

      const bare = await server.post(
        '/auth/2fa/activate',
        { code: generateTotp(secret, Date.now()) },
        auth(bearer),
      );
      expect(bare.statusCode).toBe(400);

      const activated = await server.post(
        '/auth/2fa/activate',
        { code: generateTotp(secret, Date.now()), password: TEST_PASSWORD },
        auth(bearer),
      );
      expect(activated.statusCode).toBe(200);
      expect(activated.json().recovery_codes).toHaveLength(10);
    });
  });

  describe('an account with no password', () => {
    /** How SSO provisioning leaves an account: no password, one membership. */
    async function ssoOnly(
      tenant: TenantFixture,
      suffix = 'sole',
    ): Promise<{ accountId: string; bearer: string }> {
      const account = await owner.account.create({
        data: { email: `sso-${suffix}-${tenant.licenseId}@example.test`, name: 'Sso Only' },
        select: { id: true },
      });
      await owner.agentMembership.create({
        data: { licenseId: tenant.licenseId, agentId: account.id, role: 'agent' },
      });
      return { accountId: account.id, bearer: await session(tenant, account.id) };
    }

    it('enrolls from its own session while that workspace is its only one', async () => {
      const { bearer } = await ssoOnly(fx.a);

      const enroll = await server.post('/auth/2fa/enroll', {}, auth(bearer));
      expect(enroll.statusCode).toBe(200);

      const activated = await server.post(
        '/auth/2fa/activate',
        { code: generateTotp(enroll.json().secret as string, Date.now()) },
        auth(bearer),
      );
      expect(activated.statusCode).toBe(200);
    });

    it('is refused once a second workspace can be locked out of', async () => {
      const { accountId, bearer } = await ssoOnly(fx.a, 'shared');
      await owner.agentMembership.create({
        data: { licenseId: fx.b.licenseId, agentId: accountId, role: 'agent' },
      });

      const enroll = await server.post('/auth/2fa/enroll', {}, auth(bearer));
      expect(enroll.statusCode).toBe(403);
      expect(enroll.json().error.type).toBe('not_allowed');
    });

    it('counts only the workspaces it could actually sign in to', async () => {
      const { accountId, bearer } = await ssoOnly(fx.a, 'suspended');
      await owner.agentMembership.create({
        data: { licenseId: fx.b.licenseId, agentId: accountId, role: 'agent', suspended: true },
      });

      // A workspace nobody can enter is not one they can be shut out of — the
      // same reading `auth_two_factor_enforcing_licenses` gives a suspension.
      expect((await server.post('/auth/2fa/enroll', {}, auth(bearer))).statusCode).toBe(200);
    });
  });

  describe('the enrollment ticket', () => {
    it('still opens both endpoints on its own — it is a password proof already', async () => {
      // `require_two_factor` on tenant A, so the sign-in below refuses and
      // hands back the ticket (S11-2FA-k).
      const brandId = await seedDefaultBrand(owner, fx.a.licenseId);
      await owner.securitySettings.create({
        data: { licenseId: fx.a.licenseId, brandId, requireTwoFactor: true },
      });

      const refused = await authorize(fx.a, fx.a.agentEmail);
      expect(refused.statusCode).toBe(401);
      const ticket = refused.json().error.details.enrollment_ticket as string;

      const enroll = await server.post('/auth/2fa/enroll', {}, auth(ticket));
      expect(enroll.statusCode).toBe(200);

      const activated = await server.post(
        '/auth/2fa/activate',
        { code: generateTotp(enroll.json().secret as string, Date.now()) },
        auth(ticket),
      );
      expect(activated.statusCode).toBe(200);
    });
  });

  // =========================================================================
  // The account holder finds out
  // =========================================================================

  describe('activation', () => {
    it('tells the account holder, at the address the factor now guards', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'nexa-mail-'));
      const mailer = new FileMailer(dir);
      const mailed = await startTestServer({}, { mailer });
      try {
        const bearer = await session(fx.a, fx.a.agentAccountId);
        const enroll = await mailed.post(
          '/auth/2fa/enroll',
          { password: TEST_PASSWORD },
          auth(bearer),
        );
        expect(enroll.statusCode).toBe(200);
        expect(await mailer.outbox(), 'starting is not installing').toHaveLength(0);

        const activated = await mailed.post(
          '/auth/2fa/activate',
          {
            code: generateTotp(enroll.json().secret as string, Date.now()),
            password: TEST_PASSWORD,
          },
          auth(bearer),
        );
        expect(activated.statusCode).toBe(200);

        const outbox = await mailer.outbox();
        expect(outbox).toHaveLength(1);
        expect(outbox[0]!.to).toBe(fx.a.agentEmail);
        expect(outbox[0]!.kind).toBe('notification');
        // Never the secret, never a recovery code: this message goes to a
        // mailbox, and a mailbox is exactly what a second factor exists to
        // survive the loss of.
        expect(outbox[0]!.body).not.toContain(enroll.json().secret);
        for (const code of activated.json().recovery_codes as string[]) {
          expect(outbox[0]!.body).not.toContain(code);
        }
      } finally {
        await mailed.close();
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
