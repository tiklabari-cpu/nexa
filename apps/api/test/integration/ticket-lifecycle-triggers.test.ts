/**
 * A ticket's life after it opened (AU-03 · tm 374): rules that run on an
 * update, a status change or a new message — once, never on their own change
 * — and the four lifecycle deliveries (`ticket_updated`,
 * `ticket_status_changed`, `ticket_assigned`, `ticket_message_added`), each
 * sent once per change and only to the workspace it happened in.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const DOMAIN = 'inbound.siyahtus.localhost';
const PLAYER = 'deniz.oyuncu@example.test';
const SCOPES = ['tickets--all:rw', 'tickets--all:ro', 'webhooks--all:rw'];

interface Delivery {
  host: string;
  action: string;
  data: Record<string, unknown>;
}

interface Ticket {
  id: string;
  status: string;
  priority: number;
  assignee_id: string | null;
  tags: string[];
}

describe('ticket lifecycle triggers (AU-03 · tm 374)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let tokenA: string;
  let tokenB: string;
  let received: Delivery[] = [];
  let seq = 0;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const stamp = () => `${Date.now().toString(36)}${(++seq).toString(36)}`;
  const deliveries = (action: string, host = 'a.hooks.test') =>
    received.filter((d) => d.action === action && d.host === host);

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer(
      {},
      {
        webhookSender: async (target, request) => {
          const body = JSON.parse(request.body) as {
            action: string;
            data: Record<string, unknown>;
          };
          received.push({ host: target.url.pathname.split('/')[1]!, ...body });
          return { ok: true, statusCode: 200 };
        },
      },
    );
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    received = [];
    const token = (t: TenantFixture) =>
      grantToken(owner, {
        licenseId: t.licenseId,
        organizationId: t.organizationId,
        ownerId: t.ownerAccountId,
        scopes: SCOPES,
      });
    [tokenA, tokenB] = await Promise.all([token(fx.a), token(fx.b)]);
  });

  /** Subscribe workspace `token` to `actions`; deliveries land under `host`. */
  async function subscribe(token: string, host: string, actions: string[]): Promise<void> {
    for (const action of actions) {
      const response = await server.post(
        '/webhooks',
        { url: `https://93.184.216.34/${host}/${action}`, action },
        auth(token),
      );
      expect(response.statusCode, response.body).toBe(201);
    }
  }

  async function rule(token: string, body: Record<string, unknown>): Promise<string> {
    const response = await server.post('/settings/ticket-rules', body, auth(token));
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { id: string }).id;
  }

  async function openTicket(token: string, t: TenantFixture, subject = 'Çekim bekliyor') {
    const response = await server.post(
      '/tickets',
      { subject, customer_id: t.customerId },
      auth(token),
    );
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as Ticket;
  }

  async function patch(token: string, id: string, body: Record<string, unknown>) {
    const response = await server.patch(`/tickets/${id}`, body, auth(token));
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as Ticket;
  }

  const tagsOf = async (ticketId: string) =>
    (
      await owner.ticketTag.findMany({
        where: { ticketId },
        select: { tag: { select: { name: true } } },
      })
    ).map((row) => row.tag.name);

  describe('rules at a moment', () => {
    it('stores the moment, defaults it to created, and refuses a condition the moment never has', async () => {
      const opened = await server.post(
        '/settings/ticket-rules',
        { name: 'Eski tip', conditions: { subject_contains: 'iade' }, actions: { priority: 3 } },
        auth(tokenA),
      );
      expect(opened.json()).toMatchObject({ on: 'created' });

      const bad = [
        { on: 'created', conditions: { status_to: 'solved' }, actions: { add_tag: 'x' } },
        { on: 'message_added', conditions: { status_to: 'solved' }, actions: { add_tag: 'x' } },
        { on: 'updated', conditions: { from_requester: true }, actions: { add_tag: 'x' } },
        {
          on: 'status_changed',
          conditions: { status_to: 'solved' },
          actions: { send_template_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7' },
        },
        { on: 'whenever', conditions: { status_to: 'solved' }, actions: { add_tag: 'x' } },
      ];
      for (const body of bad) {
        const response = await server.post(
          '/settings/ticket-rules',
          { name: 'Hatalı', ...body },
          auth(tokenA),
        );
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }

      // An edit is checked against the moment as it leaves the rule.
      const id = await rule(tokenA, {
        name: 'Çözülünce',
        on: 'status_changed',
        conditions: { status_to: 'solved' },
        actions: { add_tag: 'kapandi' },
      });
      const moved = await server.patch(
        `/settings/ticket-rules/${id}`,
        { on: 'message_added' },
        auth(tokenA),
      );
      expect(moved.statusCode).toBe(400);
    });

    it('"when solved, tag it" runs on that transition only — not on its own change, not on a later edit (FR-MOD-08.6.2)', async () => {
      await rule(tokenA, {
        name: 'Çözülünce etiketle',
        on: 'status_changed',
        conditions: { status_to: 'solved' },
        actions: { add_tag: 'kapandi' },
      });
      // A second rule on every update that writes the priority: were a rule's
      // own write an event, it would run again on it.
      await rule(tokenA, {
        name: 'Güncellenince öncelik',
        on: 'updated',
        conditions: { priority_at_least: 0 },
        actions: { priority: 7 },
      });
      await subscribe(tokenA, 'a.hooks.test', ['ticket_updated', 'ticket_status_changed']);
      const ticket = await openTicket(tokenA, fx.a);
      expect(await tagsOf(ticket.id)).toEqual([]);

      const solved = await patch(tokenA, ticket.id, { status: 'solved' });
      expect(solved).toMatchObject({ status: 'solved', priority: 7 });
      expect(solved.tags).toEqual(['kapandi']);
      // One change, one delivery each — the rules' write counted in.
      expect(deliveries('ticket_updated').map((d) => d.data)).toEqual([
        expect.objectContaining({
          ticket_id: ticket.id,
          changed: ['status', 'priority'],
          status: 'solved',
          priority: 7,
        }),
      ]);
      expect(deliveries('ticket_status_changed').map((d) => d.data)).toEqual([
        expect.objectContaining({ ticket_id: ticket.id, from: 'open', to: 'solved' }),
      ]);

      // A later edit of a solved ticket is no transition to solved.
      await owner.ticketTag.deleteMany({ where: { ticketId: ticket.id } });
      await patch(tokenA, ticket.id, { subject: 'Çekim bekliyor (güncel)' });
      expect(await tagsOf(ticket.id)).toEqual([]);
      // Solved again after reopening is a new transition.
      await patch(tokenA, ticket.id, { status: 'open' });
      await patch(tokenA, ticket.id, { status: 'solved' });
      expect(await tagsOf(ticket.id)).toEqual(['kapandi']);
      expect(deliveries('ticket_status_changed')).toHaveLength(3);
    });

    it('a request that changes nothing is no event: no rule, no delivery', async () => {
      await rule(tokenA, {
        name: 'Her güncelleme',
        on: 'updated',
        conditions: { priority_at_least: 0 },
        actions: { add_tag: 'dokunuldu' },
      });
      await subscribe(tokenA, 'a.hooks.test', ['ticket_updated']);
      const ticket = await openTicket(tokenA, fx.a);
      await patch(tokenA, ticket.id, { status: 'open', priority: ticket.priority });
      expect(await tagsOf(ticket.id)).toEqual([]);
      expect(deliveries('ticket_updated')).toEqual([]);
    });

    it('a bulk action is an event per row, and a rule never reaches another workspace', async () => {
      await rule(tokenA, {
        name: 'Beklemeye alınınca',
        on: 'status_changed',
        conditions: { status_to: 'pending' },
        actions: { add_tag: 'bekliyor' },
      });
      await subscribe(tokenA, 'a.hooks.test', ['ticket_status_changed']);
      await subscribe(tokenB, 'b.hooks.test', ['ticket_status_changed']);
      const one = await openTicket(tokenA, fx.a);
      const two = await openTicket(tokenA, fx.a);
      const theirs = await openTicket(tokenB, fx.b);

      const bulk = await server.post(
        '/tickets/bulk',
        { ticket_ids: [one.id, two.id], status: 'pending' },
        auth(tokenA),
      );
      expect(bulk.statusCode, bulk.body).toBe(200);
      expect(await tagsOf(one.id)).toEqual(['bekliyor']);
      expect(await tagsOf(two.id)).toEqual(['bekliyor']);
      expect(
        deliveries('ticket_status_changed')
          .map((d) => d.data['ticket_id'])
          .sort(),
      ).toEqual([one.id, two.id].sort());

      // The other workspace's own change: its rule set is empty, its hook hears
      // only its ticket, and workspace A's hook hears nothing more.
      await patch(tokenB, theirs.id, { status: 'pending' });
      expect(await tagsOf(theirs.id)).toEqual([]);
      expect(deliveries('ticket_status_changed', 'b.hooks.test').map((d) => d.data)).toEqual([
        expect.objectContaining({ ticket_id: theirs.id, to: 'pending' }),
      ]);
      expect(deliveries('ticket_status_changed')).toHaveLength(2);
    });

    it('a hand-over is ticket_assigned with who held it before', async () => {
      await subscribe(tokenA, 'a.hooks.test', ['ticket_assigned']);
      const ticket = await openTicket(tokenA, fx.a);
      await patch(tokenA, ticket.id, { assignee_id: fx.a.agentAccountId });
      expect(deliveries('ticket_assigned').map((d) => d.data)).toEqual([
        expect.objectContaining({
          ticket_id: ticket.id,
          assignee_id: fx.a.agentAccountId,
          previous_assignee_id: null,
        }),
      ]);
    });
  });

  describe('a message lands', () => {
    it('a note runs the team-side message rules and is delivered without its text', async () => {
      await rule(tokenA, {
        name: 'Ekip yazınca',
        on: 'message_added',
        conditions: { from_requester: false },
        actions: { add_tag: 'ekip-yazdi' },
      });
      await rule(tokenA, {
        name: 'Oyuncu yazınca',
        on: 'message_added',
        conditions: { from_requester: true },
        actions: { add_tag: 'oyuncu-yazdi' },
      });
      await subscribe(tokenA, 'a.hooks.test', ['ticket_message_added', 'ticket_updated']);
      const ticket = await openTicket(tokenA, fx.a);
      const response = await server.post(
        `/tickets/${ticket.id}/messages`,
        { kind: 'note', text: 'Ödeme ekibine sordum, gizli not.', idempotency_key: `k-${stamp()}` },
        auth(tokenA),
      );
      expect(response.statusCode, response.body).toBe(201);
      const message = response.json() as { id: string };

      expect(await tagsOf(ticket.id)).toEqual(['ekip-yazdi']);
      expect(deliveries('ticket_message_added').map((d) => d.data)).toEqual([
        expect.objectContaining({
          ticket_id: ticket.id,
          message_id: message.id,
          kind: 'internal_note',
          author_type: 'agent',
        }),
      ]);
      expect(JSON.stringify(received)).not.toContain('gizli not');
      // A tag is no ticket field: the note changed nothing a subscriber reads.
      expect(deliveries('ticket_updated')).toEqual([]);

      // A replay of the same request is the first one: nothing again.
      const key = `k-${stamp()}`;
      const body = { kind: 'note', text: 'İkinci not', idempotency_key: key };
      await server.post(`/tickets/${ticket.id}/messages`, body, auth(tokenA));
      await server.post(`/tickets/${ticket.id}/messages`, body, auth(tokenA));
      expect(deliveries('ticket_message_added')).toHaveLength(2);
    });

    it("the player's e-mailed answer runs the requester rules and reports the reopening", async () => {
      await rule(tokenA, {
        name: 'Oyuncu yazınca',
        on: 'message_added',
        conditions: { from_requester: true },
        actions: { priority: 9 },
      });
      await subscribe(tokenA, 'a.hooks.test', [
        'ticket_message_added',
        'ticket_status_changed',
        'ticket_updated',
      ]);
      const first = await server.post('/channels/email/inbound', {
        to: `${fx.a.organizationId}@${DOMAIN}`,
        from: `Deniz Oyuncu <${PLAYER}>`,
        subject: `Çekim ${stamp()}`,
        text: 'Çekimim bekliyor.',
        message_id: `<first.${stamp()}@mail.example.test>`,
      });
      expect(first.statusCode, first.body).toBe(200);
      const ticketId = (first.json() as { ticket_id: string }).ticket_id;
      // The opening message is the ticket arriving, not a message on it.
      expect(deliveries('ticket_message_added')).toEqual([]);
      expect((await owner.ticket.findUniqueOrThrow({ where: { id: ticketId } })).priority).toBe(0);

      await patch(tokenA, ticketId, { status: 'solved' });
      received = [];
      const answer = await server.post('/channels/email/inbound', {
        to: `${fx.a.organizationId}@${DOMAIN}`,
        from: `Deniz Oyuncu <${PLAYER}>`,
        subject: `Re: [#${ticketId}] Çekim`,
        text: 'Hâlâ gelmedi.',
        message_id: `<again.${stamp()}@mail.example.test>`,
      });
      expect(answer.json()).toMatchObject({
        status: 'threaded',
        ticket_id: ticketId,
        reopened: true,
      });

      expect(await owner.ticket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({
        status: 'open',
        priority: 9,
      });
      expect(deliveries('ticket_message_added').map((d) => d.data)).toEqual([
        expect.objectContaining({
          ticket_id: ticketId,
          kind: 'customer_message',
          author_type: 'customer',
        }),
      ]);
      expect(deliveries('ticket_status_changed').map((d) => d.data)).toEqual([
        expect.objectContaining({ ticket_id: ticketId, from: 'solved', to: 'open' }),
      ]);
      expect(deliveries('ticket_updated').map((d) => d.data)).toEqual([
        expect.objectContaining({ changed: ['status', 'priority'], priority: 9 }),
      ]);
      expect(JSON.stringify(received)).not.toContain('Hâlâ gelmedi');
    });
  });
});
