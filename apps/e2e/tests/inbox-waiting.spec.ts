/**
 * The waiting counter on an inbox row (IN-03 · tm 361).
 *
 * The unit suites pin the rule (`waitingEffect`), the thresholds and the clock
 * against mocks. What only a real browser and a real server prove together:
 * a player's message makes the row grow a counter whose start came from the
 * server's own column, an internal note does not end it, and the agent's reply
 * does — with the counter gone from the row the player was waiting on.
 */
import { expect, openWidget, test, visitorSends } from './fixtures.js';

test.describe('inbox waiting counter', () => {
  test('a player’s message starts the counter, a note leaves it, the agent’s reply ends it', async ({
    agentPage,
    browser,
    organizationId,
  }) => {
    await agentPage.goto('/app/inbox');

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    try {
      const question = `Where is my withdrawal? ${Date.now().toString().slice(-6)}`;
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, question);

      const list = agentPage.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(question, { timeout: 20_000 });
      // A row's preview is its newest event, so the row is found by whatever it
      // last said.
      const rowSaying = (text: string) => list.getByRole('button').filter({ hasText: text });
      const row = rowSaying(question);

      // Started by the player's message, counted from the server's timestamp.
      await expect(row.getByTestId('waiting-timer')).toBeVisible();
      await expect(row.getByTestId('waiting-timer')).toContainText('just now');

      // An internal note is not an answer: the counter is still there.
      const note = 'Finance is checking this one';
      await row.click();
      await agentPage.getByRole('radio', { name: 'Internal note' }).click();
      await agentPage.getByPlaceholder('Add a note for your team…').fill(note);
      await agentPage.getByRole('button', { name: 'Send' }).click();
      await expect(rowSaying(note)).toBeVisible({ timeout: 20_000 });
      await expect(rowSaying(note).getByTestId('waiting-timer')).toBeVisible();

      // The reply the player sees ends it, and a reload does not bring it back.
      // The row is asserted present first: an absence on a row that has not
      // rendered yet would pass for the wrong reason.
      const answer = 'Looking into it now.';
      await agentPage.getByRole('radio', { name: 'Reply' }).click();
      await agentPage.getByPlaceholder('Type your reply').fill(answer);
      await agentPage.getByRole('button', { name: 'Send' }).click();
      await expect(rowSaying(answer)).toBeVisible({ timeout: 20_000 });
      await expect(rowSaying(answer).getByTestId('waiting-timer')).toHaveCount(0);

      await agentPage.reload();
      await expect(rowSaying(answer)).toBeVisible({ timeout: 20_000 });
      await expect(rowSaying(answer).getByTestId('waiting-timer')).toHaveCount(0);
    } finally {
      await visitorContext.close();
    }
  });
});
