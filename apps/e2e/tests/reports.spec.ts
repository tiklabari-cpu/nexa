/**
 * Reports overview — the resolution split (FR-MOD-07.3.2, PRD §7.3.2).
 *
 * Every *closed* case is classified three ways — manual, assisted, automated —
 * and the three sum to the closed total. `automated` stays ADR-09's definition,
 * shared with the invoice, so the two never drift. This proves the cards render
 * for a signed-in agent and captures the evidence screenshot.
 */
import { expect, test } from './fixtures.js';

test.describe('reports overview', () => {
  test('shows the manual / assisted / automated resolution split', async ({ agentPage }) => {
    await agentPage.goto('/app/reports');
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

    // The three-way split lives in its own section, accessible by its heading.
    const resolution = agentPage.getByRole('region', { name: 'Resolution' });
    await expect(resolution).toBeVisible();
    await expect(resolution.getByText('Manual', { exact: true })).toBeVisible();
    await expect(resolution.getByText('Assisted', { exact: true })).toBeVisible();
    await expect(resolution.getByText('Automated', { exact: true })).toBeVisible();

    // Total cases (chats + tickets) sits in Volume alongside the split.
    await expect(agentPage.getByText('Total cases', { exact: true })).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/20-reports-resolution.png', fullPage: true });
  });

  test('navigates the Overview / AI Agent / Breakdown tabs (07.1)', async ({ agentPage }) => {
    await agentPage.goto('/app/reports');
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

    // Overview is the default tab.
    await expect(agentPage.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // AI Agent (FR-MOD-07.4): its own resolution/deflection cards.
    await agentPage.getByRole('tab', { name: 'AI Agent' }).click();
    await expect(agentPage.getByText('AI resolutions', { exact: true })).toBeVisible();
    await agentPage.screenshot({ path: 'kanit/21-reports-ai-agent.png', fullPage: true });

    // Breakdown (FR-MOD-07.5): the split resolved by day, by agent, by hour
    // (07.5-g) and — this task — by team and by channel.
    await agentPage.getByRole('tab', { name: 'Breakdown' }).click();
    await expect(agentPage.getByRole('region', { name: 'By day' })).toBeVisible();
    await expect(agentPage.getByRole('region', { name: 'By hour' })).toBeVisible();
    await expect(agentPage.getByRole('region', { name: 'By team' })).toBeVisible();
    await expect(agentPage.getByRole('region', { name: 'By channel' })).toBeVisible();
    await agentPage.screenshot({ path: 'kanit/21-reports-breakdown.png', fullPage: true });
  });

  test('opens the Reviews tab with CSAT, the daily bar and the sales skeleton (07.8)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/reports');
    await agentPage.getByRole('tab', { name: 'Reviews' }).click();

    // The three sections of the Reviews report (FR-MOD-07.8): the CSAT donut, the
    // daily rating bar, and the tracked-sales skeleton — each its own region.
    await expect(agentPage.getByRole('region', { name: 'Satisfaction (CSAT)' })).toBeVisible();
    await expect(agentPage.getByRole('region', { name: 'Ratings by day' })).toBeVisible();
    await expect(agentPage.getByRole('region', { name: 'Ecommerce' })).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/22-reports-reviews.png', fullPage: true });
  });

  /**
   * Cases and Leads (07.7-i) — the v2 report groups, whose tabs are permission-gated
   * on `GET /reports/groups` rather than always rendered (unlike the tabs above).
   * The seeded demo agent holds `reports_read`, which grants every group, so this is
   * the tab's *visibility* proof end-to-end; the figures themselves are covered
   * server-side (`reports-billing.test.ts` "Cases report (07.7-a)" / "Leads report
   * (07.7-b)") and the full permission matrix is 07.7-l's job, not this one's.
   */
  test('opens the Cases and Leads tabs, each a permission-gated report group (07.7-i)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/reports');
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

    await agentPage.getByRole('tab', { name: 'Cases' }).click();
    await expect(agentPage.getByRole('tab', { name: 'Cases' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(agentPage.getByRole('region', { name: 'By status' })).toBeVisible();
    await expect(agentPage.getByRole('region', { name: 'By priority' })).toBeVisible();

    await agentPage.getByRole('tab', { name: 'Leads' }).click();
    await expect(agentPage.getByRole('tab', { name: 'Leads' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Scoped to Volume: the Leads by-day table below shares the same column
    // header text as this KPI's label.
    const leadsVolume = agentPage.getByRole('region', { name: 'Volume' });
    await expect(leadsVolume).toBeVisible();
    await expect(leadsVolume.getByText('New leads', { exact: true })).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/24-reports-cases-leads.png', fullPage: true });
  });

  /**
   * Sales and Team performance (07.7-j) — join Cases/Leads as v2 report groups
   * gated on `GET /reports/groups`. The seeded demo agent holds `reports_read`,
   * which grants every group, so this is the tab's *visibility* proof
   * end-to-end; Sales is honestly unconfigured in v1 (FR-MOD-13.5 dependency,
   * covered server-side by `reports-billing.test.ts` "Sales report (07.7-d)")
   * and Team performance's figures are covered server-side too ("Team
   * performance report (07.7-c)") — this only proves both tabs open and render
   * their region.
   */
  test('opens the Sales and Team performance tabs, each a permission-gated report group (07.7-j)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/reports');
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

    await agentPage.getByRole('tab', { name: 'Sales' }).click();
    await expect(agentPage.getByRole('tab', { name: 'Sales' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(agentPage.getByRole('region', { name: 'Sales' })).toBeVisible();

    await agentPage.getByRole('tab', { name: 'Team performance' }).click();
    await expect(agentPage.getByRole('tab', { name: 'Team performance' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(agentPage.getByRole('region', { name: 'Team performance' })).toBeVisible();

    await agentPage.screenshot({
      path: 'kanit/25-reports-sales-team-performance.png',
      fullPage: true,
    });
  });

  /**
   * Export + Save view (07.7-k) — the two controls added to the header
   * actions row. Export hits the same `/reports/export` the backend has
   * served since v1 (`toCsv`, `reports-export.ts`); the seeded demo agent
   * holds `reports_read`, so Overview's control is visible ("İzin bazlı
   * görünürlük" end-to-end). Save view goes through a real reload — not a
   * React remount — the same proof the "Remind me later" persistence test
   * above uses, so this is genuinely `localStorage`, not in-memory state.
   */
  test('exports the active tab as a CSV download, and a saved view survives a reload (07.7-k)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/reports');
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

    const downloadPromise = agentPage.waitForEvent('download');
    await agentPage.getByRole('button', { name: 'Export' }).click();
    const download = await downloadPromise;
    // Server-named (`exportFilename`, `reports-export.ts`): the group and the
    // window as two UTC dates — proof the browser kept the name the
    // `content-disposition` header sent, not one it invented locally.
    expect(download.suggestedFilename()).toMatch(
      /^nexa-overview-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/,
    );

    await agentPage.getByRole('button', { name: 'Saved views' }).click();
    await agentPage.getByLabel('Save this view').fill('Overview default');
    // `exact` matters: Playwright's default fuzzy match would also hit the
    // "Saved views" trigger, which contains "Save" as a substring.
    await agentPage.getByRole('button', { name: 'Save', exact: true }).click();

    await agentPage.reload();
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await agentPage.getByRole('button', { name: 'Saved views' }).click();
    await expect(
      agentPage.getByRole('button', { name: 'Overview default', exact: true }),
    ).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/26-reports-export-save-view.png', fullPage: true });
  });

  /**
   * The whole 07.7 surface in one pass (07.7-l) — the sequence a person actually
   * performs, rather than the pieces each slice proved on its own: open the
   * page, see every tab the catalogue grants, read a benchmark badge, download
   * the report in both formats, save the view, and come back to it after a
   * reload. Each step is covered above in isolation; what this adds is that they
   * compose in one session, against a real browser and a real server.
   *
   * The seeded demo agent holds `reports_read`, which grants every group, so
   * this is the "İzin bazlı görünürlük" case where everything is visible; the
   * refusing half of the matrix is server-side, where a token can be minted
   * without one (`reports-billing.test.ts`, "permission matrix").
   */
  test('walks every granted tab, reads a benchmark badge, downloads CSV and PDF, and returns to a saved view (07.7-l)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/reports');
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

    // Six always-rendered tabs plus the four gated on `GET /reports/groups`.
    const TABS = [
      'Overview',
      'AI Agent',
      'Reviews',
      'Breakdown',
      'Staffing',
      'Chat topics',
      'Cases',
      'Leads',
      'Sales',
      'Team performance',
    ];
    for (const name of TABS) {
      await expect(agentPage.getByRole('tab', { name })).toBeVisible();
    }

    // Benchmark comparison, end to end: the Overview KPIs carry a vs-previous
    // badge derived from the `previous_period` block every group returns. Both
    // of the badge's wordings ("No change vs previous" / "↑ n vs previous") end
    // the same way, so this matches whichever the seeded window produces.
    await expect(agentPage.getByText(/vs previous/).first()).toBeVisible();

    // Both formats, each through a real browser download, each named by the
    // server (`exportFilename`) for the group and window.
    for (const format of ['csv', 'pdf'] as const) {
      await agentPage.getByLabel('Export format').selectOption(format);
      const downloadPromise = agentPage.waitForEvent('download');
      await agentPage.getByRole('button', { name: 'Export' }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(
        new RegExp(`^nexa-overview-\\d{4}-\\d{2}-\\d{2}-\\d{4}-\\d{2}-\\d{2}\\.${format}$`),
      );
    }

    // A saved view captures the tab as well as the range, so saving from Team
    // performance, navigating away and reloading must land back on that tab —
    // which is the part a same-tab save could never prove.
    await agentPage.getByRole('tab', { name: 'Team performance' }).click();
    await agentPage.getByRole('button', { name: 'Saved views' }).click();
    await agentPage.getByLabel('Save this view').fill('Team last 30 days');
    await agentPage.getByRole('button', { name: 'Save', exact: true }).click();

    await agentPage.getByRole('tab', { name: 'Overview' }).click();
    await agentPage.reload();
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await expect(agentPage.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await agentPage.getByRole('button', { name: 'Saved views' }).click();
    await agentPage.getByRole('button', { name: 'Team last 30 days', exact: true }).click();
    await expect(agentPage.getByRole('tab', { name: 'Team performance' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await agentPage.screenshot({ path: 'kanit/27-reports-full-sweep.png', fullPage: true });
  });
});

/**
 * Chat topics (FR-MOD-07.6) — the last surface of the 07.6 slice the suite did
 * not yet touch. The seeded demo ships four thematically distinct closed-topic
 * groups (`CHAT_TOPIC_GROUPS`, six conversations each), which together clear
 * `TOPIC_MIN_CONVERSATIONS`, so the tab renders the full clustered table here —
 * whereas a window with no seeded conversations must fall to the honest "not
 * enough data" empty state (the "yeterli veri yoksa empty" acceptance criterion).
 * The Overview promo band and its persistent "Remind me later" dismiss (07.6-f)
 * are exercised through a real reload, so the localStorage persistence is proven
 * against the browser and not just a React remount.
 */
test.describe('reports — chat topics (FR-MOD-07.6)', () => {
  test('clusters conversations into topic rows with volume and trend', async ({ agentPage }) => {
    await agentPage.goto('/app/reports');
    await agentPage.getByRole('tab', { name: 'Chat topics' }).click();
    await expect(agentPage.getByRole('tab', { name: 'Chat topics' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // The report is its own region; its description names the AI clustering that
    // produced the rows ("AI kümeleme").
    const topics = agentPage.getByRole('region', { name: 'Chat topics' });
    await expect(topics).toBeVisible();
    await expect(topics.getByText('grouped into topics by AI clustering')).toBeVisible();

    // The seeded demo clears the floor, so the full table renders rather than the
    // empty state: Volume + Trend columns and at least one clustered topic row
    // that carries a volume value ("hacim/trend").
    await expect(topics.getByRole('columnheader', { name: 'Volume' })).toBeVisible();
    await expect(topics.getByRole('columnheader', { name: 'Trend' })).toBeVisible();
    const dataRows = topics.locator('tbody tr');
    expect(await dataRows.count()).toBeGreaterThanOrEqual(1);
    await expect(dataRows.first()).toContainText(/\d/);
    // A topic new to this window shows the honest em-dash, never a fabricated 0%.
    await expect(topics.getByText('—').first()).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/23-reports-topics.png', fullPage: true });
  });

  test('falls to the not-enough-data empty state for a window with no conversations', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/reports');
    await agentPage.getByRole('tab', { name: 'Chat topics' }).click();

    // A historical week with no seeded conversations sits below the floor.
    await agentPage.getByRole('button', { name: 'Custom' }).click();
    await agentPage.getByLabel('Start date').fill('2020-01-01');
    await agentPage.getByLabel('End date').fill('2020-01-07');

    // A meaningful empty state — not an empty rectangle (EK-B.1) — is the end-to-end
    // proof of the "yeterli veri yoksa empty" acceptance criterion.
    await expect(agentPage.getByText('Not enough conversations yet')).toBeVisible();
    // And it is genuinely the empty state, not a table left showing zero rows.
    await expect(agentPage.getByRole('columnheader', { name: 'Volume' })).toHaveCount(0);

    await agentPage.screenshot({ path: 'kanit/23-reports-topics-empty.png', fullPage: true });
  });

  test('Overview promo opens the tab, and "Remind me later" persists across a reload (07.6-f)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/reports');
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

    const promo = agentPage.getByText('Top chat topics in one place');
    await expect(promo).toBeVisible();

    // "See chat topics" switches to the tab in place; the banner is Overview-only,
    // so it is gone once the topics tab is showing.
    await agentPage.getByRole('button', { name: 'See chat topics' }).click();
    await expect(agentPage.getByRole('tab', { name: 'Chat topics' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(promo).toHaveCount(0);

    // Back on Overview it returns — it has not been dismissed yet…
    await agentPage.getByRole('tab', { name: 'Overview' }).click();
    await expect(promo).toBeVisible();

    // …until "Remind me later" — a real localStorage dismiss — hides it, and a full
    // reload (which re-auths from the stored refresh token) keeps it hidden.
    await agentPage.getByRole('button', { name: 'Remind me later' }).click();
    await expect(promo).toHaveCount(0);
    await agentPage.reload();
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await expect(agentPage.getByText('Top chat topics in one place')).toHaveCount(0);
  });
});
