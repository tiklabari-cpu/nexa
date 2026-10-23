/**
 * Direct lookup by number, e-mail or username (tm 332 · SiyahTuş analysis
 * ID-06): `GET /search`.
 *
 * The palette used to match conversations in the browser against the fifty
 * newest it had fetched. The suite holds the server lookup to what that could
 * not do, and to what it must not leak:
 *
 *   - a day number, a connection number and a message number each find their
 *     conversation — older than the fifty newest;
 *   - a member's UUID, exact e-mail and username (any case) find the member;
 *   - a ticket number finds the ticket;
 *   - another team's number answers exactly what a number that does not exist
 *     answers, and so does another workspace's (NFR-S5);
 *   - without `customers.contact.view` e-mail and username are neither shown
 *     nor searched;
 *   - every kind waits on its own read scope;
 *   - the request log masks the query, and the username lookup is served by
 *     its index under row level security.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId, type CapabilityOverride, type SearchResult } from '@siyahtus/types';
import { withTenant } from '../../src/lib/tenant.js';
import { EXACT_USERNAME_SQL } from '../../src/services/search/lookup.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Headers = Record<string, string>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('direct lookup by number, e-mail or username (ID-06 · tm 332)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agent: Headers;
  let founder: Headers;
  let finance: bigint;
  let rg: bigint;

  const bearer = (token: string): Headers => ({ authorization: `Bearer ${token}` });

  async function token(t: TenantFixture, ownerId: string, scopes: string[]): Promise<Headers> {
    return bearer(
      await grantToken(owner, {
        licenseId: t.licenseId,
        organizationId: t.organizationId,
        ownerId,
        scopes,
      }),
    );
  }

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    server.app.permissionMatrix.cache.invalidate();
    await clearRateLimits(server.app);
    finance = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Finans' },
        select: { id: true },
      })
    ).id;
    rg = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Sorumlu Oyun' },
        select: { id: true },
      })
    ).id;
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: finance, agentId: fx.a.agentAccountId },
    });
    // A Team Member: their team's conversations and tickets, every member.
    agent = await token(fx.a, fx.a.agentAccountId, [
      'chats--access:ro',
      'tickets--access:ro',
      'customers:ro',
    ]);
    founder = await token(fx.a, fx.a.ownerAccountId, [
      'chats--all:ro',
      'tickets--all:ro',
      'customers:ro',
      'access_rules:rw',
    ]);
  });

  async function player(
    t: TenantFixture,
    data: Partial<{ name: string; email: string; username: string; phone: string }> = {},
  ): Promise<string> {
    const row = await owner.customer.create({
      data: { organizationId: t.organizationId, ...data },
      select: { id: true },
    });
    return row.id;
  }

  /** One day with one connection and one message, visible to `groupId`'s team. */
  async function conversation(
    t: TenantFixture,
    opts: { customerId: string; groupId?: bigint; at?: Date },
  ): Promise<{ chatId: string; threadId: string; eventId: string }> {
    const at = opts.at ?? new Date(Date.now() - HOUR);
    const chatId = generateShortId();
    const threadId = generateShortId();
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: t.licenseId,
        customerId: opts.customerId,
        active: false,
        createdAt: at,
        lastEventAt: at,
      },
    });
    if (opts.groupId !== undefined) {
      await owner.chatAccess.create({ data: { chatId, groupId: opts.groupId } });
    }
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: t.licenseId,
        active: false,
        createdAt: at,
        closedAt: at,
        groupId: opts.groupId ?? null,
      },
    });
    const eventId = `${threadId}_1`;
    await owner.event.create({
      data: {
        id: eventId,
        threadId,
        chatId,
        licenseId: t.licenseId,
        type: 'message',
        text: 'Çekimim nerede?',
        authorId: opts.customerId,
        authorType: 'customer',
        createdAt: at,
      },
    });
    return { chatId, threadId, eventId };
  }

  async function search(
    query: string,
    auth: Headers = agent,
    extra = '',
  ): Promise<{ status: number; body: string; items: SearchResult[] }> {
    const res = await server.get(`/search?query=${encodeURIComponent(query)}${extra}`, auth);
    const json = res.statusCode === 200 ? (res.json() as { items: SearchResult[] }) : null;
    return { status: res.statusCode, body: res.body, items: json?.items ?? [] };
  }

  // =========================================================================

  it('finds the day by its number, the connection by its, and the message by its — older than the fifty newest (FR-MOD-01.1.3)', async () => {
    const customerId = await player(fx.a, { name: 'Ada Oyuncu' });
    const old = await conversation(fx.a, {
      customerId,
      groupId: finance,
      at: new Date(Date.now() - 40 * DAY),
    });
    // Fifty-five newer conversations push it out of the inbox's first page.
    const other = await player(fx.a, { name: 'Başka Oyuncu' });
    await owner.chat.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        id: generateShortId(),
        licenseId: fx.a.licenseId,
        customerId: other,
        active: false,
        createdAt: new Date(Date.now() - (i + 1) * HOUR),
        lastEventAt: new Date(Date.now() - (i + 1) * HOUR),
      })),
    });
    const firstPage = await server.get('/chats?view=all&limit=50', founder);
    expect(firstPage.statusCode).toBe(200);
    const listed = (firstPage.json() as { items: Array<{ id: string }> }).items.map((c) => c.id);
    expect(listed).not.toContain(old.chatId);

    const day = await search(old.chatId);
    expect(day.status).toBe(200);
    expect(day.items[0]).toEqual({
      kind: 'chat',
      chat_id: old.chatId,
      title: 'Ada Oyuncu',
      subtitle: null,
      at: expect.any(String),
      matched_on: 'chat_id',
    });

    const connection = await search(old.threadId);
    expect(connection.items[0]).toMatchObject({
      kind: 'connection',
      chat_id: old.chatId,
      thread_id: old.threadId,
      matched_on: 'thread_id',
    });

    // Pasted with the newline a copy drags along.
    const message = await search(`${old.eventId}\n`);
    expect(message.items).toEqual([
      expect.objectContaining({
        kind: 'event',
        chat_id: old.chatId,
        thread_id: old.threadId,
        event_id: old.eventId,
        title: 'Ada Oyuncu',
        matched_on: 'event_id',
      }),
    ]);

    // A message number of a real connection but no such message is no match.
    expect((await search(`${old.threadId}_99`)).items).toEqual([]);
  });

  it("answers another team's number exactly as it answers a number that does not exist (NFR-S5)", async () => {
    const customerId = await player(fx.a, { name: 'Gizli Oyuncu' });
    const hidden = await conversation(fx.a, { customerId, groupId: rg });

    const missing = await search(generateShortId());
    for (const id of [hidden.chatId, hidden.threadId]) {
      const res = await search(id);
      expect(res.status).toBe(200);
      expect(res.body).toBe(missing.body);
    }
    const missingEvent = await search(`${generateShortId()}_1`);
    const hiddenEvent = await search(hidden.eventId);
    expect(hiddenEvent.body).toBe(missingEvent.body);
    expect(hiddenEvent.body).toBe('{"items":[]}');

    // The Founder reaches every team; a Team Member reaches a conversation
    // handed to them personally, team or not.
    expect((await search(hidden.chatId, founder)).items).toHaveLength(1);
    await owner.chatUser.create({
      data: { chatId: hidden.chatId, userId: fx.a.agentAccountId, userType: 'agent' },
    });
    expect((await search(hidden.eventId)).items).toHaveLength(1);
  });

  it("never finds another workspace's conversation, member or ticket (NFR-S5)", async () => {
    const theirs = await player(fx.b, {
      name: 'Öteki Oyuncu',
      email: 'oteki@example.test',
      username: 'oteki_9',
    });
    const conv = await conversation(fx.b, { customerId: theirs });
    const ticketId = generateShortId();
    await owner.ticket.create({
      data: { id: ticketId, licenseId: fx.b.licenseId, subject: 'Öteki talep', customerId: theirs },
    });

    for (const query of [
      conv.chatId,
      conv.threadId,
      conv.eventId,
      theirs,
      'oteki@example.test',
      'oteki_9',
      'Öteki',
      ticketId,
    ]) {
      const res = await search(query, founder);
      expect(res.status, query).toBe(200);
      expect(res.items, query).toEqual([]);
    }
  });

  it('finds a member by UUID, by exact e-mail in any case, and by username in any case (FR-MOD-01.1.3)', async () => {
    const id = await player(fx.a, {
      name: 'Mira Hanım',
      email: 'Mira.H@Example.test',
      username: 'MiraH_92',
    });
    // A neighbour whose address only contains the searched one.
    await player(fx.a, { name: 'Komşu', email: 'xmira.h@example.test.tr' });

    expect((await search(id.toUpperCase())).items).toEqual([
      {
        kind: 'customer',
        customer_id: id,
        title: 'Mira Hanım',
        subtitle: 'Mira.H@Example.test',
        at: null,
        matched_on: 'customer_id',
      },
    ]);
    // `customers.id` is a uuid column: an upper-case paste still finds it.

    const byEmail = await search('mira.h@example.TEST');
    expect(byEmail.items.map((r) => [r.customer_id, r.matched_on])).toEqual([[id, 'email']]);

    const byUsername = await search('  miraH_92 ');
    expect(byUsername.items[0]).toMatchObject({ customer_id: id, matched_on: 'username' });
    expect(byUsername.items.filter((r) => r.customer_id === id)).toHaveLength(1);

    // A prefix and a name go through the Contacts search.
    expect((await search('mirah')).items[0]).toMatchObject({
      customer_id: id,
      matched_on: 'username',
    });
    expect((await search('Hanım')).items[0]).toMatchObject({ customer_id: id, matched_on: 'name' });
  });

  it('neither shows nor searches e-mail and username without customers.contact.view (FR-MOD-04.RBAC)', async () => {
    const hide: CapabilityOverride = {
      role: 'agent',
      capability: 'customers.contact.view',
      value: 'off',
    };
    const put = await server.put(
      '/settings/permissions',
      { changes: [hide], reason: 'Oyuncu verisi yalnız yöneticilerde' },
      founder,
    );
    expect(put.statusCode, put.body).toBe(200);

    const id = await player(fx.a, {
      name: 'Saklı Oyuncu',
      email: 'sakli@example.test',
      username: 'sakli_332',
    });

    expect((await search('sakli@example.test')).items).toEqual([]);
    expect((await search('sakli_332')).items).toEqual([]);
    const byId = await search(id);
    expect(byId.items).toEqual([
      expect.objectContaining({ customer_id: id, title: 'Saklı Oyuncu', subtitle: null }),
    ]);
    const byName = await search('Saklı');
    expect(byName.items[0]).toMatchObject({ customer_id: id, subtitle: null });
    expect(byName.body.toLowerCase()).not.toContain('sakli@');
    expect(byName.body.toLowerCase()).not.toContain('sakli_332');

    // The Founder's role is locked and still sees both.
    expect((await search('sakli_332', founder)).items[0]).toMatchObject({
      customer_id: id,
      subtitle: 'sakli@example.test',
    });
  });

  it("finds a ticket by its number and subject, within the caller's teams", async () => {
    const customerId = await player(fx.a, { name: 'Bilet Sahibi' });
    const ours = generateShortId();
    const theirs = generateShortId();
    await owner.ticket.createMany({
      data: [
        {
          id: ours,
          licenseId: fx.a.licenseId,
          subject: 'Papara çekimi gecikti',
          customerId,
          groupId: finance,
        },
        { id: theirs, licenseId: fx.a.licenseId, subject: 'Limit talebi', groupId: rg },
      ],
    });

    expect((await search(ours)).items).toEqual([
      {
        kind: 'ticket',
        ticket_id: ours,
        customer_id: customerId,
        title: 'Papara çekimi gecikti',
        subtitle: 'Bilet Sahibi',
        at: expect.any(String),
        matched_on: 'ticket_id',
      },
    ]);
    expect((await search(theirs)).body).toBe((await search(generateShortId())).body);
    expect((await search(theirs, founder)).items).toHaveLength(1);

    expect((await search('papara')).items).toEqual([
      expect.objectContaining({ kind: 'ticket', ticket_id: ours, matched_on: 'subject' }),
    ]);
  });

  it('waits on each kind’s own read scope, and refuses a token that reads none of them', async () => {
    const customerId = await player(fx.a, { name: 'Kapsam Oyuncu' });
    const conv = await conversation(fx.a, { customerId, groupId: finance });

    const customersOnly = await token(fx.a, fx.a.ownerAccountId, ['customers:ro']);
    expect((await search(conv.chatId, customersOnly)).items).toEqual([]);
    expect((await search(customerId, customersOnly)).items).toHaveLength(1);

    const chatsOnly = await token(fx.a, fx.a.ownerAccountId, ['chats--all:ro']);
    expect((await search(conv.chatId, chatsOnly)).items).toHaveLength(1);
    expect((await search(customerId, chatsOnly)).items).toEqual([]);

    const types = await search(conv.threadId, founder, '&types=chat,customer');
    expect(types.items).toEqual([]);

    const reportsOnly = await token(fx.a, fx.a.ownerAccountId, ['reports_read']);
    expect((await search(conv.chatId, reportsOnly)).status).toBe(403);
  });

  it('rejects an empty query, an unknown kind and an oversized limit', async () => {
    expect((await server.get('/search', founder)).statusCode).toBe(400);
    expect((await search('   ', founder)).status).toBe(400);
    expect((await search('x', founder, '&types=chat,players')).status).toBe(400);
    expect((await search('x', founder, '&limit=21')).status).toBe(400);
    expect((await search('x'.repeat(201), founder)).status).toBe(400);
  });

  it('serves the exact-username lookup out of its index under row level security (EXPLAIN ANALYZE)', async () => {
    await owner.customer.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        organizationId: fx.a.organizationId,
        name: `Arama ${i}`,
        username: i === 0 ? 'Kral_332' : `oyuncu_${i}`,
      })),
    });
    // As `siyahtus_app` in the tenant context, on a private client so the
    // `enable_seqscan` pin cannot reach another test through the plan cache.
    const appRole = new PrismaClient({ datasourceUrl: process.env['DATABASE_APP_URL'] });
    try {
      const plan = await withTenant(
        appRole,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
          const [row] = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `EXPLAIN (ANALYZE, FORMAT JSON) ${EXACT_USERNAME_SQL}`,
            fx.a.organizationId,
            ' KRAL_332 ',
            10,
          );
          const raw = row?.['QUERY PLAN'];
          const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Array<
            Record<string, unknown>
          >;
          return parsed[0] ?? {};
        },
      );
      const text = JSON.stringify(plan['Plan'] ?? {});
      expect(text).toContain('customers_organization_id_username_normalized_idx');
      expect(text).toMatch(/"Index Cond":"[^"]*username_normalized/);
    } finally {
      await appRole.$disconnect();
    }
  });
});

/** Collects the lines pino actually wrote, so the assertion is on output. */
class LineSink {
  readonly lines: string[] = [];
  write(chunk: string): boolean {
    this.lines.push(chunk);
    return true;
  }
  end(): void {}
  on(): void {}
  once(): void {}
  emit(): boolean {
    return false;
  }
}

describe('the searched value in the request log (ID-06 · tm 332)', () => {
  let owner: PrismaClient;
  let server: TestServer | undefined;

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('is written as query=[redacted], never as typed (NFR-S9)', async () => {
    const sink = new LineSink();
    server = await startTestServer(
      { LOG_LEVEL: 'trace' },
      { logStream: sink as unknown as NodeJS.WritableStream },
    );
    const fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    const auth = {
      authorization: `Bearer ${await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['customers:ro'],
      })}`,
    };

    const typed = 'kral_oyuncu_4417';
    const res = await server.get(`/search?query=${typed}&limit=5`, auth);
    expect(res.statusCode).toBe(200);

    const written = sink.lines.join('\n');
    expect(written).toContain('/search');
    expect(written).toContain('query=[redacted]');
    expect(written).not.toContain(typed);
  });
});
