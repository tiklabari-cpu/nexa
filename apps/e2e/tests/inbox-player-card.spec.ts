/**
 * The player card beside a conversation (IN-02 · tm 331.2).
 *
 * A visitor writes, the conversation is archived, and the same browser writes
 * again the same day: the API files the return as a second connection of the
 * same chat (ID-02). The agent answering the return finds the player card at
 * the top of Details, the morning's connection under "Earlier today" with its
 * number to copy, and opens that connection's transcript read-only — the
 * draft in the composer of the conversation being answered stays where it is.
 *
 * Restriction (another team's day), masking and the next day's history are the
 * server's to decide and are pinned by `customer-context.test.ts`; the card's
 * drawing of them by `PlayerCard.test.tsx`.
 */
import {
  API_BASE,
  allChats,
  expect,
  openWidget,
  ownerAccessToken,
  test,
  visitorSends,
  widgetFrame,
} from './fixtures.js';

test('the player card lists the earlier connection of the day and opens it read-only (FR-MOD-02.4.1–.6)', async ({
  agentPage,
  browser,
  organizationId,
  request,
}) => {
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  const stamp = Date.now().toString().slice(-6);
  const first = `Bonus not credited — ${stamp}`;
  const second = `Back about the bonus — ${stamp}`;
  const draft = `Checking the bonus ledger ${stamp}`;

  try {
    await openWidget(visitor, organizationId);
    await visitorSends(visitor, first);

    const auth = { Authorization: `Bearer ${await ownerAccessToken(request)}` };
    let chatId = '';
    await expect
      .poll(
        async () => {
          chatId =
            (await allChats(request, auth)).find((chat) => chat.last_event?.text === first)?.id ??
            '';
          return chatId;
        },
        { timeout: 20_000 },
      )
      .not.toBe('');

    const closed = await request.post(`${API_BASE}/chats/${chatId}/deactivate`, { headers: auth });
    expect(closed.ok(), `deactivate failed: ${closed.status()}`).toBe(true);
    await widgetFrame(visitor).getByRole('button', { name: 'Start a new chat' }).click();
    await visitorSends(visitor, second);

    const detail = await request.get(`${API_BASE}/chats/${chatId}`, { headers: auth });
    const day = (await detail.json()) as { connections: Array<{ id: string }> };
    expect(day.connections).toHaveLength(2);
    const morning = day.connections[0]!.id;

    await agentPage.goto(`/app/inbox?chat=${chatId}`);
    const transcript = agentPage.getByRole('log', { name: 'Conversation transcript' });
    await expect(transcript).toContainText(second, { timeout: 20_000 });

    const details = agentPage.getByRole('complementary', { name: 'Conversation details' });
    const card = details.getByTestId('player-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByRole('link', { name: 'Open profile' })).toHaveAttribute(
      'href',
      /\/app\/customers\?customer=/,
    );
    // An anonymous widget visitor gave no email: the card says "—", not a blank.
    await expect(card.getByText('—').first()).toBeVisible();

    const today = details.getByTestId('player-card-today');
    await expect(today.getByRole('listitem')).toHaveCount(1);
    await expect(today).toContainText(morning);

    const composer = agentPage.getByPlaceholder('Type your reply');
    await composer.fill(draft);

    await today.getByRole('button', { name: 'Read' }).click();
    const dialog = agentPage.getByRole('dialog');
    await expect(dialog).toContainText(first, { timeout: 20_000 });
    await expect(dialog).not.toContainText(second);
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    await agentPage.screenshot({ path: 'kanit/331.2-player-card.png', fullPage: true });

    await agentPage.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // The conversation being answered did not move, and neither did its draft.
    await expect(composer).toHaveValue(draft);
    await expect(transcript).toContainText(second);
  } finally {
    await visitorContext.close();
  }
});
