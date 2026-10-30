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
 *
 * EN-03 (tm 352): a trigger of several rules — built row by row, listed with
 * what it waits for — and the browser half end to end: a card that waits for
 * the visitor to head for the exit is held by the real widget, shown when the
 * loader sees the pointer leave through the top edge, and counted as shown then.
 */
import {
  API_BASE,
  expect,
  openWidget,
  ownerAccessToken,
  tenantSubdomain,
  test,
  visitorSends,
  widgetFrame,
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
    await dialog.getByLabel('Rule 1 value').fill('/pricing');
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

  test('builds a two-rule campaign row by row and lists what it waits for (EN-03)', async ({
    agentPage,
  }) => {
    const name = `Exit offer ${Date.now()}`;

    await agentPage.goto('/app/customers/campaigns');
    await agentPage.getByRole('button', { name: 'New campaign' }).click();
    const dialog = agentPage.getByRole('dialog', { name: 'New campaign' });

    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Rule 1 value').fill('/deposit');
    await dialog.getByRole('button', { name: 'Add rule' }).click();
    await dialog.getByLabel('Rule 2 field').selectOption({ label: 'Exit intent' });
    // Two rules to join: the choice appears with the second one.
    await dialog.getByLabel('Reach visitors when').selectOption('any');
    await dialog.getByLabel('Message').fill('Wait, there is a bonus waiting.');
    await dialog.getByRole('button', { name: 'Create campaign' }).click();

    const card = agentPage.getByRole('listitem').filter({ hasText: name });
    await expect(card).toBeVisible();
    await expect(card).toContainText('When any of these holds:');
    await expect(card).toContainText(
      'Current page URL contains /deposit · The visitor is about to leave the page',
    );

    // Edited again, the rows come back as they were saved.
    await card.getByRole('button', { name: 'Edit' }).click();
    const editor = agentPage.getByRole('dialog', { name: 'Edit campaign' });
    await expect(editor.getByLabel('Rule 1 value')).toHaveValue('/deposit');
    await expect(editor.getByLabel('Rule 2 field')).toHaveValue('exit_intent');
    await expect(editor.getByLabel('Reach visitors when')).toHaveValue('any');
    await editor.getByRole('button', { name: 'Cancel' }).click();

    await card.getByRole('button', { name: 'Turn off' }).click();
    await expect(card.getByRole('button', { name: 'Turn on' })).toBeVisible();
  });

  test('a card that waits for the exit is held, shown when the pointer leaves the top edge, and counted then (EN-03)', async ({
    agentPage,
    browser,
    organizationId,
    request,
  }) => {
    test.setTimeout(120_000);
    const run = Date.now().toString().slice(-6);
    const token = await ownerAccessToken(request);
    const headers = { authorization: `Bearer ${token}` };
    const message = `Wait, a bonus for you ${run}`;

    // Running before the visitor arrives, so the mint says a campaign runs and
    // the loader starts watching the page.
    const created = await request.post(`${API_BASE}/campaigns`, {
      headers,
      data: {
        name: `Exit ${run}`,
        conditions: {
          match: 'all',
          rules: [
            { field: 'current_url', op: 'contains', value: `exit-${run}` },
            { field: 'exit_intent', op: 'equals', value: true },
          ],
        },
        content: { message },
      },
    });
    expect(created.ok(), `campaigns: ${created.status()} ${await created.text()}`).toBe(true);
    const campaignId = ((await created.json()) as { id: string }).id;

    const context = await browser.newContext();
    try {
      const visitor = await context.newPage();
      const minted = visitor.waitForResponse(
        (response) => response.url().endsWith('/customer/chat') && response.ok(),
      );
      await openWidget(visitor, organizationId, { host: tenantSubdomain(`exit-${run}`).origin });
      await minted;
      const frame = widgetFrame(visitor);
      // The panel closed: the card has the launcher's corner to itself.
      await frame.locator('.nx-close').click();

      const greeting = frame.locator('.nx-greeting');
      const shown = visitor.waitForResponse(
        (response) =>
          /\/customer\/campaigns\/[^/]+\/shown$/.test(response.url()) &&
          response.request().method() === 'POST',
      );
      await expect(greeting).toBeHidden();

      // Pointer out through the top edge — repeated, because it counts only once
      // the widget holds the card (the mint's poll hands it over a moment after).
      await expect(async () => {
        await visitor.evaluate(() => {
          document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, clientY: 0 }));
        });
        await expect(greeting).toBeVisible({ timeout: 1_500 });
      }).toPass({ timeout: 30_000 });
      await expect(greeting).toContainText(message);
      expect((await shown).status()).toBe(204);
    } finally {
      await context.close();
      await request.patch(`${API_BASE}/campaigns/${campaignId}`, {
        headers,
        data: { active: false },
      });
    }

    // The card counts it as displayed — and only now.
    await agentPage.goto('/app/customers/campaigns');
    const card = agentPage.getByRole('listitem').filter({ hasText: `Exit ${run}` });
    await expect(card.getByText('Displayed').locator('..')).toContainText('1');
  });
});
