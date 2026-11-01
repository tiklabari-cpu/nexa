/**
 * The live WhatsApp channel's two screens (tm 380 · KN-01 · FR-MOD-08.5.6),
 * with Meta faked — the e2e stack runs no Meta app, so the deployment's answer
 * and the reply window are stood in for in the browser (`page.route`), the
 * way `pilot-mode.spec.ts` stands in for `GET /deployment`. The server half —
 * signature, tenant, wamid, the window's refusal, the file rules — is proved
 * against a local Graph in `apps/api/test/integration/whatsapp-live.test.ts`.
 *
 * What only a browser shows: Settings → Channels offers Meta's embedded signup
 * instead of the mock form, and a WhatsApp conversation past its 24-hour
 * window says so in the composer and will not send a reply — an internal note
 * still goes.
 */
import { request as newApiContext, type APIRequestContext, type Page } from '@playwright/test';
import {
  ACME_OWNER,
  API_BASE,
  channelWebhook,
  expect,
  ownerAccessTokenFor,
  test,
} from './fixtures.js';

const STAMP = Date.now().toString().slice(-6);
const BUSINESS_NUMBER = `+90555${STAMP}`;
const CUSTOMER_NUMBER = `+90532${STAMP}`;

let apiCtx: APIRequestContext;

test.beforeAll(async () => {
  apiCtx = await newApiContext.newContext({
    extraHTTPHeaders: { 'user-agent': 'siyahtus-e2e-whatsapp-window' },
  });
});

test.afterAll(async () => {
  // Leave the workspace as the other channel specs expect it: nothing connected.
  const auth = { authorization: `Bearer ${await ownerAccessTokenFor(apiCtx, ACME_OWNER)}` };
  await apiCtx.post(`${API_BASE}/channels/whatsapp/disconnect`, { headers: auth });
  await apiCtx.dispose();
});

/** The deployment as the server says, plus a live WhatsApp. */
async function fakeLiveWhatsApp(page: Page): Promise<void> {
  // Read through the API context, not `route.fetch`: the browser's `localhost`
  // reaches the dev server, Node's resolves to ::1, where nothing listens.
  const response = await apiCtx.get(`${API_BASE}/deployment`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as Record<string, unknown>;
  await page.route('**/api/v1/deployment', (route) =>
    route.fulfill({ json: { ...body, live_apps: ['whatsapp'] } }),
  );
}

test.describe('live WhatsApp (tm 380 · FR-MOD-08.5.6)', () => {
  test.describe.configure({ mode: 'serial' });

  test("Settings offers Meta's embedded signup instead of the mock form", async ({ agentPage }) => {
    await fakeLiveWhatsApp(agentPage);
    await agentPage.goto('/app/settings/channels');
    const card = agentPage
      .getByRole('region', { name: 'Channels' })
      .getByTestId('channel-whatsapp');
    await expect(card.getByRole('button', { name: 'Connect with Meta' })).toBeVisible();
    await expect(card.getByText(/Connect a WhatsApp Business number through Meta/)).toBeVisible();
    // The mock's WABA-id form is not offered once the channel is real.
    await expect(card.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
  });

  test('a conversation past the 24-hour window locks the reply and says why; a note still goes', async ({
    agentPage,
  }) => {
    test.slow();
    // The conversation itself arrives through the mock adapter (the stack has
    // no Meta); only the window's answer is Meta's, faked as closed.
    const auth = { authorization: `Bearer ${await ownerAccessTokenFor(apiCtx, ACME_OWNER)}` };
    const connected = await apiCtx.post(`${API_BASE}/channels/whatsapp/connect`, {
      headers: auth,
      data: { waba_id: `waba-${STAMP}`, phone_number: BUSINESS_NUMBER },
    });
    expect(connected.ok(), await connected.text()).toBe(true);
    const question = `Çekimim ne zaman gelir? ${STAMP}`;
    const { chat_id: chatId } = await channelWebhook(apiCtx, 'whatsapp', {
      to: BUSINESS_NUMBER,
      from: CUSTOMER_NUMBER,
      text: { body: question },
      profile_name: `Ada ${STAMP}`,
    });

    await fakeLiveWhatsApp(agentPage);
    await agentPage.route(`**/api/v1/chats/${chatId}/reply-window`, (route) =>
      route.fulfill({
        json: {
          chat_id: chatId,
          channel: 'whatsapp',
          live: true,
          open: false,
          closes_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        },
      }),
    );

    await agentPage.goto('/app/inbox');
    const list = agentPage.getByRole('region', { name: 'Conversations' });
    await expect(list).toContainText(question, { timeout: 20_000 });
    await list.getByRole('button').filter({ hasText: question }).first().click();
    await expect(agentPage.locator('main')).toContainText(question);

    const band = agentPage.getByTestId('reply-window-closed');
    await expect(band).toBeVisible();
    await expect(band).toContainText('24-hour window closed');

    const composer = agentPage.getByPlaceholder('Type your reply');
    await composer.fill(`Geç kalmış yanıt ${STAMP}`);
    await expect(agentPage.getByRole('button', { name: 'Send' })).toBeDisabled();
    await agentPage.screenshot({ path: 'kanit/08.5.6-whatsapp-window.png', fullPage: true });

    await agentPage.getByRole('radio', { name: 'Internal note' }).click();
    await expect(band).toHaveCount(0);
    await expect(agentPage.getByRole('button', { name: 'Send' })).toBeEnabled();
  });
});
