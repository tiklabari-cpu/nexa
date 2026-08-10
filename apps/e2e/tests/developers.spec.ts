/**
 * Developer portal — webhooks tab (09.4-f), the REST Hooks half of `/webhooks`
 * (tm 34) that no screen consumed until this turn.
 *
 * Proves the round-trip through the real server: subscribe a webhook from the
 * portal, see its signing secret exactly once, confirm the row came back from
 * the server's own list, then remove it through the confirm modal — leaving
 * the shared seed workspace as it found it, the same discipline
 * `developer-portal.spec.ts` uses for partner apps.
 */
import { expect, test } from './fixtures.js';

test.describe('developer portal · webhooks', () => {
  test('subscribes a webhook, shows its secret once, then removes it', async ({ agentPage }) => {
    const url = `https://hooks.e2e.example/${Date.now()}`;

    await agentPage.goto('/app/developers');
    await agentPage.getByRole('tab', { name: 'Webhooks' }).click();

    await agentPage.getByLabel('URL').fill(url);
    await agentPage.getByLabel('Event').selectOption('chat_started');
    await agentPage.getByRole('button', { name: 'Subscribe' }).click();

    // A real signing secret from the server, shown once, with the explicit
    // "won't be shown again" notice — same discipline as a partner app's secret.
    const secretDialog = agentPage.getByRole('dialog', { name: 'Webhook subscribed' });
    const secret = secretDialog.getByText(/^whsec_/);
    await expect(secret).toBeVisible();
    await expect(secretDialog.getByText(/will not be shown again/)).toBeVisible();
    const secretText = await secret.innerText();

    await secretDialog.getByRole('button', { name: 'Done' }).click();
    await expect(agentPage.getByText(secretText)).toHaveCount(0);

    const row = agentPage.locator('li').filter({ hasText: url });
    await expect(row).toBeVisible();
    await expect(row.getByText(secretText)).toHaveCount(0);

    await row.getByRole('button', { name: `Delete webhook for ${url}` }).click();
    const deleteDialog = agentPage.getByRole('dialog', { name: `Delete webhook for ${url}?` });
    await deleteDialog.getByRole('button', { name: 'Delete webhook' }).click();
    await expect(agentPage.locator('li').filter({ hasText: url })).toHaveCount(0);
  });
});
