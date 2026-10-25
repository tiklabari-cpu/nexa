/**
 * A player answering a ticket by e-mail (tm 358 · HD-03), in a real browser
 * against the real stack: the agent's reply leaves with the ticket's signed
 * `Reply-To`, the player's "Reply" to it comes back onto the same ticket and
 * opens it again, and an answer from another address is kept with a warning.
 *
 * Both halves cross the real wire: the reply is read from the SMTP stand-in's
 * mailbox as a mail client would see it (`Reply-To`, `Message-ID`), and the
 * answer arrives the way a provider's adapter would deliver it — a POST to the
 * inbound webhook, which the e2e stack leaves unsigned and outside the pilot.
 * Each run uses its own subject, sender and Message-IDs, so the shared,
 * re-seeded workspace cannot decide the outcome.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { API_BASE, expect, test } from './fixtures.js';
import { waitForMail } from './mailbox.js';

interface Inbound {
  status: string;
  ticket_id: string;
  sender_mismatch?: boolean;
}

async function sendMail(
  request: APIRequestContext,
  mail: Record<string, unknown>,
): Promise<Inbound> {
  const response = await request.post(`${API_BASE}/channels/email/inbound`, { data: mail });
  expect(response.ok(), `inbound failed: ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as Inbound;
}

async function openTicket(page: Page, id: string): Promise<void> {
  await page.goto(`/app/inbox?ticket=${id}`);
  await expect(page.getByRole('region', { name: 'Conversation' })).toBeVisible();
}

test.describe('a player answers a ticket by e-mail (HD-03)', () => {
  test.use({ viewport: { width: 1680, height: 1050 } });

  test('"Reply" lands on the same ticket and opens it; another address is flagged', async ({
    agentPage,
    organizationId,
    request,
  }) => {
    // Base 36: a 13-digit timestamp can pass the Luhn check and be masked as a card.
    const stamp = Date.now().toString(36);
    const player = `ali.${stamp}@oyuncu.example`;
    const REPLY = `Çekiminizi kontrol ediyoruz ${stamp}`;
    const ANSWER = `Hâlâ hesabıma geçmedi ${stamp}`;
    const FORWARDED = `Ben onun kardeşiyim ${stamp}`;

    const opened = await sendMail(request, {
      to: `${organizationId}@inbound.siyahtus.localhost`,
      from: `Ali Veli <${player}>`,
      subject: `E2E threading ${stamp}`,
      text: `Çekimim bekliyor ${stamp}`,
      message_id: `<e2e.first.${stamp}@mail.oyuncu.example>`,
    });
    expect(opened.status).toBe('created');
    const ticketId = opened.ticket_id;

    // The agent answers from the console.
    await openTicket(agentPage, ticketId);
    await agentPage.getByRole('tab', { name: 'Reply' }).click();
    await agentPage.getByLabel('Reply to the player').fill(REPLY);
    await agentPage.getByRole('button', { name: 'Send reply', exact: true }).click();
    await expect(agentPage.getByLabel('Status')).toHaveValue('pending');

    // What reached the player: the ticket's own signed reply address.
    const mail = await waitForMail(request, player, `[#${ticketId}]`);
    expect(mail.body).toContain(REPLY);
    expect(mail.replyTo).toMatch(
      new RegExp(
        `^${organizationId}\\+t-${ticketId.toLowerCase()}-[0-9a-z]{8}@inbound\\.siyahtus\\.localhost$`,
      ),
    );
    expect(mail.messageId).toBeTruthy();

    // The player presses "Reply".
    const answered = await sendMail(request, {
      to: mail.replyTo,
      from: `Ali Veli <${player}>`,
      subject: `Re: ${mail.subject}`,
      text: `${ANSWER}\n\n> ${REPLY}`,
      message_id: `<e2e.answer.${stamp}@mail.oyuncu.example>`,
      in_reply_to: `<${mail.messageId}>`,
    });
    expect(answered).toEqual({ status: 'threaded', ticket_id: ticketId });

    // Someone else answers from the forwarded mail.
    const forwarded = await sendMail(request, {
      to: mail.replyTo,
      from: `Kardeşi <kardes.${stamp}@oyuncu.example>`,
      subject: `Re: ${mail.subject}`,
      text: FORWARDED,
      message_id: `<e2e.other.${stamp}@mail.oyuncu.example>`,
    });
    expect(forwarded).toEqual({ status: 'threaded', ticket_id: ticketId, sender_mismatch: true });

    // Nobody holds the ticket, so no push reaches this page: read it again.
    await openTicket(agentPage, ticketId);
    const thread = agentPage.getByRole('region', { name: 'Conversation' });
    const answer = thread.locator('li[data-kind="customer_message"]', { hasText: ANSWER });
    await expect(answer).toBeVisible();
    await expect(answer).not.toContainText('Sent from another address');
    const other = thread.locator('li[data-kind="customer_message"]', { hasText: FORWARDED });
    await expect(
      other.getByText(
        "Sent from another address than this ticket's player — check who is writing before you act on it.",
      ),
    ).toBeVisible();
    // The answer moved the ticket from "waiting on the player" back to open.
    await expect(agentPage.getByLabel('Status')).toHaveValue('open');

    await agentPage.screenshot({ path: 'kanit/13.6-ticket-email-threading.png', fullPage: true });
  });
});
