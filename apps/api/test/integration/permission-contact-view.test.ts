/**
 * Seeing a player's email and username under the permission matrix (tm 325.6 ·
 * SiyahTuş analysis RL-02-S2).
 *
 * `customers.contact.view` grants no scope; it is checked where the two fields
 * are serialised (`services/customers/player-contact.ts`). One sentinel player
 * — a distinctive address and pre-chat username — is put on every surface an
 * agent reads them from: the Contacts list and record, a possible match and a
 * link, a ticket, the traffic board, the AI hand-over card, a risk flag. With
 * the cell off for a role, no response body that role receives holds either
 * value, and no search confirms them; with it on — the default — every surface
 * answers as before. A change reaches an open session at its next request.
 *
 * The realtime side: no push carries either value, because one frame reaches
 * every recipient (the risk flag push drops `member_key`).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { licenseChannel, type CapabilityOverride } from '@siyahtus/types';
import { deriveCodeChallenge, generateToken } from '../../src/lib/crypto.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  TEST_PASSWORD,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const REASON = 'Oyuncu verisi yalnız yöneticilerde';
const EMAIL = 'Gizli.Oyuncu+325@example.test';
const USERNAME = 'GizliOyuncu325';
const NAME = 'Ada Oyuncu';

type Headers = Record<string, string>;

interface Envelope {
  action: string;
  payload: Record<string, unknown>;
}

describe("a player's contact details under the permission matrix (RL-02-S2 · tm 325.6)", () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let founder: Headers;
  let seq = 0;

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
    seq = 0;
    server.app.permissionMatrix.cache.invalidate();
    await clearRateLimits(server.app);
    founder = bearer(
      await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['access_rules:rw'],
      }),
    );
  });

  afterEach(async () => {
    await server.app.backgroundMail.settled();
    await server.app.riskFlags.idle();
  });

  const bearer = (token: string): Headers => ({ authorization: `Bearer ${token}` });

  async function signIn(t: TenantFixture, email: string): Promise<Headers> {
    const verifier = generateToken(48).slice(0, 64);
    const authorized = await server.post('/auth/authorize', {
      client_id: t.clientId,
      redirect_uri: t.redirectUri,
      code_challenge: deriveCodeChallenge(verifier),
      email,
      password: TEST_PASSWORD,
      license_id: t.licenseId.toString(),
    });
    expect(authorized.statusCode).toBe(200);
    const granted = await server.post('/auth/token', {
      grant_type: 'authorization_code',
      code: authorized.json().code,
      code_verifier: verifier,
      client_id: t.clientId,
      redirect_uri: t.redirectUri,
    });
    expect(granted.statusCode).toBe(200);
    return bearer((granted.json() as { access_token: string }).access_token);
  }

  /** A member of `role` who can sign in with the fixture password. */
  async function member(t: TenantFixture, role: string): Promise<{ id: string; email: string }> {
    const { passwordHash } = await owner.account.findUniqueOrThrow({
      where: { id: t.ownerAccountId },
      select: { passwordHash: true },
    });
    const email = `${role}-${(seq += 1)}-${t.licenseId}@example.test`;
    const account = await owner.account.create({
      data: { email, name: `${role} ${seq}`, passwordHash },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: t.licenseId, agentId: account.id, role, routingStatus: 'accepting_chats' },
    });
    return { id: account.id, email };
  }

  async function put(changes: CapabilityOverride[], auth: Headers = founder): Promise<void> {
    const res = await server.put('/settings/permissions', { changes, reason: REASON }, auth);
    expect(res.statusCode, res.body).toBe(200);
  }

  const hide = (role: string): CapabilityOverride => ({
    role,
    capability: 'customers.contact.view',
    value: 'off',
  });
  const show = (role: string): CapabilityOverride => ({
    role,
    capability: 'customers.contact.view',
    value: 'on',
  });

  /** Whether a response body holds either sentinel value, whatever its case. */
  const leaks = (body: string): boolean => {
    const lower = body.toLowerCase();
    return lower.includes(EMAIL.toLowerCase()) || lower.includes(USERNAME.toLowerCase());
  };

  interface World {
    chatId: string;
    threadId: string;
    customerId: string;
    twinId: string;
    ticketId: string;
    flagId: string;
  }

  /**
   * The sentinel player on every surface, in workspace A: their conversation
   * (pre-chat name, username, email; routed to the Team Member's team), a
   * second record with the same address (a possible match, and linked), a
   * ticket from the conversation, an AI hand-over card, a risk flag.
   */
  async function world(): Promise<World> {
    const t = fx.a;
    const group = await owner.group.create({
      data: { licenseId: t.licenseId, name: 'Destek' },
      select: { id: true },
    });
    await owner.groupAgent.create({
      data: { licenseId: t.licenseId, groupId: group.id, agentId: t.agentAccountId },
    });

    const minted = await server.post(
      '/customer/token',
      { organization_id: t.organizationId },
      { origin: `https://${t.trustedDomain}` },
    );
    const visitor = bearer((minted.json() as { token: string }).token);
    const sent = await server.post(
      '/customer/chat/events',
      {
        text: 'merhaba',
        name: NAME,
        username: USERNAME,
        email: EMAIL,
        url: `https://${t.trustedDomain}/kasa`,
      },
      visitor,
    );
    expect(sent.statusCode, sent.body).toBe(201);
    const posted = sent.json() as { chat_id: string; event: { thread_id: string } };
    const chatId = posted.chat_id;
    const threadId = posted.event.thread_id;
    // Routing files it under the only team already; said here, not assumed.
    await owner.chatAccess.createMany({
      data: [{ chatId, groupId: group.id }],
      skipDuplicates: true,
    });
    const { customerId } = await owner.chat.findUniqueOrThrow({
      where: { id: chatId },
      select: { customerId: true },
    });

    const twin = await owner.customer.create({
      data: {
        organizationId: t.organizationId,
        name: 'Eski kayıt',
        email: EMAIL,
        username: USERNAME,
      },
      select: { id: true },
    });

    const kurucu = await signIn(t, t.ownerEmail);
    const linked = await server.post(
      `/customers/${customerId}/links`,
      { customer_id: twin.id },
      kurucu,
    );
    expect(linked.statusCode, linked.body).toBe(201);
    const ticket = await server.post(
      '/tickets',
      { subject: 'Yatırım', source_chat_id: chatId, group_id: Number(group.id) },
      kurucu,
    );
    expect(ticket.statusCode, ticket.body).toBe(201);

    await owner.aiHandoff.create({
      data: {
        id: randomUUID(),
        licenseId: t.licenseId,
        chatId,
        threadId,
        // The card's prose quotes the player the way a real one can: the AI
        // summarised what they wrote, collected their username as a slot, said
        // it back to them (security review, tm 325.6).
        summary: `${EMAIL} adresli oyuncunun yatırımı hesaba geçmedi`,
        question: `${USERNAME} hesabıma para geçmedi`,
        slotsSnapshot: [
          { slot: 'username', label: 'Kullanıcı adı', status: 'filled', text: USERNAME },
        ],
        decisionFacts: [{ field: 'player.email', text: EMAIL.toLowerCase() }],
        aiStatements: [
          {
            event_id: 'ev1',
            text: `${USERNAME} hesabını kontrol ediyorum`,
            created_at: new Date().toISOString(),
          },
        ],
        suggestedNextStep: `${EMAIL} ile ödeme sağlayıcısında eşleştir`,
        player: { username: USERNAME, name: NAME, email: EMAIL, basis: 'declared' },
        reasonCodes: ['no_knowledge'],
        primaryReason: 'no_knowledge',
        priority: 'normal',
        cardText: `Konu: Yatırım\nOyuncu: kullanıcı adı "${USERNAME}" · ${NAME} · ${EMAIL.toLowerCase()}`,
      },
    });

    const flag = await server.post(`/chats/${chatId}/risk-flags`, { type: 'rg_signal' }, kurucu);
    expect(flag.statusCode, flag.body).toBe(201);
    await server.app.riskFlags.idle();

    return {
      chatId,
      threadId,
      customerId,
      twinId: twin.id,
      ticketId: (ticket.json() as { id: string }).id,
      flagId: (flag.json() as { id: string }).id,
    };
  }

  /** Every agent-facing read that names the sentinel player. */
  const reads = (w: World): string[] => [
    '/customers',
    `/customers/${w.customerId}`,
    `/customers/${w.customerId}/possible-matches`,
    `/customers/${w.customerId}/links`,
    '/tickets',
    `/tickets/${w.ticketId}`,
    '/traffic',
    `/chats/${w.chatId}`,
    `/chats/${w.chatId}/ai-handoffs`,
    '/risk-flags',
    `/customers/${w.customerId}/risk-flags`,
  ];

  async function bodies(auth: Headers, paths: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const path of paths) {
      const res = await server.get(path, auth);
      expect(res.statusCode, `${path}: ${res.body}`).toBe(200);
      out.set(path, res.body);
    }
    return out;
  }

  const leaking = (seen: Map<string, string>): string[] =>
    [...seen].filter(([, body]) => leaks(body)).map(([path]) => path);

  /** The total a list search answers with. */
  async function found(auth: Headers, path: string, query: string): Promise<number> {
    const res = await server.get(`${path}?query=${encodeURIComponent(query)}`, auth);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { total: number }).total;
  }

  async function captureBus(run: () => Promise<void>): Promise<Envelope[]> {
    const sub = server.app.redis.duplicate();
    const seen: Envelope[] = [];
    await sub.subscribe(licenseChannel(fx.a.licenseId));
    sub.on('message', (_channel, raw) => {
      try {
        seen.push(JSON.parse(raw) as Envelope);
      } catch {
        /* not an envelope */
      }
    });
    try {
      await run();
      await server.app.riskFlags.idle();
      await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      await sub.unsubscribe(licenseChannel(fx.a.licenseId));
      sub.disconnect();
    }
    return seen;
  }

  // =========================================================================

  it('shows every role the player’s email and username by default, on every surface (FR-MOD-04.RBAC)', async () => {
    const w = await world();
    const agent = await signIn(fx.a, fx.a.agentEmail);
    const seen = await bodies(agent, reads(w));
    // Today's behaviour: each surface that carries a field carries it.
    for (const path of reads(w)) expect(leaks(seen.get(path)!), path).toBe(true);
    expect(await found(agent, '/customers', 'gizli.oyuncu+325')).toBeGreaterThan(0);
    expect(await found(agent, '/customers', 'gizlioyuncu')).toBeGreaterThan(0);
    expect(await found(agent, '/tickets', 'gizli.oyuncu+325')).toBe(1);
  });

  it('masks both fields from an Ekip Üyesi on every surface once switched off, without a new sign-in, and gives them back (FR-MOD-04.RBAC)', async () => {
    const w = await world();
    const agent = await signIn(fx.a, fx.a.agentEmail);
    expect(leaking(await bodies(agent, reads(w)))).toEqual(reads(w));

    await put([hide('agent')]);
    expect(leaking(await bodies(agent, reads(w)))).toEqual([]);

    // The record is still there, read as one that never gave the two: the
    // contract's nulls, which the panel draws as its empty state.
    const record = (await server.get(`/customers/${w.customerId}`, agent)).json() as Record<
      string,
      unknown
    >;
    expect(record).toMatchObject({ id: w.customerId, name: NAME, email: null, username: null });
    const ticket = (await server.get(`/tickets/${w.ticketId}`, agent)).json() as Record<
      string,
      unknown
    >;
    expect(ticket).toMatchObject({ customer_name: NAME, customer_email: null });
    const chat = (await server.get(`/chats/${w.chatId}`, agent)).json() as {
      latest_ai_handoff: { player: Record<string, unknown>; card_text: string };
    };
    expect(chat.latest_ai_handoff.player).toMatchObject({
      name: NAME,
      username: null,
      email: null,
    });
    expect(chat.latest_ai_handoff.card_text).toContain(
      `Oyuncu: kullanıcı adı "•••" · ${NAME} · •••`,
    );
    const matches = (
      await server.get(`/customers/${w.customerId}/possible-matches`, agent)
    ).json() as {
      items: Array<{ customer: { id: string }; matched_on: string[] }>;
    };
    // That two records share a detail stays; which detail it is, is withheld.
    expect(matches.items).toEqual([
      expect.objectContaining({ customer: expect.objectContaining({ id: w.twinId }) }),
    ]);

    // On again: the same session sees them at its next request.
    await put([show('agent')]);
    expect(leaking(await bodies(agent, reads(w)))).toEqual(reads(w));
  });

  it('keeps a search from confirming an address or a username the caller may not see, and still finds the name (FR-MOD-04.RBAC)', async () => {
    await world();
    const agent = await signIn(fx.a, fx.a.agentEmail);
    await put([hide('agent')]);

    expect(await found(agent, '/customers', 'gizli.oyuncu+325@example.test')).toBe(0);
    expect(await found(agent, '/customers', 'GizliOyuncu')).toBe(0);
    expect(await found(agent, '/tickets', 'gizli.oyuncu+325')).toBe(0);
    expect(await found(agent, '/tickets', 'gizlioyuncu')).toBe(0);
    // The name is no contact detail: it still finds the player, masked.
    expect(await found(agent, '/customers', 'Ada Oyun')).toBe(1);
    expect(await found(agent, '/tickets', 'Ada Oyun')).toBe(1);

    await put([show('agent')]);
    expect(await found(agent, '/customers', 'gizli.oyuncu+325@example.test')).toBe(2);
    expect(await found(agent, '/tickets', 'gizlioyuncu')).toBe(1);
  });

  it('masks a Yönetici’s writes too, and never the Kurucu, whose column is locked (FR-MOD-04.RBAC)', async () => {
    const w = await world();
    const admin = await signIn(fx.a, (await member(fx.a, 'admin')).email);
    const kurucu = await signIn(fx.a, fx.a.ownerEmail);
    await put([hide('admin')]);

    expect(leaking(await bodies(admin, reads(w)))).toEqual([]);
    // A write answers with the record it wrote — masked the same way.
    const patched = await server.patch(
      `/customers/${w.customerId}`,
      { phone: '+905550000000' },
      admin,
    );
    expect(patched.statusCode, patched.body).toBe(200);
    expect(leaks(patched.body)).toBe(false);
    const ticket = await server.patch(`/tickets/${w.ticketId}`, { priority: 2 }, admin);
    expect(ticket.statusCode, ticket.body).toBe(200);
    expect(leaks(ticket.body)).toBe(false);
    // The customer can still be written to: the panel offers the notice.
    expect(ticket.json()).toMatchObject({ customer_email: null, customer_has_email: true });
    // Not over a value they cannot see: an empty-looking field is not empty.
    for (const field of [{ email: 'yeni@example.test' }, { username: 'yeni' }]) {
      const blind = await server.patch(`/customers/${w.customerId}`, field, admin);
      expect(blind.statusCode, blind.body).toBe(403);
      expect(blind.json()).toMatchObject({
        error: { details: { reason: 'capability_required', capability: 'customers.contact.view' } },
      });
    }
    const stored = await owner.customer.findUniqueOrThrow({
      where: { id: w.customerId },
      select: { email: true, username: true, phone: true },
    });
    expect(stored).toEqual({ email: EMAIL, username: USERNAME, phone: '+905550000000' });

    // The Founder's cell cannot be switched off, and they see everything.
    const refused = await server.put(
      '/settings/permissions',
      { changes: [hide('owner')], reason: REASON },
      founder,
    );
    expect(refused.statusCode).toBe(400);
    expect(leaking(await bodies(kurucu, reads(w)))).toEqual(reads(w));
    // The other roles are untouched by the Yönetici's cell.
    const agent = await signIn(fx.a, fx.a.agentEmail);
    expect(leaking(await bodies(agent, reads(w)))).toEqual(reads(w));
  });

  it('pushes no username with a risk flag, to anyone (FR-MOD-04.RBAC)', async () => {
    const w = await world();
    const kurucu = await signIn(fx.a, fx.a.ownerEmail);
    const envelopes = await captureBus(async () => {
      const raised = await server.post(
        `/chats/${w.chatId}/risk-flags`,
        { type: 'self_exclusion_request' },
        kurucu,
      );
      expect(raised.statusCode, raised.body).toBe(201);
    });
    const pushes = envelopes.filter((e) => e.action === 'risk_flag_raised');
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.payload).not.toHaveProperty('member_key');
    expect(pushes[0]!.payload).toMatchObject({ customer_id: w.customerId });
    expect(envelopes.filter((e) => leaks(JSON.stringify(e)))).toEqual([]);
    // REST still names the player to those who may see them.
    const flags = (await server.get(`/customers/${w.customerId}/risk-flags`, kurucu)).json() as {
      items: Array<{ member_key: string | null }>;
    };
    expect(flags.items.map((flag) => flag.member_key)).toEqual([
      USERNAME.toLowerCase(),
      USERNAME.toLowerCase(),
    ]);
  });

  it('blanks the player out of hand-over notes written before the note stopped naming them (FR-MOD-04.RBAC)', async () => {
    const w = await world();
    const handoff = await owner.aiHandoff.findFirstOrThrow({
      where: { chatId: w.chatId },
      select: { id: true },
    });
    // The note as tm 304.1 wrote it: the card text, player line included.
    const old = `Konu: Yatırım
Oyuncu: kullanıcı adı "${USERNAME}" · ${NAME} · ${EMAIL} (oyuncu beyanı, doğrulanmadı)`;
    const noteId = `ev_${randomUUID().slice(0, 12)}`;
    await owner.event.create({
      data: {
        id: noteId,
        chatId: w.chatId,
        threadId: w.threadId,
        licenseId: fx.a.licenseId,
        type: 'system_message',
        text: old,
        authorType: 'system',
        recipients: 'agents',
        properties: { system_event: 'ai_handoff_card', ai_handoff_id: handoff.id },
      },
    });
    // Another note, of no hand-over: untouched.
    const otherId = `ev_${randomUUID().slice(0, 12)}`;
    await owner.event.create({
      data: {
        id: otherId,
        chatId: w.chatId,
        threadId: w.threadId,
        licenseId: fx.a.licenseId,
        type: 'message',
        text: `not: ${EMAIL}`,
        authorType: 'agent',
        recipients: 'agents',
      },
    });

    const sql = readFileSync(
      new URL(
        '../../prisma/migrations/20261022220000_handoff_note_without_player_contact/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await owner.$executeRawUnsafe(sql);
    // Again: a second run changes nothing.
    await owner.$executeRawUnsafe(sql);

    const note = await owner.event.findFirstOrThrow({
      where: { id: noteId },
      select: { text: true },
    });
    expect(note.text).toBe(
      `Konu: Yatırım
Oyuncu: kullanıcı adı "•••" · ${NAME} · ••• (oyuncu beyanı, doğrulanmadı)`,
    );
    const other = await owner.event.findFirstOrThrow({
      where: { id: otherId },
      select: { text: true },
    });
    expect(other.text).toBe(`not: ${EMAIL}`);
  });

  it('keeps one workspace’s choice to itself (FR-MOD-04.RBAC)', async () => {
    const w = await world();
    const agent = await signIn(fx.a, fx.a.agentEmail);
    const founderB = bearer(
      await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['access_rules:rw'],
      }),
    );
    await put([hide('agent')], founderB);
    expect(leaking(await bodies(agent, reads(w)))).toEqual(reads(w));
    const agentB = await signIn(fx.b, fx.b.agentEmail);
    const me = (await server.get('/auth/me', agentB)).json() as {
      capabilities: Record<string, string>;
    };
    expect(me.capabilities['customers.contact.view']).toBe('off');
  });
});
