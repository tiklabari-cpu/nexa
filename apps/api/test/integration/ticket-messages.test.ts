/**
 * A ticket's conversation — the service and its two routes (SiyahTuş analysis
 * HD-01 · tm 356.2). The store's own promises are `ticket-messages-schema.test.ts`;
 * what is pinned here is what the service adds on top:
 *
 *   - a reply is masked before it rests, leaves the ticket `pending` and stamps
 *     the first response once; a note changes neither and needs no recipient;
 *   - a reply to a player with no e-mail address is refused, a note is not;
 *   - one idempotency key is one message — retried, raced, or reused wrongly;
 *   - a merged ticket is history: writing on it names the primary, and the
 *     primary's thread reads the merged ticket's messages;
 *   - another workspace's ticket, or one outside the agent's teams, is a 404;
 *   - the thread pages oldest first without repeating or skipping a row;
 *   - attachments must be this workspace's own uploads;
 *   - the realtime notice reaches the people working the ticket, with ids only;
 *   - the player writing moves the ticket back to `open` (the inbound path's
 *     entry point, HD-03).
 *
 * This server keeps ticket e-mail off (`TICKET_MAIL_OUTBOUND` unset), so every
 * reply is stored `suppressed`; the mail path is `ticket-reply-mail.test.ts`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { licenseChannel, TICKET_MESSAGE_TEXT_MAX } from '@siyahtus/types';
import { withTenant } from '../../src/lib/tenant.js';
import { LocalStore } from '../../src/services/storage/local-store.js';
import { buildKey } from '../../src/services/storage/upload-url.js';
import { TicketMessageService } from '../../src/services/tickets/ticket-message-service.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const ADMIN = ['tickets--all:rw', 'tickets--all:ro'];
const SCOPED_AGENT = ['tickets--access:rw', 'tickets--access:ro'];
const READONLY = ['tickets--all:ro'];

interface Message {
  id: string;
  ticket_id: string;
  kind: string;
  author_type: string;
  author_id: string | null;
  author_name: string | null;
  body_text: string;
  body_html: string | null;
  attachments: Array<Record<string, unknown>>;
  delivery_status: string | null;
  created_at: string;
}

interface Envelope {
  action: string;
  audience: { agentIds?: string[]; groupIds?: number[] };
  payload: Record<string, unknown>;
}

describe('ticket messages (HD-01)', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;
  let storageDir: string;

  let adminToken: string;
  let agentToken: string;
  let readonlyToken: string;
  let otherTenantToken: string;
  let supportGroupId: bigint;
  let salesGroupId: bigint;
  /** A player who left an address — the one a reply can go to. */
  let playerId: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  let keySeq = 0;
  const freshKey = () => `key-${Date.now()}-${++keySeq}`;

  beforeAll(async () => {
    owner = ownerClient();
    storageDir = mkdtempSync(join(tmpdir(), 'siyahtus-ticket-messages-'));
    server = await startTestServer({ STORAGE_PROVIDER: 'local', STORAGE_LOCAL_DIR: storageDir });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
    rmSync(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);

    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    const sales = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Sales' },
      select: { id: true },
    });
    supportGroupId = support.id;
    salesGroupId = sales.id;
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: support.id,
        agentId: fx.a.agentAccountId,
        priority: 'normal',
      },
    });

    const player = await owner.customer.create({
      data: {
        organizationId: fx.a.organizationId,
        name: 'Ayşe Oyuncu',
        email: 'ayse.oyuncu@example.test',
      },
      select: { id: true },
    });
    playerId = player.id;

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ADMIN,
    });
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: SCOPED_AGENT,
    });
    readonlyToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: READONLY,
    });
    otherTenantToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ADMIN,
    });
  });

  async function makeTicket(
    options: { customerId?: string; groupId?: bigint; assigneeId?: string } = {},
  ): Promise<string> {
    const response = await server.post(
      '/tickets',
      {
        subject: 'Çekim talebim bekliyor',
        customer_id: options.customerId ?? playerId,
        ...(options.groupId !== undefined ? { group_id: Number(options.groupId) } : {}),
        ...(options.assigneeId !== undefined ? { assignee_id: options.assigneeId } : {}),
      },
      auth(adminToken),
    );
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { id: string }).id;
  }

  function write(ticketId: string, body: Record<string, unknown>, token = adminToken) {
    return server.post(`/tickets/${ticketId}/messages`, body, auth(token));
  }

  async function reply(ticketId: string, text: string, extra: Record<string, unknown> = {}) {
    const response = await write(ticketId, {
      kind: 'reply',
      text,
      idempotency_key: freshKey(),
      ...extra,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as Message;
  }

  async function note(ticketId: string, text: string, extra: Record<string, unknown> = {}) {
    const response = await write(ticketId, {
      kind: 'note',
      text,
      idempotency_key: freshKey(),
      ...extra,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as Message;
  }

  async function thread(ticketId: string, query = '', token = adminToken) {
    const response = await server.get(`/tickets/${ticketId}/messages${query}`, auth(token));
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as { items: Message[]; next_page_id?: string };
  }

  function ticketRow(ticketId: string) {
    return owner.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  }

  function audits(action: string) {
    return owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action },
      orderBy: { createdAt: 'asc' },
    });
  }

  // =========================================================================
  // Reply and note
  // =========================================================================

  describe('a reply', () => {
    it('is masked before it is stored (FR-MOD-08.9.5)', async () => {
      const ticketId = await makeTicket();

      const message = await reply(
        ticketId,
        'Kartınız 4111 1111 1111 1111 sistemde görünüyor. Şifrem: Gizli2026 diye yazmayın.',
      );

      expect(message.body_text).not.toContain('4111 1111 1111 1111');
      expect(message.body_text).toContain('**** **** **** 1111');
      expect(message.body_text).not.toContain('Gizli2026');
      const stored = await owner.ticketMessage.findUniqueOrThrow({ where: { id: message.id } });
      expect(stored.bodyText).toBe(message.body_text);
    });

    it('is stored as the agent’s, waits on the player, and stamps the first response', async () => {
      const ticketId = await makeTicket();

      const message = await reply(ticketId, 'Talebinizi inceliyoruz.');

      expect(message).toMatchObject({
        ticket_id: ticketId,
        kind: 'agent_reply',
        author_type: 'agent',
        author_id: fx.a.ownerAccountId,
        author_name: expect.stringMatching(/^Owner /),
        body_text: 'Talebinizi inceliyoruz.',
        body_html: null,
        attachments: [],
        // No mail path until tm 356.3: the deployment cannot send ticket mail.
        delivery_status: 'suppressed',
      });

      const ticket = await ticketRow(ticketId);
      expect(ticket.status).toBe('pending');
      expect(ticket.firstResponseAt?.toISOString()).toBe(message.created_at);
      expect(ticket.lastAgentMessageAt?.toISOString()).toBe(message.created_at);
      expect(ticket.lastMessageAt?.toISOString()).toBe(message.created_at);
      expect(ticket.lastCustomerMessageAt).toBeNull();

      const replied = await audits('ticket.replied');
      expect(replied).toHaveLength(1);
      expect(replied[0]).toMatchObject({
        target: `ticket:${ticketId}`,
        metadata: { message_id: message.id, attachments: 0 },
      });
      // The trail records that a reply was sent, never what it said.
      expect(JSON.stringify(replied[0]!.metadata)).not.toContain('inceliyoruz');
      expect((await audits('ticket.status_changed'))[0]).toMatchObject({
        metadata: { from: 'open', to: 'pending' },
      });
    });

    it('does not move the first response a second time', async () => {
      const ticketId = await makeTicket();
      const first = await reply(ticketId, 'İlk yanıt.');
      const second = await reply(ticketId, 'İkinci yanıt.');

      const ticket = await ticketRow(ticketId);
      expect(ticket.firstResponseAt?.toISOString()).toBe(first.created_at);
      expect(ticket.lastAgentMessageAt?.toISOString()).toBe(second.created_at);
      // One transition, open → pending; the second reply found it pending.
      expect(await audits('ticket.status_changed')).toHaveLength(1);
    });

    it('"send and solve" solves the ticket in the same request', async () => {
      const ticketId = await makeTicket();

      await reply(ticketId, 'Çözüldü, iyi günler.', { set_status: 'solved' });

      expect((await ticketRow(ticketId)).status).toBe('solved');
      const changes = await audits('ticket.status_changed');
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ metadata: { from: 'open', to: 'solved' } });
    });

    it('is refused for a player who left no e-mail address — a note is not', async () => {
      // The fixture's customer has a name and no address.
      const ticketId = await makeTicket({ customerId: fx.a.customerId });

      const refused = await write(ticketId, {
        kind: 'reply',
        text: 'Merhaba',
        idempotency_key: freshKey(),
      });
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json()).toMatchObject({ error: { type: 'ticket_no_recipient' } });
      expect(await owner.ticketMessage.count({ where: { ticketId } })).toBe(0);
      expect((await ticketRow(ticketId)).status).toBe('open');

      await note(ticketId, 'Oyuncunun e-postası yok, telefonla aranacak.');
    });
  });

  describe('a note', () => {
    it('stays with the team: no delivery status, no status change, no first response', async () => {
      const ticketId = await makeTicket();

      const message = await note(ticketId, 'Finans ekibine sordum.');

      expect(message).toMatchObject({
        kind: 'internal_note',
        author_type: 'agent',
        delivery_status: null,
      });
      const ticket = await ticketRow(ticketId);
      expect(ticket.status).toBe('open');
      expect(ticket.firstResponseAt).toBeNull();
      expect(ticket.lastAgentMessageAt).toBeNull();
      expect(ticket.lastMessageAt?.toISOString()).toBe(message.created_at);

      const stored = await owner.ticketMessage.findUniqueOrThrow({ where: { id: message.id } });
      expect(stored).toMatchObject({
        deliveryStatus: null,
        emailMessageId: null,
        inReplyTo: null,
      });
      expect(await audits('ticket.note_added')).toHaveLength(1);
      expect(await audits('ticket.replied')).toHaveLength(0);
      expect(await audits('ticket.status_changed')).toHaveLength(0);
    });

    it('moves the status only when asked to', async () => {
      const ticketId = await makeTicket();

      await note(ticketId, 'Oyuncudan belge bekleniyor.', { set_status: 'pending' });

      expect((await ticketRow(ticketId)).status).toBe('pending');
    });
  });

  // =========================================================================
  // Idempotency
  // =========================================================================

  describe('one idempotency key', () => {
    it('is one message: the retry answers with what the first attempt stored', async () => {
      const ticketId = await makeTicket();
      const body = { kind: 'reply', text: 'Tek mesaj.', idempotency_key: freshKey() };

      const first = await write(ticketId, body);
      const retry = await write(ticketId, body);

      expect(first.statusCode, first.body).toBe(201);
      expect(retry.statusCode, retry.body).toBe(200);
      expect(retry.json()).toEqual(first.json());
      expect(await owner.ticketMessage.count({ where: { ticketId } })).toBe(1);
      expect(await audits('ticket.replied')).toHaveLength(1);
      expect(await audits('ticket.status_changed')).toHaveLength(1);
    });

    it('is one message when two attempts race', async () => {
      const ticketId = await makeTicket();
      const body = { kind: 'note', text: 'Aynı anda iki tık.', idempotency_key: freshKey() };

      const responses = await Promise.all([write(ticketId, body), write(ticketId, body)]);

      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 201]);
      expect(await owner.ticketMessage.count({ where: { ticketId } })).toBe(1);
      expect(await audits('ticket.note_added')).toHaveLength(1);
    });

    it('is refused when it comes back naming another ticket or another author', async () => {
      const ticketId = await makeTicket({ groupId: supportGroupId });
      const otherTicketId = await makeTicket({ groupId: supportGroupId });
      const key = freshKey();
      expect(
        (await write(ticketId, { kind: 'note', text: 'Bir', idempotency_key: key })).statusCode,
      ).toBe(201);

      const elsewhere = await write(otherTicketId, {
        kind: 'note',
        text: 'İki',
        idempotency_key: key,
      });
      expect(elsewhere.statusCode, elsewhere.body).toBe(400);
      expect(elsewhere.json()).toMatchObject({ error: { type: 'validation' } });

      const someoneElse = await write(
        ticketId,
        { kind: 'note', text: 'Üç', idempotency_key: key },
        agentToken,
      );
      expect(someoneElse.statusCode, someoneElse.body).toBe(400);
      expect(await owner.ticketMessage.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
    });
  });

  // =========================================================================
  // Merged tickets
  // =========================================================================

  describe('a merged ticket (FR-MOD-13.6)', () => {
    it('refuses a write naming its primary, and its messages read in the primary’s thread', async () => {
      const primaryId = await makeTicket();
      const mergedId = await makeTicket();
      const replyKey = freshKey();
      const onMerged = await write(mergedId, {
        kind: 'reply',
        text: 'İkinci talepteki yanıt.',
        idempotency_key: replyKey,
      });
      expect(onMerged.statusCode, onMerged.body).toBe(201);
      const onPrimary = await note(primaryId, 'Birincil talepteki not.');

      const merge = await server.post(
        `/tickets/${mergedId}/merge`,
        { into: primaryId },
        auth(adminToken),
      );
      expect(merge.statusCode, merge.body).toBe(200);

      const refused = await write(mergedId, {
        kind: 'note',
        text: 'Geç kalan not.',
        idempotency_key: freshKey(),
      });
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json()).toMatchObject({
        error: { type: 'ticket_merged', details: { primary_ticket_id: primaryId } },
      });

      // A retry of what went through before the merge still answers with it.
      const retry = await write(mergedId, {
        kind: 'reply',
        text: 'İkinci talepteki yanıt.',
        idempotency_key: replyKey,
      });
      expect(retry.statusCode, retry.body).toBe(200);
      expect((retry.json() as Message).id).toBe((onMerged.json() as Message).id);

      const primaryThread = await thread(primaryId);
      expect(primaryThread.items.map((item) => [item.id, item.ticket_id])).toEqual([
        [(onMerged.json() as Message).id, mergedId],
        [onPrimary.id, primaryId],
      ]);
      const mergedThread = await thread(mergedId);
      expect(mergedThread.items.map((item) => item.id)).toEqual([(onMerged.json() as Message).id]);
    });
  });

  // =========================================================================
  // Visibility
  // =========================================================================

  describe('visibility (NFR-S5)', () => {
    it('another workspace’s ticket is not found, for reading and for writing', async () => {
      const ticketId = await makeTicket();
      await note(ticketId, 'Yalnız A çalışma alanı görür.');

      const read = await server.get(`/tickets/${ticketId}/messages`, auth(otherTenantToken));
      expect(read.statusCode).toBe(404);
      const written = await write(
        ticketId,
        { kind: 'note', text: 'B yazamaz.', idempotency_key: freshKey() },
        otherTenantToken,
      );
      expect(written.statusCode).toBe(404);
      expect(await owner.ticketMessage.count({ where: { ticketId } })).toBe(1);
    });

    it('a ticket outside the agent’s teams is not found; one inside is theirs to answer', async () => {
      const salesTicket = await makeTicket({ groupId: salesGroupId });
      const supportTicket = await makeTicket({ groupId: supportGroupId });

      expect(
        (await server.get(`/tickets/${salesTicket}/messages`, auth(agentToken))).statusCode,
      ).toBe(404);
      const hidden = await write(
        salesTicket,
        { kind: 'reply', text: 'Merhaba', idempotency_key: freshKey() },
        agentToken,
      );
      expect(hidden.statusCode).toBe(404);

      const answered = await write(
        supportTicket,
        { kind: 'reply', text: 'Merhaba', idempotency_key: freshKey() },
        agentToken,
      );
      expect(answered.statusCode, answered.body).toBe(201);
      expect(answered.json()).toMatchObject({ author_id: fx.a.agentAccountId });
    });

    it('a read-only token reads the thread and cannot write to it', async () => {
      const ticketId = await makeTicket();
      await note(ticketId, 'Okunur.');

      expect((await thread(ticketId, '', readonlyToken)).items).toHaveLength(1);
      const refused = await write(
        ticketId,
        { kind: 'note', text: 'Yazılmaz.', idempotency_key: freshKey() },
        readonlyToken,
      );
      expect(refused.statusCode).toBe(403);
    });
  });

  // =========================================================================
  // The thread
  // =========================================================================

  describe('the thread', () => {
    it('pages oldest first, without repeating or skipping a row written in the same millisecond', async () => {
      const ticketId = await makeTicket();
      // Microseconds the cursor (a JS Date) cannot carry: three rows inside one
      // millisecond, then two more.
      const stamps = [
        '2026-10-25 10:00:00.000100+00',
        '2026-10-25 10:00:00.000200+00',
        '2026-10-25 10:00:00.000900+00',
        '2026-10-25 10:00:00.001000+00',
        '2026-10-25 10:00:01.000000+00',
      ];
      for (const [index, stamp] of stamps.entries()) {
        await owner.$executeRaw`
          INSERT INTO ticket_messages (id, license_id, ticket_id, kind, author_type, author_id, body_text, created_at)
          VALUES (gen_random_uuid(), ${fx.a.licenseId}::bigint, ${ticketId}, 'internal_note', 'agent',
                  ${fx.a.ownerAccountId}::uuid, ${`not ${index}`}, ${stamp}::timestamptz)
        `;
      }

      const seen: Message[] = [];
      let pageId: string | undefined;
      let pages = 0;
      do {
        const page = await thread(ticketId, `?limit=2${pageId ? `&page_id=${pageId}` : ''}`);
        seen.push(...page.items);
        pageId = page.next_page_id;
        pages += 1;
      } while (pageId && pages < 10);

      expect(pages).toBe(3);
      expect(new Set(seen.map((item) => item.id)).size).toBe(5);
      // Oldest first: the three same-millisecond rows, then the other two.
      expect(seen.slice(3).map((item) => item.body_text)).toEqual(['not 3', 'not 4']);
      expect(new Set(seen.slice(0, 3).map((item) => item.body_text))).toEqual(
        new Set(['not 0', 'not 1', 'not 2']),
      );
    });

    it('refuses a page id it did not issue', async () => {
      const ticketId = await makeTicket();
      const response = await server.get(
        `/tickets/${ticketId}/messages?page_id=not-a-cursor`,
        auth(adminToken),
      );
      expect(response.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // Attachments
  // =========================================================================

  describe('attachments', () => {
    it('carry the files this workspace uploaded, and only those', async () => {
      const ticketId = await makeTicket();
      const store = new LocalStore(storageDir);
      const key = buildKey(fx.a.licenseId, 'application/pdf');
      await store.put(key, Buffer.from('%PDF-1.4 dekont'), 'application/pdf');

      const message = await reply(ticketId, 'Dekontunuz ektedir.', { attachment_keys: [key] });
      expect(message.attachments).toEqual([
        {
          key,
          name: key,
          size: 15,
          mime: 'application/pdf',
          scan_status: 'clean',
          sensitive: false,
        },
      ]);
      expect((await audits('ticket.replied'))[0]).toMatchObject({
        metadata: { attachments: 1 },
      });

      const foreignKey = buildKey(fx.b.licenseId, 'application/pdf');
      await store.put(foreignKey, Buffer.from('%PDF-1.4'), 'application/pdf');
      const neverUploaded = buildKey(fx.a.licenseId, 'application/pdf');
      for (const keys of [[foreignKey], [neverUploaded], ['../../etc/passwd'], [key, key]]) {
        const response = await write(ticketId, {
          kind: 'note',
          text: 'Ek',
          attachment_keys: keys,
          idempotency_key: freshKey(),
        });
        expect(response.statusCode, `${keys.join(',')}: ${response.body}`).toBe(400);
      }
      expect(await owner.ticketMessage.count({ where: { ticketId } })).toBe(1);
    });
  });

  // =========================================================================
  // Realtime
  // =========================================================================

  describe('the realtime notice', () => {
    let listener: Redis;
    let pushes: Envelope[];

    beforeEach(async () => {
      pushes = [];
      listener = server.app.redis.duplicate();
      listener.on('message', (_channel: string, raw: string) => {
        const envelope = JSON.parse(raw) as Envelope;
        if (envelope.action === 'ticket_message_created') pushes.push(envelope);
      });
      await listener.subscribe(licenseChannel(fx.a.licenseId));
    });

    afterEach(async () => {
      await listener.quit();
    });

    it('reaches the assignee, the followers and the team — with ids, never the text', async () => {
      const ticketId = await makeTicket({
        groupId: supportGroupId,
        assigneeId: fx.a.agentAccountId,
      });
      const follow = await server.post(
        `/tickets/${ticketId}/followers`,
        { account_id: fx.a.ownerAccountId },
        auth(adminToken),
      );
      expect(follow.statusCode, follow.body).toBe(200);

      const body = { kind: 'note', text: 'Gizli iç not metni.', idempotency_key: freshKey() };
      const first = await write(ticketId, body);
      const message = first.json() as Message;

      await vi.waitFor(() => expect(pushes).toHaveLength(1));
      const push = pushes[0]!;
      expect(push.audience.groupIds).toEqual([Number(supportGroupId)]);
      expect([...(push.audience.agentIds ?? [])].sort()).toEqual(
        [fx.a.agentAccountId, fx.a.ownerAccountId].sort(),
      );
      expect(push.payload).toEqual({
        ticket_id: ticketId,
        message_id: message.id,
        kind: 'internal_note',
        author_type: 'agent',
        author_id: fx.a.ownerAccountId,
        created_at: message.created_at,
      });
      expect(JSON.stringify(push)).not.toContain('Gizli');

      // The retry was announced the first time.
      expect((await write(ticketId, body)).statusCode).toBe(200);
      await note(ticketId, 'Bir sonraki.');
      await vi.waitFor(() => expect(pushes).toHaveLength(2));
      expect(pushes[1]!.payload['message_id']).not.toBe(message.id);
    });
  });

  // =========================================================================
  // The player's message (the inbound path's entry point, HD-03)
  // =========================================================================

  describe("the player's message", () => {
    const service = new TicketMessageService();
    const audit = () => ({
      licenseId: fx.a.licenseId,
      chainSecret: testEnv().AUDIT_CHAIN_SECRET,
      actorId: null,
      actorType: 'system' as const,
    });
    const tenant = () => ({ licenseId: fx.a.licenseId, organizationId: fx.a.organizationId });
    const record = (input: Parameters<TicketMessageService['recordCustomerMessage']>[3]) =>
      withTenant(server.app.db, tenant(), (tx) =>
        service.recordCustomerMessage(tx, tenant(), audit(), input),
      );

    it('moves a pending ticket back to open, masked under the player’s policy', async () => {
      const ticketId = await makeTicket();
      await reply(ticketId, 'Dekont gönderir misiniz?');
      expect((await ticketRow(ticketId)).status).toBe('pending');

      const written = await record({
        ticketId,
        text: 'IBAN: TR33 0006 1005 1978 6457 8413 26, gönderdim.',
        emailMessageId: '<a1@mail.example.test>',
      });

      expect(written.reopened).toBe(false);
      expect(written.message).toMatchObject({
        kind: 'customer_message',
        author_type: 'customer',
        author_id: playerId,
        author_name: 'Ayşe Oyuncu',
      });
      expect(written.message.body_text).not.toContain('1978 6457 8413');
      const ticket = await ticketRow(ticketId);
      expect(ticket.status).toBe('open');
      expect(ticket.lastCustomerMessageAt?.toISOString()).toBe(written.message.created_at);
      expect((await audits('ticket.status_changed')).at(-1)).toMatchObject({
        actorType: 'system',
        metadata: { from: 'pending', to: 'open' },
      });
    });

    it('reopens a solved ticket, leaves a closed one, and lands a merged one’s on its primary', async () => {
      const solved = await makeTicket();
      await reply(solved, 'Çözüldü.', { set_status: 'solved' });
      expect((await record({ ticketId: solved, text: 'Hâlâ olmadı.' })).reopened).toBe(true);
      expect((await ticketRow(solved)).status).toBe('open');

      const closed = await makeTicket();
      await owner.ticket.update({ where: { id: closed }, data: { status: 'closed' } });
      await record({ ticketId: closed, text: 'Yeni bir sorum var.' });
      expect((await ticketRow(closed)).status).toBe('closed');

      const primaryId = await makeTicket();
      const mergedId = await makeTicket();
      await server.post(`/tickets/${mergedId}/merge`, { into: primaryId }, auth(adminToken));
      const landed = await record({ ticketId: mergedId, text: 'Eski talebe yazdım.' });
      expect(landed.message.ticket_id).toBe(primaryId);
    });

    it('is one message when the same e-mail is delivered twice', async () => {
      const ticketId = await makeTicket();
      const input = { ticketId, text: 'Merhaba', emailMessageId: '<twice@mail.example.test>' };

      const first = await record(input);
      const again = await record(input);

      expect(again.replayed).toBe(true);
      expect(again.message.id).toBe(first.message.id);
      expect(again.push).toBeNull();
      expect(await owner.ticketMessage.count({ where: { ticketId } })).toBe(1);
    });
  });

  // =========================================================================
  // The request's shape
  // =========================================================================

  it('refuses a composer request outside the contract', async () => {
    const ticketId = await makeTicket();
    const base = { kind: 'note', text: 'Geçerli', idempotency_key: freshKey() };
    const cases: Array<Record<string, unknown>> = [
      { ...base, text: '   ' },
      { ...base, text: 'x'.repeat(TICKET_MESSAGE_TEXT_MAX + 1) },
      { ...base, kind: 'email' },
      { ...base, set_status: 'closed' },
      { kind: 'note', text: 'Anahtarsız' },
      { ...base, idempotency_key: '' },
      { ...base, attachment_keys: Array.from({ length: 11 }, (_, i) => `k${i}`) },
    ];
    for (const body of cases) {
      const response = await write(ticketId, body);
      expect(response.statusCode, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect(await owner.ticketMessage.count({ where: { ticketId } })).toBe(0);
  });
});
