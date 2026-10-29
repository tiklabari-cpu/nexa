/**
 * Raporlar › AI Agent's quality panel (AI-25 · tm 320.3): a conversation the
 * AI answered is archived, and the panel — under the billed figure, labelled
 * apart (ADR-09a) — counts it "not settled yet" (its 72 hours have not
 * passed) and lists it by its ids; the version comparison and the hand-over
 * reasons are on the same tab. A Team Lead, who holds no reports scope, reads
 * the same panel from Raporlar › AI Kalite's "Metrics" view.
 *
 * What the unit suites cannot prove on their own: that the outcome row the AI
 * worker and the archive write is what the real breakdown and list endpoints
 * return to this screen, in a real browser — and that a lead's view is
 * answered rather than refused.
 */
import { assertNoBlockingViolations, scanScreen } from './a11y.js';
import {
  ACME_TEAM_LEAD,
  expect,
  openWidget,
  signInAs,
  tenantSubdomain,
  test,
  visitorSends,
  widgetFrame,
} from './fixtures.js';

test.describe('AI quality metrics (AI-25)', () => {
  test('an archived AI conversation is counted "not settled yet" and listed by id; a Team Lead reads the same panel', async ({
    agentPage,
    browser,
    organizationId,
  }, testInfo) => {
    test.setTimeout(180_000);
    const run = Date.now().toString().slice(-6);
    const marker = `metricsproof${run}`;

    // --- A conversation the AI answered -------------------------------------------
    await agentPage.goto('/app/playbook?view=skills');
    const tabs = agentPage.getByRole('tablist', { name: 'AI Agent' });
    await tabs.getByRole('tab', { name: 'Knowledge' }).click();
    await agentPage.getByLabel('Title').fill(`Metrics proof ${run}`);
    await agentPage
      .getByLabel('Content')
      .fill(`Standard ${marker} delivery takes 3 to 5 working days.`);
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
        host: tenantSubdomain(`ai-metrics-${run}`).origin,
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

    // --- Archived: the connection ends, its outcome waits for its 72 hours ----------
    await agentPage.goto(`/app/inbox?chat=${chatId}`);
    const details = agentPage.getByRole('complementary', { name: 'Conversation details' });
    await expect(details.getByRole('button', { name: 'Archive conversation' })).toBeVisible({
      timeout: 20_000,
    });
    await Promise.all([
      agentPage.waitForResponse(
        (response) => /\/chats\/[^/]+\/deactivate$/.test(response.url()) && response.ok(),
      ),
      details.getByRole('button', { name: 'Archive conversation' }).click(),
    ]);

    // --- Reports › AI Agent: the billed box, then the quality panel ------------------
    await agentPage.goto('/app/reports');
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await agentPage.getByRole('tab', { name: 'AI Agent' }).click();
    const billed = agentPage.getByRole('region', { name: 'Billed AI resolution' });
    await expect(billed.getByText('AI resolutions', { exact: true })).toBeVisible();

    const panel = agentPage.getByRole('region', { name: 'AI quality', exact: true });
    await expect(panel.getByText(/^Over \d+ ended conversations? the AI wrote in$/)).toBeVisible({
      timeout: 20_000,
    });
    const unsettled = agentPage.locator('[data-metric="unsettled"]');
    // At least this one (the figure is the card's large number).
    await expect(unsettled.locator('.font-heading')).toHaveText(/^[1-9][\d,.]*$/);

    // The definition is the tooltip of each figure's "?".
    await expect(
      agentPage.getByRole('button', { name: 'What Confirmed resolution counts' }),
    ).toHaveAccessibleDescription(/answered Yes to "Is it solved\?"/);

    // The list behind "not settled yet" holds this conversation, by its day id.
    await unsettled
      .getByRole('button', { name: 'Show the conversations: Not settled yet' })
      .click();
    const list = agentPage.getByRole('table', { name: 'Not settled yet', exact: true });
    await expect(list.getByRole('row').filter({ hasText: chatId })).toHaveCount(1, {
      timeout: 20_000,
    });
    await expect(list.getByRole('row').filter({ hasText: chatId })).toContainText(
      'Not settled yet',
    );

    // AI versions side by side; then the hand-over reasons.
    await expect(agentPage.getByRole('table', { name: 'AI quality by AI version' })).toBeVisible();
    await agentPage.getByLabel('Compare by').selectOption('reason');
    await expect(
      agentPage.getByRole('table', { name: 'AI quality by Hand-over reason' }),
    ).toBeVisible();

    assertNoBlockingViolations(await scanScreen(agentPage, 'Reports AI quality (dark)', testInfo));
    await agentPage.screenshot({ path: 'kanit/ai-25-metrics.png', fullPage: true });

    // --- A Team Lead: the same panel, from Raporlar › AI Kalite --------------------
    const leadContext = await browser.newContext();
    try {
      const lead = await leadContext.newPage();
      await signInAs(lead, ACME_TEAM_LEAD.email, ACME_TEAM_LEAD.password);
      const breakdown = lead.waitForResponse((response) =>
        response.url().includes('/reports/ai-agent/breakdown?'),
      );
      await lead.goto('/app/reports/ai-quality?view=metrics');
      expect((await breakdown).status()).toBe(200);
      await expect(
        lead
          .getByRole('region', { name: 'AI quality', exact: true })
          .getByText(/^Over \d+ ended conversations? the AI wrote in$/),
      ).toBeVisible({ timeout: 20_000 });
      // No billed figure here: that report is not the lead's to read.
      await expect(lead.getByRole('region', { name: 'Billed AI resolution' })).toHaveCount(0);
    } finally {
      await leadContext.close();
    }
  });
});
