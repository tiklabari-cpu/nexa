/**
 * The AI quality control queue (AI-24 · tm 319.3): an administrator turns the
 * pre-score off in Settings › AI quality, a conversation the AI answered is
 * archived and sent to QA from the inbox ("Send to QA"), and the review is
 * claimed, scored and completed in Reports › AI quality — the two critical
 * criteria each confirmed by the person, or the review does not complete. The
 * completed review is in the queue, and the month's calibration round hands
 * it out, takes the scores and reports the agreement once closed.
 *
 * What the unit and integration suites cannot prove on their own: that the
 * inbox's request is accepted by the real API (the day, the connection), that
 * the review page's scores — with each person's confirmation — are what the
 * API completes, and that the calibration round opens on the reviews this
 * workspace completed — in a real browser, against the real API and AI worker.
 */
import { assertNoBlockingViolations, scanScreen, THEME_DEPENDENT_RULES } from './a11y.js';
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
import type { Locator, Page } from '@playwright/test';

/** Score every criterion of a rubric form the same way a careful reviewer would on a good answer. */
async function scoreGoodAnswer(form: Locator, tone = '4'): Promise<void> {
  const pick = async (criterion: RegExp, value: string): Promise<void> => {
    await form
      .getByRole('group', { name: criterion })
      .getByRole('radio', { name: value, exact: true })
      .check({ force: true });
  };
  await pick(/^Understood the topic/, 'Pass');
  await pick(/^Required details collected/, 'Pass');
  await pick(/^Faithful to knowledge/, 'Pass');
  await pick(/^Compliance rules kept/, 'Pass');
  await pick(/^Handed over at the right time/, 'Pass');
  await pick(/^Hand-over summary complete/, 'Does not apply');
  await pick(/^Tone/, tone);
  await form
    .getByRole('group', { name: 'Verdict' })
    .getByRole('radio', { name: 'Pass', exact: true })
    .check({ force: true });
}

async function confirmCriticals(form: Locator): Promise<void> {
  await form.getByRole('checkbox', { name: 'I checked “Compliance rules kept” myself' }).check();
  await form
    .getByRole('checkbox', { name: 'I checked “Handed over at the right time” myself' })
    .check();
}

async function setPrescore(page: Page, on: boolean): Promise<void> {
  await page.goto('/app/settings/ai-quality');
  const box = page.getByLabel('Let the model pre-score queued conversations');
  await expect(box).toBeVisible({ timeout: 20_000 });
  if ((await box.isChecked()) === on) return;
  await box.setChecked(on);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        response.url().endsWith('/qa/settings') &&
        response.ok(),
    ),
    page
      .getByRole('form', { name: 'Sampling' })
      .getByRole('button', { name: 'Save', exact: true })
      .click(),
  ]);
}

