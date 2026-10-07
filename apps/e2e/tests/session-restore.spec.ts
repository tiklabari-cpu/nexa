/**
 * Surviving a reload.
 *
 * The access token lives in memory, so every full page load spends the stored
 * refresh token to get a new one. That token is single-use: the server rotates
 * it and treats a second presentation as a stolen credential, revoking the
 * whole family — including the access token the successful rotation just
 * minted. So "how many times does one reload refresh?" is not a performance
 * question, it is whether the agent is still signed in afterwards.
 *
 * This is the shape of the defect tm 249 measured in a full-suite run:
 * `POST /auth/token` 200, then `GET /auth/me` 401, then `POST /auth/token` 401,
 * and the sign-in form. `App` restores from an effect, StrictMode mounts every
 * effect twice in development, and both calls read the same token out of
 * `localStorage`. Two requests answered 200 only while neither rotation had
 * committed before the other read — which is why the same file passed in
 * isolation and dropped its session in a long run.
 *
 * A count is asserted rather than "the page still works" because the failure is
 * a race: the app stays signed in whenever the two requests happen to overlap,
 * so a survival check alone would be green on the broken build most of the time.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { API_BASE, expect, signIn, test } from './fixtures.js';

/** Count the refreshes a block of work causes, and hand back the total. */
async function refreshesDuring(page: Page, run: () => Promise<void>): Promise<number> {
  let refreshes = 0;
  const count = (request: { method: () => string; url: () => string }) => {
    if (request.method() === 'POST' && request.url().includes('/api/v1/auth/token')) refreshes += 1;
  };
  page.on('request', count);
  try {
    await run();
  } finally {
    page.off('request', count);
  }
  return refreshes;
}

test.describe('session restore', () => {
  test('a reload spends the stored refresh token exactly once, and again on the next one', async ({
    agentPage,
  }) => {
    const first = await refreshesDuring(agentPage, async () => {
      await agentPage.goto('/app/settings/personal-access-tokens');
      // The same region tm 249's red could not find, because the reload had
      // landed on the sign-in form instead.
      await expect(agentPage.getByRole('region', { name: 'Personal access tokens' })).toBeVisible();
    });
    expect(first).toBe(1);

    // The successor has to have been kept, or the session survives exactly one
    // reload — a bug that would hide behind the assertion above.
    const second = await refreshesDuring(agentPage, async () => {
      await agentPage.goto('/app/inbox');
      await expect(agentPage.getByRole('link', { name: 'Inbox' })).toBeVisible();
    });
    expect(second).toBe(1);
  });
});

/** What the server saw of the refresh-token grants {@link sequenceRenewals} let through. */
interface Renewals {
  /** The refresh token each grant presented, in the order they reached the server. */
  presented: string[];
  /** The server's answer to each, in the same order. */
  statuses: number[];
}

/**
 * Hold the first refresh-token grant until a second one arrives (or two
 * seconds pass), then let them reach the server one after the other.
 *
 * Without the cross-tab lock, two tabs renewing together both read the same
 * stored token and both send it within that window. Sent at the same instant,
 * the server can still answer both 200 — neither rotation has committed when
 * the other reads, which is exactly why tm 249's red came and went. Sequenced,
 * the second presentation meets a rotated token and the server's reuse
 * detection decides, every time. With the lock the second grant is not sent
 * until the first has been answered, so nothing changes but two seconds.
 */
async function sequenceRenewals(context: BrowserContext): Promise<Renewals> {
  const renewals: Renewals = { presented: [], statuses: [] };
  let waiting: Array<() => void> = [];
  let queue: Promise<unknown> = Promise.resolve();

  await context.route('**/api/v1/auth/token', async (route) => {
    const grant = route.request().postDataJSON() as {
      grant_type?: string;
      refresh_token?: string;
    } | null;
    if (grant?.grant_type !== 'refresh_token') return route.continue();

    await new Promise<void>((release) => {
      waiting.push(release);
      if (waiting.length >= 2) {
        for (const go of waiting.splice(0)) go();
        return;
      }
      setTimeout(() => {
        waiting = waiting.filter((go) => go !== release);
        release();
      }, 2_000);
    });

    const turn = queue.then(async () => {
      renewals.presented.push(grant.refresh_token ?? '');
      const response = await route.fetch();
      renewals.statuses.push(response.status());
      await route.fulfill({ response });
    });
    // A tab that navigates away mid-grant takes its request with it; that is
    // the tab's business, not a failure of this test's plumbing.
    queue = turn.catch(() => undefined);
    await queue;
  });
  return renewals;
}

