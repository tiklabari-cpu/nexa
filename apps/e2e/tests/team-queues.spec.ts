/**
 * Team topic queues in the console (tm 305.4 · AU-01 · K14).
 *
 * The path the unit suites cannot walk: a real workspace runs the "iGaming
 * queue template" from Team › Teams, gets the six topic teams with the
 * Responsible Gambling team holding its training, finds that team locked in
 * its editor (no delete, topic fixed), and sees the Inbox's Queued view split
 * by those teams. A fresh signup, not the seeded demo tenant: the template's
 * Responsible Gambling team can never be deleted again, so it must not land in
 * a workspace every other spec reads.
 */
import { expect, signUpFreshOwner, test } from './fixtures.js';

const TOPIC_TEAMS = [
  'Finance',
  'KYC / Risk',
  'Bonus',
  'Responsible Gambling',
  'Technical',
  'Complaints',
];

test.describe('team topic queues (AU-01 · K14)', () => {
  test('the iGaming template sets up six topic teams, Responsible Gambling stays locked, and the Queued view splits by team (FR-MOD-08.6.1 · FR-MOD-04.5)', async ({
    page,
  }) => {
    await signUpFreshOwner(page);
    await page.getByRole('button', { name: 'Skip setup' }).click();
    await expect(page).toHaveURL(/\/app\/inbox/);

    await page.goto('/app/team/teams');
    await page.getByRole('button', { name: 'Set up iGaming queues' }).click();
    const template = page.getByRole('dialog', { name: 'Set up the iGaming queue template' });
    // A preview first: nothing is served yet, so every topic is to be made.
    await expect(template.getByText(/^Creates “/)).toHaveCount(6);
    await template.getByRole('button', { name: 'Create 6 teams' }).click();
    await expect(template).toBeHidden();

    for (const name of TOPIC_TEAMS) {
      await expect(page.getByRole('heading', { name, level: 3, exact: true })).toBeVisible();
    }
    await expect(page.getByText('Topic: Responsible gambling')).toBeVisible();
    await page.screenshot({ path: 'kanit/au-01-queue-template.png', fullPage: true });

    // The Responsible Gambling team: topic fixed, no delete, its training required.
    await page.getByRole('button', { name: 'Edit team — Responsible Gambling' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit team — Responsible Gambling' });
    await expect(editor.getByLabel('Topic queue')).toBeDisabled();
    await expect(editor.getByLabel('Topic queue')).toHaveValue('responsible_gambling');
    await expect(editor.getByLabel('Responsible gambling training')).toBeChecked();
    await expect(editor.getByRole('button', { name: 'Delete team' })).toHaveCount(0);
    await editor.getByLabel('Responsible gambling training').uncheck();
    await expect(editor.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    page.once('dialog', (confirm) => confirm.accept());
    await editor.getByRole('button', { name: 'Cancel' }).click();
    await expect(editor).toBeHidden();

    // Running it again makes nothing: every topic is served now.
    await page.getByRole('button', { name: 'Set up iGaming queues' }).click();
    await expect(template.getByText('Every topic already has a team.')).toBeVisible();
    await expect(template.getByText(/^Served by “/)).toHaveCount(6);
    await expect(template.getByRole('button', { name: 'Create 0 teams' })).toBeDisabled();
    await template.getByRole('button', { name: 'Cancel' }).click();

    // The Inbox's Queued view, split by team — topic queues first.
    await page.goto('/app/inbox');
    await page
      .getByRole('navigation', { name: 'Inbox views' })
      .getByRole('button', { name: /^Queued/ })
      .click();
    const tabs = page.getByRole('tablist', { name: 'Team queues' });
    await expect(tabs.getByRole('tab')).toHaveText([
      /^All teams/,
      /^Finance/,
      /^KYC \/ Risk/,
      /^Bonus/,
      /^Responsible Gambling/,
      /^Technical/,
      /^Complaints/,
      /^General/,
    ]);
    await tabs.getByRole('tab', { name: /^Finance/ }).click();
    await expect(tabs.getByRole('tab', { name: /^Finance/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.screenshot({ path: 'kanit/au-01-queue-tabs.png', fullPage: true });
  });
});
