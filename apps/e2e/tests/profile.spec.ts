/**
 * "My profile" in a browser (tm 327 · SiyahTuş analysis RL-06).
 *
 * The integration suite (`profile-password.test.ts`) proves the mechanics: the
 * trail, the hourly budget, the SSO refusal, which tokens die. What only a
 * browser shows is the walk: the account menu's "My profile", a rename the
 * menu reads back at once, and a password change that leaves this tab signed
 * in while a second browser's session ends at its next request.
 *
 * Its own freshly signed-up owner rather than a seeded account: a changed
 * password and a signed-out session would reach every other spec in the
 * shard that signs in as the seed.
 */
import type { Page } from '@playwright/test';
import { assertNoBlockingViolations, scanScreen } from './a11y.js';
import { expect, signInAs, test } from './fixtures.js';

const FIRST_PASSWORD = 'profile-e2e-first-password';
const NEW_PASSWORD = 'profile-e2e-second-password';

async function signUpOwner(page: Page): Promise<string> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `owner-${unique}@profile.test`;
  await page.goto('/signup');
  await page.getByLabel('Workspace name').fill(`Profile Co ${unique}`);
  await page.getByLabel('Your name').fill('Robin Owner');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(FIRST_PASSWORD);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'Skip setup' }).click();
  await expect(page).toHaveURL(/\/app\/inbox/);
  return email;
}

test.describe('my profile (RL-06)', () => {
  test('rename from the account menu, then change the password: this tab stays, the other browser is signed out', async ({
    page,
    browser,
  }, testInfo) => {
    const email = await signUpOwner(page);

    // A second device, signed in before the change.
    const otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    try {
      await signInAs(other, email, FIRST_PASSWORD);

      await page.getByRole('button', { name: 'Account' }).click();
      await page.getByRole('link', { name: 'My profile' }).click();
      await expect(page).toHaveURL(/\/app\/settings\/profile$/);
      await expect(page.getByRole('heading', { name: 'My profile', level: 2 })).toBeVisible();
      assertNoBlockingViolations(await scanScreen(page, 'My profile', testInfo));

      // The names: a setting, saved through the SaveBar.
      await page.getByLabel('Name', { exact: true }).fill('Robin Ownerson');
      await page.getByLabel('Name visitors see (optional)').fill('Robin');
      const saved = page.waitForResponse(
        (response) =>
          response.url().endsWith('/agents/me') && response.request().method() === 'PATCH',
      );
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      expect((await saved).status()).toBe(200);
      await expect(page.getByText('Profile saved.')).toBeVisible();

      await page.getByRole('button', { name: 'Account' }).click();
      await expect(page.getByText('Robin Ownerson', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');

      // The password: the current one, then the new one twice.
      await page.getByLabel('Current password').fill(FIRST_PASSWORD);
      await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
      await page.getByLabel('Repeat the new password').fill(NEW_PASSWORD);
      const changed = page.waitForResponse(
        (response) =>
          response.url().endsWith('/auth/password') && response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Change password' }).click();
      expect((await changed).status()).toBe(204);
      await expect(
        page.getByText('Password changed. Your other devices have been signed out.'),
      ).toBeVisible();

      // This tab carries on after a reload.
      await page.reload();
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Robin Ownerson');

      // The other browser's session ends at its next request.
      await other.reload();
      await expect(other.getByRole('button', { name: 'Sign in' })).toBeVisible();

      // The old password no longer opens the account; the new one does.
      await other.getByLabel('Email').fill(email);
      await other.getByLabel('Password').fill(FIRST_PASSWORD);
      await other.getByRole('button', { name: 'Sign in' }).click();
      await expect(other.getByRole('alert')).toBeVisible();
      await signInAs(other, email, NEW_PASSWORD);
    } finally {
      await otherContext.close();
    }
  });
});
