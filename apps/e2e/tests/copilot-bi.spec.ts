/**
 * Copilot BI command — ADR-09 across two surfaces (FR-MOD-12.4).
 *
 * Every layer underneath has already been pinned: the question→metric resolver
 * against its own dictionary, the endpoint against a real Postgres, the answer
 * card against a stubbed API. None of them can prove the claim the slice
 * actually makes — that the number Copilot says out loud is the number Reports
 * is showing on the next screen. ADR-09 is a *cross-surface* invariant: the
 * endpoint calls `buildOverviewReport` (the very query `GET /reports/overview`
 * serves) instead of writing its own SQL precisely so the two can never
 * disagree, and the only honest test of "can never disagree" is to read both in
 * one browser session and compare the rendered figures.
 *
 * Both sides stay on their default window, so no date picking is involved and
 * none can be got wrong: Reports opens on 30 days (`resolveRange(30)`), and a
 * question that names no window falls through to the report's own default
 * (`biWindow(null)` → the same `resolveRange`). The seeded demo puts its
 * conversations well inside that window rather than on its edge, so the seconds
 * that pass between the two reads cannot move either figure.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

test.describe('copilot BI command (12.4)', () => {
  // Same accommodation copilot.spec makes: at the default width the transcript
  // header's right-side actions — Copilot among them — slide under the details
  // panel. This is the viewport an agent actually works in.
  test.use({ viewport: { width: 1680, height: 1050 } });

  test('answers a report question with the very figure Reports Overview shows (ADR-09)', async ({
    agentPage,
  }) => {
    // ── Read the KPIs off Reports → Overview, in its default 30-day window ──
    await agentPage.goto('/app/reports');
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

    const volume = agentPage.getByRole('region', { name: 'Volume' });
    await expect(volume).toBeVisible();
    const conversations = await kpiValue(volume, 'Conversations');
    const closed = await kpiValue(volume, 'Closed');

    // A window in which nothing happened would make the comparison below true
    // and meaningless at the same time. The seeded demo has real traffic, so
    // insist on it: this is what turns "the two agree" into evidence.
    expect(digitsOf(conversations)).toBeGreaterThan(0);
    expect(digitsOf(closed)).toBeGreaterThan(0);

    // ── Ask for the same two figures in words, from the Copilot panel ────────
    await agentPage.goto('/app/inbox');
    const copilot = await openCopilot(agentPage);

    await askBi(copilot, 'How many chats closed?');
    // `totals.closed` is the report field the answer quotes; the figure sits
    // immediately before that badge, so this asserts the metric and the number
    // together — the same number would prove nothing if it were pulled from a
    // different field.
    await expect(biFigure(copilot, 'totals.closed')).toHaveText(closed);
    // And it says where it came from, so the agent need not take its word.
    await expect(copilot.getByText('Source: Reports → Overview')).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/96-copilot-bi.png', fullPage: true });

    // A second metric, because one match could be a coincidence of the seed —
    // two different fields agreeing is the report being read, not a number
    // being guessed.
    await askBi(copilot, 'How many chats started?');
    await expect(biFigure(copilot, 'totals.chats')).toHaveText(conversations);
  });

  test('a question it cannot place gets a meaningful empty state, and an example fills the box (12.4-bi-e)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/inbox');
    const copilot = await openCopilot(agentPage);

    await askBi(copilot, 'What is the weather like?');

    // Not an empty rectangle (FR-EK-B.1) and not a fabricated figure: it says
    // it did not understand, and offers questions it does.
    await expect(copilot.getByText('Not sure what you mean')).toBeVisible();
    await expect(copilot.getByText('Source: Reports → Overview')).toHaveCount(0);

    // Clicking an example loads it into the box rather than asking it outright,
    // so the agent can read or edit it first.
    const example = 'How many chats closed this week?';
    await copilot.getByRole('button', { name: example }).click();
    await expect(copilot.getByLabel('Ask about your reports')).toHaveValue(example);
  });
});

/** Open the first seeded conversation and switch the right panel to Copilot. */
async function openCopilot(page: Page): Promise<Locator> {
  await page.getByRole('region', { name: 'Conversations' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Copilot' }).click();
  const copilot = page.getByRole('complementary', { name: 'Copilot' });
  await expect(copilot).toBeVisible();
  return copilot;
}

/** Type a report question into the BI box and send it. */
async function askBi(copilot: Locator, question: string): Promise<void> {
  await copilot.getByLabel('Ask about your reports').fill(question);
  await copilot.getByRole('button', { name: 'Ask', exact: true }).click();
}

/**
 * The headline number of a KPI card, addressed through its label.
 *
 * A `Kpi` is a label span followed by the value span (`Page.tsx`), so the value
 * is the label's next sibling — which is stable in a way "the second span in
 * the card" or a CSS class would not be.
 */
async function kpiValue(region: Locator, label: string): Promise<string> {
  const value = region
    .getByText(label, { exact: true })
    .locator('xpath=following-sibling::span[1]');
  await expect(value).toBeVisible();
  return (await value.innerText()).trim();
}

/** The figure in a BI answer card, addressed through the report field it quotes. */
function biFigure(copilot: Locator, metric: string): Locator {
  return copilot.getByText(metric, { exact: true }).locator('xpath=preceding-sibling::span[1]');
}

/** `"1,234"` → `1234`. Both surfaces format through the same `formatCount`, so the
 * strings are compared as they are; this only asks whether a figure is non-zero. */
function digitsOf(formatted: string): number {
  return Number(formatted.replace(/\D/g, ''));
}
