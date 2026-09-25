/**
 * A workspace's owner can sign in to the panel at the address the deployment
 * actually serves it from (tm 255.17 · PLAN §D189).
 *
 * Found by the pilot rehearsal (tm 255.15): `auth_signup` registered the
 * console callback as the literal `http://localhost:5173/auth/callback`, the
 * panel sends `${origin}/auth/callback`, and matching is exact — so on any
 * other address every owner was refused at `/auth/authorize` with
 * "redirect_uri is not registered for this client". Every test below boots the
 * API with a `WEB_APP_URL` that is not the development one.
 */
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MOBILE_REDIRECT_URI } from '@nexa/types';
import { deriveCodeChallenge, generateToken, hashPassword } from '../../src/lib/crypto.js';
import { DEV_CONSOLE_REDIRECT } from '../../src/lib/console-redirect.js';
import { ownerClient, resetDatabase } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const PANEL = 'https://panel.example.test';
const PANEL_CALLBACK = `${PANEL}/auth/callback`;
const PASSWORD = 'a-quite-long-passphrase';

function pkce(): { verifier: string; challenge: string } {
  const verifier = generateToken(48).slice(0, 64);
  return { verifier, challenge: deriveCodeChallenge(verifier) };
}

interface SignedUp {
  email: string;
  clientId: string;
  licenseId: string;
  organizationId: string;
}

async function signup(server: TestServer, slug: string): Promise<SignedUp> {
  const email = `owner@${slug}.test`;
  const response = await server.post('/auth/signup', {
    email,
    password: PASSWORD,
    name: 'Owner',
    organization_name: `Org ${slug}`,
  });
  expect(response.statusCode).toBe(201);
  const membership = (
    response.json() as {
      memberships: Array<{ client_id: string; license_id: string; organization_id: string }>;
    }
  ).memberships[0]!;
  return {
    email,
    clientId: membership.client_id,
    licenseId: membership.license_id,
    organizationId: membership.organization_id,
  };
}

function authorize(server: TestServer, who: SignedUp, redirectUri: string, challenge?: string) {
  return server.post('/auth/authorize', {
    client_id: who.clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge ?? pkce().challenge,
    email: who.email,
    password: PASSWORD,
    license_id: who.licenseId,
  });
}

async function registeredRedirects(owner: PrismaClient, clientId: string): Promise<string[]> {
  const client = await owner.oauthClient.findUniqueOrThrow({
    where: { id: clientId },
    select: { redirectUris: true },
  });
  return client.redirectUris;
}

/** The SQLSTATE a raw query failed with (Prisma: P2010, `meta.code`). */
async function sqlStateOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return (error.meta as { code?: string } | undefined)?.code;
    }
    throw error;
  }
  return undefined;
}

