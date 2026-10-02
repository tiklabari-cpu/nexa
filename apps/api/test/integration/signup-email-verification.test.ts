/**
 * Sign-up email verification (tm 257.7 · ADR docs/adr/pilot-public-readiness.md
 * K-e(1) · PLAN §D203).
 *
 * The threat is a squatter: public sign-up took any address, so a stranger
 * could open a workspace as `you@yours.test`, and you would later be told the
 * address "already has an account". The two wrong fixes are the tests' first
 * concern, because both look like a working feature from outside:
 *
 *   - a link alone — whoever reads the mail activates the squatter's password;
 *   - a sign-up answer that differs for a taken address — the enumeration the
 *     password reset already closed (FR-MOD-00.3).
 *
 * Every test here runs with `SIGNUP_EMAIL_VERIFICATION=true` unless it says
 * otherwise; the flag-off behaviour is pinned, unchanged, by
 * `account-lifecycle.test.ts` and its neighbours. Mail goes to a real spool so
 * "nothing was sent" means nothing, not "not yet" (`backgroundMail.settled`).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { issueAssertion, MOCK_IDP_CERTIFICATE, MOCK_IDP_ENTITY_ID } from '../helpers/mock-idp.js';
import {
  grantToken,
  ownerClient,
  proveSsoDomains,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { deriveCodeChallenge, generateToken } from '../../src/lib/crypto.js';
import { FileMailer, type Message } from '../../src/services/mail/mailer.js';
import { API_PREFIX } from '../../src/server.js';

const PASSWORD = 'a-quite-long-passphrase';
const OTHER_PASSWORD = 'another-long-passphrase';
const DAY_MS = 86_400_000;
const NEUTRAL = { message: 'Check your inbox to continue.' };

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../prisma/migrations/20261002120000_signup_email_verification/migration.sql',
);

type Sent = Message & { sent_at: string };

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** The `token` query parameter of the one link in a mail body. */
function tokenIn(mail: Sent, path: string): string {
  const match = new RegExp(`https?://\\S+${path}\\?token=\\S+`).exec(mail.body);
  expect(match, `no ${path} link in: ${mail.body}`).not.toBeNull();
  return new URL(match![0]).searchParams.get('token')!;
}

