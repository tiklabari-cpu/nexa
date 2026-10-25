/**
 * A player's answer by e-mail joins its ticket (tm 358 · SiyahTuş analysis
 * HD-03), against the real route, Postgres and Redis.
 *
 * Every test starts the way a real conversation does: the player writes in,
 * an agent answers, and the answer that leaves — read back from the spool —
 * is what the player's mail client answers. What is pinned here is what comes
 * back:
 *
 *   - "Reply" lands on the same ticket and opens it; so does an answer whose
 *     `Reply-To` was lost, by its `In-Reply-To` or `References`; and the
 *     subject's `[#id]`, but only from the ticket's own player;
 *   - a reply address with a damaged, foreign or forged signature matches
 *     nothing — a new ticket, the old one untouched;
 *   - a solved ticket reopens and says so; a closed one, or one quiet past the
 *     workspace's window, stays put and a related ticket opens;
 *   - an answer on a merged ticket lands on its primary;
 *   - another address answering is kept, flagged `sender_mismatch`;
 *   - an automatic reply moves nothing, and one sender cannot open or reopen
 *     tickets without end.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FileMailer } from '../../src/services/mail/mailer.js';
import { TicketReplyAddresses } from '../../src/services/tickets/ticket-reply-address.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const DOMAIN = 'inbound.siyahtus.localhost';
const PLAYER = 'ayse.oyuncu@example.test';
const SCOPES = ['tickets--all:rw', 'tickets--all:ro', 'access_rules:rw', 'access_rules:ro'];

interface InboundAnswer {
  status: 'created' | 'threaded' | 'ignored';
  ticket_id?: string;
  related_ticket_id?: string;
  reopened?: boolean;
  sender_mismatch?: boolean;
  automated?: boolean;
  duplicate?: boolean;
  reason?: string;
}

interface ThreadMessage {
  id: string;
  ticket_id: string;
  kind: string;
  author_id: string | null;
  body_text: string;
  sender_mismatch?: boolean;
}

/** The mail an agent's answer left as — what the player's client answers. */
interface SentReply {
  replyTo: string;
  messageId: string;
  subject: string;
}

