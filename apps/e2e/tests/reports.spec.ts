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
});
