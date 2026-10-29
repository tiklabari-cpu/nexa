/**
 * A connection's transcript on demand (AR-04 · tm 338):
 * `GET /chats/{chatId}/threads/{threadId}/transcript` and
 * `POST /chats/{chatId}/threads/{threadId}/transcript/email`.
 *
 * What the analysis' acceptance asks of the API half:
 *   - an Ekip Lideri downloads the text file: the Chat ID and the Thread ID in
 *     it, the times in the workspace's zone, internal notes only in the
 *     internal copy;
 *   - the printable page carries ğ, ş, ı and İ as they are;
 *   - the mail to the player carries no internal note;
 *   - a domain the workspace did not allow is refused;
 *   - every download and mail is in the audit log, without the text;
 *   - by default an Ekip Üyesi cannot download the internal copy (nor any);
 *   - another workspace's conversation is a 404.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TRANSCRIPT_EXPORTS_PER_MINUTE,
  defaultScopesForRole,
  generateShortId,
} from '@siyahtus/types';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import type { Mailer, Message } from '../../src/services/mail/mailer.js';

type Headers = Record<string, string>;

const EMAIL = 'ayse.player@example.test';
const USERNAME = 'ayse_k77';
const PLAYER = 'Ayşe Oyuncu';
const NOTE = 'Internal: KYC pending, do not promise a date';
const TURKISH = 'Çekim talebim ğşıİ hâlâ beklemede';
/** 07:15 UTC — 10:15 in Istanbul, the workspace's zone. */
const BASE = Date.parse('2026-10-20T07:15:00.000Z');

