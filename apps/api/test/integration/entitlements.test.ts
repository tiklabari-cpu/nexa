/**
 * The entitlement gate (FR-MOD-11.5 · 11.5-b) — what a plan is allowed to do.
 *
 * `11.5-a` shipped the vocabulary and the catalogue and enforced nothing: on
 * the day this file was written a `growth` workspace could still switch its
 * widget branding off, federate with an identity provider, sign a BAA and ship
 * its audit trail to an external SIEM. This suite is the proof that it cannot.
 *
 * The claim worth making carefully is not "the write is refused" — that is one
 * `config` line per route and would be hard to get wrong. It is the **downgrade
 * path**, which is where a gate that only guards writes quietly fails:
 *
 *   - A workspace turns white-label on while it holds the entitlement. It
 *     downgrades. The `powered_by = false` row is still there — deliberately
 *     (§C-A26): a commercial change must not destroy configuration a
 *     re-upgrade should restore. So the *reads* have to be the thing that stops
 *     honouring it, on all three surfaces that serve the widget's look, or the
 *     unbranded widget simply keeps being served forever and the write gate was
 *     theatre.
 *   - The same shape one level down: the SIEM sink is a scheduled loop, not an
 *     endpoint. Gate only the HTTP surface and a downgraded workspace goes on
 *     exporting every security event it has, on a timer, having stopped paying
 *     for it.
 *
 * Both are tested here by actually moving a workspace between plans and reading
 * back, rather than by seeding the end state — the row surviving the move is
 * half of what is being asserted.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENTITLEMENTS, type Entitlement } from '@nexa/types';
import { SiemSink } from '../../src/services/audit/siem-sink.js';
import { VALID_CERTIFICATE_PEM } from '../helpers/certificates.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  seedSubscription,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const AUDIT_CHAIN_SECRET = 'entitlements-integration-test-secret-value';

interface WidgetView {
  primary_color: string;
  powered_by: boolean;
}

interface Website {
  id: string;
  snippet: string;
}

interface ErrorBody {
  error: { type: string; message: string; details?: { entitlement?: string; plan?: string } };
}

describe('plan entitlements (11.5-b)', () => {
  /** The European deployment — where the fixture tenants live. */
  let server: TestServer;
  /** The same build configured as the US deployment, for the HIPAA workspace. */
  let usServer: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;
  let brandA: string;
  let siemDir: string;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({ AUDIT_CHAIN_SECRET });
    usServer = await startTestServer({ NEXA_REGION: 'us', AUDIT_CHAIN_SECRET });
  });

  afterAll(async () => {
    await Promise.all([server.close(), usServer.close()]);
    await owner.$disconnect();
  });

  beforeEach(async () => {
    // No `plan` — the default fixture has no subscription row at all, which is
    // a trial, which entitles it to nothing beyond self-serve. Each test moves
    // the workspace it is about onto the plan it means to test.
    fx = await seedFixtures(owner);
    brandA = await seedDefaultBrand(owner, fx.a.licenseId);
    await Promise.all([clearRateLimits(server.app), clearRateLimits(usServer.app)]);
    siemDir = await mkdtemp(join(tmpdir(), 'nexa-entitlements-'));
  });

  afterEach(async () => {
    await rm(siemDir, { recursive: true, force: true });
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  /** Put tenant A on a plan. `null` removes the row entirely — a trial. */
  async function planA(plan: string | null): Promise<void> {
    await owner.subscription.deleteMany({ where: { licenseId: fx.a.licenseId } });
    if (plan) await seedSubscription(owner, fx.a.licenseId, plan);
  }

  function ownerToken(scopes: string[]): Promise<string> {
    return grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes,
    });
  }

  interface UsTenant {
    licenseId: bigint;
    token: string;
  }

  /**
   * A US-hosted workspace whose owner holds the write scope, on a named plan.
   *
   * Region `us` and role `owner` are held constant on purpose: C4-d already
   * proves the region and role gates, so the *only* thing that may differ
   * between the two HIPAA cases is the plan. A refusal that could also be
   * explained by the region would prove nothing about this gate.
   *
   * Out here rather than inside the HIPAA block because the vocabulary sweep at
   * the bottom needs it too — `hipaa` is the one capability whose gate cannot be
   * reached from a European fixture at all.
   */
  async function seedUsTenant(suffix: string, plan: string): Promise<UsTenant> {
    const organization = await owner.organization.create({
      data: { name: `Org US ${suffix}`, region: 'us' },
      select: { id: true },
    });
    const license = await owner.license.create({
      data: { organizationId: organization.id, plan, status: 'active' },
      select: { id: true },
    });
    await seedSubscription(owner, license.id, plan);
    const account = await owner.account.create({
      data: { email: `owner-us-${suffix}@example.test`, name: 'Owner US' },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: license.id, agentId: account.id, role: 'owner' },
    });
    const token = await grantToken(owner, {
      licenseId: license.id,
      organizationId: organization.id,
      ownerId: account.id,
      scopes: ['access_rules:ro', 'access_rules:rw'],
    });
    return { licenseId: license.id, token };
  }

  /** The refusal's shape, asserted once and reused — it is a contract. */
  function expectDenied(
    res: { statusCode: number; json: () => unknown },
    entitlement: string,
    plan = 'growth',
  ): void {
    expect(res.statusCode).toBe(403);
    const body = res.json() as ErrorBody;
    expect(body.error.type).toBe('not_allowed');
    expect(body.error.details).toMatchObject({ entitlement, plan });
  }

  // =========================================================================
  // white_label — the write gate, and the read path that makes it mean anything
  // =========================================================================

  describe('white_label — widget branding', () => {
    it('refuses powered_by=false on growth, and stores nothing at all', async () => {
      await planA('growth');
      const token = await ownerToken(['access_rules:rw']);

      const res = await server.put(
        '/settings/widget',
        { primary_color: '#e11d48', powered_by: false },
        auth(token),
      );
      expectDenied(res, 'white_label');

      // The refusal happens inside the transaction that would have written, so
      // the colour that rode along in the same body is not saved either — a
      // half-applied save would leave an admin looking at a screen that took
      // some of what they typed and refused the rest without saying which.
      expect(
        await owner.widgetSettings.findFirst({ where: { licenseId: fx.a.licenseId } }),
      ).toBeNull();
    });

    it('lets a growth workspace change everything else, and switch branding back on', async () => {
      await planA('growth');
      const token = await ownerToken(['access_rules:rw']);

      const saved = await server.put(
        '/settings/widget',
        { primary_color: '#0a7f3f', position: 'bottom-left', powered_by: true },
        auth(token),
      );
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ primary_color: '#0a7f3f', powered_by: true });
    });

    it('accepts powered_by=false on enterprise and reads it back', async () => {
      await planA('enterprise');
      const token = await ownerToken(['access_rules:rw']);

      const saved = await server.put('/settings/widget', { powered_by: false }, auth(token));
      expect(saved.statusCode).toBe(200);
      expect((saved.json() as WidgetView).powered_by).toBe(false);

      const read = await server.get('/settings/widget', auth(token));
      expect((read.json() as WidgetView).powered_by).toBe(false);
    });

    /**
     * The reason this subtask is indivisible (PLAN §5.1.2), in one test.
     *
     * All three surfaces that serve the widget's appearance are read after the
     * downgrade, because each is a separate call site and any one of them left
     * unpatched is a workspace still shipping unbranded:
     *
     *   1. `GET /settings/widget` — what the admin's own screen shows.
     *   2. the install snippet — the worst of the three, because it is *copied
     *      out of the product* into a customer's HTML, where nothing this
     *      deployment does later can revisit it.
     *   3. `POST /customer/token` — what an actual visitor's widget renders
     *      from, and the only one of the three a paying customer sees.
     */
    it('reverses on downgrade at all three read paths, without deleting the row', async () => {
      await planA('enterprise');
      const token = await ownerToken(['access_rules:rw']);

      await server.put('/settings/widget', { powered_by: false }, auth(token));
      const site = (
        await server.post('/websites', { domain: 'brand.example' }, auth(token))
      ).json() as Website;
      expect(site.snippet).toContain('poweredBy: false');

      await planA('growth');

      // (1) The settings screen.
      const read = await server.get('/settings/widget', auth(token));
      expect(read.statusCode).toBe(200);
      expect((read.json() as WidgetView).powered_by).toBe(true);

      // (2) The install snippet — for a site added before the downgrade as well
      //     as a new one, since the appearance is baked in at read time.
      const listed = (await server.get('/websites', auth(token))).json() as { items: Website[] };
      for (const item of listed.items) expect(item.snippet).not.toContain('poweredBy');

      // (3) The visitor's widget.
      const minted = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId, host_origin: `https://${fx.a.trustedDomain}` },
        { origin: 'https://widget.nexa.example' },
      );
      expect(minted.statusCode).toBe(200);
      expect((minted.json() as { widget: WidgetView }).widget.powered_by).toBe(true);

      // And the stored intent survived all of it (§C-A26): the row still says
      // `false`. Nothing swept it, and nothing rewrote it behind the customer's
      // back — which is what makes the next assertion possible.
      const row = await owner.widgetSettings.findFirst({ where: { licenseId: fx.a.licenseId } });
      expect(row?.poweredBy).toBe(false);

      // Re-upgrading restores the setting without anyone re-typing it.
      await planA('enterprise');
      const restored = await server.get('/settings/widget', auth(token));
      expect((restored.json() as WidgetView).powered_by).toBe(false);
    });

    it('answers per workspace: A on enterprise stays unbranded while B on growth does not', async () => {
      await planA('enterprise');
      await seedSubscription(owner, fx.b.licenseId, 'growth');
      await seedDefaultBrand(owner, fx.b.licenseId);

      const tokenA = await ownerToken(['access_rules:rw']);
      const tokenB = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['access_rules:rw'],
      });

      expect(
        (await server.put('/settings/widget', { powered_by: false }, auth(tokenA))).statusCode,
      ).toBe(200);
      expectDenied(
        await server.put('/settings/widget', { powered_by: false }, auth(tokenB)),
        'white_label',
      );

      // The gate reads the caller's own licence, not whichever subscription row
      // came back first — B's refusal above and A's answer here are the same
      // assertion seen from both sides.
      expect((await server.get('/settings/widget', auth(tokenA))).json()).toMatchObject({
        brand_id: brandA,
        powered_by: false,
      });
      expect((await server.get('/settings/widget', auth(tokenB))).json()).toMatchObject({
        powered_by: true,
      });
    });
  });

  // =========================================================================
  // sso — NFR-S11's surface (the debt S11-i could not pay: no gate existed yet)
  // =========================================================================

  describe('sso — federation and directory provisioning', () => {
    const createBody = {
      name: 'Okta (corp)',
      idp_entity_id: 'https://idp.example.test/saml/metadata',
      idp_sso_url: 'https://idp.example.test/saml/sso',
      idp_certificate_pem: VALID_CERTIFICATE_PEM,
    };

    async function seedConnection(): Promise<string> {
      const row = await owner.ssoConnection.create({
        data: {
          licenseId: fx.a.licenseId,
          name: 'Okta (corp)',
          idpEntityId: 'https://idp.example.test/saml/metadata',
          idpSsoUrl: 'https://idp.example.test/saml/sso',
          idpCertificatePem: VALID_CERTIFICATE_PEM,
        },
        select: { id: true },
      });
      return row.id;
    }

    function scimToken(): Promise<string> {
      return grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        kind: 'scim',
        scopes: [],
      });
    }

    it('refuses to establish or change a federation on growth', async () => {
      await planA('growth');
      const token = await ownerToken(['access_rules:rw']);
      const connectionId = await seedConnection();

      expectDenied(await server.post('/settings/sso', createBody, auth(token)), 'sso');
      expectDenied(
        await server.patch(`/settings/sso/${connectionId}`, { name: 'Renamed' }, auth(token)),
        'sso',
      );
      // Refused, not partly applied.
      const after = await owner.ssoConnection.findMany({ where: { licenseId: fx.a.licenseId } });
      expect(after).toHaveLength(1);
      expect(after[0]?.name).toBe('Okta (corp)');
    });

    it('still lets a growth workspace see what it has, and take it away', async () => {
      await planA('growth');
      const token = await ownerToken(['access_rules:rw']);
      const connectionId = await seedConnection();

      // The listing is where the upsell belongs — a settings screen that 403s
      // is a worse product and no more secure.
      const listed = await server.get('/settings/sso', auth(token));
      expect(listed.statusCode).toBe(200);
      expect((listed.json() as { items: unknown[] }).items).toHaveLength(1);

      // And the delete stays open: a downgraded workspace must not be left
      // holding configuration it may neither change nor remove.
      expect((await server.del(`/settings/sso/${connectionId}`, auth(token))).statusCode).toBe(204);
      expect(await owner.ssoConnection.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });

    it('creates on enterprise', async () => {
      await planA('enterprise');
      const token = await ownerToken(['access_rules:rw']);

      const res = await server.post('/settings/sso', createBody, auth(token));
      expect(res.statusCode).toBe(201);
    });

    it('closes the whole SCIM surface on growth, reads included', async () => {
      await planA('growth');
      const token = await scimToken();

      // Reads are gated here, unlike the settings listing above: the caller is
      // the identity provider itself, and `GET /Users` is how a sync
      // reconciles — it is the provisioning capability, not a view of it.
      for (const path of ['/scim/v2/Users', '/scim/v2/Groups']) {
        const res = await server.get(path, auth(token));
        expect(res.statusCode, path).toBe(403);
      }
      const created = await server.post(
        '/scim/v2/Users',
        { userName: 'new.hire@example.test', active: true },
        auth(token),
      );
      expect(created.statusCode).toBe(403);

      await planA('enterprise');
      expect((await server.get('/scim/v2/Users', auth(token))).statusCode).toBe(200);
    });
  });

  // =========================================================================
  // hipaa — the debt C4-g transferred here (tm 82.7): no gate existed yet
  // =========================================================================

  describe('hipaa — the BAA', () => {
    const accept = (token: string) =>
      usServer.post('/settings/compliance/baa', { accepted: true }, auth(token));

    it('refuses a US owner on growth, and signs nothing', async () => {
      const tenant = await seedUsTenant('growth', 'growth');

      expectDenied(await accept(tenant.token), 'hipaa');
      const licence = await owner.license.findUniqueOrThrow({
        where: { id: tenant.licenseId },
        select: { hipaaBaaSignedAt: true },
      });
      expect(licence.hipaaBaaSignedAt).toBeNull();
    });

    it('accepts a US owner on enterprise and records the signature', async () => {
      const tenant = await seedUsTenant('ent', 'enterprise');

      const res = await accept(tenant.token);
      expect(res.statusCode).toBe(200);
      const licence = await owner.license.findUniqueOrThrow({
        where: { id: tenant.licenseId },
        select: { hipaaBaaSignedAt: true },
      });
      expect(licence.hipaaBaaSignedAt).not.toBeNull();
    });

    it('leaves the compliance screen readable on growth', async () => {
      const tenant = await seedUsTenant('read', 'growth');

      // The decision this test exists to record: reading is not gated, writing
      // is. An admin has to be able to see that their workspace is US-hosted
      // and holds no agreement — that is the question upgrading answers.
      const res = await usServer.get('/settings/compliance', auth(tenant.token));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ region: 'us', hipaa_baa_signed_at: null });
    });
  });

  // =========================================================================
  // siem_export — the debt C6-g transferred here (tm 83.8)
  // =========================================================================

  describe('siem_export — the audit trail leaving', () => {
    function sink(): SiemSink {
      return new SiemSink(owner, {
        siemDir,
        auditChainSecret: AUDIT_CHAIN_SECRET,
        horizonMs: 0,
      });
    }

    async function deliveredFiles(): Promise<string[]> {
      try {
        return await readdir(join(siemDir, fx.a.licenseId.toString()));
      } catch {
        return [];
      }
    }

    it('refuses the destination write and the export on growth', async () => {
      await planA('growth');
      const settings = await ownerToken(['access_rules:rw']);
      const exportToken = await ownerToken(['audit_log--export:ro']);

      expectDenied(
        await server.patch('/settings/siem', { enabled: true, target: 'file' }, auth(settings)),
        'siem_export',
      );
      expectDenied(await server.get('/audit-log/export', auth(exportToken)), 'siem_export');
      expect(await owner.siemExportCursor.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });

    it('leaves the audit log itself, and the SIEM screen, readable on growth', async () => {
      await planA('growth');
      const settings = await ownerToken(['access_rules:ro']);
      const readToken = await ownerToken(['audit_log--all:ro']);

      // NFR-S12 gives every plan the trail and sells shipping it out. Taking
      // the viewer away would remove something the lower tier was sold.
      expect((await server.get('/audit-log', auth(readToken))).statusCode).toBe(200);
      expect((await server.get('/settings/siem', auth(settings))).statusCode).toBe(200);
      expect((await server.get('/settings/siem/status', auth(settings))).statusCode).toBe(200);
    });

    it('allows both on enterprise', async () => {
      await planA('enterprise');
      const settings = await ownerToken(['access_rules:rw']);
      const exportToken = await ownerToken(['audit_log--export:ro']);

      expect(
        (await server.patch('/settings/siem', { enabled: true, target: 'file' }, auth(settings)))
          .statusCode,
      ).toBe(200);
      expect((await server.get('/audit-log/export', auth(exportToken))).statusCode).toBe(200);
      expect(await owner.siemExportCursor.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
    });

    /**
     * The scheduled loop, which no HTTP gate can reach.
     *
     * A licence that switched the feed on as Enterprise still has
     * `enabled = true` after it downgrades — the row survives on purpose — so a
     * sink that only asked "is it enabled?" would keep shipping the workspace's
     * entire security trail to an external system on a timer, for a capability
     * nobody is paying for. This is the quiet half of the leak.
     */
    it('stops the scheduled sink after a downgrade, without moving the cursor', async () => {
      await planA('enterprise');
      const settings = await ownerToken(['access_rules:rw']);
      await server.patch('/settings/siem', { enabled: true, target: 'file' }, auth(settings));

      // A first sweep while entitled, so there is a live feed to interrupt.
      const before = await sink().run();
      const deliveredA = before.tenants.find((t) => t.licenseId === fx.a.licenseId.toString());
      expect(deliveredA?.status).toBe('delivered');
      expect(deliveredA?.delivered).toBeGreaterThan(0);
      const cursor = await owner.siemExportCursor.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId },
      });
      const filesAfterFirst = (await deliveredFiles()).length;

      await planA('growth');

      const after = await sink().run();
      const skippedA = after.tenants.find((t) => t.licenseId === fx.a.licenseId.toString());
      expect(skippedA?.status).toBe('skipped');
      expect(skippedA?.delivered).toBe(0);
      expect(skippedA?.error).toMatch(/growth/);
      // Nothing new reached disk...
      expect(await deliveredFiles()).toHaveLength(filesAfterFirst);
      // ...and the position is exactly where the entitled run left it, so a
      // re-upgrade resumes rather than re-sending the trail or skipping a gap.
      const afterCursor = await owner.siemExportCursor.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId },
      });
      expect(afterCursor.lastExportedId).toBe(cursor.lastExportedId);
      expect(afterCursor.exportedCount).toBe(cursor.exportedCount);
    });
  });

  // =========================================================================
  // The gate's own rules
  // =========================================================================

  describe('the gate itself', () => {
    it('treats a workspace with no subscription row as the self-serve tier', async () => {
      await planA(null);
      const token = await ownerToken(['access_rules:rw']);

      // A trial (ADR-10) has bought nothing, so it unlocks nothing beyond
      // self-serve — and it says `growth`, the same answer
      // `GET /billing/entitlements` reports, so what a screen renders and what
      // the API enforces cannot disagree.
      expectDenied(
        await server.put('/settings/widget', { powered_by: false }, auth(token)),
        'white_label',
        'growth',
      );
    });

    it('denies a plan the catalogue does not recognise', async () => {
      await planA('platinum');
      const token = await ownerToken(['access_rules:rw']);

      // A `plan` the catalogue has never heard of falls to the closed side and
      // is named honestly in the refusal — the alternative, an unhandled case
      // reading as "allow", is the failure mode that costs money.
      expectDenied(
        await server.put('/settings/widget', { powered_by: false }, auth(token)),
        'white_label',
        'platinum',
      );
    });

    // The boot-time guard — `public` + `entitlement` must not register — lives
    // in `route-config.test.ts` beside the auth plugin's `public` + `scopes`
    // guard it mirrors, because it needs a server that has not started yet.
  });

  // =========================================================================
  // The vocabulary as a whole — no key without a gate (11.5-h)
  // =========================================================================
  //
  // Everything above tests a capability the author of that block remembered to
  // test. The failure this item exists to close is the one nobody remembers: a
  // key added to `ENTITLEMENTS` — the way `sso`, `hipaa` and `siem_export` were
  // added to it, after their features had already shipped ungated — that is
  // reported by `GET /billing/entitlements`, rendered by a screen, sold on a
  // pricing page, and enforced nowhere.
  //
  // So this sweeps the vocabulary itself. `Record<Entitlement, Probe>` is the
  // half that actually holds: a seventh key stops the type-check here until
  // somebody names the call it is supposed to gate, and naming one that does
  // not refuse fails the assertion. Neither can be satisfied by writing a
  // plausible-looking probe, because both ends are asserted — refused below the
  // tier, allowed on it.

  describe('every capability in the vocabulary is enforced somewhere', () => {
    /** A call the capability under test is required for, on a given tier. */
    interface Probe {
      call(plan: 'growth' | 'enterprise'): Promise<{ statusCode: number; json: () => unknown }>;
      /** What the entitled call answers — a set, because a create says 201. */
      allowed: readonly number[];
    }

    const ssoConnection = {
      name: 'Okta (vocabulary)',
      idp_entity_id: 'https://idp.example.test/saml/metadata',
      idp_sso_url: 'https://idp.example.test/saml/sso',
      idp_certificate_pem: VALID_CERTIFICATE_PEM,
    };

    const PROBES: Record<Entitlement, Probe> = {
      white_label: {
        allowed: [200],
        async call(plan) {
          await planA(plan);
          return server.put(
            '/settings/widget',
            { powered_by: false },
            auth(await ownerToken(['access_rules:rw'])),
          );
        },
      },
      sandbox: {
        allowed: [201],
        async call(plan) {
          await planA(plan);
          // `exactRole: 'owner'` on the route — the fixture's A owner is one.
          return server.post(
            '/settings/sandbox',
            undefined,
            auth(await ownerToken(['access_rules:rw'])),
          );
        },
      },
      sla: {
        allowed: [200],
        async call(plan) {
          await planA(plan);
          return server.put(
            '/settings/sla',
            { first_response_minutes: 15, resolution_minutes: null, business_hours_only: false },
            auth(await ownerToken(['access_rules:rw'])),
          );
        },
      },
      sso: {
        allowed: [201],
        async call(plan) {
          await planA(plan);
          return server.post(
            '/settings/sso',
            ssoConnection,
            auth(await ownerToken(['access_rules:rw'])),
          );
        },
      },
      hipaa: {
        allowed: [200],
        async call(plan) {
          // The one gate a European fixture cannot reach: signing a BAA is
          // refused outside a US-hosted workspace whatever the plan says, so a
          // probe against tenant A would be measuring C4's region gate instead.
          const tenant = await seedUsTenant(`vocab-${plan}`, plan);
          return usServer.post('/settings/compliance/baa', { accepted: true }, auth(tenant.token));
        },
      },
      siem_export: {
        allowed: [200],
        async call(plan) {
          await planA(plan);
          return server.patch(
            '/settings/siem',
            { enabled: true, target: 'file' },
            auth(await ownerToken(['access_rules:rw'])),
          );
        },
      },
    };

    for (const key of ENTITLEMENTS) {
      it(`refuses ${key} below the tier that sells it, and allows it on Enterprise`, async () => {
        const probe = PROBES[key];

        expectDenied(await probe.call('growth'), key);

        const entitled = await probe.call('enterprise');
        expect(
          probe.allowed,
          `${key} on enterprise answered ${entitled.statusCode}: ${JSON.stringify(entitled.json())}`,
        ).toContain(entitled.statusCode);
      });
    }
  });
});
