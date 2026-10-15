/**
 * The widget's language as a per-brand setting (WG-02, tm 280).
 *
 * Three surfaces, one rule each:
 *   - `/settings/widget` reads `auto` (+ the new-workspace fallback `tr`) until a
 *     brand saves, refuses a language the widget does not ship, and a row
 *     created by the first save carries the application default fallback;
 *   - the token mint hands the widget the language of the brand whose website
 *     it is on — read at every mint, so a save lands on the next token;
 *   - the message that opens a chat records the widget's language on the
 *     contact (it later picks the transcript e-mail's language); a message into
 *     an existing chat does not rewrite it, and an unknown language is a 400.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

interface MintedWidget {
  language: string;
  fallback_language: string;
}

describe('widget language setting (WG-02)', () => {
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

  const put = (body: Record<string, unknown>, brandId?: string) =>
    server.put('/settings/widget', body, {
      ...auth(adminToken),
      ...(brandId ? { 'x-siyahtus-brand': brandId } : {}),
    });

  async function mint(host = fx.a.trustedDomain) {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId, host_origin: `https://${host}` },
      { origin: `https://${host}` },
    );
    expect(response.statusCode).toBe(200);
    return response.json() as { token: string; customer_id: string; widget: MintedWidget };
  }

  // =========================================================================

  describe('/settings/widget', () => {
    it('reads automatic with the Turkish fallback until saved, writing nothing', async () => {
      const response = await server.get('/settings/widget', auth(readToken));
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ language: 'auto', fallback_language: 'tr' });
      expect(await owner.widgetSettings.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });

    it('saves the language and the fallback and reads them back', async () => {
      const saved = await put({ language: 'de', fallback_language: 'fr' });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ language: 'de', fallback_language: 'fr' });

      const after = await server.get('/settings/widget', auth(readToken));
      expect(after.json()).toMatchObject({ language: 'de', fallback_language: 'fr' });
    });

    it('a first save of something else creates the row with the new-workspace defaults', async () => {
      await put({ theme: 'dark' });
      const row = await owner.widgetSettings.findUnique({
        where: { licenseId_brandId: { licenseId: fx.a.licenseId, brandId: brandA } },
      });
      expect(row).toMatchObject({ language: 'auto', fallbackLanguage: 'tr' });
    });

    it('a row from before the setting keeps the column default, English', async () => {
      // What the migration leaves behind: a row written without the new columns.
      await owner.$executeRaw`
        INSERT INTO widget_settings (license_id, brand_id, updated_at)
        VALUES (${fx.a.licenseId}, ${brandA}::uuid, now())`;
      const row = await owner.widgetSettings.findUnique({
        where: { licenseId_brandId: { licenseId: fx.a.licenseId, brandId: brandA } },
      });
      expect(row).toMatchObject({ language: 'auto', fallbackLanguage: 'en' });
      const read = await server.get('/settings/widget', auth(readToken));
      expect(read.json()).toMatchObject({ language: 'auto', fallback_language: 'en' });
    });

    it.each([
      { language: 'ru' },
      { language: 'az' },
      { language: 'AUTO' },
      { fallback_language: 'auto' },
      { fallback_language: 'ru' },
    ])('refuses %j and stores nothing', async (body) => {
      const response = await put(body);
      expect(response.statusCode).toBe(400);
      expect(await owner.widgetSettings.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });

    it('the database holds the same line as the endpoint', async () => {
      await put({ theme: 'dark' });
      await expect(
        owner.$executeRaw`UPDATE widget_settings SET language = 'ru' WHERE license_id = ${fx.a.licenseId}`,
      ).rejects.toThrow();
      await expect(
        owner.$executeRaw`UPDATE widget_settings SET fallback_language = 'auto' WHERE license_id = ${fx.a.licenseId}`,
      ).rejects.toThrow();
    });

    it('keeps one brand’s language out of another’s', async () => {
      await put({ language: 'de' }, brandB);
      const a = await server.get('/settings/widget', auth(readToken));
      expect(a.json()).toMatchObject({ language: 'auto' });
      const b = await server.get('/settings/widget', {
        ...auth(readToken),
        'x-siyahtus-brand': brandB,
      });
      expect(b.json()).toMatchObject({ language: 'de' });
    });
  });

  // =========================================================================

  describe('the token mint', () => {
    it('hands over automatic + the Turkish fallback to a workspace that never saved', async () => {
      const { widget } = await mint();
      expect(widget).toMatchObject({ language: 'auto', fallback_language: 'tr' });
    });

    it('delivers a saved language on the next token, no re-install', async () => {
      await put({ language: 'en', fallback_language: 'de' });
      const { widget } = await mint();
      expect(widget).toMatchObject({ language: 'en', fallback_language: 'de' });
    });

    it('serves each brand its own language by the website the widget is on', async () => {
      await put({ language: 'tr' }, brandA);
      await put({ language: 'ar' }, brandB);

      expect((await mint(fx.a.trustedDomain)).widget.language).toBe('tr');
      expect((await mint(brandBHost)).widget.language).toBe('ar');
    });

    it('does not bake the language into the install snippet', async () => {
      await put({ language: 'de' });
      const response = await server.get('/settings/widget', auth(readToken));
      expect(response.statusCode).toBe(200);
      const websites = await server.get('/websites', auth(readToken));
      const text = JSON.stringify(websites.json());
      expect(text).not.toContain('language');
    });
  });

  // =========================================================================

  describe('the message that opens a conversation', () => {
    const open = (token: string, body: Record<string, unknown>) =>
      server.post('/customer/chat/events', body, auth(token));
    const localeOf = async (customerId: string) =>
      (await owner.customer.findUnique({ where: { id: customerId }, select: { locale: true } }))
        ?.locale;

    it('records the widget language on the contact', async () => {
      const { token, customer_id } = await mint();
      expect(await localeOf(customer_id)).toBeNull();

      const response = await open(token, { text: 'merhaba', locale: 'tr' });
      expect(response.statusCode).toBe(201);
      expect(await localeOf(customer_id)).toBe('tr');
    });

    it('leaves it unknown when an older widget sends none', async () => {
      const { token, customer_id } = await mint();
      expect((await open(token, { text: 'hello' })).statusCode).toBe(201);
      expect(await localeOf(customer_id)).toBeNull();
    });

    it('does not rewrite it from a later message in the same chat', async () => {
      const { token, customer_id } = await mint();
      await open(token, { text: 'merhaba', locale: 'tr' });
      expect((await open(token, { text: 'hello again', locale: 'en' })).statusCode).toBe(201);
      expect(await localeOf(customer_id)).toBe('tr');
    });

    it.each(['ru', 'tr-TR', 'auto', ''])('refuses the language %j with 400', async (locale) => {
      const { token, customer_id } = await mint();
      const response = await open(token, { text: 'hello', locale });
      expect(response.statusCode).toBe(400);
      expect(await localeOf(customer_id)).toBeNull();
      expect(await owner.chat.count({ where: { customerId: customer_id } })).toBe(0);
    });
  });
});