describe('transcript export (AR-04 · tm 338)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let sent: Message[];
  let sales: bigint;
  let billing: bigint;
  let ownerAuth: Headers;
  let leadAuth: Headers;
  let agentAuth: Headers;

  beforeAll(async () => {
    owner = ownerClient();
    const carrier: Mailer = {
      send: async (message) => {
        sent.push(message);
      },
    };
    server = await startTestServer({}, { mailer: carrier });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    sent = [];
    fx = await seedFixtures(owner);
    server.app.permissionMatrix.cache.invalidate();
    await clearRateLimits(server.app);
    // The allowed domains live in the brand-scoped inbox settings.
    await seedDefaultBrand(owner, fx.a.licenseId);
    await owner.organization.update({
      where: { id: fx.a.organizationId },
      data: { timezone: 'Europe/Istanbul' },
    });

    const group = async (name: string): Promise<bigint> =>
      (
        await owner.group.create({
          data: { licenseId: fx.a.licenseId, name },
          select: { id: true },
        })
      ).id;
    sales = await group('Sales');
    billing = await group('Billing');
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: sales, agentId: fx.a.agentAccountId },
    });
    const lead = await owner.account.create({
      data: { email: `lead-${fx.a.licenseId}@example.test`, name: 'Leyla Lider' },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: fx.a.licenseId, agentId: lead.id, role: 'team_lead' },
    });
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: sales, agentId: lead.id, isLead: true },
    });
    leadAuth = await session(fx.a, lead.id, 'team_lead');
    ownerAuth = await session(fx.a, fx.a.ownerAccountId, 'owner');
    agentAuth = await session(fx.a, fx.a.agentAccountId, 'agent');
  });

  afterEach(async () => {
    await server.app.backgroundMail.settled();
  });

  async function session(t: TenantFixture, accountId: string, role: string): Promise<Headers> {
    const token = await grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: accountId,
      kind: 'oauth',
      scopes: defaultScopesForRole(role),
    });
    return { authorization: `Bearer ${token}` };
  }

  interface Conversation {
    chatId: string;
    threadId: string;
  }

  /**
   * A closed connection routed to `groupId`: the player, the agent's answer,
   * an internal note, a file and a Turkish line. `assignee` is the agent's
   * account when given.
   */
  async function conversation(
    groupId: bigint,
    options: { assignee?: string; text?: string } = {},
  ): Promise<Conversation> {
    const licenseId = fx.a.licenseId;
    const at = (offset: number) => new Date(BASE + offset);
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: PLAYER, email: EMAIL, username: USERNAME },
      select: { id: true },
    });
    const chatId = generateShortId();
    const threadId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId, customerId: customer.id, active: false, createdAt: at(0) },
    });
    await owner.chatAccess.create({ data: { chatId, groupId } });
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId,
        active: false,
        createdAt: at(0),
        closedAt: at(600_000),
        groupId,
        ...(options.assignee !== undefined ? { assigneeId: options.assignee } : {}),
      },
    });
    const lines: Array<{
      text: string | null;
      authorType: string;
      recipients?: string;
      attachmentUrl?: string;
    }> = [
      { text: options.text ?? TURKISH, authorType: 'customer' },
      { text: 'Checking it now <script>alert(1)</script>', authorType: 'agent' },
      { text: NOTE, authorType: 'agent', recipients: 'agents' },
      { text: null, authorType: 'customer', attachmentUrl: '/api/v1/uploads/dekont-123.pdf' },
    ];
    for (const [seq, line] of lines.entries()) {
      await owner.event.create({
        data: {
          id: `${threadId}_${seq + 1}`,
          threadId,
          chatId,
          licenseId,
          type: 'message',
          text: line.text,
          authorType: line.authorType,
          authorId: line.authorType === 'agent' ? fx.a.agentAccountId : null,
          recipients: line.recipients ?? 'all',
          attachmentUrl: line.attachmentUrl ?? null,
          createdAt: at(seq * 60_000),
        },
      });
    }
    return { chatId, threadId };
  }

  const download = (c: Conversation, query: string, headers: Headers) =>
    server.get(`/chats/${c.chatId}/threads/${c.threadId}/transcript?${query}`, headers);
  const email = (c: Conversation, body: object, headers: Headers) =>
    server.post(`/chats/${c.chatId}/threads/${c.threadId}/transcript/email`, body, headers);
  const audits = (action: string) =>
    owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action },
      orderBy: { createdAt: 'asc' },
    });

  it('gives an Ekip Lideri the text file with both ids, the workspace times, and the notes only in the internal copy, audited without the text (AR-04 KK1 · KK5)', async () => {
    const c = await conversation(sales, { assignee: fx.a.agentAccountId });

    const internal = await download(c, 'format=txt&audience=internal', leadAuth);
    expect(internal.statusCode).toBe(200);
    expect(internal.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(internal.headers['content-disposition']).toBe(
      `attachment; filename="siyahtus-transcript-${c.chatId}-${c.threadId}-internal.txt"`,
    );
    expect(internal.body).toMatch(new RegExp(`Thread ID \\(chat_id\\)\\s+: ${c.chatId}`));
    expect(internal.body).toMatch(new RegExp(`Chat ID \\(thread_id\\)\\s+: ${c.threadId}`));
    // The player by username, the agents, who exported.
    expect(internal.body).toContain(USERNAME);
    expect(internal.body).toContain('Leyla Lider');
    // 07:15 UTC is 10:15 in the workspace's zone, and the file says which zone.
    expect(internal.body).toContain('[10:15]');
    expect(internal.body).not.toContain('[07:15]');
    expect(internal.body).toContain('Europe/Istanbul');
    expect(internal.body).toContain(NOTE);
    expect(internal.body).toContain(TURKISH);
    // A file is its name and a pointer to the panel, never a link.
    expect(internal.body).toContain('(file: dekont-123.pdf — open it in the panel)');
    expect(internal.body).not.toContain('/api/v1/uploads/');

    const customer = await download(c, 'format=txt&audience=customer', leadAuth);
    expect(customer.statusCode).toBe(200);
    expect(customer.body).toContain(TURKISH);
    expect(customer.body).not.toContain(NOTE);
    expect(customer.body).not.toContain('Internal');

    const entries = await audits('chat.transcript_exported');
    expect(entries.map((e) => e.metadata)).toEqual([
      expect.objectContaining({ thread_id: c.threadId, format: 'txt', audience: 'internal' }),
      expect.objectContaining({ thread_id: c.threadId, format: 'txt', audience: 'customer' }),
    ]);
    expect(entries.every((e) => e.target === `chat:${c.chatId}`)).toBe(true);
    expect(JSON.stringify(entries.map((e) => e.metadata))).not.toContain(TURKISH);
  });

  it('serves a printable page that keeps ğşıİ as they are and escapes what was typed (AR-04 KK2)', async () => {
    const c = await conversation(sales);
    const page = await download(c, 'format=html&audience=internal', ownerAuth);
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(page.body.startsWith('<!doctype html>')).toBe(true);
    expect(page.body).toContain('<meta charset="utf-8">');
    expect(page.body).toContain('@media print');
    expect(page.body).toContain('ğşıİ');
    expect(page.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page.body).not.toContain('<script>');
    expect(page.body).toContain('class="line note"');
  });

  it('keeps an Ekip Üyesi from downloading either copy by default, and mails the player copy of their own conversation to the player (AR-04 KK3 · KK6)', async () => {
    const own = await conversation(sales, { assignee: fx.a.agentAccountId });

    for (const audience of ['internal', 'customer']) {
      const refused = await download(own, `format=txt&audience=${audience}`, agentAuth);
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({
        error: { details: { reason: 'capability_required', capability: 'transcripts.export' } },
      });
    }

    // No address given: the player's registered one, which the member need not see.
    const mailed = await email(own, {}, agentAuth);
    expect(mailed.statusCode).toBe(202);
    await server.app.backgroundMail.settled();
    expect(sent).toHaveLength(1);
    const [mail] = sent;
    expect(mail!.to).toBe(EMAIL);
    expect(mail!.kind).toBe('chat_transcript');
    expect(mail!.body).toContain(TURKISH);
    expect(mail!.body).not.toContain(NOTE);
    expect(mail!.html ?? '').not.toContain('KYC pending');

    // Anywhere else is the row's, which the member does not hold.
    const elsewhere = await email(own, { to: 'finance@sirket.com' }, agentAuth);
    expect(elsewhere.statusCode).toBe(403);
    expect(elsewhere.json()).toMatchObject({
      error: { type: 'recipient_not_allowed', details: { reason: 'player_address_only' } },
    });

    // A teammate's conversation the member can see but was not on.
    const teammates = await conversation(sales);
    const notOwn = await email(teammates, {}, agentAuth);
    expect(notOwn.statusCode).toBe(403);
    expect(notOwn.json()).toMatchObject({
      error: { details: { capability: 'transcripts.export' } },
    });
    // Another team's is not there at all.
    const other = await conversation(billing);
    expect((await email(other, {}, agentAuth)).statusCode).toBe(404);
  });

  it("mails to an allowed domain and refuses any other, audited with the recipient's domain only (AR-04 KK4 · KK5)", async () => {
    const c = await conversation(sales);

    const refusedBefore = await email(c, { to: 'compliance@sirket.com' }, leadAuth);
    expect(refusedBefore.statusCode).toBe(403);
    expect(refusedBefore.json()).toMatchObject({
      error: { type: 'recipient_not_allowed', details: { reason: 'domain_not_allowed' } },
    });

    const invalid = await server.put(
      '/settings/chat-timeout',
      { chat_timeout_seconds: null, transcript_allowed_domains: ['not a domain'] },
      ownerAuth,
    );
    expect(invalid.statusCode).toBe(400);
    const saved = await server.put(
      '/settings/chat-timeout',
      { chat_timeout_seconds: null, transcript_allowed_domains: [' @Sirket.COM ', 'sirket.com'] },
      ownerAuth,
    );
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ transcript_allowed_domains: ['sirket.com'] });
    expect((await server.get('/settings/chat-timeout', ownerAuth)).json()).toMatchObject({
      transcript_allowed_domains: ['sirket.com'],
    });

    const accepted = await email(c, { to: 'compliance@sirket.com' }, leadAuth);
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({ accepted: true });
    // A sub-domain or a look-alike is another domain.
    for (const to of ['x@mail.sirket.com', 'x@sirket.com.evil.test']) {
      const refused = await email(c, { to }, leadAuth);
      expect(refused.statusCode, to).toBe(403);
    }
    // Only the player's copy is ever mailed.
    expect(
      (await email(c, { to: 'compliance@sirket.com', audience: 'internal' }, leadAuth)).statusCode,
    ).toBe(400);

    await server.app.backgroundMail.settled();
    expect(sent.map((m) => m.to)).toEqual(['compliance@sirket.com']);
    expect(sent[0]!.body).not.toContain(NOTE);

    const entries = await audits('chat.transcript_emailed');
    expect(entries.map((e) => e.metadata)).toEqual([
      expect.objectContaining({
        thread_id: c.threadId,
        audience: 'customer',
        recipient_domain: 'sirket.com',
        to_player: false,
      }),
    ]);
    expect(JSON.stringify(entries.map((e) => e.metadata))).not.toContain('compliance@');
  });

  it("answers 404 for another workspace's conversation and for a connection of another chat (NFR-S5)", async () => {
    const c = await conversation(sales);
    const foreign = await session(fx.b, fx.b.ownerAccountId, 'owner');
    expect((await download(c, 'format=txt', foreign)).statusCode).toBe(404);
    expect((await email(c, {}, foreign)).statusCode).toBe(404);

    const d = await conversation(sales);
    const mixed = { chatId: c.chatId, threadId: d.threadId };
    expect((await download(mixed, 'format=txt', ownerAuth)).statusCode).toBe(404);
    expect(await audits('chat.transcript_exported')).toHaveLength(0);
  });

  it('stops a person after the minute budget of downloads and mails together', async () => {
    const c = await conversation(sales);
    for (let i = 0; i < TRANSCRIPT_EXPORTS_PER_MINUTE; i += 1) {
      expect((await download(c, 'format=txt', ownerAuth)).statusCode).toBe(200);
    }
    const over = await email(c, {}, ownerAuth);
    expect(over.statusCode).toBe(429);
    expect(over.headers['retry-after']).toBeDefined();
    // Another person's budget is their own.
    expect((await download(c, 'format=txt', leadAuth)).statusCode).toBe(200);
  });
});