test.describe('AI quality control queue (AI-24)', () => {
  test('a conversation sent to QA from the inbox is claimed, scored with each critical criterion confirmed, and calibrated', async ({
    agentPage,
    browser,
    organizationId,
  }, testInfo) => {
    test.setTimeout(240_000);
    const run = Date.now().toString().slice(-6);
    const marker = `qaproof${run}`;

    // --- Settings › AI quality: no pre-score, so a queued review is ready at once --
    await setPrescore(agentPage, false);
    await expect(agentPage.getByRole('form', { name: 'Rubric' })).toContainText(
      'Compliance rules kept',
    );

    // --- A conversation the AI answered -------------------------------------------
    await agentPage.goto('/app/playbook?view=skills');
    const tabs = agentPage.getByRole('tablist', { name: 'AI Agent' });
    await tabs.getByRole('tab', { name: 'Knowledge' }).click();
    await agentPage.getByLabel('Title').fill(`QA proof ${run}`);
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
      await openWidget(visitor, organizationId, { host: tenantSubdomain(`ai-qa-${run}`).origin });
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

    // --- The inbox: archived, then sent to QA with a note ---------------------------
    await agentPage.goto(`/app/inbox?chat=${chatId}`);
    const details = agentPage.getByRole('complementary', { name: 'Conversation details' });
    await expect(details.getByRole('button', { name: 'Archive conversation' })).toBeVisible({
      timeout: 20_000,
    });
    // An open conversation is not offered to QA.
    await expect(agentPage.getByRole('button', { name: 'Send to QA' })).toHaveCount(0);
    await Promise.all([
      agentPage.waitForResponse(
        (response) => /\/chats\/[^/]+\/deactivate$/.test(response.url()) && response.ok(),
      ),
      details.getByRole('button', { name: 'Archive conversation' }).click(),
    ]);

    await agentPage.getByRole('button', { name: 'Send to QA' }).click();
    const dialog = agentPage.getByRole('dialog');
    await dialog.getByLabel(/Note for the reviewer/).fill('check the delivery promise');
    await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/qa/reviews') &&
          response.status() === 201,
      ),
      dialog.getByRole('button', { name: 'Send to QA' }).click(),
    ]);
    await expect(dialog.getByText(/The review is in the AI quality queue/)).toBeVisible();
    await dialog.getByRole('link', { name: 'Open the review' }).click();

    // --- The review: claim, score, the confirmation rule, complete -------------------
    const review = agentPage.getByTestId('qa-review');
    await expect(review.getByText('Sent by hand')).toBeVisible({ timeout: 20_000 });
    await expect(
      review.getByRole('region', { name: 'Conversation' }).getByText(`How long does ${marker}`),
    ).toBeVisible();
    await Promise.all([
      agentPage.waitForResponse(
        (response) => /\/qa\/reviews\/[^/]+\/claim$/.test(response.url()) && response.ok(),
      ),
      review.getByRole('button', { name: 'Claim' }).click(),
    ]);
    const rubric = review.getByRole('form', { name: 'Rubric' });
    await expect(rubric.getByLabel('Comments')).toHaveValue('check the delivery promise');
    await scoreGoodAnswer(rubric);

    // Each critical criterion is the person's to confirm: without it nothing is sent.
    let puts = 0;
    agentPage.on('request', (request) => {
      if (request.method() === 'PUT' && /\/qa\/reviews\/[^/]+$/.test(request.url())) puts += 1;
    });
    await rubric.getByRole('button', { name: 'Complete review' }).click();
    await expect(rubric.getByRole('alert')).toContainText('2 things are still missing');
    await expect(rubric.getByText('Confirm this critical criterion on its own.')).toHaveCount(2);
    expect(puts).toBe(0);

    await confirmCriticals(rubric);
    assertNoBlockingViolations(await scanScreen(agentPage, 'AI quality review (dark)', testInfo));
    await agentPage.screenshot({ path: 'kanit/ai-24-qa-review.png' });
    await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          /\/qa\/reviews\/[^/]+$/.test(response.url()) &&
          response.ok(),
      ),
      rubric.getByRole('button', { name: 'Complete review' }).click(),
    ]);
    await expect(agentPage.getByText('Reviewed: pass')).toBeVisible();

    // --- The queue: the completed review, the period's figures ----------------------
    await agentPage.getByRole('link', { name: 'Back to the queue' }).click();
    await expect(agentPage.getByRole('region', { name: 'AI quality figures' })).toBeVisible();
    await agentPage.getByLabel('Status').selectOption('completed');
    const completedRow = agentPage.getByTestId('qa-queue-row').filter({ hasText: 'Sent by hand' });
    await expect(completedRow.first()).toContainText('Pass');

    // --- Calibration: the month's round, scored, closed, reported --------------------
    await agentPage.getByRole('tab', { name: 'Calibration' }).click();
    await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/qa/calibrations') &&
          response.status() === 201,
      ),
      agentPage.getByRole('button', { name: 'Open this month’s round' }).click(),
    ]);
    await agentPage.getByRole('button', { name: /^Conversation 1/ }).click();
    const scoring = agentPage.getByRole('form', { name: 'Your scores' }).first();
    await scoreGoodAnswer(scoring);
    await confirmCriticals(scoring);
    await Promise.all([
      agentPage.waitForResponse(
        (response) => /\/qa\/calibrations\/[^/]+\/scores$/.test(response.url()) && response.ok(),
      ),
      scoring.getByRole('button', { name: 'Save scores' }).click(),
    ]);
    await expect(agentPage.getByText('Scores saved.')).toBeVisible();

    // The seeded Team Lead scores the same conversation, one tone apart: a lead
    // reaches the round without the reports scope, and agreement needs two.
    const leadContext = await browser.newContext();
    try {
      const lead = await leadContext.newPage();
      await signInAs(lead, ACME_TEAM_LEAD.email, ACME_TEAM_LEAD.password);
      await lead.goto('/app/reports/ai-quality?view=calibration');
      await lead.getByRole('button', { name: /^Conversation 1/ }).click();
      const leadScoring = lead.getByRole('form', { name: 'Your scores' }).first();
      await scoreGoodAnswer(leadScoring, '5');
      await confirmCriticals(leadScoring);
      await Promise.all([
        lead.waitForResponse(
          (response) => /\/qa\/calibrations\/[^/]+\/scores$/.test(response.url()) && response.ok(),
        ),
        leadScoring.getByRole('button', { name: 'Save scores' }).click(),
      ]);
      // While the round is open the report is the administrator's alone.
      await expect(lead.getByText('Scores saved.')).toBeVisible();
      await expect(lead.getByTestId('qa-calibration-report')).toHaveCount(0);
    } finally {
      await leadContext.close();
    }

    await Promise.all([
      agentPage.waitForResponse(
        (response) => /\/qa\/calibrations\/[^/]+\/close$/.test(response.url()) && response.ok(),
      ),
      agentPage.getByRole('button', { name: 'Close round' }).click(),
    ]);
    const report = agentPage.getByTestId('qa-calibration-report');
    await expect(report.getByRole('table', { name: 'Agreement per criterion' })).toContainText(
      'Compliance rules kept',
    );
    await expect(
      report
        .getByRole('table', { name: 'Agreement per criterion' })
        .getByRole('row', { name: /^Tone/ }),
    ).toContainText('50%');
    const reviewers = report.getByRole('table', { name: 'Reviewers' });
    await expect(reviewers).toContainText('Dana Okonkwo');
    await expect(reviewers).toContainText(ACME_TEAM_LEAD.name);

    // --- The queue in the light theme -------------------------------------------------
    await agentPage.evaluate(() => window.localStorage.setItem('siyahtus.theme', 'light'));
    await agentPage.goto('/app/reports/ai-quality');
    await expect(agentPage.getByRole('region', { name: 'AI quality figures' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(agentPage.locator('html')).toHaveAttribute('data-theme', 'light');
    assertNoBlockingViolations(
      await scanScreen(agentPage, 'AI quality queue (light)', testInfo, {
        rules: THEME_DEPENDENT_RULES,
      }),
    );
    await agentPage.evaluate(() => window.localStorage.removeItem('siyahtus.theme'));

    await setPrescore(agentPage, true);
  });
});
