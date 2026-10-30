/**
 * The player's own transcript, asked for from the widget (WG-06 · tm 345, K26).
 *
 * The API suite pins the rules — the latest connection only, the player's
 * language, no internal note, the budgets, no closing mail to the player —
 * against the real database; the widget unit suite pins the dialog. What only
 * a browser over both proves: a player whose chat was closed by the team is
 * offered "E-mail me the transcript" on the "Chat ended" banner, the box holds
 * the address they gave in the pre-chat form, and what lands in that mailbox
 * is their copy, without the note — and it is the only mail they got.
 */
import {
  API_BASE,
  allChats,
  expect,
  introduceVisitor,
  openWidget,
  ownerAccessToken,
  test,
  widgetFrame,
} from './fixtures.js';
import { mailbox, waitForMail } from './mailbox.js';

test('a player asks for the transcript after the chat closed and gets their copy, no note', async ({
  browser,
  organizationId,
  request,
}) => {
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  const stamp = Date.now().toString().slice(-6);
  const words = `Param hesabıma geçmedi — ${stamp}`;
  const note = `KYC pending, do not promise a date — ${stamp}`;
  const email = `player-${stamp}@e2e-transcript.test`;
  const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };

  try {
    await openWidget(visitor, organizationId);
    const frame = widgetFrame(visitor);
    const recorded = visitor.waitForResponse(
      (response) =>
        response.url().includes('/customer/chat/events') &&
        response.request().method() === 'POST' &&
        response.ok(),
    );
    await introduceVisitor(frame, words, { email });
    await recorded;
    await expect(frame.getByRole('log', { name: 'Conversation' })).toContainText(words);

    let chatId = '';
    await expect
      .poll(
        async () => {
          chatId =
            (await allChats(request, auth)).find((chat) => chat.last_event?.text === words)?.id ??
            '';
          return chatId;
        },
        { timeout: 20_000 },
      )
      .not.toBe('');
    const noted = await request.post(`${API_BASE}/chats/${chatId}/events`, {
      headers: auth,
      data: { type: 'message', text: note, recipients: 'agents' },
    });
    expect(noted.ok(), `note failed: ${noted.status()} ${await noted.text()}`).toBe(true);
    const closed = await request.post(`${API_BASE}/chats/${chatId}/deactivate`, { headers: auth });
    expect(closed.ok(), `deactivate failed: ${closed.status()}`).toBe(true);

    // The team closed it; the banner offers the player their copy.
    await expect(frame.getByText('Chat ended.')).toBeVisible({ timeout: 20_000 });
    await frame.getByRole('button', { name: 'E-mail me the transcript' }).click();
    const dialog = frame.getByRole('dialog', { name: 'E-mail me the transcript' });
    await expect(dialog.getByRole('textbox', { name: 'Your e-mail address' })).toHaveValue(email);
    await dialog.getByRole('button', { name: 'Send' }).click();
    await expect(dialog.getByText('Sent')).toBeVisible();
    await visitor.screenshot({ path: 'kanit/WG-06-transcript-request.png' });

    const mail = await waitForMail(request, email, 'Your conversation with');
    expect(mail.body).toContain(words);
    expect(mail.body).not.toContain(note);
    expect(mail.html ?? '').not.toContain('KYC pending');
    // K26: the close mailed the player nothing; this copy is the one they asked for.
    expect(await mailbox(request, email)).toHaveLength(1);
  } finally {
    await visitorContext.close();
  }
});
