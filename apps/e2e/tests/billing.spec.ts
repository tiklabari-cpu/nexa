/**
 * Billing checkout + invoices + payment method + bought capacity —
 * FR-MOD-10.1.1–.3, .4, .6, 10.3 and 09.3.
 *
 * The demo workspace is on a trial, so nothing is billed now; what this proves
 * is that the levers work end to end — the plan tier picker, the cycle toggle
 * and seats stepper persist through `PATCH /billing/subscription` and the
 * summary recomputes — that invoices list and download (10.3), and that the
 * masked payment method saves through `PUT /billing/payment-method` (ADR-13 —
 * no card is collected or charged, and real card entry is out of scope, PRD
 * §11.1/1).
 *
 * The seed is idempotent and does not reset a subscription a previous run left
 * behind, so the test starts from whatever plan/cycle it finds and puts both
 * back (growth, monthly) — it must not depend on, or leave behind, a
 * particular state; `entitlements.spec.ts` reads this same workspace's plan
 * and Playwright runs this suite with a single worker (`playwright.config.ts`,
 * `workers: 1`), so "restore before returning" is what keeps that read
 * deterministic rather than a race. The API-package purchase below cannot put
 * itself back (a sale is a permanent record, deliberately), so it asserts
 * deltas instead.
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
  test('changes plan tier, seats and cycle, lists invoices, and saves a payment method (FR-MOD-10.1.1)', async ({
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
    const growthPlan = manage.getByTestId('plan-option-growth');
    const enterprisePlan = manage.getByTestId('plan-option-enterprise');
    const confirmPlanChange = manage.getByRole('button', { name: 'Confirm plan change' });

    // Known starting point: Monthly is disabled only when already monthly.
    if (await monthly.isEnabled()) await monthly.click();
    await expect(annual).toBeEnabled();

    // The tier this workspace was on *before* this test — restored at the end.
    //
    // Read rather than assumed, and restored to *this* value rather than to a
    // literal: the file header's promise is "puts both back", and for the cycle
    // that is what happens, but the plan used to be put back to `growth`
    // unconditionally while the seed puts Acme on `enterprise`. In a full-suite
    // run that silently downgraded the shared tenant for everything that came
    // after, and `entitlements.spec.ts` — the next file to read this plan —
    // failed on line 122 with "Save appearance" still enabled, because
    // `white_label` is an enterprise-only entitlement (`subscription-service.ts`,
    // `PLANS`) and the save it drives was refused. Measured: billing +
    // entitlements alone reproduce that failure; entitlements alone is green.
    const startedOnGrowth = (await growthPlan.getAttribute('aria-pressed')) === 'true';

    // Invoices list (10.3): the running month plus at least one closed period,
    // both downloadable.
    const invoices = agentPage.getByRole('region', { name: 'Invoices' });
    await expect(invoices).toBeVisible();
    const invoiceRows = invoices.getByTestId('invoice-row');
    await expect(invoiceRows.first()).toBeVisible();
    await expect(invoices.getByRole('button', { name: /Download invoice/i }).first()).toBeVisible();

    // The running month says it is an estimate; the closed one below it is a
    // statement and claims nothing extra.
    const estimate = invoiceRows.first();
    await expect(estimate.getByTestId('invoice-origin')).toHaveText('Estimate');
    const settled = invoiceRows.nth(1);
    await expect(settled).toBeVisible();
    await expect(settled.getByTestId('invoice-origin')).toHaveCount(0);

    // Plan tier (FR-MOD-10.1.1): known starting point first, same discipline as
    // the cycle toggle above — growth is disabled only when already active.
    if (await growthPlan.isEnabled()) {
      await growthPlan.click();
      await confirmPlanChange.click();
    }
    await expect(growthPlan).toHaveAttribute('aria-pressed', 'true');

    // What both rows say while the workspace is on growth. The tier is printed
    // on the statement itself ("<plan> plan — free during trial" while
    // trialing), so the plan switch below is observable in the list — which is
    // exactly what makes the next assertion mean something.
    //
    // Waited for rather than read: a plan change invalidates the invoices query,
    // and a plain `innerText()` here races that refetch — it read the *previous*
    // tier on the first run of this assertion.
    await expect(estimate.getByTestId('invoice-line-items')).toContainText('growth');
    const settledBefore = await settled.innerText();

    await enterprisePlan.click();
    // Enterprise is quoted, not listed — the confirm step says so rather than
    // inventing a total for a price this product does not set.
    await expect(manage.getByTestId('plan-confirm')).toContainText(/set in your contract/i);
    await confirmPlanChange.click();
    await expect(enterprisePlan).toHaveAttribute('aria-pressed', 'true');
    await expect(growthPlan).toHaveAttribute('aria-pressed', 'false');

    // The whole point of persisting invoices (FR-MOD-10.3), through the real
    // screen: the plan change invalidates the invoices query, so both rows are
    // re-read from the server — and only one of them moves. The running month
    // now names the new tier; the closed statement is byte-identical to what it
    // said a moment ago. Before the `invoices` table both were derived from the
    // same subscription row, so the settled month followed the plan too.
    await expect(estimate.getByTestId('invoice-line-items')).toContainText('enterprise');
    expect(await settled.innerText()).toBe(settledBefore);

    // Put the plan back the way we found it.
    const startingPlan = startedOnGrowth ? growthPlan : enterprisePlan;
    if (await startingPlan.isEnabled()) {
      await startingPlan.click();
      await confirmPlanChange.click();
    }
    await expect(startingPlan).toHaveAttribute('aria-pressed', 'true');

    // Adding a seat sticks after the PATCH round trip — the value is the
    // server's, not local optimism — then restore it.
    const before = Number(await seatCount.textContent());
    await manage.getByRole('button', { name: 'Add a seat' }).click();
    await expect(seatCount).toHaveText(String(before + 1));
    await manage.getByRole('button', { name: 'Remove a seat' }).click();
    await expect(seatCount).toHaveText(String(before));

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

    // And the cycle is another thing the closed statement does not follow.
    expect(await settled.innerText()).toBe(settledBefore);

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
   * FR-MOD-10.1.4 — buying AI-resolution overage capacity from the meter, end
   * to end.
   *
   * The claim the lower suites cannot make on their own. Integration tests prove
   * the purchase credits `usage_records.included` once per idempotency key and
   * reaches the invoice; component tests prove the stepper computes its total
   * and posts what it shows. Neither proves the sentence the PRD's §10.1.4 title
   * actually promises — that the *meter* is where a workspace buys its way out
   * of a limit — because that spans a stepper in one section and a counter and
   * an invoice re-read after it.
   *
   * Deltas, not seeded absolutes: this test cannot put itself back (a sale is a
   * permanent record, deliberately), so a run that follows another still proves
   * the causal claim instead of failing on an allowance a previous purchase
   * already raised.
   */
  test('buys AI overage packs from the meter: the allowance rises and the invoice itemises it (FR-MOD-10.1.4)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/billing');
    await expect(agentPage.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();

    // The pack, as the meter sells it (`AI_RESOLUTION_PACK_SIZE` × AI_OVERAGE_CENTS).
    const PACK_RESOLUTIONS = 50;
    const PACK_PRICE_CENTS = 2500;
    const PACKS = 2;

    const meter = agentPage.getByRole('region', { name: 'AI resolutions' });
    // The pack card states the allowance in a sentence ("Beyond the included
    // 200, …"), so a purchase either moves that figure or has not credited
    // anything.
    const allowance = meter.getByTestId('overage-package');
    const count = meter.getByTestId('ai-pack-count');
    const total = meter.getByTestId('ai-pack-total');
    const invoices = agentPage.getByRole('region', { name: 'Invoices' });
    // Newest first, so the first row is the current period — the one a purchase
    // made now lands in.
    const openInvoice = invoices.getByTestId('invoice-row').first();
    const openTotal = openInvoice.getByTestId('invoice-total');

    await expect(allowance).toBeVisible();
    await expect(openTotal).toBeVisible();
    const includedBefore = await readIncluded(allowance);
    const totalBefore = await readCents(openTotal);

    // The stepper opens at one pack and quotes what that costs before anything
    // is spent — the "no surprise on the invoice" promise, applied to the
    // purchase itself.
    await expect(count).toHaveText('1');
    await expect(meter.getByRole('button', { name: 'One pack fewer' })).toBeDisabled();
    await expect(total).toContainText(/25[.,]00/);

    await meter.getByRole('button', { name: 'One pack more' }).click();
    await expect(count).toHaveText(String(PACKS));
    // Two packs: 100 resolutions for $50.00, recomputed on the way up.
    await expect(total).toContainText(/100/);
    await expect(total).toContainText(/50[.,]00/);

    await meter.getByRole('button', { name: 'Buy packs' }).click();

    // (1) The purchase is confirmed on the meter itself.
    await expect(meter.getByTestId('ai-pack-bought')).toContainText(
      String(PACKS * PACK_RESOLUTIONS),
    );

    // (2) The allowance is genuinely larger — by the packs bought, exactly.
    //     Polled rather than asserted once: the buy invalidates the usage query,
    //     so the figure arrives on a refetch.
    await expect
      .poll(() => readIncluded(allowance))
      .toBe(includedBefore + PACKS * PACK_RESOLUTIONS);
    await agentPage.screenshot({ path: 'kanit/10.1.4-ai-pack-purchased.png', fullPage: true });

    // (3) The open invoice carries it as its own line item and its total moved
    //     by the price — the money side of the same event, not a second opinion.
    //     The description is server-rendered, so its digits are unformatted.
    await expect(openInvoice).toContainText(
      `AI resolution packs — ${PACKS} packs (${PACKS * PACK_RESOLUTIONS} resolutions)`,
    );
    await expect.poll(() => readCents(openTotal)).toBe(totalBefore + PACKS * PACK_PRICE_CENTS);

    // Its own frame: the page scrolls inside the shell, so `fullPage` captures
    // the scroll position rather than the whole document — the meter and the
    // invoice cannot be in one image.
    await openInvoice.scrollIntoViewIfNeeded();
    await agentPage.screenshot({ path: 'kanit/10.1.4-ai-pack-invoice.png', fullPage: true });
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
