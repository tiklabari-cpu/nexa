/**
 * Copilot summary on an archived conversation (FR-MOD-02.8).
 *
 * `copilot.test.ts` already pins the API: an archived chat's summary comes
 * back without a `note_event_id` and writes nothing to the transcript. What a
 * real browser proves is the surface the PRD actually names — the panel opens
 * from an archived conversation, the summary button works there while Reply/
 * Enhance stay disabled, and the result renders with the read-only notice
 * rather than the "added as a note" copy that only applies to an active chat.
 *
 * The conversation is created and archived by the test itself, the same
 * reasoning `inbox-reopen.spec.ts` gives for not picking a seeded archived
 * chat by inspection.
 */
import { expect, openWidget, test, visitorSends } from './fixtures.js';

test.describe('copilot summary on an archived conversation', () => {
  // Same accommodation copilot.spec.ts makes: the transcript header's
  // right-side actions (Copy link, Create ticket, Copilot) slide under the
  // details panel at the default width.
  test.use({ viewport: { width: 1680, height: 1050 } });

  test('summarises after archiving, without claiming a note was added (FR-MOD-02.8)', async ({
    agentPage,
    browser,
    organizationId,
  }) => {
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();

    try {
      const question = `Archived summary check — ${Date.now().toString().slice(-6)}`;
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, question);

      const list = agentPage.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(question, { timeout: 20_000 });
      await list.getByRole('button').filter({ hasText: question }).click();
      await expect(agentPage.locator('main')).toContainText(question);

      const details = agentPage.getByRole('complementary', { name: 'Conversation details' });
      const archived = agentPage.waitForResponse(
        (response) =>
          /\/chats\/[^/]+\/deactivate$/.test(response.url()) &&
          response.request().method() === 'POST',
      );
      await details.getByRole('button', { name: 'Archive conversation' }).click();
      expect((await archived).status()).toBe(200);

      // Copilot opens for a closed conversation exactly like an open one.
      await agentPage.getByRole('button', { name: 'Copilot' }).click();
      const copilot = agentPage.getByRole('complementary', { name: 'Copilot' });
      await expect(copilot).toBeVisible();
      await expect(
        copilot.getByText('Reopen the conversation to draft or send a reply.'),
      ).toBeVisible();

      // Reply/Enhance are dead ends on a closed conversation — Summary is not.
      await expect(copilot.getByRole('button', { name: 'Draft a reply' })).toBeDisabled();
      await expect(copilot.getByRole('button', { name: 'Rephrase' })).toBeDisabled();
      const summaryButton = copilot.getByRole('button', { name: 'Summarise conversation' });
      await expect(summaryButton).toBeEnabled();

      const summarised = agentPage.waitForResponse(
        (response) =>
          /\/copilot\/chats\/[^/]+\/summary$/.test(response.url()) &&
          response.request().method() === 'POST',
      );
      await summaryButton.click();
      expect((await summarised).status()).toBe(201);

      await expect(copilot.getByText(question)).toBeVisible();
      await expect(
        copilot.getByText('Not saved as a note — the archive is read-only.'),
      ).toBeVisible();
      await expect(copilot.getByText('Added as an internal note.')).toBeHidden();

      await agentPage.screenshot({ path: 'kanit/02.8-archive-summary.png', fullPage: true });
    } finally {
      await visitorContext.close();
    }
  });
});
