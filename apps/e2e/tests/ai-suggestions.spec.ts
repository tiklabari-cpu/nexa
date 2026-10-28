/**
 * The AI coaching queue (AI-23 · tm 318.2): an agent reading a conversation
 * the AI answered marks the AI's message wrong ("AI'ı düzelt"), and the mark
 * is in the reviewers' queue — Playbook › Suggestions — with the masked
 * excerpt and the agent's note. A reviewer writes the proposal into the AI's
 * draft, or rejects a mark, and a rejection needs its reason.
 *
 * What the unit and integration suites cannot prove on their own: that the
 * transcript's message menu offers the marks only on the AI's real messages,
 * that the modal's request is accepted by the real API (the event id, the
 * connection and the day), that the queue draws what the API serves with its
 * ids, and that accepting reaches the draft — in a real browser, against the
 * real API, gateway and AI worker.
 */
import { assertNoBlockingViolations, scanScreen, THEME_DEPENDENT_RULES } from './a11y.js';
import {
  expect,
  openWidget,
  tenantSubdomain,
  test,
  visitorSends,
  widgetFrame,
} from './fixtures.js';

test.describe('AI coaching queue (AI-23)', () => {
  test('an agent marks the AI’s answer, and the reviewer writes it into the draft or rejects it with a reason', async ({
    agentPage,
    browser,
    organizationId,
  }, testInfo) => {
    test.setTimeout(240_000);

    const run = Date.now().toString().slice(-6);
    const marker = `coachproof${run}`;
    const passage =
      `Standard ${marker} delivery takes 3 to 5 working days. ` +
      `Tracking for a ${marker} order is emailed the moment it dispatches.`;

    // --- A knowledge source the AI answers the first question from --------------
    await agentPage.goto('/app/playbook?view=skills');
    const tabs = agentPage.getByRole('tablist', { name: 'AI Agent' });
    await tabs.getByRole('tab', { name: 'Knowledge' }).click();
    await agentPage.getByLabel('Title').fill(`Coaching proof ${run}`);
    await agentPage.getByLabel('Content').fill(passage);
    await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith('/knowledge-sources'),
      ),
      agentPage.getByRole('button', { name: 'Add source' }).click(),
    ]);

    const context = await browser.newContext();
    let chatId: string;
    try {
      const visitor = await context.newPage();
      await openWidget(visitor, organizationId, {
        host: tenantSubdomain(`ai-coach-${run}`).origin,
      });
      const opened = visitor.waitForResponse(
        (response) =>
          response.url().includes('/customer/chat/events') &&
          response.request().method() === 'POST' &&
          response.ok(),
      );
      await visitorSends(visitor, `How long does ${marker} delivery take?`);
      ({ chat_id: chatId } = (await (await opened).json()) as { chat_id: string });
      await expect(widgetFrame(visitor).locator('.nx-row--bot .nx-bubble')).toHaveCount(1, {
        timeout: 30_000,
      });
    } finally {
      await context.close();
    }

    // --- The agent marks the AI's message: wrong, then in the wrong tone ------------
    await agentPage.goto(`/app/inbox?chat=${chatId}`);
    const log = agentPage.getByRole('log');
    // Only the AI's own message carries the menu: the player's has none.
    const menu = log.getByRole('button', { name: 'Message actions' });
    await expect(menu).toHaveCount(1, { timeout: 20_000 });

    const mark = async (reason: string, note: string): Promise<void> => {
      await menu.click();
      await log.getByRole('button', { name: 'Correct the AI' }).click();
      const dialog = agentPage.getByRole('dialog');
      await dialog.getByRole('radio', { name: reason }).check({ force: true });
      await dialog.getByLabel(/Note/).fill(note);
      await Promise.all([
        agentPage.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            response.url().endsWith('/ai/suggestions') &&
            response.status() === 201,
        ),
        dialog.getByRole('button', { name: 'Send correction' }).click(),
      ]);
      await expect(dialog.getByText(/correction is in the reviewers/)).toBeVisible();
      await dialog.getByRole('button', { name: 'Close' }).click();
      await expect(dialog).toHaveCount(0);
    };
    await mark('Wrong answer', `e2e wrong ${run}`);
    await mark('Tone', `e2e tone ${run}`);

    // The same message and reason twice is refused, with the API's sentence.
    await menu.click();
    await log.getByRole('button', { name: 'Correct the AI' }).click();
    const again = agentPage.getByRole('dialog');
    await again.getByRole('radio', { name: 'Tone' }).check({ force: true });
    await again.getByRole('button', { name: 'Send correction' }).click();
    await expect(again.getByRole('alert')).toBeVisible();
    await again.getByRole('button', { name: 'Cancel' }).click();

    // --- The reviewer's queue: newest first, with the excerpt and the ids --------------
    await agentPage.goto('/app/playbook?view=suggestions');
    const rows = agentPage.getByTestId('ai-suggestion-row');
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    await expect(agentPage.getByTestId('ai-suggestions-badge')).toBeVisible();

    await rows.first().click();
    const detail = agentPage.getByTestId('ai-suggestion-detail');
    await expect(detail).toContainText(`e2e tone ${run}`);
    await expect(detail).toContainText(chatId);
    await expect(detail.getByText('Marked')).toBeVisible();
    await expect(detail).toContainText(`How long does ${marker} delivery take?`);

    // A rejection says why before the button works.
    await detail.getByRole('button', { name: 'Reject…' }).click();
    const confirm = detail.getByRole('button', { name: 'Reject suggestion' });
    await expect(confirm).toBeDisabled();
    await detail.getByLabel(/Why is it rejected/).fill(`Tone is fine ${run}`);
    await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.url().includes('/ai/suggestions/') &&
          response.ok(),
      ),
      confirm.click(),
    ]);
    await expect(detail.getByTestId('ai-suggestion-outcome')).toContainText(
      `Rejected. Reason: Tone is fine ${run}`,
    );

    // The wrong-answer mark: the reviewer writes the proposal, which goes to the draft.
    await agentPage.getByLabel('Status').selectOption('open');
    await expect(rows.first()).toContainText('Wrong answer');
    await rows.first().click();
    await expect(detail).toContainText(`e2e wrong ${run}`);
    await detail.getByRole('button', { name: 'Write a proposal' }).click();
    await detail.getByLabel('Title').fill(`Delivery time ${run}`);
    await detail.getByLabel('Text').fill(`Delivery takes 3 to 5 working days (${marker}).`);

    // The queue as it stands, in the default (dark) theme and then the light one.
    assertNoBlockingViolations(await scanScreen(agentPage, 'AI suggestions (dark)', testInfo));
    await agentPage.screenshot({ path: 'kanit/ai-23-suggestions.png' });

    await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.url().includes('/ai/suggestions/') &&
          response.ok(),
      ),
      detail.getByRole('button', { name: 'Accept into the draft' }).click(),
    ]);
    await expect(agentPage.getByText(/goes live with the next published version/)).toBeVisible();
    await expect(detail.getByTestId('ai-suggestion-outcome')).toContainText('Accepted');

    // Accepting wrote into the draft — nothing is live: the draft strip says so.
    await agentPage.goto('/app/playbook?view=knowledge');
    await expect(agentPage.getByText(`Delivery time ${run}`).first()).toBeVisible({
      timeout: 20_000,
    });

    await agentPage.evaluate(() => window.localStorage.setItem('siyahtus.theme', 'light'));
    await agentPage.goto('/app/playbook?view=suggestions');
    await agentPage.getByLabel('Status').selectOption('all');
    await agentPage.getByTestId('ai-suggestion-row').first().click();
    await expect(agentPage.getByTestId('ai-suggestion-detail')).toBeVisible();
    await expect(agentPage.locator('html')).toHaveAttribute('data-theme', 'light');
    assertNoBlockingViolations(
      await scanScreen(agentPage, 'AI suggestions (light)', testInfo, {
        rules: THEME_DEPENDENT_RULES,
      }),
    );
    await agentPage.evaluate(() => window.localStorage.removeItem('siyahtus.theme'));
  });
});
