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
 *
 * The second half (tm 213) walks the release surface `DELETE
 * /chats/{chatId}/supervise` — until this task the endpoint existed on the
 * contract and in the API but no client ever called it, so the only way to
 * stop watching a chat was for it to close. `Stop supervising` occupies the
 * same board row slot `Supervise chat` did (`rowActions.ts`), so the same
 * `waitForResponse` pattern applies to the DELETE.
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

      // Stop watching from the board — the row this task adds. Same
      // "in-flight request" caveat as the registration above applies.
      await agentPage.goto('/app/customers/real-time');
      const released = agentPage.waitForResponse(
        (response) =>
          /\/chats\/[^/]+\/supervise$/.test(response.url()) &&
          response.request().method() === 'DELETE',
      );
      await visitorRow.getByRole('button', { name: 'Stop supervising' }).click();
      expect((await released).status()).toBe(204);

      // The board's own row flips back to an offer to (re-)watch — the
      // caller's release does not need a reload to be reflected here, since
      // the click's own success invalidates the traffic query.
      await expect(visitorRow.getByRole('button', { name: 'Supervise chat' })).toBeVisible();

      // After: the conversation has left the Supervised bucket.
      await agentPage.goto('/app/inbox');
      await supervisedView.click();
      await expect(row).toHaveCount(0);
      await agentPage.screenshot({ path: 'kanit/02.1.1-inbox-unsupervised.png', fullPage: true });
    } finally {
      await visitorContext.close();
    }
  });
});
