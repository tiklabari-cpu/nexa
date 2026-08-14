/**
 * SCIM 2.0 server core (S11-e) — the boundary, end to end.
 *
 * The claim this file exists to hold is one sentence: **a SCIM token reaches
 * exactly one workspace's members and nothing else.** Everything below is a way
 * of trying to break it.
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
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../src/lib/crypto.js';
import { MAX_ACTIVE_SCIM_TOKENS } from '../../src/routes/settings.js';
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
    fx = await seedFixtures(owner);
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
