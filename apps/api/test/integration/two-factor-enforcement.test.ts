/**
 * The second factor as a gate rather than a setting
 * (NFR-S11 · FR-MOD-00.1 · S11-2FA-e).
 *
 * `two-factor-enrollment.test.ts` covers setting one up. This covers the half
 * that makes it worth setting up: until now an account could hold a live
 * authenticator and sign in without ever being asked for it, and
 * `security_settings.require_two_factor` had no reader anywhere on the way in —
 * a workspace whose console said "two-factor required" ran on one factor.
 *
 * The properties worth measuring are the ones a happy-path test agrees with:
 *
 *   a live factor that is never demanded (the silent open);
 *   a policy that is written, read back by the screen that wrote it, and
 *     consulted by nothing;
 *   a thirty-second code that works twice;
 *   a recovery code that works twice;
 *   one workspace's policy applying to another's sign-in;
 *   a six-digit secret with unlimited guesses;
 *   and, on the other side, a gate that fires for accounts nobody asked it to
 *     protect and takes every existing sign-in down with it.
 *
 * Refusals first: this is the front door.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { issueAssertion, MOCK_IDP_CERTIFICATE, MOCK_IDP_ENTITY_ID } from '../helpers/mock-idp.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { deriveCodeChallenge, generateToken } from '../../src/lib/crypto.js';
import { generateTotpForStep, totpStep, TOTP_PERIOD_SECONDS } from '../../src/lib/totp.js';
import { API_PREFIX } from '../../src/server.js';

describe('two-factor enforcement (S11-2FA-e)', () => {
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

  // --- Fixtures --------------------------------------------------------------

  const errorBody = (res: { json: () => unknown }) =>
    (res.json() as { error: { type: string; message: string; details?: Record<string, unknown> } })
      .error;

  /**
   * A live second factor on an account, set up the way a person would.
   *
   * Driven through the endpoints rather than written to the table, because what
   * the gate reads is whatever those endpoints leave behind — a fixture that
   * wrote the row itself could agree with a gate that disagrees with enrollment.
   */
  async function enrol(
    tenant: TenantFixture,
    accountId: string,
  ): Promise<{ secret: string; recoveryCodes: string[] }> {
    const bearer = await grantToken(owner, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: accountId,
      scopes: ['accounts--my:rw'],
    });
    const headers = { authorization: `Bearer ${bearer}` };

    const enrolled = await server.post('/auth/2fa/enroll', undefined, headers);
    expect(enrolled.statusCode).toBe(200);
    const secret = enrolled.json().secret as string;

    const activated = await server.post('/auth/2fa/activate', { code: code(secret) }, headers);
    expect(activated.statusCode).toBe(200);
    return { secret, recoveryCodes: activated.json().recovery_codes as string[] };
  }

  /**
   * A code for a step nobody has spent yet.
   *
   * `Date.now()`'s own step is the one activation just burned — the replay guard
   * is doing its job, and a fixture that ignored it would spend the suite
   * arguing with it. `+1` is inside the accepted drift window
   * (`TOTP_DRIFT_STEPS`), and `offset` lets a test ask for a *different* unspent
   * step when it needs two codes in a row.
   */
  const code = (secret: string, offset = 0): string =>
    generateTotpForStep(secret, totpStep(Date.now()) + offset);

  /**
   * Like `code`, but for assertions that need the step to still be current by
   * the time the *server* reads its own clock.
   *
   * `code` fixes the step the instant it is called; `authorize` then spends a
   * network round trip plus a password KDF (~100-300 ms) before
   * `enforceSecondFactor` reads `Date.now()` itself. If a 30-second step
   * boundary falls in that gap, the server's step is one ahead of the one the
   * test computed — a "+2, a code from a minute ago" narrows to "+1", which
   * sits inside `TOTP_DRIFT_STEPS` and turns an expected 401 into 200
   * (measured, tm 152.13: shard 3/3, single occurrence). Loosening the
   * assertion would hide the exact thing it proves, so instead this waits out
   * a boundary that is too close before pinning the step — the margin only
   * costs real time in the rare call that lands in the last few seconds of a
   * step.
   */
  async function codeAwayFromBoundary(secret: string, offset = 0): Promise<string> {
    const stepMs = TOTP_PERIOD_SECONDS * 1000;
    const safetyMarginMs = 5_000;
    const msIntoStep = Date.now() % stepMs;
    if (msIntoStep > stepMs - safetyMarginMs) {
      await new Promise((resolve) => setTimeout(resolve, stepMs - msIntoStep + 50));
    }
    return code(secret, offset);
  }

  /** Switch `require_two_factor` on for a license, seeding the brand it hangs off. */
  async function requirePolicy(tenant: TenantFixture): Promise<void> {
    const brandId = await seedDefaultBrand(owner, tenant.licenseId);
    await owner.securitySettings.create({
      data: { licenseId: tenant.licenseId, brandId, requireTwoFactor: true },
    });
  }

  const login = (tenant: TenantFixture, email = tenant.ownerEmail) =>
    server.post('/auth/login', { email, password: tenant.password });

  /** The sign-in that actually mints a code — the call the gate guards. */
  function authorize(tenant: TenantFixture, options: { email?: string; code?: string } = {}) {
    return server.post('/auth/authorize', {
      client_id: tenant.clientId,
      redirect_uri: tenant.redirectUri,
      code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
      email: options.email ?? tenant.ownerEmail,
      password: tenant.password,
      license_id: tenant.licenseId.toString(),
      ...(options.code === undefined ? {} : { code: options.code }),
    });
  }

  /** Every `security.two_factor_*` action recorded against a license, oldest first. */
  async function trail(tenant: TenantFixture = fx.a) {
    return owner.auditLogEntry.findMany({
      where: { licenseId: tenant.licenseId, action: { startsWith: 'security.two_factor' } },
      orderBy: { createdAt: 'asc' },
    });
  }

  // =========================================================================
  // A live factor is demanded — the silent open this subtask exists to close
  // =========================================================================

  describe('an account that holds a second factor', () => {
    it('cannot mint a session without presenting one', async () => {
      await enrol(fx.a, fx.a.ownerAccountId);

      const response = await authorize(fx.a);

      expect(response.statusCode).toBe(401);
      expect(errorBody(response).type).toBe('two_factor_required');
      // The prompt is not an attempt: a client that has not yet been told a
      // code is needed must not fill the trail with entries that read as
      // guessing.
      expect(await trail()).toHaveLength(2); // enrollment_started + enabled
    });

    it('is refused a wrong code, and the refusal names nothing useful', async () => {
      await enrol(fx.a, fx.a.ownerAccountId);

      const response = await authorize(fx.a, { code: '000000' });

      expect(response.statusCode).toBe(401);
      expect(errorBody(response).type).toBe('authentication');
      // Wrong, expired and already-spent share one answer — which of the three
      // it was is exactly what somebody guessing would like to know.
      expect(errorBody(response).message).not.toMatch(/expired|used|spent/i);

      const actions = (await trail()).map((e) => e.action);
      expect(actions.at(-1)).toBe('security.two_factor_challenge_failed');
    });

    it('signs in with a current code, and the code cannot be replayed', async () => {
      const { secret } = await enrol(fx.a, fx.a.ownerAccountId);
      const current = code(secret, 1);

      const first = await authorize(fx.a, { code: current });
      expect(first.statusCode).toBe(200);
      expect(first.json().code).toEqual(expect.any(String));

      // The same code inside its own thirty seconds. Without the step being
      // spent this is a working credential for anyone who watched it go past.
      const second = await authorize(fx.a, { code: current });
      expect(second.statusCode).toBe(401);
      expect(errorBody(second).type).toBe('authentication');
    });

    it('refuses a code that is more than one step out', async () => {
      const { secret } = await enrol(fx.a, fx.a.ownerAccountId);

      // ±1 is clock skew; ±2 is a code from a minute ago. Each code is pinned
      // away from the step boundary (see `codeAwayFromBoundary`) so the
      // server's own clock read, after the password KDF, cannot land one step
      // later than the one the code was generated for.
      expect(
        (await authorize(fx.a, { code: await codeAwayFromBoundary(secret, 2) })).statusCode,
      ).toBe(401);
      expect(
        (await authorize(fx.a, { code: await codeAwayFromBoundary(secret, 1) })).statusCode,
      ).toBe(200);
    });
  });

  // =========================================================================
  // Recovery codes: the credential that exists for when the phone is gone
  // =========================================================================

  describe('recovery codes at the door', () => {
    it('sign somebody in, once, and say so in the trail', async () => {
      const { recoveryCodes } = await enrol(fx.a, fx.a.ownerAccountId);
      const sheet = recoveryCodes[0] as string;

      const first = await authorize(fx.a, { code: sheet });
      expect(first.statusCode).toBe(200);

      const second = await authorize(fx.a, { code: sheet });
      expect(second.statusCode).toBe(401);
      expect(errorBody(second).type).toBe('authentication');

      const entries = await trail();
      const used = entries.filter((e) => e.action === 'security.two_factor_recovery_code_used');
      expect(used).toHaveLength(1);
      expect(used[0]?.target).toBe(`account:${fx.a.ownerAccountId}`);
      // Nine left of ten — the number a screen turns into a warning before the
      // sheet runs out.
      expect(
        (used[0]?.metadata as { recovery_codes_remaining?: number }).recovery_codes_remaining,
      ).toBe(9);

      // A spent code is a failed challenge, not a second consumption.
      expect(entries.at(-1)?.action).toBe('security.two_factor_challenge_failed');
    });

    it('never appear in the trail, and neither does the TOTP secret', async () => {
      const { secret, recoveryCodes } = await enrol(fx.a, fx.a.ownerAccountId);
      expect((await authorize(fx.a, { code: recoveryCodes[0] as string })).statusCode).toBe(200);

      const serialised = JSON.stringify(await trail(), (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
      expect(serialised).not.toContain(secret);
      for (const entry of recoveryCodes) {
        expect(serialised).not.toContain(entry);
        expect(serialised).not.toContain(entry.replace('-', ''));
      }
    });
  });

  // =========================================================================
  // The policy that had no reader
  // =========================================================================

  describe('require_two_factor', () => {
    it('refuses a session to a member who has not set one up', async () => {
      await requirePolicy(fx.a);

      const response = await authorize(fx.a);

      expect(response.statusCode).toBe(401);
      expect(errorBody(response).type).toBe('two_factor_required');
      // The client has to be able to tell "type your code" from "you have no
      // code to type" — one renders an input, the other has to send the person
      // somewhere else entirely. Since S11-2FA-k the refusal also carries the
      // credential that makes "somewhere else" reachable without a session;
      // `two-factor-enrollment.test.ts` owns what that credential can and
      // cannot do, so this asserts the shape and moves on.
      expect(errorBody(response).details).toMatchObject({
        enrollment_required: true,
        enrollment_ticket: expect.any(String),
        enrollment_ticket_expires_in: expect.any(Number),
      });
      // A bearer credential in the body, so the response must not be storable.
      expect(response.headers['cache-control']).toBe('no-store');

      const entries = await trail();
      expect(entries.map((e) => e.action)).toEqual(['security.two_factor_enrollment_required']);
      expect(entries[0]?.actorId).toBe(fx.a.ownerAccountId);
      expect(entries[0]?.target).toBe(`account:${fx.a.ownerAccountId}`);
    });

    it('is not recorded as a failed sign-in — the credential was fine', async () => {
      await requirePolicy(fx.a);
      await authorize(fx.a);

      const failures = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'auth.login_failed' },
      });
      expect(failures).toHaveLength(0);
    });

    it('lets the same member in once they have enrolled', async () => {
      await requirePolicy(fx.a);
      const { secret } = await enrol(fx.a, fx.a.ownerAccountId);

      expect((await authorize(fx.a, { code: code(secret, 1) })).statusCode).toBe(200);
    });

    it('binds to the workspace that set it, not to the person', async () => {
      // One account, two workspaces, one policy. Reading the flag as a property
      // of the account would let the strict workspace lock the lax one, or the
      // lax one excuse the strict.
      await requirePolicy(fx.a);
      const account = await owner.account.findUniqueOrThrow({
        where: { id: fx.a.ownerAccountId },
        select: { email: true },
      });
      await owner.agentMembership.create({
        data: { licenseId: fx.b.licenseId, agentId: fx.a.ownerAccountId, role: 'agent' },
      });

      expect((await authorize(fx.a)).statusCode).toBe(401);
      expect(
        (await authorize(fx.b, { email: account.email })).statusCode,
        'the workspace with no policy is unaffected',
      ).toBe(200);
    });

    it('applies when any brand of the license requires it', async () => {
      // `security_settings` is keyed by (license, brand). Reading it as "only if
      // the brand you signed in under says so" would let a member sign in under
      // a laxer brand to escape a workspace policy.
      const lax = await seedDefaultBrand(owner, fx.a.licenseId);
      await owner.securitySettings.create({
        data: { licenseId: fx.a.licenseId, brandId: lax, requireTwoFactor: false },
      });
      const strict = await owner.brand.create({
        data: { licenseId: fx.a.licenseId, name: 'Strict', slug: 'strict' },
        select: { id: true },
      });
      await owner.securitySettings.create({
        data: { licenseId: fx.a.licenseId, brandId: strict.id, requireTwoFactor: true },
      });

      expect((await authorize(fx.a)).statusCode).toBe(401);
    });
  });

  // =========================================================================
  // Guessing budget
  // =========================================================================

  describe('attempt budget', () => {
    it('runs out, and stops the comparison rather than just the answer', async () => {
      const budget = 3;
      const throttled = await startTestServer({ RATE_LIMIT_TWO_FACTOR_PER_HOUR: String(budget) });
      try {
        await clearRateLimits(throttled.app);
        const { secret } = await enrol(fx.a, fx.a.ownerAccountId);
        const body = (extra: string) => ({
          client_id: fx.a.clientId,
          redirect_uri: fx.a.redirectUri,
          code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
          email: fx.a.ownerEmail,
          password: fx.a.password,
          license_id: fx.a.licenseId.toString(),
          code: extra,
        });

        for (let i = 0; i < budget; i += 1) {
          const attempt = await throttled.post('/auth/authorize', body('000000'));
          expect(attempt.statusCode, `attempt ${i + 1} is inside the budget`).toBe(401);
        }

        const blocked = await throttled.post('/auth/authorize', body('000000'));
        expect(blocked.statusCode).toBe(429);

        // The point of charging per presentation rather than per failure: a
        // caller who has run out never reaches the comparison, so a lucky guess
        // after the budget is gone is not a sign-in.
        const lucky = await throttled.post('/auth/authorize', body(code(secret, 1)));
        expect(lucky.statusCode).toBe(429);
      } finally {
        await clearRateLimits(throttled.app);
        await throttled.close();
      }
    });

    it('is keyed to the account, not the address it is guessed from', async () => {
      const budget = 2;
      const throttled = await startTestServer({ RATE_LIMIT_TWO_FACTOR_PER_HOUR: String(budget) });
      try {
        await clearRateLimits(throttled.app);
        await enrol(fx.a, fx.a.ownerAccountId);
        const attempt = (ip: string) =>
          throttled.app.inject({
            method: 'POST',
            url: throttled.url('/auth/authorize'),
            remoteAddress: ip,
            payload: {
              client_id: fx.a.clientId,
              redirect_uri: fx.a.redirectUri,
              code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
              email: fx.a.ownerEmail,
              password: fx.a.password,
              license_id: fx.a.licenseId.toString(),
              code: '000000',
            },
          });

        for (let i = 0; i < budget; i += 1) {
          expect((await attempt(`10.0.0.${i + 1}`)).statusCode).toBe(401);
        }
        // Spreading the guesses across addresses is the first thing anybody
        // would do, so the budget cannot be keyed by one.
        expect((await attempt('10.0.0.99')).statusCode).toBe(429);
      } finally {
        await clearRateLimits(throttled.app);
        await throttled.close();
      }
    });
  });

  // =========================================================================
  // What the sign-in screen is told
  // =========================================================================

  describe('POST /auth/login annotations', () => {
    it('says the account holds a factor, so the screen can ask in one breath', async () => {
      const before = await login(fx.a);
      expect(before.statusCode).toBe(200);
      expect(before.json().account.two_factor_enabled).toBe(false);

      await enrol(fx.a, fx.a.ownerAccountId);

      const after = await login(fx.a);
      expect(after.json().account.two_factor_enabled).toBe(true);
    });

    it('says which workspaces demand one, per membership', async () => {
      await requirePolicy(fx.a);
      await owner.agentMembership.create({
        data: { licenseId: fx.b.licenseId, agentId: fx.a.ownerAccountId, role: 'agent' },
      });

      const memberships = login(fx.a).then(
        (res) =>
          (
            res.json() as {
              memberships: Array<{ license_id: string; two_factor_required: boolean }>;
            }
          ).memberships,
      );

      const byLicense = new Map((await memberships).map((m) => [m.license_id, m]));
      expect(byLicense.get(fx.a.licenseId.toString())?.two_factor_required).toBe(true);
      expect(byLicense.get(fx.b.licenseId.toString())?.two_factor_required).toBe(false);
    });

    it('annotates rather than gates — the listing call still succeeds', async () => {
      // The same reasoning `sso_enforced_connection_id` records: this endpoint
      // selects no workspace and a client can reach `/auth/authorize` without
      // ever calling it, so a gate here would be one nothing has to pass.
      await requirePolicy(fx.a);
      await enrol(fx.a, fx.a.ownerAccountId);

      const response = await login(fx.a);
      expect(response.statusCode).toBe(200);
      expect(response.json().memberships).not.toHaveLength(0);
    });
  });

  // =========================================================================
  // Everything that must not have changed
  // =========================================================================

  describe('sign-ins the gate has no business touching', () => {
    it('leaves an account with no factor and no policy exactly as it was', async () => {
      const response = await authorize(fx.a);
      expect(response.statusCode).toBe(200);
      expect(await trail()).toHaveLength(0);
    });

    it('ignores a code nobody asked for', async () => {
      // A client that always sends the field must not be punished for it; there
      // is no factor to check it against.
      expect((await authorize(fx.a, { code: '000000' })).statusCode).toBe(200);
    });

    it('lets a refresh token rotate without a second factor', async () => {
      const { secret } = await enrol(fx.a, fx.a.ownerAccountId);

      // The verifier has to match the challenge, so this test owns both.
      const verifier = generateToken(48).slice(0, 64);
      const authorized = await server.post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        code_challenge: deriveCodeChallenge(verifier),
        email: fx.a.ownerEmail,
        password: fx.a.password,
        license_id: fx.a.licenseId.toString(),
        code: code(secret, 1),
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

      // A refresh presents a credential this gate already vetted. Demanding a
      // code here would mean typing one every time a tab wakes up.
      const rotated = await server.post('/auth/token', {
        grant_type: 'refresh_token',
        refresh_token: granted.json().refresh_token,
        client_id: fx.a.clientId,
      });
      expect(rotated.statusCode).toBe(200);
    });

    it('exempts a SAML assertion — the identity provider owns that MFA', async () => {
      await enrol(fx.a, fx.a.agentAccountId);
      await requirePolicy(fx.b);

      const connection = await owner.ssoConnection.create({
        data: {
          licenseId: fx.a.licenseId,
          name: 'Okta (corp)',
          idpEntityId: MOCK_IDP_ENTITY_ID,
          idpSsoUrl: 'https://idp.example.test/saml/sso',
          idpCertificatePem: MOCK_IDP_CERTIFICATE,
          verifiedDomains: ['example.test'],
          enabled: true,
        },
        select: { id: true },
      });

      const started = await server.get(
        `/auth/saml/${connection.id}/login?${new URLSearchParams({
          client_id: fx.a.clientId,
          redirect_uri: fx.a.redirectUri,
          code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
        }).toString()}`,
      );
      expect(started.statusCode).toBe(302);
      const request = new URL(started.headers['location'] as string);
      const xml = inflateRawSync(
        Buffer.from(request.searchParams.get('SAMLRequest') ?? '', 'base64'),
      ).toString('utf8');

      const assertion = issueAssertion({
        subject: fx.a.agentEmail,
        audience: `${apiBase}/auth/saml/${connection.id}`,
        destination: `${apiBase}/auth/saml/${connection.id}/acs`,
        inResponseTo: /ID="([^"]+)"/.exec(xml)?.[1] ?? null,
      });

      const acs = await server.app.inject({
        method: 'POST',
        url: `${API_PREFIX}/auth/saml/${connection.id}/acs`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          SAMLResponse: assertion.samlResponseBase64,
          RelayState: request.searchParams.get('RelayState') ?? '',
        }).toString(),
      });

      // A federated sign-in has already been vouched for, and MFA is what the
      // workspace bought the provider for. A second Nexa factor on top would be
      // a weaker copy of a control the IdP owns — and would make an
      // SSO-enforced workspace unenterable for anyone whose authenticator broke.
      expect(acs.statusCode).toBe(302);
      expect(new URL(acs.headers['location'] as string).searchParams.get('code')).toEqual(
        expect.any(String),
      );
    });
  });
});
