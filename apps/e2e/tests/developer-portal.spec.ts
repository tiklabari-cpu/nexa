/**
 * Developer portal (09.4-e) — the UI half of `/partner/apps` (09.4-c/-d).
 *
 * Proves the one thing the unit suite cannot: a real registration round-trip
 * through the actual server puts a real `client_id` and `client_secret` in
 * front of the agent, once, in the browser. The full OAuth authorize→token
 * proof that a portal-registered client actually works is 09.4-g's job; this
 * test stops at "the portal shows what the server handed back."
 *
 * The registered app is deleted at the end through the same UI (exercising the
 * confirm modal), so the run leaves the shared seed workspace as it found it.
 */
import { expect, test } from './fixtures.js';

test.describe('developer portal', () => {
  test('registers an app, shows its secret once, then deletes it', async ({ agentPage }) => {
    const name = `E2E Zap Connector ${Date.now()}`;

    await agentPage.goto('/app/developers');
    await agentPage.getByRole('button', { name: 'Register app' }).click();

    const registerDialog = agentPage.getByRole('dialog', { name: 'Register app' });
    await registerDialog.getByLabel('App name').fill(name);
    await registerDialog.getByLabel('Client type').selectOption('confidential');
    await registerDialog.getByLabel('Redirect URIs').fill('https://example.com/oauth/callback');
    await registerDialog.getByRole('checkbox', { name: 'chats--all:ro' }).check();
    await registerDialog.getByRole('button', { name: 'Register' }).click();

    // The secret-once panel: a real client_id and a real client_secret from the
    // server, not a placeholder — and the explicit "won't be shown again" notice.
    const secretDialog = agentPage.getByRole('dialog', { name: `${name} registered` });
    await expect(secretDialog.getByText(/^[0-9a-f]{32}$/)).toBeVisible();
    const secret = secretDialog.getByText(/^nxcs_/);
    await expect(secret).toBeVisible();
    await expect(secretDialog.getByText(/will not be shown again/)).toBeVisible();
    const secretText = await secret.innerText();

    await secretDialog.getByRole('button', { name: 'Done' }).click();
    await expect(agentPage.getByText(secretText)).toHaveCount(0);

    // Reload to prove the row (name, redirect URI count, scope count) came from
    // the server's own list, not from state the register call happened to leave
    // lying around client-side.
    await agentPage.reload();
    const row = agentPage.locator('li').filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row.getByText('Confidential')).toBeVisible();
    await expect(row.getByText('1 redirect URI')).toBeVisible();
    await expect(row.getByText(secretText)).toHaveCount(0);

    await row.getByRole('button', { name: `Delete ${name}` }).click();
    const deleteDialog = agentPage.getByRole('dialog', { name: `Delete ${name}?` });
    await deleteDialog.getByRole('button', { name: 'Delete app' }).click();
    await expect(agentPage.locator('li').filter({ hasText: name })).toHaveCount(0);
  });
});
