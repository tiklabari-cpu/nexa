/**
 * Billing checkout + invoices + payment method + API packages —
 * FR-MOD-10.1.1–.3, .6, 10.3 and 09.3.
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
 * monthly — it must not depend on, or leave behind, a particular state. The
 * API-package purchase below cannot put itself back (a sale is a permanent
 * record, deliberately), so it asserts deltas instead.
 */
import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures.js';

/**
 * Digits only, so an assertion compares an amount and not the locale's
 * punctuation. Every figure on this page goes through `Intl` against whatever
 * language the agent's UI is in; `$29.99`, `29,99 $` and `29.99 USD` are the
 * same 2999 cents, and a test that pins the separators is testing the runtime's
 * ICU data. (Same trick as `copilot-bi.spec.ts`.)
 */
function digitsOf(text: string): number {
  return Number(text.replace(/\D/g, ''));
}

/** `"$29.99"` → `2999`. The cell holds nothing but the amount. */
async function readCents(amount: Locator): Promise<number> {
  return digitsOf(await amount.innerText());
}

/**
 * The included-calls figure out of the API-call overage terms ("Beyond the
 * included 100,000, API calls bill at …"). That sentence is where the page
 * states the allowance in one place, so a purchase either moves it or has not
 * really credited anything.
 */
async function readIncluded(terms: Locator): Promise<number> {
  const text = await terms.innerText();
  const match = /included\s+([\d.,\s]+)/.exec(text);
  expect(match, `no included figure in: ${text}`).not.toBeNull();
  return digitsOf(match![1]!);
}

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
    await expect(invoices.getByRole('button', { name: /Download invoice/i }).first()).toBeVisible();

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
   * FR-MOD-09.3 — buying an API request package, end to end (09.3-h).
   *
   * The one claim the lower suites structurally cannot make. Integration tests
   * prove the purchase credits `usage_records.included` and lands on the
   * invoice; component tests prove each section renders what its endpoint
   * returns. Neither proves the sentence the orchestrator's scope decision
   * actually promised — "payment is mocked, the quota increase is real" —
   * because that sentence spans a click on one section and figures re-read by
   * three others.
   *
   * So this buys Essential from the screen and then reads the three places the
   * purchase must show up: the API-call allowance, the purchase history, and
   * the open invoice. Everything is asserted as a *delta* against what the page
   * showed a moment earlier rather than against seeded absolutes — the same
   * discipline the checkout test above uses. A run that follows another without
   * a reseed then still proves the causal claim instead of failing on an
   * allowance a previous purchase already raised.
   */
  test('buys an API package: the quota rises and the purchase reaches history and the invoice', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/billing');
    await expect(agentPage.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();

    // The Essential package, as the catalogue sells it (@nexa/types).
    const ESSENTIAL_CALLS = 100_000;
    const ESSENTIAL_PRICE_CENTS = 2999;

    // Where the three proofs will be read from.
    const apiCalls = agentPage.getByRole('region', { name: 'API calls' });
    const allowance = apiCalls.getByTestId('api-overage-terms');
    const history = agentPage.getByRole('region', { name: 'Purchase history' });
    const purchaseRows = history.getByTestId('api-package-purchase-row');
    const invoices = agentPage.getByRole('region', { name: 'Invoices' });
    // Newest first, so the first row is the current period — the one a purchase
    // made now lands in.
    const openInvoice = invoices.getByTestId('invoice-row').first();
    const openTotal = openInvoice.getByTestId('invoice-total');

    await expect(allowance).toBeVisible();
    await expect(openTotal).toBeVisible();
    const includedBefore = await readIncluded(allowance);
    const purchasesBefore = await purchaseRows.count();
    const totalBefore = await readCents(openTotal);

    // The catalogue card quotes what is being bought before it is bought. The
    // figures are matched separator-agnostically (the page formats through
    // `Intl`, against whatever locale the agent's UI is in) — what is asserted
    // is the amount, not the punctuation.
    const essential = agentPage.getByTestId('api-package-essential');
    await expect(essential).toContainText('Essential');
    await expect(essential).toContainText(/100[.,\s]?000/);
    await expect(essential).toContainText(/29[.,]99/);

    // Buy, through the card's own confirm step — no card is charged (ADR-13).
    await essential.getByRole('button', { name: 'Buy Essential' }).click();
    await essential.getByRole('button', { name: 'Confirm buying Essential' }).click();

    // (1) The allowance is genuinely larger — by the package's calls, exactly.
    //     Polled rather than asserted once: the buy invalidates the usage query,
    //     so the figure arrives on a refetch.
    await expect.poll(() => readIncluded(allowance)).toBe(includedBefore + ESSENTIAL_CALLS);

    // (2) The purchase history gained the receipt, newest first, carrying the
    //     quota and the price as sold.
    await expect(purchaseRows).toHaveCount(purchasesBefore + 1);
    const receipt = purchaseRows.first();
    await expect(receipt).toContainText('Essential');
    await expect(receipt).toContainText(/\+100[.,\s]?000/);
    await expect(receipt).toContainText(/29[.,]99/);
    await agentPage.screenshot({ path: 'kanit/09.3-api-package-purchased.png', fullPage: true });

    // (3) The open invoice carries it as a line item and its total moved by the
    //     price — the money side of the same event, not a second opinion. The
    //     description is server-rendered, so its digits are unformatted.
    await expect(openInvoice).toContainText(`API package — Essential (${ESSENTIAL_CALLS} calls)`);
    await expect.poll(() => readCents(openTotal)).toBe(totalBefore + ESSENTIAL_PRICE_CENTS);

    // Its own frame: the page scrolls inside the shell, so `fullPage` captures
    // the scroll position rather than the whole document — the allowance and the
    // invoice cannot be in one image.
    await openInvoice.scrollIntoViewIfNeeded();
    await agentPage.screenshot({ path: 'kanit/09.3-api-package-invoice.png', fullPage: true });
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
