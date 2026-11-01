/**
 * No personal data in an address (GV-05 · tm 386).
 *
 * The static half is `scripts/audit/url-pii.mjs` in CI, and the server half
 * (the log mask, a visited page's query) is pinned in the api suites. What only
 * a real browser shows: what the panel's referrer policy actually sends a site
 * an operator clicks through to, and that a search by somebody's e-mail leaves
 * nothing behind in the address bar or in the tab's history.
 *
 * The outside site is a `page.route` stub — no request leaves the machine.
 */
import { ACME_OWNER, expect, PAGING_OWNER, signInAs, test } from './fixtures.js';

const OUTSIDE = 'https://outside.example.test/landing';
const EMAIL = 'jane.roe@example.test';

test.describe('no personal data in an address (GV-05)', () => {
  test('a link out of the panel sends the origin only as the Referer', async ({ page }) => {
    await signInAs(page, ACME_OWNER.email, ACME_OWNER.password);
    // A page whose own address has a path worth hiding.
    await page.goto('/app/customers?segment=leads');
    await expect(page.getByRole('searchbox', { name: 'Search customers' })).toBeVisible();
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
      'content',
      'strict-origin-when-cross-origin',
    );

    const panelOrigin = new URL(page.url()).origin;
    let referer: string | undefined;
    await page.route(`${OUTSIDE}**`, async (route) => {
      referer = route.request().headers()['referer'];
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>outside</p>' });
    });
    // Stands in for any third-party link a screen renders (a docs page, an app's site).
    await page.evaluate((href) => {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = 'Outside site';
      a.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;background:#fff';
      document.body.append(a);
    }, OUTSIDE);
    await page.getByRole('link', { name: 'Outside site' }).click();
    await page.waitForURL(OUTSIDE);

    // The origin and nothing after it: not `/app/customers`, not a query.
    expect(referer).toBe(`${panelOrigin}/`);
  });

  test('a search by e-mail, in the Archive and in Customers, stays out of the address and the history', async ({
    page,
  }) => {
    await signInAs(page, PAGING_OWNER.email, PAGING_OWNER.password);
    await page.goto('/app/inbox');
    await expect(page.getByRole('region', { name: 'Conversations' })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Inbox views' })
      .getByRole('button', { name: /Archive/ })
      .click();
    const search = page.getByRole('search', { name: 'Search archived messages' });
    await expect(search).toBeVisible();

    const historyBefore = await page.evaluate(() => window.history.length);
    const asked = page.waitForResponse(
      (response) => response.url().includes('/chats?') && response.url().includes('query='),
    );
    await search.getByRole('searchbox', { name: 'Search message text' }).fill(EMAIL);
    await search.getByRole('button', { name: 'Search' }).click();
    expect((await asked).status()).toBeLessThan(500);

    const encoded = encodeURIComponent(EMAIL);
    expect(page.url()).not.toContain(EMAIL);
    expect(page.url()).not.toContain(encoded);
    expect(page.url()).not.toContain('query');
    // Nothing was pushed: the search is component state, not a history entry.
    expect(await page.evaluate(() => window.history.length)).toBe(historyBefore);

    await page.goto('/app/customers');
    const box = page.getByRole('searchbox', { name: 'Search customers' });
    await expect(box).toBeVisible();
    const customersBefore = await page.evaluate(() => window.history.length);
    const listed = page.waitForResponse(
      (response) => response.url().includes('/customers?') && response.url().includes('query='),
    );
    await box.fill(EMAIL);
    expect((await listed).status()).toBe(200);
    expect(page.url()).not.toContain(EMAIL);
    expect(page.url()).not.toContain(encoded);
    expect(page.url()).not.toContain('query');
    expect(await page.evaluate(() => window.history.length)).toBe(customersBefore);
  });
});
