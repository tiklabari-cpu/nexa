/**
 * The risk flag endpoints (tm 302.2 · SiyahTuş analysis AI-27): raising from
 * the inbox, clearing with a reason by the right role (AI-27-S2), who reads a
 * flag's note (the Responsible Gaming team and a Team Lead and up), the
 * archive/report filter, a player's flags the day after, the settings, and
 * what leaves the workspace — the push, the webhook — without a word anyone
 * wrote. Another workspace sees none of it (NFR-S5).
 *
 * The AI's own flags, raised with its hand-over, are `risk-flags-runtime.test.ts`'s.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { licenseChannel, RISK_FLAG_DEFAULTS, type RiskFlagType } from '@siyahtus/types';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const NOTE = 'Oyuncu kayıplarını kovaladığını ve maaşını yatırdığını yazdı.';
const REASON = 'Operatör doğruladı: yanlış kişi, hesap başka oyuncunun.';

interface Flag {
  id: string;
  scope: string;
  chat_id: string | null;
  thread_id: string | null;
  customer_id: string | null;
  type: RiskFlagType;
  severity: string;
  source: string;
  status: string;
  raised_by: string | null;
  cleared_by: string | null;
  note: string | null;
  evidence_event_ids: string[] | null;
  clear_reason: string | null;
  details_visible: boolean;
  basis: string;
}

interface Delivery {
  action: string;
  data: Record<string, unknown>;
}

describe('risk flags on the API (AI-27 · tm 302.2)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let received: Delivery[] = [];
  /** Tokens: the owner, an admin (Manager), a plain agent (Team Member), one restricted to their teams. */
  let ownerToken: string;
  let adminToken: string;
  let agentToken: string;
  let restrictedToken: string;
  let restrictedId: string;
  let foreignAdminToken: string;
  let adminId: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const del = (path: string, body: unknown, token: string) =>
    server.app
      .inject({
        method: 'DELETE',
        url: server.url(path),
        payload: body as object,
        headers: auth(token),
      })
      .then(async (response) => {
        await server.app.riskFlags.idle();
        return response;
      });

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer(
      {},
      {
        webhookSender: async (_target, request) => {
          received.push(JSON.parse(request.body) as Delivery);
          return { ok: true, statusCode: 200 };
        },
      },
    );
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  async function addMember(t: TenantFixture, label: string, role: string): Promise<string> {
    const account = await owner.account.create({
      data: { email: `${label}-${t.licenseId}@example.test`, name: label, passwordHash: null },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: t.licenseId, agentId: account.id, role },
    });
    return account.id;
  }

  const token = (t: TenantFixture, ownerId: string, scopes: string[]) =>
    grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId,
      scopes,
    });

  /** A visitor's conversation in `t`: its chat, its connection, its customer, the message. */
  async function conversation(t: TenantFixture, text = 'merhaba') {
    const minted = await server.post(
      '/customer/token',
      { organization_id: t.organizationId },
      { origin: `https://${t.trustedDomain}` },
    );
    const headers = { authorization: `Bearer ${(minted.json() as { token: string }).token}` };
    const sent = await server.post('/customer/chat/events', { text }, headers);
    expect(sent.statusCode).toBe(201);
    const body = sent.json() as { chat_id: string; event: { id: string; thread_id: string } };
    const chat = await owner.chat.findUniqueOrThrow({
      where: { id: body.chat_id },
      select: { customerId: true },
    });
    return {
      chatId: body.chat_id,
      threadId: body.event.thread_id,
      customerId: chat.customerId,
      eventId: body.event.id,
    };
  }

  async function raise(
    chatId: string,
    body: Record<string, unknown>,
    as = agentToken,
  ): Promise<{ statusCode: number; flag: Flag }> {
    const response = await server.post(`/chats/${chatId}/risk-flags`, body, auth(as));
    return { statusCode: response.statusCode, flag: response.json() as Flag };
  }

  async function captureBus(run: () => Promise<void>): Promise<Array<Record<string, unknown>>> {
    const sub = server.app.redis.duplicate();
    const seen: Array<Record<string, unknown>> = [];
    await sub.subscribe(licenseChannel(fx.a.licenseId));
    sub.on('message', (_channel, raw) => {
      seen.push(JSON.parse(raw) as Record<string, unknown>);
    });
    try {
      await run();
      await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      await sub.unsubscribe(licenseChannel(fx.a.licenseId));
      sub.disconnect();
    }
    return seen;
  }

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    received = [];
    adminId = await addMember(fx.a, 'manager', 'admin');
    restrictedId = await addMember(fx.a, 'restricted', 'agent');
    const foreignAdmin = await addMember(fx.b, 'foreign-manager', 'admin');
    [ownerToken, adminToken, agentToken, restrictedToken, foreignAdminToken] = await Promise.all([
      token(fx.a, fx.a.ownerAccountId, ['chats--all:rw', 'access_rules:rw', 'webhooks--all:rw']),
      token(fx.a, adminId, ['chats--all:rw', 'access_rules:rw']),
      token(fx.a, fx.a.agentAccountId, ['chats--all:rw', 'access_rules:rw']),
      token(fx.a, restrictedId, ['chats--access:rw']),
      token(fx.b, foreignAdmin, ['chats--all:rw', 'access_rules:rw']),
    ]);
  });

  describe('raising', () => {
    it('raises with the type’s scope and severity, on the player’s claim — and a second raise of the type is the first', async () => {
      const c = await conversation(fx.a);
      const first = await raise(c.chatId, {
        type: 'rg_signal',
        note: NOTE,
        evidence_event_ids: [c.eventId],
      });
      expect(first.statusCode).toBe(201);
      expect(first.flag).toMatchObject({
        type: 'rg_signal',
        scope: 'member',
        severity: RISK_FLAG_DEFAULTS.rg_signal.severity,
        source: 'agent',
        basis: 'declared',
        status: 'active',
        chat_id: c.chatId,
        thread_id: c.threadId,
        customer_id: c.customerId,
        raised_by: fx.a.agentAccountId,
      });
      const complaint = await raise(c.chatId, { type: 'complaint_formal' });
      expect(complaint.statusCode).toBe(201);
      expect(complaint.flag).toMatchObject({ scope: 'chat', severity: 'high' });

      const again = await raise(c.chatId, { type: 'rg_signal', note: 'ikinci' });
      expect(again.statusCode).toBe(200);
      expect(again.flag.id).toBe(first.flag.id);
      expect(await owner.riskFlag.count({ where: { chatId: c.chatId } })).toBe(2);
    });

    it('refuses evidence from another conversation, a connection of another chat, an unknown type — and another workspace’s chat reads as absent (NFR-S5)', async () => {
      const c = await conversation(fx.a);
      const other = await conversation(fx.a, 'başka');
      expect(
        (await raise(c.chatId, { type: 'abusive', evidence_event_ids: [other.eventId] }))
          .statusCode,
      ).toBe(400);
      expect(
        (await raise(c.chatId, { type: 'abusive', thread_id: other.threadId })).statusCode,
      ).toBe(404);
      expect((await raise(c.chatId, { type: 'gambling' })).statusCode).toBe(400);
      expect((await raise(c.chatId, {})).statusCode).toBe(400);

      const foreign = await conversation(fx.b);
      expect((await raise(foreign.chatId, { type: 'abusive' })).statusCode).toBe(404);
      expect((await raise(foreign.chatId, { type: 'abusive' }, foreignAdminToken)).statusCode).toBe(
        201,
      );
      expect(await owner.riskFlag.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });

    it('a member limited to their teams cannot flag a conversation they do not see', async () => {
      const c = await conversation(fx.a);
      expect((await raise(c.chatId, { type: 'abusive' }, restrictedToken)).statusCode).toBe(404);
    });

    it('pushes it to the conversation’s people and the supervisors, and delivers it to the webhook — no note, no text', async () => {
      const hook = await server.post(
        '/webhooks',
        { url: 'https://93.184.216.34/hooks/risk', action: 'risk_flag_raised' },
        auth(ownerToken),
      );
      expect(hook.statusCode).toBe(201);
      const c = await conversation(fx.a, 'kayıplarımı geri almam lazım');

      let flag: Flag | null = null;
      const bus = await captureBus(async () => {
        flag = (await raise(c.chatId, { type: 'rg_signal', note: NOTE })).flag;
      });
      const push = bus.find((envelope) => envelope['action'] === 'risk_flag_raised');
      expect(push).toBeDefined();
      expect(push!['payload']).toMatchObject({
        flag_id: flag!.id,
        type: 'rg_signal',
        chat_id: c.chatId,
        customer_id: c.customerId,
        source: 'agent',
      });
      const audience = push!['audience'] as { agentIds?: string[] };
      expect(audience.agentIds).toEqual(expect.arrayContaining([fx.a.ownerAccountId, adminId]));

      expect(received).toHaveLength(1);
      expect(received[0]!.action).toBe('risk_flag_raised');
      expect(Object.keys(received[0]!.data).sort()).toEqual(
        [
          'chat_id',
          'cleared_at',
          'flag_id',
          'member_key',
          'raised_at',
          'scope',
          'severity',
          'status',
          'thread_id',
          'type',
        ].sort(),
      );
      // (AI-27-S4) the webhook carries no message text, no note.
      const wire = JSON.stringify([received, push]);
      expect(wire).not.toContain('kayıplarımı');
      expect(wire).not.toContain(NOTE);
    });
  });

  describe('who reads the note (AI-27 "Görünürlük")', () => {
    it('a Team Member sees the type, not the note or the evidence; the Responsible Gaming team and a Manager do (API)', async () => {
      const c = await conversation(fx.a);
      await raise(c.chatId, { type: 'rg_signal', note: NOTE, evidence_event_ids: [c.eventId] });

      const read = async (as: string) => {
        const response = await server.get(`/risk-flags?chat_id=${c.chatId}`, auth(as));
        expect(response.statusCode).toBe(200);
        return (response.json() as { items: Flag[] }).items[0]!;
      };

      expect(await read(agentToken)).toMatchObject({
        type: 'rg_signal',
        note: null,
        evidence_event_ids: null,
        details_visible: false,
      });
      expect(await read(adminToken)).toMatchObject({
        note: NOTE,
        evidence_event_ids: [c.eventId],
        details_visible: true,
      });

      // The agent joins the Responsible Gaming team.
      const team = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Sorumlu Oyun' },
        select: { id: true },
      });
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId: team.id, agentId: fx.a.agentAccountId },
      });
      expect((await read(agentToken)).note).toBeNull();
      const saved = await server.put(
        '/risk-flags/settings',
        { rg_group_id: Number(team.id) },
        auth(adminToken),
      );
      expect(saved.statusCode).toBe(200);
      expect(await read(agentToken)).toMatchObject({ note: NOTE, details_visible: true });

      // The raise's own answer follows the same rule.
      const own = await raise(c.chatId, { type: 'abusive', note: 'küfür' }, restrictedToken);
      expect(own.statusCode).toBe(404);
    });
  });

  describe('clearing (AI-27-S2)', () => {
    it('a Team Member cannot clear rg_signal; a Manager clears it with a reason, once — on the audit log without the reason', async () => {
      const hook = await server.post(
        '/webhooks',
        { url: 'https://93.184.216.34/hooks/risk', action: 'risk_flag_cleared' },
        auth(ownerToken),
      );
      expect(hook.statusCode).toBe(201);
      const c = await conversation(fx.a);
      const { flag } = await raise(c.chatId, { type: 'rg_signal', note: NOTE });

      const refused = await del(`/risk-flags/${flag.id}`, { reason: REASON }, agentToken);
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({
        error: {
          type: 'authorization',
          details: { reason: 'risk_flag_clear_role', required_role: 'admin' },
        },
      });

      expect((await del(`/risk-flags/${flag.id}`, {}, adminToken)).statusCode).toBe(400);
      expect((await del(`/risk-flags/${flag.id}`, { reason: '   ' }, adminToken)).statusCode).toBe(
        400,
      );
      expect(await owner.riskFlag.findUniqueOrThrow({ where: { id: flag.id } })).toMatchObject({
        status: 'active',
      });

      const cleared = await del(`/risk-flags/${flag.id}`, { reason: REASON }, adminToken);
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json()).toMatchObject({
        id: flag.id,
        status: 'cleared',
        cleared_by: adminId,
        clear_reason: REASON,
      });

      const [entry, ...more] = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'risk_flag.cleared' },
      });
      expect(more).toEqual([]);
      expect(entry).toMatchObject({ actorId: adminId, target: `risk_flag:${flag.id}` });
      expect(entry!.metadata).toMatchObject({ type: 'rg_signal', chat_id: c.chatId });
      expect(JSON.stringify(entry!.metadata)).not.toContain('yanlış kişi');

      expect(received.map((delivery) => delivery.action)).toEqual(['risk_flag_cleared']);
      expect(received[0]!.data).toMatchObject({ flag_id: flag.id, status: 'cleared' });
      expect(JSON.stringify(received)).not.toContain('yanlış kişi');

      const twice = await del(`/risk-flags/${flag.id}`, { reason: REASON }, adminToken);
      expect(twice.statusCode).toBe(403);
      expect(twice.json()).toMatchObject({
        error: { type: 'not_allowed', details: { reason: 'risk_flag_already_cleared' } },
      });

      // A Team Member sees it cleared, not why.
      const seen = await server.get(`/risk-flags?chat_id=${c.chatId}`, auth(agentToken));
      expect((seen.json() as { items: Flag[] }).items[0]).toMatchObject({
        status: 'cleared',
        clear_reason: null,
      });
    });

    it('the other types need a Team Lead and up — admin until RL-01 — and another workspace’s flag reads as absent', async () => {
      const c = await conversation(fx.a);
      const { flag } = await raise(c.chatId, { type: 'complaint_formal' });
      expect((await del(`/risk-flags/${flag.id}`, { reason: REASON }, agentToken)).statusCode).toBe(
        403,
      );
      expect(
        (await del(`/risk-flags/${flag.id}`, { reason: REASON }, foreignAdminToken)).statusCode,
      ).toBe(404);
      expect((await del(`/risk-flags/${flag.id}`, { reason: REASON }, ownerToken)).statusCode).toBe(
        200,
      );
    });
  });

  describe('reading', () => {
    it('the archive filter: type=rg_signal finds the flagged conversations and no other (AR-02 with AI-27)', async () => {
      const flagged = await conversation(fx.a);
      const complaint = await conversation(fx.a);
      const quiet = await conversation(fx.a);
      await raise(flagged.chatId, { type: 'rg_signal' });
      await raise(complaint.chatId, { type: 'complaint_formal' });
      const foreign = await conversation(fx.b);
      await raise(foreign.chatId, { type: 'rg_signal' }, foreignAdminToken);

      const list = async (query: string, as = adminToken) => {
        const response = await server.get(`/risk-flags${query}`, auth(as));
        expect(response.statusCode).toBe(200);
        return response.json() as { items: Flag[]; next_page_id?: string };
      };

      const rg = await list('?type=rg_signal&status=active');
      expect(rg.items.map((item) => item.chat_id)).toEqual([flagged.chatId]);
      const both = await list('?type=rg_signal,complaint_formal');
      expect(new Set(both.items.map((item) => item.chat_id))).toEqual(
        new Set([flagged.chatId, complaint.chatId]),
      );
      expect((await list(`?chat_id=${quiet.chatId}`)).items).toEqual([]);
      expect((await list('?status=cleared')).items).toEqual([]);

      // Pages, newest first.
      const first = await list('?limit=1');
      expect(first.items).toHaveLength(1);
      expect(first.items[0]!.chat_id).toBe(complaint.chatId);
      const second = await list(`?limit=1&page_id=${first.next_page_id!}`);
      expect(second.items[0]!.chat_id).toBe(flagged.chatId);
      expect(second.next_page_id).toBeUndefined();

      expect((await server.get('/risk-flags?page_id=nope', auth(adminToken))).statusCode).toBe(400);
      expect((await server.get('/risk-flags?type=gambling', auth(adminToken))).statusCode).toBe(
        400,
      );
    });

    it('a member limited to their teams lists the flags of conversations they see — and a player’s own flags the day after, wherever raised', async () => {
      const c = await conversation(fx.a);
      await raise(c.chatId, { type: 'rg_signal', note: NOTE });
      await raise(c.chatId, { type: 'complaint_formal' });

      const all = await server.get('/risk-flags', auth(restrictedToken));
      expect(all.statusCode).toBe(200);
      expect((all.json() as { items: Flag[] }).items).toEqual([]);

      const player = await server.get(
        `/customers/${c.customerId}/risk-flags`,
        auth(restrictedToken),
      );
      expect(player.statusCode).toBe(200);
      expect((player.json() as { items: Flag[] }).items).toEqual([
        expect.objectContaining({ type: 'rg_signal', scope: 'member', note: null }),
      ]);
      const full = await server.get(`/customers/${c.customerId}/risk-flags`, auth(adminToken));
      expect((full.json() as { items: Flag[] }).items.map((item) => item.type).sort()).toEqual([
        'complaint_formal',
        'rg_signal',
      ]);

      expect(
        (await server.get(`/customers/${c.customerId}/risk-flags`, auth(foreignAdminToken)))
          .statusCode,
      ).toBe(404);
      const foreignList = await server.get('/risk-flags', auth(foreignAdminToken));
      expect((foreignList.json() as { items: Flag[] }).items).toEqual([]);
    });
  });

  describe('settings', () => {
    it('admin and up; a team of this workspace; at most five valid addresses; audited', async () => {
      expect((await server.get('/risk-flags/settings', auth(agentToken))).statusCode).toBe(403);
      expect(
        (await server.put('/risk-flags/settings', { notify_emails: [] }, auth(agentToken)))
          .statusCode,
      ).toBe(403);

      const initial = await server.get('/risk-flags/settings', auth(adminToken));
      expect(initial.json()).toEqual({
        rg_group_id: null,
        notify_emails: [],
        // EN-01 karar 2 (tm 350): the defaults until a workspace says otherwise.
        promo_block: { fraud_suspected: true, complaint_formal: false },
        updated_by: null,
        updated_at: null,
      });

      const foreignTeam = await owner.group.create({
        data: { licenseId: fx.b.licenseId, name: 'RG' },
        select: { id: true },
      });
      expect(
        (
          await server.put(
            '/risk-flags/settings',
            { rg_group_id: Number(foreignTeam.id) },
            auth(adminToken),
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await server.put(
            '/risk-flags/settings',
            {
              notify_emails: [
                'a@x.test',
                'b@x.test',
                'c@x.test',
                'd@x.test',
                'e@x.test',
                'f@x.test',
              ],
            },
            auth(adminToken),
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await server.put(
            '/risk-flags/settings',
            { notify_emails: ['not-an-email'] },
            auth(adminToken),
          )
        ).statusCode,
      ).toBe(400);
      expect((await server.put('/risk-flags/settings', {}, auth(adminToken))).statusCode).toBe(400);

      const team = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Sorumlu Oyun' },
        select: { id: true },
      });
      const saved = await server.put(
        '/risk-flags/settings',
        { rg_group_id: Number(team.id), notify_emails: ['RG@Operator.test'] },
        auth(adminToken),
      );
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({
        rg_group_id: Number(team.id),
        notify_emails: ['rg@operator.test'],
        updated_by: adminId,
      });
      // One field alone keeps the other.
      const kept = await server.put(
        '/risk-flags/settings',
        { notify_emails: [] },
        auth(adminToken),
      );
      expect(kept.json()).toMatchObject({ rg_group_id: Number(team.id), notify_emails: [] });

      // A deleted team reads as none.
      await owner.group.delete({
        where: { licenseId_id: { licenseId: fx.a.licenseId, id: team.id } },
      });
      expect((await server.get('/risk-flags/settings', auth(adminToken))).json()).toMatchObject({
        rg_group_id: null,
      });

      const entries = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'settings.risk_flags_updated' },
      });
      expect(entries).toHaveLength(2);
      expect(JSON.stringify(entries.map((row) => row.metadata))).not.toContain('operator.test');

      // Another workspace's settings are its own.
      expect(
        (await server.get('/risk-flags/settings', auth(foreignAdminToken))).json(),
      ).toMatchObject({ rg_group_id: null, notify_emails: [] });
    });
  });
});
