/**
 * The Archive screen (AR-01 · tm 335.2).
 *
 * The web unit suite pins the rows, the panes and the refusals against a stubbed
 * API, and the API suite pins the list against the real database. What only a
 * browser over both proves: a player who came back twice the same day is three
 * rows in the Archive's own screen — each opening its own words and nothing of
 * the others' — that the address alone reopens the same conversation after a
 * reload, and that the two ways back to work ("Open in Inbox", "Reopen") leave
 * the archive as it was and land on the right chat.
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

test('a player who came back twice is three rows, each opening its own conversation', async ({
  agentPage,
  browser,
  organizationId,
  request,
}) => {
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  const stamp = Date.now().toString().slice(-6);
  const words = [
    `Withdrawal pending since morning — ${stamp}`,
    `Bonus never arrived — ${stamp}`,
    `Closing my account — ${stamp}`,
  ];

  try {
    const auth = { Authorization: `Bearer ${await ownerAccessToken(request)}` };

    await openWidget(visitor, organizationId);
    await visitorSends(visitor, words[0]!);
    let chatId = '';
    await expect
      .poll(
        async () => {
          chatId =
            (await allChats(request, auth)).find((chat) => chat.last_event?.text === words[0])
              ?.id ?? '';
          return chatId;
        },
        { timeout: 20_000 },
      )
      .not.toBe('');

    const close = async (): Promise<void> => {
      const closed = await request.post(`${API_BASE}/chats/${chatId}/deactivate`, {
        headers: auth,
      });
      expect(closed.ok(), `deactivate failed: ${closed.status()}`).toBe(true);
    };
    await close();
    for (const text of words.slice(1)) {
      await widgetFrame(visitor).getByRole('button', { name: 'Start a new chat' }).click();
      await visitorSends(visitor, text);
      await close();
    }

    const detail = await request.get(`${API_BASE}/chats/${chatId}`, { headers: auth });
    const day = (await detail.json()) as { connections: Array<{ id: string }> };
    expect(day.connections).toHaveLength(3);
    const [, secondConnection] = day.connections.map((connection) => connection.id);

    // The module is on the rail, and opens on the list.
    await agentPage.goto('/app/inbox');
    await agentPage.getByRole('link', { name: 'Archive' }).click();
    await expect(agentPage).toHaveURL(/\/app\/archive$/);
    await expect(agentPage.getByRole('heading', { name: 'Archive', level: 1 })).toBeVisible();

    const list = agentPage.getByRole('list', { name: 'Conversations' });
    const rows = list.getByRole('listitem').filter({ hasText: stamp });
    await expect(rows).toHaveCount(3, { timeout: 20_000 });
    for (const text of words) await expect(rows.filter({ hasText: text })).toHaveCount(1);

    // Pick the middle one: its own words, none of the others', and only its number in the address.
    await rows.filter({ hasText: words[1]! }).getByRole('button').click();
    const transcript = agentPage.getByRole('log', { name: 'Conversation transcript' });
    await expect(transcript).toContainText(words[1]!, { timeout: 20_000 });
    await expect(transcript).not.toContainText(words[0]!);
    await expect(transcript).not.toContainText(words[2]!);
    await expect(agentPage).toHaveURL(new RegExp(`[?&]c=${secondConnection}(&|$)`));
    expect(agentPage.url()).not.toContain(stamp);

    const player = agentPage.getByRole('complementary', {
      name: 'Player and conversation details',
    });
    await expect(player.getByTestId('player-card')).toBeVisible();
    await expect(player.getByTestId('archive-facts')).toBeVisible();
    // Read-only: no composer, no edit.
    await expect(agentPage.getByRole('textbox', { name: /message/i })).toHaveCount(0);

    await agentPage.screenshot({ path: 'kanit/AR-01-archive.png', fullPage: true });

    // The pasted address opens the same conversation.
    await agentPage.reload();
    await expect(agentPage.getByRole('log', { name: 'Conversation transcript' })).toContainText(
      words[1]!,
      { timeout: 20_000 },
    );

    // "Open in Inbox" leaves the archive for the live console, at this conversation.
    // The console takes the one-shot parameters and clears them, and under load that
    // happens before a poll of the address can see them (tm 336.2: "Received
    // /app/inbox" 22 times) — so the navigation is recorded, not polled for.
    const visited: string[] = [];
    agentPage.on('framenavigated', (frame) => {
      if (frame === agentPage.mainFrame()) visited.push(frame.url());
    });
    await agentPage.getByRole('button', { name: 'Open in Inbox' }).click();
    await expect
      .poll(() =>
        visited.some((url) =>
          new RegExp(`/app/inbox\\?chat=${chatId}&thread=${secondConnection}`).test(url),
        ),
      )
      .toBe(true);

    // The console consumes the one-shot parameters (replacing the entry); only then is
    // "Back" the archive again.
    await expect(agentPage).toHaveURL(/\/app\/inbox$/);
    await agentPage.goBack();
    await expect(agentPage).toHaveURL(/\/app\/archive/);
    // The address changes the moment "Back" does; the screen follows when the
    // router renders it. Until then the Inbox is still on screen with its own
    // "Reopen conversation" — under load the click below landed there (tm 336.1:
    // the resume went through, the Inbox stayed, the address read the archive).
    await expect(agentPage.getByRole('heading', { name: 'Archive', level: 1 })).toBeVisible();

    // "Reopen" starts a new connection on it and follows the chat the server names.
    await agentPage.getByRole('button', { name: 'Reopen', exact: true }).click();
    // The console takes the one-shot `?chat=` and clears it, so the settled address is bare.
    await expect(agentPage).toHaveURL(/\/app\/inbox$/, { timeout: 20_000 });
    await expect(agentPage.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
    const reopened = await request.get(`${API_BASE}/chats/${chatId}`, { headers: auth });
    expect(((await reopened.json()) as { active: boolean }).active).toBe(true);
  } finally {
    await visitorContext.close();
  }
});

test('opens a conversation the caller cannot see as "not found", not as a blank page', async ({
  agentPage,
}) => {
  await agentPage.goto('/app/archive?c=NOSUCHCONN');
  await expect(agentPage.getByText('Conversation not found')).toBeVisible({ timeout: 20_000 });
  await expect(agentPage.getByRole('log', { name: 'Conversation transcript' })).toHaveCount(0);
});

test('a filtered address gives the same list after a reload and in another tab, and holds ids only (AR-02)', async ({
  agentPage,
  browser,
  organizationId,
  request,
}) => {
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  const stamp = Date.now().toString().slice(-6);
  const tagName = `e2etag${stamp}`;
  const words = [`Tagged question — ${stamp}`, `Untagged question — ${stamp}`];

  try {
    const auth = { Authorization: `Bearer ${await ownerAccessToken(request)}` };

    await openWidget(visitor, organizationId);
    await visitorSends(visitor, words[0]!);
    let chatId = '';
    await expect
      .poll(
        async () => {
          chatId =
            (await allChats(request, auth)).find((chat) => chat.last_event?.text === words[0])
              ?.id ?? '';
          return chatId;
        },
        { timeout: 20_000 },
      )
      .not.toBe('');
    const tagged = await request.post(`${API_BASE}/chats/${chatId}/tags`, {
      headers: auth,
      data: { tag: tagName },
    });
    expect(tagged.ok(), `tagging failed: ${tagged.status()}`).toBe(true);
    const close = async (): Promise<void> => {
      const closed = await request.post(`${API_BASE}/chats/${chatId}/deactivate`, {
        headers: auth,
      });
      expect(closed.ok(), `deactivate failed: ${closed.status()}`).toBe(true);
    };
    await close();
    await widgetFrame(visitor).getByRole('button', { name: 'Start a new chat' }).click();
    await visitorSends(visitor, words[1]!);
    await close();

    await agentPage.goto('/app/archive');
    const rows = agentPage
      .getByRole('list', { name: 'Conversations' })
      .getByRole('listitem')
      .filter({ hasText: stamp });
    await expect(rows).toHaveCount(2, { timeout: 20_000 });

    // Pick the tag: one row, and the address holds the tag's id — not its name, not the words.
    await agentPage.getByRole('button', { name: 'Tags', exact: true }).click();
    // `click`, not `check`: the address is the state, so the box settles a render later.
    await agentPage.getByLabel(tagName, { exact: true }).click();
    await expect(agentPage.getByLabel(tagName, { exact: true })).toBeChecked();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(words[0]!);
    await expect(agentPage).toHaveURL(/[?&]tag=[0-9a-f-]{36}(&|$)/);
    expect(agentPage.url()).not.toContain(tagName);
    expect(agentPage.url()).not.toContain(stamp);

    // The same address is the same list: after a reload, and in another tab.
    const filteredUrl = agentPage.url();
    await agentPage.reload();
    await expect(rows).toHaveCount(1, { timeout: 20_000 });
    await expect(rows.first()).toContainText(words[0]!);
    await expect(agentPage.getByRole('button', { name: `Tags: ${tagName}` })).toBeVisible();

    const other = await agentPage.context().newPage();
    try {
      await other.goto(filteredUrl);
      const otherRows = other
        .getByRole('list', { name: 'Conversations' })
        .getByRole('listitem')
        .filter({ hasText: stamp });
      await expect(otherRows).toHaveCount(1, { timeout: 20_000 });
      await expect(otherRows.first()).toContainText(words[0]!);
    } finally {
      await other.close();
    }

    // "Exclude" turns the same tag into "everything but".
    await agentPage.getByRole('button', { name: `Tags: ${tagName}` }).click();
    await agentPage.getByLabel('None of them (exclude)').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(words[1]!);
    await expect(agentPage).toHaveURL(/[?&]tag_mode=exclude(&|$)/);

    // The date is the workspace's own day: they started today, not yesterday.
    await agentPage.getByRole('button', { name: 'Clear Tags filter' }).click();
    await agentPage.getByRole('button', { name: 'Date', exact: true }).click();
    // (Other specs leave conversations from earlier days in the same workspace, so the
    // list is not necessarily empty: read the answer the server gave for that day.)
    const yesterday = agentPage.waitForResponse(
      (response) =>
        response.url().includes('/archive/conversations?') &&
        response.url().includes('date_from=') &&
        response.ok(),
    );
    await agentPage.getByRole('button', { name: 'Yesterday' }).click();
    const answer = (await (await yesterday).json()) as {
      items: Array<{ first_customer_message: string | null }>;
    };
    expect(answer.items.some((item) => item.first_customer_message?.includes(stamp))).toBe(false);
    await expect(agentPage.getByRole('button', { name: 'Date: Yesterday' })).toBeVisible();
    await expect(rows).toHaveCount(0);
    await agentPage.getByRole('button', { name: 'Today' }).click();
    await expect(rows).toHaveCount(2, { timeout: 20_000 });
    await expect(agentPage.getByRole('button', { name: 'Later' })).toBeDisabled();
  } finally {
    await visitorContext.close();
  }
});
