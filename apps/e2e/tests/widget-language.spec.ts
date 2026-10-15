/**
 * The widget's language as a per-brand setting (WG-02, tm 280).
 *
 * Run against a second brand of the seeded workspace, on a subdomain of its own
 * registered as that brand's website: the default brand — the one every other
 * spec's visitor is on — is never saved, so its `auto` language and the
 * English the rest of the suite reads from a Playwright (en-US) browser stay as
 * they are. The brand and its website are removed again, whatever the outcome.
 *
 * The visitor's browser language is the only thing that varies per context, so
 * each case opens a fresh context with its own `locale`.
 */
import type { APIRequestContext, Browser, Page } from '@playwright/test';
import {
  API_BASE,
  expect,
  ownerAccessToken,
  tenantSubdomain,
  test,
  widgetFrame,
} from './fixtures.js';

async function saveLanguage(
  request: APIRequestContext,
  auth: Record<string, string>,
  brandId: string,
  body: { language?: string; fallback_language?: string },
): Promise<void> {
  const response = await request.put(`${API_BASE}/settings/widget`, {
    headers: { ...auth, 'x-siyahtus-brand': brandId },
    data: body,
  });
  expect(response.status(), await response.text()).toBe(200);
}

/** A visitor whose browser speaks `locale`, on the brand's site; closes after `run`. */
async function visit<T>(
  browser: Browser,
  locale: string,
  url: string,
  run: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext({ locale });
  try {
    const page = await context.newPage();
    await page.goto(url);
    return await run(page);
  } finally {
    await context.close();
  }
}

test.describe('widget language (WG-02)', () => {
  test('the panel shows the picker, and a brand’s site follows its saved language', async ({
    agentPage,
    browser,
    request,
    organizationId,
  }) => {
    test.slow();
    const stamp = Date.now().toString().slice(-6);
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
    const site = tenantSubdomain(`lang-${stamp}`);
    const url = `${site.origin}/demo.html?organization_id=${organizationId}`;
    let brandId: string | null = null;
    let websiteId: string | null = null;

    try {
      // --- 1. The picker in the real console, on the default brand: look, never save.
      await agentPage.goto('/app/settings/widget');
      const language = agentPage.getByRole('combobox', { name: 'Widget language' });
      await expect(language).toHaveValue('auto');
      await expect(agentPage.getByRole('combobox', { name: 'Fallback language' })).toHaveValue(
        'tr',
      );
      await expect(
        agentPage.getByText(/install snippet \(data-language\) overrides/),
      ).toBeVisible();
      await agentPage.screenshot({ path: 'kanit/wg-02-language-picker.png', fullPage: true });

      // --- 2. A second brand with its own website, left on Automatic.
      const brand = await request.post(`${API_BASE}/brands`, {
        headers: auth,
        data: { name: `Language ${stamp}`, slug: `language-${stamp}` },
      });
      expect(brand.status(), await brand.text()).toBe(201);
      brandId = ((await brand.json()) as { id: string }).id;
      const website = await request.post(`${API_BASE}/websites`, {
        headers: { ...auth, 'x-siyahtus-brand': brandId },
        data: { domain: site.hostname },
      });
      expect(website.status(), await website.text()).toBe(201);
      websiteId = ((await website.json()) as { id: string }).id;
      await saveLanguage(request, auth, brandId, { language: 'auto', fallback_language: 'de' });

      // --- 3. Automatic: a Turkish browser gets Turkish, a Japanese one the fallback (German).
      await visit(browser, 'tr-TR', url, async (page) => {
        const frame = widgetFrame(page);
        await expect(frame.getByRole('button', { name: 'Sohbeti aç' })).toBeVisible();
        await expect(frame.locator('html')).toHaveAttribute('lang', 'tr');
      });
      await visit(browser, 'ja-JP', url, async (page) => {
        const frame = widgetFrame(page);
        await frame.getByRole('button', { name: /^(Open chat|Chat öffnen)$/ }).click();
        // English until the token says what the fallback is, then German.
        await expect(frame.locator('html')).toHaveAttribute('lang', 'de');
        await expect(frame.getByRole('button', { name: 'Chat schließen' }).first()).toBeVisible();
      });

      // --- 4. English pinned: the Turkish browser still reads English once the token lands.
      await saveLanguage(request, auth, brandId, { language: 'en' });
      await visit(browser, 'tr-TR', url, async (page) => {
        const frame = widgetFrame(page);
        await frame.getByRole('button', { name: /^(Sohbeti aç|Open chat)$/ }).click();
        await expect(frame.locator('html')).toHaveAttribute('lang', 'en');
        await expect(frame.getByRole('button', { name: 'Close chat' }).first()).toBeVisible();
      });

      // --- 5. Arabic pinned: the document turns right-to-left.
      await saveLanguage(request, auth, brandId, { language: 'ar' });
      await visit(browser, 'en-US', url, async (page) => {
        const frame = widgetFrame(page);
        await frame.getByRole('button', { name: /^(Open chat|فتح المحادثة)$/ }).click();
        await expect(frame.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(frame.locator('html')).toHaveAttribute('lang', 'ar');
      });
    } finally {
      if (websiteId) {
        await request.delete(`${API_BASE}/websites/${websiteId}`, {
          headers: { ...auth, ...(brandId ? { 'x-siyahtus-brand': brandId } : {}) },
        });
      }
      if (brandId) await request.delete(`${API_BASE}/brands/${brandId}`, { headers: auth });
    }
  });
});
