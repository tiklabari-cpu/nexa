/**
 * The owner's K7 decisions as defaults (tm 325.5 · SiyahTuş analysis RL-02,
 * RL-02-S1/S3/S4/S5).
 *
 * RL-02 shipped the permission matrix with the product's behaviour unchanged;
 * this is the separate, visible step that moves the defaults to what the owner
 * decided — in a workspace that never touched the matrix:
 *
 *   - an Ekip Üyesi sees their own teams' chats, never another team's;
 *   - an Ekip Lideri sees their own teams' reports — no workspace-wide report
 *     until the `team` level exists (#368);
 *   - a Yönetici sees billing and does not change it, and the Founder cannot
 *     hand it back: the cell is locked;
 *   - only the Kurucu changes the matrix.
 *
 * The rule cell by cell is `capabilities.test.ts`; how each kind of credential
 * resolves it is `credential-scopes.test.ts`.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultScopesForRole, generateShortId } from '@siyahtus/types';
import { deriveCodeChallenge, generateToken } from '../../src/lib/crypto.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  TEST_PASSWORD,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const REASON = 'Faturayı yalnız Kurucu yönetir';
const CARD = {
  brand: 'visa',
  last4: '4242',
  exp_month: 12,
  exp_year: 2030,
  holder_name: 'Jane Doe',
};

type Headers = Record<string, string>;

interface Me {
  role: string;
  scopes: string[];
  capabilities: Record<string, string>;
}

interface MatrixBody {
  capabilities: Array<{
    key: string;
    owner_only: boolean;
    floor_role: string;
    cells: Array<{ role: string; value: string; default: string; lock: string | null }>;
  }>;
}

interface ErrorBody {
  error: { type: string; details?: Record<string, unknown> };
}

/** Every billing write, with a body each would accept from the owner. */
const BILLING_WRITES: Array<{ method: 'patch' | 'put' | 'post'; path: string; body: unknown }> = [
  { method: 'patch', path: '/billing/subscription', body: { seats: 2 } },
  { method: 'put', path: '/billing/payment-method', body: CARD },
  { method: 'post', path: '/billing/api-packages', body: { package_id: 'starter' } },
  { method: 'post', path: '/billing/ai-packages', body: { packs: 1, idempotency_key: 'k7-pack' } },
];

const BILLING_READS = ['/billing/subscription', '/billing/invoices', '/billing/payment-method'];

