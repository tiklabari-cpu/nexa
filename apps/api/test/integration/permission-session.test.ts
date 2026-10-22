/**
 * A member's credential under the permission matrix (tm 325.3 · SiyahTuş
 * analysis RL-02, owner decision K7).
 *
 * What the Founder's `PUT /settings/permissions` (tm 325.2) changes is now what
 * a request is decided by — at the next request, without anybody signing in
 * again (the KK's "≤ 60 sn içinde, yeniden giriş yapmadan"):
 *
 *   - **A sign-in session** (the workspace's own client: panel, phone) follows
 *     the matrix both ways: a capability lent to its role arrives, one taken
 *     from it goes.
 *   - **A partner app's grant and a personal access token** keep their own
 *     list: what the matrix takes from the role goes, nothing past the list
 *     ever arrives — and a lent scope cannot be minted into a token at all.
 *   - **`own`** keeps a member to the chats they are in, whatever the
 *     credential carries.
 *   - **Nothing else moves:** a workspace that never touched the matrix
 *     resolves every role exactly as before, and another workspace's matrix
 *     reaches nobody here.
 *
 * Promotion and demotion on an open credential stay where `role-demotion.test.ts`
 * pins them; the rule itself, cell by cell, is `credential-scopes.test.ts`.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  capabilitiesForRole,
  defaultScopesForRole,
  generateShortId,
  scopesForCredential,
  type CapabilityOverride,
  type CredentialGrant,
} from '@siyahtus/types';
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

const REASON = 'Vardiya düzeni değişti';
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

interface ErrorBody {
  error: { type: string; details?: Record<string, unknown> };
}

describe('credentials under the permission matrix (RL-02 · tm 325.3)', () => {
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
    // `seedFixtures` hands the next test the same licence ids; the cached
    // matrix of the workspace before must not answer for this one.
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
    // A change mails the admins beside the response; the next reset must not
    // truncate under it.
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

  /** A client registered by a partner — it has a scope list of its own. */
  async function partnerClient(t: TenantFixture): Promise<string> {
    const id = `partner_${t.licenseId}_${(seq += 1)}`;
    await owner.oauthClient.create({
      data: {
        id,
        organizationId: t.organizationId,
        displayName: 'Shift dashboard',
        clientType: 'public',
        redirectUris: ['https://partner.example.test/callback'],
        scopes: ['chats--access:rw', 'reports_read'],
      },
    });
    return id;
  }

  async function put(changes: CapabilityOverride[], auth: Headers = founder): Promise<void> {
    const res = await server.put('/settings/permissions', { changes, reason: REASON }, auth);
    expect(res.statusCode, res.body).toBe(200);
  }

  async function me(auth: Headers): Promise<Me> {
    const res = await server.get('/auth/me', auth);
    expect(res.statusCode).toBe(200);
    return res.json<Me>();
  }

  const status = async (auth: Headers, path: string): Promise<number> =>
    (await server.get(path, auth)).statusCode;

  async function mintPat(auth: Headers, scopes?: string[]) {
    return server.post(
      '/auth/personal-access-tokens',
      { name: 'shift script', ...(scopes ? { scopes } : {}) },
      auth,
    );
  }

  const overview = '/reports/overview';

  // =========================================================================
  // A change reaches the next request
  // =========================================================================

  describe('a change reaches open credentials at the next request', () => {
    it('lends Ekip Üyesi the reports in a signed-in session without a new sign-in, and takes them back (FR-MOD-04.RBAC)', async () => {
      const session = await signIn(fx.a, fx.a.agentEmail);
      expect(await status(session, overview)).toBe(403);

      await put([{ role: 'agent', capability: 'reports.view', value: 'all' }]);
      expect(await status(session, overview)).toBe(200);
      const lent = await me(session);
      expect(lent.scopes).toContain('reports_read');
      expect(lent.capabilities['reports.view']).toBe('all');

      await put([{ role: 'agent', capability: 'reports.view', value: 'none' }]);
      expect(await status(session, overview)).toBe(403);
      expect((await me(session)).scopes).not.toContain('reports_read');
    });

    it('takes the inbox from a signed-in session and gives it back (FR-MOD-04.RBAC)', async () => {
      const session = await signIn(fx.a, fx.a.agentEmail);
      expect(await status(session, '/chats')).toBe(200);

      await put([{ role: 'agent', capability: 'chats.view', value: 'none' }]);
      expect(await status(session, '/chats')).toBe(403);
      expect((await me(session)).scopes).not.toContain('chats--access:rw');

      await put([{ role: 'agent', capability: 'chats.view', value: 'team' }]);
      expect(await status(session, '/chats')).toBe(200);
    });

    it('reads the version with the role, so a change nobody announced lands on the next request, not the next minute', async () => {
      const session = await signIn(fx.a, fx.a.agentEmail);
      // The workspace's snapshot is cached at version 0 by this request.
      expect(await status(session, overview)).toBe(403);

      // Written past the endpoint: no announcement, the cache entry untouched.
      await owner.$executeRaw`
        INSERT INTO role_capability_overrides (license_id, role, capability, value)
        VALUES (${fx.a.licenseId}, 'agent', 'reports.view', 'all')`;
      await owner.$executeRaw`
        UPDATE licenses SET permissions_version = permissions_version + 1 WHERE id = ${fx.a.licenseId}`;

      expect(await status(session, overview)).toBe(200);
    });

    it("takes billing from a Yönetici's session and personal token when the Founder takes it from the column (FR-MOD-04.RBAC)", async () => {
      await seedDefaultBrand(owner, fx.a.licenseId);
      const admin = await member(fx.a, 'admin');
      const session = await signIn(fx.a, admin.email);
      const minted = await mintPat(session);
      expect(minted.statusCode).toBe(201);
      const pat = minted.json() as { token: string; scopes: string[] };
      expect(pat.scopes).toContain('billing_manage');
      const token = basic(admin.id, pat.token);
      expect((await server.put('/billing/payment-method', CARD, token)).statusCode).toBe(200);

      await put([{ role: 'admin', capability: 'billing.manage', value: 'off' }]);

      for (const auth of [session, token]) {
        expect((await server.put('/billing/payment-method', CARD, auth)).statusCode).toBe(403);
        expect((await me(auth)).scopes).not.toContain('billing_manage');
      }
      // Reading the bill is another row's (`reports.view`), and it stays.
      expect(await status(token, overview)).toBe(200);
    });
  });

  // =========================================================================
  // Credentials that keep their own list
  // =========================================================================

  describe('credentials that keep their own list', () => {
    it('never widens a personal access token, and will not mint a lent scope into one (FR-MOD-04.RBAC)', async () => {
      const session = await signIn(fx.a, fx.a.agentEmail);
      const minted = await mintPat(session);
      expect(minted.statusCode).toBe(201);
      const pat = minted.json() as { token: string; scopes: string[] };
      expect(pat.scopes).toEqual(defaultScopesForRole('agent'));
      const token = basic(fx.a.agentAccountId, pat.token);

      await put([{ role: 'agent', capability: 'reports.view', value: 'all' }]);

      expect(await status(session, overview)).toBe(200);
      expect(await status(token, overview)).toBe(403);

      const lent = await mintPat(session, ['chats--access:rw', 'reports_read']);
      expect(lent.statusCode).toBe(403);
      expect(lent.json<ErrorBody>().error.details).toMatchObject({
        reason: 'scopes_not_delegable',
        scopes: 'reports_read',
      });
      // Without a list, the token takes the role's own set and leaves the loan behind.
      const plain = await mintPat(session);
      expect(plain.statusCode).toBe(201);
      expect((plain.json() as { scopes: string[] }).scopes).not.toContain('reports_read');
    });

    it('takes from a personal access token what the matrix takes from its role, and gives it back (FR-MOD-04.RBAC)', async () => {
      const session = await signIn(fx.a, fx.a.agentEmail);
      const pat = (await mintPat(session)).json() as { token: string };
      const token = basic(fx.a.agentAccountId, pat.token);
      expect(await status(token, '/chats')).toBe(200);

      await put([{ role: 'agent', capability: 'chats.view', value: 'none' }]);
      expect(await status(token, '/chats')).toBe(403);
      // Restricted, a session still mints a token — narrowed the same way.
      const narrowed = await mintPat(session);
      expect(narrowed.statusCode).toBe(201);
      expect((narrowed.json() as { scopes: string[] }).scopes).not.toContain('chats--access:rw');

      await put([{ role: 'agent', capability: 'chats.view', value: 'team' }]);
      expect(await status(token, '/chats')).toBe(200);
    });

    it("caps a partner app's grant by the matrix and never widens it; the sign-in client's session does widen (FR-MOD-04.RBAC)", async () => {
      const partner = bearer(
        await grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.agentAccountId,
          kind: 'oauth',
          clientId: await partnerClient(fx.a),
          scopes: ['chats--access:rw'],
        }),
      );
      const panel = bearer(
        await grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.agentAccountId,
          kind: 'oauth',
          clientId: fx.a.clientId,
          scopes: ['chats--access:rw'],
        }),
      );

      await put([{ role: 'agent', capability: 'reports.view', value: 'all' }]);
      expect(await status(partner, overview)).toBe(403);
      expect(await status(panel, overview)).toBe(200);

      await put([{ role: 'agent', capability: 'chats.view', value: 'none' }]);
      expect(await status(partner, '/chats')).toBe(403);
      expect(await status(panel, '/chats')).toBe(403);
    });
  });

  // =========================================================================
  // `own` — the chats a member is in
  // =========================================================================

  describe('own: the chats a member is assigned to or has joined', () => {
    let support: bigint;
    let sales: bigint;
    /** Routed to the agent's team; the agent is not in it. */
    let teamChat: string;
    /** The agent is in it (transferred, joined). */
    let ownChat: string;
    /** Another team's; the agent is not in it. */
    let otherChat: string;

    async function chat(groupId: bigint, participant?: string): Promise<string> {
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: `Visitor ${(seq += 1)}` },
        select: { id: true },
      });
      const chatId = generateShortId();
      await owner.chat.create({
        data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: true },
      });
      await owner.thread.create({
        data: { id: generateShortId(), chatId, licenseId: fx.a.licenseId, active: true },
      });
      await owner.chatAccess.create({ data: { chatId, groupId } });
      if (participant) {
        await owner.chatUser.create({ data: { chatId, userId: participant, userType: 'agent' } });
      }
      return chatId;
    }

    const listed = async (auth: Headers): Promise<string[]> => {
      const res = await server.get('/chats', auth);
      expect(res.statusCode).toBe(200);
      return (res.json() as { items: Array<{ id: string }> }).items.map((c) => c.id).sort();
    };

    beforeEach(async () => {
      support = (
        await owner.group.create({
          data: { licenseId: fx.a.licenseId, name: 'Support' },
          select: { id: true },
        })
      ).id;
      sales = (
        await owner.group.create({
          data: { licenseId: fx.a.licenseId, name: 'Sales' },
          select: { id: true },
        })
      ).id;
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId: support, agentId: fx.a.agentAccountId },
      });
      teamChat = await chat(support);
      ownChat = await chat(sales, fx.a.agentAccountId);
      otherChat = await chat(sales);
    });

    it('keeps a signed-in member to their own chats once the Founder sets own, and hides the rest as absent (FR-MOD-04.RBAC · NFR-S5)', async () => {
      const session = await signIn(fx.a, fx.a.agentEmail);
      expect(await listed(session)).toEqual([ownChat, teamChat].sort());

      await put([{ role: 'agent', capability: 'chats.view', value: 'own' }]);
      // `own` holds the team level's scopes: the narrowing is the visibility rule's.
      expect((await me(session)).scopes).toContain('chats--access:rw');
      expect(await listed(session)).toEqual([ownChat]);
      expect(await status(session, `/chats/${teamChat}`)).toBe(404);
      expect(await status(session, `/chats/${ownChat}`)).toBe(200);

      await put([{ role: 'agent', capability: 'chats.view', value: 'team' }]);
      expect(await listed(session)).toEqual([ownChat, teamChat].sort());
    });

    it('narrows a token minted for every chat too, since own belongs to the person and not the credential (FR-MOD-04.RBAC)', async () => {
      // An agent holding a broad token — what the role gates are tested against.
      const broad = bearer(
        await grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.agentAccountId,
          scopes: ['chats--all:rw'],
        }),
      );
      expect(await listed(broad)).toEqual([otherChat, ownChat, teamChat].sort());

      await put([{ role: 'agent', capability: 'chats.view', value: 'own' }]);
      expect(await listed(broad)).toEqual([ownChat]);
      expect(await status(broad, `/chats/${otherChat}`)).toBe(404);

      await put([{ role: 'agent', capability: 'chats.view', value: 'none' }]);
      expect(await status(broad, `/chats/${ownChat}`)).toBe(403);
      expect(await status(broad, '/chats')).toBe(403);
    });

    it('leaves a Yönetici seeing every chat while Ekip Üyesi is set to own', async () => {
      const admin = await member(fx.a, 'admin');
      const session = await signIn(fx.a, admin.email);
      await put([{ role: 'agent', capability: 'chats.view', value: 'own' }]);
      expect(await listed(session)).toEqual([otherChat, ownChat, teamChat].sort());
    });
  });

  // =========================================================================
  // What does not move
  // =========================================================================

  describe('what does not move', () => {
    it("resolves every role's sign-in exactly as before in a workspace that never touched the matrix (FR-MOD-04.RBAC)", async () => {
      const people: Array<{ role: string; email: string }> = [
        { role: 'owner', email: fx.a.ownerEmail },
        { role: 'agent', email: fx.a.agentEmail },
      ];
      for (const role of ['admin', 'team_lead']) {
        people.push({ role, email: (await member(fx.a, role)).email });
      }
      for (const person of people) {
        const profile = await me(await signIn(fx.a, person.email));
        expect(profile.role, person.role).toBe(person.role);
        expect(profile.scopes, person.role).toEqual(defaultScopesForRole(person.role));
        expect(profile.capabilities, person.role).toEqual(capabilitiesForRole(person.role, []));
      }
    });

    it("keeps one workspace's matrix away from another's members (NFR-S4)", async () => {
      const elsewhere = await signIn(fx.b, fx.b.agentEmail);
      await put([
        { role: 'agent', capability: 'reports.view', value: 'all' },
        { role: 'agent', capability: 'chats.view', value: 'none' },
      ]);

      expect(await status(elsewhere, overview)).toBe(403);
      expect(await status(elsewhere, '/chats')).toBe(200);
      const profile = await me(elsewhere);
      expect(profile.capabilities['reports.view']).toBe('none');
      expect(profile.capabilities['chats.view']).toBe('team');
      const licence = await owner.license.findUniqueOrThrow({
        where: { id: fx.b.licenseId },
        select: { permissionsVersion: true },
      });
      expect(licence.permissionsVersion).toBe(0);
    });
  });

  // =========================================================================
  // One rule, two processes
  // =========================================================================

  describe('one rule for the REST edge and the gateway (tm 145)', () => {
    it('answers what the shared rule answers, for every kind of credential (FR-MOD-04.RBAC)', async () => {
      const overrides: CapabilityOverride[] = [
        { role: 'agent', capability: 'reports.view', value: 'all' },
        { role: 'agent', capability: 'tickets.view', value: 'none' },
        { role: 'agent', capability: 'chats.view', value: 'own' },
      ];
      await put(overrides);
      const stored = defaultScopesForRole('agent');
      const credentials: Array<[CredentialGrant, Headers]> = [
        [
          'session',
          bearer(
            await grantToken(owner, {
              licenseId: fx.a.licenseId,
              organizationId: fx.a.organizationId,
              ownerId: fx.a.agentAccountId,
              kind: 'oauth',
              clientId: fx.a.clientId,
              scopes: stored,
            }),
          ),
        ],
        [
          'delegated',
          bearer(
            await grantToken(owner, {
              licenseId: fx.a.licenseId,
              organizationId: fx.a.organizationId,
              ownerId: fx.a.agentAccountId,
              kind: 'oauth',
              clientId: await partnerClient(fx.a),
              scopes: stored,
            }),
          ),
        ],
        [
          'personal',
          bearer(
            await grantToken(owner, {
              licenseId: fx.a.licenseId,
              organizationId: fx.a.organizationId,
              ownerId: fx.a.agentAccountId,
              scopes: stored,
            }),
          ),
        ],
      ];
      for (const [grant, auth] of credentials) {
        const profile = await me(auth);
        expect(profile.scopes, grant).toEqual(
          scopesForCredential({ grant, role: 'agent', stored, overrides }),
        );
        expect(profile.capabilities, grant).toEqual(capabilitiesForRole('agent', overrides));
      }
    });
  });
});
