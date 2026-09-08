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
import { expect, signUpFreshOwner, test } from './fixtures.js';

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

  test('stepping through all five steps and finishing lands in the shell', async ({ page }) => {
    await signUpFreshOwner(page);

    await expect(page.getByText('Step 1 of 5')).toBeVisible();

    // Welcome → Website.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Connect your first website' })).toBeVisible();
    await page.getByLabel('Website domain').fill(`shop-${Date.now()}.example`);
    await page.getByRole('button', { name: 'Add website' }).click();
    await expect(page.getByText(/^Added /)).toBeVisible();

    // Website → Channels — a bridge to Settings, nothing to fill in here.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Reach customers everywhere' })).toBeVisible();

    // Channels → Company size — the two steps this task added (FR-MOD-00.4).
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'How big is your team?' })).toBeVisible();
    await page.getByLabel('Company size').selectOption('11_50');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.screenshot({ path: 'kanit/00.4-onboarding-company-size.png', fullPage: true });

    // Company → Team (skip the invite) + Sample data, on the same last step.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Invite your team' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add sample data' })).toBeVisible();
    await expect(page.getByText('Step 5 of 5')).toBeVisible();
    await page.getByRole('button', { name: 'Add sample data' }).click();
    await expect(page.getByText(/sample conversation\.$/)).toBeVisible();

    await page.getByRole('button', { name: 'Finish setup' }).click();

    await expect(page).toHaveURL(/\/app\/inbox/);
    await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toHaveCount(0);
  });

  test('reloading after seeding sample data resumes on the last step (GET /onboarding/state)', async ({
    page,
  }) => {
    await signUpFreshOwner(page);

    // Welcome → Website → Channels → Company → Team, skipping each step's
    // own form, then lay down the sample data on the last step.
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Add sample data' })).toBeVisible();
    await page.getByRole('button', { name: 'Add sample data' }).click();
    await expect(page.getByText(/sample conversation\.$/)).toBeVisible();

    // Reload before choosing "Finish setup" — the wizard re-reads
    // GET /onboarding/state and, since the demo is already down, opens
    // straight on the last step instead of back at welcome.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Invite your team' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add sample data' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sample data added' })).toBeDisabled();
    await expect(page.getByText('Sample data is already in your workspace.')).toBeVisible();

    await page.getByRole('button', { name: 'Finish setup' }).click();
    await expect(page).toHaveURL(/\/app\/inbox/);
  });
});

test.describe('signup region selection (C4-c, ADR-12)', () => {
  test('defaults to the European Union, warns the choice is permanent, and can be changed', async ({
    page,
  }) => {
    await page.goto('/signup');
    const region = page.getByLabel('Data region');
    await expect(region).toHaveValue('eu');
    await expect(
      page.getByText(/cannot be changed after your workspace is created/i),
    ).toBeVisible();

    // A real control, not a static label — and the field the signup body
    // reads from (PublicPages.tsx), not something layered on top of it.
    await region.selectOption('us');
    await expect(region).toHaveValue('us');
  });
});
