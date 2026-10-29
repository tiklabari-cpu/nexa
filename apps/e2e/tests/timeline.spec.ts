/**
 * The conversation timeline (ID-09 · tm 334.2): from the Inbox, a day's whole
 * record in one list — the visitor's message, the AI's decision about it (the
 * procedure or knowledge it used, the hand-over reason) — findable with the
 * page's own filter, and downloadable as a CSV whose headers say both
 * identifier names ("Thread ID (chat_id)").
 *
 * What the unit suites cannot prove on their own: that the rows the real
 * timeline endpoint merges from the AI worker's decision log are what this
 * screen lists, and that the export is a real file a browser saves.
 */
import { readFile } from 'node:fs/promises';
import { assertNoBlockingViolations, scanScreen } from './a11y.js';
import {
  expect,
  openWidget,
  tenantSubdomain,
  test,
  visitorSends,
  widgetFrame,
} from './fixtures.js';

test.describe('Conversation timeline (ID-09)', () => {
  test('opens from the Inbox, finds the AI decision row and downloads the CSV', async ({
    agentPage,
    browser,
    organizationId,
  }, testInfo) => {
    test.setTimeout(180_000);
    const run = Date.now().toString().slice(-6);
    // A word no other spec's knowledge or questions share. The passage and the question keep the
    // wording of `ai-metrics.spec.ts`: the mock embedding is lexical, and a looser question
    // falls under the retrieval threshold, so the AI hands over instead of answering.
    const marker = `tlproof${run}`;

    // --- A conversation the AI answered -------------------------------------------
    await agentPage.goto('/app/playbook?view=skills');
    const tabs = agentPage.getByRole('tablist', { name: 'AI Agent' });
    await tabs.getByRole('tab', { name: 'Knowledge' }).click();
    await agentPage.getByLabel('Title').fill(`Timeline proof ${run}`);
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
        host: tenantSubdomain(`timeline-${run}`).origin,
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

    // --- Inbox → Timeline ---------------------------------------------------------
    await agentPage.goto(`/app/inbox?chat=${chatId}`);
    await agentPage
      .getByRole('complementary', { name: 'Conversation details' })
      .getByRole('button', { name: 'Timeline', exact: true })
      .click();
    await expect(agentPage).toHaveURL(new RegExp(`/app/inbox/timeline\\?chat=${chatId}`));
    await expect(agentPage.getByRole('heading', { name: 'Timeline', level: 1 })).toBeVisible();

    // The AI's decision is a row of its own, beside the visitor's message.
    const list = agentPage.getByRole('list', { name: 'Timeline rows' });
    const decision = list.locator('li[data-kind="ai_decision"]').first();
    await expect(decision).toBeVisible({ timeout: 20_000 });
    await expect(decision.getByText('AI decision')).toBeVisible();
    await expect(
      list.locator('li[data-kind="message"]').filter({ hasText: marker }).first(),
    ).toBeVisible();

    // The filter box narrows what is loaded; the page's find still sees every row.
    const box = agentPage.getByRole('searchbox', { name: 'Filter the loaded rows' });
    await box.fill(marker);
    await expect(list.locator('li[data-kind="message"]').first()).toContainText(marker);
    await expect(list.locator('li[data-kind="ai_decision"]')).toHaveCount(0);
    await box.fill('');
    await expect(decision).toBeVisible();

    assertNoBlockingViolations(await scanScreen(agentPage, 'Timeline (dark)', testInfo));
    await agentPage.screenshot({ path: 'kanit/id-09-timeline.png', fullPage: true });

    // --- Export: masked CSV, both identifier names in the header ------------------
    await agentPage.getByRole('button', { name: 'Export' }).click();
    const dialog = agentPage.getByRole('dialog');
    await expect(dialog.getByRole('checkbox', { name: 'Mask email and username' })).toBeChecked();
    const [download] = await Promise.all([
      agentPage.waitForEvent('download'),
      dialog.getByRole('button', { name: 'Download' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`siyahtus-timeline-${chatId}.csv`);
    const path = await download.path();
    const text = await readFile(path, 'utf8');
    const header = text.split(/\r?\n/).find((line) => line.includes('Thread ID (chat_id)')) ?? '';
    expect(header).toContain('Thread ID (chat_id)');
    expect(header).toContain('Chat ID (thread_id)');
    expect(text).toContain(marker);
    await expect(dialog).toHaveCount(0);
  });
});
