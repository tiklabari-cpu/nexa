/**
 * Billing details, in a real browser against the real API (tm 383 · BL-02).
 *
 * The owner enters the company details printed on invoices: an invalid
 * Turkish tax number is refused on the field before anything is sent, a valid
 * one is saved and read back. The issued invoice's PDF — its number, the
 * frozen details, the payment reference, and that it does not change when the
 * details do — needs a closed period, which only the period-close sweep makes;
 * that half is proved against Postgres in
 * `apps/api/test/integration/invoice-pdf-profile.test.ts`.
 *
 * The demo workspace is shared, and a profile is corrected rather than
 * removed (no DELETE), so the test works from either state: details from an
 * earlier run are edited, none are added.
 */
import { assertNoBlockingViolations, scanScreen } from './a11y.js';
import { expect, test } from './fixtures.js';

test.describe('billing details (tm 383)', () => {
  test('refuses an invalid tax number and saves valid details', async ({ agentPage }, testInfo) => {
    await agentPage.goto('/app/billing');
    const section = agentPage.getByRole('region', { name: 'Billing details' });

    const add = section.getByRole('button', { name: 'Add billing details' });
    const edit = section.getByRole('button', { name: 'Edit billing details' });
    await expect(add.or(edit)).toBeVisible();
    await ((await add.isVisible()) ? add : edit).click();

    const form = section.getByRole('group', { name: 'Billing details' });
    await form.getByLabel('Legal name').fill('Işıklı Oyun Hizmetleri Ltd. Şti.');
    await form.getByLabel('Address', { exact: true }).fill('Gökdeniz Sk. No: 5');
    await form.getByLabel('City').fill('İstanbul');
    await form.getByLabel('Country').selectOption('TR');
    const taxId = form.getByLabel('Tax number');
    await taxId.fill('12345');
    await taxId.blur();
    await expect(form.getByText(/Not a valid tax number for this country/)).toBeVisible();
    await expect(taxId).toHaveAttribute('aria-invalid', 'true');

    assertNoBlockingViolations(await scanScreen(agentPage, 'Billing details form', testInfo));

    await taxId.fill('1234567890');
    await form.getByRole('button', { name: 'Save details' }).click();

    const summary = section.getByTestId('billing-profile');
    await expect(summary).toContainText('Işıklı Oyun Hizmetleri Ltd. Şti.');
    await expect(summary).toContainText('1234567890');
    await expect(section.getByText('No billing details yet')).toHaveCount(0);
  });
});
