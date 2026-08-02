/**
 * Multibrand — cross-brand isolation through the UI (MULTIBRAND-h · 78.8 ·
 * PRD §5.3 · NFR-S4/S5).
 *
 * The integration suite proves isolation at the data layer for every
 * brand-scoped table (brand-isolation.test.ts). This proves the property a real
 * admin sees: on a two-brand license the brand switcher picks the brand, and
 * every brand-scoped screen follows — the widget appearance and the website list
 * change together, and neither brand's data shows while the other is active.
 *
 * It logs into **Northwind**, the seeded two-brand license, so the single-brand
 * demo (Acme) the rest of the suite drives is left exactly as it was — a switcher
 * that never appears on one brand is itself part of the contract.
 *
 * Written to fail without the implementation: drop the `X-Nexa-Brand` header the
 * switcher sets and both brands read the same rows, so the "not visible"
 * assertions see the other brand's site.
 */
import { expect, test } from './fixtures.js';
import type { Page } from '@playwright/test';

// The two-brand license the seed builds (apps/api/prisma/seed.ts). Northwind is
// never logged into by the Acme-based specs, so its login and its second brand
// are exercised only here.
const NORTHWIND = {
  email: 'owner@northwind.localhost',
  password: 'nexa-demo-password',
  defaultBrand: 'Default',
  secondBrand: 'Northwind Europe',
  defaultColor: '#2f6bff',
  secondColor: '#e11d48',
  defaultSite: 'northwind-supply.localhost',
  secondSite: 'northwind-eu.localhost',
} as const;

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(NORTHWIND.email);
  await page.getByLabel('Password').fill(NORTHWIND.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // The rail only exists once the session is real.
  await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible();
}

test.describe('multibrand cross-brand isolation', () => {
  test('switching brand changes the widget colour and website list; neither leaks into the other', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto('/app/settings');

    const colourHex = page.getByLabel('Brand colour hex');
    // The region title carries the brand name, so a substring match on
    // "Website widgets" holds for either brand.
    const websites = (): ReturnType<typeof page.getByRole> =>
      page.getByRole('region', { name: 'Website widgets' });
    // `exact` so it never collides with the "Brand colour" controls.
    const switcher = page.getByRole('button', { name: 'Brand', exact: true });

    // --- The default brand, selected on first load -----------------------------
    // The switcher exists at all only because the license has two brands — a
    // single-brand workspace renders no switcher (BrandSwitcher returns null).
    await expect(switcher).toBeVisible();
    await expect(colourHex).toHaveValue(NORTHWIND.defaultColor);
    await expect(websites().getByText(NORTHWIND.defaultSite)).toBeVisible();
    await expect(websites().getByText(NORTHWIND.secondSite)).toHaveCount(0);
    await page.screenshot({ path: 'kanit/78.8-brand-default.png', fullPage: true });

    // --- Switch to the second brand --------------------------------------------
    await switcher.click();
    await page.getByRole('option', { name: NORTHWIND.secondBrand }).click();

    // The widget appearance follows the brand — a different colour and a title
    // that names it.
    await expect(colourHex).toHaveValue(NORTHWIND.secondColor);
    await expect(
      page.getByRole('region', { name: `Widget appearance · ${NORTHWIND.secondBrand}` }),
    ).toBeVisible();
    // …and so does the website list: this brand's site appears and the other
    // brand's is gone — the isolation an admin can see.
    await expect(websites().getByText(NORTHWIND.secondSite)).toBeVisible();
    await expect(websites().getByText(NORTHWIND.defaultSite)).toHaveCount(0);
    await page.screenshot({ path: 'kanit/78.8-brand-second.png', fullPage: true });

    // --- Switch back — the default brand's appearance and site return ----------
    await switcher.click();
    await page.getByRole('option', { name: NORTHWIND.defaultBrand }).click();
    await expect(colourHex).toHaveValue(NORTHWIND.defaultColor);
    await expect(websites().getByText(NORTHWIND.defaultSite)).toBeVisible();
    await expect(websites().getByText(NORTHWIND.secondSite)).toHaveCount(0);
  });
});
