/**
 * Goals — defining a conversion target (FR-MOD-13.3 KK: "hedef tanımı").
 *
 * Two things carry the weight here. The first is that a goal can be created,
 * listed and retired at all — the acceptance criterion. The second is what the
 * endpoint refuses: a definition key that is a typo would otherwise save a goal
 * that silently matches nobody, and another tenant's goal id must come back as
 * a 404 rather than a 403, so probing ids cannot confirm which ones exist
 * (NFR-S3 at the route, NFR-S4 RLS, NFR-S5 on enumeration).
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface Goal {
  id: string;
  name: string;
  definition: { url_contains?: string };
  active: boolean;
  created_at: string;
}

describe('goals', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let writeToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const create = async (token: string, body: unknown) => server.post('/goals', body, auth(token));
  const list = async (token: string, query = ''): Promise<Goal[]> => {
    const response = await server.get(`/goals${query}`, auth(token));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: Goal[] }).items;
  };

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
    writeToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['customers:rw'],
    });
  });

  // --- Validation (negative first) -------------------------------------------

  it('rejects a definition whose key is a typo', async () => {
    const response = await create(writeToken, {
      name: 'Checkout',
      definition: { url_contain: '/thank-you' },
    });
    expect(response.statusCode).toBe(400);
    // Nothing was written — a goal that matches nobody must not exist.
    expect(await owner.goal.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
  });

  it('rejects a definition with nothing to match on', async () => {
    const response = await create(writeToken, { name: 'Empty', definition: {} });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a blank name', async () => {
    const response = await create(writeToken, {
      name: '   ',
      definition: { url_contains: '/thank-you' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an empty patch body', async () => {
    const created = (
      await create(writeToken, { name: 'Checkout', definition: { url_contains: '/thank-you' } })
    ).json() as Goal;
    const response = await server.patch(`/goals/${created.id}`, {}, auth(writeToken));
    expect(response.statusCode).toBe(400);
  });

  it('will not let an edit strip the definition out of an active goal', async () => {
    const created = (
      await create(writeToken, { name: 'Checkout', definition: { url_contains: '/thank-you' } })
    ).json() as Goal;
    const response = await server.patch(
      `/goals/${created.id}`,
      { definition: {} },
      auth(writeToken),
    );
    expect(response.statusCode).toBe(400);
  });

  // --- The acceptance criterion: a goal can be defined and edited ------------

  it('creates a goal, lists it, and toggles it inactive', async () => {
    const created = await create(writeToken, {
      name: 'Reached checkout',
      definition: { url_contains: '/thank-you' },
    });
    expect(created.statusCode).toBe(201);
    const goal = created.json() as Goal;
    expect(goal).toMatchObject({
      name: 'Reached checkout',
      definition: { url_contains: '/thank-you' },
      active: true,
    });

    expect((await list(writeToken)).map((g) => g.id)).toEqual([goal.id]);
    expect((await list(writeToken, '?status=active')).map((g) => g.id)).toEqual([goal.id]);
    expect(await list(writeToken, '?status=inactive')).toEqual([]);

    const patched = await server.patch(`/goals/${goal.id}`, { active: false }, auth(writeToken));
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as Goal).active).toBe(false);

    // Retired, not deleted: it drops out of `active` and shows up in `inactive`.
    expect(await list(writeToken, '?status=active')).toEqual([]);
    expect((await list(writeToken, '?status=inactive')).map((g) => g.id)).toEqual([goal.id]);
    expect((await list(writeToken, '?status=all')).map((g) => g.id)).toEqual([goal.id]);
  });

  it('renames a goal and rewrites its definition', async () => {
    const goal = (
      await create(writeToken, { name: 'Old', definition: { url_contains: '/old' } })
    ).json() as Goal;

    const response = await server.patch(
      `/goals/${goal.id}`,
      { name: 'New', definition: { url_contains: '/new' } },
      auth(writeToken),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: 'New', definition: { url_contains: '/new' } });
  });

  it('lets an inactive goal keep a definition that cannot match', async () => {
    const goal = (
      await create(writeToken, {
        name: 'Retired',
        definition: { url_contains: '/x' },
        active: false,
      })
    ).json() as Goal;
    expect(goal.active).toBe(false);

    // The "needs something to match on" rule guards active goals; a retired one
    // is not tracking anything, so clearing it is allowed.
    const response = await server.patch(`/goals/${goal.id}`, { definition: {} }, auth(writeToken));
    expect(response.statusCode).toBe(200);
  });

  it('lists newest first', async () => {
    await create(writeToken, { name: 'First', definition: { url_contains: '/1' } });
    await create(writeToken, { name: 'Second', definition: { url_contains: '/2' } });
    expect((await list(writeToken)).map((g) => g.name)).toEqual(['Second', 'First']);
  });

  // --- Cross-tenant: not forbidden, non-existent (NFR-S4/S5) -----------------

  it("returns 404 for another tenant's goal and never lists it", async () => {
    const theirs = await owner.goal.create({
      data: { licenseId: fx.b.licenseId, name: 'Theirs', definition: { url_contains: '/theirs' } },
      select: { id: true },
    });

    const response = await server.patch(
      `/goals/${theirs.id}`,
      { name: 'Mine now' },
      auth(writeToken),
    );
    expect(response.statusCode).toBe(404);

    expect(await list(writeToken, '?status=all')).toEqual([]);
    // And the attempt changed nothing on their side.
    const after = await owner.goal.findUniqueOrThrow({
      where: { id: theirs.id },
      select: { name: true },
    });
    expect(after.name).toBe('Theirs');
  });

  it('404s on a goal id that does not exist anywhere', async () => {
    const response = await server.patch(
      '/goals/00000000-0000-4000-8000-000000000000',
      { name: 'x' },
      auth(writeToken),
    );
    expect(response.statusCode).toBe(404);
  });

  it('rejects a malformed goal id with a 400', async () => {
    const response = await server.patch('/goals/not-a-uuid', { name: 'x' }, auth(writeToken));
    expect(response.statusCode).toBe(400);
  });

  // --- Scope split (NFR-S3, at the route) ------------------------------------

  it('lets a read-only agent list but not create or edit goals', async () => {
    const created = (
      await create(writeToken, { name: 'Checkout', definition: { url_contains: '/thank-you' } })
    ).json() as Goal;

    const readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['customers:ro'],
    });

    expect((await server.get('/goals', auth(readToken))).statusCode).toBe(200);
    const denied = await create(readToken, { name: 'Nope', definition: { url_contains: '/x' } });
    expect(denied.statusCode).toBe(403);
    const deniedPatch = await server.patch(
      `/goals/${created.id}`,
      { name: 'Nope' },
      auth(readToken),
    );
    expect(deniedPatch.statusCode).toBe(403);
  });

  it('rejects a caller with no customer scope', async () => {
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:ro'],
    });
    expect((await server.get('/goals', auth(token))).statusCode).toBe(403);
  });
});
