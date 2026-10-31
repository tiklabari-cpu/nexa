/**
 * The automatic "we received your request" reply (tm 359 · SiyahTuş analysis
 * FR-MOD-13.6), against the real routes, Postgres and Redis.
 *
 * A ticket rule names an e-mail template (`send_template_id`); the mail goes
 * out after the ticket's transaction commits, as the spool shows, and the ticket
 * says so in a system line. What is pinned here is when it does *not* go: a
 * ticket from a chat or by hand, an automatic reply or a sender whose checks
 * failed (backscatter and loops), a template turned off, a second matching rule.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FileMailer } from '../../src/services/mail/mailer.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const DOMAIN = 'inbound.siyahtus.localhost';
const PLAYER = 'ayse.oyuncu@example.test';
const SCOPES = ['tickets--all:rw', 'tickets--all:ro'];

interface InboundAnswer {
  status: string;
  ticket_id?: string;
}

interface ThreadMessage {
  kind: string;
  body_text: string;
}

describe('an automatic acknowledgement on a new ticket (FR-MOD-13.6)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let mailDir: string;
  let spool: FileMailer;
  let fx: Fixtures;
  let token: string;
  let seq = 0;

  const auth = () => ({ authorization: `Bearer ${token}` });
  const stamp = () => `${Date.now().toString(36)}${(++seq).toString(36)}`;

  const inbound = async (mail: Record<string, unknown> = {}): Promise<InboundAnswer> => {
    const response = await server.post('/channels/email/inbound', {
      to: `${fx.a.organizationId}@${DOMAIN}`,
      from: `Ayşe Oyuncu <${PLAYER}>`,
      subject: `Çekim talebim ${stamp()}`,
      text: 'Çekimim üç gündür bekliyor.',
      message_id: `<in.${stamp()}@mail.example.test>`,
      ...mail,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as InboundAnswer;
  };

  async function template(
    body: Partial<{ name: string; subject: string; body: string; enabled: boolean }> = {},
  ): Promise<string> {
    const response = await server.post(
      '/settings/ticket-email-templates',
      {
        name: 'Talebiniz alındı',
        subject: 'Talebinizi aldık',
        body: 'Merhaba {{customer.name}}, {{ticket.id}} numaralı talebinizi aldık. {{ticket.subject}} {{ticket.expected_response}}Kısa sürede dönüş yapılacaktır.',
        ...body,
      },
      auth(),
    );
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { id: string }).id;
  }

  async function rule(
    conditions: Record<string, unknown>,
    actions: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) {
    return server.post(
      '/settings/ticket-rules',
      { name: `Kural ${stamp()}`, conditions, actions, ...extra },
      auth(),
    );
  }

  /** An acknowledgement rule for forwarded mail. */
  async function ackRule(templateId: string, conditions: Record<string, unknown> = {}) {
    const response = await rule(
      { source: 'email', ...conditions },
      { send_template_id: templateId },
    );
    expect(response.statusCode, response.body).toBe(201);
  }

  const mails = async () => {
    await server.app.backgroundMail.settled();
    return (await spool.outbox()).filter((m) => m.kind === 'ticket_notice');
  };

  async function thread(ticketId: string): Promise<ThreadMessage[]> {
    const response = await server.get(`/tickets/${ticketId}/messages`, auth());
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { items: ThreadMessage[] }).items;
  }

  /**
   * Give the workspace a saved plan that holds now (`open`) or cannot: every
   * day 00:00–23:59, or only tomorrow. Independent of the hour the suite runs at.
   */
  async function setHours(open: boolean) {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const tomorrow = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' })
      .format(new Date(Date.now() + 86_400_000))
      .toLowerCase();
    await owner.workSchedule.create({
      data: {
        licenseId: fx.a.licenseId,
        agentId: fx.a.agentAccountId,
        timezone: 'UTC',
        schedule: days.map((day) => ({
          day,
          start: '00:00',
          end: '23:59',
          enabled: open || day === tomorrow,
        })),
      },
    });
  }

  beforeAll(async () => {
    owner = ownerClient();
    mailDir = await mkdtemp(join(tmpdir(), 'siyahtus-auto-ack-'));
    spool = new FileMailer(mailDir);
    server = await startTestServer({ TICKET_MAIL_OUTBOUND: 'true' }, { mailer: spool });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
    await rm(mailDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    await rm(mailDir, { recursive: true, force: true });
    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: SCOPES,
    });
  });

  it('mails the player a ticket-numbered acknowledgement and says so on the ticket (FR-MOD-13.6)', async () => {
    const templateId = await template();
    await ackRule(templateId);

    const answer = await inbound({ subject: 'Çekim sorunu' });
    expect(answer.status).toBe('created');

    const [mail, ...rest] = await mails();
    expect(rest).toEqual([]);
    expect(mail!.to).toBe(PLAYER);
    expect(mail!.subject).toBe(`[#${answer.ticket_id}] Talebinizi aldık`);
    expect(mail!.body).toContain(`${answer.ticket_id} numaralı talebinizi aldık`);
    expect(mail!.body).toContain('Ayşe Oyuncu');
    // The variable is catalogued and renders empty until a first-response target exists.
    expect(mail!.body).toContain('Çekim sorunu Kısa sürede dönüş yapılacaktır.');
    // A machine's answer, and the player's answer to it comes back to the ticket.
    expect(mail!.autoSubmitted).toBe('auto-replied');
    expect(mail!.replyTo).toMatch(new RegExp(`^${fx.a.organizationId}\\+t-`));
    expect(mail!.inReplyTo).toMatch(/^in\./);

    const messages = await thread(answer.ticket_id!);
    expect(messages.map((m) => m.kind)).toEqual(['customer_message', 'system']);
    expect(messages[1]!.body_text).toBe('Automatic acknowledgement sent: Talebiniz alındı');
  });

  it('threads the player’s answer to the acknowledgement onto the same ticket (FR-MOD-13.6)', async () => {
    await ackRule(await template());
    const answer = await inbound();
    const [mail] = await mails();

    const again = await inbound({
      to: mail!.replyTo,
      subject: `Re: ${mail!.subject}`,
      text: 'Teşekkürler, bekliyorum.',
      in_reply_to: `<${mail!.messageId}>`,
    });

    expect(again).toMatchObject({ status: 'threaded', ticket_id: answer.ticket_id });
    // And that answer is not acknowledged again: one per ticket.
    expect(await mails()).toHaveLength(1);
  });

  it('sends the out-of-hours template out of hours and the in-hours one in hours (FR-MOD-13.6)', async () => {
    const outside = await template({ name: 'Mesai dışı', subject: 'Mesai dışındayız' });
    const inside = await template({ name: 'Mesai içi', subject: 'Mesai içindeyiz' });
    await ackRule(outside, { outside_business_hours: true });
    await ackRule(inside, { outside_business_hours: false });

    await setHours(false);
    await inbound();
    expect((await mails()).map((m) => m.subject.replace(/^\[#\w+\] /, ''))).toEqual([
      'Mesai dışındayız',
    ]);

    await owner.workSchedule.deleteMany({ where: { licenseId: fx.a.licenseId } });
    await rm(mailDir, { recursive: true, force: true });
    await setHours(true);
    await inbound();
    expect((await mails()).map((m) => m.subject.replace(/^\[#\w+\] /, ''))).toEqual([
      'Mesai içindeyiz',
    ]);
  });

  it('counts a workspace with no saved hours as in hours (FR-MOD-13.6)', async () => {
    await ackRule(await template({ subject: 'Dışarıdayız' }), { outside_business_hours: true });
    await ackRule(await template({ subject: 'İçerideyiz' }), { outside_business_hours: false });
    await inbound();
    expect((await mails()).map((m) => m.subject.replace(/^\[#\w+\] /, ''))).toEqual(['İçerideyiz']);
  });

  it('sends at most one acknowledgement: the first matching rule’s (FR-MOD-13.6)', async () => {
    await ackRule(await template({ subject: 'Birinci' }));
    await ackRule(await template({ subject: 'İkinci' }));
    await inbound();
    expect((await mails()).map((m) => m.subject.replace(/^\[#\w+\] /, ''))).toEqual(['Birinci']);
  });

  it('sends nothing for a template that is switched off, and nothing is noted (FR-MOD-13.6)', async () => {
    await ackRule(await template({ enabled: false }));
    const answer = await inbound();
    expect(await mails()).toEqual([]);
    expect((await thread(answer.ticket_id!)).map((m) => m.kind)).toEqual(['customer_message']);
  });

  it('does not acknowledge an automatic reply that opens a ticket (loop guard, FR-MOD-13.6)', async () => {
    await ackRule(await template());
    const answer = await inbound({ headers: { auto_submitted: 'auto-replied' } });
    expect(answer.status).toBe('created');
    expect(await mails()).toEqual([]);
    await inbound({ headers: { precedence: 'bulk' } });
    await inbound({ headers: { x_autoreply: 'yes' } });
    expect(await mails()).toEqual([]);
  });

  it('opens the ticket but writes back to no sender whose SPF or DMARC failed (backscatter, FR-MOD-13.6)', async () => {
    await ackRule(await template());
    const spf = await inbound({ authentication: { spf: 'fail' } });
    const dmarc = await inbound({ authentication: { dmarc: 'fail' } });
    expect(spf.status).toBe('created');
    expect(dmarc.status).toBe('created');
    expect(await mails()).toEqual([]);

    // Passing — or not reporting at all — is answered.
    await inbound({ authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' } });
    await inbound();
    expect(await mails()).toHaveLength(2);
  });

  it('does not acknowledge spam, which opens no ticket (FR-MOD-13.6)', async () => {
    await ackRule(await template());
    const answer = await inbound({ spam: true });
    expect(answer).toMatchObject({ status: 'ignored' });
    expect(await mails()).toEqual([]);
  });

  it('does not acknowledge a ticket opened by hand, or from a chat (FR-MOD-13.6)', async () => {
    const templateId = await template();
    // No `source` condition: the rule would fit any ticket.
    const response = await rule({ subject_contains: 'Sorun' }, { send_template_id: templateId });
    expect(response.statusCode, response.body).toBe(201);

    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'Ayşe', email: PLAYER },
      select: { id: true },
    });
    const manual = await server.post(
      '/tickets',
      { subject: 'Sorun var', customer_id: customer.id },
      auth(),
    );
    expect(manual.statusCode, manual.body).toBe(201);
    expect(await mails()).toEqual([]);

    // The same rule does fire for forwarded mail.
    await inbound({ subject: 'Sorun var' });
    expect(await mails()).toHaveLength(1);
  });

  it('is off when ticket e-mail is switched off, and the ticket says so (K23, FR-MOD-13.6)', async () => {
    const off = await startTestServer({ TICKET_MAIL_OUTBOUND: 'false' }, { mailer: spool });
    try {
      const templateId = await template();
      await ackRule(templateId);
      const response = await off.post('/channels/email/inbound', {
        to: `${fx.a.organizationId}@${DOMAIN}`,
        from: PLAYER,
        subject: 'Merhaba',
        text: 'Selam',
        message_id: `<off.${stamp()}@mail.example.test>`,
      });
      expect(response.statusCode, response.body).toBe(200);
      const ticketId = (response.json() as InboundAnswer).ticket_id!;
      await off.app.backgroundMail.settled();
      expect((await spool.outbox()).filter((m) => m.kind === 'ticket_notice')).toEqual([]);
      const messages = await off.get(`/tickets/${ticketId}/messages`, auth());
      expect((messages.json() as { items: ThreadMessage[] }).items.at(-1)!.body_text).toBe(
        'Automatic acknowledgement not sent: ticket e-mail is switched off.',
      );
    } finally {
      await off.close();
    }
  });

  describe('the rule that asks for it', () => {
    it('refuses a template that is not this workspace’s (FR-MOD-13.6)', async () => {
      const response = await rule(
        { source: 'email' },
        { send_template_id: '5f1c7c0e-8f3e-4b8e-9d57-0a8b7f0c4d11' },
      );
      expect(response.statusCode).toBe(400);
    });

    it('takes an out-of-hours condition alone as a condition, and a template alone as an action (FR-MOD-13.6)', async () => {
      const templateId = await template();
      const response = await rule(
        { outside_business_hours: false },
        { send_template_id: templateId },
      );
      expect(response.statusCode, response.body).toBe(201);
      const stored = response.json() as {
        conditions: { outside_business_hours: boolean };
        actions: { send_template_id: string };
      };
      expect(stored.conditions.outside_business_hours).toBe(false);
      expect(stored.actions.send_template_id).toBe(templateId);
    });

    it('lets a template be named while it is still switched off (FR-MOD-13.6)', async () => {
      const templateId = await template({ enabled: false });
      const response = await rule({ source: 'email' }, { send_template_id: templateId });
      expect(response.statusCode, response.body).toBe(201);
    });
  });

  it('keeps the Message-ID unique per workspace across acknowledgements (FR-MOD-13.6)', async () => {
    await ackRule(await template());
    await inbound();
    await inbound();
    const ids = (await mails()).map((m) => m.messageId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('acknowledges a message left in the widget’s offline form, by its address (FR-MOD-13.6)', async () => {
    await owner.customFieldDefinition.create({
      data: {
        licenseId: fx.a.licenseId,
        entity: 'ticket',
        label: 'Affected order',
        type: 'text',
        formPlacement: 'ticket',
      },
    });
    // No `source` condition names the widget, so the rule is scoped by subject.
    const templateId = await template({ subject: 'Mesajınızı aldık' });
    const created = await rule({ subject_contains: 'siparişim' }, { send_template_id: templateId });
    expect(created.statusCode, created.body).toBe(201);

    const minted = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(minted.statusCode).toBe(200);
    const visitor = { authorization: `Bearer ${(minted.json() as { token: string }).token}` };

    const left = await server.post(
      '/customer/ticket',
      { subject: 'Siparişim gelmedi', email: 'ziyaretci@example.test', name: 'Ziyaretçi' },
      visitor,
    );
    expect(left.statusCode, left.body).toBe(201);
    const { ticket_id } = left.json() as { ticket_id: string };

    const [mail, ...rest] = await mails();
    expect(rest).toEqual([]);
    expect(mail!.to).toBe('ziyaretci@example.test');
    expect(mail!.subject).toBe(`[#${ticket_id}] Mesajınızı aldık`);
    expect(mail!.inReplyTo).toBeUndefined();
    expect((await thread(ticket_id)).map((m) => m.body_text)).toEqual([
      'Automatic acknowledgement sent: Talebiniz alındı',
    ]);
  });
});
