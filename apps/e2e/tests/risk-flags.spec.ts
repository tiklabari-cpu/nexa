/**
 * Risk flags in the inbox and in Settings (tm 302.3 · AI-27).
 *
 * What the unit suites cannot prove: that a flag an agent raises from the
 * Details panel is held by the real API and is still on the conversation after
 * a reload, that a flag raised somewhere else reaches the open console over the
 * realtime gateway without one, that a clear takes a reason and removes the
 * chip, and that the workspace's Responsible Gaming settings survive a reload.
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

test.describe('risk flags (AI-27)', () => {
  test('an agent flags a conversation, a flag raised elsewhere arrives live, and each is cleared with a reason', async ({
    agentPage,
    browser,
    organizationId,
    request,
  }) => {
    test.setTimeout(120_000);
    const run = Date.now().toString().slice(-6);
    const context = await browser.newContext();
    try {
      const visitor = await context.newPage();
      await openWidget(visitor, organizationId, { host: tenantSubdomain(`risk-${run}`).origin });
      const opened = visitor.waitForResponse(
        (response) =>
          response.url().includes('/customer/chat/events') &&
          response.request().method() === 'POST' &&
          response.ok(),
      );
      await visitorSends(visitor, `Risk flag proof ${run}: I want to lodge a complaint`);
      const { chat_id: chatId } = (await (await opened).json()) as { chat_id: string };

      await agentPage.goto(`/app/inbox?chat=${chatId}`);
      // The header's chips: whole chips when there is room, one counted flag that
      // still carries every type's name when the panel leaves the header narrow.
      const header = agentPage.locator('[data-risk-chips]');
      await expect(
        agentPage.getByText('No active risk flags on this conversation or this player.'),
      ).toBeVisible({
        timeout: 20_000,
      });

      // --- The agent flags the conversation --------------------------------------
      await agentPage.getByRole('button', { name: 'Flag this conversation' }).click();
      const dialog = agentPage.getByRole('dialog', { name: 'Flag this conversation' });
      await dialog.getByLabel('What for').selectOption('complaint_formal');
      await dialog.getByLabel('Note (optional)').fill(`Wants a written reply ${run}`);
      await Promise.all([
        agentPage.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            response.url().endsWith(`/chats/${chatId}/risk-flags`) &&
            response.ok(),
        ),
        dialog.getByRole('button', { name: 'Add flag' }).click(),
      ]);
      await expect(dialog).toHaveCount(0);
      await expect(header).toContainText('Formal complaint');

      // The server holds it: a reload brings it back, with the note for an owner.
      await agentPage.reload();
      await expect(header).toContainText('Formal complaint', { timeout: 20_000 });
      await expect(agentPage.getByText(`Wants a written reply ${run}`)).toBeVisible();

      // --- A flag raised from another console arrives over the push ----------------
      const token = await ownerAccessToken(request);
      const raised = await request.post(`${API_BASE}/chats/${chatId}/risk-flags`, {
        headers: { authorization: `Bearer ${token}` },
        data: { type: 'account_security' },
      });
      expect(raised.ok(), `risk-flags: ${raised.status()} ${await raised.text()}`).toBe(true);
      await expect(header).toContainText('Account security', { timeout: 10_000 });

      // --- Clearing takes a reason -------------------------------------------------
      await agentPage.getByRole('button', { name: 'Clear flag: Account security' }).click();
      const clearing = agentPage.getByRole('dialog', { name: 'Clear flag: Account security' });
      await expect(clearing.getByRole('button', { name: 'Clear flag' })).toBeDisabled();
      await clearing.getByLabel('Reason (required)').fill(`Raised by mistake ${run}`);
      await Promise.all([
        agentPage.waitForResponse(
          (response) =>
            response.request().method() === 'DELETE' &&
            response.url().includes('/risk-flags/') &&
            response.ok(),
        ),
        clearing.getByRole('button', { name: 'Clear flag' }).click(),
      ]);
      await expect(header).not.toContainText('Account security');
      await expect(header).toContainText('Formal complaint');

      await agentPage.screenshot({ path: 'kanit/ai-27-risk-section.png' });

      // The other flag goes the same way, so the workspace is left as found.
      await agentPage.getByRole('button', { name: 'Clear flag: Formal complaint' }).click();
      const last = agentPage.getByRole('dialog', { name: 'Clear flag: Formal complaint' });
      await last.getByLabel('Reason (required)').fill(`Answered ${run}`);
      await last.getByRole('button', { name: 'Clear flag' }).click();
      await expect(header).toHaveCount(0);
      await expect(
        agentPage.getByText('No active risk flags on this conversation or this player.'),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('the Responsible Gaming settings are saved and kept after a reload', async ({
    agentPage,
  }) => {
    const address = `rg-${Date.now().toString().slice(-6)}@example.com`;
    await agentPage.goto('/app/settings/risk-flags');
    await expect(agentPage.getByRole('heading', { name: 'Risk flags', level: 2 })).toBeVisible();

    const emails = agentPage.getByLabel('Also email urgent flags to');
    const original = await emails.inputValue();
    try {
      await emails.fill(address);
      await Promise.all([
        agentPage.waitForResponse(
          (response) =>
            response.request().method() === 'PUT' &&
            response.url().endsWith('/risk-flags/settings') &&
            response.ok(),
        ),
        agentPage.getByRole('button', { name: 'Save' }).click(),
      ]);
      await expect(agentPage.getByText('Saved.')).toBeVisible();

      await agentPage.reload();
      await expect(agentPage.getByLabel('Also email urgent flags to')).toHaveValue(address);

      // The catalogue is the platform's own table.
      const table = agentPage.getByRole('table');
      await expect(table.getByRole('row', { name: /Self-exclusion request/ })).toContainText(
        'Urgent',
      );
    } finally {
      await agentPage.getByLabel('Also email urgent flags to').fill(original);
      await agentPage.getByRole('button', { name: 'Save' }).click();
      await expect(agentPage.getByRole('button', { name: 'Save' })).toBeDisabled();
    }
  });
});
