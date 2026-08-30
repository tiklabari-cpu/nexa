/**
 * Telegram, end to end — FR-MOD-08.5.8 (+ FR-MOD-08.5.1, FR-MOD-02.1.4).
 *
 * Five slices built this channel a layer at a time: the contract (08.5.8-a),
 * the mock adapter (-b), the registry and inbound routing (-c), the Settings
 * card (-d) and the Inbox view row (-e). Each proved its own layer green.
 * Nothing proved they line up — and five green layers still leave a channel an
 * admin cannot use: a card writing a row the inbox never reads, a view that
 * only appears after a reload nobody would think to do, a webhook routing to a
 * workspace whose screens show nothing.
 *
 * So this drives the whole claim in one browser, in the order a person would:
 * connect a bot in Settings → a message arrives at the public provider webhook
 * → the conversation is in the inbox, readable → the agent answers → the
 * channel has its own row in the Views group and the "connect a channel" promo
 * is gone → disconnect and every surface is honest about it again.
 *
 * The message is delivered by POSTing the public webhook rather than by writing
 * to the database, because an anonymous POST carrying nothing but the connected
 * bot username is exactly what Telegram does and exactly what has to work.
 *
 * The reply is asserted twice on purpose, because "answered" means two
 * different things here. The composer proves what the *agent* sees: the reply
 * lands on a Telegram-originated chat like any other. `/channels/telegram/
 * messages` proves what would reach the *customer*: the answer leaves through
 * the bot and comes back with a Telegram-shaped message id. The two are not
 * wired to each other in this build — the composer does not call the adapter —
 * so asserting only the first would quietly over-claim.
 */
import { channelWebhook, expect, test } from './fixtures.js';

/**
 * A run-unique bot `@username`, so a run cannot collide with its own leftovers.
 *
 * Real bot usernames must end in `bot`, and that shape is what makes the
 * evidence screenshot read like the product rather than like a fixture.
 */
function botUsername(stamp: string): string {
  return `acme_bikes_${stamp}_bot`;
}

/** The inbound body for a Telegram message: recipient = the connected bot. */
function telegramMessage(
  bot: string,
  senderId: string,
  text: string,
  username: string,
): Record<string, unknown> {
  return {
    recipient: { id: bot },
    sender: { id: senderId, username },
    message: { text },
  };
}