describe('a player answers a ticket by e-mail (HD-03)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let mailDir: string;
  let spool: FileMailer;
  let fx: Fixtures;
  let token: string;
  let seq = 0;

  const auth = () => ({ authorization: `Bearer ${token}` });
  const stamp = () => `${Date.now().toString(36)}${(++seq).toString(36)}`;
  const inbound = async (mail: Record<string, unknown>): Promise<InboundAnswer> => {
    const response = await server.post('/channels/email/inbound', {
      subject: '',
      text: 'Merhaba',
      ...mail,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as InboundAnswer;
  };
  const defaultAddress = (organizationId = fx.a.organizationId) => `${organizationId}@${DOMAIN}`;

  beforeAll(async () => {
    owner = ownerClient();
    mailDir = await mkdtemp(join(tmpdir(), 'siyahtus-email-threading-'));
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

  /** The player writes in: a new ticket, and its id. */
  async function playerWritesIn(subject = `Çekim talebim ${stamp()}`): Promise<string> {
    const answer = await inbound({
      to: defaultAddress(),
      from: `Ayşe Oyuncu <${PLAYER}>`,
      subject,
      text: 'Çekimim üç gündür bekliyor.',
      message_id: `<first.${stamp()}@mail.example.test>`,
    });
    expect(answer.status).toBe('created');
    return answer.ticket_id!;
  }

  /** An agent answers; the mail that left, from the spool. */
  async function agentAnswers(ticketId: string, text = 'Kontrol ediyoruz.'): Promise<SentReply> {
    const response = await server.post(
      `/tickets/${ticketId}/messages`,
      { kind: 'reply', text, idempotency_key: `k-${stamp()}` },
      auth(),
    );
    expect(response.statusCode, response.body).toBe(201);
    await server.app.backgroundMail.settled();
    const mail = (await spool.outbox()).find(
      (m) => m.kind === 'ticket_reply' && m.body === text && m.subject.includes(`[#${ticketId}]`),
    );
    expect(mail?.replyTo, 'the reply left without a Reply-To').toBeTruthy();
    return { replyTo: mail!.replyTo!, messageId: mail!.messageId!, subject: mail!.subject };
  }

  async function ticket(id: string) {
    return owner.ticket.findUniqueOrThrow({ where: { id } });
  }

  async function thread(ticketId: string): Promise<ThreadMessage[]> {
    const response = await server.get(`/tickets/${ticketId}/messages`, auth());
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { items: ThreadMessage[] }).items;
  }

  const ticketCount = () => owner.ticket.count({ where: { licenseId: fx.a.licenseId } });

  // --- Matching ---------------------------------------------------------------

  it('"Reply" lands on the same ticket and opens it again (FR-MOD-13.6)', async () => {
    const ticketId = await playerWritesIn();
    const sent = await agentAnswers(ticketId);
    // The answer left with the ticket's own signed address.
    expect(sent.replyTo).toBe(
      new TicketReplyAddresses(testEnv().CUSTOMER_TOKEN_SECRET, DOMAIN).addressFor(
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        ticketId,
      ),
    );
    expect((await ticket(ticketId)).status).toBe('pending');

    const answer = await inbound({
      to: sent.replyTo,
      from: PLAYER,
      subject: `Re: ${sent.subject}`,
      text: 'Hâlâ gelmedi.',
      message_id: `<answer.${stamp()}@mail.example.test>`,
      in_reply_to: `<${sent.messageId}>`,
    });

    expect(answer).toEqual({ status: 'threaded', ticket_id: ticketId });
    expect(await ticketCount()).toBe(1);
    expect((await ticket(ticketId)).status).toBe('open');
    const messages = await thread(ticketId);
    expect(messages.map((m) => m.kind)).toEqual([
      'customer_message',
      'agent_reply',
      'customer_message',
    ]);
    expect(messages[2]!.body_text).toBe('Hâlâ gelmedi.');
    expect(messages[2]!.sender_mismatch).toBeUndefined();
    // The same person wrote both: one customer, not a second record.
    expect(messages[2]!.author_id).toBe(messages[0]!.author_id);
  });

  it('finds the ticket by In-Reply-To with the reply address gone, then by References (FR-MOD-13.6)', async () => {
    const ticketId = await playerWritesIn();
    const sent = await agentAnswers(ticketId);

    // Typed in by hand to the workspace address; no `[#id]` either.
    const byInReplyTo = await inbound({
      to: defaultAddress(),
      from: PLAYER,
      subject: 'Bir şey daha',
      message_id: `<a.${stamp()}@mail.example.test>`,
      in_reply_to: sent.messageId,
    });
    expect(byInReplyTo).toEqual({ status: 'threaded', ticket_id: ticketId });

    const byReferences = await inbound({
      to: defaultAddress(),
      from: PLAYER,
      subject: 'Ve bir şey daha',
      message_id: `<b.${stamp()}@mail.example.test>`,
      references: ['<unrelated@elsewhere.example>', `<${sent.messageId}>`],
    });
    expect(byReferences).toEqual({ status: 'threaded', ticket_id: ticketId });
    expect(await ticketCount()).toBe(1);
  });

  it('opens a new ticket for a reply address whose signature does not verify (FR-MOD-13.6)', async () => {
    const ticketId = await playerWritesIn();
    const sent = await agentAnswers(ticketId);
    const [local, domain] = sent.replyTo.split('@') as [string, string];
    const last = local.at(-1) === '0' ? '1' : '0';
    const forged = `${local.slice(0, -1)}${last}@${domain}`;
    const before = (await thread(ticketId)).length;

    const answer = await inbound({
      to: forged,
      from: PLAYER,
      subject: 'Merhaba',
      message_id: `<forged.${stamp()}@mail.example.test>`,
    });

    expect(answer.status).toBe('created');
    expect(answer.ticket_id).not.toBe(ticketId);
    expect((await thread(ticketId)).length).toBe(before);
    // Not a stranger to the workspace: the reply path is the default address's.
    const created = await ticket(answer.ticket_id!);
    expect(created.licenseId).toBe(fx.a.licenseId);
    expect(created.relatedTicketId).toBeNull();
  });

  it("does not take another workspace's reply address for one of its own (FR-MOD-13.6)", async () => {
    const ticketId = await playerWritesIn();
    const sent = await agentAnswers(ticketId);
    // The same label under workspace B: signed for A's licence, so B's key
    // refuses it — and B could not hold A's ticket anyway.
    const label = sent.replyTo.split('@')[0]!.split('+')[1]!;

    const answer = await inbound({
      to: `${fx.b.organizationId}+${label}@${DOMAIN}`,
      from: PLAYER,
      subject: `Re: ${sent.subject}`,
      message_id: `<cross.${stamp()}@mail.example.test>`,
    });

    expect(answer.status).toBe('created');
    expect((await ticket(answer.ticket_id!)).licenseId).toBe(fx.b.licenseId);
    expect((await thread(ticketId)).map((m) => m.kind)).toEqual([
      'customer_message',
      'agent_reply',
    ]);
  });

  it('threads on the reply address in Cc, a "reply all" (FR-MOD-08.5.3)', async () => {
    const ticketId = await playerWritesIn();
    const sent = await agentAnswers(ticketId);

    const answer = await inbound({
      to: 'Arkadaşım <friend@mail.example.test>',
      cc: [sent.replyTo],
      from: PLAYER,
      subject: `Re: ${sent.subject}`,
      message_id: `<cc.${stamp()}@mail.example.test>`,
    });

    expect(answer).toEqual({ status: 'threaded', ticket_id: ticketId });
  });

  it("threads on the subject's [#id] only from the ticket's own player (FR-MOD-13.6)", async () => {
    const ticketId = await playerWritesIn();

    const fromPlayer = await inbound({
      to: defaultAddress(),
      from: PLAYER,
      subject: `Re: [#${ticketId}] Çekim`,
      message_id: `<tag.${stamp()}@mail.example.test>`,
    });
    expect(fromPlayer).toEqual({ status: 'threaded', ticket_id: ticketId });

    // Anybody can type the tag: from someone else it is a new ticket.
    const fromStranger = await inbound({
      to: defaultAddress(),
      from: 'someone.else@example.test',
      subject: `Re: [#${ticketId}] Çekim`,
      message_id: `<tag2.${stamp()}@mail.example.test>`,
    });
    expect(fromStranger.status).toBe('created');
    expect(fromStranger.ticket_id).not.toBe(ticketId);
  });

  // --- What a match does to the ticket ---------------------------------------

  it('reopens a solved ticket and says so in the thread (FR-MOD-13.6)', async () => {
    const ticketId = await playerWritesIn();
    const sent = await agentAnswers(ticketId);
    const solved = await server.patch(`/tickets/${ticketId}`, { status: 'solved' }, auth());
    expect(solved.statusCode, solved.body).toBe(200);

    const answer = await inbound({
      to: sent.replyTo,
      from: PLAYER,
      subject: `Re: ${sent.subject}`,
      message_id: `<reopen.${stamp()}@mail.example.test>`,
      in_reply_to: sent.messageId,
    });

    expect(answer).toEqual({ status: 'threaded', ticket_id: ticketId, reopened: true });
    expect((await ticket(ticketId)).status).toBe('open');
    const last = (await thread(ticketId)).at(-1)!;
    expect(last.kind).toBe('system');
    expect(last.body_text).toBe('Reopened — the player answered by e-mail.');
  });

  it('opens a related ticket for an answer to a closed one, which stays closed (FR-MOD-13.6)', async () => {
    const ticketId = await playerWritesIn();
    const sent = await agentAnswers(ticketId);
    await server.patch(`/tickets/${ticketId}`, { status: 'closed' }, auth());

    const answer = await inbound({
      to: sent.replyTo,
      from: PLAYER,
      subject: `Re: ${sent.subject}`,
      text: 'Yeni bir sorum var.',
      message_id: `<closed.${stamp()}@mail.example.test>`,
      in_reply_to: sent.messageId,
    });

    expect(answer.status).toBe('created');
    const newId = answer.ticket_id!;
    expect(answer.related_ticket_id).toBe(ticketId);
    expect(newId).not.toBe(ticketId);
    expect((await ticket(ticketId)).status).toBe('closed');

    const detail = await server.get(`/tickets/${newId}`, auth());
    expect((detail.json() as { related_ticket_id: string | null }).related_ticket_id).toBe(
      ticketId,
    );
    const fresh = await thread(newId);
    expect(fresh.map((m) => [m.kind, m.body_text])).toEqual([
      ['customer_message', 'Yeni bir sorum var.'],
      ['system', `Follows on from ticket #${ticketId} (closed).`],
    ]);
    expect((await thread(ticketId)).at(-1)!.body_text).toBe(
      `The player wrote again; ticket #${newId} was opened for it.`,
    );
  });

  it("opens a related ticket for a solved one quiet past the workspace's window, and reopens it within (FR-MOD-13.6)", async () => {
    await seedDefaultBrand(owner, fx.a.licenseId);
    const ticketId = await playerWritesIn();
    const sent = await agentAnswers(ticketId);
    await server.patch(`/tickets/${ticketId}`, { status: 'solved' }, auth());
    // 31 days quiet: past the shipped 30.
    await owner.ticket.update({
      where: { id: ticketId },
      data: { lastMessageAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });
    const answerOnce = () =>
      inbound({
        to: sent.replyTo,
        from: PLAYER,
        subject: `Re: ${sent.subject}`,
        message_id: `<late.${stamp()}@mail.example.test>`,
      });

    const late = await answerOnce();
    expect(late.status).toBe('created');
    expect(late.related_ticket_id).toBe(ticketId);
    expect((await ticket(ticketId)).status).toBe('solved');

    // The workspace waits sixty days: the same answer now reopens it.
    const saved = await server.put(
      '/settings/chat-timeout',
      { chat_timeout_seconds: null, ticket_reopen_window_days: 60 },
      auth(),
    );
    expect(saved.statusCode, saved.body).toBe(200);
    expect((saved.json() as { ticket_reopen_window_days: number }).ticket_reopen_window_days).toBe(
      60,
    );
    await owner.ticket.update({
      where: { id: ticketId },
      data: { lastMessageAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });
    expect(await answerOnce()).toEqual({ status: 'threaded', ticket_id: ticketId, reopened: true });
  });

  it('lands an answer on a merged ticket on its primary (FR-MOD-13.6)', async () => {
    const primaryId = await playerWritesIn();
    const mergedId = await playerWritesIn();
    const sent = await agentAnswers(mergedId);
    const merged = await server.post(`/tickets/${mergedId}/merge`, { into: primaryId }, auth());
    expect(merged.statusCode, merged.body).toBe(200);

    const answer = await inbound({
      to: sent.replyTo,
      from: PLAYER,
      subject: `Re: ${sent.subject}`,
      text: 'Birleşen ticket’a cevap.',
      message_id: `<merged.${stamp()}@mail.example.test>`,
    });

    expect(answer).toEqual({ status: 'threaded', ticket_id: primaryId });
    const written = await owner.ticketMessage.findFirstOrThrow({
      where: { bodyText: 'Birleşen ticket’a cevap.' },
    });
    expect(written.ticketId).toBe(primaryId);
  });

  it('keeps an answer from another address, flagged sender_mismatch (FR-MOD-13.6)', async () => {
    const ticketId = await playerWritesIn();
    const sent = await agentAnswers(ticketId);

    const answer = await inbound({
      to: sent.replyTo,
      from: 'Kardeşi <kardes@example.test>',
      subject: `Re: ${sent.subject}`,
      text: 'Ben onun kardeşiyim.',
      message_id: `<other.${stamp()}@mail.example.test>`,
    });

    expect(answer).toEqual({ status: 'threaded', ticket_id: ticketId, sender_mismatch: true });
    const last = (await thread(ticketId)).at(-1)!;
    expect(last.body_text).toBe('Ben onun kardeşiyim.');
    expect(last.sender_mismatch).toBe(true);
    // Written as who sent it, not as the ticket's player.
    const author = await owner.customer.findUniqueOrThrow({ where: { id: last.author_id! } });
    expect(author.email).toBe('kardes@example.test');
    const row = await owner.ticketMessage.findUniqueOrThrow({ where: { id: last.id } });
    expect(row.senderMismatch).toBe(true);
  });

  // --- The loop guard -----------------------------------------------------------

  it('keeps an automatic reply as a line only: no reopening, and a redelivery is the same mail (FR-MOD-13.6)', async () => {
    const ticketId = await playerWritesIn();
    const sent = await agentAnswers(ticketId);
    await server.patch(`/tickets/${ticketId}`, { status: 'solved' }, auth());
    const autoReply = {
      to: sent.replyTo,
      from: PLAYER,
      subject: `Otomatik yanıt: ${sent.subject}`,
      text: 'Pazartesiye kadar izindeyim.',
      message_id: `<ooo.${stamp()}@mail.example.test>`,
      in_reply_to: sent.messageId,
      headers: { auto_submitted: 'auto-replied' },
    };

    const answer = await inbound(autoReply);
    expect(answer).toEqual({ status: 'threaded', ticket_id: ticketId, automated: true });
    expect((await ticket(ticketId)).status).toBe('solved');
    const last = (await thread(ticketId)).at(-1)!;
    expect(last.kind).toBe('system');
    expect(last.body_text).toBe(
      `Automatic reply received from ${PLAYER} — the ticket was not reopened.\n\nPazartesiye kadar izindeyim.`,
    );

    expect(await inbound(autoReply)).toEqual({
      status: 'created',
      ticket_id: ticketId,
      duplicate: true,
    });
    // An out-of-office from Exchange, a bulk mail: the same, and still no ticket.
    for (const headers of [{ x_auto_response_suppress: 'All' }, { precedence: 'bulk' }]) {
      const again = await inbound({ ...autoReply, message_id: `<x.${stamp()}@m.test>`, headers });
      expect(again.automated).toBe(true);
    }
    expect((await ticket(ticketId)).status).toBe('solved');
    expect(await ticketCount()).toBe(1);
  });

  it('lets one sender open at most ten tickets an hour, and reopen none past that (FR-MOD-13.6)', async () => {
    const opened: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const answer = await inbound({
        to: defaultAddress(),
        from: 'loop@autoresponder.example',
        subject: `Loop ${i}`,
        message_id: `<loop.${i}.${stamp()}@autoresponder.example>`,
      });
      expect(answer.status).toBe('created');
      opened.push(answer.ticket_id!);
    }
    const eleventh = await inbound({
      to: defaultAddress(),
      from: 'loop@autoresponder.example',
      subject: 'Loop 10',
      message_id: `<loop.10.${stamp()}@autoresponder.example>`,
    });
    expect(eleventh).toEqual({ status: 'ignored', reason: 'rate_limited' });
    expect(await ticketCount()).toBe(10);

    // Past the budget an answer is still kept — without moving a solved ticket.
    const first = opened[0]!;
    await server.patch(`/tickets/${first}`, { status: 'solved' }, auth());
    const answer = await inbound({
      to: defaultAddress(),
      from: 'loop@autoresponder.example',
      subject: `Re: [#${first}] Loop 0`,
      text: 'Bir daha.',
      message_id: `<loop.answer.${stamp()}@autoresponder.example>`,
    });
    expect(answer).toEqual({ status: 'threaded', ticket_id: first });
    expect((await ticket(first)).status).toBe('solved');
    expect((await thread(first)).map((m) => m.body_text).slice(-2)).toEqual([
      'Bir daha.',
      'Not reopened: this sender opened or reopened too many tickets in the last hour.',
    ]);

    // Another sender has a budget of their own.
    expect((await inbound({ to: defaultAddress(), from: PLAYER, subject: 'Ayrı' })).status).toBe(
      'created',
    );
  });

  it('runs the spam gate before matching: spam writes into no ticket (FR-MOD-13.6)', async () => {
    const ticketId = await playerWritesIn();
    const sent = await agentAnswers(ticketId);
    const before = (await thread(ticketId)).length;

    const answer = await inbound({
      to: sent.replyTo,
      from: PLAYER,
      subject: `Re: ${sent.subject}`,
      message_id: `<spam.${stamp()}@mail.example.test>`,
      spam: true,
    });

    expect(answer).toEqual({ status: 'ignored', reason: 'spam' });
    expect((await thread(ticketId)).length).toBe(before);
  });

  it('refuses a forwarding label shaped like a reply address', async () => {
    const response = await server.post(
      '/channels/email/addresses',
      { label: 't-tj1h8cfkrv-8x2k4m6p' },
      {
        authorization: `Bearer ${await grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.ownerAccountId,
          scopes: ['channels--all:rw'],
        })}`,
      },
    );
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('reserved');
  });
});
