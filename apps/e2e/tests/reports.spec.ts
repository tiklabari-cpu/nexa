/**
 * Reports overview — the resolution split (FR-MOD-07.3.2, PRD §7.3.2).
 *
 * Every *closed* case is classified three ways — manual, assisted, automated —
 * and the three sum to the closed total. `automated` stays ADR-09's definition,
 * shared with the invoice, so the two never drift. This proves the cards render
 * for a signed-in agent and captures the evidence screenshot.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  test,
  API_BASE,
  NORTHWIND_OWNER,
  openWidget,
  ownerAccessToken,
  ownerAccessTokenFor,
  tenantSubdomain,
  visitorSends,
} from './fixtures.js';

/** The Reviews report's tracked-sales block (FR-MOD-13.5), as the API returns it. */
interface EcommerceBlock {
  configured: boolean;
  tracked_sales: number | null;
  attributed_revenue_cents: number | null;
  currency: string | null;
}

/**
 * The Ecommerce block for a given owner, read straight from the API.
 *
 * The screen renders exactly this, so reading it here lets a test wait for the
 * server to have processed a sale — and then assert the two agree — without the
 * UI's own caching sitting between the assertion and the fact.
 */
async function ecommerceBlock(request: APIRequestContext, token: string): Promise<EcommerceBlock> {
  const response = await request.get(`${API_BASE}/reports/reviews`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(
    response.ok(),
    `reviews report failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
  return ((await response.json()) as { ecommerce: EcommerceBlock }).ecommerce;
}

/** The Goals funnel's converted stage and the Overview's counter (FR-MOD-13.3). */
async function goalCounters(
  request: APIRequestContext,
  token: string,
): Promise<{ conversions: number; achievedGoals: number }> {
  const headers = { authorization: `Bearer ${token}` };
  const goals = await request.get(`${API_BASE}/reports/goals`, { headers });
  const overview = await request.get(`${API_BASE}/reports/overview`, { headers });
  expect(goals.ok(), `goals report failed: ${goals.status()}`).toBe(true);
  expect(overview.ok(), `overview report failed: ${overview.status()}`).toBe(true);

  const funnel = ((await goals.json()) as { funnel: { conversions: number } }).funnel;
  const totals = ((await overview.json()) as { totals: { achieved_goals: number } }).totals;
  return { conversions: funnel.conversions, achievedGoals: totals.achieved_goals };
}

/**
 * The value cell of a KPI card. Addressed from the label span outwards rather
 * than by filtering divs on their text: the first card in a grid shares the
 * grid's leading text, so a `hasText: /^Tracked sales/` filter matches the
 * wrapper as well as the card. Inside the card, spans are label, value, hint.
 */
function kpiValue(page: Page, region: string, label: string) {
  return page
    .getByRole('region', { name: region })
    .getByText(label, { exact: true })
    .locator('xpath=..')
    .locator('span')
    .nth(1);
}

/** Open Reports on a fresh navigation (never a cached SPA view) and select a tab. */
async function openReportsTab(page: Page, tab: string): Promise<void> {
  await page.goto('/app/reports');
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: tab }).click();
}

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

  test('opens the Reviews tab with CSAT, the daily bar and the seeded tracked sales (07.8, 13.5)', async ({
    agentPage,
    request,
  }) => {
    await openReportsTab(agentPage, 'Reviews');

    // The three sections of the Reviews report (FR-MOD-07.8): the CSAT donut, the
    // daily rating bar, and the tracked-sales block — each its own region.
    await expect(agentPage.getByRole('region', { name: 'Satisfaction (CSAT)' })).toBeVisible();
    await expect(agentPage.getByRole('region', { name: 'Ratings by day' })).toBeVisible();
    const ecommerce = agentPage.getByRole('region', { name: 'Ecommerce' });
    await expect(ecommerce).toBeVisible();

    // The demo tenant ships with sales tracking configured (13.5-h's seed), so
    // this is the figures state, not the "not set up" CTA — which the Settings
    // spec proves by turning tracking off.
    const block = await ecommerceBlock(request, await ownerAccessToken(request));
    expect(block.configured).toBe(true);
    expect(block.currency).toBe('USD');
    expect(block.tracked_sales).toBeGreaterThan(0);

    // The screen quotes the server rather than a figure of its own: the count
    // matches exactly, and the money card carries the same major units and the
    // ISO code as a hint. Compared against the response instead of against a
    // hard-coded seed constant, so this stays true when the fixture is retuned.
    await expect(kpiValue(agentPage, 'Ecommerce', 'Tracked sales')).toHaveText(
      String(block.tracked_sales),
    );
    const major = Math.floor((block.attributed_revenue_cents ?? 0) / 100);
    await expect(kpiValue(agentPage, 'Ecommerce', 'Attributed revenue')).toContainText(
      String(major),
    );
    await expect(ecommerce.getByText('USD', { exact: true })).toBeVisible();

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

  test('CTA opens the tab, and the promo never returns to Overview (07.6-f segment, tm 139.5)', async ({
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

    // Segment: Topics has now been opened, so the promo does not come back —
    // opening it once silences it exactly as an explicit dismiss would.
    await agentPage.getByRole('tab', { name: 'Overview' }).click();
    await expect(promo).toHaveCount(0);

    // …and it stays silenced across a full reload (which re-auths from the
    // stored refresh token) — the mark is a real localStorage write, not
    // component state.
    await agentPage.reload();
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await expect(agentPage.getByText('Top chat topics in one place')).toHaveCount(0);
  });

  test('"Remind me later" persists across a reload, without ever opening Topics (07.6-f)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/reports');
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

    const promo = agentPage.getByText('Top chat topics in one place');
    await expect(promo).toBeVisible();

    // A real localStorage dismiss — hides it, and a full reload (which
    // re-auths from the stored refresh token) keeps it hidden.
    await agentPage.getByRole('button', { name: 'Remind me later' }).click();
    await expect(promo).toHaveCount(0);
    await agentPage.reload();
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await expect(agentPage.getByText('Top chat topics in one place')).toHaveCount(0);
  });
});

/**
 * Sales tracking end to end (FR-MOD-13.5) — the one proof the eight slices of
 * 13.5 are joined to each other.
 *
 * Each piece is tested where it lives: the attribution rule in a unit test, the
 * ingest endpoint and the `ecommerce` aggregate in the integration suite, the
 * settings form and the KPI cards in jsdom, the command queue in the widget's
 * own suite. None of that fails if the *seams* are broken — a snippet whose call
 * never reaches the API, an order recorded but never aggregated, a report the
 * screen does not bind. This drives the whole chain in a browser: a visitor on a
 * real shop page chats, their checkout reports an order through
 * `nexa('trackSale', …)`, and the number that comes back is read off the agent's
 * Reports screen.
 *
 * Isolation is by host, for the same reason `goals.spec.ts` needs it: the goal
 * triggers other specs define are keyed to their own subdomains, so a visitor on
 * a subdomain of this file's own matches none of them — which is what makes the
 * "a sale is not a goal conversion" assertion below mean something.
 */
test.describe('reports — tracked sales (FR-MOD-13.5)', () => {
  test('a sale reported by the tracking code shows up in Reports → Reviews → Ecommerce', async ({
    agentPage,
    browser,
    request,
    organizationId,
  }) => {
    const stamp = Date.now().toString().slice(-6);
    const site = tenantSubdomain(`sale-${stamp}`);
    const token = await ownerAccessToken(request);
    const AMOUNT_CENTS = 6_400;

    const before = await ecommerceBlock(request, token);
    const goalsBefore = await goalCounters(request, token);
    expect(before.configured, 'the seeded demo tracks sales').toBe(true);

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    try {
      // A conversation first: attribution credits the sale to a chat this
      // visitor held inside the license's window, and without one the order is
      // recorded but not counted as attributed revenue.
      await openWidget(visitor, organizationId, { host: site.origin });
      await visitorSends(visitor, `Adding this to my basket — ${stamp}`);

      // The shop's own checkout code, called exactly as the setup snippet
      // documents it: a global on the host page, not anything inside the
      // widget's iframe, and no return value to wait on.
      await visitor.evaluate(
        ({ orderId, amountCents }) => {
          (window as unknown as { nexa: (command: string, payload: unknown) => void }).nexa(
            'trackSale',
            { external_order_id: orderId, amount_cents: amountCents, currency: 'USD' },
          );
        },
        { orderId: `E2E-${stamp}`, amountCents: AMOUNT_CENTS },
      );

      // Wait on the server, not on the page: `nexa(…)` is fire-and-forget by
      // contract (a checkout must not block on it), so nothing in the browser
      // signals that the order landed.
      await expect
        .poll(async () => (await ecommerceBlock(request, token)).tracked_sales, {
          timeout: 20_000,
        })
        .toBe((before.tracked_sales ?? 0) + 1);

      const after = await ecommerceBlock(request, token);
      expect(after.attributed_revenue_cents).toBe(
        (before.attributed_revenue_cents ?? 0) + AMOUNT_CENTS,
      );
      expect(after.currency).toBe('USD');

      // --- The agent's screen quotes it ------------------------------------
      await openReportsTab(agentPage, 'Reviews');
      await expect(kpiValue(agentPage, 'Ecommerce', 'Tracked sales')).toHaveText(
        String(after.tracked_sales),
      );
      await expect(kpiValue(agentPage, 'Ecommerce', 'Attributed revenue')).toContainText(
        String(Math.floor((after.attributed_revenue_cents ?? 0) / 100)),
      );
      await agentPage.screenshot({ path: 'kanit/13.5-reports-ecommerce.png', fullPage: true });

      // --- Idempotency: the same order reported twice ------------------------
      // A checkout page reloaded, or a merchant's at-least-once retry. The
      // second report is a replay, so the revenue figure must not move.
      await visitor.evaluate(
        ({ orderId, amountCents }) => {
          (window as unknown as { nexa: (command: string, payload: unknown) => void }).nexa(
            'trackSale',
            { external_order_id: orderId, amount_cents: amountCents, currency: 'USD' },
          );
        },
        { orderId: `E2E-${stamp}`, amountCents: AMOUNT_CENTS },
      );
      // The visitor's next round trip is the fence: once the widget has polled
      // again, the replay it sent first has been answered.
      await visitorSends(visitor, `Order placed — ${stamp}`);
      const replayed = await ecommerceBlock(request, token);
      expect(replayed.tracked_sales).toBe(after.tracked_sales);
      expect(replayed.attributed_revenue_cents).toBe(after.attributed_revenue_cents);
    } finally {
      await visitorContext.close();
    }

    // --- Consistency with the Goals funnel (FR-MOD-13.3) --------------------
    // A sale is not a goal conversion and must never be counted as one: this
    // visitor was on no goal's trigger page, so both of 13.3's counters have to
    // be exactly where they were. The two measure different events on purpose —
    // the reasoning is pinned in `trackedSalesBlock` (`routes/reports.ts`).
    const goalsAfter = await goalCounters(request, token);
    expect(goalsAfter.conversions).toBe(goalsBefore.conversions);
    expect(goalsAfter.achievedGoals).toBe(goalsBefore.achievedGoals);
  });

  test('never reports one tenant’s sales to another (13.5)', async ({ agentPage, request }) => {
    // Both seeded tenants track sales, in different currencies and with
    // different figures, so a leak shows up as a wrong number rather than as
    // nothing at all. Northwind has no conversations, so it has nothing
    // attributed — any figure there came from somewhere it should not have.
    const acme = await ecommerceBlock(request, await ownerAccessToken(request));
    const northwind = await ecommerceBlock(
      request,
      await ownerAccessTokenFor(request, NORTHWIND_OWNER),
    );

    expect(acme.currency).toBe('USD');
    expect(acme.tracked_sales).toBeGreaterThan(0);

    expect(northwind.configured).toBe(true);
    expect(northwind.currency).toBe('GBP');
    expect(northwind.tracked_sales).toBe(0);
    expect(northwind.attributed_revenue_cents).toBe(0);

    // And the screen the Acme agent is looking at shows Acme's code, not the
    // sibling's — the leak would be as visible in the currency as in the sum.
    await openReportsTab(agentPage, 'Reviews');
    const ecommerce = agentPage.getByRole('region', { name: 'Ecommerce' });
    await expect(ecommerce.getByText('USD', { exact: true })).toBeVisible();
    await expect(ecommerce.getByText('GBP', { exact: true })).toHaveCount(0);
  });
});
