/**
 * Campaigns — proactive, targeted messages (FR-MOD-03.3).
 *
 * The integration suite proves the trigger engine fires at the right visitors
 * and isolates tenants. What only a browser shows is the slice end to end: an
 * owner reaches Campaigns through the Customers sub-nav, builds one from a
 * trigger and a message, and sees it listed under its status tab with the
 * Displayed / Chats / Conversion card.
 */
import { expect, test } from './fixtures.js';

test.describe('campaigns', () => {
  test('builds a campaign from the Campaigns tab and sees it listed', async ({ agentPage }) => {
    const name = `Pricing nudge ${Date.now()}`;

    // Reach Campaigns through the Customers sub-nav, not a bookmarked URL.
    await agentPage.goto('/app/customers');
    await agentPage.getByRole('link', { name: 'Campaigns' }).click();
    await expect(agentPage).toHaveURL(/\/app\/customers\/campaigns$/);

    // Build one: trigger + message are required, so Submit unlocks only once
    // both are given.
    await agentPage.getByRole('button', { name: 'New campaign' }).click();
    const dialog = agentPage.getByRole('dialog', { name: 'New campaign' });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Trigger — page URL contains').fill('/pricing');
    await dialog.getByLabel('Message').fill('Questions about pricing? Happy to help.');
    await dialog.getByRole('button', { name: 'Create campaign' }).click();

    // It lands in the list, running, with the performance card.
    const card = agentPage.getByRole('listitem').filter({ hasText: name });
    await expect(card).toBeVisible();
    await expect(card.getByText('Displayed')).toBeVisible();
    await expect(card.getByText('Conversion')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Turn off' })).toBeVisible();

    // The status tabs narrow the list: a running campaign shows under Ongoing…
    await agentPage.getByRole('button', { name: /Ongoing/ }).click();
    await expect(agentPage.getByRole('listitem').filter({ hasText: name })).toBeVisible();
    // …and is gone from the Inactive tab.
    await agentPage.getByRole('button', { name: /Inactive/ }).click();
    await expect(agentPage.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);

    await agentPage.getByRole('button', { name: /All/ }).click();
    await agentPage.screenshot({ path: 'kanit/04-campaigns.png', fullPage: true });
  });
});
