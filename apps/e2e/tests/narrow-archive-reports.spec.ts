/**
 * Archive and Reports below the desktop layout (GV-04 · tm 472.3).
 *
 * Runs in the `narrow-375` and `narrow-768` projects only (`playwright.config.ts`
 * `NARROW_SPECS`): a phone and a tablet held upright, with touch.
 *
 *   Archive  the list fills the screen; an opened connection replaces it under
 *            a way back, its transcript and player panel two tabs.
 *   Reports  the sidebar's sixteen tabs are one picker, and every report's
 *            tables are cards — a row a card, each value under its column's
 *            name — never a table scrolling sideways in a box.
 *
 * Neither shows the "designed for desktop" band. Every claim is a measurement
 * (`narrow-fit.ts`); every report the owner can open is visited, so a report
 * that grows a wide table fails here by name. The day × hour heat grids
 * (Staffing, Missed) are the one exception: 24 hour columns are the chart, and
 * they scroll in place. The PNGs are only evidence.
 */
import type { Page } from '@playwright/test';
import { assertNoBlockingViolations, scanScreen } from './a11y.js';
import {
  API_BASE,
  allChats,
  expect,
  openWidget,
  ownerAccessToken,
  test,
  visitorSends,
} from './fixtures.js';
import { BAND, FITS, expectTouchSized, measureFit, widthTag, type Fit } from './narrow-fit.js';

/**
 * Tables on screen that are still laid out as tables — not cards — and are not
 * a heat grid (`HourGrid`, whose header row is the 24 hours) or for screen
 * readers only.
 */
async function tablesNotCards(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('main table'))
      // A table for screen readers only (the activity strip's) is no layout.
      .filter((table) => !table.closest('.sr-only'))
      .filter((table) => getComputedStyle(table).display !== 'block')
      .filter((table) => (table.querySelector('thead tr')?.children.length ?? 0) < 24)
      .map((table) => (table.querySelector('caption')?.textContent ?? '(no caption)').trim()),
  );
}

test.describe('Archive on a narrow window (tm 472.3)', () => {
  test('the list fills the screen, a connection opens over it, and the way back returns', async ({
    agentPage,
    browser,
    organizationId,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    const tag = widthTag(testInfo);
    const stamp = Date.now().toString().slice(-6);
    const words = `Narrow archive ${tag} question ${stamp}`;

    // One closed conversation of our own, so the list has a row to open.
    const visitorContext = await browser.newContext();
    try {
      const visitor = await visitorContext.newPage();
      const auth = { Authorization: `Bearer ${await ownerAccessToken(request)}` };
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, words);
      let chatId = '';
      await expect
        .poll(
          async () => {
            chatId =
              (await allChats(request, auth)).find((chat) => chat.last_event?.text === words)?.id ??
              '';
            return chatId;
          },
          { timeout: 20_000 },
        )
        .not.toBe('');
      const closed = await request.post(`${API_BASE}/chats/${chatId}/deactivate`, {
        headers: auth,
      });
      expect(closed.ok(), `deactivate failed: ${closed.status()}`).toBe(true);
    } finally {
      await visitorContext.close();
    }

    await agentPage.goto('/app/archive');
    await expect(agentPage.getByRole('heading', { name: 'Archive', level: 1 })).toBeVisible();
    await expect(agentPage.getByRole('region', { name: BAND })).toHaveCount(0);
    const list = agentPage.getByRole('list', { name: 'Conversations' });
    const row = list.getByRole('listitem').filter({ hasText: words }).getByRole('button');
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expectTouchSized(row);
    // No empty "Pick a conversation" pane squeezed beside the list.
    await expect(agentPage.getByText('Pick a conversation')).toHaveCount(0);
    await agentPage.waitForLoadState('networkidle');
    expect(await measureFit(agentPage)).toEqual(FITS);
    await agentPage.screenshot({ path: `kanit/472.3-archive-list-${tag}.png` });

    await row.tap();
    await expect(agentPage).toHaveURL(/[?&]c=/);
    const transcript = agentPage.getByRole('log', { name: 'Conversation transcript' });
    await expect(transcript).toContainText(words, { timeout: 20_000 });
    await expect(list).toHaveCount(0);
    const back = agentPage.getByRole('button', { name: 'All conversations' });
    await expectTouchSized(back);
    const playerTab = agentPage.getByRole('tab', { name: 'Player' });
    await expectTouchSized(playerTab);
    await expectTouchSized(agentPage.getByRole('tab', { name: 'Conversation' }));
    await agentPage.waitForLoadState('networkidle');
    expect(await measureFit(agentPage)).toEqual(FITS);
    await agentPage.screenshot({ path: `kanit/472.3-archive-transcript-${tag}.png` });
    assertNoBlockingViolations(
      await scanScreen(agentPage, `Archive conversation (${tag} px)`, testInfo),
    );

    // The player panel takes the transcript's place, not a column beside it.
    await playerTab.tap();
    await expect(playerTab).toHaveAttribute('aria-selected', 'true');
    await expect(transcript).toHaveCount(0);
    await agentPage.waitForLoadState('networkidle');
    expect(await measureFit(agentPage)).toEqual(FITS);

    await back.tap();
    await expect(agentPage).not.toHaveURL(/[?&]c=/);
    await expect(row).toBeVisible();
  });
});

