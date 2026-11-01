/**
 * Cancelling the subscription, in a real browser against the real API
 * (tm 384 · BL-03).
 *
 * The owner opens "Cancel subscription", sees what happens next, picks a
 * reason, types the workspace's name — the button stays off until it matches
 * — and cancels; the page then says when the subscription ends, and "Undo
 * cancellation" takes it back. The period end, the read-only workspace, the
 * export window and the deletion need the period-close job's clock; that half
 * is proved against Postgres in
 * `apps/api/test/integration/subscription-cancel.test.ts`.
 *
 * The demo workspace is shared, so the test ends where it started: resumed.
 */
import { assertNoBlockingViolations, scanScreen } from './a11y.js';
import { expect, test } from './fixtures.js';

test.describe('subscription cancellation (tm 384)', () => {
  test('the owner cancels at the period end and undoes it', async ({ agentPage }, testInfo) => {
    await agentPage.goto('/app/billing');
    const section = agentPage.getByRole('region', { name: 'Cancel subscription' });

    // A run that stopped half-way left it cancelled: undo first.
    const undo = section.getByRole('button', { name: 'Undo cancellation' });
    const open = section.getByRole('button', { name: 'Cancel subscription' });
    await expect(undo.or(open)).toBeVisible();
    if (await undo.isVisible()) {
      await undo.click();
      await expect(open).toBeVisible();
    }

    await open.click();
    const dialog = agentPage.getByRole('dialog', { name: 'Cancel the subscription?' });
    await expect(dialog).toContainText('The rest of the period is not refunded.');
    await expect(dialog).toContainText('You can read and export its data for 30 days after that.');

    const confirm = dialog.getByLabel(/^Type .+ to confirm$/);
    const prompt = (await dialog.getByText(/^Type .+ to confirm$/).textContent()) ?? '';
    const name = prompt.replace(/^Type /, '').replace(/ to confirm$/, '');
    expect(name.length).toBeGreaterThan(0);

    const submit = dialog.getByRole('button', { name: 'Cancel at period end' });
    await dialog.getByLabel('It is too expensive').check();
    await confirm.fill('not the name');
    await expect(submit).toBeDisabled();

    assertNoBlockingViolations(await scanScreen(agentPage, 'Cancel subscription dialog', testInfo));

    await confirm.fill(name);
    await expect(submit).toBeEnabled();
    const cancelled = agentPage.waitForResponse(
      (response) =>
        response.url().endsWith('/billing/subscription/cancel') &&
        response.request().method() === 'POST',
    );
    await submit.click();
    expect((await cancelled).status()).toBe(200);

    await expect(dialog).toHaveCount(0);
    await expect(section.getByTestId('cancel-scheduled')).toContainText(/The subscription ends on/);
    await agentPage.screenshot({ path: 'kanit/10.2-subscription-cancel.png', fullPage: true });

    await section.getByRole('button', { name: 'Undo cancellation' }).click();
    await expect(section.getByRole('button', { name: 'Cancel subscription' })).toBeVisible();
    await expect(section.getByTestId('cancel-scheduled')).toHaveCount(0);
  });
});
