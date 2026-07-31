/**
 * Real-time traffic — the live-visitor board (FR-MOD-03.1.3).
 *
 * The integration suite proves the API resolves who each visitor is chatting
 * with and isolates tenants. What only a browser shows is that a visitor who
 * writes in actually surfaces on the board, reachable through the Customers
 * sub-nav, with the row actions an agent acts on.
 */
import { expect, test, openWidget, visitorSends } from './fixtures.js';

test.describe('real-time traffic', () => {
  test('surfaces a live visitor with row actions, reached via the Real-time tab', async ({
    browser,
    agentPage,
    organizationId,
  }) => {
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();

    try {
      // A visitor writes in — now they are on the site, mid-conversation.
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, `Live traffic ${Date.now().toString().slice(-6)}`);

      // Reach the board through the Customers sub-nav, not a bookmarked URL.
      await agentPage.goto('/app/customers');
      await agentPage.getByRole('link', { name: 'Real-time' }).click();
      await expect(agentPage).toHaveURL(/\/app\/customers\/real-time$/);

      const table = agentPage.getByRole('table', { name: 'Live visitors' });
      await expect(table).toBeVisible();
      await expect(table.getByRole('columnheader', { name: 'Chatting with' })).toBeVisible();

      // The anonymous visitor who just wrote in is on the board with the
      // conversation actions available on their row.
      const row = table.getByRole('row').filter({ hasText: 'Unnamed visitor' }).first();
      await expect(row).toBeVisible();
      await expect(row.getByRole('button', { name: 'Supervise chat' })).toBeVisible();
      await expect(row.getByRole('button', { name: 'Assign chat to me' })).toBeVisible();

      await agentPage.screenshot({ path: 'kanit/03-traffic-board.png', fullPage: true });
    } finally {
      await visitorContext.close();
    }
  });
});
