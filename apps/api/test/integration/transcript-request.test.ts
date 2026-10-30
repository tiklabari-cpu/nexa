/**
 * The player's own transcript, on request, and the workspace's forwarding
 * settings (WG-06 · tm 345, K26), through the real server:
 *
 *   1. `POST /customer/chat/transcript` mails the visitor's latest connection
 *      — never an older one, never another visitor's — in the language their
 *      widget showed, without an internal note, as `chat_transcript`, to the
 *      address they typed or the one they gave before; on the record as
 *      `chat.transcript_emailed` by the customer.
 *   2. No address is a 400 the widget answers by asking; no conversation a 404.
 *   3. Three copies a connection and five an hour a visitor: then 429.
 *   4. `/settings/chat-timeout` keeps at most five forwarding addresses, and
 *      refuses internal notes while any address is outside the workspace's
 *      proven SSO domains — nothing is saved then.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TRANSCRIPT_REQUESTS_PER_CHAT,
  TRANSCRIPT_REQUESTS_PER_HOUR,
  defaultScopesForRole,
  generateShortId,
} from '@siyahtus/types';
import {
  grantToken,
  ownerClient,
  proveSsoDomains,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import type { Mailer, Message } from '../../src/services/mail/mailer.js';

type Headers = Record<string, string>;

const NOTE = 'Internal: KYC pending, do not promise a date';
const REPLY = 'Çekiminiz işleme alındı';

describe('the transcript a player asks for (WG-06 · tm 345)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let sent: Message[];
  let adminAuth: Headers;
  let seq = 0;

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
    seq = 0;
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    await seedDefaultBrand(owner, fx.a.licenseId);
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      kind: 'oauth',
      scopes: defaultScopesForRole('owner'),
    });
    adminAuth = { authorization: `Bearer ${token}` };
  });

  afterEach(async () => {
    await server.app.backgroundMail.settled();
  });

  /** A widget visitor through the real mint, then given an address and a language. */
  async function visitor(
    profile: { email?: string | null; locale?: string | null } = {},
  ): Promise<{ headers: Headers; customerId: string }> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    const minted = response.json() as { token: string; customer_id: string };
    await owner.customer.update({
      where: { id: minted.customer_id },
      data: {
        name: 'Ayşe',
        email: profile.email === undefined ? 'ayse@example.test' : profile.email,
        locale: profile.locale ?? null,
      },
    });
    return { headers: { authorization: `Bearer ${minted.token}` }, customerId: minted.customer_id };
  }

  /** A closed connection of `customerId`: their line, the agent's answer, a note. */
  async function connection(
    customerId: string,
    opts: { text?: string; at?: Date } = {},
  ): Promise<{ chatId: string; threadId: string }> {
    const at = opts.at ?? new Date();
    const chatId = generateShortId();
    const threadId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: fx.a.licenseId, customerId, active: false, createdAt: at },
    });
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: fx.a.licenseId,
        active: false,
        assigneeId: fx.a.agentAccountId,
        createdAt: at,
        closedAt: at,
      },
    });
    const lines: Array<{ authorType: string; text: string; recipients: string }> = [
      { authorType: 'customer', text: opts.text ?? 'Param yatmadı', recipients: 'all' },
      { authorType: 'agent', text: REPLY, recipients: 'all' },
      { authorType: 'agent', text: NOTE, recipients: 'agents' },
    ];
    for (const [i, line] of lines.entries()) {
      seq += 1;
      await owner.event.create({
        data: {
          id: `${threadId}_r${seq}`,
          threadId,
          chatId,
          licenseId: fx.a.licenseId,
          type: 'message',
          authorType: line.authorType,
          authorId: line.authorType === 'agent' ? fx.a.agentAccountId : null,
          text: line.text,
          recipients: line.recipients,
          createdAt: new Date(at.getTime() + i * 1_000),
        },
      });
    }
    return { chatId, threadId };
  }

  const ask = (headers: Headers, body: Record<string, unknown> = {}) =>
    server.post('/customer/chat/transcript', body, headers);

  async function mails(): Promise<Message[]> {
    await server.app.backgroundMail.settled();
    return sent;
  }

  // ==========================================================================
  // The copy
  // ==========================================================================

  it("mails the player's copy of the latest connection, in their language, without a note (K26)", async () => {
    const player = await visitor({ locale: 'tr' });
    await connection(player.customerId, {
      text: 'Eski sohbet satırı',
      at: new Date(Date.now() - 3_600_000),
    });
    const latest = await connection(player.customerId, { text: 'Yeni sohbet satırı' });

    const response = await ask(player.headers);
    expect(response.statusCode, response.body).toBe(202);
    expect(response.json()).toEqual({ accepted: true });

    const out = await mails();
    expect(out.map((m) => `${m.kind} → ${m.to}`)).toEqual(['chat_transcript → ayse@example.test']);
    const mail = out[0]!;
    expect(mail.subject).toMatch(/görüşmenizin kopyası$/);
    expect(mail.body).toContain('Yeni sohbet satırı');
    expect(mail.body).toContain(REPLY);
    expect(mail.body).not.toContain('Eski sohbet satırı');
    expect(mail.body).not.toContain('KYC pending');
    expect(mail.html ?? '').not.toContain('KYC pending');

    const trail = await owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: 'chat.transcript_emailed' },
      select: { actorType: true, actorId: true, target: true, metadata: true },
    });
    expect(trail).toMatchObject([
      {
        actorType: 'customer',
        actorId: player.customerId,
        target: `chat:${latest.chatId}`,
        metadata: {
          thread_id: latest.threadId,
          audience: 'customer',
          recipient_domain: 'example.test',
          to_player: true,
          requested_by: 'player',
        },
      },
    ]);
  });

  it('sends to the address the player typed, and reads English for a language the mails lack', async () => {
    const player = await visitor({ email: null, locale: 'de' });
    await connection(player.customerId);

    const response = await ask(player.headers, { email: ' oyuncu@mail.test ' });
    expect(response.statusCode, response.body).toBe(202);

    const out = await mails();
    expect(out.map((m) => m.to)).toEqual(['oyuncu@mail.test']);
    expect(out[0]!.subject).toMatch(/^your conversation with /i);
    // The typed address is a delivery, not a change to the contact.
    const contact = await owner.customer.findUnique({
      where: { id: player.customerId },
      select: { email: true },
    });
    expect(contact?.email).toBeNull();
  });

  it("never sends another visitor's newer conversation", async () => {
    const player = await visitor();
    await connection(player.customerId, {
      text: 'Benim satırım',
      at: new Date(Date.now() - 60_000),
    });
    const other = await visitor({ email: 'other@example.test' });
    await connection(other.customerId, { text: 'Başkasının satırı' });

    expect((await ask(player.headers)).statusCode).toBe(202);
    const out = await mails();
    expect(out).toHaveLength(1);
    expect(out[0]!.body).toContain('Benim satırım');
    expect(out[0]!.body).not.toContain('Başkasının satırı');
  });

  it('asks for an address when there is none, 404s without a conversation, 400s a wrong address', async () => {
    const none = await visitor({ email: null });
    expect((await ask(none.headers)).statusCode).toBe(404);

    await connection(none.customerId);
    const missing = await ask(none.headers);
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: { details: { reason: 'no_player_address' } } });

    expect((await ask(none.headers, { email: 'not-an-address' })).statusCode).toBe(400);
    expect((await ask(none.headers, { email: 'a@b.test', cc: 'x@y.test' })).statusCode).toBe(400);
    expect(await mails()).toEqual([]);
  });

  // ==========================================================================
  // How often
  // ==========================================================================

  it('allows three copies a connection and five an hour a visitor, then 429', async () => {
    expect(TRANSCRIPT_REQUESTS_PER_CHAT).toBe(3);
    expect(TRANSCRIPT_REQUESTS_PER_HOUR).toBe(5);
    const player = await visitor();
    await connection(player.customerId, { at: new Date(Date.now() - 60_000) });

    for (let i = 0; i < 3; i += 1) expect((await ask(player.headers)).statusCode).toBe(202);
    const perChat = await ask(player.headers);
    expect(perChat.statusCode).toBe(429);
    expect(perChat.headers['retry-after']).toBeDefined();

    // A new connection has its own three; the visitor's hour has one left.
    await connection(player.customerId);
    expect((await ask(player.headers)).statusCode).toBe(202);
    expect((await ask(player.headers)).statusCode).toBe(429);

    expect(await mails()).toHaveLength(4);
  });

  // ==========================================================================
  // Forwarding settings
  // ==========================================================================

  const putSettings = (payload: Record<string, unknown>) =>
    server.app.inject({
      method: 'PUT',
      url: server.url('/settings/chat-timeout'),
      payload: { chat_timeout_seconds: null, ...payload },
      headers: adminAuth,
    });

  async function stored(): Promise<{ to: string[]; notes: boolean }> {
    const row = await owner.inboxSettings.findFirst({
      where: { licenseId: fx.a.licenseId },
      select: { transcriptForwardTo: true, transcriptForwardIncludeNotes: true },
    });
    return {
      to: row?.transcriptForwardTo ?? [],
      notes: row?.transcriptForwardIncludeNotes ?? false,
    };
  }

  it('keeps at most five forwarding addresses, normalised, and reads them back', async () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `${n}@sirket.test`);
    expect((await putSettings({ transcript_forward_to: six })).statusCode).toBe(400);
    expect((await putSettings({ transcript_forward_to: ['not-an-address'] })).statusCode).toBe(400);
    expect(await stored()).toEqual({ to: [], notes: false });

    const saved = await putSettings({
      transcript_forward_to: [' Arsiv@Sirket.TEST ', 'arsiv@sirket.test', 'uyum@sirket.test'],
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({
      transcript_forward_to: ['Arsiv@sirket.test', 'uyum@sirket.test'],
      transcript_forward_include_notes: false,
    });
    const read = await server.app.inject({
      method: 'GET',
      url: server.url('/settings/chat-timeout'),
      headers: adminAuth,
    });
    expect(read.json()).toMatchObject({
      transcript_forward_to: ['Arsiv@sirket.test', 'uyum@sirket.test'],
    });
  });

  it('refuses internal notes to an address outside the proven SSO domains, and saves nothing', async () => {
    const connectionRow = await owner.ssoConnection.create({
      data: {
        licenseId: fx.a.licenseId,
        name: 'Okta',
        idpEntityId: `https://idp.test/${generateShortId()}`,
        idpSsoUrl: 'https://idp.test/sso',
        idpCertificatePem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
        verifiedDomains: ['sirket.test', 'claimed.test'],
      },
      select: { id: true },
    });
    // Only sirket.test is proved; claimed.test stays a bare claim.
    await proveSsoDomains(owner, connectionRow.id);
    await owner.ssoDomainVerification.updateMany({
      where: { connectionId: connectionRow.id, domain: 'claimed.test' },
      data: { verifiedAt: null },
    });

    for (const outside of ['arsiv@gmail.test', 'arsiv@claimed.test', 'arsiv@mail.sirket.test']) {
      const refused = await putSettings({
        transcript_forward_to: ['uyum@sirket.test', outside],
        transcript_forward_include_notes: true,
      });
      expect(refused.statusCode, outside).toBe(400);
      expect(refused.json()).toMatchObject({
        error: {
          details: {
            reason: 'domain_not_verified',
            fields: [{ field: 'transcript_forward_to.1' }],
          },
        },
      });
      expect(await stored()).toEqual({ to: [], notes: false });
    }

    // The same addresses without notes are allowed: the player's copy may go anywhere.
    expect((await putSettings({ transcript_forward_to: ['arsiv@gmail.test'] })).statusCode).toBe(
      200,
    );
    // Turning notes on later is judged against the stored list.
    const later = await putSettings({ transcript_forward_include_notes: true });
    expect(later.statusCode).toBe(400);

    const proven = await putSettings({
      transcript_forward_to: ['uyum@sirket.test'],
      transcript_forward_include_notes: true,
    });
    expect(proven.statusCode, proven.body).toBe(200);
    expect(await stored()).toEqual({ to: ['uyum@sirket.test'], notes: true });

    const trail = await owner.auditLogEntry.findFirst({
      where: { licenseId: fx.a.licenseId, action: 'settings.chat_timeout_updated' },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    });
    expect(trail?.metadata).toMatchObject({
      transcript_forward_domains: ['sirket.test'],
      transcript_forward_count: 1,
      transcript_forward_include_notes: true,
    });
  });

  it('lets only an admin change forwarding (Kurucu / Yönetici)', async () => {
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      kind: 'oauth',
      scopes: defaultScopesForRole('agent'),
    });
    const response = await server.app.inject({
      method: 'PUT',
      url: server.url('/settings/chat-timeout'),
      payload: { chat_timeout_seconds: null, transcript_forward_to: ['arsiv@sirket.test'] },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(403);
    expect(await stored()).toEqual({ to: [], notes: false });
  });
});
