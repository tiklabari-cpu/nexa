/**
 * Billing checkout + invoices + payment method — FR-MOD-10.1.1–.3, .6, 10.3.
 *
 * The demo workspace is on a trial, so nothing is billed now; what this proves
 * is that the levers work end to end — the cycle toggle and seats stepper
 * persist through `PATCH /billing/subscription` and the summary recomputes —
 * that invoices list and download (10.3), and that the masked payment method
 * saves through `PUT /billing/payment-method` (ADR-13 — no card is collected or
 * charged, and real card entry is out of scope, PRD §11.1/1).
 *
 * The seed is idempotent and does not reset a subscription a previous run left
 * behind, so the test starts from whatever cycle it finds and puts it back to
 * monthly — it must not depend on, or leave behind, a particular state.
 */
import { expect, test } from './fixtures.js';

test.describe('billing checkout', () => {
  test('changes seats and cycle, lists invoices, and saves a payment method', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/billing');
    await expect(agentPage.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();

    const manage = agentPage.getByRole('region', { name: 'Manage plan' });
    await expect(manage).toBeVisible();

    const monthly = manage.getByRole('button', { name: 'Monthly' });
    const annual = manage.getByRole('button', { name: /Annual/ });
    const summary = manage.getByTestId('billing-summary');
    const seatCount = manage.getByTestId('seat-count');

    // Known starting point: Monthly is disabled only when already monthly.
    if (await monthly.isEnabled()) await monthly.click();
    await expect(annual).toBeEnabled();

    // Adding a seat sticks after the PATCH round trip — the value is the
    // server's, not local optimism — then restore it.
    const before = Number(await seatCount.textContent());
    await manage.getByRole('button', { name: 'Add a seat' }).click();
    await expect(seatCount).toHaveText(String(before + 1));
    await manage.getByRole('button', { name: 'Remove a seat' }).click();
    await expect(seatCount).toHaveText(String(before));

    // Invoices list (10.3): at least the current period's statement, downloadable.
    const invoices = agentPage.getByRole('region', { name: 'Invoices' });
    await expect(invoices).toBeVisible();
    await expect(invoices.getByTestId('invoice-row').first()).toBeVisible();
    await expect(
      invoices.getByRole('button', { name: /Download invoice/i }).first(),
    ).toBeVisible();

    // Payment method (10.3): the form saves the masked card and the section
    // then shows it — honest about being mocked, with no full card number field.
    const payment = agentPage.getByRole('region', { name: 'Payment method' });
    await expect(payment).toBeVisible();
    await payment.getByRole('button', { name: /payment method/i }).click();
    const form = payment.getByTestId('payment-form');
    await expect(form).toBeVisible();
    await expect(form).toContainText(/masked/i);
    await expect(form.getByLabel(/card number/i)).toHaveCount(0);
    await form.getByLabel('Last 4 digits').fill('4242');
    await form.getByLabel('Cardholder name').fill('Demo Owner');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(payment.getByTestId('payment-method')).toContainText('ending 4242');

    // Annual recomputes the summary and states the saving.
    await annual.click();
    await expect(summary).toContainText(/saving/i);
    await agentPage.screenshot({ path: 'kanit/14-billing-checkout.png', fullPage: true });

    // Put the demo back the way we found it.
    await monthly.click();
    await expect(summary).not.toContainText(/saving/i);
  });

  /**
   * FR-MOD-01.1.6 — the trial badge lives in the shell, so it is proof from any
   * module, not just Billing. The demo workspace is on a 14-day trial, so the
   * banner counts down the days and its Subscribe CTA routes to Billing.
   */
  test('shell shows the trial countdown and Subscribe routes to billing', async ({ agentPage }) => {
    await agentPage.goto('/app/inbox');

    const badge = agentPage.getByTestId('trial-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/\d+ days? left in your trial\./);
    await agentPage.screenshot({ path: 'kanit/15-trial-badge.png', fullPage: true });

    // The CTA leaves the current module and lands on Billing.
    await badge.getByRole('link', { name: 'Subscribe' }).click();
    await expect(agentPage).toHaveURL(/\/app\/billing$/);
    await expect(agentPage.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();
  });
});
