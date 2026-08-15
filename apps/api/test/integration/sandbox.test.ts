/**
 * The sandbox workspace (FR-MOD-11.5 · 11.5-f).
 *
 * A sandbox is a **second tenant**, and the whole slice is one claim: nothing
 * crosses between it and the workspace that pays for it, in either direction
 * and in every sense — data, reports, meter, invoice, seats.
 *
 * Three of those are worth saying out loud about *why* they are tested here,
 * because none of them is enforced by code that mentions the word "sandbox":
 *
 *   - **The customer directory.** `customers` is scoped to the organization and
 *     carries no licence column, which is the single fact that made a sandbox
 *     need a whole organization rather than a sibling licence. Had it been a
 *     sibling, everything else below would still pass while the sandbox read
 *     every name, e-mail and phone number in production. That is the test that
 *     would have caught the design being wrong, so it is written first.
 *   - **Reports and seats.** Neither has a line of sandbox-aware code: they are
 *     licence-scoped, so RLS already answers. Asserted anyway, because "it
 *     follows from the architecture" is precisely the claim that stops being
 *     true the day a report grows an organization-wide join.
 *   - **The meter.** The one place that *is* sandbox-aware, and the one where a
 *     miss ends up on a customer's invoice.
 *
 * The mandatory negative is the reset: a production licence asking to be wiped
 * must be refused. Reset is reachable only from inside a sandbox, so a stolen
 * production credential cannot destroy a workspace at all — the credential that
 * asks has to be a credential for the thing being deleted.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  seedSubscription,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { withTenant } from '../../src/lib/tenant.js';
import {
  currentPeriod,
  recordAiResolution,
  recordApiCall,
} from '../../src/services/billing/metering.js';

interface SandboxView {
  is_sandbox: boolean;
  entitled: boolean;
  sandbox: {
    license_id: string;
    region: string;
    created_at: string;
    reset_at: string | null;
  } | null;
}

interface ErrorBody {
  error: { type: string; message: string; details?: { entitlement?: string; sandbox?: boolean } };
}

const ADMIN_SCOPES = [
  'access_rules:rw',
  'agents--all:ro',
  'chats--all:rw',
  'customers:rw',
  'reports_read',
  'billing_manage',
];

describe('sandbox workspace (11.5-f)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  /** Tenant A's owner — on Enterprise, so it may create a sandbox. */
  let token: string;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    // Only tenant A is upgraded. B stays on the default trial so the
    // entitlement half of this suite is testing the gate rather than the
    // fixture, exactly as `SeedOptions.plan` documents.
    fx = await seedFixtures(owner);
    await seedSubscription(owner, fx.a.licenseId, 'enterprise');
    await clearRateLimits(server.app);

    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ADMIN_SCOPES,
    });
  });

  const auth = {
    get authorization() {
      return `Bearer ${token}`;
    },
  };

  const bearer = (value: string): Record<string, string> => ({ authorization: `Bearer ${value}` });

  /** Create the sandbox and mint an owner credential inside it. */
  async function createSandbox(): Promise<{
    licenseId: bigint;
    organizationId: string;
    token: string;
  }> {
    const created = await server.post('/settings/sandbox', undefined, auth);
    expect(created.statusCode).toBe(201);

    const licenseId = BigInt((created.json() as SandboxView).sandbox!.license_id);
    // Read as the owner connection: the point of the test is what the *API*
    // can see across the boundary, so the fixture deliberately reaches around
    // it rather than asking the surface under test where the sandbox lives.
    const row = await owner.license.findUniqueOrThrow({
      where: { id: licenseId },
      select: { organizationId: true },
    });

    return {
      licenseId,
      organizationId: row.organizationId,
      token: await grantToken(owner, {
        licenseId,
        organizationId: row.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ADMIN_SCOPES,
      }),
    };
  }

  /** A closed chat with one customer message, in whichever licence is named. */
  async function conversationIn(
    licenseId: bigint,
    organizationId: string,
    headers: Record<string, string>,
  ) {
    const customer = await owner.customer.create({
      data: { organizationId, name: 'Visitor' },
      select: { id: true },
    });
    const chat = await server.post(
      '/chats',
      { customer_id: customer.id, assign_to_me: true },
      headers,
    );
    expect(chat.statusCode).toBe(201);
    const chatId = chat.json().id as string;

    const thread = await owner.thread.findFirstOrThrow({ where: { chatId } });
    await owner.event.create({
      data: {
        id: `${thread.id}_50`,
        threadId: thread.id,
        chatId,
        licenseId,
        type: 'message',
        text: 'Hello?',
        authorType: 'customer',
        recipients: 'all',
        createdAt: new Date(Date.now() - 60_000),
      },
    });
    await server.post(`/chats/${chatId}/deactivate`, undefined, headers);
    return { chatId, customerId: customer.id };
  }

  // --- Creating one --------------------------------------------------------

  describe('creation', () => {
    it('mints a second workspace in its own organization, in the same region', async () => {
      const before = await server.get('/settings/sandbox', auth);
      expect(before.statusCode).toBe(200);
      expect(before.json() as SandboxView).toMatchObject({
        is_sandbox: false,
        entitled: true,
        sandbox: null,
      });

      const sandbox = await createSandbox();

      // A different organization, not a sibling licence. This is the assertion
      // the whole design turns on — see the customer-directory test below for
      // what it buys.
      expect(sandbox.organizationId).not.toBe(fx.a.organizationId);

      const [parentOrg, sandboxOrg] = await Promise.all([
        owner.organization.findUniqueOrThrow({ where: { id: fx.a.organizationId } }),
        owner.organization.findUniqueOrThrow({ where: { id: sandbox.organizationId } }),
      ]);
      // Inherited, never chosen: residency is immutable (C4-a), so this INSERT
      // is the only moment the value was writable at all.
      expect(sandboxOrg.region).toBe(parentOrg.region);

      const view = (await server.get('/settings/sandbox', auth)).json() as SandboxView;
      expect(view.sandbox).toMatchObject({
        license_id: sandbox.licenseId.toString(),
        region: parentOrg.region,
        reset_at: null,
      });
    });

    it('gives the sandbox the parts a workspace cannot function without', async () => {
      const sandbox = await createSandbox();

      const [brand, membership, client] = await Promise.all([
        owner.brand.findFirst({ where: { licenseId: sandbox.licenseId, isDefault: true } }),
        owner.agentMembership.findUnique({
          where: {
            licenseId_agentId: { licenseId: sandbox.licenseId, agentId: fx.a.ownerAccountId },
          },
        }),
        owner.oauthClient.findFirst({ where: { organizationId: sandbox.organizationId } }),
      ]);

      // A default brand, or the first brand-scoped write fails with "this
      // workspace has no default brand"; an owner membership, or nobody can
      // sign in; an OAuth client, or `auth_list_memberships` hands the console
      // a workspace with no door.
      expect(brand).not.toBeNull();
      expect(membership?.role).toBe('owner');
      expect(client?.redirectUris).toEqual(
        (
          await owner.oauthClient.findFirstOrThrow({
            where: { organizationId: fx.a.organizationId },
          })
        ).redirectUris,
      );
    });

    it('is refused on a plan that does not include it', async () => {
      const growth = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ADMIN_SCOPES,
      });

      const refused = await server.post('/settings/sandbox', undefined, bearer(growth));
      expect(refused.statusCode).toBe(403);
      expect((refused.json() as ErrorBody).error.details?.entitlement).toBe('sandbox');

      // The read stays open, so the screen can show the upsell rather than an
      // unexplained 403 where the control belongs.
      const view = await server.get('/settings/sandbox', bearer(growth));
      expect(view.statusCode).toBe(200);
      expect(view.json() as SandboxView).toMatchObject({ entitled: false, sandbox: null });
    });

    it('is refused to anyone but the owner', async () => {
      const agent = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ADMIN_SCOPES,
      });

      const refused = await server.post('/settings/sandbox', undefined, bearer(agent));
      expect(refused.statusCode).toBe(403);
      expect(await owner.license.count({ where: { sandboxOfLicenseId: fx.a.licenseId } })).toBe(0);
    });

    it('refuses a second sandbox, and a sandbox of a sandbox', async () => {
      const sandbox = await createSandbox();

      const second = await server.post('/settings/sandbox', undefined, auth);
      expect(second.statusCode).toBe(409);
      expect((second.json() as ErrorBody).error.type).toBe('sandbox_exists');

      // From inside: the entitlement gate answers first — a sandbox holds no
      // subscription, so it reads as the self-serve tier — which is itself the
      // structural reason sandboxes cannot nest.
      const nested = await server.post('/settings/sandbox', undefined, bearer(sandbox.token));
      expect(nested.statusCode).toBe(403);
      expect(await owner.license.count({ where: { sandboxOfLicenseId: sandbox.licenseId } })).toBe(
        0,
      );
    });

    it('refuses a nested sandbox in the database, not only at the route', async () => {
      const sandbox = await createSandbox();

      // The route and the entitlement gate are both bypassed here on purpose:
      // the rule has to bind a migration, the seed and a psql session too.
      await expect(
        owner.$executeRaw`SELECT * FROM sandbox_create(${sandbox.licenseId}, ${fx.a.ownerAccountId}::uuid)`,
      ).rejects.toThrow(/nexa_sandbox_nested/);
    });
  });

  // --- Nothing crosses -----------------------------------------------------

  describe('isolation', () => {
    it('does not show the production customer directory', async () => {
      // The fixture already seeded a customer for tenant A. This is the leak a
      // same-organization sandbox would have had, and the reason it has its own.
      const sandbox = await createSandbox();

      const inside = await server.get('/customers', bearer(sandbox.token));
      expect(inside.statusCode).toBe(200);
      expect(inside.json().items).toEqual([]);

      const outside = await server.get('/customers', auth);
      expect(outside.json().items.length).toBeGreaterThan(0);
    });

    it('cannot read the production licence row, in either direction of the query', async () => {
      const sandbox = await createSandbox();

      // The API's own view: a sandbox is told it is one and nothing else. No
      // parent id, no plan, no acknowledgement that a parent exists.
      const view = await server.get('/settings/sandbox', bearer(sandbox.token));
      expect(view.json() as SandboxView).toEqual({
        is_sandbox: true,
        entitled: false,
        sandbox: null,
      });

      // And underneath it, against the `nexa_app` role the API connects as:
      // the widened `licenses_tenant` policy is one-directional by
      // construction, so the sandbox's context matches exactly one row — its
      // own — however the query is written.
      const appRole = new PrismaClient({ datasourceUrl: process.env['DATABASE_APP_URL'] });
      try {
        const visible = await withTenant(
          appRole,
          { licenseId: sandbox.licenseId, organizationId: sandbox.organizationId },
          (tx) => tx.license.findMany({ select: { id: true } }),
        );
        expect(visible.map((row) => row.id)).toEqual([sandbox.licenseId]);

        // The parent sees exactly two: itself and the sandbox it owns.
        const fromParent = await withTenant(
          appRole,
          { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
          (tx) => tx.license.findMany({ select: { id: true } }),
        );
        expect(new Set(fromParent.map((row) => row.id))).toEqual(
          new Set([fx.a.licenseId, sandbox.licenseId]),
        );
      } finally {
        await appRole.$disconnect();
      }
    });

    it('keeps sandbox conversations out of the production reports', async () => {
      const sandbox = await createSandbox();

      await conversationIn(fx.a.licenseId, fx.a.organizationId, auth);
      const before = (await server.get('/reports/overview', auth)).json();

      await conversationIn(sandbox.licenseId, sandbox.organizationId, bearer(sandbox.token));

      const after = (await server.get('/reports/overview', auth)).json();
      expect(after.totals).toEqual(before.totals);

      // And the sandbox's own report counts its own case, so the isolation is
      // separation rather than the sandbox simply not working.
      const inside = (await server.get('/reports/overview', bearer(sandbox.token))).json();
      expect(inside.totals.chats).toBe(1);
    });
  });

  // --- Nothing is billed ---------------------------------------------------

  describe('billing', () => {
    it('records no usage for a sandbox, and still records it for production', async () => {
      const sandbox = await createSandbox();
      const appRole = new PrismaClient({ datasourceUrl: process.env['DATABASE_APP_URL'] });

      try {
        for (const tenant of [
          { licenseId: sandbox.licenseId, organizationId: sandbox.organizationId },
          { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        ]) {
          await withTenant(appRole, tenant, async (tx) => {
            await recordApiCall(tx, tenant, 2950, 100_000);
            await recordAiResolution(tx, tenant, 50, 200);
          });
        }

        const records = await owner.usageRecord.findMany({
          where: { period: currentPeriod() },
          select: { licenseId: true, metric: true, quantity: true },
        });

        expect(records.filter((r) => r.licenseId === sandbox.licenseId)).toEqual([]);
        expect(records.filter((r) => r.licenseId === fx.a.licenseId)).toHaveLength(2);
      } finally {
        await appRole.$disconnect();
      }
    });

    it('does not meter a sandbox API call made through the API itself', async () => {
      const sandbox = await createSandbox();

      // A PAT is what the meter counts (`plugins/metering.ts`), so this is the
      // end-to-end version of the test above: a real request, served, and no
      // row behind it.
      const served = await server.get('/agents', bearer(sandbox.token));
      expect(served.statusCode).toBe(200);

      expect(await owner.usageRecord.count({ where: { licenseId: sandbox.licenseId } })).toBe(0);
    });

    it('refuses every billing write inside a sandbox', async () => {
      const sandbox = await createSandbox();

      const refused = await server.patch(
        '/billing/subscription',
        { seats: 5 },
        bearer(sandbox.token),
      );
      expect(refused.statusCode).toBe(403);
      expect((refused.json() as ErrorBody).error.details?.sandbox).toBe(true);
      expect(await owner.subscription.count({ where: { licenseId: sandbox.licenseId } })).toBe(0);

      // The read stays open — that is how a screen says "nothing here is
      // charged" instead of failing to render.
      const read = await server.get('/billing/subscription', bearer(sandbox.token));
      expect(read.statusCode).toBe(200);

      // And the parent's own billing is untouched by any of it.
      const parent = await server.patch('/billing/subscription', { seats: 5 }, auth);
      expect(parent.statusCode).toBe(200);
    });

    it('does not count sandbox members as seats on the bill', async () => {
      const sandbox = await createSandbox();

      // Someone joins the sandbox and nobody joins production. The seat floor
      // is "non-suspended agents on this workspace" — a rule with no sandbox
      // clause in it, which is the point: the licence boundary answers.
      await owner.agentMembership.create({
        data: { licenseId: sandbox.licenseId, agentId: fx.a.agentAccountId, role: 'agent' },
      });

      // Two people work for tenant A (the fixture's owner and agent); the third
      // membership lives in the sandbox and must not push the floor to three.
      const lowered = await server.patch('/billing/subscription', { seats: 2 }, auth);
      expect(lowered.statusCode).toBe(200);
      expect(lowered.json().seats).toBe(2);

      // Three would be the floor if the sandbox's member counted — asserted
      // from the other side so the test fails if the count ever widens.
      const tooFew = await server.patch('/billing/subscription', { seats: 1 }, auth);
      expect(tooFew.statusCode).toBe(400);
      expect((tooFew.json() as ErrorBody).error.message).toContain('2 active agent');
    });
  });

  // --- Emptying one --------------------------------------------------------

  describe('reset', () => {
    it('is refused on a production workspace — and deletes nothing', async () => {
      await createSandbox();
      await conversationIn(fx.a.licenseId, fx.a.organizationId, auth);

      const refused = await server.post('/settings/sandbox/reset', undefined, auth);
      expect(refused.statusCode).toBe(403);
      expect((refused.json() as ErrorBody).error.type).toBe('not_allowed');

      // The workspace that asked is intact: its chats, its customers, its
      // licence row. A refusal that had already started deleting would be worse
      // than no refusal at all.
      expect(await owner.chat.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
      expect(await owner.customer.count({ where: { organizationId: fx.a.organizationId } })).toBe(
        2,
      );
      expect(await owner.license.count({ where: { id: fx.a.licenseId } })).toBe(1);
    });

    it('is refused in the database too, so the route is not the only guard', async () => {
      await expect(owner.$executeRaw`SELECT sandbox_reset(${fx.a.licenseId})`).rejects.toThrow(
        /nexa_not_a_sandbox/,
      );
      expect(await owner.license.count({ where: { id: fx.a.licenseId } })).toBe(1);
    });

    it('empties the sandbox, keeps the workspace, and leaves production alone', async () => {
      const sandbox = await createSandbox();
      await conversationIn(fx.a.licenseId, fx.a.organizationId, auth);
      await conversationIn(sandbox.licenseId, sandbox.organizationId, bearer(sandbox.token));

      const reset = await server.post('/settings/sandbox/reset', undefined, bearer(sandbox.token));
      expect(reset.statusCode).toBe(200);
      expect(reset.json().signed_out).toBe(true);

      // Gone: conversations, and the customers the cascade cannot reach because
      // they hang off the organization rather than the licence.
      expect(await owner.chat.count({ where: { licenseId: sandbox.licenseId } })).toBe(0);
      expect(
        await owner.customer.count({ where: { organizationId: sandbox.organizationId } }),
      ).toBe(0);

      // Still there: the workspace itself, with the same licence id, the same
      // members and a default brand — a reset is not a deletion.
      const after = await owner.license.findUniqueOrThrow({ where: { id: sandbox.licenseId } });
      expect(after.sandboxOfLicenseId).toBe(fx.a.licenseId);
      expect(after.sandboxResetAt).not.toBeNull();
      expect(await owner.agentMembership.count({ where: { licenseId: sandbox.licenseId } })).toBe(
        1,
      );
      expect(
        await owner.brand.count({ where: { licenseId: sandbox.licenseId, isDefault: true } }),
      ).toBe(1);

      // Production is untouched, which is the half a wipe gets wrong loudly.
      expect(await owner.chat.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
      expect(await owner.customer.count({ where: { organizationId: fx.a.organizationId } })).toBe(
        2,
      );
    });

    it('signs out the credentials it deleted, and tells the parent when it happened', async () => {
      const sandbox = await createSandbox();

      await server.post('/settings/sandbox/reset', undefined, bearer(sandbox.token));

      // The token was issued against the licence row the reset deleted, so it
      // stops resolving. The route says `signed_out: true` rather than leaving
      // a client to discover this on its next call.
      const afterwards = await server.get('/settings/sandbox', bearer(sandbox.token));
      expect(afterwards.statusCode).toBe(401);

      // The parent reads the reset off the licence row — the evidence that
      // survives a wipe without a cross-licence audit write.
      const view = (await server.get('/settings/sandbox', auth)).json() as SandboxView;
      expect(view.sandbox?.reset_at).not.toBeNull();
    });
  });

  it('goes away with the workspace that paid for it', async () => {
    const sandbox = await createSandbox();

    // Not something the API exposes — no endpoint deletes a workspace — but the
    // cascade is what stops a cancelled customer's sandbox outliving them, so
    // it is asserted where it lives.
    await owner.license.delete({ where: { id: fx.a.licenseId } });

    expect(await owner.license.count({ where: { id: sandbox.licenseId } })).toBe(0);
  });

  it('writes the creation into the parent workspace trail, not the sandbox', async () => {
    const sandbox = await createSandbox();

    const parentEntries = await owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: 'settings.sandbox_created' },
      select: { target: true },
    });
    expect(parentEntries).toHaveLength(1);
    expect(parentEntries[0]?.target).toBe(`license:${sandbox.licenseId}`);

    // The sandbox starts with an empty trail, as a fresh workspace does.
    expect(await owner.auditLogEntry.count({ where: { licenseId: sandbox.licenseId } })).toBe(0);
  });
});
