/**
 * FR-MOD-10.2 — once a trial ends the workspace goes read-only, not locked:
 * writes are refused, existing data stays intact and visible, and the
 * subscribe path stays open (ADR-10). The integration suite proves this at
 * the API (`reports-billing.test.ts`'s "subscription and the trial gate") and
 * the component suite proves it in isolation (`BillingPage.test.tsx`'s "trial
 * and read-only banners"); this is the same claim through a real browser.
 *
 * `OVERDUE_OWNER` (`fixtures.ts`) is a workspace whose trial ended two days
 * before this run started, seeded that way (`seedOverdueTrialWorkspace`,
 * `apps/api/prisma/seed.ts`) rather than produced here: nothing public ages a
 * trial (`fixtures.ts`'s own rule is that everything goes through the API,
 * never the database), so a signup in this file could only ever be a live,
 * fourteen-day-fresh trial, and proving read-only would mean waiting for it.
 */
import { expect, OVERDUE_OWNER, signInAs, test } from './fixtures.js';

test.describe('a trial past its end date (FR-MOD-10.2)', () => {
  test('shows read-only everywhere, refuses a write, and keeps the subscribe path open', async ({
    page,
  }) => {
    await signInAs(page, OVERDUE_OWNER.email, OVERDUE_OWNER.password);

    // The shell banner: visible from any module, not just Billing, and it
    // still offers the way back rather than just stating the problem.
    const badge = page.getByTestId('trial-badge');
    await expect(badge).toContainText(/trial has ended/i);
    const subscribeLink = badge.getByRole('link', { name: 'Subscribe' });
    await expect(subscribeLink).toBeVisible();

    // A write elsewhere in the console is refused — inline, not silently
    // dropped, and not a generic error either (the client-facing sentence
    // names the reason).
    await page.goto('/app/team/teams');
    await page.getByRole('button', { name: 'New team' }).click();
    const editor = page.getByRole('dialog', { name: 'New team' });
    await editor.getByLabel('Name').fill(`Rejected Team ${Date.now()}`);
    const attempted = page.waitForResponse(
      (response) => response.url().endsWith('/groups') && response.request().method() === 'POST',
    );
    await editor.getByRole('button', { name: 'Create team' }).click();
    const response = await attempted;
    expect(response.status()).toBe(402);
    // Refused, not silently accepted — the dialog is still here to prove it.
    await expect(editor).toBeVisible();
    await expect(editor.getByRole('alert')).toContainText(/subscription has ended/i);
    await editor.getByRole('button', { name: 'Cancel' }).click();

    // Billing itself: the same read-only fact, the data untouched, and the
    // one write class ADR-10 keeps open on purpose — putting a card on file.
    await page.goto('/app/billing');
    const readOnlyBanner = page.getByRole('alert');
    await expect(readOnlyBanner).toContainText('This workspace is read-only.');
    await expect(readOnlyBanner).toContainText(/nothing has been deleted/i);

    const payment = page.getByRole('region', { name: 'Payment method' });
    await payment.getByRole('button', { name: /payment method/i }).click();
    const form = payment.getByTestId('payment-form');
    await form.getByLabel('Last 4 digits').fill('4242');
    await form.getByLabel('Cardholder name').fill('Overdue Owner');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(payment.getByTestId('payment-method')).toContainText('ending 4242');
    await page.screenshot({ path: 'kanit/10.2-trial-expired-read-only.png', fullPage: true });

    // Subscribe, from the shell banner, actually reaches Billing.
    await subscribeLink.click();
    await expect(page).toHaveURL(/\/app\/billing/);
  });
});