describe('the console callback comes from WEB_APP_URL (tm 255.17)', () => {
  let owner: PrismaClient;
  let panel: TestServer;

  beforeAll(async () => {
    owner = ownerClient();
    panel = await startTestServer({ WEB_APP_URL: PANEL });
  });

  afterAll(async () => {
    await panel.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    await clearRateLimits(panel.app);
  });

  describe('a workspace signed up on the deployment (FR-MOD-00.2 · FR-MOD-00.1)', () => {
    it("lets its owner sign in through the deployment's own panel address", async () => {
      const who = await signup(panel, 'pilot');
      const { verifier, challenge } = pkce();

      const authorized = await authorize(panel, who, PANEL_CALLBACK, challenge);
      expect(authorized.statusCode).toBe(200);

      const token = await panel.post('/auth/token', {
        grant_type: 'authorization_code',
        code: (authorized.json() as { code: string }).code,
        code_verifier: verifier,
        client_id: who.clientId,
        redirect_uri: PANEL_CALLBACK,
      });
      expect(token.statusCode).toBe(200);
      expect((token.json() as { access_token: string }).access_token).toBeTruthy();
    });

    it('registers exactly the panel callback and the mobile one', async () => {
      const who = await signup(panel, 'exact');
      // Decision (§D189): instead of the development callback, not beside it.
      expect(await registeredRedirects(owner, who.clientId)).toEqual([
        PANEL_CALLBACK,
        MOBILE_REDIRECT_URI,
      ]);
    });

    it.each([
      ['another origin', 'https://evil.example.test/auth/callback'],
      ['a look-alike host', 'https://panel.example.test.evil.test/auth/callback'],
      ['plain http on the panel host', 'http://panel.example.test/auth/callback'],
      ['another path on the panel', `${PANEL}/auth/callback2`],
      ['the development callback it no longer registers', DEV_CONSOLE_REDIRECT],
    ])('still refuses %s', async (_label, redirectUri) => {
      const who = await signup(panel, 'refuse');
      const response = await authorize(panel, who, redirectUri);
      expect(response.statusCode).toBe(400);
      expect((response.json() as { error: { message: string } }).error.message).toMatch(
        /redirect_uri is not registered/,
      );
    });

    it('keeps the mobile callback working (unchanged)', async () => {
      const who = await signup(panel, 'mobile');
      expect((await authorize(panel, who, MOBILE_REDIRECT_URI)).statusCode).toBe(200);
    });

    it('takes nothing from the signup request itself', async () => {
      // The allowlist is server configuration. A caller naming its own
      // redirect in the body must not be able to widen it.
      const response = await panel.post('/auth/signup', {
        email: 'owner@smuggle.test',
        password: PASSWORD,
        name: 'Owner',
        organization_name: 'Smuggle',
        redirect_uri: 'https://evil.example.test/auth/callback',
        redirect_uris: ['https://evil.example.test/auth/callback'],
      });
      const clients = await owner.oauthClient.findMany({ select: { redirectUris: true } });
      for (const client of clients) {
        expect(client.redirectUris).not.toContain('https://evil.example.test/auth/callback');
      }
      // Whatever the route made of the extra keys, it did not 5xx over them.
      expect(response.statusCode).toBeLessThan(500);
    });
  });

  describe('a workspace that existed before (expand-only, CONVENTIONS §6.3)', () => {
    let dev: TestServer;
    let rebooted: TestServer | undefined;

    beforeAll(async () => {
      dev = await startTestServer();
    });

    afterAll(async () => {
      await dev.close();
    });

    afterEach(async () => {
      await rebooted?.close();
      rebooted = undefined;
    });

    it('gains the panel callback at the next boot, and keeps the one it had', async () => {
      // Signed up while the deployment answered on the development address —
      // the shape every workspace had before this migration.
      const who = await signup(dev, 'before');
      expect(await registeredRedirects(owner, who.clientId)).toEqual([
        DEV_CONSOLE_REDIRECT,
        MOBILE_REDIRECT_URI,
      ]);
      // The server booted before that signup cannot have registered anything
      // for it; the reboot below is what does.
      expect((await authorize(panel, who, PANEL_CALLBACK)).statusCode).toBe(400);

      rebooted = await startTestServer({ WEB_APP_URL: PANEL });

      expect(await registeredRedirects(owner, who.clientId)).toEqual([
        DEV_CONSOLE_REDIRECT,
        MOBILE_REDIRECT_URI,
        PANEL_CALLBACK,
      ]);
      expect((await authorize(rebooted, who, PANEL_CALLBACK)).statusCode).toBe(200);
      // Expand-only: the old callback still works until someone removes it.
      expect((await authorize(rebooted, who, DEV_CONSOLE_REDIRECT)).statusCode).toBe(200);
    });

    it('appends once, however many times the API boots', async () => {
      const who = await signup(dev, 'twice');
      rebooted = await startTestServer({ WEB_APP_URL: PANEL });
      const again = await startTestServer({ WEB_APP_URL: PANEL });
      await again.close();

      const redirects = await registeredRedirects(owner, who.clientId);
      expect(redirects.filter((uri) => uri === PANEL_CALLBACK)).toHaveLength(1);
    });

    it('widens sandbox clients too, and never a partner app', async () => {
      const who = await signup(dev, 'mixed');
      const PARTNER_ID = '0123456789abcdef0123456789abcdef';
      const SANDBOX_ID = `nexa-sandbox-app-${who.organizationId}`;
      await owner.oauthClient.createMany({
        data: [
          {
            id: PARTNER_ID,
            organizationId: who.organizationId,
            displayName: 'Partner app',
            clientType: 'public',
            redirectUris: ['https://partner.example.test/cb'],
            scopes: [],
          },
          {
            id: SANDBOX_ID,
            organizationId: who.organizationId,
            displayName: 'Nexa Sandbox App',
            clientType: 'public',
            redirectUris: [DEV_CONSOLE_REDIRECT, MOBILE_REDIRECT_URI],
            scopes: [],
          },
        ],
      });

      rebooted = await startTestServer({ WEB_APP_URL: PANEL });

      expect(await registeredRedirects(owner, SANDBOX_ID)).toContain(PANEL_CALLBACK);
      // A partner's redirects belong to whoever registered the app.
      expect(await registeredRedirects(owner, PARTNER_ID)).toEqual([
        'https://partner.example.test/cb',
      ]);
    });
  });

  describe('the database refuses a callback no sign-in could use', () => {
    it.each([
      ['plain http off loopback', 'http://panel.example.test/auth/callback'],
      ['a script URL', 'javascript:alert(1)'],
      ['userinfo', 'https://evil.test@panel.example.test/auth/callback'],
      ['a query', `${PANEL_CALLBACK}?next=/x`],
      ['another path', `${PANEL}/callback`],
      ['the mobile scheme', MOBILE_REDIRECT_URI],
    ])('auth_register_console_redirect refuses %s (22023) and writes nothing', async (_l, uri) => {
      const who = await signup(panel, 'guard');
      const before = await registeredRedirects(owner, who.clientId);

      // As the runtime role — the one that holds EXECUTE.
      const state = await sqlStateOf(
        panel.app.db.$queryRaw`SELECT auth_register_console_redirect(${uri})`,
      );
      expect(state).toBe('22023');
      expect(await registeredRedirects(owner, who.clientId)).toEqual(before);
    });

    it('auth_signup refuses one too, before creating anything', async () => {
      const hash = await hashPassword(PASSWORD);
      const state = await sqlStateOf(
        panel.app.db.$queryRaw`
          SELECT * FROM auth_signup(
            'owner@bad-callback.test'::citext, 'Owner', ${hash}, 'Bad callback', 14, 'eu',
            'https://evil.test@panel.example.test/auth/callback'
          )`,
      );
      expect(state).toBe('22023');
      expect(await owner.organization.count({ where: { name: 'Bad callback' } })).toBe(0);
    });

    it('still answers a six-argument call — the previous release, mid-rollout', async () => {
      const hash = await hashPassword(PASSWORD);
      const [row] = await panel.app.db.$queryRaw<Array<{ created_organization: string }>>`
        SELECT * FROM auth_signup(
          'owner@old-release.test'::citext, 'Owner', ${hash}, 'Old release', 14, 'eu'
        )`;
      expect(
        await registeredRedirects(owner, `nexa-agent-app-${row!.created_organization}`),
      ).toEqual([DEV_CONSOLE_REDIRECT, MOBILE_REDIRECT_URI]);
    });
  });
});
