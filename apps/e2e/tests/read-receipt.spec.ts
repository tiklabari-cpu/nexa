/**
 * "Read · time" under the agent's last message (IN-05 · tm 362).
 *
 * The unit suites pin the pieces — the widget's timer and visibility checks
 * against a fake `fetch`, the marker's forward-only rule against a database, the
 * transcript's placement of the line against fixtures. What only a real browser
 * and a real server prove together: a player who has the panel open and a reply
 * in front of them makes the agent's screen say "Read" within moments, under
 * that reply and under nothing else — and a reply that lands while the panel is
 * shut is *not* marked read.
 */
import { expect, openWidget, test, visitorSends, widgetFrame } from './fixtures.js';

test.describe('read receipt', () => {
  test('the open panel marks the reply read; a note gets nothing; a reply into a shut panel stays unread', async ({
    agentPage,
    browser,
    organizationId,
  }) => {
    test.slow();
    await agentPage.goto('/app/inbox');

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    try {
      const stamp = Date.now().toString().slice(-6);
      const question = `Has my KYC been approved? ${stamp}`;
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, question);

      const list = agentPage.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(question, { timeout: 20_000 });
      await list.getByRole('button').filter({ hasText: question }).click();
      await expect(agentPage.locator('main')).toContainText(question);

      // Nothing has been answered yet, so nothing can have been read.
      await expect(agentPage.getByTestId('read-receipt')).toHaveCount(0);

      // --- A reply into an open panel ----------------------------------------
      const reply = `Yes, it went through this morning. ${stamp}`;
      await agentPage.getByRole('radio', { name: 'Reply' }).click();
      await agentPage.getByPlaceholder('Type your reply').fill(reply);
      await agentPage.getByRole('button', { name: 'Send' }).click();
      await expect(widgetFrame(visitor).getByRole('log', { name: 'Conversation' })).toContainText(
        reply,
        { timeout: 20_000 },
      );

      // The widget waits a second, then reports; the agent's screen is patched by
      // the push, not a refetch.
      const receipt = agentPage.getByTestId('read-receipt');
      await expect(receipt).toHaveCount(1, { timeout: 20_000 });
      await expect(receipt).toContainText(/^Read · \d/);
      await expect(receipt.locator('xpath=preceding-sibling::*[1]')).toContainText(reply);

      // --- An internal note is never "read" ----------------------------------
      const note = `Checked with compliance ${stamp}`;
      await agentPage.getByRole('radio', { name: 'Internal note' }).click();
      await agentPage.getByPlaceholder('Add a note for your team…').fill(note);
      await agentPage.getByRole('button', { name: 'Send' }).click();
      await expect(agentPage.locator('main')).toContainText(note, { timeout: 20_000 });
      await expect(receipt).toHaveCount(1);
      await expect(receipt.locator('xpath=preceding-sibling::*[1]')).toContainText(reply);

      // --- A reply that lands while the panel is shut ------------------------
      await widgetFrame(visitor).locator('.nx-launcher').click();
      await expect(widgetFrame(visitor).locator('.nx-panel')).toBeHidden();

      const missed = `One more thing: keep your ID handy. ${stamp}`;
      await agentPage.getByRole('radio', { name: 'Reply' }).click();
      await agentPage.getByPlaceholder('Type your reply').fill(missed);
      await agentPage.getByRole('button', { name: 'Send' }).click();
      await expect(agentPage.locator('main')).toContainText(missed, { timeout: 20_000 });

      // Long enough for a poll and for the widget's own second to have passed —
      // the line must still be where it was, under the reply the player saw.
      await agentPage.waitForTimeout(6_000);
      await expect(receipt).toHaveCount(1);
      await expect(receipt.locator('xpath=preceding-sibling::*[1]')).toContainText(reply);
    } finally {
      await visitorContext.close();
    }
  });
});
