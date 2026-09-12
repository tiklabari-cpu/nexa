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
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

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
      await agentPage.goto('/app/settings');
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
