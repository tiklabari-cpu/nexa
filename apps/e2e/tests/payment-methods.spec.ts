/**
 * Paying for the subscription, in a real browser against the real API
 * (tm 382 · BL-01 · ADR-13a).
 *
 * The e2e stack runs the mock card processor and the platform has switched
 * nothing on, which is exactly the "Stripe off" deployment: the owner is
 * offered a bank transfer and crypto, no card tab. What this proves end to
 * end is the owner's half — a SWIFT reference issued and shown, a crypto
 * address asked for with no address shown, the request withdrawn, the history
 * listing the transfer. The SiyahTuş team's half (marking paid, sending an
 * address, confirming a TXID) and Stripe's hosted page and webhook are proved
 * against Postgres in `apps/api/test/integration/billing-payments.test.ts`.
 *
 * The demo workspace is shared with `billing.spec.ts`, so this leaves nothing
 * open behind it: a reference from an earlier run is reused (one per term),
 * the crypto request is withdrawn again, and the plan is put back. Acme is
 * seeded on Enterprise, a quoted plan with nothing to pay here, so the test
 * moves it to the listed plan first — the way `billing.spec.ts` does — and
 * the operator's path (`assign-plan.ts`) puts it back, since the checkout no
 * longer sells Enterprise (tm 432).
 */
import { assertNoBlockingViolations, scanScreen } from './a11y.js';
import { assignPlan } from './assign-plan.js';
import { ACME_OWNER, expect, test } from './fixtures.js';

test.describe('payment methods (tm 382)', () => {
  test('issues a transfer reference and asks for a crypto address without showing one', async ({
    agentPage,
  }, testInfo) => {
    await agentPage.goto('/app/billing');
    const section = agentPage.getByRole('region', { name: 'Pay for your subscription' });

    // A quoted plan has nothing to pay here; the listed one does.
    const manage = agentPage.getByRole('region', { name: 'Manage plan' });
    const growthPlan = manage.getByTestId('plan-option-growth');
    const confirmPlanChange = manage.getByRole('button', { name: 'Confirm plan change' });
    await expect(growthPlan).toBeVisible();
    const startedOnGrowth = (await growthPlan.getAttribute('aria-pressed')) === 'true';
    if (!startedOnGrowth) {
      await expect(section.getByText(/invoiced under its contract/)).toBeVisible();
      await growthPlan.click();
      await confirmPlanChange.click();
      await expect(growthPlan).toHaveAttribute('aria-pressed', 'true');
    }
    try {
      const bank = section.getByRole('tab', { name: 'Bank transfer' });
      await expect(bank).toHaveAttribute('aria-selected', 'true');
      await expect(section.getByRole('tab', { name: 'Crypto (USDT)' })).toBeVisible();
      // The mock processor: no card tab, whatever the platform shows.
      await expect(section.getByRole('tab', { name: 'Card' })).toHaveCount(0);
      await expect(section.getByTestId('payment-amount-due')).toContainText('$');

      const reference = section.getByTestId('swift-reference');
      const issue = section.getByRole('button', { name: 'Get a transfer reference' });
      await expect(reference.or(issue)).toBeVisible();
      if (await issue.isVisible()) await issue.click();
      await expect(reference).toHaveText(/^ST-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      const issued = (await reference.innerText()).trim();
      await expect(section.getByText(/write this reference in the description/)).toBeVisible();

      const history = agentPage.getByRole('region', { name: 'Payment history' });
      await expect(history.getByRole('row').filter({ hasText: issued })).toContainText('Waiting');

      await section.getByRole('tab', { name: 'Crypto (USDT)' }).click();
      const withdraw = section.getByRole('button', { name: 'Withdraw request' });
      const request = section.getByRole('button', { name: 'Request an address' });
      await expect(withdraw.or(request)).toBeVisible();
      if (await withdraw.isVisible()) {
        await withdraw.click();
        await expect(request).toBeVisible();
      }
      await section.getByLabel('Network').selectOption('usdt_trc20');
      await section.getByLabel('Billing name').fill('Acme e2e Ltd');
      await request.click();

      const open = section.getByTestId('crypto-open-request');
      await expect(open).toContainText('Address requested');
      await expect(open).toContainText('No address is shown automatically');
      await expect(section.getByTestId('crypto-wallet-address')).toHaveCount(0);
      await expect(section.getByLabel('Transaction ID (TXID)')).toHaveCount(0);

      assertNoBlockingViolations(await scanScreen(agentPage, 'Billing payment methods', testInfo));

      await withdraw.click();
      await expect(request).toBeVisible();
      await expect(section.getByText(/Withdrawn/).first()).toBeVisible();
    } finally {
      // Back on Enterprise the way an operator puts a workspace there — the
      // checkout no longer sells it (tm 432).
      if (!startedOnGrowth) await assignPlan(ACME_OWNER, 'enterprise');
    }
  });

  test('coming back from the card page cancelled says nothing was charged', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/billing?payment=canceled&reference=ST-0000-0000');
    await expect(
      agentPage.getByText('The card payment was cancelled. Nothing was charged.'),
    ).toBeVisible();
  });
});
