/**
 * The brand logo, end to end (WG-10 · tm 471).
 *
 * Until tm 471 the API took a brand's `logo_url` but no screen sent one, so the
 * widget's "Show the brand logo" switch pointed at a field nobody could fill.
 * This drives the whole chain on the real stack: an admin types the logo's
 * address into Settings › Brands (an `http:` one is refused on the spot), turns
 * the switch on in Widget appearance, and a visitor's widget heads its panel
 * with that image, named after the brand.
 *
 * One thing is faked: the image itself. The stack has no internet, and the
 * widget hides a logo that fails to load, so the CDN address is answered by a
 * one-pixel PNG through Playwright's routing — in the console (the thumbnail)
 * and in the visitor's browser. The address, the save, the mint that carries it
 * and the widget that draws it are the real thing.
 *
 * Self-cleaning: the logo is cleared and the switch turned back off at the end.
 */
import {
  API_BASE,
  expect,
  ownerAccessToken,
  tenantSubdomain,
  test,
  widgetFrame,
} from './fixtures.js';
import type { BrowserContext, Page } from '@playwright/test';

const LOGO = 'https://cdn.example.com/siyahtus-e2e/acme-logo.png';
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** Answer the logo's address with a real image, wherever this page or context asks for it. */
async function serveLogo(target: Page | BrowserContext): Promise<void> {
  await target.route(LOGO, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
  );
}

interface Brand {
  id: string;
  is_default: boolean;
  logo_url: string | null;
}

test.describe('brand logo (WG-10)', () => {
  test('an admin sets the logo address in Brands and the widget heads its panel with it', async ({
    agentPage,
    browser,
    request,
    organizationId,
  }) => {
    test.slow();
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
    const brands = (await (await request.get(`${API_BASE}/brands`, { headers: auth })).json()) as {
      items: Brand[];
    };
    const brand = brands.items.find((b) => b.is_default);
    expect(brand, 'the seeded default brand').toBeTruthy();
    const site = tenantSubdomain(`logo-${Date.now().toString().slice(-6)}`);

    try {
      // --- 1. The address, on the Brands screen ------------------------------
      await serveLogo(agentPage);
      await agentPage.goto('/app/settings/brands');
      const field = agentPage.getByLabel('Default logo address', { exact: true });
      await expect(field).toHaveValue('');

      // An address the widget would never draw is refused before it is sent.
      await field.fill('http://cdn.example.com/acme-logo.png');
      await field.press('Tab');
      await expect(agentPage.getByText(/starting with https:\/\//)).toBeVisible();
      await expect(field).toHaveAttribute('aria-invalid', 'true');

      await field.fill(LOGO);
      await field.press('Tab');
      await expect(agentPage.getByRole('img', { name: 'Default logo', exact: true })).toBeVisible();
      const stored = (await (
        await request.get(`${API_BASE}/brands/${brand!.id}`, { headers: auth })
      ).json()) as Brand;
      expect(stored.logo_url).toBe(LOGO);
      await agentPage.screenshot({ path: 'kanit/471-brand-logo-field.png', fullPage: true });

      // --- 2. The switch, in Widget appearance -------------------------------
      await agentPage.goto('/app/settings/widget');
      const appearance = agentPage.getByRole('region', { name: /Widget appearance/ });
      await appearance.getByRole('checkbox', { name: 'Show the brand logo' }).check();
      const save = appearance.getByRole('button', { name: 'Save', exact: true });
      await save.click();
      await expect(save).toBeDisabled();

      // --- 3. The visitor's widget draws it -----------------------------------
      const visitorContext = await browser.newContext();
      try {
        await serveLogo(visitorContext);
        const visitor = await visitorContext.newPage();
        await visitor.goto(`${site.origin}/demo.html?organization_id=${organizationId}`);
        const frame = widgetFrame(visitor);
        await frame.getByRole('button', { name: 'Open chat' }).click();
        const logo = frame.getByRole('img', { name: 'Default', exact: true });
        await expect(logo).toBeVisible({ timeout: 20_000 });
        await expect(logo).toHaveAttribute('src', LOGO);
        await visitor.screenshot({ path: 'kanit/471-brand-logo-widget.png' });
      } finally {
        await visitorContext.close();
      }
    } finally {
      // Back to how the suite found it: no logo, switch off.
      await request.patch(`${API_BASE}/brands/${brand!.id}`, {
        headers: auth,
        data: { logo_url: null },
      });
      await request.put(`${API_BASE}/settings/widget`, {
        headers: auth,
        data: { show_logo: false },
      });
    }
  });
});
