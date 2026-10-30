/**
 * The widget's "Help" tab (tm 348 · SiyahTuş analysis WG-12), through the real
 * server and, for the guard, straight against the database function:
 *
 *   - `GET /customer/kb/search` finds a published article by the words of its
 *     title and body — "papara" finds "Papara ile yatırım" — and never a
 *     draft (KK 1);
 *   - another workspace's article is in no result and no article view, for any
 *     query (KK 2) — and `kb_search_published` refuses a licence that is not the
 *     transaction's tenant, the one place RLS does not guard;
 *   - a draft, an unknown slug, another workspace's slug and a switched-off tab
 *     answer the same 404 from `GET /customer/kb/articles/{slug}`;
 *   - `help_enabled` is saved on `/settings/widget`, off until then, and rides
 *     the token mint.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

function sqlStateOf(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const code = (error.meta as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

async function failureOf(query: PromiseLike<unknown>): Promise<unknown> {
  try {
    await query;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to be refused, and it ran');
}

describe('widget Help tab: published KB search with the customer token (WG-12)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let brandA: string;
  let brandB: string;
  let adminToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function customerToken(t: TenantFixture): Promise<string> {
    const response = await server.post(
      '/customer/token',
      { organization_id: t.organizationId },
      { origin: `https://${t.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return response.json().token;
  }

  async function search(token: string, q: string, extra = ''): Promise<string[]> {
    const response = await server.get(
      `/customer/kb/search?q=${encodeURIComponent(q)}${extra}`,
      auth(token),
    );
    expect(response.statusCode).toBe(200);
    return response.json().items.map((item: { title: string }) => item.title);
  }

  const article = (
    licenseId: bigint,
    input: {
      slug: string;
      title: string;
      body: string;
      excerpt?: string;
      draft?: boolean;
      /** Taken back to draft: the status says so, the old `published_at` stays. */
      unpublished?: boolean;
    },
  ) =>
    owner.kbArticle.create({
      data: {
        licenseId,
        slug: input.slug,
        title: input.title,
        body: input.body,
        excerpt: input.excerpt ?? null,
        status: input.draft || input.unpublished ? 'draft' : 'published',
        publishedAt: input.draft ? null : new Date(),
        createdBy: 'acct_secret_author',
      },
    });

  const enableHelp = (licenseId: bigint, brandId: string, helpEnabled = true) =>
    owner.widgetSettings.upsert({
      where: { licenseId_brandId: { licenseId, brandId } },
      create: { licenseId, brandId, helpEnabled },
      update: { helpEnabled },
    });

  beforeAll(async () => {
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await app.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    brandA = await seedDefaultBrand(owner, fx.a.licenseId);
    brandB = await seedDefaultBrand(owner, fx.b.licenseId);
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw'],
    });
  });

  describe('the setting', () => {
    it('is off until saved, saves on the brand and rides the token mint (FR-MOD-11.7)', async () => {
      const before = await server.get('/settings/widget', auth(adminToken));
      expect(before.json()).toMatchObject({ help_enabled: false });
      const mintedBefore = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        { origin: `https://${fx.a.trustedDomain}` },
      );
      expect(mintedBefore.json().widget.help_enabled).toBe(false);

      const saved = await server.put('/settings/widget', { help_enabled: true }, auth(adminToken));
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ brand_id: brandA, help_enabled: true });
      const row = await owner.widgetSettings.findUniqueOrThrow({
        where: { licenseId_brandId: { licenseId: fx.a.licenseId, brandId: brandA } },
        select: { helpEnabled: true },
      });
      expect(row.helpEnabled).toBe(true);

      const minted = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        { origin: `https://${fx.a.trustedDomain}` },
      );
      expect(minted.json().widget.help_enabled).toBe(true);
      expect(
        (await server.put('/settings/widget', { help_enabled: 'yes' }, auth(adminToken)))
          .statusCode,
      ).toBe(400);
    });
  });

  describe('search and read', () => {
    let tokenA: string;

    beforeEach(async () => {
      await enableHelp(fx.a.licenseId, brandA);
      await enableHelp(fx.b.licenseId, brandB);
      await article(fx.a.licenseId, {
        slug: 'papara-ile-yatirim',
        title: 'Papara ile yatırım',
        body: '## Adımlar\n\n- Kasiyer sayfasında **Papara**yı seçin.\n- Tutarı girin.',
      });
      await article(fx.a.licenseId, {
        slug: 'papara-taslak',
        title: 'Papara taslak çekim kuralları',
        body: 'Henüz yayımlanmadı: papara iç notu.',
        draft: true,
      });
      await article(fx.a.licenseId, {
        slug: 'papara-eski',
        title: 'Papara eski limitler',
        body: 'Yayından kaldırıldı.',
        unpublished: true,
      });
      await article(fx.a.licenseId, {
        slug: 'bonus-kurallari',
        title: 'Bonus kuralları',
        body: 'Yatırım bonusu Papara yatırımlarında da geçerlidir.',
        excerpt: 'Bonusların çevrim şartları.',
      });
      await article(fx.b.licenseId, {
        slug: 'globex-papara',
        title: 'Globex Papara yatırım rehberi',
        body: 'Globex oyuncuları için papara yatırım adımları.',
      });
      tokenA = await customerToken(fx.a);
    });

    it('"papara" finds the published "Papara ile yatırım", title match first, never the draft (FR-MOD-11.7)', async () => {
      const response = await server.get('/customer/kb/search?q=papara', auth(tokenA));
      expect(response.statusCode).toBe(200);
      const items = response.json().items;
      expect(items.map((item: { title: string }) => item.title)).toEqual([
        'Papara ile yatırım',
        'Bonus kuralları',
      ]);
      // Excerpt: the article's own, else the body as plain text — no markers.
      expect(items[0]).toEqual({
        slug: 'papara-ile-yatirim',
        title: 'Papara ile yatırım',
        excerpt: 'Adımlar Kasiyer sayfasında Paparayı seçin. Tutarı girin.',
      });
      expect(items[1].excerpt).toBe('Bonusların çevrim şartları.');
      expect(JSON.stringify(response.json())).not.toMatch(/taslak|iç notu|eski|license|acct_/);
    });

    it('matches Turkish letters and their plain spelling, any case, by word prefix, every word required', async () => {
      expect(await search(tokenA, 'YATIRIM')).toEqual(['Papara ile yatırım', 'Bonus kuralları']);
      expect(await search(tokenA, 'yatirim')).toEqual(['Papara ile yatırım', 'Bonus kuralları']);
      expect(await search(tokenA, 'papara yat')).toEqual(['Papara ile yatırım', 'Bonus kuralları']);
      expect(await search(tokenA, 'kasiyer')).toEqual(['Papara ile yatırım']);
      expect(await search(tokenA, 'papara kripto')).toEqual([]);
      // The drafts' own words find nothing at all.
      expect(await search(tokenA, 'taslak')).toEqual([]);
      expect(await search(tokenA, 'limitler')).toEqual([]);
      expect(await search(tokenA, 'cekim')).toEqual([]);
      // Punctuation only: no word, an empty result rather than an error.
      expect(await search(tokenA, '%% **')).toEqual([]);
      expect(await search(tokenA, 'papara', '&limit=1')).toEqual(['Papara ile yatırım']);
    });

    it("never returns another workspace's article, for any query (NFR-S4)", async () => {
      for (const q of ['papara', 'globex', 'rehberi', 'oyunculari', 'papara yatirim']) {
        expect(await search(tokenA, q)).not.toContain('Globex Papara yatırım rehberi');
      }
      expect(await search(tokenA, 'globex')).toEqual([]);
      // B's own visitor finds it — the article is published, only not A's.
      expect(await search(await customerToken(fx.b), 'globex')).toEqual([
        'Globex Papara yatırım rehberi',
      ]);
    });

    it('opens a published article; a draft, a foreign slug, an unknown slug answer one 404', async () => {
      const ok = await server.get('/customer/kb/articles/papara-ile-yatirim', auth(tokenA));
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({
        slug: 'papara-ile-yatirim',
        title: 'Papara ile yatırım',
        body: '## Adımlar\n\n- Kasiyer sayfasında **Papara**yı seçin.\n- Tutarı girin.',
        updated_at: expect.any(String),
      });

      const misses = await Promise.all(
        ['papara-taslak', 'papara-eski', 'globex-papara', 'no-such-article'].map((slug) =>
          server.get(`/customer/kb/articles/${slug}`, auth(tokenA)),
        ),
      );
      expect(misses.map((miss) => miss.statusCode)).toEqual([404, 404, 404, 404]);
      // The same envelope for each, the request id aside.
      const envelopes = misses.map((miss) => {
        const { error } = miss.json() as { error: Record<string, unknown> };
        const { request_id: _requestId, ...rest } = error;
        return JSON.stringify(rest);
      });
      expect(new Set(envelopes).size).toBe(1);
    });

    it('a switched-off tab finds nothing and opens nothing', async () => {
      await enableHelp(fx.a.licenseId, brandA, false);
      expect(await search(tokenA, 'papara')).toEqual([]);
      const response = await server.get('/customer/kb/articles/papara-ile-yatirim', auth(tokenA));
      expect(response.statusCode).toBe(404);
    });

    it('refuses a query that is too short or too long, a limit over 20, and an agent token', async () => {
      const get = (query: string, token = tokenA) =>
        server.get(`/customer/kb/search?${query}`, auth(token));
      expect((await get('q=a')).statusCode).toBe(400);
      expect((await get(`q=${'a'.repeat(201)}`)).statusCode).toBe(400);
      expect((await get('q=papara&limit=21')).statusCode).toBe(400);
      expect((await get('q=papara&locale=xx')).statusCode).toBe(400);
      expect((await get('q=papara&locale=tr')).statusCode).toBe(200);
      expect((await get('q=papara', adminToken)).statusCode).not.toBe(200);
    });
  });

  describe('kb_search_published, the read RLS does not guard', () => {
    const ctx = (t: TenantFixture) => ({
      licenseId: t.licenseId,
      organizationId: t.organizationId,
    });
    const call = (license: bigint | null) =>
      Prisma.sql`SELECT * FROM kb_search_published(${license}::bigint, ${'papara'}::text, ${10}::integer)`;

    it("refuses a licence that is not the transaction's tenant, a missing one, and no tenant (NFR-S4)", async () => {
      await article(fx.b.licenseId, { slug: 'b', title: 'Papara B', body: 'x' });
      for (const license of [fx.b.licenseId, null]) {
        const failure = await failureOf(
          withTenant(app, ctx(fx.a), (tx) => tx.$queryRaw(call(license))),
        );
        expect(sqlStateOf(failure)).toBe('42501');
      }
      const failure = await failureOf(app.$transaction((tx) => tx.$queryRaw(call(fx.b.licenseId))));
      expect(sqlStateOf(failure)).toBe('42501');

      const own = await withTenant(app, ctx(fx.b), (tx) =>
        tx.$queryRaw<Array<{ slug: string }>>(call(fx.b.licenseId)),
      );
      expect(own.map((row) => row.slug)).toEqual(['b']);
    });

    it('is not callable by PUBLIC, only by the runtime role', async () => {
      const [grant] = await owner.$queryRaw<Array<{ app: boolean; anyone: boolean }>>`
        SELECT has_function_privilege('siyahtus_app', 'kb_search_published(bigint,text,integer)', 'EXECUTE') AS app,
               has_function_privilege('public', 'kb_search_published(bigint,text,integer)', 'EXECUTE') AS anyone`;
      expect(grant).toEqual({ app: true, anyone: false });
    });
  });
});
