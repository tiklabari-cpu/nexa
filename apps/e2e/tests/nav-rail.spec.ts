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

/**
 * The logo's app menu (FR-MOD-01.1.1) — closed by default, the rail's only
 * way to the apps marketplace (`Integrations.tsx`'s own comment: that route
 * carries no rail icon of its own, so without this entry it is reachable only
 * by typing the URL).
 */
test.describe('logo app menu (FR-MOD-01.1.1)', () => {
  test('opens from the logo, keyboard included, and reaches the apps marketplace', async ({
    agentPage,
  }) => {
    const trigger = agentPage.getByRole('button', { name: 'App menu' });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // Enter/Space on a `<summary>` is native browser behaviour, not something
    // Testing Library's jsdom environment reproduces (AppShell.test.tsx opens
    // this same menu with a click for exactly that reason) — this is the one
    // place it is proven for real.
    await trigger.focus();
    await agentPage.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const appsLink = agentPage.getByRole('link', { name: 'Apps' });
    await expect(appsLink).toBeVisible();
    await agentPage.screenshot({ path: 'kanit/01.1.1-app-menu.png', fullPage: true });

    // Escape closes it and hands focus back — proven generically by
    // `Dropdown.test.tsx`; reopened here with a click for the navigation half.
    await agentPage.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();

    await trigger.click();
    await agentPage.getByRole('link', { name: 'Apps' }).click();
    await expect(agentPage).toHaveURL(/\/app\/apps$/);
    await expect(agentPage.getByRole('heading', { name: 'Apps', level: 1 })).toBeVisible();
  });
});
