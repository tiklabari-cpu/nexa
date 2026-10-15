/**
 * The widget's built-in pre-chat form as a per-brand setting (WG-01, tm 279).
 *
 * Three surfaces, one rule each:
 *   - `/settings/prechat` reads today's form until a brand saves its own, and
 *     refuses a field that is required while hidden (the DB check agrees);
 *   - the token mint hands the widget the form of the brand whose website it
 *     is on — read at every mint, so a save lands on the next token;
 *   - the message that opens a conversation is refused (400, no trace) when a
 *     *saved* form requires a detail the request and the contact both lack.
 *     An unsaved form is never enforced: direct API callers keep working.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRECHAT_CONFIG, type PrechatConfig } from '@siyahtus/types';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Today's form with one field's rule replaced. */
function withField(
  key: keyof PrechatConfig['fields'],
  rule: { visible: boolean; required: boolean },
  enabled = true,
): PrechatConfig {
  return { enabled, fields: { ...DEFAULT_PRECHAT_CONFIG.fields, [key]: rule } };
}

describe('widget pre-chat form setting (WG-01)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let brandA: string;
  let brandB: string;
  let adminToken: string;
  let readToken: string;
  /** A website of the second brand, on a subdomain the trusted domain covers. */
  let brandBHost: string;

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
    brandA = await seedDefaultBrand(owner, fx.a.licenseId);
    await seedDefaultBrand(owner, fx.b.licenseId);
    brandB = (
      await owner.brand.create({
        data: { licenseId: fx.a.licenseId, name: 'Second', slug: 'second' },
        select: { id: true },
      })
    ).id;
    brandBHost = `b.${fx.a.trustedDomain}`;
    await owner.website.create({
      data: { licenseId: fx.a.licenseId, brandId: brandB, domain: brandBHost },
    });
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

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw'],
    });
    readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:ro'],
    });
  });

  async function save(config: PrechatConfig, brandId?: string) {
    const response = await server.put('/settings/prechat', config, {
      ...auth(adminToken),
      ...(brandId ? { 'x-siyahtus-brand': brandId } : {}),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as PrechatConfig & { configured: boolean; brand_id: string };
  }

  async function mint(host = fx.a.trustedDomain, customerId?: string) {
    const response = await server.post(
      '/customer/token',
      {
        organization_id: fx.a.organizationId,
        host_origin: `https://${host}`,
        ...(customerId ? { customer_id: customerId } : {}),
      },
      { origin: `https://${host}` },
    );
    expect(response.statusCode).toBe(200);
    return response.json() as { token: string; customer_id: string; prechat: PrechatConfig };
  }

  // =========================================================================

  describe('/settings/prechat', () => {
    it('reads today’s form — open, all four required — until saved, writing nothing', async () => {
      const response = await server.get('/settings/prechat', auth(readToken));
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        brand_id: brandA,
        configured: false,
        ...DEFAULT_PRECHAT_CONFIG,
      });
      expect(await owner.widgetSettings.count()).toBe(0);
    });

    it('saves the whole form, reads it back, and keeps the appearance defaults', async () => {
      const config = withField('username', { visible: true, required: false }, false);
      const saved = await save(config);
      expect(saved).toEqual({ brand_id: brandA, configured: true, ...config });

      const read = await server.get('/settings/prechat', auth(readToken));
      expect(read.json()).toEqual({ brand_id: brandA, configured: true, ...config });

      const row = await owner.widgetSettings.findFirstOrThrow({ where: { brandId: brandA } });
      expect(row.primaryColor).toBe('#2d67fa');
      expect(row.prechatEnabled).toBe(false);

      const audit = await owner.auditLogEntry.findFirst({
        where: { licenseId: fx.a.licenseId, action: 'settings.prechat_updated' },
      });
      expect(audit?.metadata).toMatchObject({ enabled: false, fields: config.fields });
    });

    it('leaves the appearance untouched, and an appearance save leaves the form', async () => {
      await server.put('/settings/widget', { primary_color: '#e11d48' }, auth(adminToken));
      await save(withField('email', { visible: false, required: false }));
      await server.put('/settings/widget', { theme: 'dark' }, auth(adminToken));

      const row = await owner.widgetSettings.findFirstOrThrow({ where: { brandId: brandA } });
      expect(row.primaryColor).toBe('#e11d48');
      expect((row.prechatFields as unknown as PrechatConfig['fields']).email).toEqual({
        visible: false,
        required: false,
      });
    });

    it('refuses a field that is required while hidden, and a partial or unknown body', async () => {
      for (const body of [
        withField('name', { visible: false, required: true }),
        { enabled: true },
        { ...DEFAULT_PRECHAT_CONFIG, fields: { ...DEFAULT_PRECHAT_CONFIG.fields, phone: {} } },
        { ...DEFAULT_PRECHAT_CONFIG, extra: true },
      ]) {
        const response = await server.put('/settings/prechat', body, auth(adminToken));
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }
      expect(await owner.widgetSettings.count()).toBe(0);
    });

    it('is the database’s rule too, not only the endpoint’s', async () => {
      const create = (fields: unknown) =>
        owner.widgetSettings.create({
          data: { licenseId: fx.a.licenseId, brandId: brandA, prechatFields: fields as object },
        });
      await expect(
        create({ ...DEFAULT_PRECHAT_CONFIG.fields, name: { visible: false, required: true } }),
      ).rejects.toThrow(/widget_settings_prechat_fields_shape/);
      await expect(create({ name: { visible: true, required: true } })).rejects.toThrow(
        /widget_settings_prechat_fields_shape/,
      );
      await expect(create(DEFAULT_PRECHAT_CONFIG.fields)).resolves.toBeTruthy();
    });

    it('is per brand: a save under one brand leaves the other on the defaults', async () => {
      await save(withField('username', { visible: false, required: false }), brandB);

      const a = await server.get('/settings/prechat', auth(readToken));
      expect(a.json()).toMatchObject({ brand_id: brandA, configured: false });
      const b = await server.get('/settings/prechat', {
        ...auth(readToken),
        'x-siyahtus-brand': brandB,
      });
      expect(b.json()).toMatchObject({
        brand_id: brandB,
        configured: true,
        fields: { username: { visible: false, required: false } },
      });
    });

    it('needs access_rules:rw and an admin to write', async () => {
      const read = await server.put('/settings/prechat', DEFAULT_PRECHAT_CONFIG, auth(readToken));
      expect(read.statusCode).toBe(403);

      const agentToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['access_rules:rw'],
      });
      const agent = await server.put('/settings/prechat', DEFAULT_PRECHAT_CONFIG, auth(agentToken));
      expect(agent.statusCode).toBe(403);
    });
  });

  // =========================================================================

  describe('the token mint', () => {
    it('hands an unconfigured workspace today’s form', async () => {
      const { prechat } = await mint();
      expect(prechat).toEqual(DEFAULT_PRECHAT_CONFIG);
    });

    it('takes a saved change on the very next token, no reinstall', async () => {
      const before = await mint();
      expect(before.prechat.enabled).toBe(true);

      await save({ ...DEFAULT_PRECHAT_CONFIG, enabled: false });
      const after = await mint(fx.a.trustedDomain, before.customer_id);
      expect(after.prechat.enabled).toBe(false);
    });

    it('gives the widget on brand B’s website brand B’s form', async () => {
      await save(withField('username', { visible: true, required: true }), brandA);
      await save(withField('username', { visible: false, required: false }), brandB);

      expect((await mint(brandBHost)).prechat.fields.username).toEqual({
        visible: false,
        required: false,
      });
      // A host with no website row is the licence default brand's.
      expect((await mint(fx.a.trustedDomain)).prechat.fields.username).toEqual({
        visible: true,
        required: true,
      });
    });
  });

  // =========================================================================

  describe('opening a conversation', () => {
    const open = (token: string, body: Record<string, unknown>) =>
      server.post('/customer/chat/events', body, auth(token));

    it('is not checked for a workspace that never saved the form', async () => {
      const { token } = await mint();
      const response = await open(token, { text: 'hello' });
      expect(response.statusCode).toBe(201);
    });

    it('refuses a missing required username with 400 and leaves no trace', async () => {
      await save(DEFAULT_PRECHAT_CONFIG);
      const { token, customer_id } = await mint();

      const response = await open(token, {
        text: 'hello',
        name: 'Jo',
        email: 'jo@example.com',
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { type: 'validation', details: { fields: [{ field: 'username' }] } },
      });

      expect(await owner.chat.count()).toBe(0);
      // Not even the details that were sent.
      const customer = await owner.customer.findUniqueOrThrow({ where: { id: customer_id } });
      expect(customer.name).toBeNull();
      expect(customer.email).toBeNull();
    });

    it('opens with the username, and an optional one may be left out', async () => {
      await save(DEFAULT_PRECHAT_CONFIG);
      const first = await mint();
      const ok = await open(first.token, {
        text: 'hello',
        name: 'Jo',
        username: 'jo_92',
        email: 'jo@example.com',
      });
      expect(ok.statusCode).toBe(201);

      await save(withField('username', { visible: true, required: false }));
      const second = await mint();
      const optional = await open(second.token, {
        text: 'hi',
        name: 'Al',
        email: 'al@example.com',
      });
      expect(optional.statusCode).toBe(201);
    });

    it('counts details already on the contact, and never checks a running conversation', async () => {
      await save(DEFAULT_PRECHAT_CONFIG);
      const { token, customer_id } = await mint();
      await owner.customer.update({
        where: { id: customer_id },
        data: { name: 'Jo', username: 'jo_92', email: 'jo@example.com' },
      });

      const opened = await open(token, { text: 'first' });
      expect(opened.statusCode).toBe(201);
      // Wipe the contact: the next message joins the open chat, unchecked.
      await owner.customer.update({
        where: { id: customer_id },
        data: { name: null, username: null, email: null },
      });
      const next = await open(token, { text: 'second' });
      expect(next.statusCode).toBe(201);
      expect(next.json().chat_id).toBe(opened.json().chat_id);
    });

    it('is not checked while the form is switched off', async () => {
      await save({ ...DEFAULT_PRECHAT_CONFIG, enabled: false });
      const { token } = await mint();
      expect((await open(token, { text: 'no form' })).statusCode).toBe(201);
    });

    it('checks the brand the token was minted for', async () => {
      await save(DEFAULT_PRECHAT_CONFIG, brandA);
      await save(withField('username', { visible: false, required: false }), brandB);

      // On brand B's site a username is not asked, so its absence is fine…
      const onB = await mint(brandBHost);
      const b = await open(onB.token, { text: 'hi', name: 'Jo', email: 'jo@example.com' });
      expect(b.statusCode).toBe(201);
      // …while the same message on brand A's site is refused.
      const onA = await mint(fx.a.trustedDomain);
      const a = await open(onA.token, { text: 'hi', name: 'Jo', email: 'jo@example.com' });
      expect(a.statusCode).toBe(400);
    });
  });
});
