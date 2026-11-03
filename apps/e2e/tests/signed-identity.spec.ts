/**
 * Operator-signed member identity, end to end (ID-03 · K28 · tm 388).
 *
 * An admin switches signed identity on and issues the secret; the operator's
 * server — this test, with Node's crypto, exactly as the install guide's
 * example — signs the logged-in member; the host page hands the signature to
 * `siyahtus('identify', …)`. The widget mints with it at once, the pre-chat
 * form stops asking for the username the operator signed, and the agent
 * answering the conversation finds a verified member on the player card: the
 * badge, the signed username marked as signed, the member id.
 *
 * Every refusal (wrong secret, too old, used twice, switched off), the
 * rotation's grace window and the cross-workspace rule are the server's and
 * are pinned by `member-identity.test.ts`; the widget's re-mint and its
 * stale-poll guard by `widget.identify.test.ts`.
 */
import { createHmac } from 'node:crypto';
import {
  API_BASE,
  HOST_PAGE,
  allChats,
  expect,
  ownerAccessToken,
  test,
  widgetFrame,
} from './fixtures.js';

/** The install guide's Node example, verbatim in what it signs. */
function sign(
  secret: string,
  user: { id: string; username: string; email: string },
): Record<string, unknown> {
  const ts = Math.floor(Date.now() / 1000) - 5;
  const message = ['siyahtus-identify-v1', user.id, user.username, user.email, String(ts)].join(
    '\n',
  );
  const user_hash = createHmac('sha256', secret).update(message).digest('hex');
  return { user_id: user.id, username: user.username, email: user.email, ts, user_hash };
}

test('a member the operator’s site signed is a verified member on the player card, and is not asked for a username (ID-03 · K28)', async ({
  agentPage,
  browser,
  organizationId,
  request,
}) => {
  const stamp = Date.now().toString().slice(-6);
  const member = {
    id: `player-${stamp}`,
    username: `imzali_${stamp}`,
    email: `p${stamp}@example.test`,
  };
  const opening = `Yatırımım görünmüyor ${stamp}`;
  const auth = { Authorization: `Bearer ${await ownerAccessToken(request)}` };

  const on = await request.patch(`${API_BASE}/settings/member-recognition`, {
    headers: auth,
    data: { signed_identity_enabled: true },
  });
  expect(on.ok(), `switching on failed: ${on.status()}`).toBe(true);
  const issued = await request.post(`${API_BASE}/settings/member-recognition/identity-secret`, {
    headers: auth,
    data: {},
  });
  expect(issued.ok(), `issuing failed: ${issued.status()}`).toBe(true);
  expect(issued.headers()['cache-control']).toBe('no-store');
  const secret = ((await issued.json()) as { identity_secret: string }).identity_secret;

  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  try {
    await visitor.goto(`${HOST_PAGE}/demo.html?organization_id=${organizationId}`);
    await visitor.waitForFunction(
      () => typeof (window as { siyahtus?: unknown }).siyahtus === 'function',
    );

    // The page hands over what its server signed; the widget mints with it now.
    const minted = visitor.waitForResponse(
      (response) =>
        response.url().includes('/customer/token') &&
        response.request().method() === 'POST' &&
        response.ok(),
    );
    await visitor.evaluate(
      (identity) => {
        (window as unknown as { siyahtus: (c: string, p: unknown) => void }).siyahtus(
          'identify',
          identity,
        );
      },
      sign(secret, member),
    );
    const body = (await (await minted).json()) as { identity_verified: boolean };
    expect(body.identity_verified).toBe(true);

    const frame = widgetFrame(visitor);
    await frame.getByRole('button', { name: 'Open chat' }).click();
    await expect(frame.getByRole('button', { name: 'Start chat' })).toBeVisible();
    // The operator signed the username: the form does not ask for it.
    await expect(frame.getByRole('textbox', { name: 'Username' })).toBeHidden();
    await frame.getByRole('textbox', { name: 'Full name' }).fill('Ayşe Üye');
    await frame.getByRole('textbox', { name: 'Email', exact: true }).fill(member.email);
    await frame.getByRole('textbox', { name: 'Your message' }).fill(opening);
    const sent = visitor.waitForResponse(
      (response) =>
        response.url().includes('/customer/chat/events') &&
        response.request().method() === 'POST' &&
        response.ok(),
    );
    await frame.getByRole('button', { name: 'Start chat' }).click();
    await sent;

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

    await agentPage.goto(`/app/inbox?chat=${chatId}`);
    const details = agentPage.getByRole('complementary', { name: 'Conversation details' });
    const card = details.getByTestId('player-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByText('Verified member')).toBeVisible();
    await expect(card.getByText(member.username)).toBeVisible();
    await expect(card.getByText('Signed by your website')).toBeVisible();
    await expect(card.getByText('Player’s own claim, not verified')).toHaveCount(0);
    await expect(card.getByText(member.id)).toBeVisible();
    await agentPage.screenshot({ path: 'kanit/ID-03-signed-identity.png', fullPage: true });
  } finally {
    await visitorContext.close();
    // Back to the workspace's default for the specs after this one.
    await request.patch(`${API_BASE}/settings/member-recognition`, {
      headers: auth,
      data: { signed_identity_enabled: false },
    });
  }
});
