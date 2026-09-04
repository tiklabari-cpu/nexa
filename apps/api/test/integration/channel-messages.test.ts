/**
 * The channel message log, read (M-CHOBS-a · FR-MOD-08.5.4).
 *
 * `channel_messages` has had a writer since the adapters landed and, until this
 * endpoint, no reader at all. That gap was not cosmetic. `dispatchAgentReply`
 * swallows a provider failure on purpose — a customer's outage must not fail
 * the agent's request — so the row it writes is the *only* evidence a reply
 * actually left, and an operator asked "did that answer go out?" had nothing
 * short of a psql prompt to answer with. e2e had the same problem from the
 * other side: it can drive the console but never see the provider, so
 * `channels.spec.ts` asserted the composer and stopped.
 *
 * So the first block below is the observation claim itself, driven the way a
 * real message travels: connect → provider webhook → agent replies in the
 * console → the endpoint shows both halves, with the provider's own message id
 * on the outbound one. Everything after it is the read surface's own contract —
 * filters, keyset paging, isolation, scope — and the last block measures that
 * the query sits on the two indexes the table already has.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@nexa/types';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface MessageItem {
  id: string;
  direction: string;
  external_id: string;
  chat_id: string | null;
  text: string | null;
  provider_message_id: string | null;
  created_at: string;
}

interface MessagePage {
  items: MessageItem[];
  next_page_id?: string;
}

/**
 * The Messenger shapes, as `channels-adapters.test.ts` uses them. The read
 * surface is channel-agnostic, so one channel drives it and a second one is
 * connected only to prove the `:type` segment actually narrows.
 */
const PAGE_ID = '100000000000021';
const SENDER = 'psid_reader_alpha';

