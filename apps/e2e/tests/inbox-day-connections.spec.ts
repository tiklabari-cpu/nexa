/**
 * A member back the same day, seen from the console (ID-02 · tm 286.4).
 *
 * The visitor writes, the conversation is archived, and the same browser
 * writes again: the API files the return under the same chat as a second
 * connection (tm 286.2). What only a browser can prove is the console end of
 * it — the agent answering the return sees the morning's words above it, each
 * connection behind its own separator, the header names the day and the
 * newest connection, Details lists the day's connections, and the list row
 * counts them.
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

test('the day of a member who came back reads as one conversation, connection by connection', async ({
  agentPage,
  browser,
  organizationId,
  request,
}) => {
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  const stamp = Date.now().toString().slice(-6);
  const first = `Papara deposit missing — ${stamp}`;
  const second = `Me again about the deposit — ${stamp}`;

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

    // The widget swaps its composer for "chat ended"; the button only re-arms
    // it — the return reaches the server with the next message.
    await widgetFrame(visitor).getByRole('button', { name: 'Start a new chat' }).click();
    await visitorSends(visitor, second);

    // The same chat, now with two connections.
    const detail = await request.get(`${API_BASE}/chats/${chatId}`, { headers: auth });
    const day = (await detail.json()) as { connections: Array<{ id: string }> };
    expect(day.connections).toHaveLength(2);
    const [morning, afternoon] = day.connections.map((connection) => connection.id);

    await agentPage.goto(`/app/inbox?chat=${chatId}`);

    const list = agentPage.getByRole('region', { name: 'Conversations' });
    await expect(
      list.getByRole('button').filter({ hasText: second }).getByText('2 connections'),
    ).toBeVisible({ timeout: 20_000 });

    const transcript = agentPage.getByRole('log', { name: 'Conversation transcript' });
    await expect(transcript).toContainText(first, { timeout: 20_000 });
    await expect(transcript).toContainText(second);
    const separators = transcript.getByTestId('connection-separator');
    await expect(separators).toHaveCount(2);
    await expect(separators.nth(0)).toContainText(`Chat ID ${morning}`);
    await expect(separators.nth(1)).toContainText(`Chat ID ${afternoon}`);

    // Oldest first: the morning's words sit above the return.
    const text = (await transcript.textContent()) ?? '';
    expect(text.indexOf(first)).toBeLessThan(text.indexOf(afternoon!));
    expect(text.indexOf(afternoon!)).toBeLessThan(text.indexOf(second));

    const details = agentPage.getByRole('complementary', { name: 'Conversation details' });
    await expect(details.getByText("Today's connections")).toBeVisible();
    const connections = details.getByRole('list', { name: 'Chat ID' }).getByRole('listitem');
    await expect(connections).toHaveCount(2);
    await expect(connections.nth(0)).toContainText('First of the day');
    await expect(connections.nth(1)).toContainText('Came back');

    await agentPage.screenshot({ path: 'kanit/286.4-day-connections.png', fullPage: true });
  } finally {
    await visitorContext.close();
  }
});
