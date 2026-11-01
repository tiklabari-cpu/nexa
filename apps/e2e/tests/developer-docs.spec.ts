/**
 * The public API documentation, as a stranger meets it (KN-04 · tm 376).
 *
 * `/developers/docs/` is the one page of the panel's build that needs no sign-in:
 * an operator's developer opens it before they have an account on the workspace.
 * The unit tests hold the viewer's logic and the contract package holds what is
 * published; what only a browser can show is that the page boots from its external
 * module with nothing inline, that nothing logs an error, that a signed-out visitor
 * can search it, and that it is readable by the machine measure the rest of the app
 * is held to. (This stack serves the page from the dev server, which sends no
 * Content-Security-Policy; the policy itself is held by `nginx-security.test.ts`
 * and was exercised against the built page in a browser — tm 376.)
 */
import { scanScreen, assertNoBlockingViolations } from './a11y.js';
import { expect, test } from './fixtures.js';

const DOCS = '/developers/docs/';

test('the API documentation opens without signing in, can be searched and passes the accessibility scan', async ({
  page,
}, testInfo) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

  await page.goto(DOCS);
  await expect(page.getByRole('heading', { level: 1, name: 'SiyahTuş API' })).toBeVisible();
  // Not the panel: no sign-in redirect, no shell.
  await expect(page).toHaveURL(/\/developers\/docs\/$/);
  await expect(page.getByRole('navigation', { name: 'API reference' })).toBeVisible();
  assertNoBlockingViolations(await scanScreen(page, 'API documentation home', testInfo));

  // Search narrows the list, and a result opens its operation.
  await page.getByRole('searchbox', { name: 'Search the API' }).fill('transfer chat');
  await expect(
    page.getByRole('heading', { level: 2, name: /Search: transfer chat/ }),
  ).toBeVisible();
  await page.locator('.search-results a').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.signature')).toContainText('/chats/{chatId}/transfer');
  await expect(page.locator('pre[data-lang="bash"]')).toContainText('curl -X POST');
  assertNoBlockingViolations(await scanScreen(page, 'API documentation operation', testInfo));

  // An internal operation is not findable: the search says so rather than showing it.
  await page.getByRole('link', { name: /SiyahTuş API/ }).click();
  await page.getByRole('searchbox', { name: 'Search the API' }).fill('impersonation');
  await expect(page.getByText('No operation matches.')).toBeVisible();

  // The webhook guide carries the signature scheme the API actually signs with.
  await page.getByRole('searchbox', { name: 'Search the API' }).fill('');
  await page.goto(`${DOCS}#/guide/webhooks`);
  await expect(page.getByRole('heading', { level: 1, name: 'Webhook signatures' })).toBeVisible();
  await expect(page.locator('code[data-lang="text"]')).toContainText(
    'HMAC-SHA256(secret, "{timestamp}.{nonce}.{body}")',
  );
  assertNoBlockingViolations(await scanScreen(page, 'API documentation guide', testInfo));

  expect(problems, 'the page must run without console errors or CSP violations').toEqual([]);
});

test('the address without its trailing slash reaches the page, never the panel shell', async ({
  page,
}) => {
  await page.goto('/developers/docs');
  await expect(page.getByRole('heading', { level: 1, name: 'SiyahTuş API' })).toBeVisible();
  expect(new URL(page.url()).pathname).toMatch(/^\/developers\/docs\/?$/);
});
