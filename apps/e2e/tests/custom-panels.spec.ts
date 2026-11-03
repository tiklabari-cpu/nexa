/**
 * Custom panels in the Inbox (KN-05 · owner decision K29 · tm 379), in a real
 * browser.
 *
 * There is no https server in the e2e stack, and the address must be
 * `https://` (the API and a CHECK refuse anything else) — so the operator's
 * back-office is `https://panel.test/…`, answered by `context.route` with a
 * small page that speaks the bridge: it reads its channel nonce from the
 * fragment, says `ready`, shows what the token says, asks to be taller, and
 * offers a reply. A second fake origin, `https://evil.test`, is framed by the
 * test itself and posts the same `insert_text` — with the right nonce, even —
 * which the console must ignore.
 *
 * KN-05's acceptance, browser half:
 *   - the panel for the conversation's team is drawn, another team's is not;
 *   - after `ready` the page gets this conversation's signed context;
 *   - a postMessage from another origin does nothing;
 *   - the username is in no address — the frame's, the new tab's, any request's.
 * The token's five-minute life and the team rule's other half are the API
 * suite's (`custom-panels.test.ts`); the message gate in detail is
 * `panelBridge.test.ts`.
 */
import type { Page, Request } from '@playwright/test';
import {
  API_BASE,
  PRECHAT_VISITOR,
  allChats,
  expect,
  openWidget,
  ownerAccessToken,
  test,
  visitorSends,
} from './fixtures.js';

const PANEL_URL = 'https://panel.test/card?view=player';
const SUGGESTION = 'Your deposit shows as credited on our side.';

/** The operator's page, the way a real back-office would speak the bridge. */
const PANEL_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Back-office card</title></head>
<body>
<h1>Back-office card</h1>
<p id="state">waiting</p>
<p id="chat"></p>
<p id="player"></p>
<p id="audience"></p>
<button id="suggest" type="button">Suggest a reply</button>
<script>
  var channel = new URLSearchParams(location.hash.slice(1)).get('siyahtus_channel');
  function claimsOf(token) {
    var body = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(body));
  }
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== 'siyahtus:context' || data.channel !== channel) return;
    var claims = claimsOf(data.token);
    document.getElementById('state').textContent = 'context received';
    document.getElementById('chat').textContent = 'chat ' + claims.chat_id;
    document.getElementById('player').textContent =
      'player ' + (claims.player ? claims.player.username : 'none');
    document.getElementById('audience').textContent = 'aud ' + claims.aud;
  });
  document.getElementById('suggest').addEventListener('click', function () {
    window.parent.postMessage(
      { type: 'siyahtus:insert_text', channel: channel, text: ${JSON.stringify(SUGGESTION)} },
      '*'
    );
  });
  window.parent.postMessage({ type: 'siyahtus:ready', channel: channel }, '*');
  window.parent.postMessage({ type: 'siyahtus:resize', channel: channel, height: 420 }, '*');
</script>
</body></html>`;

/** Another origin that has somehow learnt the nonce — and still must not be heard. */
const EVIL_PAGE = `<!doctype html><html><body><script>
  var channel = new URLSearchParams(location.hash.slice(1)).get('channel');
  window.parent.postMessage({ type: 'siyahtus:insert_text', channel: channel, text: 'EVIL TEXT' }, '*');
  window.parent.postMessage({ type: 'siyahtus:ready', channel: channel }, '*');
