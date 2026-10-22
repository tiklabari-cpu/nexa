/**
 * The permission matrix, in a browser (RL-02 · tm 325.4).
 *
 * The integration suites prove the mechanics (`permission-matrix.test.ts`:
 * floors, locks, audit, tenancy; `permission-session.test.ts`: a change
 * reaching an open session on its next request). What only a browser shows is
 * the Kurucu's whole walk — Save → before/after → reason → confirm (GV-06) —
 * and a signed-in Team Lead reading the result on "My permissions" without
 * signing in again.
 *
 * Self-cleaning, which the shard's shared seeded database requires: the cell
 * is put back through the screen's own "Reset to default", and once more
 * through the API in `finally` (a no-op when the screen already did it) —
 * `team.spec.ts` asserts the seeded Team Lead has no Reports link.
 */
import type { Page } from '@playwright/test';
import { assertNoBlockingViolations, scanScreen } from './a11y.js';
import { ACME_TEAM_LEAD, API_BASE, expect, ownerAccessToken, test } from './fixtures.js';

const CELL = 'View reports — Team Lead';

async function confirmWithReason(page: Page, reason: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Confirm this change' });
  await expect(dialog.getByTestId('high-risk-diff')).toBeVisible();
  await dialog.getByLabel('Reason').fill(reason);
  await dialog.getByRole('button', { name: 'Confirm and save' }).click();
}

function waitForPut(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.url().endsWith('/settings/permissions') && response.request().method() === 'PUT',
  );
}

test.describe('permission matrix (RL-02)', () => {
  test('the Owner lends a Team Lead the reports, the open session sees it, and the Owner takes it back', async ({
    agentPage,
    browser,
    request,
  }, testInfo) => {
    // The Team Lead is signed in first: the change must reach this session.
    const leadContext = await browser.newContext();
    const lead = await leadContext.newPage();

    try {
      await lead.goto('/');
      await lead.getByLabel('Email').fill(ACME_TEAM_LEAD.email);
      await lead.getByLabel('Password').fill(ACME_TEAM_LEAD.password);
      await lead.getByRole('button', { name: 'Sign in' }).click();
      await expect(lead.getByRole('link', { name: 'Inbox' })).toBeVisible();

      await lead.goto('/app/settings/my-permissions');
      await expect(lead.getByText('Your role: Team Lead')).toBeVisible();
      const leadReports = lead.locator('dd[data-capability="reports.view"]');
      await expect(leadReports).toHaveText('None');
      // The matrix itself is Admin and up: no door, and the address goes back.
      const leadNav = lead.getByRole('navigation', { name: 'Settings navigation' });
      await expect(leadNav.getByRole('link', { name: 'My permissions' })).toBeVisible();
      await expect(leadNav.getByRole('link', { name: 'Roles and permissions' })).toHaveCount(0);

      // The Owner's walk.
      await agentPage.goto('/app/settings/permissions');
      const reportsRow = agentPage.locator('tr[data-capability="reports.view"]');
      // The Owner column is locked and says why.
      await expect(reportsRow.locator('[data-locked="owner_column"]')).toBeVisible();
      await expect(agentPage.getByRole('combobox', { name: CELL })).toHaveValue('none');

      const saved = waitForPut(agentPage);
      await agentPage.getByRole('combobox', { name: CELL }).selectOption('all');
      await agentPage.getByRole('button', { name: 'Save' }).click();
      const dialog = agentPage.getByRole('dialog', { name: 'Confirm this change' });
      await expect(dialog.getByText(CELL)).toBeVisible();
      await confirmWithReason(agentPage, 'e2e: leads run their weekly review');
      const response = await saved;
      expect(response.status()).toBe(200);
      expect(response.request().postDataJSON()).toEqual({
        changes: [{ role: 'team_lead', capability: 'reports.view', value: 'all' }],
        reason: 'e2e: leads run their weekly review',
      });

      // Read back from the server, marked as the workspace's choice.
      await agentPage.reload();
      await expect(agentPage.getByRole('combobox', { name: CELL })).toHaveValue('all');
      await expect(reportsRow.getByText('Changed')).toBeVisible();
      // Locks, switches, level pickers and a reset button all on screen at once.
      assertNoBlockingViolations(await scanScreen(agentPage, 'Roles and permissions', testInfo));

      // The open session, without signing in again.
      await lead.reload();
      await expect(leadReports).toHaveText('All');
      assertNoBlockingViolations(await scanScreen(lead, 'My permissions', testInfo));

      // Back to the default, through the screen.
      const restored = waitForPut(agentPage);
      await agentPage.getByRole('button', { name: `Reset ${CELL} to the default (None)` }).click();
      await agentPage.getByRole('button', { name: 'Save' }).click();
      await confirmWithReason(agentPage, 'e2e: back to the default');
      const restoredResponse = await restored;
      expect(restoredResponse.status()).toBe(200);
      expect(restoredResponse.request().postDataJSON()).toMatchObject({
        changes: [{ role: 'team_lead', capability: 'reports.view', value: 'none' }],
      });
      await expect(reportsRow.getByText('Changed')).toHaveCount(0);

      await lead.reload();
      await expect(leadReports).toHaveText('None');
    } finally {
      await leadContext.close();
      const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
      const put = await request.put(`${API_BASE}/settings/permissions`, {
        headers: auth,
        data: {
          changes: [{ role: 'team_lead', capability: 'reports.view', value: 'none' }],
          reason: 'e2e: restore the seeded matrix',
        },
      });
      expect(put.status()).toBe(200);
    }
  });
});
