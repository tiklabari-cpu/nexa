/**
 * Who answers the conversation, in the inbox (AI-11 · tm 293.5): the
 * transcript header's badge, the agent taking the chat off the AI by writing
 * to the visitor, giving it back, and the badge following a change made
 * somewhere else — over the realtime push, without a reload.
 *
 * What the unit and integration suites cannot prove on their own: that the
 * badge is drawn from the chat the API serves, that the RTM gateway actually
 * forwards `chat_ai_mode_changed` to the open console, and that a chat given
 * back is answered by the AI again — in a real browser, against the real API,
 * gateway and AI job worker.
 */
import {
  API_BASE,
  expect,
  openWidget,
  ownerAccessToken,
  tenantSubdomain,
  test,
  visitorSends,
  widgetFrame,
} from './fixtures.js';

test.describe('AI mode in the inbox (AI-11)', () => {
  test('the agent takes the chat off the AI by writing, gives it back, and the badge follows each change live', async ({
    agentPage,
    browser,
    organizationId,
    request,
  }) => {
    test.setTimeout(180_000);

    const run = Date.now().toString().slice(-6);
    const marker = `handback${run}`;
    const passage =
      `Standard ${marker} delivery takes 3 to 5 working days. ` +
      `Tracking for a ${marker} order is emailed the moment it dispatches.`;

    // --- A knowledge source only this run's questions can match --------------
    await agentPage.goto('/app/playbook?view=skills');
    const tabs = agentPage.getByRole('tablist', { name: 'AI Agent' });
    await tabs.getByRole('tab', { name: 'Knowledge' }).click();
    await agentPage.getByLabel('Title').fill(`AI mode proof ${run}`);
    await agentPage.getByLabel('Content').fill(passage);
    await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith('/knowledge-sources'),
      ),
      agentPage.getByRole('button', { name: 'Add source' }).click(),
    ]);

    const context = await browser.newContext();
    try {
      const visitor = await context.newPage();
      await openWidget(visitor, organizationId, { host: tenantSubdomain(`ai-mode-${run}`).origin });
      const replies = widgetFrame(visitor).locator('.nx-row--bot .nx-bubble');
      const agentLines = widgetFrame(visitor).locator('.nx-row--agent .nx-bubble');

      // --- The AI answers the visitor's first question --------------------------
      const opened = visitor.waitForResponse(
        (response) =>
          response.url().includes('/customer/chat/events') &&
          response.request().method() === 'POST' &&
          response.ok(),
      );
      await visitorSends(visitor, `How long does ${marker} delivery take?`);
      const { chat_id: chatId } = (await (await opened).json()) as { chat_id: string };
      await expect(replies).toHaveCount(1, { timeout: 30_000 });
      await expect(replies.last()).toContainText(marker);

      // --- The console: the AI has it ----------------------------------------------
      await agentPage.goto(`/app/inbox?chat=${chatId}`);
      const badge = agentPage.locator('[data-ai-mode]');
      await expect(badge).toHaveAttribute('data-ai-mode', 'ai', { timeout: 20_000 });
      await expect(badge).toContainText('AI answering');

      // --- Writing to the visitor takes it over (AI-11-S2) ------------------------
      const reply = `A person here, checking your ${marker} order ${run}`;
      await agentPage.locator('#composer-input').fill(reply);
      await agentPage.getByRole('button', { name: 'Send' }).click();
      await expect(agentLines.last()).toContainText(reply, { timeout: 20_000 });
      await expect(badge).toHaveAttribute('data-ai-mode', 'human');
      await expect(badge).toContainText('With a person');

      // The AI stays silent on the visitor's next message.
      await visitorSends(visitor, `Is a ${marker} order tracked?`);
      await visitor.waitForTimeout(4_000);
      await expect(replies).toHaveCount(1);

      // --- Given back: the AI answers again -----------------------------------------
      await agentPage.getByRole('button', { name: 'Return to AI' }).click();
      const dialog = agentPage.getByRole('dialog', { name: 'Return this chat to the AI?' });
      await dialog.getByLabel('Note for the AI (optional)').fill('Tracking question answered.');
      await Promise.all([
        agentPage.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            response.url().endsWith(`/chats/${chatId}/return-to-ai`) &&
            response.ok(),
        ),
        dialog.getByRole('button', { name: 'Return to AI' }).click(),
      ]);
      await expect(dialog).toHaveCount(0);
      await expect(badge).toHaveAttribute('data-ai-mode', 'ai');

      await visitorSends(visitor, `How many working days does ${marker} delivery take?`);
      await expect(replies).toHaveCount(2, { timeout: 30_000 });
      await expect(replies.last()).toContainText(marker);

      // --- A change made elsewhere arrives over the push, no reload -----------------
      const token = await ownerAccessToken(request);
      const paused = await request.post(`${API_BASE}/chats/${chatId}/pause-ai`, {
        headers: { authorization: `Bearer ${token}` },
        data: { note: 'Held back from another console' },
      });
      expect(paused.ok(), `pause-ai: ${paused.status()} ${await paused.text()}`).toBe(true);
      await expect(badge).toHaveAttribute('data-ai-mode', 'paused', { timeout: 10_000 });
      await expect(badge).toContainText('AI paused');

      await agentPage.screenshot({ path: 'kanit/ai-11-mode-badge.png' });
    } finally {
      await context.close();
    }
  });
});
