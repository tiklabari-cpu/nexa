/**
 * Shared fixtures.
 *
 * Everything here goes through the public API rather than the database. A test
 * helper that reaches into Postgres can pass while the API that real clients
 * use is broken — which is the entire failure mode this suite exists to catch.
 */
import { createHash, randomBytes } from 'node:crypto';
import { expect, request, test as base, type APIRequestContext, type Page } from '@playwright/test';

export const API_BASE = 'http://localhost:4000/api/v1';
export const HOST_PAGE = 'http://acme-bikes.localhost:5174';
export const WIDGET_ORIGIN = 'http://localhost:5174';

export const DEMO = {
  email: 'owner@acme.localhost',
  password: 'nexa-demo-password',
  agentName: 'Dana Okonkwo',
} as const;

interface Fixtures {
  /** An agent already signed in, sitting on the inbox. */
  agentPage: Page;
}

interface WorkerFixtures {
  /** Organization id of the seeded Acme tenant, resolved via the API. */
  organizationId: string;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  /**
   * Worker-scoped on purpose.
   *
   * Per-test this cost one `/auth/login` per test, and combined with the
   * sign-ins that is enough to trip the anonymous rate limit inside a single
   * run — the suite then fails with 429s that look like product bugs and are
   * not. The tenant does not change during a run, so resolving it once is both
   * cheaper and more honest.
   */
  organizationId: [
    // The empty pattern is required, not sloppy: Playwright parses this
    // parameter's source to discover which fixtures to inject, and rejects
    // anything that is not a destructuring pattern.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const context = await request.newContext({
        baseURL: API_BASE,
        extraHTTPHeaders: { 'user-agent': `nexa-e2e-worker-${workerInfo.workerIndex}` },
      });
      try {
        await use(await resolveOrganizationId(context));
      } finally {
        await context.dispose();
      }
    },
    { scope: 'worker' },
  ],

  agentPage: async ({ page }, use) => {
    await signIn(page);
    await use(page);
  },
});

export { expect };

/**
 * The seeded organization id changes on every reseed, so it has to be looked up
 * rather than hard-coded. `/auth/login` returns the caller's memberships, which
 * is the only place a client can learn it before holding a token.
 */
export async function resolveOrganizationId(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_BASE}/auth/login`, {
    data: { email: DEMO.email, password: DEMO.password },
  });
  expect(response.ok(), `login failed: ${response.status()} ${await response.text()}`).toBe(true);

  const body = (await response.json()) as {
    memberships: Array<{ organization_id: string; organization_name: string }>;
  };
  const acme = body.memberships.find((m) => m.organization_name.startsWith('Acme'));
  expect(acme, 'seeded Acme tenant not found').toBeDefined();
  return acme!.organization_id;
}

/** The credentials + tenant of a seeded owner, for `ownerAccessTokenFor`. */
export interface TenantOwner {
  email: string;
  password: string;
  /** The seeded organization's name starts with this — memberships are matched on it. */
  orgPrefix: string;
}

/** The primary demo tenant (owner@acme.localhost). */
export const ACME_OWNER: TenantOwner = {
  email: DEMO.email,
  password: DEMO.password,
  orgPrefix: 'Acme',
};

/** The second seeded tenant — the "other tenant" side of cross-tenant proofs. */
export const NORTHWIND_OWNER: TenantOwner = {
  email: 'owner@northwind.localhost',
  password: DEMO.password,
  orgPrefix: 'Northwind',
};

/**
 * An owner Bearer token for a given seeded tenant, via the same OAuth 2.1 + PKCE
 * flow the web app runs (`auth-store.ts`). A handful of e2e steps have to drive
 * the API directly — registering a webhook to prove its audit entry reaches the
 * screen (NFR-S12), or standing up a second tenant's public KB (PUBKB-i) — and
 * the browser session keeps its token in memory, out of reach of the test.
 * Owners hold the admin scope set (ADMIN_SCOPES) by default, so this token can
 * both write and read the surfaces those steps exercise.
 */
export async function ownerAccessTokenFor(
  context: APIRequestContext,
  owner: TenantOwner,
): Promise<string> {
  const login = await context.post(`${API_BASE}/auth/login`, {
    data: { email: owner.email, password: owner.password },
  });
  expect(login.ok(), `login failed: ${login.status()} ${await login.text()}`).toBe(true);
  const { memberships } = (await login.json()) as {
    memberships: Array<{ client_id?: string; organization_name: string; license_id: string }>;
  };
  const tenant = memberships.find((m) => m.organization_name.startsWith(owner.orgPrefix));
  expect(tenant?.client_id, `seeded ${owner.orgPrefix} tenant not found`).toBeTruthy();

  // A fresh PKCE pair; the challenge is base64url(sha256(verifier)), S256.
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const redirectUri = 'http://localhost:5173/auth/callback';

  const authorized = await context.post(`${API_BASE}/auth/authorize`, {
    data: {
      client_id: tenant!.client_id,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      email: owner.email,
      password: owner.password,
      license_id: tenant!.license_id,
    },
  });
  expect(
    authorized.ok(),
    `authorize failed: ${authorized.status()} ${await authorized.text()}`,
  ).toBe(true);
  const { code } = (await authorized.json()) as { code: string };

  const granted = await context.post(`${API_BASE}/auth/token`, {
    data: {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: tenant!.client_id,
      redirect_uri: redirectUri,
    },
  });
  expect(granted.ok(), `token failed: ${granted.status()} ${await granted.text()}`).toBe(true);
  return ((await granted.json()) as { access_token: string }).access_token;
}

/** An owner Bearer token for the primary Acme tenant (the common case). */
export async function ownerAccessToken(context: APIRequestContext): Promise<string> {
  return ownerAccessTokenFor(context, ACME_OWNER);
}

export async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(DEMO.email);
  await page.getByLabel('Password').fill(DEMO.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The inbox rail only exists once the session is real.
  await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible();
}

/** The widget lives in a cross-origin iframe; everything inside is addressed through it. */
export function widgetFrame(page: Page) {
  return page.frameLocator('#nexa-widget-frame');
}

export async function openWidget(page: Page, organizationId: string): Promise<void> {
  await page.goto(`${HOST_PAGE}/demo.html?organization_id=${organizationId}`);
  const frame = widgetFrame(page);
  await frame.getByRole('button', { name: 'Open chat' }).click();
  // The composer only appears once the token exchange has succeeded.
  await expect(frame.getByRole('textbox', { name: 'Message' })).toBeVisible();
}

/** Send a message as the visitor and wait for it to appear in their transcript. */
export async function visitorSends(page: Page, text: string): Promise<void> {
  const frame = widgetFrame(page);
  await frame.getByRole('textbox', { name: 'Message' }).fill(text);
  await frame.getByRole('button', { name: 'Send' }).click();
  await expect(frame.getByRole('log', { name: 'Conversation' })).toContainText(text);
}
