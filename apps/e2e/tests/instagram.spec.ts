/**
 * Instagram DMs, end to end — FR-MOD-08.5.7 (+ FR-MOD-08.5.1, FR-MOD-02.1.4).
 *
 * The slices that built this channel each proved their own layer: the contract
 * (08.5.7-a), the adapter (-b), the registry and inbound routing (-c), address
 * ownership (-d), the Settings card (-e), and the Inbox view row (-g). Nothing
 * proved they line up. Six green layers still leave a channel an admin cannot
 * actually use — a card that writes a row the inbox never reads from, a view
 * that only appears after a reload nobody would think to do, a webhook that
 * routes to a workspace whose screens show nothing.
 *
 * So this drives the whole claim in one browser, in the order a person would:
 * connect Instagram in Settings → a DM arrives at the public provider webhook →
 * the conversation is in the inbox with its text readable → the channel has its
 * own row in the Views group and the "connect a channel" promo is gone →
 * disconnect and the card is honest about it again.
 *
 * The DM is delivered by POSTing the public webhook rather than by writing to
 * the database, because an anonymous POST carrying nothing but the connected
 * address is exactly what Meta does and exactly what has to work.
 */
import { channelWebhook, expect, test } from './fixtures.js';

/** A run-unique Instagram account id, so the run cannot collide with its own leftovers. */
function igAccountId(): string {
  // Real IG user ids are 17 digits; keeping the shape makes the evidence
  // screenshots read like the product rather than like a fixture.
  return `1784140${Date.now().toString().slice(-10)}`;
}

/** The Meta webhook body for a DM: recipient = the connected account, sender = an IGSID. */
function instagramDm(
  igUserId: string,
  senderId: string,
  text: string,
  username: string,
): Record<string, unknown> {
  return {
    recipient: { id: igUserId },
    sender: { id: senderId, username },
    message: { text },
  };
}

