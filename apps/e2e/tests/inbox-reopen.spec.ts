/**
 * Reopening an archived conversation from the Details panel (FR-MOD-02.6).
 *
 * `chat-service.ts#resume` (a new thread + a `chat_resumed` system event, the
 * one-active-chat rule preserved) already has integration coverage. What was
 * untested is the UI path the PRD's acceptance criterion actually names:
 * pressing Reopen in the console has to put the reopened line in the
 * transcript and hand the composer back — an archived chat replaces it with a
 * plain notice, and only a real browser proves the notice is gone and a
 * message can actually be typed and sent again, not just that a prop flipped.
 *
 * The conversation is created and archived by the test itself rather than
 * relying on a seeded archived chat — the shared `nexa` database has several,
 * and picking the "right" one by inspection is more fragile than making one.
 */
import { expect, openWidget, test, visitorSends } from './fixtures.js';

test('Reopen shows the reopened event and lets the agent write again (FR-MOD-02.6)', async ({
  agentPage,
  browser,
  organizationId,
}) => {
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();

  try {
    const question = `Order stuck in customs — ${Date.now().toString().slice(-6)}`;
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

    // Archived: the composer is a plain notice, and the panel offers Reopen
    // in place of Archive.
    await expect(
      agentPage.getByText('This conversation is archived. Reopen it to reply.'),
    ).toBeVisible();
    const reopenButton = details.getByRole('button', { name: 'Reopen conversation' });
    await expect(reopenButton).toBeVisible();

    const resumed = agentPage.waitForResponse(
      (response) =>
        /\/chats\/[^/]+\/resume$/.test(response.url()) && response.request().method() === 'POST',
    );
    await reopenButton.click();
    expect((await resumed).status()).toBe(200);

    const transcript = agentPage.getByRole('log', { name: 'Conversation transcript' });
    await expect(transcript).toContainText('Chat reopened');
    await expect(
      agentPage.getByText('This conversation is archived. Reopen it to reply.'),
    ).toBeHidden();
    await agentPage.screenshot({ path: 'kanit/02.6-reopen.png', fullPage: true });

    // The composer is not just present — it works. This is the second half
    // of "yeniden yazılabilir": able to accept text, and able to send it. (The
    // widget's own recovery from its "chat ended" state is FR-MOD-11.4-b's
    // concern, not this one, so the proof stays on the agent's own screen.)
    const reply = `Good news, it cleared customs — ${Date.now().toString().slice(-6)}`;
    await agentPage.getByPlaceholder('Type your reply').fill(reply);
    await agentPage.getByRole('button', { name: 'Send' }).click();
    await expect(transcript).toContainText(reply);
  } finally {
    await visitorContext.close();
  }
});
