/**
 * The automatic "we received your request" reply (tm 359 · HD-04), in a real
 * browser against the real stack: an admin's rule names a ticket e-mail
 * template, a player's mail opens a ticket, the acknowledgement reaches the
 * player's mailbox carrying the ticket number, and the ticket's thread says it
 * was sent.
 *
 * The rule is scoped by a subject marker unique to the run and removed when the
 * test ends: the e2e workspace is shared, and a rule that acknowledged every
 * forwarded mail would answer the other suites' players.
 */
import type { APIRequestContext } from '@playwright/test';
import { API_BASE, expect, ownerAccessToken, test } from './fixtures.js';
import { mailbox, waitForMail } from './mailbox.js';

test.describe('an automatic acknowledgement on a new ticket (FR-MOD-13.6)', () => {
  test.use({ viewport: { width: 1680, height: 1050 } });

  test('mails the player a ticket-numbered acknowledgement and notes it on the ticket', async ({
    agentPage,
    organizationId,
    request,
  }) => {
    // Base 36: a 13-digit timestamp can pass the Luhn check and be masked as a card.
    const stamp = Date.now().toString(36);
    const marker = `ack-${stamp}`;
    const player = `deniz.${stamp}@oyuncu.example`;
    const token = await ownerAccessToken(request);
    const authorised = { headers: { authorization: `Bearer ${token}` } };
    const created: Array<{ path: string; id: string }> = [];

    const post = async (api: APIRequestContext, path: string, data: unknown) => {
      const response = await api.post(`${API_BASE}${path}`, { ...authorised, data });
      expect(response.ok(), `${path} failed: ${response.status()} ${await response.text()}`).toBe(
        true,
      );
      const body = (await response.json()) as { id: string };
      created.push({ path, id: body.id });
      return body.id;
    };

    try {
      const templateId = await post(request, '/settings/ticket-email-templates', {
        name: `E2E acknowledgement ${stamp}`,
        subject: `Talebinizi aldık ${marker}`,
        body: `Merhaba {{customer.name}}, "{{ticket.subject}}" talebiniz {{ticket.id}} numarasıyla kaydedildi.`,
      });
      await post(request, '/settings/ticket-rules', {
        name: `E2E ack ${stamp}`,
        conditions: { source: 'email', subject_contains: marker },
        actions: { send_template_id: templateId },
      });

      const response = await request.post(`${API_BASE}/channels/email/inbound`, {
        data: {
          to: `${organizationId}@inbound.siyahtus.localhost`,
          from: `Deniz Oyuncu <${player}>`,
          subject: `Çekim sorunu ${marker}`,
          text: `Çekimim bekliyor ${stamp}`,
          message_id: `<e2e.ack.${stamp}@mail.oyuncu.example>`,
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      const { ticket_id: ticketId } = (await response.json()) as { ticket_id: string };

      // What reached the player.
      const mail = await waitForMail(request, player, `[#${ticketId}]`);
      expect(mail.subject).toBe(`[#${ticketId}] Talebinizi aldık ${marker}`);
      expect(mail.body).toContain(`${ticketId} numarasıyla kaydedildi`);
      expect(mail.body).toContain('Deniz Oyuncu');
      expect(mail.replyTo).toMatch(new RegExp(`^${organizationId}\\+t-${ticketId.toLowerCase()}-`));
      // One acknowledgement, not one per delivery attempt.
      expect(
        (await mailbox(request, player)).filter((m) => m.subject.includes(marker)),
      ).toHaveLength(1);

      // What the team sees on the ticket.
      await agentPage.goto(`/app/inbox?ticket=${ticketId}`);
      const thread = agentPage.getByRole('region', { name: 'Conversation' });
      await expect(thread).toBeVisible();
      await expect(
        thread.locator('li[data-kind="system"]', {
          hasText: `Automatic acknowledgement sent: E2E acknowledgement ${stamp}`,
        }),
      ).toBeVisible();

      await agentPage.screenshot({ path: 'kanit/13.6-ticket-auto-ack.png', fullPage: true });
    } finally {
      for (const { path, id } of created.reverse()) {
        await request.delete(`${API_BASE}${path}/${id}`, authorised);
      }
    }
  });
});