test.describe('Instagram DMs (FR-MOD-08.5.7)', () => {
  /**
   * The "before" half of the acceptance criterion, asserted rather than assumed.
   *
   * Without it the connected assertions below prove far less: a rail row that
   * was always there, or a card that always said Connect, would satisfy them.
   * This also guards 08.5.7-e's actual change — the Instagram card is a live
   * connect surface now, not one of the "Coming soon" placeholders.
   */
  test('offers no Instagram view and a connectable card while nothing is connected', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/inbox');

    // FR-MOD-02.1.4: no known channel connected → the promo, not an empty group.
    const views = agentPage.getByRole('navigation', { name: 'Inbox views' });
    await expect(agentPage.getByTestId('channel-promo')).toBeVisible();
    await expect(views.getByRole('link', { name: 'Instagram' })).toHaveCount(0);

    await agentPage.goto('/app/settings');
    const card = agentPage.getByRole('region', { name: 'Channels' }).getByTestId('channel-instagram');

    // Not "Coming soon" any more, and not pretending to be connected either.
    await expect(card.getByText('Not connected')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Connect' })).toBeVisible();
    await expect(card.getByText('Coming soon')).toHaveCount(0);
  });

  test('connects the account, delivers a DM to the inbox, and disconnects again', async ({
    agentPage,
    request,
  }) => {
    // Six surfaces in one test on purpose — the seam between them is the claim.
    // That is more than the 45s default budget covers on a cold dev server.
    test.slow();

    const stamp = Date.now().toString().slice(-6);
    const igUserId = igAccountId();
    const senderName = `bike_fan_${stamp}`;
    const dm = `Do you ship a frame to Iceland? ${stamp}`;

    // --- (i) Connect, through the mock OAuth handshake the card offers --------
    await agentPage.goto('/app/settings');
    const channels = agentPage.getByRole('region', { name: 'Channels' });
    const card = channels.getByTestId('channel-instagram');
    await expect(card.getByText('Not connected')).toBeVisible();

    await card.getByRole('button', { name: 'Connect' }).click();
    const dialog = agentPage.getByRole('dialog', { name: 'Connect Instagram' });
    await expect(dialog).toBeVisible();

    // Neither field may be skipped — an account id is what the webhook routes on,
    // so a blank one would connect a channel nothing could ever reach.
    const submit = dialog.getByRole('button', { name: 'Connect' });
    await dialog.getByLabel('Authorization code').fill('IGQ_mock_oauth_code');
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('Instagram user id').fill(igUserId);
    await expect(submit).toBeEnabled();

    // Wait for the POST rather than the redraw: the card is fed by an
    // invalidated query, and asserting the badge before the round trip lands
    // would be asserting optimism.
    const connected = agentPage.waitForResponse(
      (response) =>
        response.url().endsWith('/channels/instagram/connect') &&
        response.request().method() === 'POST',
    );
    await submit.click();
    expect((await connected).status()).toBe(200);

    await expect(dialog).toHaveCount(0);
    // "Connected", not "Not connected" — the latter contains the former as a
    // substring, so the absent negative is what makes the positive mean anything.
    await expect(card.getByText('Not connected')).toHaveCount(0);
    await expect(card.getByText('Connected')).toBeVisible();
    // The address an admin has to be able to read back to know which account
    // this is — and the same value the inbound webhook resolves below.
    await expect(card.getByText(igUserId)).toBeVisible();
    await expect(card.getByRole('button', { name: 'Disconnect' })).toBeVisible();
    await agentPage.screenshot({ path: 'kanit/08.5.7-instagram-connected.png', fullPage: true });

    // --- (ii) A DM arrives the way Meta sends one ----------------------------
    // Anonymous, public, routed by the address alone. No session, no token.
    const { chat_id: chatId } = await channelWebhook(
      request,
      'instagram',
      instagramDm(igUserId, `igsid_${stamp}`, dm, senderName),
    );
    expect(chatId).toBeTruthy();

    // --- (iii) It is a conversation in the inbox, readable ------------------
    await agentPage.goto('/app/inbox');
    const list = agentPage.getByRole('region', { name: 'Conversations' });
    await expect(list).toContainText(dm, { timeout: 20_000 });
    // The sender's Instagram handle names the customer, so an agent knows who
    // wrote in rather than seeing another anonymous "Visitor".
    await expect(list).toContainText(senderName);

    await list.getByRole('button').filter({ hasText: dm }).first().click();
    await expect(agentPage.locator('main')).toContainText(dm);

    // --- (iv) The Views group lists the channel, and drops the promo ---------
    const views = agentPage.getByRole('navigation', { name: 'Inbox views' });
    await expect(views.getByRole('link', { name: 'Instagram' })).toBeVisible();
    await expect(agentPage.getByTestId('channel-promo')).toHaveCount(0);
    await agentPage.screenshot({ path: 'kanit/08.5.7-instagram-inbox.png', fullPage: true });

    // --- (v) Disconnect, and every surface tells the truth again -------------
    await agentPage.goto('/app/settings');
    const cardAgain = agentPage
      .getByRole('region', { name: 'Channels' })
      .getByTestId('channel-instagram');

    // Disconnecting stops inbound DMs, so it asks first.
    let asked: string | null = null;
    agentPage.once('dialog', (d) => {
      asked = d.message();
      return d.accept();
    });
    const removed = agentPage.waitForResponse(
      (response) =>
        response.url().endsWith('/channels/instagram/disconnect') &&
        response.request().method() === 'POST',
    );
    await cardAgain.getByRole('button', { name: 'Disconnect' }).click();
    expect((await removed).status()).toBe(204);
    await expect.poll(() => asked).toContain('Disconnect Instagram?');

    await expect(cardAgain.getByText('Not connected')).toBeVisible();
    await expect(cardAgain.getByRole('button', { name: 'Connect' })).toBeVisible();
    await agentPage.screenshot({ path: 'kanit/08.5.7-instagram-disconnected.png', fullPage: true });

    // The rail follows the same live state rather than latching: the row goes,
    // and the promo an unconnected workspace should see comes back.
    await agentPage.goto('/app/inbox');
    await expect(agentPage.getByTestId('channel-promo')).toBeVisible();
    await expect(
      agentPage.getByRole('navigation', { name: 'Inbox views' }).getByRole('link', {
        name: 'Instagram',
      }),
    ).toHaveCount(0);
  });
});
