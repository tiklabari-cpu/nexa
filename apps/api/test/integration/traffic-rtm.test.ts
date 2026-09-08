/**
 * The real-time traffic board's liveness signal (FR-MOD-03.1.1).
 *
 * `traffic.test.ts` proves what the board *says*. This proves that the board is
 * told: every write that can move somebody between the funnel states publishes
 * `traffic_visitor_updated` on the licence channel the RTM gateway fans out, so
 * an open board reacts to Browsing → Chatting → Invited instead of waiting for
 * its eight-second poll.
 *
 * Four properties, in the order a defect in them would matter:
 *
 *   1. **It cannot cross a tenant.** A visitor event announced to the wrong
 *      licence is a disclosure, not a stale screen — so the negative comes
 *      first and waits for delivery *somewhere* before concluding it was not
 *      delivered here.
 *   2. **It carries nothing about the visitor.** The audience is every agent in
 *      the licence, which is the reach `GET /traffic` already has; that is only
 *      defensible while the payload is one opaque id and no name, e-mail, page
 *      or referrer. The assertion is on the payload's *exact* key set, so a
 *      later "just add the activity" is a red test rather than a leak.
 *   3. **It is published after the commit.** The board's reaction is to re-read
 *      `GET /traffic`; a signal that outran its own transaction would send it to
 *      fetch the board exactly as it already was, and leave it stale until the
 *      poll — the precise defect this feature exists to remove. Asserted by
 *      reading the board the moment the envelope lands.
 *   4. **Each transition the criterion names actually fires one.**
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  generateShortId,
  licenseChannel,
  type PushAudience,
  type RtmPushAction,
} from '@nexa/types';
import type { TenantContext } from '../../src/lib/tenant.js';
import { ChatService } from '../../src/services/chat/chat-service.js';
import { RealtimePublisher } from '../../src/services/realtime/publisher.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const PUSH = 'traffic_visitor_updated';

/** The app-role connection the service runs its own transactions on. */
const APP_URL = process.env['DATABASE_APP_URL'];

/** `ChatService`'s cache is only consulted on the idempotent send path. */
const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

interface Envelope {
  action: string;
  licenseId: string;
  organizationId: string;
  audience: Record<string, unknown>;
  payload: Record<string, unknown>;
}

interface TrafficRow {
  customer_id: string;
  activity: string;
  chat_id: string | null;
}

