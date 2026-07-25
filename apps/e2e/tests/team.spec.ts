/**
 * The Team invite modal, and the dirty guard that protects half-typed work.
 *
 * A modal full of addresses is real effort. Before this, Cancel — or a stray
 * click — threw it away silently; no modal in the app asked. FR-EK-A.2 makes
 * closing a *dirty* form confirm first, while an untouched one still closes
 * without nagging. Both halves matter: a guard that always asks is as annoying
 * as one that never does.
 */
import { expect, test } from './fixtures.js';

test.describe('invite teammates — dirty guard (FR-EK-A.2)', () => {
  test('a dirty modal asks before discarding, and keeps the work if you decline', async ({
    agentPage,
  }) => {
    await agentPage.getByRole('link', { name: 'Team' }).click();
    await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();

    await agentPage.getByRole('button', { name: 'Invite teammates' }).click();
    const dialog = agentPage.getByRole('dialog', { name: 'Invite teammates' });
    await expect(dialog).toBeVisible();

    // Half-typed work: one good address entered but not yet sent.
    await dialog.getByLabel('Email addresses').fill('sam@example.com');

    // Decline the discard: the browser confirm fires with our wording, we say
    // no, and the modal must still be there with the address intact.
    let asked: string | null = null;
    agentPage.once('dialog', (d) => {
      asked = d.message();
      return d.dismiss();
    });
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect.poll(() => asked).toBe('Discard the addresses you have typed?');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Email addresses')).toHaveValue('sam@example.com');

    // Accept the discard: now it closes.
    agentPage.once('dialog', (d) => d.accept());
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('an untouched modal closes without asking', async ({ agentPage }) => {
    await agentPage.getByRole('link', { name: 'Team' }).click();
    await agentPage.getByRole('button', { name: 'Invite teammates' }).click();
    const dialog = agentPage.getByRole('dialog', { name: 'Invite teammates' });
    await expect(dialog).toBeVisible();

    // Any confirm here is a failure: a clean form has nothing to discard.
    let nagged = false;
    agentPage.on('dialog', (d) => {
      nagged = true;
      return d.dismiss();
    });
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect(dialog).toBeHidden();
    expect(nagged).toBe(false);
  });
});