</script></body></html>`;

async function routeFakeOrigins(page: Page): Promise<void> {
  await page
    .context()
    .route('https://panel.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: PANEL_PAGE }),
    );
  await page
    .context()
    .route('https://evil.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: EVIL_PAGE }),
    );
}

test('a custom panel gets its conversation by postMessage, ignores another origin, and puts no username in an address (KN-05)', async ({
  agentPage,
  browser,
  organizationId,
  request,
}) => {
  const stamp = Date.now().toString().slice(-6);
  const opening = `Where is my deposit — ${stamp}`;
  const auth = { Authorization: `Bearer ${await ownerAccessToken(request)}` };
  const created: string[] = [];
  let otherTeam: number | null = null;

  const urls: string[] = [];
  const record = (req: Request): void => void urls.push(req.url());
  agentPage.context().on('request', record);

  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  try {
    await routeFakeOrigins(agentPage);
    await openWidget(visitor, organizationId);
    await visitorSends(visitor, opening);

    let chatId = '';
    await expect
      .poll(
        async () => {
          chatId =
            (await allChats(request, auth)).find((chat) => chat.last_event?.text === opening)?.id ??
            '';
          return chatId;
        },
        { timeout: 20_000 },
      )
      .not.toBe('');
    const detail = (await (
      await request.get(`${API_BASE}/chats/${chatId}`, { headers: auth })
    ).json()) as { access: { group_ids: number[] } };
    expect(detail.access.group_ids.length).toBeGreaterThan(0);

    // A team this conversation is not routed to, with a panel of its own.
    const team = await request.post(`${API_BASE}/groups`, {
      headers: auth,
      data: { name: `Other team ${stamp}` },
    });
    expect(team.ok(), await team.text()).toBe(true);
    otherTeam = ((await team.json()) as { id: number }).id;

    const mine = await request.post(`${API_BASE}/settings/custom-panels`, {
      headers: auth,
      data: {
        name: `Back-office ${stamp}`,
        url: PANEL_URL,
        visible_group_ids: detail.access.group_ids,
      },
    });
    expect(mine.status(), await mine.text()).toBe(201);
    const panel = (await mine.json()) as { id: string; signing_secret: string };
    created.push(panel.id);
    const elsewhere = await request.post(`${API_BASE}/settings/custom-panels`, {
      headers: auth,
      data: { name: `Elsewhere ${stamp}`, url: PANEL_URL, visible_group_ids: [otherTeam] },
    });
    expect(elsewhere.status(), await elsewhere.text()).toBe(201);
    const elsewhereId = ((await elsewhere.json()) as { id: string }).id;
    created.push(elsewhereId);

    await agentPage.goto(`/app/inbox?chat=${chatId}`);
    await expect(agentPage.getByRole('log', { name: 'Conversation transcript' })).toContainText(
      opening,
      { timeout: 20_000 },
    );
    const details = agentPage.getByRole('complementary', { name: 'Conversation details' });
    const section = details.getByTestId(`custom-panel-${panel.id}`);
    await expect(section).toBeVisible({ timeout: 20_000 });
    // The other team's panel is not drawn on this conversation.
    await expect(details.getByTestId(`custom-panel-${elsewhereId}`)).toHaveCount(0);
    await expect(details.getByText(`Elsewhere ${stamp}`, { exact: true })).toHaveCount(0);

    const iframe = section.locator('iframe');
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-popups');
    await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
    const src = (await iframe.getAttribute('src')) ?? '';
    expect(src).toMatch(/^https:\/\/panel\.test\/card\?view=player#siyahtus_channel=[0-9a-f]{32}$/);
    const channel = src.split('siyahtus_channel=')[1]!;

    // After `ready`: this conversation's signed context, the player named in it.
    const card = agentPage.frameLocator(`[data-testid="custom-panel-${panel.id}"] iframe`);
    await expect(card.locator('#state')).toHaveText('context received', { timeout: 20_000 });
    await expect(card.locator('#chat')).toHaveText(`chat ${chatId}`);
    await expect(card.locator('#player')).toHaveText(`player ${PRECHAT_VISITOR.username}`);
    await expect(card.locator('#audience')).toHaveText(`aud siyahtus-panel:${panel.id}`);
    await expect(iframe).toHaveCSS('height', '420px');

    // Another origin, with the very nonce: framed by the test, heard by nobody.
    const composer = agentPage.getByPlaceholder('Type your reply');
    await expect(composer).toHaveValue('');
    await agentPage.evaluate((nonce) => {
      const evil = document.createElement('iframe');
      evil.src = `https://evil.test/#channel=${nonce}`;
      evil.setAttribute('data-testid', 'evil-frame');
      document.body.appendChild(evil);
    }, channel);
    await expect(agentPage.getByTestId('evil-frame')).toBeAttached();
    await agentPage.waitForTimeout(1_000);
    await expect(composer).toHaveValue('');

    // The page's suggestion fills the reply box and sends nothing.
    await card.locator('#suggest').click();
    await expect(composer).toHaveValue(SUGGESTION);
    await expect(agentPage.getByRole('log', { name: 'Conversation transcript' })).not.toContainText(
      SUGGESTION,
    );
    await agentPage.screenshot({ path: 'kanit/KN-05-custom-panel.png', fullPage: true });

    // Open in a new tab: a link token in the fragment, no player in it.
    const [tab] = await Promise.all([
      agentPage.waitForEvent('popup'),
      section.getByRole('button', { name: 'Open in a new tab' }).click(),
    ]);
    await expect.poll(() => tab.url(), { timeout: 20_000 }).toContain('#siyahtus_token=');
    const linkToken = decodeURIComponent(tab.url().split('#siyahtus_token=')[1]!);
    const claims = JSON.parse(Buffer.from(linkToken.split('.')[1]!, 'base64url').toString()) as {
      delivery: string;
      chat_id: string;
      player?: unknown;
    };
    expect(claims).toMatchObject({ delivery: 'link', chat_id: chatId });
    expect(claims.player).toBeUndefined();
    await tab.close();

    // KN-05: the username is in no address the console asked for.
    const leaking = urls.filter((url) => url.includes(PRECHAT_VISITOR.username));
    expect(leaking).toEqual([]);
  } finally {
    agentPage.context().off('request', record);
    for (const id of created) {
      await request.delete(`${API_BASE}/settings/custom-panels/${id}`, { headers: auth });
    }
    if (otherTeam !== null) {
      await request.delete(`${API_BASE}/groups/${otherTeam}`, { headers: auth });
    }
    await visitorContext.close();
  }
});
