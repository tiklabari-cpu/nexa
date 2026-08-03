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
});