describe('sign-up email verification (SIGNUP_EMAIL_VERIFICATION=true)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let mailer: FileMailer;
  let spool: string;
  let fx: Fixtures;

  beforeAll(async () => {
    owner = ownerClient();
    spool = await mkdtemp(join(tmpdir(), 'siyahtus-verify-'));
    mailer = new FileMailer(spool);
    server = await startTestServer({ SIGNUP_EMAIL_VERIFICATION: 'true' }, { mailer });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
    await rm(spool, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    await rm(spool, { recursive: true, force: true });
  });

  // --- Helpers ---------------------------------------------------------------

  const signup = (email: string, password = PASSWORD, organization = 'NewCo') =>
    server.post('/auth/signup', {
      email,
      password,
      name: 'Founder',
      organization_name: organization,
    });

  /** Everything mailed so far, once the sends the requests started have finished. */
  async function mailbox(to?: string, kind?: Message['kind']): Promise<Sent[]> {
    await server.app.backgroundMail.settled();
    return (await mailer.outbox()).filter(
      (mail) => (to === undefined || mail.to === to) && (kind === undefined || mail.kind === kind),
    );
  }

  /** Sign up and hand back the link's token (the newest one mailed there). */
  async function signupForLink(email: string, password = PASSWORD): Promise<string> {
    expect((await signup(email, password)).statusCode).toBe(202);
    const [latest] = await mailbox(email, 'email_verification');
    return tokenIn(latest!, '/verify-email');
  }

  const verify = (token: string, password = PASSWORD) =>
    server.post('/auth/verify-email', { token, password });

  async function accountOf(email: string) {
    return owner.account.findUniqueOrThrow({ where: { email } });
  }

  /** The workspace a sign-up created, read off the owner's membership. */
  async function workspaceOf(email: string) {
    const account = await accountOf(email);
    const membership = await owner.agentMembership.findFirstOrThrow({
      where: { agentId: account.id, role: 'owner' },
      include: { license: true },
    });
    const client = await owner.oauthClient.findFirstOrThrow({
      where: { organizationId: membership.license.organizationId },
    });
    return {
      account,
      licenseId: membership.licenseId,
      organizationId: membership.license.organizationId,
      license: membership.license,
      clientId: client.id,
      redirectUri: client.redirectUris[0]!,
    };
  }

  async function authorize(email: string, password = PASSWORD) {
    const workspace = await workspaceOf(email);
    return server.post('/auth/authorize', {
      client_id: workspace.clientId,
      redirect_uri: workspace.redirectUri,
      code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
      email,
      password,
      license_id: workspace.licenseId.toString(),
    });
  }

  function errorOf(response: Awaited<ReturnType<TestServer['post']>>) {
    return (response.json() as { error: { type: string; message: string; details?: unknown } })
      .error;
  }

  // =========================================================================
  // The sign-up answer
  // =========================================================================

  describe('sign-up answers a new and a taken address alike (FR-MOD-00.2)', () => {
    it('answers 202 with the same bytes, and never 409', async () => {
      const fresh = await signup('founder@newco.test');
      const taken = await signup(fx.a.ownerEmail);

      expect(fresh.statusCode).toBe(202);
      expect(taken.statusCode).toBe(202);
      // Byte for byte, not "both look fine".
      expect(taken.body).toBe(fresh.body);
      expect(fresh.json()).toEqual(NEUTRAL);
    });

    it('mails a link to the new address and a notice to the taken one, after the answer', async () => {
      await signup('founder@newco.test');
      await signup(fx.a.ownerEmail);

      const all = await mailbox();
      expect(all.map((mail) => [mail.to, mail.kind]).sort()).toEqual(
        [
          ['founder@newco.test', 'email_verification'],
          [fx.a.ownerEmail, 'account_exists_notice'],
        ].sort(),
      );

      const [link] = await mailbox('founder@newco.test');
      expect(link!.body).toContain('/verify-email?token=');
      expect(link!.body).toMatch(/expires in 24 hours/);
      const [notice] = await mailbox(fx.a.ownerEmail);
      expect(notice!.body).toContain('/forgot-password');
      expect(notice!.body).not.toContain('token=');
    });

    it('creates the workspace and an owner nobody has verified yet, with a 14-day trial', async () => {
      await signup('founder@newco.test');

      const workspace = await workspaceOf('founder@newco.test');
      expect(workspace.account.emailVerifiedAt).toBeNull();
      expect(workspace.license).toMatchObject({ plan: 'growth', status: 'trialing' });
      const days = (workspace.license.trialEndsAt!.getTime() - Date.now()) / DAY_MS;
      expect(days).toBeGreaterThan(13.9);
      expect(days).toBeLessThanOrEqual(14);

      // One link, stored only as its hash.
      const links = await owner.emailVerificationToken.findMany({
        where: { accountId: workspace.account.id },
      });
      expect(links).toHaveLength(1);
      expect(links[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(links[0]!.usedAt).toBeNull();
    });

    it('leaves a taken address exactly as it was', async () => {
      const before = await accountOf(fx.a.ownerEmail);
      const organizations = await owner.organization.count();

      await signup(fx.a.ownerEmail, OTHER_PASSWORD, 'Hijack Ltd');

      expect(await owner.organization.count()).toBe(organizations);
      const after = await accountOf(fx.a.ownerEmail);
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(after.emailVerifiedAt).toEqual(before.emailVerifiedAt);
      expect(await owner.emailVerificationToken.count()).toBe(0);
    });

    it('does not replace a pending sign-up when the address signs up again', async () => {
      // Replacing it would let the newest password win whoever owns the mailbox,
      // or let anyone cancel anyone's pending sign-up.
      const first = await signupForLink('pending@newco.test', PASSWORD);
      const again = await signup('pending@newco.test', OTHER_PASSWORD, 'Second Try');
      expect(again.statusCode).toBe(202);
      expect(again.json()).toEqual(NEUTRAL);
      expect(await mailbox('pending@newco.test', 'account_exists_notice')).toHaveLength(1);

      // The first link still works, and only with the first password.
      expect((await verify(first, OTHER_PASSWORD)).statusCode).toBe(401);
      expect((await verify(first, PASSWORD)).statusCode).toBe(200);
    });
  });

  // =========================================================================
  // The sign-in door
  // =========================================================================

  describe('/auth/authorize before the address is proven', () => {
    it('refuses the right password with email_unverified, and the wrong one as it always did', async () => {
      await signup('founder@newco.test');

      const refused = await authorize('founder@newco.test');
      expect(refused.statusCode).toBe(403);
      expect(errorOf(refused)).toMatchObject({
        type: 'not_allowed',
        details: { reason: 'email_unverified' },
      });

      const wrong = await authorize('founder@newco.test', OTHER_PASSWORD);
      expect(wrong.statusCode).toBe(401);
      expect(errorOf(wrong)).toMatchObject({
        type: 'authentication',
        message: 'Invalid email or password.',
      });
    });

    it('refuses before the second factor — no code is asked for and no enrollment ticket minted', async () => {
      await signup('founder@newco.test');
      const workspace = await workspaceOf('founder@newco.test');
      const brand = await owner.brand.findFirstOrThrow({
        where: { licenseId: workspace.licenseId, isDefault: true },
      });
      await owner.securitySettings.create({
        data: { licenseId: workspace.licenseId, brandId: brand.id, requireTwoFactor: true },
      });

      const refused = await authorize('founder@newco.test');
      expect(refused.statusCode).toBe(403);
      expect(errorOf(refused).details).toEqual({ reason: 'email_unverified' });
      expect(
        await owner.apiToken.count({
          where: { ownerId: workspace.account.id, kind: 'enrollment' },
        }),
      ).toBe(0);
    });

    it('tells /auth/login that the address is not verified yet, so the screen can say so first', async () => {
      await signup('founder@newco.test');
      const login = await server.post('/auth/login', {
        email: 'founder@newco.test',
        password: PASSWORD,
      });
      expect(login.statusCode).toBe(200);
      expect(login.json().account.email_verified).toBe(false);

      const verified = await server.post('/auth/login', {
        email: fx.a.ownerEmail,
        password: fx.a.password,
      });
      expect(verified.json().account.email_verified).toBe(true);
    });

    it('lets the owner in once the link is opened with the password', async () => {
      const token = await signupForLink('founder@newco.test');
      expect((await verify(token)).statusCode).toBe(200);

      const signedIn = await authorize('founder@newco.test');
      expect(signedIn.statusCode).toBe(200);
      expect(signedIn.json().code).toEqual(expect.any(String));
    });
  });

  // =========================================================================
  // The link: token AND password
  // =========================================================================

  describe('POST /auth/verify-email', () => {
    it('verifies with the token and the password, and answers with the session sign-up gives (FR-MOD-00.2)', async () => {
      const token = await signupForLink('founder@newco.test');
      const response = await verify(token);

      expect(response.statusCode).toBe(200);
      const session = response.json() as {
        account: { id: string; email: string; name: string };
        memberships: Array<{ license_id: string; role: string; client_id: string }>;
      };
      const workspace = await workspaceOf('founder@newco.test');
      expect(session.account).toEqual({
        id: workspace.account.id,
        email: 'founder@newco.test',
        name: 'Founder',
      });
      expect(session.memberships).toHaveLength(1);
      expect(session.memberships[0]).toMatchObject({
        license_id: workspace.licenseId.toString(),
        role: 'owner',
        client_id: workspace.clientId,
      });
      expect(workspace.account.emailVerifiedAt).not.toBeNull();
    });

    it('starts the 14-day trial when the address is proven, not when it was typed (FR-MOD-00.2)', async () => {
      const token = await signupForLink('founder@newco.test');
      const { licenseId } = await workspaceOf('founder@newco.test');
      // As if the link sat in the mailbox for twelve days.
      await owner.license.update({
        where: { id: licenseId },
        data: { trialEndsAt: new Date(Date.now() + 2 * DAY_MS) },
      });

      const startedAt = Date.now();
      expect((await verify(token)).statusCode).toBe(200);

      const { license } = await workspaceOf('founder@newco.test');
      const ends = license.trialEndsAt!.getTime();
      expect(ends).toBeGreaterThanOrEqual(startedAt + 14 * DAY_MS - 60_000);
      expect(ends).toBeLessThanOrEqual(Date.now() + 14 * DAY_MS + 60_000);
    });

    it('refuses the right link with the wrong password, and leaves the link working', async () => {
      const token = await signupForLink('founder@newco.test');

      const wrong = await verify(token, OTHER_PASSWORD);
      expect(wrong.statusCode).toBe(401);
      const [link] = await owner.emailVerificationToken.findMany({
        where: { tokenHash: sha256(token) },
      });
      expect(link!.usedAt).toBeNull();
      expect((await accountOf('founder@newco.test')).emailVerifiedAt).toBeNull();

      expect((await verify(token)).statusCode).toBe(200);
    });

    it('gives one answer for an unknown, a used and an expired link and a wrong password', async () => {
      const used = await signupForLink('used@newco.test');
      expect((await verify(used)).statusCode).toBe(200);

      const expired = await signupForLink('expired@newco.test');
      await owner.emailVerificationToken.update({
        where: { tokenHash: sha256(expired) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const wrongPassword = await signupForLink('wrong@newco.test');

      const answers = [
        await verify('u'.repeat(43)),
        await verify(used),
        await verify(expired),
        await verify(wrongPassword, OTHER_PASSWORD),
      ];
      for (const answer of answers) expect(answer.statusCode).toBe(401);
      const bodies = answers.map((answer) => {
        const { type, message, details } = errorOf(answer);
        return { type, message, details };
      });
      expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
      expect(bodies[0]!.type).toBe('authentication');
      // And the expired one stays unverified.
      expect((await accountOf('expired@newco.test')).emailVerifiedAt).toBeNull();
    });

    it('budgets password attempts per link, and a new link starts a new budget', async () => {
      const token = await signupForLink('founder@newco.test');

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        expect((await verify(token, OTHER_PASSWORD)).statusCode, `attempt ${attempt}`).toBe(401);
      }
      // Past the budget even the right password is not tried.
      const exhausted = await verify(token);
      expect(exhausted.statusCode).toBe(429);
      expect((await accountOf('founder@newco.test')).emailVerifiedAt).toBeNull();

      await server.post('/auth/verify-email/resend', { email: 'founder@newco.test' });
      const [fresh] = await mailbox('founder@newco.test', 'email_verification');
      const next = tokenIn(fresh!, '/verify-email');
      expect(next).not.toBe(token);
      expect((await verify(next)).statusCode).toBe(200);
    });

    it('records the link sent and the address verified in the workspace trail', async () => {
      const token = await signupForLink('founder@newco.test');
      await verify(token);
      await server.app.backgroundMail.settled();

      const { licenseId, account } = await workspaceOf('founder@newco.test');
      const entries = await owner.auditLogEntry.findMany({
        where: { licenseId, action: { in: ['auth.verification_sent', 'auth.email_verified'] } },
        orderBy: { createdAt: 'asc' },
      });
      expect(entries.map((entry) => [entry.action, entry.actorId, entry.metadata])).toEqual([
        ['auth.verification_sent', account.id, expect.objectContaining({ via: 'signup' })],
        [
          'auth.email_verified',
          account.id,
          expect.not.objectContaining({ via: expect.anything() }),
        ],
      ]);
    });
  });

  // =========================================================================
  // Asking again
  // =========================================================================

  describe('POST /auth/verify-email/resend', () => {
    it('answers 202 with the same bytes whatever the address', async () => {
      await signup('pending@newco.test');
      const answers = [
        await server.post('/auth/verify-email/resend', { email: 'pending@newco.test' }),
        await server.post('/auth/verify-email/resend', { email: fx.a.ownerEmail }),
        await server.post('/auth/verify-email/resend', { email: 'nobody@nowhere.test' }),
      ];
      for (const answer of answers) {
        expect(answer.statusCode).toBe(202);
        expect(answer.body).toBe(answers[0]!.body);
      }
    });

    it('mails only an address still waiting, and spends the earlier link', async () => {
      const first = await signupForLink('pending@newco.test');
      await server.post('/auth/verify-email/resend', { email: 'pending@newco.test' });
      await server.post('/auth/verify-email/resend', { email: fx.a.ownerEmail });
      await server.post('/auth/verify-email/resend', { email: 'nobody@nowhere.test' });

      expect(await mailbox(fx.a.ownerEmail)).toHaveLength(0);
      expect(await mailbox('nobody@nowhere.test')).toHaveLength(0);
      const links = await mailbox('pending@newco.test', 'email_verification');
      expect(links).toHaveLength(2);

      const second = tokenIn(links[0]!, '/verify-email');
      expect((await verify(first)).statusCode).toBe(401);
      expect((await verify(second)).statusCode).toBe(200);
    });

    it('stops mailing after three an hour, and keeps the answer', async () => {
      await signup('pending@newco.test');
      for (let request = 1; request <= 4; request += 1) {
        const answer = await server.post('/auth/verify-email/resend', {
          email: 'Pending@NewCo.test',
        });
        expect(answer.statusCode).toBe(202);
      }
      // The sign-up's own link plus three.
      expect(await mailbox('Pending@NewCo.test', 'email_verification')).toHaveLength(3);
      expect(await mailbox('pending@newco.test', 'email_verification')).toHaveLength(1);
    });
  });

  // =========================================================================
  // A password reset proves the address too
  // =========================================================================

  describe('password reset', () => {
    it('verifies an owner still waiting, spends the link and lets them in', async () => {
      const link = await signupForLink('founder@newco.test');
      expect(
        (await server.post('/auth/password-reset', { email: 'founder@newco.test' })).statusCode,
      ).toBe(202);
      const [reset] = await mailbox('founder@newco.test', 'password_reset');
      const confirm = await server.post('/auth/password-reset/confirm', {
        token: tokenIn(reset!, '/reset-password'),
        password: OTHER_PASSWORD,
      });
      expect(confirm.statusCode).toBe(204);

      expect((await accountOf('founder@newco.test')).emailVerifiedAt).not.toBeNull();
      expect((await verify(link, PASSWORD)).statusCode).toBe(401);
      expect((await authorize('founder@newco.test', OTHER_PASSWORD)).statusCode).toBe(200);
    });
  });

  // =========================================================================
  // Invitations to an address nobody has verified
  // =========================================================================

  describe('an invitation to an unverified address', () => {
    async function invite(email: string): Promise<string> {
      const adminToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--all:rw'],
      });
      const response = await server.post(
        '/invitations',
        { emails: [email], role: 'agent' },
        { authorization: `Bearer ${adminToken}` },
      );
      expect(response.statusCode).toBe(201);
      const url = (response.json() as { items: Array<{ accept_url: string }> }).items[0]!
        .accept_url;
      return new URL(url).searchParams.get('token')!;
    }

    it('asks for a password, sets it, verifies the address and revokes the old one’s sessions', async () => {
      // The squatter signed up with somebody else's address and never could
      // verify it. Their password must not reach the workspace that invites it.
      await signup('target@example.test', PASSWORD, 'Squat Ltd');
      const squat = await workspaceOf('target@example.test');
      const squatterPat = await grantToken(owner, {
        licenseId: squat.licenseId,
        organizationId: squat.organizationId,
        ownerId: squat.account.id,
        scopes: ['accounts--my:rw'],
      });

      const token = await invite('target@example.test');
      const preview = await server.get(`/auth/invitations/preview?token=${token}`);
      expect(preview.json()).toMatchObject({ needs_password: true });

      // Without a password: refused, and the invitation is not spent.
      const bare = await server.post('/auth/invitations/accept', { token });
      expect(bare.statusCode).toBe(400);
      expect((await server.get(`/auth/invitations/preview?token=${token}`)).statusCode).toBe(200);

      const accepted = await server.post('/auth/invitations/accept', {
        token,
        name: 'Real Person',
        password: OTHER_PASSWORD,
      });
      expect(accepted.statusCode).toBe(200);

      const account = await accountOf('target@example.test');
      expect(account.emailVerifiedAt).not.toBeNull();
      expect(account.name).toBe('Real Person');
      const oldLogin = await server.post('/auth/login', {
        email: 'target@example.test',
        password: PASSWORD,
      });
      expect(oldLogin.statusCode).toBe(401);
      const newLogin = await server.post('/auth/login', {
        email: 'target@example.test',
        password: OTHER_PASSWORD,
      });
      expect(newLogin.json().account.email_verified).toBe(true);
      expect(
        (await server.get('/auth/me', { authorization: `Bearer ${squatterPat}` })).statusCode,
      ).toBe(401);
    });

    it('asks a verified account for nothing, as before', async () => {
      const token = await invite(fx.b.ownerEmail);
      const preview = await server.get(`/auth/invitations/preview?token=${token}`);
      expect(preview.json()).toMatchObject({ needs_password: false });
      expect((await server.post('/auth/invitations/accept', { token })).statusCode).toBe(200);
    });
  });

  // =========================================================================
  // The SAML door
  // =========================================================================

  describe('SAML assertion consumer service', () => {
    let apiBase: string;

    beforeAll(() => {
      apiBase = `${testEnv().API_BASE_URL}${API_PREFIX}`;
    });

    async function connect() {
      const row = await owner.ssoConnection.create({
        data: {
          licenseId: fx.a.licenseId,
          name: 'Okta (corp)',
          idpEntityId: MOCK_IDP_ENTITY_ID,
          idpSsoUrl: 'https://idp.example.test/saml/sso',
          idpCertificatePem: MOCK_IDP_CERTIFICATE,
          verifiedDomains: ['example.test', 'corp.example.test'],
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

    /** Start an SP-initiated login and answer it with an assertion for `email`. */
    async function signInAs(email: string) {
      const connection = await connect();
      const search = new URLSearchParams({
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
      });
      const start = await server.get(`/auth/saml/${connection.id}/login?${search.toString()}`);
      expect(start.statusCode).toBe(302);
      const url = new URL(start.headers['location'] as string);
      const xml = inflateRawSync(
        Buffer.from(url.searchParams.get('SAMLRequest') ?? '', 'base64'),
      ).toString('utf8');

      const assertion = issueAssertion({
        subject: email,
        audience: connection.entityId,
        destination: connection.acsUrl,
        inResponseTo: /ID="([^"]+)"/.exec(xml)?.[1] ?? null,
        attributes: { email: [email] },
      });
      const response = await server.app.inject({
        method: 'POST',
        url: `${API_PREFIX}/auth/saml/${connection.id}/acs`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          SAMLResponse: assertion.samlResponseBase64,
          RelayState: url.searchParams.get('RelayState') ?? '',
        }).toString(),
      });
      return { connection, response };
    }

    it('mints no code for an unverified password account, and provisions it nothing', async () => {
      await signup('pending@corp.example.test');
      const pending = await accountOf('pending@corp.example.test');

      const { response } = await signInAs('pending@corp.example.test');
      expect(response.statusCode).toBe(403);
      expect(errorOf(response)).toMatchObject({
        type: 'not_allowed',
        details: { reason: 'email_unverified' },
      });
      expect(response.headers['location']).toBeUndefined();

      expect(
        await owner.agentMembership.count({
          where: { licenseId: fx.a.licenseId, agentId: pending.id },
        }),
      ).toBe(0);
      const failures = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'auth.sso_login_failed' },
      });
      expect(failures.map((entry) => entry.metadata)).toEqual([
        expect.objectContaining({ reason: 'email_unverified' }),
      ]);
    });

    it('provisions a newcomer as a verified account', async () => {
      const { response } = await signInAs('newcomer@corp.example.test');
      expect(response.statusCode).toBe(302);
      const account = await accountOf('newcomer@corp.example.test');
      expect(account.passwordHash).toBeNull();
      expect(account.emailVerifiedAt).not.toBeNull();
    });
  });

  // =========================================================================
  // The migration's backfill
  // =========================================================================

  describe('the migration', () => {
    /**
     * Section 1 of the migration — the column, the backfill and the default —
     * replayed against accounts that existed before it, inside a transaction
     * that is rolled back. The column is dropped first so the replay meets the
     * table as the migration did.
     */
    function columnStatements(): string[] {
      const sql = readFileSync(MIGRATION, 'utf8');
      const start = sql.indexOf('-- 1. accounts.email_verified_at');
      const end = sql.indexOf('-- 2. email_verification_tokens');
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      return sql
        .slice(start, end)
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean);
    }

    it('verifies every account that existed before it, at the moment it was created', async () => {
      // An unverified owner exists before the replay: the backfill must reach it.
      await signup('pending@newco.test');

      /** Carries what the replay saw out of the transaction it rolls back. */
      class Replayed extends Error {
        constructor(
          readonly counts: { total: number; unverified: number; notAtCreation: number },
          readonly laterVerified: boolean,
        ) {
          super('replay rolled back on purpose');
        }
      }

      let replayed: Replayed | undefined;
      await owner
        .$transaction(async (tx) => {
          await tx.$executeRawUnsafe('ALTER TABLE accounts DROP COLUMN email_verified_at');
          for (const statement of columnStatements()) await tx.$executeRawUnsafe(statement);

          const [counts] = await tx.$queryRaw<
            Array<{ total: bigint; unverified: bigint; not_at_creation: bigint }>
          >`SELECT count(*) AS total,
                   count(*) FILTER (WHERE email_verified_at IS NULL) AS unverified,
                   count(*) FILTER (WHERE email_verified_at IS DISTINCT FROM created_at)
                     AS not_at_creation
              FROM accounts`;
          // And an account written afterwards by any path but sign-up.
          await tx.$executeRaw`
            INSERT INTO accounts (id, email, name)
            VALUES (gen_random_uuid(), 'later@example.test', 'Later')`;
          const [later] = await tx.$queryRaw<Array<{ verified: boolean }>>`
            SELECT email_verified_at IS NOT NULL AS verified FROM accounts
             WHERE email = 'later@example.test'`;

          // Thrown, never returned: nothing of the replay may outlive the test.
          throw new Replayed(
            {
              total: Number(counts!.total),
              unverified: Number(counts!.unverified),
              notAtCreation: Number(counts!.not_at_creation),
            },
            later!.verified,
          );
        })
        .catch((error: unknown) => {
          if (!(error instanceof Replayed)) throw error;
          replayed = error;
        });

      expect(replayed).toBeDefined();
      expect(replayed!.counts.total).toBeGreaterThanOrEqual(5);
      expect(replayed!.counts.unverified).toBe(0);
      expect(replayed!.counts.notAtCreation).toBe(0);
      expect(replayed!.laterVerified).toBe(true);

      // Rolled back: the pending owner is still pending, the later row is gone.
      expect((await accountOf('pending@newco.test')).emailVerifiedAt).toBeNull();
      expect(await owner.account.count({ where: { email: 'later@example.test' } })).toBe(0);
    });
  });
});

