/**
 * Goals, end to end (FR-MOD-13.3) — the one proof the nine slices of 13.3 are
 * actually connected to each other.
 *
 * Each of 13.3-a…-h is tested where it lives: the matcher in a unit test, the
 * achievement and the funnel query in the integration suite, the screen and the
 * KPI card in jsdom. None of that can fail if the *seams* are broken — a goal
 * the visitor write path never evaluates, a funnel the Goals screen never
 * mounts, a counter the Overview never binds. This file drives the whole chain
 * in a browser: an owner defines a goal, a visitor on a matching page opens the
 * widget and writes, and the number that comes back is read off two screens.
 *
 * Isolation is by *host*, not by path. The widget reports the embedding page as
 * origin + path, and every other spec's visitor is on `/demo.html`, so a goal
 * triggered by a path would convert visitors this file never created. Each test
 * gets a subdomain of the seeded trusted domain instead (`tenantSubdomain`),
 * which only its own visitor can be on.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  test,
  API_BASE,
  openWidget,
  ownerAccessToken,
  tenantSubdomain,
  visitorSends,
  widgetFrame,
} from './fixtures.js';

interface GoalsReport {
  funnel: { visitors: number; chats: number; conversions: number; conversion_rate: number | null };
  by_goal: Array<{ goal_id: string; name: string; conversions: number }>;
}

/**
 * `GET /reports/goals` as the owner — the same figures the two screens render,
 * read directly so a test can wait for the server to have processed a visitor
 * without re-rendering anything. The widget paints its own message optimistically,
 * so "the bubble is on screen" is not proof the send round-tripped.
 */
async function goalsReport(request: APIRequestContext, token: string): Promise<GoalsReport> {
  const response = await request.get(`${API_BASE}/reports/goals`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.ok(), `goals report failed: ${response.status()} ${await response.text()}`).toBe(
    true,
  );
  return (await response.json()) as GoalsReport;
}

/** Define a goal through the Goals screen and wait for it to land in the list. */
async function createGoal(page: Page, name: string, trigger: string): Promise<void> {
  // Reached through the Customers sub-nav, not a bookmarked URL — the tab being
  // there is part of what 13.3-g delivered.
  await page.goto('/app/customers');
  await page.getByRole('link', { name: 'Goals' }).click();
  await expect(page).toHaveURL(/\/app\/customers\/goals$/);

  await page.getByRole('button', { name: 'New goal' }).click();
  const dialog = page.getByRole('dialog', { name: 'New goal' });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Trigger — page URL contains').fill(trigger);
  await dialog.getByRole('button', { name: 'Create goal' }).click();

  await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible();
}

test.describe('goals', () => {
  test('a visitor reaching a goal converts once, and both screens agree (13.3)', async ({
    agentPage,
    browser,
    request,
    organizationId,
  }) => {
    const stamp = Date.now().toString().slice(-6);
    const name = `Reached checkout ${stamp}`;
    const site = tenantSubdomain(`goal-${stamp}`);
    const token = await ownerAccessToken(request);

    // --- "hedef tanımı": the goal is defined from the screen -----------------
    await createGoal(agentPage, name, site.hostname);

    // Defining the first goal is what takes the funnel out of its empty state,
    // and nobody has converted yet.
    const funnel = agentPage.getByRole('region', { name: 'Goal funnel' });
    await expect(funnel.getByTestId('goal-funnel-conversions')).toHaveText('0');

    const before = await goalsReport(request, token);

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    try {
      // --- The visitor reaches the goal page and starts a conversation -------
      await openWidget(visitor, organizationId, { host: site.origin });
      await visitorSends(visitor, `Ready to check out — ${stamp}`);

      // Wait on the server, not on the widget: the message bubble is optimistic.
      await expect
        .poll(async () => (await goalsReport(request, token)).funnel.conversions, {
          timeout: 20_000,
        })
        .toBe(before.funnel.conversions + 1);

      // --- "3 aşamalı huni": the Goals screen shows all three stages ---------
      await agentPage.reload();
      await expect(funnel.getByText('Visitors', { exact: true })).toBeVisible();
      await expect(funnel.getByText('Chats', { exact: true })).toBeVisible();
      await expect(funnel.getByText('Conversions', { exact: true })).toBeVisible();
      await expect(funnel.getByTestId('goal-funnel-conversions')).toHaveText('1');

      // The stages nest, so the counts can only ever narrow.
      const after = await goalsReport(request, token);
      expect(after.funnel.visitors).toBeGreaterThanOrEqual(after.funnel.chats);
      expect(after.funnel.chats).toBeGreaterThanOrEqual(after.funnel.conversions);
      expect(after.by_goal.find((goal) => goal.name === name)?.conversions).toBe(1);

      await agentPage.screenshot({ path: 'kanit/13.3-goals-funnel.png', fullPage: true });

      // --- Idempotency: the same visitor on the same page a second time ------
      const again = `Still on this page — ${stamp}`;
      await visitorSends(visitor, again);
      // A reload re-fetches the transcript from the server, so seeing the second
      // message afterwards is proof the send round-tripped — and with it the
      // second goal evaluation this assertion is about.
      await visitor.reload();
      await widgetFrame(visitor).getByRole('button', { name: 'Open chat' }).click();
      await expect(widgetFrame(visitor).getByRole('log', { name: 'Conversation' })).toContainText(
        again,
      );

      const repeated = await goalsReport(request, token);
      expect(repeated.funnel.conversions).toBe(after.funnel.conversions);
      expect(repeated.by_goal.find((goal) => goal.name === name)?.conversions).toBe(1);
    } finally {
      await visitorContext.close();
    }

    // --- "rapor entegrasyonu": Reports Overview quotes the same number -------
    await agentPage.goto('/app/reports');
    const volume = agentPage.getByRole('region', { name: 'Volume' });
    const card = volume.locator('div').filter({ hasText: /^Achieved goals/ });
    // Spans in document order: the label, then the value, then the delta.
    await expect(card.locator('span').nth(1)).toHaveText('1');

    await agentPage.screenshot({ path: 'kanit/13.3-reports-achieved-goals.png', fullPage: true });
  });

  test('a goal that has been turned off does not convert anyone (13.3)', async ({
    agentPage,
    browser,
    request,
    organizationId,
  }) => {
    const stamp = `${Date.now().toString().slice(-6)}x`;
    const name = `Retired goal ${stamp}`;
    const site = tenantSubdomain(`off-${stamp}`);
    const token = await ownerAccessToken(request);

    await createGoal(agentPage, name, site.hostname);

    // Retiring a goal is `active: false` — there is no delete, because deleting
    // one would take last month's conversions with it (13.3-c).
    const card = agentPage.getByRole('listitem').filter({ hasText: name });
    await card.getByRole('button', { name: 'Turn off' }).click();
    await expect(card.getByRole('button', { name: 'Turn on' })).toBeVisible();

    const before = await goalsReport(request, token);

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    try {
      await openWidget(visitor, organizationId, { host: site.origin });
      await visitorSends(visitor, `On the retired goal's page — ${stamp}`);

      // The visitor stage is the signal that the server processed this page
      // view; the conversion stage is what must not have moved with it.
      await expect
        .poll(async () => (await goalsReport(request, token)).funnel.visitors, { timeout: 20_000 })
        .toBe(before.funnel.visitors + 1);
    } finally {
      await visitorContext.close();
    }

    const after = await goalsReport(request, token);
    expect(after.funnel.conversions).toBe(before.funnel.conversions);
    expect(after.by_goal.find((goal) => goal.name === name)?.conversions).toBe(0);
  });
});
