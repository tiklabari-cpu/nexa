/**
 * An open panel outliving its access token (tm 259.1 · UX audit K1).
 *
 * Runs only under `playwright.session.config.ts` (`pnpm test:e2e:session`),
 * whose api mints access tokens that live a minute instead of an hour. The
 * audit measured the defect on exactly that setting: signed in, waited 75
 * seconds, switched the inbox view and opened Customers — every request 401,
 * "Could not load customers. Check that the API is reachable", and no way back
 * but a reload.
 *
 * Two ways a token runs out under an open panel, one test each: the panel is
 * awake and renews ahead of time, or the page slept through that moment and
 * wakes holding a token the server stopped accepting.
 */
import type { Page } from '@playwright/test';
import { expect, signIn, test } from './fixtures.js';
import { SESSION_TOKEN_TTL_S } from './session-stack.js';

/** Past the token's life, with room to spare — the audit's 75 seconds. */
const OUTLIVE_MS = (SESSION_TOKEN_TTL_S + 15) * 1000;

interface Traffic {
  /** `METHOD /path` of every API request the server refused with a 401. */
  refused: string[];
  /** Refresh-token grants — the renewals, not the sign-in's code exchange. */
  renewals: number;
}

/** Record every 401 the page received and every renewal it made. */
function watch(page: Page): Traffic {
  const traffic: Traffic = { refused: [], renewals: 0 };
  page.on('response', (response) => {
    const request = response.request();
    const url = new URL(response.url());
    if (!url.pathname.startsWith('/api/v1/')) return;
    if (url.pathname === '/api/v1/auth/token') {
      const grant = request.postDataJSON() as { grant_type?: string } | null;
      if (grant?.grant_type === 'refresh_token') traffic.renewals += 1;
      return;
    }
    if (response.status() === 401) traffic.refused.push(`${request.method()} ${url.pathname}`);
  });
  return traffic;
}

/** The inbox's connection badge says the socket is up (`inbox-panel.spec.ts` · `expectRealtimeLive`). */
async function expectLive(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: 'Inbox views' }).getByText('Live')).toBeVisible(
    {
      timeout: 20_000,
    },
  );
}

/** Customers, opened from the rail, showing its table rather than its error. */
async function openCustomers(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Customers' }).click();
  await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Customers' })).toBeVisible();
  await expect(page.getByText('Could not load customers')).toHaveCount(0);
}

test.describe(`a session longer than its access token (ACCESS_TOKEN_TTL=${SESSION_TOKEN_TTL_S})`, () => {
  test.setTimeout(180_000);

  test('an awake panel renews ahead of time, so nothing is refused (NFR-S2)', async ({ page }) => {
    const traffic = watch(page);
    await signIn(page);
    await expectLive(page);

    await page.waitForTimeout(OUTLIVE_MS);

    // The audit's steps, on a session older than its first token. A view row
    // is named with its count ("Queued 1"); a bare "Queued" is something else.
    const views = page.getByRole('navigation', { name: 'Inbox views' });
    const queued = views.getByRole('button', { name: /^Queued \d+$/ });
    await queued.click();
    await expect(queued).toHaveAttribute('aria-current', 'page');
    await openCustomers(page);
    await page.screenshot({ path: 'kanit/259-1-session-outlives-token.png' });

    expect(traffic.renewals).toBeGreaterThanOrEqual(1);
    expect(traffic.refused).toEqual([]);

    // Still the panel, with the socket it opened at sign-in.
    await page.getByRole('link', { name: 'Inbox' }).click();
    await expectLive(page);
  });

  test('a page that slept through its renewal recovers on the first refused request (NFR-S2)', async ({
    page,
  }) => {
    // Installed before the app loads, so its timers are the fake clock's.
    await page.clock.install();
    const traffic = watch(page);
    await signIn(page);
    await expectLive(page);

    // The lid closes: nothing in the page runs — not the renewal timer, not
    // the socket's ping — while the server's clock carries on past the token.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
    await page.waitForTimeout(OUTLIVE_MS);
    await page.clock.resume();

    // The first thing on waking, on a token the server stopped accepting.
    await openCustomers(page);
    await page.screenshot({ path: 'kanit/259-1-session-wakes-after-sleep.png' });

    // The path it took: refused, renewed once, repeated.
    expect(traffic.refused.length).toBeGreaterThan(0);
    expect(traffic.renewals).toBe(1);

    // The gateway dropped the idle socket during the sleep; it is back, logged
    // in with the renewed token rather than refused for good.
    await page.getByRole('link', { name: 'Inbox' }).click();
    await expectLive(page);
    await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
  });
});
