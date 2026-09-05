/**
 * The conversation list is ordered by last activity (FR-MOD-02.2.2 — «Tıklama
 * transcript açar; RTM'de yukarı taşınır + unread»).
 *
 * The integration suite proves the server's order and the web suite proves what
 * a push does to the cache. What only a real browser proves is that the two are
 * the same order: a visitor types into a conversation that has been pushed down
 * the list by newer arrivals, and the row climbs back to the top of the agent's
 * screen over a live socket, with nothing reloaded.
 *
 * Two visitors, in sequence, are what make the assertion mean anything. With one
 * conversation the list is trivially sorted; with the *first* visitor speaking
 * again, ordering by `created_at` — what this list did before — leaves the row
 * exactly where it was, so the test fails against the old behaviour rather than
 * passing for the wrong reason.
 */
import { expect, openWidget, test, visitorSends } from './fixtures.js';

test.describe('inbox list ordering', () => {
  test('a visitor who writes again climbs back to the top of the list', async ({
    agentPage,
    browser,
    organizationId,
  }) => {
    await agentPage.goto('/app/inbox');
    const list = agentPage.getByRole('region', { name: 'Conversations' });

    const stamp = Date.now().toString().slice(-6);
    const firstText = `First visitor ${stamp}`;
    const secondText = `Second visitor ${stamp}`;
    const followUp = `Still waiting ${stamp}`;

    const firstContext = await browser.newContext();
    const secondContext = await browser.newContext();
    try {
      const first = await firstContext.newPage();
      await openWidget(first, organizationId);
      await visitorSends(first, firstText);
      await expect(list).toContainText(firstText, { timeout: 20_000 });

      // The second visitor arrives after the first, so it takes the top and
      // pushes the first one down — true under either ordering, which is what
      // makes it a usable starting position.
      const second = await secondContext.newPage();
      await openWidget(second, organizationId);
      await visitorSends(second, secondText);
      await expect(list).toContainText(secondText, { timeout: 20_000 });
      await expect(list.getByRole('button').first()).toContainText(secondText);

      await agentPage.screenshot({
        path: 'kanit/02.2.2-liste-once.png',
        fullPage: true,
      });

      // The requirement: the first visitor speaks again and their row moves up.
      await visitorSends(first, followUp);

      const topRow = list.getByRole('button').first();
      await expect(topRow).toContainText(followUp, { timeout: 20_000 });
      // Unread is the same clause of the same criterion, and it is on the row
      // that just moved rather than on whichever row happens to be first.
      await expect(topRow.locator('[aria-label*="unread" i]')).toBeVisible();
      // Live: the climb happened over the socket, on a page that was never
      // reloaded and never navigated.
      expect(agentPage.url()).toContain('/app/inbox');

      await agentPage.screenshot({
        path: 'kanit/02.2.2-liste-sonra.png',
        fullPage: true,
      });
    } finally {
      await firstContext.close();
      await secondContext.close();
    }
  });
});
