/**
 * Billing checkout — FR-MOD-10.1.1–.3, .6.
 *
 * The demo workspace is on a trial, so nothing is billed now; what this proves
 * is that the levers work end to end — the cycle toggle and seats stepper
 * persist through `PATCH /billing/subscription`, the summary recomputes, and
 * "Enter payment details" reveals the mocked payment form (ADR-13 — no card is
 * collected or charged).
 *
 * The seed is idempotent and does not reset a subscription a previous run left
 * behind, so the test starts from whatever cycle it finds and puts it back to
 * monthly — it must not depend on, or leave behind, a particular state.
 */
import { expect, test } from './fixtures.js';

test.describe('billing checkout', () => {
  test('changes seats and cycle, and reveals the mocked payment form', async ({ agentPage }) => {
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

    // Enter payment details reveals the mocked form, honest about being mocked.
    await manage.getByRole('button', { name: 'Enter payment details' }).click();
    const panel = manage.getByTestId('payment-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/mocked/i);
    await expect(panel).toContainText('Billed now');

    // Annual recomputes the summary and states the saving. Capture the proof
    // here, where the saving line and the payment panel are both on screen.
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
