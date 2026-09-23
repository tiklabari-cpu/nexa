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
  defaultColor: '#2d67fa',
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
    // The widget's appearance and its website list are two Settings sections
    // since FR-MOD-08.1, each at its own address; the brand stays selected
    // while the navigation moves between them.
    await page.goto('/app/settings/widget');
    const settingsNav = page.getByRole('navigation', { name: 'Settings navigation' });
    const showWebsites = (): Promise<void> =>
      settingsNav.getByRole('link', { name: 'Website widgets' }).click();
    const showAppearance = (): Promise<void> =>
      settingsNav.getByRole('link', { name: 'Widget appearance' }).click();

    const colourHex = page.getByLabel('Brand colour hex');
    // The region title carries the brand name, so a substring match on
    // "Website widgets" holds for either brand.
    const websites = (): ReturnType<typeof page.getByRole> =>
      page.getByRole('region', { name: 'Website widgets' });
    // `exact` so it never collides with the "Brand colour" controls.
    const switcher = page.getByRole('button', { name: 'Brand', exact: true });
    // The switcher now lives inside the logo's app menu (FR-MOD-01.1.1) rather
    // than being its own rail icon — closed by default, so it must be opened
    // before the switcher is reachable at all.
    const openAppMenu = (): Promise<void> => page.getByRole('button', { name: 'App menu' }).click();
    // A click on the Settings navigation closes the menu; reopen it only then —
    // the button toggles, so opening an open menu would shut it.
    const reachSwitcher = async (): Promise<void> => {
      if (!(await switcher.isVisible())) await openAppMenu();
      await expect(switcher).toBeVisible();
    };
    // Scoped to the switcher's own listbox, not the page. A bare
    // `getByRole('option', { name: 'Default' })` matched three elements once
    // Settings grew a `<select>` whose first entry reads "Use the default (365
    // days)" (NFR-C8, tm 241): Playwright matches an accessible name by
    // case-insensitive SUBSTRING, and a native `<option>` carries the role too.
    // The narrow locator is also what the assertion always meant — "the brand
    // called Default", not "anything on this page named like a default".
    const brandOption = (name: string): ReturnType<typeof page.getByRole> =>
      page.getByRole('listbox', { name: 'Brand' }).getByRole('option', { name, exact: true });

    // --- The default brand, selected on first load -----------------------------
    // The switcher exists at all only because the license has two brands — a
    // single-brand workspace renders no switcher (BrandSwitcher returns null).
    await openAppMenu();
    await expect(switcher).toBeVisible();
    await expect(colourHex).toHaveValue(NORTHWIND.defaultColor);
    await showWebsites();
    await expect(websites().getByText(NORTHWIND.defaultSite)).toBeVisible();
    await expect(websites().getByText(NORTHWIND.secondSite)).toHaveCount(0);
    await page.screenshot({ path: 'kanit/78.8-brand-default.png', fullPage: true });

    // --- Switch to the second brand --------------------------------------------
    await reachSwitcher();
    await switcher.click();
    await brandOption(NORTHWIND.secondBrand).click();

    // The website list follows the brand: this brand's site appears and the
    // other brand's is gone — the isolation an admin can see.
    await expect(websites().getByText(NORTHWIND.secondSite)).toBeVisible();
    await expect(websites().getByText(NORTHWIND.defaultSite)).toHaveCount(0);
    // …and so does the widget appearance — a different colour and a title that
    // names it.
    await showAppearance();
    await expect(colourHex).toHaveValue(NORTHWIND.secondColor);
    await expect(
      page.getByRole('region', { name: `Widget appearance · ${NORTHWIND.secondBrand}` }),
    ).toBeVisible();
    await page.screenshot({ path: 'kanit/78.8-brand-second.png', fullPage: true });

    // --- Switch back — the default brand's appearance and site return ----------
    await reachSwitcher();
    await switcher.click();
    await brandOption(NORTHWIND.defaultBrand).click();
    await expect(colourHex).toHaveValue(NORTHWIND.defaultColor);
    await showWebsites();
    await expect(websites().getByText(NORTHWIND.defaultSite)).toBeVisible();
    await expect(websites().getByText(NORTHWIND.secondSite)).toHaveCount(0);
  });
});
