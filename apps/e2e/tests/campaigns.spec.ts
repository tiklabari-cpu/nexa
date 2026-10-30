/**
 * Campaigns — proactive, targeted messages (FR-MOD-03.3).
 *
 * The integration suite proves the trigger engine fires at the right visitors
 * and isolates tenants. What only a browser shows is the slice end to end: an
 * owner reaches Campaigns through the Customers sub-nav, builds one from a
 * trigger and a message, and sees it listed under its status tab with the
 * Displayed / Chats / Conversion card.
 *
 * EN-01 (tm 350): a player a risk flag keeps from promotions is shown no
 * campaign — a send queued for them before the flag is held back when the
 * flag lands, the card counts it as "Not shown due to risk", and the inbox
 * says "Promotions blocked".
 */
import {
  API_BASE,
  expect,
  openWidget,
  ownerAccessToken,
  tenantSubdomain,
  test,
  visitorSends,
} from './fixtures.js';

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

  test('a flagged player is shown no campaign: the card counts it and the inbox says so (EN-01)', async ({
    agentPage,
    browser,
    organizationId,
    request,
  }) => {
    test.setTimeout(120_000);
    const run = Date.now().toString().slice(-6);
    const name = `Bonus ${run}`;
    const token = await ownerAccessToken(request);
    const headers = { authorization: `Bearer ${token}` };

    const context = await browser.newContext();
    try {
      const visitor = await context.newPage();
      await openWidget(visitor, organizationId, { host: tenantSubdomain(`promo-${run}`).origin });
      const opened = visitor.waitForResponse(
        (response) =>
          response.url().includes('/customer/chat/events') &&
          response.request().method() === 'POST' &&
          response.ok(),
      );
      await visitorSends(visitor, `Promo proof ${run}`);
      const { chat_id: chatId } = (await (await opened).json()) as { chat_id: string };

      // Saved only now, with the visitor already mid-chat on the page it targets:
      // a campaign running before they arrived would be fired at them when the
      // widget opens (EN-04) and shown on the first poll, before there is a
      // chat to flag. The save queues the send, held while they chat.
      const created = await request.post(`${API_BASE}/campaigns`, {
        headers,
        data: {
          name,
          conditions: { url_contains: `promo-${run}` },
          content: { message: 'Hoş geldin bonusu seni bekliyor!' },
        },
      });
      expect(created.ok(), `campaigns: ${created.status()} ${await created.text()}`).toBe(true);
      const campaignId = ((await created.json()) as { id: string }).id;

      // The player asks to be excluded; an agent flags it. The queued send stops here.
      const raised = await request.post(`${API_BASE}/chats/${chatId}/risk-flags`, {
        headers,
        data: { type: 'self_exclusion_request' },
      });
      expect(raised.ok(), `risk-flags: ${raised.status()} ${await raised.text()}`).toBe(true);
      const flagId = ((await raised.json()) as { id: string }).id;

      await agentPage.goto('/app/customers/campaigns');
      const card = agentPage.getByRole('listitem').filter({ hasText: name });
      await expect(card.getByTestId('campaign-suppressed')).toHaveText('Not shown due to risk: 1', {
        timeout: 20_000,
      });
      await expect(card.getByText('Displayed').locator('..')).toContainText('0');

      await agentPage.goto(`/app/inbox?chat=${chatId}`);
      await expect(agentPage.getByTestId('promo-blocked').first()).toHaveText(
        'Promotions blocked',
        { timeout: 20_000 },
      );
      await agentPage.screenshot({ path: 'kanit/en-01-promo-blocked.png' });

      // Leave the workspace as found: the flag cleared (with a reason), the campaign off.
      const cleared = await request.delete(`${API_BASE}/risk-flags/${flagId}`, {
        headers,
        data: { reason: `e2e cleanup ${run}` },
      });
      expect(cleared.ok(), `clear: ${cleared.status()}`).toBe(true);
      const off = await request.patch(`${API_BASE}/campaigns/${campaignId}`, {
        headers,
        data: { active: false },
      });
      expect(off.ok(), `campaign off: ${off.status()}`).toBe(true);
    } finally {
      await context.close();
    }
  });
});
