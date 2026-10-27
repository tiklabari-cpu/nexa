/**
 * The AI says what it is, and "Talk to an agent" (tm 308 · SiyahTuş analysis
 * AI-29 · G16), in a real browser against the real API, gateway and AI job
 * worker: the AI's first reply opens with the disclosure, the widget shows
 * the button while the AI answers, a press hands the conversation to a
 * person at once — the agent sees it in the inbox with why — the button goes
 * and the AI says nothing more.
 */
import {
  expect,
  openWidget,
  tenantSubdomain,
  test,
  visitorSends,
  widgetFrame,
} from './fixtures.js';

test.describe('"Talk to an agent" (AI-29)', () => {
  test('the player presses the button and the agent sees the conversation handed over', async ({
    agentPage,
    browser,
    organizationId,
  }) => {
    test.setTimeout(180_000);

    const run = Date.now().toString().slice(-6);
    const marker = `button${run}`;
    const passage =
      `Standard ${marker} delivery takes 3 to 5 working days. ` +
      `Tracking for a ${marker} order is emailed the moment it dispatches.`;

    // --- A knowledge source only this run's question can match ----------------
    await agentPage.goto('/app/playbook?view=skills');
    const tabs = agentPage.getByRole('tablist', { name: 'AI Agent' });
    await tabs.getByRole('tab', { name: 'Knowledge' }).click();
    await agentPage.getByLabel('Title').fill(`Agent button proof ${run}`);
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
      await openWidget(visitor, organizationId, {
        host: tenantSubdomain(`ai-button-${run}`).origin,
      });
      const frame = widgetFrame(visitor);
      const replies = frame.locator('.nx-row--bot .nx-bubble');

      // --- The AI's first reply says what it is ----------------------------------
      const opened = visitor.waitForResponse(
        (response) =>
          response.url().includes('/customer/chat/events') &&
          response.request().method() === 'POST' &&
          response.ok(),
      );
      await visitorSends(visitor, `How long does ${marker} delivery take?`);
      const { chat_id: chatId } = (await (await opened).json()) as { chat_id: string };
      await expect(replies).toHaveCount(1, { timeout: 30_000 });
      await expect(replies.first()).toContainText('AI assistant');
      await expect(replies.first()).toContainText(marker);

      // --- The button, while the AI answers ---------------------------------------
      const button = frame.getByRole('button', { name: 'Talk to an agent' });
      await expect(button).toBeVisible({ timeout: 15_000 });
      await visitor.screenshot({ path: 'kanit/ai-29-human-button.png' });

      const pressed = visitor.waitForResponse(
        (response) =>
          response.url().endsWith('/customer/chat/request-human') &&
          response.request().method() === 'POST',
      );
      await button.click();
      const answer = await pressed;
      expect(answer.status()).toBe(200);
      expect(((await answer.json()) as { requested: boolean }).requested).toBe(true);
      await expect(button).toBeHidden();
      await expect(replies).toHaveCount(2, { timeout: 15_000 });
      await expect(replies.last()).toContainText('I am passing you to one of our agents.');

      // --- The agent sees it handed over, and why ---------------------------------
      await agentPage.goto(`/app/inbox?chat=${chatId}`);
      await expect(agentPage.locator('[data-ai-mode]')).toHaveAttribute('data-ai-mode', 'human', {
        timeout: 20_000,
      });
      await expect(
        agentPage.getByText('The player pressed “Talk to an agent”').first(),
      ).toBeVisible({ timeout: 20_000 });
      await agentPage.screenshot({ path: 'kanit/ai-29-handed-over.png' });

      // --- The AI says nothing more -------------------------------------------------
      await visitorSends(visitor, `Is a ${marker} order tracked?`);
      await visitor.waitForTimeout(4_000);
      await expect(replies).toHaveCount(2);
    } finally {
      await context.close();
    }
  });
});