test.describe('Telegram (FR-MOD-08.5.8)', () => {
  /**
   * The "before" half of the acceptance criterion, asserted rather than assumed.
   *
   * Without it the connected assertions below prove far less: a rail row that
   * was always there, or a card that always said Connect, would satisfy them.
   * This also guards 08.5.8-d's actual change — the Telegram card is a live
   * connect surface now, not one of the "Coming soon" placeholders.
   */
  test('offers no Telegram view and a connectable card while nothing is connected', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/inbox');

    // FR-MOD-02.1.4: no known channel connected → the promo, not an empty group.
    const views = agentPage.getByRole('navigation', { name: 'Inbox views' });
    await expect(agentPage.getByTestId('channel-promo')).toBeVisible();
    await expect(views.getByRole('link', { name: 'Telegram' })).toHaveCount(0);

    await agentPage.goto('/app/settings');
    const card = agentPage
      .getByRole('region', { name: 'Channels' })
      .getByTestId('channel-telegram');

    // Not "Coming soon" any more, and not pretending to be connected either.
    await expect(card.getByText('Not connected')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Connect' })).toBeVisible();
    await expect(card.getByText('Coming soon')).toHaveCount(0);
  });

  test('connects the bot, delivers a message to the inbox, answers, and disconnects', async ({
    agentPage,
    request,
  }) => {
    // Six surfaces in one test on purpose — the seam between them is the claim.
    // That is more than the 45s default budget covers on a cold dev server.
    test.slow();

    const stamp = Date.now().toString().slice(-6);
    const bot = botUsername(stamp);
    const senderId = `88421${stamp}`;
    const senderName = `bisiklet_fan_${stamp}`;
    const question = `Reykjavik'e kargo yapiyor musunuz? ${stamp}`;
    const answer = `Evet, Izlanda'ya gonderiyoruz — ${stamp}`;

    // --- (i) Connect, with the credentials @BotFather hands out --------------
    await agentPage.goto('/app/settings');
    const channels = agentPage.getByRole('region', { name: 'Channels' });
    const card = channels.getByTestId('channel-telegram');
    await expect(card.getByText('Not connected')).toBeVisible();

    await card.getByRole('button', { name: 'Connect' }).click();
    const dialog = agentPage.getByRole('dialog', { name: 'Connect Telegram' });
    await expect(dialog).toBeVisible();

    // Neither field may be skipped — the username is what the webhook routes on,
    // so a blank one would connect a channel nothing could ever reach.
    const submit = dialog.getByRole('button', { name: 'Connect' });
    await dialog.getByLabel('Bot token').fill('123456789:AAmockBotTokenString-Value');
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('Bot username').fill(bot);
    await expect(submit).toBeEnabled();

    // Wait for the POST rather than the redraw: the card is fed by an
    // invalidated query, and asserting the badge before the round trip lands
    // would be asserting optimism.
    const connected = agentPage.waitForResponse(
      (response) =>
        response.url().endsWith('/channels/telegram/connect') &&
        response.request().method() === 'POST',
    );
    await submit.click();
    const connectResponse = await connected;
    expect(connectResponse.status()).toBe(200);
    // The bot token was validated and thrown away — it is never echoed back,
    // and `ConnectResult.config` promises it was never stored either (§6.1.1).
    expect(await connectResponse.text()).not.toContain('AAmockBotTokenString');

    await expect(dialog).toHaveCount(0);
    // "Connected", not "Not connected" — the latter contains the former as a
    // substring, so the absent negative is what makes the positive mean anything.
    await expect(card.getByText('Not connected')).toHaveCount(0);
    await expect(card.getByText('Connected')).toBeVisible();
    // The address an admin has to be able to read back to know which bot this
    // is — and the same value the inbound webhook resolves below.
    await expect(card.getByText(bot)).toBeVisible();
    await expect(card.getByRole('button', { name: 'Disconnect' })).toBeVisible();

    // --- (ii) A message arrives the way Telegram sends one -------------------
    // Anonymous, public, routed by the bot username alone. No session, no token.
    const { chat_id: chatId } = await channelWebhook(
      request,
      'telegram',
      telegramMessage(bot, senderId, question, senderName),
    );
    expect(chatId).toBeTruthy();

    // --- (iii) It is a conversation in the inbox, readable -------------------
    await agentPage.goto('/app/inbox');
    const list = agentPage.getByRole('region', { name: 'Conversations' });
    await expect(list).toContainText(question, { timeout: 20_000 });
    // The sender's Telegram handle names the customer, so an agent knows who
    // wrote in rather than seeing another anonymous "Visitor".
    await expect(list).toContainText(senderName);

    await list.getByRole('button').filter({ hasText: question }).first().click();
    await expect(agentPage.locator('main')).toContainText(question);

    // --- (iv) The agent answers ---------------------------------------------
    // The composer works on a Telegram-originated chat exactly as it does on a
    // website one — same chat core underneath — and sending it is now the whole
    // delivery: `sendEvent` hands an agent's reply to the channel dispatcher
    // once the event is committed (FR-MOD-08.5.8).
    //
    // This leg used to POST `/channels/telegram/messages` by hand right here,
    // because the composer and the provider were not wired to each other. That
    // call is gone: repeating it now would send the customer the same answer
    // twice, and its passing told us nothing about the path an agent takes.
    // What it used to assert — a `tg.`-shaped provider id and the writer
    // resolved back from the chat — is asserted against the real console reply
    // in `channels-adapters.test.ts`, which can read `channel_messages`.
    const composer = agentPage.getByPlaceholder('Type your reply');
    await composer.fill(answer);
    await composer.press('Enter');
    await expect(agentPage.locator('main')).toContainText(answer);

    // --- (v) The Views group lists the channel, and drops the promo ----------
    const views = agentPage.getByRole('navigation', { name: 'Inbox views' });
    await expect(views.getByRole('link', { name: 'Telegram' })).toBeVisible();
    await expect(agentPage.getByTestId('channel-promo')).toHaveCount(0);
    await agentPage.screenshot({ path: 'kanit/08.5.8-telegram.png', fullPage: true });

    // --- (vi) Disconnect, and every surface tells the truth again ------------
    await agentPage.goto('/app/settings');
    const cardAgain = agentPage
      .getByRole('region', { name: 'Channels' })
      .getByTestId('channel-telegram');

    // Disconnecting stops inbound messages, so it asks first.
    let asked: string | null = null;
    agentPage.once('dialog', (d) => {
      asked = d.message();
      return d.accept();
    });
    const removed = agentPage.waitForResponse(
      (response) =>
        response.url().endsWith('/channels/telegram/disconnect') &&
        response.request().method() === 'POST',
    );
    await cardAgain.getByRole('button', { name: 'Disconnect' }).click();
    expect((await removed).status()).toBe(204);
    await expect.poll(() => asked).toContain('Disconnect Telegram?');

    await expect(cardAgain.getByText('Not connected')).toBeVisible();
    await expect(cardAgain.getByRole('button', { name: 'Connect' })).toBeVisible();

    // The rail follows the same live state rather than latching: the row goes,
    // and the promo an unconnected workspace should see comes back.
    await agentPage.goto('/app/inbox');
    await expect(agentPage.getByTestId('channel-promo')).toBeVisible();
    await expect(
      agentPage.getByRole('navigation', { name: 'Inbox views' }).getByRole('link', {
        name: 'Telegram',
      }),
    ).toHaveCount(0);
  });
});
