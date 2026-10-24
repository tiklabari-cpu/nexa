/**
 * Promotions and a flagged player (tm 350 · SiyahTuş analysis EN-01): a player
 * a risk flag keeps from promotions is shown no campaign — on any poll, by any
 * fire path, for a send written before the flag as well — and the card says
 * how many were held back.
 *
 * Asserted on the visitor's side of the wire (what the widget's poll
 * receives) and on the send rows the card counts. The flags themselves —
 * raising, clearing, who may — are `risk-flags-api.test.ts`'s; here they are
 * the input.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RiskFlagType } from '@siyahtus/types';
import { withTenant } from '../../src/lib/tenant.js';
import { deliverPendingCampaign } from '../../src/services/campaigns/campaign-delivery.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { mintForExistingCustomer } from '../helpers/member-token.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface PollState {
  campaign: { id: string; message: string } | null;
}

interface CampaignCard {
  id: string;
  performance: { displayed: number; chats: number; conversion: number; suppressed: number };
}

const PRICING_PAGE = 'https://shop.example/pricing';
const REASON = 'Operatör doğruladı: oyuncu kendini dışlamayı geri aldı.';

describe('promotions and a flagged player (EN-01 · tm 350)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  /** `customers:rw` in tenant A — the owner writing campaigns. */
  let writeToken: string;
  /** The owner's settings token (`access_rules:rw`). */
  let settingsToken: string;
  /** An admin (Manager) and a plain agent, with chat write scopes — for clearing. */
  let adminToken: string;
  let agentToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const minutesAgo = (n: number): Date => new Date(Date.now() - n * 60_000);

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

    const scoped = (ownerId: string, scopes: string[]) =>
      grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId,
        scopes,
      });
    writeToken = await scoped(fx.a.ownerAccountId, ['customers:rw']);
    settingsToken = await scoped(fx.a.ownerAccountId, ['access_rules:rw', 'access_rules:ro']);
    const admin = await owner.account.create({
      data: { email: `admin-${fx.a.licenseId}@example.test`, name: 'Admin', passwordHash: null },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: fx.a.licenseId, agentId: admin.id, role: 'admin' },
    });
    adminToken = await scoped(admin.id, ['chats--all:rw', 'chats--all:ro']);
    agentToken = await scoped(fx.a.agentAccountId, ['chats--all:rw', 'chats--all:ro']);
  });

  // --- Arrangement -----------------------------------------------------------

  /** A visitor with a recent visit on a page — someone a campaign targets on save. */
  async function seedVisitor(t: TenantFixture, name: string, url = PRICING_PAGE): Promise<string> {
    const startedAt = minutesAgo(2);
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name },
      select: { id: true },
    });
    await owner.visit.create({
      data: {
        customerId: customer.id,
        licenseId: t.licenseId,
        pages: [{ url, at: startedAt.toISOString() }],
        startedAt,
      },
    });
    return customer.id;
  }

  async function widgetToken(t: TenantFixture, customerId: string): Promise<string> {
    const response = await mintForExistingCustomer(server, t, customerId);
    expect(response.statusCode).toBe(200);
    return (response.json() as { token: string }).token;
  }

  async function poll(token: string): Promise<PollState> {
    const response = await server.get('/customer/chat', auth(token));
    expect(response.statusCode).toBe(200);
    return response.json() as PollState;
  }

  async function createCampaign(body: Record<string, unknown> = {}): Promise<{ id: string }> {
    const response = await server.post(
      '/campaigns',
      {
        name: 'Hoş geldin bonusu',
        conditions: { url_contains: '/pricing' },
        content: { message: '%100 yatırım bonusu seni bekliyor!' },
        ...body,
      },
      auth(writeToken),
    );
    expect(response.statusCode).toBe(201);
    return response.json() as { id: string };
  }

  async function card(campaignId: string): Promise<CampaignCard['performance']> {
    const response = await server.get('/campaigns', auth(writeToken));
    expect(response.statusCode).toBe(200);
    const items = (response.json() as { items: CampaignCard[] }).items;
    return items.find((item) => item.id === campaignId)!.performance;
  }

  let seq = 0;
  /**
   * A flag on the player, as the AI or an agent would leave it: a member flag
   * on the record, or a chat flag in an earlier (closed) conversation of theirs.
   */
  async function flag(
    t: TenantFixture,
    customerId: string,
    type: RiskFlagType,
    scope: 'member' | 'chat' = 'member',
  ): Promise<string> {
    let chatId: string | null = null;
    if (scope === 'chat') {
      seq += 1;
      chatId = 'c' + String(seq).padStart(11, '0');
      await owner.chat.create({
        data: { id: chatId, licenseId: t.licenseId, customerId, active: false },
      });
    }
    const row = await owner.riskFlag.create({
      data: {
        licenseId: t.licenseId,
        scope,
        chatId,
        customerId,
        type,
        severity: 'high',
        source: 'ai_classifier',
      },
      select: { id: true },
    });
    return row.id;
  }

  const sendOf = (campaignId: string, customerId: string) =>
    owner.campaignSend.findUniqueOrThrow({
      where: { campaignId_customerId: { campaignId, customerId } },
      select: { deliveredAt: true, suppressedAt: true, suppressedReason: true },
    });

  // --- The acceptance --------------------------------------------------------

  it('never carries a self-excluded player a matching campaign, and marks the send', async () => {
    const player = await seedVisitor(fx.a, 'Kendini dışlayan');
    await flag(fx.a, player, 'self_exclusion_request');
    const token = await widgetToken(fx.a, player);

    const campaign = await createCampaign();
    // Matched — the save fired at the live audience — but written held back.
    expect(await sendOf(campaign.id, player)).toMatchObject({
      deliveredAt: null,
      suppressedAt: expect.any(Date),
      suppressedReason: 'self_exclusion_request',
    });

    for (let i = 0; i < 3; i += 1) expect((await poll(token)).campaign).toBeNull();
    expect((await sendOf(campaign.id, player)).deliveredAt).toBeNull();
    expect(await card(campaign.id)).toEqual({
      displayed: 0,
      chats: 0,
      conversion: 0,
      suppressed: 1,
    });
  });

  it('holds back a send written before the flag, at the poll', async () => {
    const player = await seedVisitor(fx.a, 'Önce eşleşti');
    const token = await widgetToken(fx.a, player);
    const campaign = await createCampaign();
    expect(await sendOf(campaign.id, player)).toMatchObject({ suppressedAt: null });

    // Raised by a path that suppresses nothing itself (straight into the
    // table): the poll is the last gate.
    await flag(fx.a, player, 'rg_signal');

    expect((await poll(token)).campaign).toBeNull();
    expect(await sendOf(campaign.id, player)).toMatchObject({
      deliveredAt: null,
      suppressedAt: expect.any(Date),
      suppressedReason: 'rg_signal',
    });
  });

  it('holds back the queued sends in the raise’s own transaction when an agent flags the player', async () => {
    // A visitor in a conversation, with a campaign owed (held while they chat).
    const minted = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    const visitorHeaders = auth((minted.json() as { token: string }).token);
    const sent = await server.post(
      '/customer/chat/events',
      { text: 'hesabımı kapatın, bırakmak istiyorum' },
      visitorHeaders,
    );
    expect(sent.statusCode).toBe(201);
    const chatId = (sent.json() as { chat_id: string }).chat_id;
    const { customerId } = await owner.chat.findUniqueOrThrow({
      where: { id: chatId },
      select: { customerId: true },
    });
    const campaign = await createCampaign();
    await owner.campaignSend.create({
      data: { licenseId: fx.a.licenseId, campaignId: campaign.id, customerId },
    });

    const raised = await server.post(
      `/chats/${chatId}/risk-flags`,
      { type: 'self_exclusion_request' },
      auth(adminToken),
    );
    expect(raised.statusCode).toBe(201);
    await server.app.riskFlags.idle();

    // No poll in between: the raise itself held it back.
    expect(await sendOf(campaign.id, customerId)).toMatchObject({
      deliveredAt: null,
      suppressedReason: 'self_exclusion_request',
    });
  });

  it('keeps a suppressed send suppressed once the flag is cleared — and clearing takes a reason and the role', async () => {
    const player = await seedVisitor(fx.a, 'Sonra temizlendi');
    const flagId = await flag(fx.a, player, 'underage_suspected');
    const token = await widgetToken(fx.a, player);
    const campaign = await createCampaign();
    expect((await poll(token)).campaign).toBeNull();

    const clear = (body: unknown, as: string) =>
      server.app.inject({
        method: 'DELETE',
        url: server.url(`/risk-flags/${flagId}`),
        payload: body as object,
        headers: auth(as),
      });
    expect((await clear({}, adminToken)).statusCode).toBe(400);
    expect((await clear({ reason: REASON }, agentToken)).statusCode).toBe(403);
    expect((await clear({ reason: REASON }, adminToken)).statusCode).toBe(200);
    await server.app.riskFlags.idle();
    const audit = await owner.auditLogEntry.findFirst({
      where: {
        licenseId: fx.a.licenseId,
        action: 'risk_flag.cleared',
        target: `risk_flag:${flagId}`,
      },
    });
    expect(audit).not.toBeNull();

    // The player is shown campaigns again — but not the one held back.
    expect((await poll(token)).campaign).toBeNull();
    expect(await sendOf(campaign.id, player)).toMatchObject({
      deliveredAt: null,
      suppressedReason: 'underage_suspected',
    });
    const next = await createCampaign({ name: 'Yeni', content: { message: 'Yeni kampanya' } });
    expect((await poll(token)).campaign?.id).toBe(next.id);
  });

  it('delivers nothing when the flags cannot be read, and leaves the send owed', async () => {
    const player = await seedVisitor(fx.a, 'Okunamadı');
    const campaign = await createCampaign();
    const tenant = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };

    const result = await withTenant(owner, tenant, async (tx) => {
      const delivered = await deliverPendingCampaign(
        tx,
        tenant,
        { customerId: player, hasOpenChat: false, bannedAt: null },
        new Date(),
        // A read that fails in the database, as an unreadable table would.
        async (client) => {
          await client.$queryRawUnsafe('SELECT * FROM risk_flags_unreadable');
          return new Map();
        },
      );
      // The poll's transaction goes on after the failure (savepoint).
      const after = await tx.customer.count({ where: { id: player } });
      return { delivered, after };
    });

    expect(result).toEqual({ delivered: null, after: 1 });
    expect(await sendOf(campaign.id, player)).toEqual({
      deliveredAt: null,
      suppressedAt: null,
      suppressedReason: null,
    });
  });

  // --- Whose flags ------------------------------------------------------------

  it('blocks on suspected fraud by default and not on a complaint; the workspace may change both', async () => {
    const fraud = await seedVisitor(fx.a, 'Dolandırıcılık');
    const complaint = await seedVisitor(fx.a, 'Şikâyet');
    await flag(fx.a, fraud, 'fraud_suspected', 'chat');
    await flag(fx.a, complaint, 'complaint_formal', 'chat');
    const fraudToken = await widgetToken(fx.a, fraud);
    const complaintToken = await widgetToken(fx.a, complaint);

    const first = await createCampaign();
    expect((await sendOf(first.id, fraud)).suppressedReason).toBe('fraud_suspected');
    expect((await poll(complaintToken)).campaign?.id).toBe(first.id);

    const put = await server.put(
      '/risk-flags/settings',
      { promo_block: { fraud_suspected: false, complaint_formal: true }, reason: REASON },
      auth(settingsToken),
    );
    expect(put.statusCode).toBe(200);
    expect((put.json() as { promo_block: unknown }).promo_block).toEqual({
      fraud_suspected: false,
      complaint_formal: true,
    });

    const second = await createCampaign({ name: 'İkinci', content: { message: 'İkinci' } });
    expect((await poll(fraudToken)).campaign?.id).toBe(second.id);
    expect((await sendOf(second.id, complaint)).suppressedReason).toBe('complaint_formal');
    // The first, held back under the old policy, stays held back.
    expect((await sendOf(first.id, fraud)).deliveredAt).toBeNull();
  });

  it('refuses to switch a locked type off, or to decide a type no workspace decides about', async () => {
    const put = (promo_block: Record<string, boolean>) =>
      server.put('/risk-flags/settings', { promo_block, reason: REASON }, auth(settingsToken));

    for (const type of ['rg_signal', 'self_exclusion_request', 'underage_suspected', 'self_harm']) {
      const refused = await put({ [type]: false });
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({
        error: { details: { reason: 'promo_flag_locked', type } },
      });
    }
    const other = await put({ abusive: true });
    expect(other.statusCode).toBe(400);
    expect(other.json()).toMatchObject({
      error: { details: { reason: 'promo_flag_not_configurable' } },
    });
    // A locked type left on is accepted and changes nothing.
    expect((await put({ rg_signal: true })).statusCode).toBe(200);

    const read = await server.get('/risk-flags/settings', auth(settingsToken));
    expect((read.json() as { promo_block: unknown }).promo_block).toEqual({
      fraud_suspected: true,
      complaint_formal: false,
    });
  });

  it('files the promotion policy change with its reason in the audit log', async () => {
    const put = await server.put(
      '/risk-flags/settings',
      { promo_block: { complaint_formal: true }, reason: REASON },
      auth(settingsToken),
    );
    expect(put.statusCode).toBe(200);
    const entry = await owner.auditLogEntry.findFirst({
      where: { licenseId: fx.a.licenseId, action: 'settings.risk_flags_updated' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry?.metadata).toMatchObject({
      changed: ['promo_block'],
      promo_block_before: { fraud_suspected: true, complaint_formal: false },
      promo_block: { fraud_suspected: true, complaint_formal: true },
      reason: REASON,
    });
  });

  it('holds a flag on one record over the records linked to it as the same person (ID-03)', async () => {
    const flagged = await seedVisitor(fx.a, 'Eski cihaz', 'https://shop.example/home');
    const device = await seedVisitor(fx.a, 'Yeni cihaz');
    const third = await seedVisitor(fx.a, 'Üçüncü cihaz', 'https://shop.example/home');
    await flag(fx.a, flagged, 'self_exclusion_request');
    const link = (x: string, y: string) => {
      const [a, b] = [x, y].sort();
      return owner.customerIdentityLink.create({
        data: {
          organizationId: fx.a.organizationId,
          customerAId: a!,
          customerBId: b!,
          linkedBy: fx.a.ownerAccountId,
        },
        select: { id: true },
      });
    };
    // A chain: the new device is linked to a third record, that one to the flagged.
    await link(device, third);
    const second = await link(third, flagged);

    const token = await widgetToken(fx.a, device);
    const campaign = await createCampaign();
    expect((await sendOf(campaign.id, device)).suppressedReason).toBe('self_exclusion_request');

    const flags = await server.get(
      `/customers/${device}/risk-flags?status=active`,
      auth(adminToken),
    );
    expect(flags.json()).toMatchObject({
      promo_suppressed: true,
      promo_suppressed_reason: 'self_exclusion_request',
    });

    // Unlinked: the record stands on its own again.
    await owner.customerIdentityLink.update({
      where: { id: second.id },
      data: { unlinkedAt: new Date(), unlinkedBy: fx.a.ownerAccountId },
    });
    const next = await createCampaign({ name: 'Sonraki', content: { message: 'Sonraki' } });
    expect((await poll(token)).campaign?.id).toBe(next.id);
  });

  it("does not hold another workspace's flag against this workspace's player", async () => {
    const player = await seedVisitor(fx.a, 'İki çalışma alanı');
    // Workspace B's judgement, about A's customer record.
    await flag(fx.b, player, 'self_exclusion_request');
    const token = await widgetToken(fx.a, player);
    const campaign = await createCampaign();
    expect((await poll(token)).campaign?.id).toBe(campaign.id);
  });

  it('writes the send held back when a flagged visitor’s own page view matches', async () => {
    const minted = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    const visitor = minted.json() as { token: string; customer_id: string };
    await flag(fx.a, visitor.customer_id, 'rg_signal');
    // Running before the visitor arrives: only the page view can match them.
    const campaign = await createCampaign();

    const sent = await server.post(
      '/customer/chat/events',
      { text: 'merhaba', url: PRICING_PAGE },
      auth(visitor.token),
    );
    expect(sent.statusCode).toBe(201);
    expect(await sendOf(campaign.id, visitor.customer_id)).toMatchObject({
      deliveredAt: null,
      suppressedReason: 'rg_signal',
    });
  });

  it('answers a player’s flag list with whether they are shown campaigns', async () => {
    const clean = await seedVisitor(fx.a, 'Temiz');
    const response = await server.get(`/customers/${clean}/risk-flags`, auth(adminToken));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [],
      promo_suppressed: false,
      promo_suppressed_reason: null,
    });
  });
});
