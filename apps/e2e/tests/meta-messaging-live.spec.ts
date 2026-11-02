/**
 * Live Messenger / Instagram's screens (tm 381 · KN-02 · FR-MOD-08.5.4 ·
 * FR-MOD-08.5.7), with Meta faked — the e2e stack runs no Meta app, so the
 * deployment's answer, Facebook's login dialog and the API's Meta-backed
 * answers are stood in for in the browser (`route`), the way
 * `whatsapp-window.spec.ts` does for WhatsApp. The server half — signature,
 * tenant, `mid`, page token, the window's refusal — is proved against a local
 * Graph in `apps/api/test/integration/meta-messaging-live.test.ts`.
 *
 * What only a browser shows: the Messenger card runs Facebook Login in a
 * pop-up whose callback page hands the code back to the card, then lists the
 * pages to choose from and connects the one chosen; an Instagram conversation
 * past its 24-hour window says so in the composer, naming Instagram.
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
const PAGE_ID = `10477${STAMP}`;
const IG_USER = `17841${STAMP}`;
const IGSID = `11223${STAMP}`;

let apiCtx: APIRequestContext;

test.beforeAll(async () => {
  apiCtx = await newApiContext.newContext({
    extraHTTPHeaders: { 'user-agent': 'siyahtus-e2e-meta-messaging' },
  });
});

test.afterAll(async () => {
  // Leave the workspace as the other channel specs expect it: nothing connected.
  const auth = { authorization: `Bearer ${await ownerAccessTokenFor(apiCtx, ACME_OWNER)}` };
  await apiCtx.post(`${API_BASE}/channels/instagram/disconnect`, { headers: auth });
  await apiCtx.dispose();
});

/** The deployment as the server says, plus live Messenger and Instagram. */
async function fakeLiveMeta(page: Page): Promise<void> {
  // Read through the API context, not `route.fetch`: the browser's `localhost`
  // reaches the dev server, Node's resolves to ::1, where nothing listens.
  const response = await apiCtx.get(`${API_BASE}/deployment`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as Record<string, unknown>;
  await page.route('**/api/v1/deployment', (route) =>
    route.fulfill({ json: { ...body, live_apps: ['messenger', 'instagram'] } }),
  );
}

test.describe('live Messenger / Instagram (tm 381 · FR-MOD-08.5.4 · FR-MOD-08.5.7)', () => {
  test.describe.configure({ mode: 'serial' });

  test('the Messenger card logs in with Facebook, lists the pages and connects the one chosen', async ({
    agentPage,
  }) => {
    await fakeLiveMeta(agentPage);
    let connected = false;
    let connectBody: unknown = null;

    await agentPage.route('**/api/v1/channels/meta/login-config', (route) =>
      route.fulfill({
        json: {
          app_id: '2233445566',
          graph_version: 'v21.0',
          redirect_uri: `${new URL(agentPage.url()).origin}/channels/meta/callback`,
          scopes: { messenger: ['pages_show_list', 'pages_messaging'], instagram: [] },
        },
      }),
    );
    await agentPage.route('**/api/v1/channels/meta/pages', (route) =>
      route.fulfill({
        json: {
          selection_id: `sel_e2e_${STAMP}_abcdefgh`,
          pages: [
            { id: PAGE_ID, name: `Acme Bet ${STAMP}`, instagram: null },
            { id: '104770000000009', name: 'Acme Destek', instagram: null },
          ],
        },
      }),
    );
    await agentPage.route('**/api/v1/channels/messenger/connect', async (route) => {
      connectBody = route.request().postDataJSON();
      connected = true;
      await route.fulfill({ json: { type: 'messenger', connected: true, live: true } });
    });
    await agentPage.route('**/api/v1/channels', async (route) => {
      if (!connected) return route.fallback();
      return route.fulfill({
        json: {
          items: [
            {
              type: 'messenger',
              brand_id: '00000000-0000-0000-0000-000000000000',
              status: 'connected',
              address: PAGE_ID,
              display_address: `Acme Bet ${STAMP}`,
              connected: true,
              created_at: new Date().toISOString(),
              live: true,
              needs_reconnect: false,
            },
          ],
        },
      });
    });
    // Facebook's dialog: it sends the pop-up straight back to the console's
    // callback page with a code and the card's own state, as Meta would.
    await agentPage.context().route('https://www.facebook.com/**', (route) => {
      const dialog = new URL(route.request().url());
      const back = new URL(dialog.searchParams.get('redirect_uri') ?? '');
      back.searchParams.set('code', `e2e-code-${STAMP}`);
      back.searchParams.set('state', dialog.searchParams.get('state') ?? '');
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><script>location.replace(${JSON.stringify(back.toString())})</script>`,
      });
    });

    await agentPage.goto('/app/settings/channels');
    const card = agentPage
      .getByRole('region', { name: 'Channels' })
      .getByTestId('channel-messenger');
    await expect(card.getByText(/Connect a Facebook Page/)).toBeVisible();
    // The mock's page-id form is not offered once the channel is real.
    await expect(card.getByRole('button', { name: 'Connect with Facebook (mock)' })).toHaveCount(0);

    const popupOpened = agentPage.waitForEvent('popup');
    await card.getByRole('button', { name: 'Connect with Facebook' }).click();
    const popup = await popupOpened;
    await popup.waitForEvent('close', { timeout: 15_000 });

    const group = card.getByRole('group', { name: 'Choose the page' });
    await expect(group).toBeVisible();
    await group.getByRole('radio', { name: `Acme Bet ${STAMP}` }).check();
    await card.getByRole('button', { name: 'Connect', exact: true }).click();

    await expect(card.getByText(`Acme Bet ${STAMP}`)).toBeVisible();
    await expect(card.getByText('Live')).toBeVisible();
    expect(connectBody).toEqual({ selection_id: `sel_e2e_${STAMP}_abcdefgh`, page_id: PAGE_ID });
    await agentPage.screenshot({ path: 'kanit/08.5.4-messenger-live.png', fullPage: true });
  });

  test('an Instagram conversation past the 24-hour window locks the reply and names Instagram', async ({
    agentPage,
  }) => {
    test.slow();
    // The conversation itself arrives through the mock adapter (the stack has
    // no Meta); only the window's answer is Meta's, faked as closed.
    const auth = { authorization: `Bearer ${await ownerAccessTokenFor(apiCtx, ACME_OWNER)}` };
    const connected = await apiCtx.post(`${API_BASE}/channels/instagram/connect`, {
      headers: auth,
      data: { code: `e2e-${STAMP}`, ig_user_id: IG_USER, username: `acme${STAMP}` },
    });
    expect(connected.ok(), await connected.text()).toBe(true);
    const question = `Bonusum yüklenmedi ${STAMP}`;
    const { chat_id: chatId } = await channelWebhook(apiCtx, 'instagram', {
      recipient: { id: IG_USER },
      sender: { id: IGSID, username: `oyuncu${STAMP}` },
      message: { text: question },
    });

    await fakeLiveMeta(agentPage);
    await agentPage.route(`**/api/v1/chats/${chatId}/reply-window`, (route) =>
      route.fulfill({
        json: {
          chat_id: chatId,
          channel: 'instagram',
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
    await expect(band).toContainText('Instagram only lets you reply within 24 hours');

    await agentPage.getByPlaceholder('Type your reply').fill(`Geç kalmış yanıt ${STAMP}`);
    await expect(agentPage.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});
