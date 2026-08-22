/**
 * Read receipt / unread badge (FR-MOD-02.2.2).
 *
 * The web unit suite (`useMarkSeen.test.tsx`) pins the debounce and switch-flush
 * logic against a mocked API client. What only a real browser proves is the
 * whole chain: a genuine `unread_count` computed server-side, a real
 * `POST /chats/{chatId}/seen` clearing it, and — the point of storing the
 * marker on the server instead of locally — the badge staying cleared after a
 * hard reload rather than reappearing from a client-only guess.
 */
import { expect, openWidget, test, visitorSends } from './fixtures.js';

test.describe('inbox unread badge', () => {
  test('opening a conversation clears its unread badge, and a reload does not bring it back', async ({
    agentPage,
    browser,
    organizationId,
  }) => {
    await agentPage.goto('/app/inbox');

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    try {
      const question = `Has anyone read this yet? ${Date.now().toString().slice(-6)}`;
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, question);

      const list = agentPage.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(question, { timeout: 20_000 });
      const row = list.getByRole('button').filter({ hasText: question });

      // Server truth: a message nobody has opened yet is unread.
      await expect(row.locator('[aria-label*="unread" i]')).toBeVisible();

      await row.click();
      await expect(agentPage.getByPlaceholder('Type your reply')).toBeVisible();
      await expect(row.locator('[aria-label*="unread" i]')).toBeHidden();

      // `useMarkSeen` debounces 1s before it calls POST /chats/{chatId}/seen —
      // give it a moment past that so the reload below reads a marker the
      // server actually recorded, not a request still in flight.
      await agentPage.waitForTimeout(1_500);
      await agentPage.reload();

      await expect(list).toContainText(question, { timeout: 20_000 });
      const rowAfterReload = list.getByRole('button').filter({ hasText: question });
      // The badge derives from `unread_count`, which the server now serves as
      // 0 — not from anything the client remembered locally across the reload.
      await expect(rowAfterReload.locator('[aria-label*="unread" i]')).toHaveCount(0);

      await agentPage.screenshot({ path: 'kanit/136.3-okundu-sonrasi-yenile.png', fullPage: true });
    } finally {
      await visitorContext.close();
    }
  });
});
