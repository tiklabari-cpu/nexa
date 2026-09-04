/**
 * Icon rail — authority-based hide (FR-MOD-01.2).
 *
 * Every `NavDestination` now carries a scope (`navigation.ts`), not just
 * Developers, and `AppShell.tsx`'s rail filters `MODULES` by it. Proven here
 * against a real non-owner session rather than a mocked scope list, the same
 * discipline `settings.spec.ts`'s scheduled-exports permission test uses: a
 * unit test can pass while the rail's own `useAuth` wiring still leaks a
 * module a mocked test never renders.
 */
import { DEMO, expect, test } from './fixtures.js';

test.describe('icon rail · authority-based hide', () => {
  test('hides Billing from a plain agent session', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      // `agent2` deliberately, not `agent1`: the seed's first Acme agent is an
      // *admin* (Sam Rivera) and carries ADMIN_SCOPES, which would prove the
      // opposite of what this test claims. Priya Nair (`agent2`) holds the
      // plain agent role — no `billing_manage`/`billing_admin`/`reports_read`
      // in `DEFAULT_AGENT_SCOPES` (role-scopes.ts).
      await page.goto('/');
      await page.getByLabel('Email').fill('agent2@acme.localhost');
      await page.getByLabel('Password').fill(DEMO.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible();

      await expect(page.getByRole('link', { name: 'Billing' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Reports' })).toHaveCount(0);
      // What the same session DOES reach, so this is a hide, not a broken rail.
      await expect(page.getByRole('link', { name: 'Customers' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Team' })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('shows Billing to the seeded owner session', async ({ agentPage }) => {
    await expect(agentPage.getByRole('link', { name: 'Billing' })).toBeVisible();
  });
});
