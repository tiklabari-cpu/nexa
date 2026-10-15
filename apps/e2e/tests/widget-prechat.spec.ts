/**
 * The widget's built-in pre-chat form as a per-brand setting (WG-01, tm 279).
 *
 * Run against a second brand of the seeded workspace, on a subdomain of its
 * own registered as that brand's website: the default brand — the one every
 * other spec's visitor is on — is never saved, so its form and the server's
 * "unsaved is not enforced" rule stay exactly as the rest of the suite expects.
 * The brand and its website are removed again (the delete cascades the
 * setting), whatever the outcome.
 */
import type { APIRequestContext } from '@playwright/test';
import {
  API_BASE,
  expect,
  ownerAccessToken,
  tenantSubdomain,
  test,
  widgetFrame,
} from './fixtures.js';

type Rule = { visible: boolean; required: boolean };
const rule = (visible: boolean, required: boolean): Rule => ({ visible, required });
const ALL_REQUIRED = {
  name: rule(true, true),
  username: rule(true, true),
  email: rule(true, true),
  message: rule(true, true),
};

async function savePrechat(
  request: APIRequestContext,
  auth: Record<string, string>,
  brandId: string,
  body: { enabled: boolean; fields: Record<string, Rule> },
): Promise<void> {
  const response = await request.put(`${API_BASE}/settings/prechat`, {
    headers: { ...auth, 'x-siyahtus-brand': brandId },
    data: body,
  });
  expect(response.status(), await response.text()).toBe(200);
}

test.describe('pre-chat form setting (WG-01)', () => {
  test('the panel card warns about the username, and a brand’s site follows its own saved form', async ({
    agentPage,
    browser,
    request,
    organizationId,
  }) => {
    test.slow();
    const stamp = Date.now().toString().slice(-6);
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
    const site = tenantSubdomain(`prechat-${stamp}`);
    let brandId: string | null = null;
    let websiteId: string | null = null;

    try {
      // --- 1. The card in the real console, on the default brand: look, never save.
      await agentPage.goto('/app/settings/chat-forms');
      const card = agentPage
        .getByRole('heading', { name: 'Built-in fields' })
        .locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
      const showUsername = card.getByRole('checkbox', { name: 'Show Username' });
      await expect(showUsername).toBeChecked();
      await expect(card.getByText(/have not been saved/)).toBeVisible();
      await showUsername.uncheck();
      await expect(card.getByText(/member recognition and same-day/)).toBeVisible();
      await expect(card.getByRole('checkbox', { name: 'Require Username' })).toBeDisabled();
      await agentPage.screenshot({ path: 'kanit/wg-01-prechat-card.png', fullPage: true });
      await card.getByRole('button', { name: 'Discard changes' }).click();
      await expect(showUsername).toBeChecked();

      // --- 2. A second brand with its own website, its form switched off.
      const brand = await request.post(`${API_BASE}/brands`, {
        headers: auth,
        data: { name: `Prechat ${stamp}`, slug: `prechat-${stamp}` },
      });
      expect(brand.status(), await brand.text()).toBe(201);
      brandId = ((await brand.json()) as { id: string }).id;
      const website = await request.post(`${API_BASE}/websites`, {
        headers: { ...auth, 'x-siyahtus-brand': brandId },
        data: { domain: site.hostname },
      });
      expect(website.status(), await website.text()).toBe(201);
      websiteId = ((await website.json()) as { id: string }).id;
      await savePrechat(request, auth, brandId, { enabled: false, fields: ALL_REQUIRED });

      // --- 3. On that site the launcher opens the composer; the first line opens the chat.
      const off = await browser.newContext();
      try {
        const page = await off.newPage();
        await page.goto(`${site.origin}/demo.html?organization_id=${organizationId}`);
        const frame = widgetFrame(page);
        await frame.getByRole('button', { name: 'Open chat' }).click();
        const composer = frame.getByRole('textbox', { name: 'Message', exact: true });
        await expect(composer).toBeVisible();
        await expect(frame.getByRole('button', { name: 'Start chat' })).toBeHidden();

        const text = `Site açılmıyor ${stamp}`;
        const recorded = page.waitForResponse(
          (r) => r.url().includes('/customer/chat/events') && r.request().method() === 'POST',
        );
        await composer.fill(text);
        await frame.getByRole('button', { name: 'Send' }).click();
        expect((await recorded).status()).toBe(201);
        await expect(frame.getByRole('log', { name: 'Conversation' })).toContainText(text);
      } finally {
        await off.close();
      }

      // --- 4. Saved again with an optional username: the next visitor's token
      //        carries it — no reinstall — and the form starts without one.
      await savePrechat(request, auth, brandId, {
        enabled: true,
        fields: { ...ALL_REQUIRED, username: rule(true, false) },
      });
      const optional = await browser.newContext();
      try {
        const page = await optional.newPage();
        await page.goto(`${site.origin}/demo.html?organization_id=${organizationId}`);
        const frame = widgetFrame(page);
        await frame.getByRole('button', { name: 'Open chat' }).click();
        await expect(frame.getByRole('button', { name: 'Start chat' })).toBeVisible();
        await expect(frame.getByRole('textbox', { name: 'Username' })).not.toHaveAttribute(
          'required',
        );
        await expect(frame.getByRole('textbox', { name: 'Full name' })).toHaveAttribute('required');

        const text = `Üye olmak istiyorum ${stamp}`;
        const recorded = page.waitForResponse(
          (r) => r.url().includes('/customer/chat/events') && r.request().method() === 'POST',
        );
        await frame.getByRole('textbox', { name: 'Full name' }).fill('Misafir');
        await frame
          .getByRole('textbox', { name: 'Email', exact: true })
          .fill(`guest-${stamp}@example.test`);
        await frame.getByRole('textbox', { name: 'Your message' }).fill(text);
        await frame.getByRole('button', { name: 'Start chat' }).click();
        const sent = await recorded;
        expect(sent.status()).toBe(201);
        expect(sent.request().postDataJSON()).not.toHaveProperty('username');
        await expect(frame.getByRole('log', { name: 'Conversation' })).toContainText(text);
      } finally {
        await optional.close();
      }
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