/**
 * Customers loads its table — what a family revoked under the tab would turn
 * into a sign-in form. Reached through the rail rather than a reload, which
 * would restore (and so renew) once more on its own.
 */
async function stillSignedIn(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Customers' }).click();
  await expect(page.getByRole('table', { name: 'Customers' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
}

/**
 * Two tabs of one browser share the one stored refresh token (tm 259.1).
 *
 * Each tab has its own copy of the store, so the single-flight above covers a
 * tab against itself and nothing more. Two tabs spending the token together is
 * a replay as far as the server can tell, and its answer — revoke the family —
 * signs out both. The panel takes a Web Lock across tabs before spending it;
 * these tests break exactly when that lock is missing (measured by removing it).
 */
test.describe('two tabs, one refresh token (tm 259.1)', () => {
  test('two tabs reloading together spend the stored token one after the other (NFR-S2)', async ({
    agentPage,
    context,
  }) => {
    const second = await context.newPage();
    await second.goto('/app/inbox');
    await expect(second.getByRole('link', { name: 'Inbox' })).toBeVisible();

    const renewals = await sequenceRenewals(context);
    await Promise.all([agentPage.reload(), second.reload()]);
    for (const page of [agentPage, second]) {
      await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible({ timeout: 20_000 });
    }

    expect(renewals.statuses).toEqual([200, 200]);
    expect(new Set(renewals.presented).size).toBe(2);
    await stillSignedIn(agentPage);
    await stillSignedIn(second);
  });

  test('two tabs whose renewals fall due together still spend it one at a time (NFR-S2)', async ({
    page,
    context,
  }) => {
    // Before anything loads, so both tabs' renewal timers run on this clock.
    await context.clock.install();
    await signIn(page);
    const second = await context.newPage();
    await second.goto('/app/inbox');
    await expect(second.getByRole('link', { name: 'Inbox' })).toBeVisible();

    const renewals = await sequenceRenewals(context);
    // Fifty minutes with the lid shut: both tabs' renewals — due between 70%
    // and 80% of the hour — fire on waking, together.
    await context.clock.fastForward('50:00');
    await expect.poll(() => renewals.statuses.length, { timeout: 15_000 }).toBeGreaterThan(0);

    await stillSignedIn(page);
    await stillSignedIn(second);
    expect(renewals.statuses.every((status) => status === 200)).toBe(true);
    expect(new Set(renewals.presented).size).toBe(renewals.presented.length);
  });

  test('a renewal the server refuses lands on the sign-in page, which says why', async ({
    agentPage,
    request,
  }) => {
    await expect(agentPage.getByRole('navigation', { name: 'Inbox views' })).toBeVisible();

    // Signed out from somewhere else: the stored token's family is revoked,
    // and the access token in this tab with it.
    const stored = await agentPage.evaluate(() => localStorage.getItem('siyahtus.refresh_token'));
    expect(stored).toBeTruthy();
    const revoked = await request.post(`${API_BASE}/auth/revoke`, { data: { token: stored } });
    expect(revoked.ok()).toBe(true);

    // The next screen's first request is refused, its renewal too.
    await agentPage.getByRole('link', { name: 'Customers' }).click();

    await expect(agentPage.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(
      agentPage.getByRole('status').filter({ hasText: 'Your session has ended.' }),
    ).toHaveText('Your session has ended. Sign in again to continue.');
    expect(
      await agentPage.evaluate(() => localStorage.getItem('siyahtus.refresh_token')),
    ).toBeNull();
    await agentPage.screenshot({ path: 'kanit/259-1-session-ended-notice.png' });
  });
});
