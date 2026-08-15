/**
 * SCIM 2.0 — the boundary (S11-e) and what crossing it means (S11-f).
 *
 * The claim this file exists to hold is one sentence: **a SCIM token reaches
 * exactly one workspace's members and nothing else.** Everything down to the
 * Groups section is a way of trying to break it.
 *
 *   - **Rejections first**, because this is a security surface: no token,
 *     unknown token, revoked token, expired token, and — the one that matters
 *     most — a *valid* token belonging to a different workspace, tried against
 *     every read and every write.
 *   - **The credential is not an agent credential in either direction.** An
 *     owner's PAT gets nothing from `/scim/v2`, and a SCIM token gets nothing
 *     from the agent API. Both are 404 rather than 403: a boundary violation is
 *     not a permission shortfall (NFR-S5).
 *   - **Writes cannot cross a workspace.** The cross-tenant matrix covers
 *     `POST`, `PATCH` and `DELETE`, not just reads — a leaked read is bad, a
 *     leaked write is worse, and this is the exact failure the item was declared
 *     indivisible to prevent.
 *   - **`accounts` is never modified.** A person who works for two workspaces
 *     cannot be renamed, re-addressed or have their password cleared by one
 *     workspace's directory.
 *   - **The error envelope is RFC 7644's**, on the endpoints' own refusals and
 *     on the ones the shared hooks raise.
 *   - **Minting the credential is gated**, revoking it works immediately, and
 *     both leave an audit entry.
 *
 * The `lifecycle semantics` block is the second claim, and it is a different
 * kind of thing: not "can this credential reach further than it should" but
 * "when it does what it is allowed to do, does the product agree that it
 * happened". A provisioning run that leaves no trail, or that grows a workspace
 * without growing its bill, is inside the boundary and still wrong.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../src/lib/crypto.js';
import { MAX_ACTIVE_SCIM_TOKENS } from '../../src/routes/settings.js';
import { AUDIT_ACTIONS } from '../../src/services/audit/audit-log.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const SCIM_JSON = 'application/scim+json';

interface ScimUser {
  schemas: string[];
  id: string;
  externalId?: string;
  userName: string;
  displayName: string;
  active: boolean;
  meta: { resourceType: string; created: string; location: string };
}

interface ScimList {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: ScimUser[];
}

interface ScimErrorBody {
  schemas: string[];
  status: string;
  scimType?: string;
  detail: string;
}

describe('scim server core', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  /** The provisioning credential for workspace A, and one for workspace B. */
  let scimA: string;
  let scimB: string;
  /** An owner PAT for workspace A — the agent side of the boundary. */
  let ownerPatA: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const scimBody = (token: string) => ({
    ...auth(token),
    'content-type': SCIM_JSON,
  });
  const asUser = (res: { json: () => unknown }) => res.json() as ScimUser;
  const asList = (res: { json: () => unknown }) => res.json() as ScimList;
  const asError = (res: { json: () => unknown }) => res.json() as ScimErrorBody;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    // Directory provisioning is Enterprise (NFR-S11 · FR-MOD-11.5): every route
    // in this suite is behind the `sso` entitlement.
    fx = await seedFixtures(owner, { plan: 'enterprise' });
    await clearRateLimits(server.app);
    scimA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      kind: 'scim',
      scopes: [],
    });
    scimB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      kind: 'scim',
      scopes: [],
    });
    ownerPatA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw', 'agents--all:rw', 'accounts--all:rw'],
    });
  });

  // --- Authentication --------------------------------------------------------

  describe('authentication', () => {
    it('refuses an anonymous request', async () => {
      const res = await server.get('/scim/v2/Users');
      expect(res.statusCode).toBe(401);
    });

    it('refuses an unknown token', async () => {
      const res = await server.get('/scim/v2/Users', auth('not-a-real-token'));
      expect(res.statusCode).toBe(401);
    });

    it('refuses a revoked token immediately — resolution is never cached', async () => {
      const res = await server.get('/scim/v2/Users', auth(scimA));
      expect(res.statusCode).toBe(200);

      await owner.apiToken.updateMany({
        where: { tokenHash: hashToken(scimA) },
        data: { revokedAt: new Date() },
      });

      expect((await server.get('/scim/v2/Users', auth(scimA))).statusCode).toBe(401);
    });

    it('refuses an expired token', async () => {
      const expired = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        kind: 'scim',
        scopes: [],
        expiresAt: new Date(Date.now() - 1000),
      });
      expect((await server.get('/scim/v2/Users', auth(expired))).statusCode).toBe(401);
    });

    it('refuses a token whose workspace has been canceled', async () => {
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { status: 'canceled' },
      });
      expect((await server.get('/scim/v2/Users', auth(scimA))).statusCode).toBe(401);
    });

    it('answers a refusal in the SCIM envelope, not the ADR-06 one', async () => {
      // The 401 comes from the shared authentication hook, not from a handler in
      // routes/scim.ts — so this also pins that the plugin-scoped error handler
      // governs failures raised on the route's behalf.
      const res = await server.get('/scim/v2/Users', auth('nope'));
      const body = asError(res);
      expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
      expect(body.status).toBe('401');
      expect(res.json()).not.toHaveProperty('error');
      expect(res.headers['content-type']).toContain(SCIM_JSON);
    });
  });

  // --- The credential is not an agent credential -----------------------------

  describe('the SCIM/agent boundary', () => {
    it('refuses an owner PAT at the SCIM surface — 404, not 403', async () => {
      // A boundary violation, not a permission shortfall: answering 403 would
      // confirm the surface exists to a credential that has no business there.
      const res = await server.get('/scim/v2/Users', auth(ownerPatA));
      expect(res.statusCode).toBe(404);
    });

    it('refuses an owner PAT at every SCIM write too', async () => {
      const headers = { ...auth(ownerPatA), 'content-type': SCIM_JSON };
      expect(
        (await server.post('/scim/v2/Users', { userName: 'x@example.test' }, headers)).statusCode,
      ).toBe(404);
      expect(
        (
          await server.patch(
            `/scim/v2/Users/${fx.a.agentAccountId}`,
            { Operations: [{ op: 'replace', path: 'active', value: false }] },
            headers,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (await server.del(`/scim/v2/Users/${fx.a.agentAccountId}`, auth(ownerPatA))).statusCode,
      ).toBe(404);
    });

    it('refuses a SCIM token at the agent API', async () => {
      // The reverse direction. A SCIM token carries no scopes and resolves to no
      // membership, so even a route it somehow reached would find no role — but
      // the `principals` gate refuses it before any of that.
      for (const path of ['/agents', '/chats', '/auth/me', '/settings/sso', '/audit-log']) {
        const res = await server.get(path, auth(scimA));
        expect(res.statusCode, path).toBe(404);
      }
    });

    it('does not let a SCIM token inherit the role of the admin who minted it', async () => {
      // `owner_id` on the token row is the owner's account id — attribution, not
      // authority. If resolution ever fell through to the membership lookup this
      // credential would act as the workspace owner.
      const res = await server.get('/settings/sso', auth(scimA));
      expect(res.statusCode).toBe(404);
    });
  });

  // --- Reading ---------------------------------------------------------------

  describe('GET /scim/v2/Users', () => {
    it('lists this workspace and only this workspace', async () => {
      const list = asList(await server.get('/scim/v2/Users', auth(scimA)));
      expect(list.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:ListResponse']);
      expect(list.totalResults).toBe(2);
      expect(list.Resources.map((u) => u.userName).sort()).toEqual(
        [fx.a.ownerEmail, fx.a.agentEmail].sort(),
      );
      // Workspace B's members are not in the payload at all.
      expect(list.Resources.some((u) => u.userName === fx.b.agentEmail)).toBe(false);
    });

    it('answers in application/scim+json', async () => {
      const res = await server.get('/scim/v2/Users', auth(scimA));
      expect(res.headers['content-type']).toContain(SCIM_JSON);
    });

    it('filters on userName — the lookup a connector makes before a create', async () => {
      const list = asList(
        await server.get(
          `/scim/v2/Users?filter=${encodeURIComponent(`userName eq "${fx.a.agentEmail}"`)}`,
          auth(scimA),
        ),
      );
      expect(list.totalResults).toBe(1);
      expect(list.Resources[0]!.userName).toBe(fx.a.agentEmail);
    });

    it("cannot find another workspace's member by userName", async () => {
      const list = asList(
        await server.get(
          `/scim/v2/Users?filter=${encodeURIComponent(`userName eq "${fx.b.agentEmail}"`)}`,
          auth(scimA),
        ),
      );
      expect(list.totalResults).toBe(0);
      expect(list.Resources).toEqual([]);
    });

    it('filters on active', async () => {
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        data: { suspended: true },
      });
      const inactive = asList(
        await server.get(
          `/scim/v2/Users?filter=${encodeURIComponent('active eq false')}`,
          auth(scimA),
        ),
      );
      expect(inactive.Resources.map((u) => u.userName)).toEqual([fx.a.agentEmail]);
      const active = asList(
        await server.get(
          `/scim/v2/Users?filter=${encodeURIComponent('active eq true')}`,
          auth(scimA),
        ),
      );
      expect(active.Resources.map((u) => u.userName)).toEqual([fx.a.ownerEmail]);
    });

    it('refuses a filter outside the supported subset with invalidFilter', async () => {
      const res = await server.get(
        `/scim/v2/Users?filter=${encodeURIComponent('userName co "example"')}`,
        auth(scimA),
      );
      expect(res.statusCode).toBe(400);
      expect(asError(res).scimType).toBe('invalidFilter');
    });

    it('pages, and reports totalResults across every page', async () => {
      const first = asList(await server.get('/scim/v2/Users?startIndex=1&count=1', auth(scimA)));
      expect(first.totalResults).toBe(2);
      expect(first.itemsPerPage).toBe(1);
      const second = asList(await server.get('/scim/v2/Users?startIndex=2&count=1', auth(scimA)));
      expect(second.totalResults).toBe(2);
      expect(second.Resources[0]!.id).not.toBe(first.Resources[0]!.id);
    });

    it('answers count=0 with the total and no bodies', async () => {
      const list = asList(await server.get('/scim/v2/Users?count=0', auth(scimA)));
      expect(list.totalResults).toBe(2);
      expect(list.Resources).toEqual([]);
    });
  });

  describe('GET /scim/v2/Users/{id}', () => {
    it('reads one member of this workspace', async () => {
      const user = asUser(await server.get(`/scim/v2/Users/${fx.a.agentAccountId}`, auth(scimA)));
      expect(user.id).toBe(fx.a.agentAccountId);
      expect(user.userName).toBe(fx.a.agentEmail);
      expect(user.active).toBe(true);
      expect(user.meta.resourceType).toBe('User');
      expect(user.meta.location).toContain(`/scim/v2/Users/${fx.a.agentAccountId}`);
    });

    it('answers 404 for a member of another workspace — the same answer a made-up id gets', async () => {
      const foreign = await server.get(`/scim/v2/Users/${fx.b.agentAccountId}`, auth(scimA));
      const invented = await server.get(
        '/scim/v2/Users/99999999-9999-4999-8999-999999999999',
        auth(scimA),
      );
      expect(foreign.statusCode).toBe(404);
      expect(invented.statusCode).toBe(404);
      expect(asError(foreign).detail).toBe(asError(invented).detail);
    });

    it('answers 404 for a malformed id rather than a database error', async () => {
      expect((await server.get('/scim/v2/Users/not-a-uuid', auth(scimA))).statusCode).toBe(404);
    });
  });

  // --- Creating --------------------------------------------------------------

  describe('POST /scim/v2/Users', () => {
    const newUser = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: 'grace@example.test',
      externalId: 'idp-4711',
      name: { givenName: 'Grace', familyName: 'Hopper' },
    };

    it("provisions a member into the token's workspace", async () => {
      const res = await server.post('/scim/v2/Users', newUser, scimBody(scimA));
      expect(res.statusCode).toBe(201);
      const user = asUser(res);
      expect(user.userName).toBe('grace@example.test');
      expect(user.externalId).toBe('idp-4711');
      expect(user.displayName).toBe('Grace Hopper');
      expect(user.active).toBe(true);
      expect(res.headers['location']).toContain(`/scim/v2/Users/${user.id}`);

      const membership = await owner.agentMembership.findUnique({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: user.id } },
      });
      expect(membership).not.toBeNull();
      // Always `agent`: a directory that could pick the role could create an
      // owner, which the admin who minted the token cannot do themselves.
      expect(membership!.role).toBe('agent');
      // Not put straight into rotation — nobody is at the desk yet.
      expect(membership!.routingStatus).toBe('offline');
      expect(membership!.scimExternalId).toBe('idp-4711');
      // No membership was created anywhere else.
      expect(
        await owner.agentMembership.count({
          where: { licenseId: fx.b.licenseId, agentId: user.id },
        }),
      ).toBe(0);
    });

    it('creates the account passwordless — SSO-only, as the schema describes', async () => {
      const user = asUser(await server.post('/scim/v2/Users', newUser, scimBody(scimA)));
      const account = await owner.account.findUnique({ where: { id: user.id } });
      expect(account!.passwordHash).toBeNull();
    });

    it('honours active:false on create', async () => {
      const user = asUser(
        await server.post('/scim/v2/Users', { ...newUser, active: false }, scimBody(scimA)),
      );
      expect(user.active).toBe(false);
      const membership = await owner.agentMembership.findUnique({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: user.id } },
      });
      expect(membership!.suspended).toBe(true);
    });

    it('accepts application/json as well, because several connectors send it', async () => {
      const res = await server.post('/scim/v2/Users', newUser, auth(scimA));
      expect(res.statusCode).toBe(201);
    });

    it('answers a duplicate userName with 409 uniqueness, so the client can adopt it', async () => {
      const res = await server.post(
        '/scim/v2/Users',
        { userName: fx.a.agentEmail },
        scimBody(scimA),
      );
      expect(res.statusCode).toBe(409);
      expect(asError(res).scimType).toBe('uniqueness');
    });

    it('answers a duplicate externalId with 409 uniqueness', async () => {
      await server.post('/scim/v2/Users', newUser, scimBody(scimA));
      const res = await server.post(
        '/scim/v2/Users',
        { userName: 'alan@example.test', externalId: 'idp-4711' },
        scimBody(scimA),
      );
      expect(res.statusCode).toBe(409);
      expect(asError(res).scimType).toBe('uniqueness');
    });

    it('refuses a userName that is not an address', async () => {
      const res = await server.post('/scim/v2/Users', { userName: 'grace' }, scimBody(scimA));
      expect(res.statusCode).toBe(400);
      expect(asError(res).scimType).toBe('invalidValue');
    });

    it('refuses a body that is not valid JSON, in the SCIM envelope', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: server.url('/scim/v2/Users'),
        headers: scimBody(scimA),
        payload: '{ not json',
      });
      expect(res.statusCode).toBe(400);
      expect(asError(res).schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
    });

    // --- The cross-tenant claim, on the write path ---------------------------

    it('adopts an account that already exists in another workspace without touching it', async () => {
      // The account is global (PRD §8.4) and this tenant context cannot even see
      // it — the resolver behind the endpoint is what makes the adoption
      // possible, and rule 1 is what keeps it harmless.
      const before = await owner.account.findUnique({ where: { id: fx.b.agentAccountId } });

      const res = await server.post(
        '/scim/v2/Users',
        { userName: fx.b.agentEmail, name: { formatted: 'Renamed By A' }, externalId: 'a-1' },
        scimBody(scimA),
      );
      expect(res.statusCode).toBe(201);
      expect(asUser(res).id).toBe(fx.b.agentAccountId);
      // The display name is B's, not the one A asserted: an existing account is
      // never modified.
      expect(asUser(res).displayName).toBe(before!.name);

      const after = await owner.account.findUnique({ where: { id: fx.b.agentAccountId } });
      expect(after).toEqual(before);

      // B's own membership is untouched — same role, still not suspended.
      const bMembership = await owner.agentMembership.findUnique({
        where: { licenseId_agentId: { licenseId: fx.b.licenseId, agentId: fx.b.agentAccountId } },
      });
      expect(bMembership!.role).toBe('agent');
      expect(bMembership!.suspended).toBe(false);
      expect(bMembership!.scimExternalId).toBeNull();
    });

    it("writes into the token's licence, never one named in the request", async () => {
      // There is no request shape that carries a licence, so the check is that
      // the same body sent with B's token lands in B and with A's token in A.
      const inB = asUser(
        await server.post('/scim/v2/Users', { userName: 'shared@example.test' }, scimBody(scimB)),
      );
      expect(
        await owner.agentMembership.count({
          where: { licenseId: fx.a.licenseId, agentId: inB.id },
        }),
      ).toBe(0);
      expect(
        await owner.agentMembership.count({
          where: { licenseId: fx.b.licenseId, agentId: inB.id },
        }),
      ).toBe(1);
    });
  });

  // --- Patching --------------------------------------------------------------

  describe('PATCH /scim/v2/Users/{id}', () => {
    const deactivate = { Operations: [{ op: 'replace', path: 'active', value: false }] };

    it('suspends a member — the deprovisioning a directory performs most often', async () => {
      const res = await server.patch(
        `/scim/v2/Users/${fx.a.agentAccountId}`,
        deactivate,
        scimBody(scimA),
      );
      expect(res.statusCode).toBe(200);
      expect(asUser(res).active).toBe(false);

      const membership = await owner.agentMembership.findUnique({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
      });
      expect(membership!.suspended).toBe(true);
    });

    it('reactivates a member', async () => {
      await server.patch(`/scim/v2/Users/${fx.a.agentAccountId}`, deactivate, scimBody(scimA));
      const res = await server.patch(
        `/scim/v2/Users/${fx.a.agentAccountId}`,
        { Operations: [{ op: 'Replace', path: 'active', value: 'True' }] },
        scimBody(scimA),
      );
      expect(asUser(res).active).toBe(true);
    });

    it('writes externalId', async () => {
      const res = await server.patch(
        `/scim/v2/Users/${fx.a.agentAccountId}`,
        { Operations: [{ op: 'add', path: 'externalId', value: 'idp-99' }] },
        scimBody(scimA),
      );
      expect(asUser(res).externalId).toBe('idp-99');
    });

    it('refuses a userName change with mutability, and changes nothing', async () => {
      const res = await server.patch(
        `/scim/v2/Users/${fx.a.agentAccountId}`,
        { Operations: [{ op: 'replace', path: 'userName', value: 'moved@example.test' }] },
        scimBody(scimA),
      );
      expect(res.statusCode).toBe(400);
      expect(asError(res).scimType).toBe('mutability');

      const account = await owner.account.findUnique({ where: { id: fx.a.agentAccountId } });
      expect(account!.email).toBe(fx.a.agentEmail);
    });

    it('accepts a full-profile sync that repeats the current userName', async () => {
      // What a nightly reconciliation does. Refusing it would break the common
      // case in the name of the rare one.
      const res = await server.patch(
        `/scim/v2/Users/${fx.a.agentAccountId}`,
        {
          Operations: [
            { op: 'replace', path: 'userName', value: fx.a.agentEmail.toUpperCase() },
            { op: 'replace', path: 'displayName', value: 'Whatever The IdP Thinks' },
            { op: 'replace', path: 'active', value: false },
          ],
        },
        scimBody(scimA),
      );
      expect(res.statusCode).toBe(200);
      expect(asUser(res).active).toBe(false);
      // The display name was accepted and not applied: `accounts` is shared.
      const account = await owner.account.findUnique({ where: { id: fx.a.agentAccountId } });
      expect(account!.name).not.toBe('Whatever The IdP Thinks');
      expect(asUser(res).displayName).toBe(account!.name);
    });

    it('cannot patch a member of another workspace', async () => {
      const res = await server.patch(
        `/scim/v2/Users/${fx.b.agentAccountId}`,
        deactivate,
        scimBody(scimA),
      );
      expect(res.statusCode).toBe(404);

      const membership = await owner.agentMembership.findUnique({
        where: { licenseId_agentId: { licenseId: fx.b.licenseId, agentId: fx.b.agentAccountId } },
      });
      expect(membership!.suspended).toBe(false);
    });

    it('refuses a malformed PatchOp', async () => {
      const res = await server.patch(
        `/scim/v2/Users/${fx.a.agentAccountId}`,
        { Operations: [{ op: 'destroy', path: 'active' }] },
        scimBody(scimA),
      );
      expect(res.statusCode).toBe(400);
      expect(asError(res).scimType).toBe('invalidSyntax');
    });
  });

  // --- Deprovisioning --------------------------------------------------------

  describe('DELETE /scim/v2/Users/{id}', () => {
    it('suspends rather than deletes, so the workspace keeps its history', async () => {
      const res = await server.del(`/scim/v2/Users/${fx.a.agentAccountId}`, auth(scimA));
      expect(res.statusCode).toBe(204);

      const membership = await owner.agentMembership.findUnique({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
      });
      expect(membership).not.toBeNull();
      expect(membership!.suspended).toBe(true);
      // The person still exists — a directory saying "they left" is not a
      // request to erase what they did.
      expect(await owner.account.findUnique({ where: { id: fx.a.agentAccountId } })).not.toBeNull();
    });

    it('converges when a connector retries', async () => {
      await server.del(`/scim/v2/Users/${fx.a.agentAccountId}`, auth(scimA));
      expect(
        (await server.del(`/scim/v2/Users/${fx.a.agentAccountId}`, auth(scimA))).statusCode,
      ).toBe(204);
    });

    it('cannot deprovision a member of another workspace', async () => {
      const res = await server.del(`/scim/v2/Users/${fx.b.agentAccountId}`, auth(scimA));
      expect(res.statusCode).toBe(404);

      const membership = await owner.agentMembership.findUnique({
        where: { licenseId_agentId: { licenseId: fx.b.licenseId, agentId: fx.b.agentAccountId } },
      });
      expect(membership!.suspended).toBe(false);
    });

    it('stops the person signing in to this workspace', async () => {
      await server.del(`/scim/v2/Users/${fx.a.agentAccountId}`, auth(scimA));
      const res = await server.post('/auth/login', {
        email: fx.a.agentEmail,
        password: fx.a.password,
      });
      // The credential is still right; the membership is what is gone. Whether
      // that surfaces as a refusal or as a sign-in with no workspace, what must
      // not happen is a usable session for this licence.
      const body = res.json() as { memberships?: Array<{ license_id: string }> };
      const licences = (body.memberships ?? []).map((m) => m.license_id);
      expect(licences).not.toContain(fx.a.licenseId.toString());
    });
  });

  // --- Lifecycle semantics (S11-f) -------------------------------------------
  //
  // S11-e proved the boundary: a SCIM token reaches one workspace's members and
  // nothing else. This is the other half — what those operations *mean* once
  // they are allowed through. Three claims:
  //
  //   1. every real transition leaves a line in the audit trail, in the existing
  //      membership vocabulary, naming the credential that caused it — and a
  //      sync that changes nothing leaves none;
  //   2. the bill follows the headcount upwards and is never shrunk by a
  //      directory;
  //   3. the owner is out of reach, and a deprovisioned member's access ends on
  //      their very next request rather than at their next sign-in.

  describe('lifecycle semantics', () => {
    /** The `api_tokens` row behind `scimA` — what the entries below point at. */
    let scimTokenIdA: string;

    const deactivate = { Operations: [{ op: 'replace', path: 'active', value: false }] };
    const reactivate = { Operations: [{ op: 'replace', path: 'active', value: true }] };

    const entriesFor = (action: string) =>
      owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action },
        orderBy: { createdAt: 'asc' },
      });

    /**
     * Set the purchased seat count on a workspace, so there is a number to move.
     *
     * An update rather than an insert: since the entitlement gate (FR-MOD-11.5)
     * a workspace reaching SCIM at all necessarily has a subscription row —
     * `sso` comes from its plan — so the fixture already laid one down, and a
     * second row would leave "which one is the subscription?" to insertion
     * order.
     */
    const subscribe = (seats: number, licenseId = fx.a.licenseId) =>
      owner.subscription.updateMany({ where: { licenseId }, data: { seats } });

    const seatsOf = async (licenseId: bigint) =>
      (await owner.subscription.findFirst({ where: { licenseId } }))?.seats ?? null;

    beforeEach(async () => {
      const row = await owner.apiToken.findFirst({ where: { tokenHash: hashToken(scimA) } });
      scimTokenIdA = row!.id;
    });

    // --- The trail -----------------------------------------------------------

    describe('audit', () => {
      it('records a provisioning as member.invited, naming the credential', async () => {
        const user = asUser(
          await server.post('/scim/v2/Users', { userName: 'ada@example.test' }, scimBody(scimA)),
        );

        const [entry, ...rest] = await entriesFor('member.invited');
        expect(rest).toHaveLength(0);
        expect(entry!.target).toBe(`account:${user.id}`);
        // Not a person and not one of the workspace's bots: the connector is an
        // external system acting on the workspace's own instruction.
        expect(entry!.actorType).toBe('system');
        expect(entry!.actorId).toBeNull();
        // …which is why the credential has to be in the metadata. Several may be
        // live at once, and "the system did it" names none of them.
        expect(entry!.metadata).toMatchObject({
          via: 'scim',
          scim_token_id: scimTokenIdA,
          role: 'agent',
          active: true,
        });
      });

      it('records a deactivation as member.suspended and a reactivation as member.unsuspended', async () => {
        await server.patch(`/scim/v2/Users/${fx.a.agentAccountId}`, deactivate, scimBody(scimA));
        await server.patch(`/scim/v2/Users/${fx.a.agentAccountId}`, reactivate, scimBody(scimA));

        const suspended = await entriesFor('member.suspended');
        const unsuspended = await entriesFor('member.unsuspended');
        expect(suspended).toHaveLength(1);
        expect(unsuspended).toHaveLength(1);
        expect(suspended[0]!.target).toBe(`account:${fx.a.agentAccountId}`);
        expect(suspended[0]!.metadata).toMatchObject({
          via: 'scim',
          scim_token_id: scimTokenIdA,
          role: 'agent',
        });
        expect(unsuspended[0]!.target).toBe(`account:${fx.a.agentAccountId}`);
      });

      it('records a deprovision as member.suspended — the same action an admin produces', async () => {
        await server.del(`/scim/v2/Users/${fx.a.agentAccountId}`, auth(scimA));
        const [entry] = await entriesFor('member.suspended');
        expect(entry!.target).toBe(`account:${fx.a.agentAccountId}`);
        expect(entry!.metadata).toMatchObject({ via: 'scim' });
      });

      it('invents no action of its own — every entry is one the vocabulary already had', async () => {
        await server.post('/scim/v2/Users', { userName: 'ada@example.test' }, scimBody(scimA));
        await server.del(`/scim/v2/Users/${fx.a.agentAccountId}`, auth(scimA));

        const actions = new Set(
          (
            await owner.auditLogEntry.findMany({
              where: { licenseId: fx.a.licenseId },
              select: { action: true },
            })
          ).map((e) => e.action),
        );
        expect([...actions].every((a) => AUDIT_ACTIONS.includes(a as never))).toBe(true);
        expect(actions).toContain('member.invited');
        expect(actions).toContain('member.suspended');
      });

      it('writes nothing when a sync restates the state already stored', async () => {
        // What a nightly full-profile reconciliation does to every member who
        // did not change. An entry per member per night would bury the real
        // events under the ones that never happened.
        await server.patch(`/scim/v2/Users/${fx.a.agentAccountId}`, reactivate, scimBody(scimA));
        expect(await entriesFor('member.unsuspended')).toHaveLength(0);

        const membership = await owner.agentMembership.findUnique({
          where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        });
        expect(membership!.suspended).toBe(false);
      });

      it('writes one entry when a connector retries a deprovision', async () => {
        await server.del(`/scim/v2/Users/${fx.a.agentAccountId}`, auth(scimA));
        await server.del(`/scim/v2/Users/${fx.a.agentAccountId}`, auth(scimA));
        await server.patch(`/scim/v2/Users/${fx.a.agentAccountId}`, deactivate, scimBody(scimA));
        expect(await entriesFor('member.suspended')).toHaveLength(1);
      });

      it('records the suspension as a presence change too, like the admin path', async () => {
        // Routing skips a suspended agent whatever their routing_status says, so
        // the hours after this are hours they covered nothing — invisible to a
        // forecast that reads only routing_status.
        await server.del(`/scim/v2/Users/${fx.a.agentAccountId}`, auth(scimA));
        const events = await owner.agentPresenceEvent.findMany({
          where: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
          orderBy: { changedAt: 'desc' },
        });
        expect(events[0]!.status).toBe('offline');
      });

      it('leaves no trace in the other workspace', async () => {
        await server.post('/scim/v2/Users', { userName: 'ada@example.test' }, scimBody(scimA));
        await server.del(`/scim/v2/Users/${fx.a.agentAccountId}`, auth(scimA));
        expect(
          await owner.auditLogEntry.count({
            where: { licenseId: fx.b.licenseId, action: { startsWith: 'member.' } },
          }),
        ).toBe(0);
      });
    });

    // --- The bill ------------------------------------------------------------

    describe('seats', () => {
      it('raises the purchased count when provisioning takes the workspace past it', async () => {
        // Two members are seeded, and two seats were bought for them.
        await subscribe(2);

        await server.post('/scim/v2/Users', { userName: 'ada@example.test' }, scimBody(scimA));

        expect(await seatsOf(fx.a.licenseId)).toBe(3);
        const [entry] = await entriesFor('billing.subscription_updated');
        expect(entry!.metadata).toMatchObject({
          via: 'scim',
          scim_token_id: scimTokenIdA,
          fields: ['seats'],
          from: 2,
          to: 3,
        });
      });

      it('leaves the count alone when there is already room', async () => {
        await subscribe(10);
        await server.post('/scim/v2/Users', { userName: 'ada@example.test' }, scimBody(scimA));
        expect(await seatsOf(fx.a.licenseId)).toBe(10);
        expect(await entriesFor('billing.subscription_updated')).toHaveLength(0);
      });

      it('does not charge for a member provisioned deactivated', async () => {
        await subscribe(2);
        const user = asUser(
          await server.post(
            '/scim/v2/Users',
            { userName: 'ada@example.test', active: false },
            scimBody(scimA),
          ),
        );
        expect(user.active).toBe(false);
        expect(await seatsOf(fx.a.licenseId)).toBe(2);
      });

      it('raises the count when a deactivated member is reinstated', async () => {
        await server.del(`/scim/v2/Users/${fx.a.agentAccountId}`, auth(scimA));
        // One person can sign in now, and the workspace has bought one seat.
        await subscribe(1);

        await server.patch(`/scim/v2/Users/${fx.a.agentAccountId}`, reactivate, scimBody(scimA));
        expect(await seatsOf(fx.a.licenseId)).toBe(2);
      });

      it("never lowers it: shrinking a plan is the workspace's call, not a directory's", async () => {
        await subscribe(5);
        await server.del(`/scim/v2/Users/${fx.a.agentAccountId}`, auth(scimA));
        expect(await seatsOf(fx.a.licenseId)).toBe(5);
        expect(await entriesFor('billing.subscription_updated')).toHaveLength(0);
      });

      it('does not turn a trial into a subscription', async () => {
        // No subscription row means nothing has been bought; both the billing
        // view and the invoice already fall back to live headcount. Creating one
        // here would make a provisioning call the moment a trial looked paid.
        //
        // Two things now stand between a trial and that row, and the assertion
        // at the end is the same one either way. The entitlement gate turns the
        // call away first — a trial reads as `growth`, which does not include
        // `sso` (FR-MOD-11.5) — so this door can no longer even reach the seat
        // raiser. Its own trial guard (`ensureSeatsCoverHeadcount` returns
        // early with no row) is still there behind it, and still the reason the
        // rule holds for any future caller that is not a directory.
        await owner.subscription.deleteMany({ where: { licenseId: fx.a.licenseId } });

        const res = await server.post(
          '/scim/v2/Users',
          { userName: 'ada@example.test' },
          scimBody(scimA),
        );
        expect(res.statusCode).toBe(403);
        expect(await owner.subscription.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
      });

      it("cannot move the other workspace's seats", async () => {
        await subscribe(2, fx.b.licenseId);
        await subscribe(2);
        await server.post('/scim/v2/Users', { userName: 'ada@example.test' }, scimBody(scimA));
        expect(await seatsOf(fx.b.licenseId)).toBe(2);
      });
    });

    // --- The owner -----------------------------------------------------------

    describe('the owner', () => {
      it('cannot be deactivated by a patch — 403, and nothing changes', async () => {
        const res = await server.patch(
          `/scim/v2/Users/${fx.a.ownerAccountId}`,
          deactivate,
          scimBody(scimA),
        );
        expect(res.statusCode).toBe(403);
        // Still SCIM's envelope: a connector parses this, not our documentation.
        expect(asError(res).schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
        expect(asError(res).status).toBe('403');

        const membership = await owner.agentMembership.findUnique({
          where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.ownerAccountId } },
        });
        expect(membership!.suspended).toBe(false);
        expect(await entriesFor('member.suspended')).toHaveLength(0);
      });

      it('cannot be deprovisioned either', async () => {
        const res = await server.del(`/scim/v2/Users/${fx.a.ownerAccountId}`, auth(scimA));
        expect(res.statusCode).toBe(403);
        const membership = await owner.agentMembership.findUnique({
          where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.ownerAccountId } },
        });
        expect(membership!.suspended).toBe(false);
      });

      it('is refused with 403 and not the 404 a foreign member gets', async () => {
        // The distinction is deliberate: this member is one the token may
        // legitimately read — they are in its own /Users listing — so answering
        // 404 would leave the connector retrying against something it can see.
        const listed = asList(await server.get('/scim/v2/Users', auth(scimA)));
        expect(listed.Resources.some((u) => u.id === fx.a.ownerAccountId)).toBe(true);
      });

      it('is still readable and still patchable in every other way', async () => {
        // The guard is about deactivation, not about the owner being off limits.
        const res = await server.patch(
          `/scim/v2/Users/${fx.a.ownerAccountId}`,
          { Operations: [{ op: 'add', path: 'externalId', value: 'idp-owner' }] },
          scimBody(scimA),
        );
        expect(res.statusCode).toBe(200);
        expect(asUser(res).externalId).toBe('idp-owner');
      });

      it('accepts a sync that restates the owner as active', async () => {
        // A nightly full-profile push sends `active: true` for everybody. Only a
        // deactivation is refused.
        const res = await server.patch(
          `/scim/v2/Users/${fx.a.ownerAccountId}`,
          reactivate,
          scimBody(scimA),
        );
        expect(res.statusCode).toBe(200);
        expect(asUser(res).active).toBe(true);
      });

      it("protects the owner only: an admin is within a directory's reach", async () => {
        // Which is the reach of the admin who minted the credential: they can
        // suspend a peer, and they cannot suspend the owner either.
        const account = await owner.account.create({
          data: { email: 'admin-lifecycle@example.test', name: 'Admin' },
          select: { id: true },
        });
        await owner.agentMembership.create({
          data: { licenseId: fx.a.licenseId, agentId: account.id, role: 'admin' },
        });

        expect((await server.del(`/scim/v2/Users/${account.id}`, auth(scimA))).statusCode).toBe(
          204,
        );
        const membership = await owner.agentMembership.findUnique({
          where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: account.id } },
        });
        expect(membership!.suspended).toBe(true);
      });
    });

    // --- Access ends now, not at the next sign-in ----------------------------

    describe('a deprovisioned member', () => {
      it('loses a live session on their very next request', async () => {
        // The reason a deprovision does not hunt down tokens one by one: every
        // request re-resolves its bearer token against the membership, so there
        // is no sweep to get wrong and no window to be caught in.
        const agentPat = await grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.agentAccountId,
          scopes: ['agents--all:ro'],
        });
        expect((await server.get('/agents', auth(agentPat))).statusCode).toBe(200);

        await server.del(`/scim/v2/Users/${fx.a.agentAccountId}`, auth(scimA));

        expect((await server.get('/agents', auth(agentPat))).statusCode).toBe(401);
      });

      it('gets their session back when the directory reinstates them', async () => {
        const agentPat = await grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.agentAccountId,
          scopes: ['agents--all:ro'],
        });
        await server.del(`/scim/v2/Users/${fx.a.agentAccountId}`, auth(scimA));
        await server.patch(`/scim/v2/Users/${fx.a.agentAccountId}`, reactivate, scimBody(scimA));

        expect((await server.get('/agents', auth(agentPat))).statusCode).toBe(200);
      });

      it('takes no work from the queue while suspended', async () => {
        // Suspension is already the product's phrase for "may not be routed
        // work" — this is the assertion that SCIM inherits it rather than only
        // flipping a column the routing query happens to read.
        await server.del(`/scim/v2/Users/${fx.a.agentAccountId}`, auth(scimA));
        const routable = await owner.agentMembership.count({
          where: { licenseId: fx.a.licenseId, suspended: false, routingStatus: 'accepting_chats' },
        });
        expect(routable).toBe(1); // the owner, who is not the one deprovisioned
      });
    });
  });

  // --- Groups ----------------------------------------------------------------

  describe('GET /scim/v2/Groups', () => {
    beforeEach(async () => {
      const group = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      });
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId: group.id, agentId: fx.a.agentAccountId },
      });
      await owner.group.create({ data: { licenseId: fx.b.licenseId, name: 'B Team' } });
    });

    it("lists this workspace's teams with their members", async () => {
      const res = await server.get('/scim/v2/Groups', auth(scimA));
      const list = res.json() as {
        totalResults: number;
        Resources: Array<Record<string, unknown>>;
      };
      expect(list.totalResults).toBe(1);
      const group = list.Resources[0] as {
        displayName: string;
        members: Array<{ value: string }>;
      };
      expect(group.displayName).toBe('Support');
      expect(group.members.map((m) => m.value)).toEqual([fx.a.agentAccountId]);
    });

    it("does not show another workspace's teams", async () => {
      const list = (await server.get('/scim/v2/Groups', auth(scimA))).json() as {
        Resources: Array<{ displayName: string }>;
      };
      expect(list.Resources.some((g) => g.displayName === 'B Team')).toBe(false);
    });

    it("answers 404 for another workspace's team by id", async () => {
      const bGroup = await owner.group.findFirst({ where: { licenseId: fx.b.licenseId } });
      const res = await server.get(`/scim/v2/Groups/${bGroup!.id}`, auth(scimA));
      expect(res.statusCode).toBe(404);
    });

    it('filters on displayName', async () => {
      const list = (
        await server.get(
          `/scim/v2/Groups?filter=${encodeURIComponent('displayName eq "Support"')}`,
          auth(scimA),
        )
      ).json() as { totalResults: number };
      expect(list.totalResults).toBe(1);
    });
  });

  // --- The mint/revoke surface ----------------------------------------------

  describe('POST /settings/scim-tokens', () => {
    let adminToken: string;
    let agentToken: string;
    let bAdminToken: string;
    let adminAccountId: string;

    beforeEach(async () => {
      bAdminToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['access_rules:rw'],
      });
      const admin = await owner.account.create({
        data: { email: 'admin-a@example.test', name: 'Admin A' },
        select: { id: true },
      });
      adminAccountId = admin.id;
      await owner.agentMembership.create({
        data: { licenseId: fx.a.licenseId, agentId: admin.id, role: 'admin' },
      });
      adminToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: admin.id,
        scopes: ['access_rules:rw', 'access_rules:ro'],
      });
      agentToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        // A rank-and-file agent holding an over-broad PAT: the scope is there,
        // the role is not.
        scopes: ['access_rules:rw'],
      });
    });

    it('mints a credential for an admin and returns it exactly once', async () => {
      const res = await server.post(
        '/settings/scim-tokens',
        { name: 'Okta (corp)' },
        auth(adminToken),
      );
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; name: string; token: string; expires_at: null };
      expect(body.name).toBe('Okta (corp)');
      expect(body.token).toBeTypeOf('string');
      expect(body.expires_at).toBeNull();
      expect(res.headers['cache-control']).toBe('no-store');

      // Only the digest is stored — the plaintext is nowhere in the row.
      const row = await owner.apiToken.findUnique({ where: { id: body.id } });
      expect(row!.kind).toBe('scim');
      expect(row!.tokenHash).toBe(hashToken(body.token));
      expect(
        JSON.stringify(row, (_key, value) => (typeof value === 'bigint' ? String(value) : value)),
      ).not.toContain(body.token);
      // No scopes: the surface it may reach is decided by its kind, not a list.
      expect(row!.scopes).toEqual([]);

      // And it works.
      expect((await server.get('/scim/v2/Users', auth(body.token))).statusCode).toBe(200);

      // The listing never carries the credential again.
      const listed = (await server.get('/settings/scim-tokens', auth(adminToken))).json() as {
        items: Array<Record<string, unknown>>;
      };
      const entry = listed.items.find((t) => t.id === body.id);
      expect(entry).toBeDefined();
      expect(entry).not.toHaveProperty('token');
      expect(entry!.name).toBe('Okta (corp)');
    });

    it('refuses a rank-and-file agent even with the scope', async () => {
      const res = await server.post('/settings/scim-tokens', { name: 'nope' }, auth(agentToken));
      expect(res.statusCode).toBe(403);
      expect(await owner.apiToken.count({ where: { kind: 'scim', name: 'nope' } })).toBe(0);
    });

    it('refuses an unauthenticated caller', async () => {
      expect((await server.post('/settings/scim-tokens', { name: 'nope' })).statusCode).toBe(401);
    });

    it('requires a name — an unnamed credential cannot be told from another', async () => {
      expect((await server.post('/settings/scim-tokens', {}, auth(adminToken))).statusCode).toBe(
        400,
      );
    });

    it('honours an expiry and caps it at a year', async () => {
      const res = await server.post(
        '/settings/scim-tokens',
        { name: 'temporary', expires_in_days: 30 },
        auth(adminToken),
      );
      expect(res.statusCode).toBe(201);
      expect((res.json() as { expires_at: string }).expires_at).not.toBeNull();
      expect(
        (
          await server.post(
            '/settings/scim-tokens',
            { name: 'too long', expires_in_days: 400 },
            auth(adminToken),
          )
        ).statusCode,
      ).toBe(400);
    });

    it('caps how many live credentials a workspace may hold', async () => {
      // `scimA` already occupies one slot, so fill the rest and then ask for one
      // more than the workspace may hold.
      const held = await owner.apiToken.count({
        where: { licenseId: fx.a.licenseId, kind: 'scim', revokedAt: null },
      });
      for (let i = held; i < MAX_ACTIVE_SCIM_TOKENS; i += 1) {
        expect(
          (await server.post('/settings/scim-tokens', { name: `t${i}` }, auth(adminToken)))
            .statusCode,
        ).toBe(201);
      }

      const over = await server.post(
        '/settings/scim-tokens',
        { name: 'one too many' },
        auth(adminToken),
      );
      expect(over.statusCode).toBe(429);
      // Refused, not silently pruned: revoking the oldest would look like an
      // outage to whichever connector held it.
      expect(
        await owner.apiToken.count({
          where: { licenseId: fx.a.licenseId, kind: 'scim', revokedAt: null },
        }),
      ).toBe(MAX_ACTIVE_SCIM_TOKENS);
      // And the cap is per workspace: B is unaffected.
      expect(
        (await server.post('/settings/scim-tokens', { name: 'b is fine' }, auth(bAdminToken)))
          .statusCode,
      ).toBe(201);
    });

    it('records the mint in the audit trail without recording the credential', async () => {
      const body = (
        await server.post('/settings/scim-tokens', { name: 'Okta (corp)' }, auth(adminToken))
      ).json() as { id: string; token: string };

      const entry = await owner.auditLogEntry.findFirst({
        where: { licenseId: fx.a.licenseId, action: 'scim_token.created' },
      });
      expect(entry).not.toBeNull();
      expect(entry!.target).toBe(`token:${body.id}`);
      expect(entry!.actorId).toBe(adminAccountId);
      expect(JSON.stringify(entry!.metadata)).not.toContain(body.token);
    });

    it('revokes a credential, and the connector stops working at once', async () => {
      const body = (
        await server.post('/settings/scim-tokens', { name: 'Okta (corp)' }, auth(adminToken))
      ).json() as { id: string; token: string };
      expect((await server.get('/scim/v2/Users', auth(body.token))).statusCode).toBe(200);

      expect(
        (await server.del(`/settings/scim-tokens/${body.id}`, auth(adminToken))).statusCode,
      ).toBe(204);
      expect((await server.get('/scim/v2/Users', auth(body.token))).statusCode).toBe(401);

      const entry = await owner.auditLogEntry.findFirst({
        where: { licenseId: fx.a.licenseId, action: 'scim_token.revoked' },
      });
      expect(entry!.target).toBe(`token:${body.id}`);
    });

    it("cannot revoke another workspace's credential", async () => {
      const bToken = await owner.apiToken.findFirst({
        where: { licenseId: fx.b.licenseId, kind: 'scim' },
      });
      const res = await server.del(`/settings/scim-tokens/${bToken!.id}`, auth(adminToken));
      expect(res.statusCode).toBe(404);
      expect(
        (await owner.apiToken.findUnique({ where: { id: bToken!.id } }))!.revokedAt,
      ).toBeNull();
    });

    it('cannot be used to revoke a personal access token', async () => {
      // Without the kind filter this would be a second revocation path that
      // skips the ownership check on `/auth/personal-access-tokens`.
      const pat = await owner.apiToken.findFirst({
        where: { licenseId: fx.a.licenseId, kind: 'pat' },
      });
      expect(
        (await server.del(`/settings/scim-tokens/${pat!.id}`, auth(adminToken))).statusCode,
      ).toBe(404);
      expect((await owner.apiToken.findUnique({ where: { id: pat!.id } }))!.revokedAt).toBeNull();
    });

    it("does not list another workspace's credentials", async () => {
      const listed = (await server.get('/settings/scim-tokens', auth(adminToken))).json() as {
        items: Array<{ id: string }>;
      };
      const bToken = await owner.apiToken.findFirst({
        where: { licenseId: fx.b.licenseId, kind: 'scim' },
      });
      expect(listed.items.some((t) => t.id === bToken!.id)).toBe(false);
    });
  });
});