describe('the owner’s K7 defaults (RL-02 · tm 325.5)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
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
    // `seedFixtures` hands the next test the same licence ids; the cached
    // matrix of the workspace before must not answer for this one.
    server.app.permissionMatrix.cache.invalidate();
    await clearRateLimits(server.app);
  });

  afterEach(async () => {
    await server.app.backgroundMail.settled();
  });

  const bearer = (token: string): Headers => ({ authorization: `Bearer ${token}` });
  /** A PAT travels as Basic `account_id:token` (v2-03 §1.4). */
  const basic = (accountId: string, token: string): Headers => ({
    authorization: `Basic ${Buffer.from(`${accountId}:${token}`).toString('base64')}`,
  });

  /** The real sign-in through the workspace's own client: authorize with PKCE, exchange the code. */
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

  async function me(auth: Headers): Promise<Me> {
    const res = await server.get('/auth/me', auth);
    expect(res.statusCode).toBe(200);
    return res.json<Me>();
  }

  const status = async (auth: Headers, path: string): Promise<number> =>
    (await server.get(path, auth)).statusCode;

  async function write(auth: Headers, call: (typeof BILLING_WRITES)[number]): Promise<number> {
    const res = await server[call.method](call.path, call.body, auth);
    return res.statusCode;
  }

  // =========================================================================
  // Ekip Üyesi: their own teams' chats
  // =========================================================================

  describe('Ekip Üyesi sees only their own teams’ chats', () => {
    async function chat(groupId: bigint, active = true): Promise<string> {
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: `Visitor ${(seq += 1)}` },
        select: { id: true },
      });
      const chatId = generateShortId();
      await owner.chat.create({
        data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active },
      });
      await owner.thread.create({
        data: {
          id: generateShortId(),
          chatId,
          licenseId: fx.a.licenseId,
          active,
          ...(active ? {} : { closedAt: new Date() }),
        },
      });
      await owner.chatAccess.create({ data: { chatId, groupId } });
      return chatId;
    }

    async function group(name: string): Promise<bigint> {
      return (
        await owner.group.create({
          data: { licenseId: fx.a.licenseId, name },
          select: { id: true },
        })
      ).id;
    }

    const listed = async (auth: Headers, query = ''): Promise<string[]> => {
      const res = await server.get(`/chats${query}`, auth);
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { items: Array<{ id: string }> }).items.map((c) => c.id).sort();
    };

    it('lists, opens and archives only their own teams’ chats; another team’s is absent (FR-MOD-04.RBAC · NFR-S5)', async () => {
      const support = await group('Support');
      const sales = await group('Sales');
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId: support, agentId: fx.a.agentAccountId },
      });
      const ours = await chat(support);
      const theirs = await chat(sales);
      const oursArchived = await chat(support, false);
      const theirsArchived = await chat(sales, false);

      const session = await signIn(fx.a, fx.a.agentEmail);
      expect((await me(session)).capabilities['chats.view']).toBe('team');
      expect((await me(session)).scopes).not.toContain('chats--all:rw');

      expect(await listed(session)).toContain(ours);
      expect(await listed(session)).not.toContain(theirs);
      expect(await status(session, `/chats/${ours}`)).toBe(200);
      expect(await status(session, `/chats/${theirs}`)).toBe(404);

      const archive = await listed(session, '?view=archived');
      expect(archive).toContain(oursArchived);
      expect(archive).not.toContain(theirsArchived);
      expect(await status(session, `/chats/${theirsArchived}`)).toBe(404);

      // The Yönetici, for contrast, sees the workspace.
      const admin = await signIn(fx.a, (await member(fx.a, 'admin')).email);
      expect(await listed(admin)).toEqual(expect.arrayContaining([ours, theirs]));
    });
  });

  // =========================================================================
  // Ekip Lideri: no workspace-wide report
  // =========================================================================

  describe('Ekip Lideri sees no other team’s figures', () => {
    it('opens their teams’ conversation reports, never a workspace-wide one or the bill (#368) (FR-MOD-04.RBAC)', async () => {
      const lead = await signIn(fx.a, (await member(fx.a, 'team_lead')).email);
      const mine = await me(lead);
      // `team` since tm 368: the server bounds the report to the teams they lead.
      expect(mine.capabilities['reports.view']).toBe('team');
      expect(mine.scopes).toContain('reports_read--groups');
      expect(mine.scopes).not.toContain('reports_read');
      expect(await status(lead, '/reports/overview')).toBe(200);
      expect(await status(lead, '/reports/cases')).toBe(403);
      expect(await status(lead, '/billing/subscription')).toBe(403);
    });
  });

  // =========================================================================
  // Yönetici: reads billing, does not change it
  // =========================================================================

  describe('Yönetici reads billing and does not change it', () => {
    beforeEach(async () => {
      await seedDefaultBrand(owner, fx.a.licenseId);
    });

    it('lets a Yönetici and a vice owner read every billing page and refuses every billing write (FR-MOD-04.RBAC)', async () => {
      for (const role of ['admin', 'viceowner']) {
        const session = await signIn(fx.a, (await member(fx.a, role)).email);
        const mine = await me(session);
        expect(mine.capabilities['billing.manage'], role).toBe('off');
        expect(mine.capabilities['reports.view'], role).toBe('all');
        expect(mine.scopes, role).not.toContain('billing_manage');
        for (const path of BILLING_READS) {
          expect(await status(session, path), `${role} ${path}`).toBe(200);
        }
        for (const call of BILLING_WRITES) {
          expect(await write(session, call), `${role} ${call.path}`).toBe(403);
        }
      }
    });

    it('takes billing from a Yönetici’s session and personal token opened before the change (FR-MOD-04.RBAC)', async () => {
      const admin = await member(fx.a, 'admin');
      // What sign-in and a list-less token were minted with until K7.
      const before = [...defaultScopesForRole('admin'), 'billing_manage'];
      const session = bearer(
        await grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: admin.id,
          scopes: before,
          kind: 'oauth',
          clientId: fx.a.clientId,
        }),
      );
      const pat = basic(
        admin.id,
        await grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: admin.id,
          scopes: before,
        }),
      );

      expect((await me(session)).scopes).not.toContain('billing_manage');
      // A personal token keeps its list but for what the matrix takes from the
      // role's default set; the routes' owner gate is what refuses it.
      expect((await me(pat)).scopes).toContain('billing_manage');
      for (const auth of [session, pat]) {
        expect(await status(auth, '/billing/subscription')).toBe(200);
        for (const call of BILLING_WRITES) {
          expect(await write(auth, call), call.path).toBe(403);
        }
      }
    });

    it('leaves the Kurucu changing billing as before (FR-MOD-04.RBAC)', async () => {
      const founder = await signIn(fx.a, fx.a.ownerEmail);
      const mine = await me(founder);
      expect(mine.capabilities['billing.manage']).toBe('on');
      expect(mine.scopes).toContain('billing_manage');
      expect(await write(founder, BILLING_WRITES[0]!)).toBe(200);
      expect(await write(founder, BILLING_WRITES[1]!)).toBe(200);
    });

    it('shows the Yönetici billing cell locked as Founder-only, and refuses handing it back (FR-MOD-04.RBAC)', async () => {
      const founder = await signIn(fx.a, fx.a.ownerEmail);
      const matrix = await server.get('/settings/permissions', founder);
      expect(matrix.statusCode).toBe(200);
      const row = matrix.json<MatrixBody>().capabilities.find((c) => c.key === 'billing.manage');
      expect(row).toMatchObject({ owner_only: true, floor_role: 'owner' });
      expect(row?.cells.find((c) => c.role === 'admin')).toEqual({
        role: 'admin',
        value: 'off',
        default: 'off',
        lock: 'owner_only',
      });

      const handBack = await server.put(
        '/settings/permissions',
        { changes: [{ role: 'admin', capability: 'billing.manage', value: 'on' }], reason: REASON },
        founder,
      );
      expect(handBack.statusCode).toBe(400);
      expect(handBack.json<ErrorBody>().error.details).toEqual({
        reason: 'locked',
        role: 'admin',
        capability: 'billing.manage',
      });
    });
  });

  // =========================================================================
  // Only the Kurucu changes the matrix
  // =========================================================================

  describe('only the Kurucu changes the matrix', () => {
    it('lets a Yönetici read the matrix and refuses their change (FR-MOD-04.RBAC)', async () => {
      const admin = await signIn(fx.a, (await member(fx.a, 'admin')).email);
      expect((await me(admin)).capabilities['settings.permissions']).toBe('off');
      expect(await status(admin, '/settings/permissions')).toBe(200);
      const res = await server.put(
        '/settings/permissions',
        { changes: [{ role: 'agent', capability: 'reports.view', value: 'all' }], reason: REASON },
        admin,
      );
      expect(res.statusCode).toBe(403);
    });
  });
});
