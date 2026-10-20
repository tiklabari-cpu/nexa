/**
 * The AI's hand-over card in the inbox (AI-10 · tm 304.2): the agent watching
 * a conversation the AI is answering sees the card the moment the AI hands it
 * over — at the top of the Details panel and on its own line in the
 * transcript, no reload — and marks it enough to start; the verdict survives
 * a reload.
 *
 * What the unit and integration suites cannot prove on their own: that the
 * card is drawn from what the real API serves (`latest_ai_handoff`, the day's
 * cards), that the RTM gateway forwards `ai_handoff_created` to the open
 * console, and that the verdict is stored — in a real browser, against the
 * real API, gateway and AI job worker.
 */
import {
  expect,
  openWidget,
  tenantSubdomain,
  test,
  visitorSends,
  widgetFrame,
} from './fixtures.js';

test.describe('AI hand-over card (AI-10)', () => {
  test('the card appears live when the AI hands over, opens from the transcript, and keeps the verdict', async ({
    agentPage,
    browser,
    organizationId,
  }) => {
    test.setTimeout(180_000);

    const run = Date.now().toString().slice(-6);
    const marker = `cardproof${run}`;
    const passage =
      `Standard ${marker} delivery takes 3 to 5 working days. ` +
      `Tracking for a ${marker} order is emailed the moment it dispatches.`;

    // --- A knowledge source only this run's first question can match ----------
    await agentPage.goto('/app/playbook');
    const tabs = agentPage.getByRole('tablist', { name: 'AI Agent' });
    await tabs.getByRole('tab', { name: 'Knowledge' }).click();
    await agentPage.getByLabel('Title').fill(`Hand-over card proof ${run}`);
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
        host: tenantSubdomain(`ai-card-${run}`).origin,
      });
      const replies = widgetFrame(visitor).locator('.nx-row--bot .nx-bubble');

      // --- The AI answers the first question: no card yet ----------------------
      const opened = visitor.waitForResponse(
        (response) =>
          response.url().includes('/customer/chat/events') &&
          response.request().method() === 'POST' &&
          response.ok(),
      );
      await visitorSends(visitor, `How long does ${marker} delivery take?`);
      const { chat_id: chatId } = (await (await opened).json()) as { chat_id: string };
      await expect(replies).toHaveCount(1, { timeout: 30_000 });

      await agentPage.goto(`/app/inbox?chat=${chatId}`);
      await expect(agentPage.locator('[data-ai-mode]')).toHaveAttribute('data-ai-mode', 'ai', {
        timeout: 20_000,
      });
      const panelCard = agentPage
        .getByRole('complementary', { name: 'Conversation details' })
        .getByRole('article', { name: 'AI hand-over card' });
      await expect(panelCard).toHaveCount(0);

      // --- A money question the knowledge base cannot answer: the AI hands over ---
      // Not one word of it is in the passage, or the passage would answer it.
      const question = `My USDT withdrawal ${run} vanished from the ledger, what now?`;
      await visitorSends(visitor, question);
      await expect(replies).toHaveCount(2, { timeout: 30_000 });

      // The card arrives over the push, without a reload.
      await expect(panelCard).toBeVisible({ timeout: 15_000 });
      // The one-line summary quotes the connection's first message (AI-10: "Soru: <ilk mesaj>").
      await expect(panelCard.getByTestId('ai-handoff-summary')).toHaveText(
        `Soru: How long does ${marker} delivery take?`,
      );
      await expect(panelCard).toContainText('No answer in the knowledge base');
      await expect(panelCard).toContainText('Player’s own claim, not verified');
      await panelCard.getByRole('button', { name: 'Show details' }).click();
      // The question the AI could not answer, and why.
      await expect(panelCard).toContainText('The player’s question');
      await expect(panelCard).toContainText(question);
      await expect(panelCard).toContainText('Nothing in the knowledge base matched the question');

      // --- The transcript's line opens the same card --------------------------------
      const log = agentPage.getByRole('log');
      const line = log.locator('[data-ai-handoff-line]');
      await expect(line).toContainText(
        'The AI handed this conversation over: No answer in the knowledge base',
      );
      await line.getByRole('button', { name: 'Show the card' }).click();
      const lineCard = line.getByRole('article', { name: 'AI hand-over card' });
      await expect(lineCard).toContainText(question);
      const cardId = await lineCard.getAttribute('data-ai-handoff');
      expect(cardId).toBeTruthy();
      await expect(panelCard).toHaveAttribute('data-ai-handoff', cardId!);

      // --- One click: enough to start --------------------------------------------------
      const enough = panelCard.getByRole('button', { name: 'Enough', exact: true });
      await expect(enough).toHaveAttribute('aria-pressed', 'false');
      await Promise.all([
        agentPage.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            response.url().endsWith(`/ai-handoffs/${cardId}/feedback`) &&
            response.ok(),
        ),
        enough.click(),
      ]);
      await expect(enough).toHaveAttribute('aria-pressed', 'true');

      await agentPage.screenshot({ path: 'kanit/ai-10-handoff-card.png' });

      // The verdict is the server's, not the page's.
      await agentPage.reload();
      await expect(panelCard.getByRole('button', { name: 'Enough', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
        { timeout: 20_000 },
      );
    } finally {
      await context.close();
    }
  });
});
