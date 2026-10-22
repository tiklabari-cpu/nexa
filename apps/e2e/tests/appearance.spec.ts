/**
 * Panel font presets (owner, 2026-10-13), end to end: the owner sets the
 * workspace default, a member overrides it, the owner changes the default
 * again — and the later choice is what each panel paints.
 *
 * Waits on the `data-font` attribute itself rather than asserting an absence,
 * which a loading screen would satisfy too.
 */
import { expect, type Page } from '@playwright/test';
import { API_BASE, DEMO, ownerAccessToken, signInAs, test } from './fixtures.js';

const MEMBER = { email: 'agent1@acme.localhost', password: DEMO.password } as const;

async function setWorkspaceDefault(page: Page, name: RegExp): Promise<void> {
  await page.goto('/app/settings/appearance');
  await page.getByRole('radio', { name }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/^Saved — /)).toBeVisible();
}

async function pickOwnFont(page: Page, value: string): Promise<void> {
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('combobox', { name: 'Font' }).selectOption(value);
}

const html = (page: Page) => page.locator('html');

test.describe('panel font presets', () => {
  test.afterEach(async ({ request }) => {
    // Account- and workspace-scoped state outlives the test: put the workspace
    // back on the built-in look for every spec after this one.
    const token = await ownerAccessToken(request);
    await request.put(`${API_BASE}/settings/appearance`, {
      headers: { authorization: `Bearer ${token}` },
      data: { font_preset: null },
    });
  });

  test('the later choice wins: owner default, member override, owner again', async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const memberContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const member = await memberContext.newPage();
    try {
      await signInAs(owner, DEMO.email, DEMO.password);
      await setWorkspaceDefault(owner, /Figtree/);
      await expect(html(owner)).toHaveAttribute('data-font', 'figtree');

      await signInAs(member, MEMBER.email, MEMBER.password);
      await expect(html(member)).toHaveAttribute('data-font', 'figtree');

      await pickOwnFont(member, 'nunito');
      await expect(html(member)).toHaveAttribute('data-font', 'nunito');
      await expect(member.getByTestId('font-source')).toContainText('Your choice: Nunito');

      await setWorkspaceDefault(owner, /Manrope \+ DM Sans/);
      await member.reload();
      await expect(html(member)).toHaveAttribute('data-font', 'manrope-dm-sans');

      // Back to "Workspace default" for the member, so nothing leaks onward.
      await pickOwnFont(member, '');
      await expect(member.getByTestId('font-source')).toContainText('Workspace default');
    } finally {
      await ownerContext.close();
      await memberContext.close();
    }
  });
});
