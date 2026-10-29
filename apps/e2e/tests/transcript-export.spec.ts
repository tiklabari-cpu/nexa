/**
 * A connection's transcript, taken out of the Archive (AR-04 · tm 338).
 *
 * The API suite pins who may, which copy, which recipient and the audit rows
 * against the real database; the web unit suite pins the dialogs. What only a
 * browser over both proves: the print view — the page a person saves as a PDF
 * — shows ğ, ş, ı and İ as they were typed, with the internal note marked in
 * the internal copy; and the mail the Archive sends to an allowed address
 * arrives as the player's copy, without the note.
 */
import {
  API_BASE,
  allChats,
  expect,
  openWidget,
  ownerAccessToken,
  test,
  visitorSends,
} from './fixtures.js';
import { waitForMail } from './mailbox.js';

test('prints a transcript with its Turkish letters and mails the player copy without the note', async ({
  agentPage,
  browser,
  organizationId,
  request,
}) => {
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  const stamp = Date.now().toString().slice(-6);
  const words = `Çekim talebim ğşıİ hâlâ beklemede — ${stamp}`;
  const note = `KYC pending, do not promise a date — ${stamp}`;
  const domain = `denetim-${stamp}.test`;
  const recipient = `compliance@${domain}`;
  const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };

  // The allowed domains ride on the inbox settings; whatever the test does,
  // the seeded workspace gets its list back.
  const settings = await request.get(`${API_BASE}/settings/chat-timeout`, { headers: auth });
  expect(settings.ok()).toBe(true);
  const before = (await settings.json()) as {
    chat_timeout_seconds: number | null;
    transcript_allowed_domains?: string[];
  };
  const allow = (domains: string[]) =>
    request.put(`${API_BASE}/settings/chat-timeout`, {
      headers: auth,
      data: {
        chat_timeout_seconds: before.chat_timeout_seconds,
        transcript_allowed_domains: domains,
      },
    });

  try {
    expect((await allow([...(before.transcript_allowed_domains ?? []), domain])).ok()).toBe(true);

    await openWidget(visitor, organizationId);
    await visitorSends(visitor, words);
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

    await agentPage.goto('/app/archive');
    const rows = agentPage
      .getByRole('list', { name: 'Conversations' })
      .getByRole('listitem')
      .filter({ hasText: stamp });
    await expect(rows).toHaveCount(1, { timeout: 20_000 });
    await rows.getByRole('button').click();
    await expect(agentPage.getByRole('log', { name: 'Conversation transcript' })).toContainText(
      words,
      { timeout: 20_000 },
    );

    // The print view: outside the shell, the internal copy, every letter as typed.
    await agentPage.getByRole('button', { name: 'Print / PDF' }).click();
    const printDialog = agentPage.getByRole('dialog', { name: 'Print the transcript' });
    await printDialog.getByRole('radio', { name: /Internal copy/ }).check();
    await printDialog.getByRole('button', { name: 'Open print view' }).click();
    await expect(agentPage).toHaveURL(new RegExp(`/app/archive/${chatId}/print\\?`));
    const page = agentPage.locator('main.transcript');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Chat transcript', {
      timeout: 20_000,
    });
    await expect(page).toContainText(words);
    await expect(page).toContainText('ğşıİ');
    await expect(page).toContainText(chatId);
    await expect(page.locator('li.note')).toContainText(note);
    // No shell around it: what prints is the transcript alone.
    await expect(agentPage.getByRole('navigation')).toHaveCount(0);
    await expect(agentPage.getByRole('button', { name: 'Print / Save as PDF' })).toBeEnabled();
    await agentPage.screenshot({ path: 'kanit/AR-04-transcript-print.png', fullPage: true });

    // Back to the archive; the player's copy to an allowed address.
    await agentPage.getByRole('button', { name: 'Back' }).click();
    await expect(agentPage.getByRole('log', { name: 'Conversation transcript' })).toContainText(
      words,
      { timeout: 20_000 },
    );
    await agentPage.getByRole('button', { name: 'Email transcript' }).click();
    const mailDialog = agentPage.getByRole('dialog', { name: "Email the player's copy" });
    await mailDialog.getByRole('radio', { name: 'Another address' }).check();
    await mailDialog.getByRole('textbox', { name: 'Email address' }).fill(recipient);
    await mailDialog.getByRole('button', { name: 'Send' }).click();
    await expect(mailDialog.getByText('The transcript is on its way.')).toBeVisible();

    const mail = await waitForMail(request, recipient, 'Your conversation with');
    expect(mail.body).toContain(words);
    expect(mail.body).not.toContain(note);
    expect(mail.html ?? '').not.toContain('KYC pending');
  } finally {
    await allow(before.transcript_allowed_domains ?? []);
    await visitorContext.close();
  }
});
