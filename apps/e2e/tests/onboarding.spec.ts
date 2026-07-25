/**
 * First-run setup wizard — FR-MOD-00.4.
 *
 * The one path the unit and integration suites cannot reach: a real signup in a
 * real browser, landing on the wizard rather than an empty inbox, and both ways
 * out of it — skip straight through, or step through and finish — ending in the
 * shell. A signup creates a brand-new workspace every time (unique email), so
 * this never collides with the seeded demo tenant, which ships pre-onboarded and
 * must never see the wizard.
 */
import { expect, test } from './fixtures.js';
import type { Page } from '@playwright/test';

const PASSWORD = 'onboarding-e2e-password';

/** A fresh workspace through the public signup form; lands on the wizard. */
async function signUpFreshOwner(page: Page): Promise<void> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await page.goto('/signup');
  await page.getByLabel('Workspace name').fill(`Onboarding Co ${unique}`);
  await page.getByLabel('Your name').fill('Robin Owner');
  await page.getByLabel('Email').fill(`owner-${unique}@onboarding.test`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  // Auto-signed-in, and because the workspace is empty the shell sends the new
  // owner to the wizard rather than the inbox.
  await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/onboarding/);
}

test.describe('onboarding wizard (FR-MOD-00.4)', () => {
  test('a brand-new workspace opens on the wizard, not an empty inbox', async ({ page }) => {
    await signUpFreshOwner(page);
    // The welcome step greets the owner by name.
    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
    await page.screenshot({ path: 'kanit/22-onboarding-wizard.png', fullPage: true });
  });

  test('skipping setup lands in the shell', async ({ page }) => {
    await signUpFreshOwner(page);

    await page.getByRole('button', { name: 'Skip setup' }).click();

    // Out of the wizard and into the module shell.
    await expect(page).toHaveURL(/\/app\/inbox/);
    await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toHaveCount(0);

    // And it stays out — a reload does not send them back through setup.
    await page.reload();
    await expect(page).toHaveURL(/\/app\/inbox/);
    await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toHaveCount(0);
  });

  test('stepping through and finishing lands in the shell', async ({ page }) => {
    await signUpFreshOwner(page);

    // Welcome → Website.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Connect your first website' })).toBeVisible();
    await page.getByLabel('Website domain').fill(`shop-${Date.now()}.example`);
    await page.getByRole('button', { name: 'Add website' }).click();
    await expect(page.getByText(/^Added /)).toBeVisible();

    // Website → Team (skip the invite) → Sample data.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Invite your team' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Lay down the sample data, then finish.
    await expect(page.getByRole('heading', { name: 'Add sample data' })).toBeVisible();
    await page.getByRole('button', { name: 'Add sample data' }).click();
    await expect(page.getByText(/sample conversation\.$/)).toBeVisible();

    await page.getByRole('button', { name: 'Finish setup' }).click();

    await expect(page).toHaveURL(/\/app\/inbox/);
    await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toHaveCount(0);
  });
});
