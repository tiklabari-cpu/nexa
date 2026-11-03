/**
 * Custom panels (KN-05 · owner decision K29 · tm 379) against a real Postgres.
 *
 * KN-05's acceptance, server half:
 *   - a panel shows on its teams' conversations and on no other team's;
 *   - the token names the right conversation and lives five minutes;
 *   - the username never goes into an address (a `link` token carries none);
 * plus the gates K29 puts on the server: only an admin-saved `https://`
 * address (API and CHECK), audit on every definition change, another
 * workspace's panel absent (NFR-S5), RLS on the table, the secret shown once
 * and never stored readable.
 *
 * The browser half — sandbox, origin/channel check, `insert_text` — is
 * `apps/web/src/features/inbox/panelBridge.test.ts` and
 * `apps/e2e/tests/custom-panels.spec.ts`.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CUSTOM_PANELS_MAX,
  defaultScopesForRole,
  generateShortId,
  type CustomPanelTokenClaims,
} from '@siyahtus/types';
import { withTenant } from '../../src/lib/tenant.js';
import { verifyPanelContextToken } from '../../src/services/custom-panels/panel-token.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const USERNAME = 'ayse_k1987';

type Headers = Record<string, string>;

interface PanelBody {
  id: string;
  name: string;
  url: string;
  origin: string;
  visible_group_ids: number[];
  enabled: boolean;
  signing_secret?: string;
}

interface TokenBody {
  token: string;
  expires_at: string;
  delivery: 'frame' | 'link';
}

describe('custom panels (KN-05 · tm 379)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let seq = 0;

  let adminA: Headers;
  let agentA: Headers;
  let adminB: Headers;
  let founderA: Headers;

  const bearer = (token: string): Headers => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await app.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    seq = 0;
    server.app.permissionMatrix.cache.invalidate();
    await clearRateLimits(server.app);
    const token = (t: TenantFixture, ownerId: string, role: 'owner' | 'agent') =>
      grantToken(owner, {
        licenseId: t.licenseId,
        organizationId: t.organizationId,
        ownerId,
        scopes: defaultScopesForRole(role),
      });
    adminA = bearer(await token(fx.a, fx.a.ownerAccountId, 'owner'));
    agentA = bearer(await token(fx.a, fx.a.agentAccountId, 'agent'));
    adminB = bearer(await token(fx.b, fx.b.ownerAccountId, 'owner'));
    // The founder's narrow PAT for the permission matrix (tm 325.2).
    founderA = bearer(
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
  });

  async function group(t: TenantFixture, name: string): Promise<bigint> {
    return (
      await owner.group.create({ data: { licenseId: t.licenseId, name }, select: { id: true } })
    ).id;
  }

  /** A conversation routed to `groupId`, with the player's typed username, and its threads. */
  async function chat(
    t: TenantFixture,
    groupId: bigint | null,
    threads = 1,
  ): Promise<{ chatId: string; threadIds: string[] }> {
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name: `Visitor ${(seq += 1)}`, username: USERNAME },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: customer.id },
    });
    const threadIds: string[] = [];
    for (let i = 0; i < threads; i += 1) {
      const id = generateShortId();
      await owner.thread.create({
        data: {
          id,
          chatId,
          licenseId: t.licenseId,
          active: i === threads - 1,
          ...(i === threads - 1 ? {} : { closedAt: new Date(Date.now() - 30_000) }),
          createdAt: new Date(Date.now() - (threads - i) * 60_000),
        },
      });
      threadIds.push(id);
    }
    if (groupId !== null) await owner.chatAccess.create({ data: { chatId, groupId } });
    return { chatId, threadIds };
  }

  async function createPanel(
    auth: Headers,
    body: Record<string, unknown>,
  ): Promise<PanelBody & { signing_secret: string }> {
    const res = await server.post(
      '/settings/custom-panels',
      { name: 'Back-office', url: 'https://bo.example/player?view=card', ...body },
      auth,
    );
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  }

  const panelsOf = async (auth: Headers, chatId: string): Promise<string[]> => {
    const res = await server.get(`/chats/${chatId}/panels`, auth);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { items: Array<{ id: string }> }).items.map((p) => p.id);
  };

  const mint = (auth: Headers, chatId: string, panelId: string, body?: unknown) =>
    server.post(`/chats/${chatId}/panels/${panelId}/context-token`, body ?? {}, auth);

  const claimsOf = (token: string): CustomPanelTokenClaims =>
    JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as CustomPanelTokenClaims;

  async function auditCount(action: string, licenseId: bigint): Promise<number> {
    return owner.auditLogEntry.count({ where: { action, licenseId } });
  }

  // ===========================================================================
  // Definition (Settings › Integrations › Custom panels)
  // ===========================================================================

  describe('defining a panel', () => {
    it('shows the secret once, keeps it sealed, never lists it, and audits the change', async () => {
      const before = await auditCount('custom_panel.created', fx.a.licenseId);
      const created = await createPanel(adminA, { name: '  Player card  ' });
      expect(created).toMatchObject({
        name: 'Player card',
        url: 'https://bo.example/player?view=card',
        origin: 'https://bo.example',
        visible_group_ids: [],
        enabled: true,
      });
      expect(created.signing_secret).toMatch(/^stp_[A-Za-z0-9_-]{43}$/);

      const list = await server.get('/settings/custom-panels', adminA);
      expect(list.statusCode).toBe(200);
      expect(list.body).not.toContain(created.signing_secret);
      expect((list.json() as { items: PanelBody[] }).items.map((p) => p.id)).toEqual([created.id]);

      const row = await owner.customPanel.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.signingSecretCiphertext).not.toContain(created.signing_secret);
      expect(row.signingSecretCiphertext.startsWith('v1:')).toBe(true);

      expect(await auditCount('custom_panel.created', fx.a.licenseId)).toBe(before + 1);
      const entry = await owner.auditLogEntry.findFirstOrThrow({
        where: { action: 'custom_panel.created', licenseId: fx.a.licenseId },
      });
      expect(entry.target).toBe(`custom_panel:${created.id}`);
      expect(JSON.stringify(entry.metadata)).not.toContain(created.signing_secret);
      expect(entry.metadata).toMatchObject({ origin: 'https://bo.example' });
    });

    it('takes only an https address without credentials or a fragment', async () => {
      for (const [url, reason] of [
        ['http://bo.example/', 'url_not_https'],
        ['https://user:pw@bo.example/', 'url_credentials'],
        ['https://bo.example/#card', 'url_fragment'],
        ['javascript:alert(1)', 'url_not_https'],
        ['bo.example', 'url_invalid'],
      ] as const) {
        const res = await server.post('/settings/custom-panels', { name: 'X', url }, adminA);
        expect(res.statusCode, url).toBe(400);
        expect(res.json().error.details?.reason, url).toBe(reason);
      }
      expect(await owner.customPanel.count()).toBe(0);
    });

    it('refuses a raw write the API would refuse (the CHECKs are the floor)', async () => {
      const base = {
        licenseId: fx.a.licenseId,
        name: 'Raw',
        signingSecretCiphertext: 'v1:x:y:z',
      };
      for (const url of [
        'http://bo.example/',
        'https://u:p@bo.example/',
        'https://bo.example/#x',
      ]) {
        await expect(owner.customPanel.create({ data: { ...base, url } }), url).rejects.toThrow(
          /custom_panels_url_check/,
        );
      }
      await expect(
        owner.customPanel.create({ data: { ...base, url: 'https://bo.example/', name: ' pad ' } }),
      ).rejects.toThrow(/custom_panels_name_check/);
      await expect(
        owner.customPanel.create({
          data: {
            ...base,
            url: 'https://bo.example/',
            visibleGroupIds: Array.from({ length: 51 }, (_, i) => BigInt(i + 1)),
          },
        }),
      ).rejects.toThrow(/custom_panels_visible_group_ids_check/);
    });

    it('names only this workspace’s teams, and at most 20 panels', async () => {
      const theirs = await group(fx.b, 'Their team');
      const unknown = await server.post(
        '/settings/custom-panels',
        { name: 'X', url: 'https://bo.example/', visible_group_ids: [Number(theirs)] },
        adminA,
      );
      expect(unknown.statusCode).toBe(400);
      expect(unknown.json().error.details?.reason).toBe('unknown_group');

      for (let i = 0; i < CUSTOM_PANELS_MAX; i += 1) await createPanel(adminA, { name: `P${i}` });
      const over = await server.post(
        '/settings/custom-panels',
        { name: 'One too many', url: 'https://bo.example/' },
        adminA,
      );
      expect(over.statusCode).toBe(400);
      expect(over.json().error.details?.reason).toBe('limit_reached');
    });

    it('is an owner/admin act: an agent is refused even with the scope on a token', async () => {
      expect((await server.get('/settings/custom-panels', agentA)).statusCode).toBe(403);
      const scoped = bearer(
        await grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.agentAccountId,
          scopes: ['access_rules:rw'],
        }),
      );
      const res = await server.post(
        '/settings/custom-panels',
        { name: 'X', url: 'https://bo.example/' },
        scoped,
      );
      expect(res.statusCode).toBe(403);
      expect(await owner.customPanel.count()).toBe(0);
    });

    it('changes, re-keys and removes with an audit entry each; a no-op change writes none', async () => {
      const support = await group(fx.a, 'Support');
      const created = await createPanel(adminA, {});

      const patched = await server.patch(
        `/settings/custom-panels/${created.id}`,
        { name: 'Renamed', visible_group_ids: [Number(support), Number(support)], enabled: false },
        adminA,
      );
      expect(patched.statusCode, patched.body).toBe(200);
      expect(patched.json()).toMatchObject({
        name: 'Renamed',
        visible_group_ids: [Number(support)],
        enabled: false,
      });
      const updated = await owner.auditLogEntry.findFirstOrThrow({
        where: { action: 'custom_panel.updated', licenseId: fx.a.licenseId },
      });
      expect(updated.metadata).toMatchObject({ fields: ['name', 'enabled', 'visible_group_ids'] });

      const noop = await server.patch(
        `/settings/custom-panels/${created.id}`,
        { name: 'Renamed' },
        adminA,
      );
      expect(noop.statusCode).toBe(200);
      expect(await auditCount('custom_panel.updated', fx.a.licenseId)).toBe(1);

      const empty = await server.patch(`/settings/custom-panels/${created.id}`, {}, adminA);
      expect(empty.statusCode).toBe(400);

      const rotated = await server.post(
        `/settings/custom-panels/${created.id}/rotate-secret`,
        {},
        adminA,
      );
      expect(rotated.statusCode).toBe(200);
      expect(rotated.headers['cache-control']).toBe('no-store');
      const next = (rotated.json() as PanelBody).signing_secret!;
      expect(next).not.toBe(created.signing_secret);
      expect(await auditCount('custom_panel.secret_rotated', fx.a.licenseId)).toBe(1);

      expect((await server.del(`/settings/custom-panels/${created.id}`, adminA)).statusCode).toBe(
        204,
      );
      expect((await server.del(`/settings/custom-panels/${created.id}`, adminA)).statusCode).toBe(
        404,
      );
      expect(await auditCount('custom_panel.deleted', fx.a.licenseId)).toBe(1);
    });

    it('answers another workspace’s panel as absent, on every verb (NFR-S5)', async () => {
      const created = await createPanel(adminA, {});
      const path = `/settings/custom-panels/${created.id}`;
      expect((await server.patch(path, { name: 'Mine now' }, adminB)).statusCode).toBe(404);
      expect((await server.post(`${path}/rotate-secret`, {}, adminB)).statusCode).toBe(404);
      expect((await server.del(path, adminB)).statusCode).toBe(404);
      const theirList = await server.get('/settings/custom-panels', adminB);
      expect((theirList.json() as { items: unknown[] }).items).toEqual([]);
      const row = await owner.customPanel.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.name).toBe('Back-office');
    });
  });

  // ===========================================================================
  // On a conversation
  // ===========================================================================

  describe('on a conversation', () => {
    it('shows a team’s panel on that team’s conversations and on no other team’s', async () => {
      const support = await group(fx.a, 'Support');
      const sales = await group(fx.a, 'Sales');
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId: support, agentId: fx.a.agentAccountId },
      });
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId: sales, agentId: fx.a.agentAccountId },
      });
      const supportPanel = await createPanel(adminA, {
        name: 'Support card',
        visible_group_ids: [Number(support)],
      });
      const everywhere = await createPanel(adminA, { name: 'All teams' });
      const off = await createPanel(adminA, { name: 'Off', enabled: false });

      const supportChat = await chat(fx.a, support);
      const salesChat = await chat(fx.a, sales);

      expect(await panelsOf(agentA, supportChat.chatId)).toEqual([supportPanel.id, everywhere.id]);
      expect(await panelsOf(agentA, salesChat.chatId)).toEqual([everywhere.id]);
      // An admin who sees every conversation still sees the panel only on its team's.
      expect(await panelsOf(adminA, salesChat.chatId)).toEqual([everywhere.id]);

      // …and no token for it there either: the same rule decides both.
      expect((await mint(agentA, salesChat.chatId, supportPanel.id)).statusCode).toBe(404);
      expect((await mint(agentA, supportChat.chatId, off.id)).statusCode).toBe(404);
      expect((await mint(agentA, supportChat.chatId, supportPanel.id)).statusCode).toBe(200);
    });

    it('signs the right conversation for five minutes: org, chat, newest thread, agent, player', async () => {
      const support = await group(fx.a, 'Support');
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId: support, agentId: fx.a.agentAccountId },
      });
      const panel = await createPanel(adminA, { visible_group_ids: [Number(support)] });
      const { chatId, threadIds } = await chat(fx.a, support, 2);

      const res = await mint(agentA, chatId, panel.id);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = res.json() as TokenBody;
      expect(body.delivery).toBe('frame');

      const verified = verifyPanelContextToken(body.token, panel.signing_secret, {
        panelId: panel.id,
      });
      expect(verified.ok).toBe(true);
      const claims = claimsOf(body.token);
      expect(claims).toMatchObject({
        iss: 'siyahtus',
        aud: `siyahtus-panel:${panel.id}`,
        org_id: fx.a.organizationId,
        license_id: fx.a.licenseId.toString(),
        chat_id: chatId,
        thread_id: threadIds[1],
        agent_id: fx.a.agentAccountId,
        player: { username: USERNAME, username_verified: false },
      });
      expect(claims.exp - claims.iat).toBe(300);
      expect(new Date(body.expires_at).getTime()).toBe(claims.exp * 1000);

      // The username the operator's site signed (ID-03 · K28 · tm 388) reaches
      // the panel as verified; a typed one never does.
      const { customerId } = await owner.chat.findUniqueOrThrow({
        where: { id: chatId },
        select: { customerId: true },
      });
      await owner.customer.update({
        where: { id: customerId },
        data: {
          platformUserId: 'player-388',
          identityVerifiedAt: new Date(),
          usernameVerified: true,
        },
      });
      const signed = await mint(agentA, chatId, panel.id);
      expect(claimsOf((signed.json() as TokenBody).token)).toMatchObject({
        player: { username: USERNAME, username_verified: true },
      });

      // KK: the token is no good five minutes on.
      const later = new Date((claims.exp + 1) * 1000);
      expect(
        verifyPanelContextToken(body.token, panel.signing_secret, {
          panelId: panel.id,
          now: later,
        }),
      ).toEqual({ ok: false, reason: 'expired' });

      // A rotated secret no longer verifies a token signed under the old one.
      const rotated = await server.post(
        `/settings/custom-panels/${panel.id}/rotate-secret`,
        {},
        adminA,
      );
      const fresh = (await mint(agentA, chatId, panel.id)).json() as TokenBody;
      expect(
        verifyPanelContextToken(fresh.token, panel.signing_secret, { panelId: panel.id }).ok,
      ).toBe(false);
      expect(
        verifyPanelContextToken(fresh.token, (rotated.json() as PanelBody).signing_secret!, {
          panelId: panel.id,
        }).ok,
      ).toBe(true);
    });

    it('puts no username in a link token — the new-tab address carries it (GV-05)', async () => {
      const panel = await createPanel(adminA, {});
      const { chatId } = await chat(fx.a, null);
      const res = await mint(adminA, chatId, panel.id, { delivery: 'link' });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as TokenBody;
      expect(body.delivery).toBe('link');
      expect(claimsOf(body.token).player).toBeUndefined();
      expect(Buffer.from(body.token.split('.')[1]!, 'base64url').toString()).not.toContain(
        USERNAME,
      );
      expect((await mint(adminA, chatId, panel.id, { delivery: 'url' })).statusCode).toBe(400);
    });

    it('leaves the player out when the role may not see contact details (RL-02)', async () => {
      const support = await group(fx.a, 'Support');
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId: support, agentId: fx.a.agentAccountId },
      });
      const panel = await createPanel(adminA, {});
      const { chatId } = await chat(fx.a, support);
      const hide = await server.put(
        '/settings/permissions',
        {
          changes: [{ role: 'agent', capability: 'customers.contact.view', value: 'off' }],
          reason: 'Ekip üyeleri oyuncu iletişimini görmesin',
        },
        founderA,
      );
      expect(hide.statusCode, hide.body).toBe(200);

      const res = await mint(agentA, chatId, panel.id);
      expect(res.statusCode, res.body).toBe(200);
      const claims = claimsOf((res.json() as TokenBody).token);
      expect(claims.player).toBeUndefined();
      expect(claims.chat_id).toBe(chatId);
    });

    it('answers a conversation the caller may not see as absent, whatever its panels (NFR-S5)', async () => {
      const support = await group(fx.a, 'Support');
      const sales = await group(fx.a, 'Sales');
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId: support, agentId: fx.a.agentAccountId },
      });
      const panel = await createPanel(adminA, {});
      const salesChat = await chat(fx.a, sales);
      expect((await server.get(`/chats/${salesChat.chatId}/panels`, agentA)).statusCode).toBe(404);
      expect((await mint(agentA, salesChat.chatId, panel.id)).statusCode).toBe(404);

      // Another workspace: its conversation with this panel, this conversation with its token.
      const theirChat = await chat(fx.b, null);
      expect((await mint(adminA, theirChat.chatId, panel.id)).statusCode).toBe(404);
      const mine = await chat(fx.a, null);
      expect((await mint(adminB, mine.chatId, panel.id)).statusCode).toBe(404);
      expect((await server.get(`/chats/${mine.chatId}/panels`, adminB)).statusCode).toBe(404);
    });

    it('is not a customer surface: a widget token reaches neither route', async () => {
      const panel = await createPanel(adminA, {});
      const visitor = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        { origin: `https://${fx.a.trustedDomain}` },
      );
      expect(visitor.statusCode).toBe(200);
      const auth = bearer((visitor.json() as { token: string }).token);
      const { chatId } = await chat(fx.a, null);
      expect([401, 403, 404]).toContain(
        (await server.get(`/chats/${chatId}/panels`, auth)).statusCode,
      );
      expect([401, 403, 404]).toContain((await mint(auth, chatId, panel.id)).statusCode);
    });
  });

  // ===========================================================================
  // The table
  // ===========================================================================

  describe('the custom_panels table', () => {
    it('has row-level security and a tenant policy', async () => {
      const security = await owner.$queryRaw<Array<{ enabled: boolean }>>`
        SELECT relrowsecurity AS enabled FROM pg_class WHERE relname = 'custom_panels'
      `;
      expect(security).toEqual([{ enabled: true }]);
      const policies = await owner.$queryRaw<Array<{ policyname: string }>>`
        SELECT policyname FROM pg_policies WHERE tablename = 'custom_panels'
      `;
      expect(policies).toEqual([{ policyname: 'custom_panels_tenant' }]);
    });

    it('hides another workspace’s panels and refuses to write into one', async () => {
      const mine = await createPanel(adminA, {});
      await createPanel(adminB, { name: 'Theirs' });
      const tenant = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
      const visible = await withTenant(app, tenant, (tx) =>
        tx.customPanel.findMany({ select: { id: true } }),
      );
      expect(visible.map((row) => row.id)).toEqual([mine.id]);
      await expect(
        withTenant(app, tenant, (tx) =>
          tx.customPanel.create({
            data: {
              licenseId: fx.b.licenseId,
              name: 'Planted',
              url: 'https://bo.example/',
              signingSecretCiphertext: 'v1:x:y:z',
            },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);
      const [count] = await app.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count FROM custom_panels
      `;
      expect(Number(count?.count ?? -1)).toBe(0);
    });
  });
});
