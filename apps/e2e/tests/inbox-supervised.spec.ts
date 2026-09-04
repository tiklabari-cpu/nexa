/**
 * The inbox's Supervised bucket (FR-MOD-02.1.1).
 *
 * The integration suite proves the server keys the view by the watcher and
 * hides the other tenant's rows; the web suite proves the rail item exists and
 * narrows the list through the server. Neither of them crosses the seam this
 * item is really about: `Supervise chat` is a Traffic board action, and the
 * conversation it registers has to turn up in a completely different module's
 * list. That hand-off — one table, two surfaces — only a browser can walk.
 *
 * Waiting on the POST rather than on a redraw is deliberate: the board fires
 * the registration and navigates away in the same click (`TrafficPage.tsx`, so
 * that opening the transcript is not held up by it), which makes "the row is in
 * my Supervised list" a claim about a request that may still be in flight.
 */
import { expect, test, openWidget, visitorSends } from './fixtures.js';

test.describe('the inbox Supervised view', () => {
  test('a conversation watched from Traffic turns up in the Supervised list', async ({
    browser,
    agentPage,
    organizationId,
  }) => {
    const stamp = Date.now().toString().slice(-6);
    const message = `Supervised sweep ${stamp}`;

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();

    try {
      // A real visitor writes in, so there is a live conversation to watch —
      // and its text is what identifies the row further down, since an
      // anonymous visitor's rows all carry the same name.
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, message);

      const rail = agentPage.getByRole('navigation', { name: 'Inbox views' });
      const supervisedView = rail.getByRole('button', { name: /^Supervised/ });
      const list = agentPage.getByRole('region', { name: 'Conversations' });
      const row = list.getByRole('button').filter({ hasText: message });

      // Before: the bucket exists in the rail and this conversation is not in
      // it. The seeded database is shared, so the assertion is about *this*
      // conversation rather than about the list being empty.
      await agentPage.goto('/app/inbox');
      await expect(supervisedView).toBeVisible();
      await supervisedView.click();
      await expect(agentPage.getByRole('heading', { level: 2, name: 'Supervised' })).toBeVisible();
      await expect(row).toHaveCount(0);

      // Watch it from the board.
      await agentPage.goto('/app/customers/real-time');
      const board = agentPage.getByRole('table', { name: 'Live visitors' });
      const visitorRow = board.getByRole('row').filter({ hasText: 'Unnamed visitor' }).first();
      await expect(visitorRow).toBeVisible();

      const registered = agentPage.waitForResponse(
        (response) =>
          /\/chats\/[^/]+\/supervise$/.test(response.url()) &&
          response.request().method() === 'POST',
      );
      await visitorRow.getByRole('button', { name: 'Supervise chat' }).click();
      expect((await registered).status()).toBe(200);
      await expect(agentPage).toHaveURL(/\/app\/inbox/);

      // After: the same conversation is in the bucket. Reloaded rather than
      // asserted on the list the click landed on — the registration and the
      // navigation raced, and a reload is the honest way to read the state the
      // server now holds.
      await agentPage.goto('/app/inbox');
      await supervisedView.click();
      await expect(row).toHaveCount(1);
      await agentPage.screenshot({ path: 'kanit/02.1.1-inbox-supervised.png', fullPage: true });
    } finally {
      await visitorContext.close();
    }
  });
});
