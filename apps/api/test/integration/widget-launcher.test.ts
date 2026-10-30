/**
 * Launcher visibility and the widget logo (tm 347 · SiyahTuş analysis WG-10),
 * through the real server:
 *
 *   - the setting: `launcher_visibility` / `show_logo` on `/settings/widget`,
 *     `always` and off until saved, only the three modes accepted, the CHECK
 *     holds the same line;
 *   - `GET /customer/launcher`, the question a widget asks before any mint: the
 *     brand of the embedding website answers, a foreign origin is refused, and
 *     asking creates no customer;
 *   - the mint carries the mode and, only when the brand asked for it and its
 *     logo is an `https` address, the logo and the brand's name.
 */
import { type PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('widget launcher visibility and logo (WG-10)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let brandId: string;
  let adminToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const origin = () => ({ origin: `https://${fx.a.trustedDomain}` });

  async function launcher(query = ''): Promise<{ statusCode: number; json: () => any }> {
    return server.get(
      `/customer/launcher?organization_id=${fx.a.organizationId}${query}`,
      origin(),
    ) as never;
  }

  async function widgetOfMint(): Promise<Record<string, unknown>> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      origin(),
    );
    expect(response.statusCode).toBe(200);
    return response.json().widget;
  }

  async function save(body: Record<string, unknown>) {
    return server.put('/settings/widget', body, auth(adminToken));
  }

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
    brandId = await seedDefaultBrand(owner, fx.a.licenseId);
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw'],
    });
  });

  describe('the setting', () => {
    it('reads always / logo off until saved, saves both on the brand, refuses an unknown mode (FR-MOD-11.7)', async () => {
      const before = await server.get('/settings/widget', auth(adminToken));
      expect(before.json()).toMatchObject({ launcher_visibility: 'always', show_logo: false });

      const saved = await save({ launcher_visibility: 'until_opened', show_logo: true });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({
        brand_id: brandId,
        launcher_visibility: 'until_opened',
        show_logo: true,
      });
      const row = await owner.widgetSettings.findUniqueOrThrow({
        where: { licenseId_brandId: { licenseId: fx.a.licenseId, brandId } },
        select: { launcherVisibility: true, showLogo: true },
      });
      expect(row).toEqual({ launcherVisibility: 'until_opened', showLogo: true });

      expect((await save({ launcher_visibility: 'sometimes' })).statusCode).toBe(400);
      expect((await save({ show_logo: 'yes' })).statusCode).toBe(400);
      await expect(
        owner.$executeRaw`UPDATE widget_settings SET launcher_visibility = 'sometimes' WHERE brand_id = ${brandId}::uuid`,
      ).rejects.toThrow(/widget_settings_launcher_visibility_check/);
    });

    it('writes an audit entry naming the fields and not the values', async () => {
      await save({ launcher_visibility: 'never' });
      const entry = await owner.auditLogEntry.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, action: 'settings.widget_updated' },
        select: { metadata: true },
      });
      expect(entry.metadata).toMatchObject({ fields: ['launcher_visibility'] });
      expect(JSON.stringify(entry.metadata)).not.toContain('never');
    });
  });

  describe('GET /customer/launcher', () => {
    it('answers always when the brand never saved the setting', async () => {
      const response = await launcher();
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ launcher_visibility: 'always' });
    });

    it('answers what the brand saved, without minting a customer', async () => {
      await save({ launcher_visibility: 'never' });
      const before = await owner.customer.count({ where: { organizationId: fx.a.organizationId } });

      const response = await launcher();
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ launcher_visibility: 'never' });
      expect(await owner.customer.count({ where: { organizationId: fx.a.organizationId } })).toBe(
        before,
      );
    });

    it("answers the embedding website's brand, not the licence default", async () => {
      await save({ launcher_visibility: 'always' });
      const second = await owner.brand.create({
        data: { licenseId: fx.a.licenseId, name: 'Second', slug: 'second' },
        select: { id: true },
      });
      await owner.website.create({
        data: { licenseId: fx.a.licenseId, brandId: second.id, domain: fx.a.trustedDomain },
      });
      await owner.widgetSettings.create({
        data: { licenseId: fx.a.licenseId, brandId: second.id, launcherVisibility: 'until_opened' },
      });

      expect((await launcher()).json()).toEqual({ launcher_visibility: 'until_opened' });
    });

    it('takes the page origin from host_origin, as the mint does', async () => {
      await save({ launcher_visibility: 'never' });
      const response = await server.get(
        `/customer/launcher?organization_id=${fx.a.organizationId}&host_origin=${encodeURIComponent(`https://${fx.a.trustedDomain}`)}`,
        { origin: 'https://widget.siyahtus.example' },
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ launcher_visibility: 'never' });
    });

    it('refuses an origin that is not a trusted domain of the organization', async () => {
      const response = await server.get(
        `/customer/launcher?organization_id=${fx.a.organizationId}`,
        { origin: 'https://evil.example.test' },
      );
      expect(response.statusCode).toBe(403);
    });

    it("never answers with another workspace's setting", async () => {
      await save({ launcher_visibility: 'never' });
      const response = await server.get(
        `/customer/launcher?organization_id=${fx.b.organizationId}`,
        origin(),
      );
      expect(response.statusCode).toBe(403);
    });

    it('rejects a request without an organization', async () => {
      const response = await server.get('/customer/launcher', origin());
      expect(response.statusCode).toBe(400);
    });
  });

  describe('the mint', () => {
    it('carries the mode and no logo by default', async () => {
      const widget = await widgetOfMint();
      expect(widget).toMatchObject({
        launcher_visibility: 'always',
        show_logo: false,
        logo_url: null,
        brand_name: null,
      });
    });

    it('carries the saved mode', async () => {
      await save({ launcher_visibility: 'until_opened' });
      expect((await widgetOfMint())['launcher_visibility']).toBe('until_opened');
    });

    it("carries the brand's https logo and name once the brand asks for it", async () => {
      await owner.brand.update({
        where: { id: brandId },
        data: { name: 'Acme Casino', logoUrl: 'https://cdn.example.com/acme.png' },
      });
      // Logo on file, switch off: nothing leaves.
      expect(await widgetOfMint()).toMatchObject({ logo_url: null, brand_name: null });

      await save({ show_logo: true });
      expect(await widgetOfMint()).toMatchObject({
        show_logo: true,
        logo_url: 'https://cdn.example.com/acme.png',
        brand_name: 'Acme Casino',
      });
    });

    it.each([
      ['http://cdn.example.com/acme.png'],
      ['javascript:alert(1)'],
      ['data:image/png;base64,AAAA'],
      ['/uploads/acme.png'],
      ['https://user:pw@cdn.example.com/acme.png'],
    ])('does not hand out the logo address %s', async (logoUrl) => {
      await owner.brand.update({ where: { id: brandId }, data: { logoUrl } });
      await save({ show_logo: true });
      expect(await widgetOfMint()).toMatchObject({
        show_logo: true,
        logo_url: null,
        brand_name: null,
      });
    });

    it('does not put the mode into the install snippet', async () => {
      await save({ launcher_visibility: 'never', show_logo: true });
      const websites = await server.get('/websites', auth(adminToken));
      expect(JSON.stringify(websites.json())).not.toMatch(/launcher|never/);
    });
  });
});