test.describe('Reports on a narrow window (tm 472.3)', () => {
  test('a picker chooses the report, and every report fits the window with its tables as cards', async ({
    agentPage,
  }, testInfo) => {
    test.setTimeout(240_000);
    const tag = widthTag(testInfo);
    await agentPage.goto('/app/reports');
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await expect(agentPage.getByRole('region', { name: BAND })).toHaveCount(0);

    // The sidebar's tabs are one picker, finger-sized.
    const picker = agentPage.getByRole('combobox', { name: 'Report', exact: true });
    await expectTouchSized(picker);
    await expect(agentPage.getByRole('tab')).toHaveCount(0);
    await agentPage.waitForLoadState('networkidle');
    expect(await measureFit(agentPage)).toEqual(FITS);
    expect(await tablesNotCards(agentPage)).toEqual([]);
    await agentPage.screenshot({ path: `kanit/472.3-reports-overview-${tag}.png` });

    const reports = await picker.locator('option').evaluateAll((options) =>
      options.map((option) => ({
        value: (option as HTMLOptionElement).value,
        label: option.textContent ?? '',
      })),
    );
    expect(reports.length).toBeGreaterThan(10);

    let cardTables = 0;
    const misfits: Record<string, Fit | { tables: string[] }> = {};
    for (const { value, label } of reports) {
      await picker.selectOption(value);
      const panel = agentPage.getByRole('tabpanel', { name: label });
      await expect(panel).toBeVisible();
      // Measure the report, not its skeleton: wait until nothing in it is loading.
      await expect(panel.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 });
      await agentPage.waitForLoadState('networkidle');
      cardTables += await panel.locator('table.card-table').count();
      const fit = await measureFit(agentPage);
      if (JSON.stringify(fit) !== JSON.stringify(FITS)) {
        misfits[value] = fit;
        continue;
      }
      const tables = await tablesNotCards(agentPage);
      if (tables.length > 0) misfits[value] = { tables };
    }
    expect(misfits).toEqual({});
    // The seeded workspace has rows to show: the walk did meet tables.
    expect(cardTables).toBeGreaterThan(5);

    // A report with a table, as cards: a row is a card, each value under its column's name.
    await picker.selectOption('team-performance');
    const table = agentPage.getByRole('tabpanel').locator('table.card-table').first();
    const firstValue = table.locator('tbody td').first();
    await expect(firstValue).toHaveAttribute('data-label', /\S/);
    await table.scrollIntoViewIfNeeded();
    await agentPage.screenshot({ path: `kanit/472.3-reports-cards-${tag}.png` });
    // The cards keep the table's semantics (explicit roles) and pass axe as they are.
    assertNoBlockingViolations(await scanScreen(agentPage, `Reports cards (${tag} px)`, testInfo));
  });
});
