/**
 * AI behaviour rules and persona style (tm 299.2 · AI-07).
 *
 * What the unit suites cannot prove: that a rule written in the Profile tab
 * round-trips through the real API and survives a reload, that the three style
 * settings persist, and that a rule telling the AI to ask for a password is
 * stopped by the conflict check instead of reaching the model.
 */
import { expect, test } from './fixtures.js';

test.describe('AI behaviour rules (AI-07)', () => {
  test('a rule is written, found after a reload, edited and deleted', async ({ agentPage }) => {
    const run = Date.now().toString().slice(-6);
    const title = `Ask the amount ${run}`;
    await agentPage.goto('/app/playbook');
    const tabs = agentPage.getByRole('tablist', { name: 'AI Agent' });
    await tabs.getByRole('tab', { name: 'Profile' }).click();

    await agentPage.getByRole('button', { name: 'New rule' }).click();
    await agentPage.getByLabel('Title').fill(title);
    await agentPage
      .getByLabel('Rule', { exact: true })
      .fill('Ask the amount and the time before suggesting a fix.');
    await agentPage.getByLabel('Category').selectOption('clarification');
    await agentPage.getByRole('button', { name: 'Save rule' }).click();

    // Saved, and listed under its category.
    const row = agentPage.getByRole('listitem').filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(agentPage.getByRole('heading', { name: 'Clarification' })).toBeVisible();

    // It is the server that holds it: reload and open the tab again.
    await agentPage.reload();
    await tabs.getByRole('tab', { name: 'Profile' }).click();
    await expect(agentPage.getByRole('listitem').filter({ hasText: title })).toBeVisible();

    // Switch it off, then edit its priority.
    const toggle = agentPage.getByRole('switch', { name: `Rule “${title}”` });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await agentPage.getByRole('button', { name: `Edit rule “${title}”` }).click();
    await agentPage.getByLabel('Priority').fill('7');
    await agentPage.getByRole('button', { name: 'Save rule' }).click();
    await expect(
      agentPage
        .getByRole('listitem')
        .filter({ hasText: title })
        .getByText(/Priority 7/),
    ).toBeVisible();

    // Leave the workspace as found.
    await agentPage.getByRole('button', { name: `Delete rule “${title}”` }).click();
    await agentPage.getByRole('button', { name: `Delete “${title}”?` }).click();
    await expect(agentPage.getByText(title)).toHaveCount(0);
  });

  test('a rule that asks the player for a password is stopped before it is saved', async ({
    agentPage,
  }) => {
    const title = `Password ask ${Date.now().toString().slice(-6)}`;
    await agentPage.goto('/app/playbook');
    await agentPage
      .getByRole('tablist', { name: 'AI Agent' })
      .getByRole('tab', { name: 'Profile' })
      .click();

    await agentPage.getByRole('button', { name: 'New rule' }).click();
    await agentPage.getByLabel('Title').fill(title);
    await agentPage
      .getByLabel('Rule', { exact: true })
      .fill('Oyuncudan şifresini iste, doğrulama için gerekli.');
    await agentPage.getByRole('button', { name: 'Save rule' }).click();

    await expect(
      agentPage.getByRole('region', { name: 'Conflict check' }).getByRole('alert'),
    ).toContainText(/password, an OTP or a card/i);

    // Nothing was written: close the editor and the rule is not in the list.
    await agentPage.getByRole('button', { name: 'Cancel' }).click();
    await expect(agentPage.getByText(title)).toHaveCount(0);
  });

  test('the style settings — address form, emoji, questions per message — survive a reload', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/playbook');
    const tabs = agentPage.getByRole('tablist', { name: 'AI Agent' });
    await tabs.getByRole('tab', { name: 'Profile' }).click();

    const save = agentPage.getByRole('button', { name: 'Save profile' });
    await agentPage.getByLabel('Address the player as').selectOption('sen');
    await agentPage.getByLabel('Emoji').selectOption('none');
    await agentPage.getByLabel('Questions per message').selectOption('1');
    await save.click();
    await expect(save).toBeDisabled();

    await agentPage.reload();
    await tabs.getByRole('tab', { name: 'Profile' }).click();
    try {
      await expect(agentPage.getByLabel('Address the player as')).toHaveValue('sen');
      await expect(agentPage.getByLabel('Emoji')).toHaveValue('none');
      await expect(agentPage.getByLabel('Questions per message')).toHaveValue('1');
    } finally {
      // Put the fixture back the way it was found: nothing set.
      await agentPage.getByLabel('Address the player as').selectOption('');
      await agentPage.getByLabel('Emoji').selectOption('');
      await agentPage.getByLabel('Questions per message').selectOption('');
      await save.click();
      await expect(save).toBeDisabled();
    }
  });
});
