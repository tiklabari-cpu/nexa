/**
 * Adding the AI agent to a new workspace (tm 390.2).
 *
 * What the unit suites cannot prove: that a brand-new sign-up — which has no AI
 * agent — can make one from Playbook › AI Agent against the real API, lands on
 * its General settings, can set the widget welcome message there and find it
 * again after a reload, and that Settings › AI Agent and the old `?view=profile`
 * address lead to the same tab. Each sign-up is a workspace of its own, so the
 * seeded demo tenant (which already has Ada) is never touched.
 */
import { expect, signUpFreshOwner, test } from './fixtures.js';

test.describe('AI agent creation (tm 390.2)', () => {
  test('a new workspace adds its AI agent, sets the welcome message, and finds the tab from Settings', async ({
    page,
  }) => {
    await signUpFreshOwner(page);
    await page.getByRole('button', { name: 'Skip setup' }).click();
    await expect(page).toHaveURL(/\/app\/inbox/);

    // No agent yet: Playbook opens on the "add" card, not on a persona form.
    await page.goto('/app/playbook');
    await expect(page.getByRole('heading', { name: 'Add an AI agent' })).toBeVisible();
    await page.screenshot({ path: 'kanit/390-ai-agent-create-empty.png', fullPage: true });

    const name = `Mina ${Date.now().toString().slice(-6)}`;
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Tone').fill('Warm and brief');
    await page.getByRole('button', { name: 'Add AI agent' }).click();

    // The persona form opens on the new agent, which starts switched off.
    const tabs = page.getByRole('tablist', { name: 'AI Agent' });
    await expect(tabs.getByRole('tab', { name: 'General settings' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByLabel('Name')).toHaveValue(name);
    await expect(page.getByLabel('Tone')).toHaveValue('Warm and brief');
    await expect(page.getByRole('heading', { name: 'Set-up steps' })).toBeVisible();
    // Created switched off, and nothing to answer from yet, so it cannot be resumed.
    await expect(page.getByRole('button', { name: 'Resume' })).toBeDisabled();

    // The welcome message is the widget's: saved here, served from there.
    const welcome = `Hi, I am ${name}`;
    await page.getByLabel('Title').fill(welcome);
    await page.getByRole('button', { name: 'Save welcome message' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Title')).toHaveValue(welcome);

    // A second agent is not offered: the card is gone for good.
    await expect(page.getByRole('heading', { name: 'Add an AI agent' })).toHaveCount(0);

    // Behaviour is its own tab and the behaviour cards live there.
    await tabs.getByRole('tab', { name: 'Behaviour' }).click();
    await expect(page.getByRole('heading', { name: 'Behaviour rules' })).toBeVisible();
    await expect(page).toHaveURL(/view=behaviour/);

    // The old address still opens the persona.
    await page.goto('/app/playbook?view=profile');
    await expect(tabs.getByRole('tab', { name: 'General settings' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByLabel('Name')).toHaveValue(name);

    // Settings › AI Agent is a door to the same tab.
    await page.goto('/app/settings/company');
    await page
      .getByRole('navigation', { name: 'Settings navigation' })
      .getByRole('link', { name: 'AI Agent' })
      .click();
    await expect(page).toHaveURL(/\/app\/playbook\?view=general/);
    await expect(page.getByLabel('Name')).toHaveValue(name);
  });

  test('the command palette finds the AI Agent by its English and Turkish names', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/inbox');
    for (const needle of ['ai agent', 'yapay zekâ']) {
      // The shortcut is bound once the shell has mounted.
      await expect(agentPage.getByRole('navigation', { name: 'Modules' })).toBeVisible();
      await agentPage.keyboard.press('ControlOrMeta+k');
      const palette = agentPage.getByRole('dialog', { name: 'Command palette' });
      await expect(palette).toBeVisible();
      await palette.getByRole('combobox', { name: 'Search or jump to' }).fill(needle);
      await palette
        .getByRole('option', { name: /AI Agent/ })
        .first()
        .click();
      await expect(agentPage).toHaveURL(/\/app\/playbook\?view=general/);
      await agentPage.goto('/app/inbox');
    }
  });
});