describe('real-time traffic — the board is pushed, not only polled (FR-MOD-03.1.1)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let boardToken: string;
  let agentToken: string;

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
    await Promise.all([
      seedDefaultBrand(owner, fx.a.licenseId),
      seedDefaultBrand(owner, fx.b.licenseId),
    ]);
    await clearRateLimits(server.app);

    // A team with an accepting member and a fallback rule, so a widget message
    // becomes a routed, assigned conversation rather than a queued one.
    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: support.id,
        agentId: fx.a.agentAccountId,
        priority: 'normal',
      },
    });
    await owner.routingRule.create({
      data: {
        licenseId: fx.a.licenseId,
        kind: 'chat',
        isFallback: true,
        targetGroupId: support.id,
      },
    });

    // The board's own scopes — `GET /traffic` rides the customer ones.
    boardToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['customers:rw', 'chats--all:rw'],
    });
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['agents--my:rw'],
    });
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  /** A widget bearer token, and the anonymous customer it was minted for. */
  async function widgetToken(
    tenant: TenantFixture = fx.a,
  ): Promise<{ token: string; customer_id: string }> {
    const response = await server.post(
      '/customer/token',
      { organization_id: tenant.organizationId },
      { origin: `https://${tenant.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return response.json() as { token: string; customer_id: string };
  }

  /**
   * Everything published on `licenseId`'s channel while `run` runs.
   *
   * The settle wait is the subscriber's own tick, not the publisher's: the
   * publish completes before the HTTP response returns, but ioredis hands the
   * message to this process a beat later. Same shape as `agent-conflict.test.ts`.
   */
  async function captureBus(licenseId: bigint, run: () => Promise<void>): Promise<Envelope[]> {
    const sub = server.app.redis.duplicate();
    const seen: Envelope[] = [];
    const channel = licenseChannel(licenseId);
    await sub.subscribe(channel);
    sub.on('message', (_channel, raw) => {
      try {
        seen.push(JSON.parse(raw) as Envelope);
      } catch {
        /* not our shape — ignore */
      }
    });
    try {
      await run();
      await new Promise((resolve) => setTimeout(resolve, 200));
    } finally {
      await sub.unsubscribe(channel);
      sub.disconnect();
    }
    return seen;
  }

  const signals = (envelopes: Envelope[]): Envelope[] =>
    envelopes.filter((envelope) => envelope.action === PUSH);

  const about = (envelopes: Envelope[], customerId: string): Envelope[] =>
    signals(envelopes).filter((envelope) => envelope.payload['customer_id'] === customerId);

  /** The board as the caller who is watching it would read it. */
  async function board(): Promise<TrafficRow[]> {
    const response = await server.get('/traffic?limit=100', auth(boardToken));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: TrafficRow[] }).items;
  }

  // =========================================================================
  // 1. The boundary
  // =========================================================================

  it('never announces one licence’s visitor on another licence’s channel (NFR-S4)', async () => {
    const { token, customer_id: customerId } = await widgetToken(fx.a);

    // Both channels are watched across the same window: tenant B must stay
    // silent while tenant A is provably being told.
    const onB = await captureBus(fx.b.licenseId, async () => {
      const onA = await captureBus(fx.a.licenseId, async () => {
        const sent = await server.post(
          '/customer/chat/events',
          { text: 'is anyone there?', url: 'https://shop.example/pricing' },
          auth(token),
        );
        expect(sent.statusCode).toBe(201);
      });
      expect(about(onA, customerId).length).toBeGreaterThan(0);
    });

    expect(signals(onB)).toEqual([]);
  });

  // =========================================================================
  // 2. What travels
  // =========================================================================

  it('carries the customer id and nothing else about the visitor', async () => {
    const { token, customer_id: customerId } = await widgetToken();
    // Facts a careless payload would pick up on its way past: this visitor has
    // a name, an address and a referrer by the time the signal goes out.
    await owner.customer.update({
      where: { id: customerId },
      data: { name: 'Dana Whitfield', email: 'dana@example.test' },
    });

    const envelopes = await captureBus(fx.a.licenseId, async () => {
      const sent = await server.post(
        '/customer/chat/events',
        {
          text: 'hello',
          url: 'https://shop.example/checkout?coupon=SECRET',
          referrer: 'https://ads.example/campaign',
        },
        auth(token),
      );
      expect(sent.statusCode).toBe(201);
    });

    const [first] = about(envelopes, customerId);
    expect(first).toBeDefined();
    expect(Object.keys(first!.payload)).toEqual(['customer_id']);
    // The audience is the reach `GET /traffic` already has: every agent in the
    // licence, and no customer (`side === 'customer'` is only ever addressed by
    // `customerId`, which this envelope does not set).
    expect(first!.audience).toEqual({ allAgents: true });
    expect(first!.licenseId).toBe(fx.a.licenseId.toString());
    expect(first!.organizationId).toBe(fx.a.organizationId);
  });

  // =========================================================================
  // 3. Ordering
  // =========================================================================

  it('publishes only after the commit — the change is readable from another connection', async () => {
    // The strict version of the ordering claim, and the reason it is not simply
    // "subscribe, then read the board": measured on this suite, a signal moved
    // to *before* the whole transaction still passes that test, because the
    // subscriber's own round trip is slower than the commit it is racing. So
    // the observation is taken at the only instant that settles it — inside
    // `publish` itself — and through a **separate Prisma connection**, which by
    // construction cannot see an uncommitted transaction. `true` here means the
    // write was already durable when the signal went out; a publish moved
    // inside `withTenant` reads `false` on the same line.
    const visibleAtPublish: boolean[] = [];
    const app = new PrismaClient({ datasourceUrl: APP_URL });

    class ObservingPublisher extends RealtimePublisher {
      override async publish<P>(
        tenant: TenantContext,
        action: RtmPushAction,
        audience: PushAudience,
        payload: P,
        options: { originConnectionId?: string } = {},
      ): Promise<void> {
        if (action === PUSH) {
          const customerId = (payload as { customer_id: string }).customer_id;
          const chat = await owner.chat.findFirst({
            where: { customerId, active: true },
            select: { id: true },
          });
          visibleAtPublish.push(chat !== null);
        }
        await super.publish(tenant, action, audience, payload, options);
      }
    }

    try {
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Ordering probe' },
        select: { id: true },
      });
      const chats = new ChatService(
        app,
        NO_REDIS,
        new ObservingPublisher(server.app.redis, server.app.log),
      );

      await chats.start(
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        {
          kind: 'agent',
          accountId: fx.a.ownerAccountId,
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          role: 'owner',
          scopes: ['chats--all:rw', 'chats--all:ro'],
          tokenId: 'test-token',
          tokenKind: 'pat',
        },
        { customerId: customer.id, assignToMe: true },
      );

      expect(visibleAtPublish).toEqual([true]);
    } finally {
      await app.$disconnect();
    }
  });

  // =========================================================================
  // 4. The transitions the acceptance criterion names
  // =========================================================================

  it('announces a visitor opening a conversation — the chatting half of the funnel', async () => {
    const { token, customer_id: customerId } = await widgetToken();

    const envelopes = await captureBus(fx.a.licenseId, async () => {
      const opened = await server.post(
        '/customer/chat/events',
        { text: 'is anyone about?', url: 'https://shop.example/pricing' },
        auth(token),
      );
      expect(opened.statusCode).toBe(201);
    });

    expect(about(envelopes, customerId).length).toBeGreaterThan(0);
  });

  it('announces the agent-started conversation too, not only the widget-started one', async () => {
    // `POST /chats` is the board's own **Start chat** row action. Nothing else
    // in this request writes a visit or a campaign send, so the signal can only
    // come from the conversation opening.
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'Proactive target' },
      select: { id: true },
    });

    const envelopes = await captureBus(fx.a.licenseId, async () => {
      const started = await server.post(
        '/chats',
        { customer_id: customer.id, assign_to_me: true },
        auth(boardToken),
      );
      expect(started.statusCode, started.body).toBe(201);
    });

    expect(about(envelopes, customer.id).length).toBeGreaterThan(0);
  });

  it('announces every reply in an open conversation — the waiting/chatting flip', async () => {
    // The board reads the newest event's author to split `waiting` from
    // `chatting`, so an agent's reply moves the row as surely as the visitor's
    // question did. This is the only transition with no other publish site in
    // the same request: nothing here writes a visit, a send or a chat.
    const { token, customer_id: customerId } = await widgetToken();
    const started = await server.post('/customer/chat/events', { text: 'hello?' }, auth(token));
    expect(started.statusCode).toBe(201);
    const chatId = (started.json() as { chat_id: string }).chat_id;

    const before = (await board()).find((row) => row.customer_id === customerId);
    expect(before?.activity).toBe('waiting');

    const envelopes = await captureBus(fx.a.licenseId, async () => {
      const replied = await server.post(
        `/chats/${chatId}/events`,
        { type: 'message', text: 'on it' },
        auth(boardToken),
      );
      expect(replied.statusCode, replied.body).toBe(201);
    });

    expect(about(envelopes, customerId).length).toBeGreaterThan(0);
    const after = (await board()).find((row) => row.customer_id === customerId);
    expect(after?.activity).toBe('chatting');
  });

  it('announces a hand-off — the board’s **Chatting with** column names someone else', async () => {
    const { token, customer_id: customerId } = await widgetToken();
    const started = await server.post('/customer/chat/events', { text: 'hello?' }, auth(token));
    expect(started.statusCode).toBe(201);
    const chatId = (started.json() as { chat_id: string }).chat_id;

    const envelopes = await captureBus(fx.a.licenseId, async () => {
      const handed = await server.post(
        `/chats/${chatId}/transfer`,
        { agent_id: fx.a.ownerAccountId, reason: 'manual' },
        auth(boardToken),
      );
      expect(handed.statusCode, handed.body).toBe(200);
    });

    expect(about(envelopes, customerId).length).toBeGreaterThan(0);
  });

  it('announces a supervisor seizing a conversation', async () => {
    const { token, customer_id: customerId } = await widgetToken();
    const started = await server.post('/customer/chat/events', { text: 'hello?' }, auth(token));
    expect(started.statusCode).toBe(201);
    const chatId = (started.json() as { chat_id: string }).chat_id;

    const envelopes = await captureBus(fx.a.licenseId, async () => {
      const seized = await server.post(`/chats/${chatId}/takeover`, {}, auth(boardToken));
      expect(seized.statusCode, seized.body).toBe(200);
    });

    expect(about(envelopes, customerId).length).toBeGreaterThan(0);
  });

  it('announces a reopened conversation — the visitor is back in a live bucket', async () => {
    const { token, customer_id: customerId } = await widgetToken();
    const started = await server.post('/customer/chat/events', { text: 'hello?' }, auth(token));
    expect(started.statusCode).toBe(201);
    const chatId = (started.json() as { chat_id: string }).chat_id;
    const closed = await server.post(`/chats/${chatId}/deactivate`, {}, auth(boardToken));
    expect(closed.statusCode).toBe(200);

    const envelopes = await captureBus(fx.a.licenseId, async () => {
      const reopened = await server.post(`/chats/${chatId}/resume`, {}, auth(boardToken));
      expect(reopened.statusCode, reopened.body).toBe(200);
    });

    expect(about(envelopes, customerId).length).toBeGreaterThan(0);
  });

  it('announces a conversation closing — the visitor leaves the board’s first source', async () => {
    const { token, customer_id: customerId } = await widgetToken();
    const started = await server.post(
      '/customer/chat/events',
      { text: 'thanks, all sorted' },
      auth(token),
    );
    expect(started.statusCode).toBe(201);
    const chatId = (started.json() as { chat_id: string }).chat_id;

    const envelopes = await captureBus(fx.a.licenseId, async () => {
      const closed = await server.post(`/chats/${chatId}/deactivate`, {}, auth(boardToken));
      expect(closed.statusCode).toBe(200);
    });

    expect(about(envelopes, customerId).length).toBeGreaterThan(0);
  });

  it('announces the visitors a campaign fire just invited', async () => {
    // Someone browsing, matched by the campaign's own condition.
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'Browsing visitor' },
      select: { id: true },
    });
    await owner.visit.create({
      data: {
        customerId: customer.id,
        licenseId: fx.a.licenseId,
        startedAt: new Date(Date.now() - 60_000),
        pages: [{ url: 'https://shop.example/pricing', at: new Date().toISOString() }],
      },
    });

    const envelopes = await captureBus(fx.a.licenseId, async () => {
      const created = await server.post(
        '/campaigns',
        {
          name: 'Need a hand?',
          active: true,
          conditions: { url_contains: '/pricing' },
          content: { message: 'Can we help?' },
        },
        auth(boardToken),
      );
      expect(created.statusCode).toBe(201);
    });

    expect(about(envelopes, customer.id).length).toBeGreaterThan(0);

    // And the board agrees about which bucket that put them in.
    const row = (await board()).find((entry) => entry.customer_id === customer.id);
    expect(row?.activity).toBe('invited');
  });

  it('announces the visitor a returning agent’s queue drain just picked up', async () => {
    // A queued conversation: nobody assigned, a position held, routed to the
    // team the returning agent belongs to.
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'Queued visitor' },
      select: { id: true },
    });
    const group = await owner.group.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    const chat = await owner.chat.create({
      data: {
        id: generateShortId(),
        licenseId: fx.a.licenseId,
        customerId: customer.id,
        active: true,
      },
      select: { id: true },
    });
    await owner.chatAccess.create({ data: { chatId: chat.id, groupId: group.id } });
    await owner.thread.create({
      data: {
        id: generateShortId(),
        chatId: chat.id,
        licenseId: fx.a.licenseId,
        active: true,
        assigneeId: null,
        queuePosition: 1,
        queuedAt: new Date(),
      },
    });

    const envelopes = await captureBus(fx.a.licenseId, async () => {
      const back = await server.put(
        '/agents/me/routing-status',
        { routing_status: 'accepting_chats' },
        auth(agentToken),
      );
      expect(back.statusCode).toBe(200);
      expect((back.json() as { assigned_from_queue: string[] }).assigned_from_queue).toContain(
        chat.id,
      );
    });

    expect(about(envelopes, customer.id).length).toBeGreaterThan(0);
  });
});