describe('with SIGNUP_EMAIL_VERIFICATION off', () => {
  let owner: PrismaClient;
  let server: TestServer;
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

  it('creates a verified owner and answers 201 with the session, as before (FR-MOD-00.2)', async () => {
    const response = await server.post('/auth/signup', {
      email: 'founder@open.test',
      password: PASSWORD,
      name: 'Founder',
      organization_name: 'OpenCo',
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().memberships).toHaveLength(1);
    const account = await owner.account.findUniqueOrThrow({
      where: { email: 'founder@open.test' },
    });
    expect(account.emailVerifiedAt).not.toBeNull();
    expect(await owner.emailVerificationToken.count()).toBe(0);
  });

  /**
   * A security fix that does not wait for the flag: the reset contract has
   * always said "existing sessions revoked", and an access token or a personal
   * token minted by whoever the reset is meant to lock out is a session.
   */
  it('revokes the account’s access and personal tokens on a password reset, but not a SCIM token', async () => {
    const pat = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['accounts--my:rw'],
    });
    const access = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['accounts--my:rw'],
      kind: 'oauth',
    });
    await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['scim:rw'],
      kind: 'scim',
    });
    const me = (token: string) => server.get('/auth/me', { authorization: `Bearer ${token}` });
    expect((await me(pat)).statusCode).toBe(200);
    expect((await me(access)).statusCode).toBe(200);

    const token = 'v'.repeat(43);
    await owner.passwordResetToken.create({
      data: {
        accountId: fx.a.ownerAccountId,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const confirm = await server.post('/auth/password-reset/confirm', {
      token,
      password: OTHER_PASSWORD,
    });
    expect(confirm.statusCode).toBe(204);

    expect((await me(pat)).statusCode).toBe(401);
    expect((await me(access)).statusCode).toBe(401);
    expect(
      await owner.apiToken.count({
        where: { ownerId: fx.a.ownerAccountId, kind: 'scim', revokedAt: null },
      }),
    ).toBe(1);
  });
});
