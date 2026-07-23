/**
 * Shared fixtures.
 *
 * Everything here goes through the public API rather than the database. A test
 * helper that reaches into Postgres can pass while the API that real clients
 * use is broken — which is the entire failure mode this suite exists to catch.
 */
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