describe('channel message log (FR-MOD-08.5.4)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminA: string;
  let readA: string;
  let adminB: string;
  let chatAgentA: string;
  let noChannelScope: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  /** A team + fallback rule so a routed chat lands somewhere, per tenant. */
  async function seedTeam(licenseId: bigint, agentId: string): Promise<void> {
    const group = await owner.group.create({
      data: { licenseId, name: 'Support' },
      select: { id: true },
    });
    await owner.groupAgent.create({
      data: { licenseId, groupId: group.id, agentId, priority: 'normal' },
    });
    await owner.routingRule.create({
      data: { licenseId, kind: 'chat', isFallback: true, targetGroupId: group.id },
    });
  }

  /**
   * A log row written straight through the owner client. Used only by the
   * mechanical blocks (filters, paging, isolation): those need a known number
   * of rows at known timestamps, which the real pipeline cannot give — it
   * stamps `now()`. The observation block above them drives the real path.
   */
  async function seedMessage(
    licenseId: bigint,
    row: {
      channelType?: string;
      direction: 'inbound' | 'outbound';
      externalId?: string;
      chatId?: string | null;
      text?: string;
      providerMessageId?: string | null;
      createdAt: Date;
    },
  ): Promise<string> {
    const created = await owner.channelMessage.create({
      data: {
        licenseId,
        channelType: row.channelType ?? 'messenger',
        direction: row.direction,
        externalId: row.externalId ?? SENDER,
        chatId: row.chatId ?? null,
        text: row.text ?? 'seeded',
        providerMessageId: row.providerMessageId ?? null,
        createdAt: row.createdAt,
      },
      select: { id: true },
    });
    return created.id;
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
    await clearRateLimits(server.app);
    // A channel belongs to a brand (brand_id is NOT NULL); connecting with no
    // `X-Nexa-Brand` falls back to the license default, so each tenant needs one.
    await owner.brand.createMany({
      data: [
        { licenseId: fx.a.licenseId, name: 'Default', slug: 'default', isDefault: true },
        { licenseId: fx.b.licenseId, name: 'Default', slug: 'default', isDefault: true },
      ],
    });
    await seedTeam(fx.a.licenseId, fx.a.agentAccountId);
    await seedTeam(fx.b.licenseId, fx.b.agentAccountId);

    adminA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['channels--all:rw'],
    });
    readA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['channels--all:ro'],
    });
    adminB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['channels--all:rw'],
    });
    chatAgentA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw'],
    });
    // Broad on the inbox, empty on channels — the token an inbox integration
    // would hold, and the one that must not reach customer message text through
    // this door.
    noChannelScope = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'customers:rw'],
    });
  });

  const connect = (type: string, body: Record<string, unknown>, token = adminA) =>
    server.post(`/channels/${type}/connect`, body, auth(token));
  const messengerConnect = (address: string) => ({
    code: 'AQD_mock_oauth_code',
    page_id: address,
    page_name: 'Acme',
  });
  const inbound = (address: string, sender: string, text: string) =>
    server.post('/channels/messenger/webhook', {
      recipient: { id: address },
      sender: { id: sender, name: 'Dana Reader' },
      message: { text },
    });
  const listRaw = (query = '', token = readA, type = 'messenger') =>
    server.get(`/channels/${type}/messages${query}`, auth(token));
  const list = async (query = '', token = readA, type = 'messenger'): Promise<MessagePage> => {
    const res = await listRaw(query, token, type);
    expect(res.statusCode).toBe(200);
    return res.json() as MessagePage;
  };

  // --- The debt this endpoint exists to pay ---------------------------------

  describe('observability of a real delivery', () => {
    it('shows the customer message and the console reply that answered it', async () => {
      await connect('messenger', messengerConnect(PAGE_ID));
      const chat = (await inbound(PAGE_ID, SENDER, 'my order is late')).json() as {
        chat_id: string;
      };

      const posted = await server.post(
        `/chats/${chat.chat_id}/events`,
        { type: 'message', text: 'checking that for you now', recipients: 'all' },
        auth(chatAgentA),
      );
      expect(posted.statusCode).toBe(201);

      const page = await list();
      expect(page.items).toHaveLength(2);
      // Newest first: the reply, then what it answered.
      expect(page.items[0]).toMatchObject({
        direction: 'outbound',
        external_id: SENDER,
        chat_id: chat.chat_id,
        text: 'checking that for you now',
      });
      // Set only by the adapter's `send` — this is the field that makes the
      // endpoint an answer to "did it actually leave" rather than "was a row
      // written". `dispatchAgentReply` swallows a provider failure, so without
      // it a silent outage would look identical to a delivery.
      expect(page.items[0]!.provider_message_id).toBeTruthy();
      expect(page.items[1]).toMatchObject({
        direction: 'inbound',
        external_id: SENDER,
        chat_id: chat.chat_id,
        text: 'my order is late',
        provider_message_id: null,
      });
    });

    it('keeps the log readable after the channel is disconnected', async () => {
      // Disconnect stops new traffic; it must not erase the history somebody
      // may be asked about later. The disconnect contract says the rows are
      // kept — this is the surface that makes that claim checkable.
      await connect('messenger', messengerConnect(PAGE_ID));
      await inbound(PAGE_ID, SENDER, 'before the lights went out');
      expect(
        (await server.post('/channels/messenger/disconnect', undefined, auth(adminA))).statusCode,
      ).toBe(204);

      const page = await list();
      expect(page.items).toHaveLength(1);
      expect(page.items[0]!.text).toBe('before the lights went out');
    });

    it('returns text already card-masked, because that is how it was stored (FR-MOD-08.9.5)', async () => {
      // The mask happens on the way in, before anything reads the message; the
      // reader adds no second filter. Asserted here so a future change that
      // moved masking to render time would fail loudly rather than quietly
      // opening a new door onto a raw PAN.
      await connect('messenger', messengerConnect(PAGE_ID));
      await inbound(PAGE_ID, SENDER, 'my card is 4111111111111111');

      const page = await list();
      expect(page.items[0]!.text).toBe('my card is **** **** **** 1111');
    });
  });

  // --- Isolation and refusal (NFR-S5) ---------------------------------------

  describe('isolation and scope (NFR-S5)', () => {
    it('never returns another workspace of the same channel', async () => {
      const mine = await seedMessage(fx.a.licenseId, {
        direction: 'inbound',
        text: 'mine',
        createdAt: new Date('2026-03-01T10:00:00Z'),
      });
      await seedMessage(fx.b.licenseId, {
        direction: 'inbound',
        text: 'theirs',
        createdAt: new Date('2026-03-01T11:00:00Z'),
      });

      const page = await list();
      expect(page.items.map((item) => item.id)).toEqual([mine]);

      // And symmetrically, so a passing assertion cannot mean "B has nothing".
      const other = await list('', adminB);
      expect(other.items.map((item) => item.text)).toEqual(['theirs']);
    });

    it('answers an empty page — not a 403 — for another workspace chat id', async () => {
      // The id says nothing back. A 403 here would confirm the chat exists
      // somewhere and turn the filter into an enumeration oracle.
      await connect('messenger', messengerConnect(PAGE_ID));
      await inbound(PAGE_ID, SENDER, 'hello');
      const theirs = await owner.chat.create({
        data: {
          id: generateShortId(),
          licenseId: fx.b.licenseId,
          customerId: fx.b.customerId,
          active: true,
        },
        select: { id: true },
      });
      await seedMessage(fx.b.licenseId, {
        direction: 'inbound',
        chatId: theirs.id,
        createdAt: new Date('2026-03-01T11:00:00Z'),
      });

      const page = await list(`?chat_id=${theirs.id}`);
      expect(page.items).toEqual([]);
      expect(page.next_page_id).toBeUndefined();
    });

    it('refuses a token without a channel scope, and admits the read scope alone', async () => {
      await seedMessage(fx.a.licenseId, {
        direction: 'inbound',
        createdAt: new Date('2026-03-01T10:00:00Z'),
      });
      expect((await listRaw('', noChannelScope)).statusCode).toBe(403);
      // `:ro` is enough — the surface reads, it does not send.
      expect((await listRaw('', readA)).statusCode).toBe(200);
      // …and the write scope subsumes it, the same pair `GET /channels` takes.
      expect((await listRaw('', adminA)).statusCode).toBe(200);
    });

    it('404s a channel type with no adapter, and 401s without a token', async () => {
      expect((await listRaw('', readA, 'email')).statusCode).toBe(404);
      expect((await server.get('/channels/messenger/messages')).statusCode).toBe(401);
    });
  });

  // --- Filters ---------------------------------------------------------------

  describe('filters', () => {
    beforeEach(async () => {
      await seedMessage(fx.a.licenseId, {
        direction: 'inbound',
        text: 'messenger in',
        createdAt: new Date('2026-03-01T09:00:00Z'),
      });
      await seedMessage(fx.a.licenseId, {
        direction: 'outbound',
        text: 'messenger out',
        providerMessageId: 'mid_1',
        createdAt: new Date('2026-03-02T09:00:00Z'),
      });
      await seedMessage(fx.a.licenseId, {
        channelType: 'whatsapp',
        direction: 'inbound',
        text: 'whatsapp in',
        createdAt: new Date('2026-03-03T09:00:00Z'),
      });
    });

    it('narrows to the channel the path names', async () => {
      // The one filter that is not optional: `whatsapp` traffic must not show
      // up under `/channels/messenger/messages`, however the workspace pages.
      expect((await list()).items.map((item) => item.text)).toEqual([
        'messenger out',
        'messenger in',
      ]);
      expect((await list('', readA, 'whatsapp')).items.map((item) => item.text)).toEqual([
        'whatsapp in',
      ]);
    });

    it('narrows by direction', async () => {
      expect((await list('?direction=outbound')).items.map((item) => item.text)).toEqual([
        'messenger out',
      ]);
      expect((await list('?direction=inbound')).items.map((item) => item.text)).toEqual([
        'messenger in',
      ]);
    });

    it('narrows by chat', async () => {
      const chat = await owner.chat.create({
        data: {
          id: generateShortId(),
          licenseId: fx.a.licenseId,
          customerId: fx.a.customerId,
          active: true,
        },
        select: { id: true },
      });
      await seedMessage(fx.a.licenseId, {
        direction: 'outbound',
        text: 'on that chat',
        chatId: chat.id,
        createdAt: new Date('2026-03-04T09:00:00Z'),
      });

      expect((await list(`?chat_id=${chat.id}`)).items.map((item) => item.text)).toEqual([
        'on that chat',
      ]);
    });

    it('narrows by date range, on both sides and either alone', async () => {
      expect((await list('?date_from=2026-03-02T00:00:00Z')).items.map((i) => i.text)).toEqual([
        'messenger out',
      ]);
      expect((await list('?date_to=2026-03-01T12:00:00Z')).items.map((i) => i.text)).toEqual([
        'messenger in',
      ]);
      expect(
        (await list('?date_from=2026-03-01T00:00:00Z&date_to=2026-03-01T23:59:59Z')).items.map(
          (i) => i.text,
        ),
      ).toEqual(['messenger in']);
    });

    it('combines filters additively', async () => {
      expect((await list('?direction=inbound&date_from=2026-03-02T00:00:00Z')).items).toEqual([]);
      expect(
        (await list('?direction=outbound&date_from=2026-03-02T00:00:00Z')).items.map((i) => i.text),
      ).toEqual(['messenger out']);
    });

    it('rejects a bad filter rather than answering an empty list', async () => {
      // A typo that returned `[]` would read as "nothing crossed this channel",
      // which is the wrong answer to a question about delivery.
      expect((await listRaw('?direction=sideways')).statusCode).toBe(400);
      expect((await listRaw('?limit=0')).statusCode).toBe(400);
      expect((await listRaw('?limit=2.5')).statusCode).toBe(400);
      expect((await listRaw('?date_from=not-a-date')).statusCode).toBe(400);
      expect(
        (await listRaw('?date_from=2026-03-05T00:00:00Z&date_to=2026-03-01T00:00:00Z')).statusCode,
      ).toBe(400);
    });
  });

  // --- Keyset paging ---------------------------------------------------------

  describe('paging', () => {
    /** Five rows one minute apart, newest last. */
    async function seedFive(): Promise<string[]> {
      const ids: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        ids.push(
          await seedMessage(fx.a.licenseId, {
            direction: index % 2 === 0 ? 'inbound' : 'outbound',
            text: `m${index}`,
            createdAt: new Date(Date.UTC(2026, 2, 1, 10, index)),
          }),
        );
      }
      return ids;
    }

    it('walks the whole log in pages, without a gap or a repeat', async () => {
      const ids = await seedFive();
      const seen: string[] = [];
      let cursor: string | undefined;
      let guard = 0;
      do {
        const page: MessagePage = await list(
          `?limit=2${cursor ? `&page_id=${encodeURIComponent(cursor)}` : ''}`,
        );
        expect(page.items.length).toBeLessThanOrEqual(2);
        seen.push(...page.items.map((item) => item.id));
        cursor = page.next_page_id;
        guard += 1;
      } while (cursor && guard < 10);

      expect(cursor).toBeUndefined();
      expect(seen).toEqual([...ids].reverse());
      expect(new Set(seen).size).toBe(5);
    });

    it('does not shift under a writer, which is why the cursor is not an offset', async () => {
      const ids = await seedFive();
      const first = await list('?limit=2');
      expect(first.items.map((item) => item.id)).toEqual([ids[4], ids[3]]);

      // A message arrives between the two reads — with an offset page, `m2`
      // would be pushed past the window and never seen.
      await seedMessage(fx.a.licenseId, {
        direction: 'inbound',
        text: 'arrived mid-read',
        createdAt: new Date(Date.UTC(2026, 2, 1, 10, 30)),
      });

      const second = await list(`?limit=2&page_id=${encodeURIComponent(first.next_page_id!)}`);
      expect(second.items.map((item) => item.id)).toEqual([ids[2], ids[1]]);
    });

    it('carries the filter across pages rather than widening on page two', async () => {
      await seedFive();
      const first = await list('?direction=inbound&limit=1');
      expect(first.items.map((item) => item.text)).toEqual(['m4']);
      const second = await list(
        `?direction=inbound&limit=1&page_id=${encodeURIComponent(first.next_page_id!)}`,
      );
      expect(second.items.map((item) => item.text)).toEqual(['m2']);
    });

    it('clamps an over-large limit and starts over on a stale cursor', async () => {
      const ids = await seedFive();
      // Clamped, not refused: the caller gets the maximum page.
      expect((await list('?limit=5000')).items).toHaveLength(5);
      // A cursor from another deployment (or a truncated one) is a stale
      // bookmark, not an error — the reader starts at the top.
      const stale = await list('?page_id=not-a-cursor');
      expect(stale.items.map((item) => item.id)).toEqual([...ids].reverse());
    });

    it('omits next_page_id on the last page', async () => {
      await seedFive();
      const page = await list('?limit=100');
      expect(page.items).toHaveLength(5);
      expect(page.next_page_id).toBeUndefined();
    });
  });

  // --- The query sits on the indexes the table already has -------------------

  describe('read budget (NFR-P2)', () => {
    it('serves both filter shapes from the existing indexes, with no new one (EXPLAIN ANALYZE)', async () => {
      // Enough rows, across two channels and two tenants, that the planner has
      // a real choice to make — on a handful of rows every plan is a sequential
      // scan and the probe would prove nothing.
      const chat = await owner.chat.create({
        data: {
          id: generateShortId(),
          licenseId: fx.a.licenseId,
          customerId: fx.a.customerId,
          active: true,
        },
        select: { id: true },
      });
      const base = Date.UTC(2026, 2, 1, 0, 0);
      const rows = [];
      for (let index = 0; index < 4000; index += 1) {
        rows.push({
          licenseId: index % 4 === 3 ? fx.b.licenseId : fx.a.licenseId,
          channelType: index % 2 === 0 ? 'messenger' : 'whatsapp',
          direction: index % 3 === 0 ? 'outbound' : 'inbound',
          externalId: SENDER,
          // A conversation is a handful of messages inside a channel's whole
          // history, not a fifth of it. Seeding it the other way round makes
          // the chat filter look unselective and changes which plan the probe
          // is measuring — which is what happened the first time this was run.
          chatId: index % 800 === 0 ? chat.id : null,
          text: `row ${index}`,
          createdAt: new Date(base + index * 60_000),
        });
      }
      await owner.channelMessage.createMany({ data: rows });
      // Without fresh statistics the planner is costing a table it believes is
      // empty, so the plan below would be an artefact of the fixture rather
      // than of the query.
      await owner.$executeRawUnsafe('ANALYZE channel_messages');

      // The two shapes the route produces, written out rather than captured
      // from Prisma: this is a probe of the *index*, and the concrete SQL is
      // what makes the plan readable in a failure. Kept in step with
      // `ChannelService.listMessages` deliberately — the functional tests above
      // are what guard the behaviour.
      const queries: Record<string, string> = {
        // The base list: the `(license_id, channel_type, created_at)` index.
        by_channel: `SELECT id, direction, external_id, chat_id, text, provider_message_id, created_at
          FROM channel_messages
          WHERE license_id = $1 AND channel_type = 'messenger'
            AND created_at >= TIMESTAMPTZ '2026-03-01T00:00:00Z'
            AND created_at <= TIMESTAMPTZ '2026-03-05T00:00:00Z'
          ORDER BY created_at DESC, id DESC LIMIT 26`,
        // The chat filter: the `(license_id, chat_id)` index.
        by_chat: `SELECT id, direction, external_id, chat_id, text, provider_message_id, created_at
          FROM channel_messages
          WHERE license_id = $1 AND channel_type = 'messenger' AND chat_id = $2
          ORDER BY created_at DESC, id DESC LIMIT 26`,
      };

      const NFR_P2_READ_BUDGET_MS = 150;
      const timings: Record<string, number> = {};
      const plans: Record<string, string> = {};
      for (const [name, sql] of Object.entries(queries)) {
        const [row] = await owner.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`,
          fx.a.licenseId,
          chat.id,
        );
        const raw = row?.['QUERY PLAN'];
        const plan = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Array<{
          'Execution Time': number;
          Plan: unknown;
        }>;
        timings[name] = plan[0]?.['Execution Time'] ?? Number.NaN;
        plans[name] = JSON.stringify(plan[0]?.Plan ?? {});
      }

      // Both measured — a silently-skipped query would leave the budget unproven.
      expect(Object.keys(timings)).toEqual(['by_channel', 'by_chat']);
      for (const name of Object.keys(queries)) {
        expect(timings[name]).toBeLessThan(NFR_P2_READ_BUDGET_MS);
        // The point of the probe: an index, not a scan of every message the
        // workspace ever exchanged. Naming the index is what makes a dropped
        // one fail here instead of turning into a slow endpoint in production.
        expect(plans[name]).not.toContain('"Seq Scan"');
      }
      // Measured on this fixture (4.000 rows, two tenants, two channels):
      // by_channel 0,068 ms · by_chat 0,052 ms. Both existing indexes carry
      // their shape, so M-CHOBS-a adds none — which was the thing to check
      // before reaching for a third.
      //
      // The two plans differ, and the difference is the interesting part. The
      // base list is an Index Scan Backward on the ordering index plus an
      // Incremental Sort for the `id` tiebreak — the sort key is already
      // mostly satisfied, so `LIMIT` stops early. The chat filter instead
      // takes the chat index and sorts what comes back, which is cheap
      // precisely because a conversation is small.
      expect(plans['by_channel']).toContain(
        'channel_messages_license_id_channel_type_created_at_idx',
      );
      expect(plans['by_chat']).toContain('channel_messages_license_id_chat_id_idx');
    });
  });
});
