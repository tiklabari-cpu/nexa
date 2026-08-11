/**
 * Public knowledge base — the anonymous reader, end to end (PUBKB-i · PRD
 * §5.3-Knowledge · NFR-S5 · NFR-S6 · NFR-P2 · NFR-A11Y1).
 *
 * This is the one surface in the app that answers a *signed-out* stranger with
 * `text/html`, and it is stitched together from five layers no single suite
 * proves together: the admin CRUD (PUBKB-b), the safe body renderer (PUBKB-d),
 * the SEO HTML surface (PUBKB-e), the sitemap (PUBKB-f) and the admin editor
 * (PUBKB-h). Every layer has its own unit/integration tests; what none of them
 * can show is that the three adjectives the requirement is built on hold at the
 * boundary, for a real browser with no session:
 *
 *   - public       an unauthenticated context reads a published article, its
 *                  title and body in the first bytes (no client script runs).
 *   - yalnız yayınlanan  a draft — and an unpublished-again article — is one
 *                  indistinguishable 404, its text nowhere on the page and its
 *                  slug absent from the sitemap.
 *   - self-servis  the reader browses category → article with no chat, no
 *                  widget, no agent — nothing but links.
 *   - SEO'lu       `<title>` / meta description / canonical / sitemap all name
 *                  the exact page.
 *
 * Two security claims ride alongside, each pinned to its own assertion:
 *   - stored XSS   a `<img onerror>` in the body is inert text on the page —
 *                  no active element, no script executed (NFR-S6).
 *   - cross-tenant a workspace address never exposes another tenant's article,
 *                  either as a page or in a sitemap (NFR-S5) — its own `test`.
 *
 * Setup goes through the API rather than the database (fixtures.ts's rule): the
 * KB is enabled and a second tenant stood up with real tokens, so a break in the
 * management path shows up here rather than being papered over by a DB insert.
 */
import { request as newApiContext, type APIRequestContext } from '@playwright/test';
import {
  ACME_OWNER,
  API_BASE,
  NORTHWIND_OWNER,
  expect,
  ownerAccessTokenFor,
  test,
} from './fixtures.js';

/** Where the public KB is served — `${API_BASE_URL}${API_PREFIX}` (server.ts). */
const PUBLIC_BASE = 'http://localhost:4000/api/v1';

const ACME_KB_SLUG = 'acme-help';
const NW_KB_SLUG = 'nw-help';
/** Northwind's one stable published article — the "other tenant" side of the matrix. */
const NW_ARTICLE_SLUG = 'nw-shipping';

const kbHome = (workspace: string): string => `${PUBLIC_BASE}/public/kb/${workspace}`;
const kbArticle = (workspace: string, article: string): string => `${kbHome(workspace)}/${article}`;
const kbSitemap = (workspace: string): string => `${kbHome(workspace)}/sitemap.xml`;

/** Number of `<loc>` entries in a sitemap — i.e. how many URLs it lists. */
const locCount = (xml: string): number => (xml.match(/<loc>/g) ?? []).length;

/**
 * A unique query string per call. The public HTML surface returns
 * `cache-control: public, max-age=60`, and Playwright's APIRequestContext honours
 * it — so a re-fetch after a state change (a publish, an unpublish) would be
 * served the stale body. A distinct URL each time forces a real round trip, which
 * is exactly what these assertions need. The server ignores unknown query params,
 * and the canonical/`<loc>` URLs it emits are built from the path, so the values
 * under test are unaffected.
 */
let cacheBust = 0;
const fresh = (url: string): string => `${url}${url.includes('?') ? '&' : '?'}_cb=${cacheBust++}`;

const auth = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

// --- API helpers (management surface, PUBKB-b) -------------------------------

async function listArticles(
  api: APIRequestContext,
  token: string,
): Promise<Array<{ id: string; slug: string; status: string }>> {
  const res = await api.get(`${API_BASE}/kb-articles`, auth(token));
  expect(res.ok(), `list articles failed: ${res.status()} ${await res.text()}`).toBe(true);
  return ((await res.json()) as { items: Array<{ id: string; slug: string; status: string }> })
    .items;
}

async function deleteArticleBySlug(
  api: APIRequestContext,
  token: string,
  slug: string,
): Promise<void> {
  const match = (await listArticles(api, token)).find((a) => a.slug === slug);
  if (match) await api.delete(`${API_BASE}/kb-articles/${match.id}`, auth(token));
}

/** Reset a tenant's KB to a known baseline — the idempotent seed does not, so a
 *  prior run's articles/categories would otherwise leak into these assertions. */
async function resetTenantKb(api: APIRequestContext, token: string): Promise<void> {
  for (const article of await listArticles(api, token)) {
    await api.delete(`${API_BASE}/kb-articles/${article.id}`, auth(token));
  }
  const cats = await api.get(`${API_BASE}/kb-categories`, auth(token));
  for (const cat of ((await cats.json()) as { items: Array<{ id: string }> }).items) {
    await api.delete(`${API_BASE}/kb-categories/${cat.id}`, auth(token));
  }
}

async function enableKb(
  api: APIRequestContext,
  token: string,
  publicSlug: string,
  siteTitle: string,
): Promise<void> {
  const res = await api.put(`${API_BASE}/kb-settings`, {
    ...auth(token),
    data: { enabled: true, public_slug: publicSlug, site_title: siteTitle },
  });
  expect(res.ok(), `enable KB failed: ${res.status()} ${await res.text()}`).toBe(true);
}

async function createCategory(api: APIRequestContext, token: string, name: string): Promise<void> {
  const res = await api.post(`${API_BASE}/kb-categories`, { ...auth(token), data: { name } });
  expect(res.ok(), `create category failed: ${res.status()} ${await res.text()}`).toBe(true);
}

async function createPublishedArticle(
  api: APIRequestContext,
  token: string,
  data: { title: string; slug: string; body: string },
): Promise<void> {
  const created = await api.post(`${API_BASE}/kb-articles`, { ...auth(token), data });
  expect(created.ok(), `create article failed: ${created.status()} ${await created.text()}`).toBe(
    true,
  );
  const { id } = (await created.json()) as { id: string };
  const published = await api.patch(`${API_BASE}/kb-articles/${id}`, {
    ...auth(token),
    data: { status: 'published' },
  });
  expect(published.ok(), `publish failed: ${published.status()} ${await published.text()}`).toBe(
    true,
  );
}

// --- shared setup ------------------------------------------------------------

let apiCtx: APIRequestContext;
let acmeToken: string;
let nwToken: string;

test.beforeAll(async () => {
  apiCtx = await newApiContext.newContext({
    extraHTTPHeaders: { 'user-agent': 'nexa-e2e-public-kb' },
  });
  acmeToken = await ownerAccessTokenFor(apiCtx, ACME_OWNER);
  nwToken = await ownerAccessTokenFor(apiCtx, NORTHWIND_OWNER);

  await resetTenantKb(apiCtx, acmeToken);
  await resetTenantKb(apiCtx, nwToken);

  // Both KBs go live on stable, distinct public addresses.
  await enableKb(apiCtx, acmeToken, ACME_KB_SLUG, 'Acme Help Center');
  await enableKb(apiCtx, nwToken, NW_KB_SLUG, 'Northwind Help');

  // Acme gets a category up front so the UI story files its article under it —
  // without racing the create-category path, which PUBKB-h already unit-tests.
  await createCategory(apiCtx, acmeToken, 'Guides');

  // Northwind publishes one article: the other-tenant half of the cross-tenant
  // matrix, and a positive control that its own workspace works.
  await createPublishedArticle(apiCtx, nwToken, {
    title: 'Northwind shipping times',
    slug: NW_ARTICLE_SLUG,
    body: 'We ship Northwind orders within two business days.',
  });
});

test.afterAll(async () => {
  await apiCtx?.dispose();
});

test('a published KB article is anonymously readable, SEO-ready and XSS-safe; drafts and unpublished are 404', async ({
  agentPage,
  browser,
  request,
}, testInfo) => {
  const ARTICLE_SLUG = 'returns-policy';
  const TITLE = 'Returns and refunds';
  const MARKER = 'Return your Acme bike within 30 days for a full refund.';
  // Escaped-first rendering (PUBKB-d) must turn this into inert text, never a tag.
  const XSS = '<img src=x onerror="window.__nexaKbXss = 1">';
  const SEO_TITLE = 'Returns & refunds - Acme Bikes';
  const SEO_DESC = 'How to return an Acme bike within 30 days for a refund.';
  const articleUrl = kbArticle(ACME_KB_SLUG, ARTICLE_SLUG);

  // Idempotent across retries: a prior attempt may have created this article.
  await deleteArticleBySlug(apiCtx, acmeToken, ARTICLE_SLUG);

  // --- an agent authors the article in the panel ----------------------------
  // The editor is a tall, single-column form; give the window enough height that
  // its whole content — down to Create/Publish — fits without depending on the
  // modal scrolling (a separate admin concern, not what PUBKB-i verifies).
  await agentPage.setViewportSize({ width: 1280, height: 1600 });
  await agentPage.goto('/app/playbook');
  await agentPage.getByRole('tab', { name: 'Public KB' }).click();
  await agentPage.getByRole('button', { name: 'New article' }).click();

  const editor = agentPage.getByRole('dialog', { name: 'New article' });
  await expect(editor).toBeVisible();
  await editor.getByLabel('Title', { exact: true }).fill(TITLE);
  await editor.getByLabel('Slug', { exact: true }).fill(ARTICLE_SLUG);
  await editor.getByLabel('Category', { exact: true }).selectOption({ label: 'Guides' });
  await editor
    .getByLabel('Body', { exact: true })
    .fill(`## How returns work\n\n${MARKER}\n\n${XSS}\n\nSee [our site](https://example.com).`);
  await editor.getByLabel('SEO title', { exact: true }).fill(SEO_TITLE);
  await editor.getByLabel('SEO description', { exact: true }).fill(SEO_DESC);
  await editor.getByRole('button', { name: 'Create article' }).click();

  // Born a draft (KK: publishing is a separate, explicit action).
  await expect(editor.getByRole('button', { name: 'Publish', exact: true })).toBeVisible();

  // --- while a draft, the public surface reveals nothing --------------------
  const draftPage = await request.get(fresh(articleUrl));
  expect(draftPage.status()).toBe(404);
  expect(await draftPage.text()).not.toContain(MARKER);

  const draftSitemap = await request.get(fresh(kbSitemap(ACME_KB_SLUG)));
  expect(draftSitemap.status()).toBe(200);
  expect(locCount(await draftSitemap.text())).toBe(0);

  // --- publish; the editor surfaces the exact public address ----------------
  await editor.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Unpublish', exact: true })).toBeVisible();
  await expect(editor.getByRole('link', { name: articleUrl })).toBeVisible();

  // --- a signed-out stranger reads it, self-service -------------------------
  const anon = await browser.newContext();
  const reader = await anon.newPage();
  try {
    // Home → category → article, links only: no chat, no widget, no session.
    await reader.goto(kbHome(ACME_KB_SLUG));
    await expect(reader).toHaveTitle('Acme Help Center');
    await expect(reader.getByRole('heading', { level: 1, name: 'Acme Help Center' })).toBeVisible();
    await expect(reader.getByRole('heading', { level: 2, name: 'Guides' })).toBeVisible();
    await reader.getByRole('link', { name: TITLE }).click();

    await expect(reader).toHaveURL(articleUrl);
    await expect(reader.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(reader.getByText(MARKER)).toBeVisible();

    // SEO'lu: the head names this exact page.
    await expect(reader).toHaveTitle(SEO_TITLE);
    await expect(reader.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      /How to return an Acme bike/,
    );
    await expect(reader.locator('link[rel="canonical"]')).toHaveAttribute('href', articleUrl);

    // Stored-XSS boundary: inert text, no active element, no script ran.
    expect(await reader.locator('img[onerror]').count()).toBe(0);
    await expect(reader.locator('article')).toContainText('onerror');
    expect(
      await reader.evaluate(() => (window as unknown as { __nexaKbXss?: number }).__nexaKbXss),
    ).toBeUndefined();

    await reader.screenshot({ path: 'kanit/76.9-public-kb-article.png', fullPage: true });
  } finally {
    await anon.close();
  }

  // --- sitemap lists exactly this article, and nothing of another tenant ----
  const sitemap = await request.get(fresh(kbSitemap(ACME_KB_SLUG)));
  expect(sitemap.status()).toBe(200);
  const sitemapXml = await sitemap.text();
  expect(locCount(sitemapXml)).toBe(1);
  expect(sitemapXml).toContain(`<loc>${articleUrl}</loc>`);
  expect(sitemapXml).not.toContain(NW_ARTICLE_SLUG);

  // --- readable with JavaScript disabled (first paint, NFR-P2 / SEO) --------
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const noJsReader = await noJs.newPage();
  try {
    await noJsReader.goto(articleUrl);
    await expect(noJsReader.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(noJsReader.getByText(MARKER)).toBeVisible();
  } finally {
    await noJs.close();
  }

  // --- NFR-P2 single-request budget, recorded for the handoff ---------------
  const started = Date.now();
  const measured = await request.get(fresh(articleUrl));
  const elapsedMs = Date.now() - started;
  const bytes = Buffer.byteLength(await measured.text(), 'utf8');
  expect(measured.status()).toBe(200);
  expect(bytes).toBeLessThan(100_000);
  const budget = `NFR-P2 public article budget — ${elapsedMs} ms, ${bytes} bytes`;
  console.log(budget);
  await testInfo.attach('nfr-p2-budget', { body: budget, contentType: 'text/plain' });

  // --- unpublish returns it to a 404 and drops it from the sitemap ----------
  await editor.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Publish', exact: true })).toBeVisible();

  const afterUnpublish = await request.get(fresh(articleUrl));
  expect(afterUnpublish.status()).toBe(404);
  const finalSitemap = await request.get(fresh(kbSitemap(ACME_KB_SLUG)));
  expect(locCount(await finalSitemap.text())).toBe(0);
});

test("cross-tenant: a workspace address never exposes another tenant's article", async ({
  request,
}) => {
  const ACME_ISO_SLUG = 'acme-warranty';
  await deleteArticleBySlug(apiCtx, acmeToken, ACME_ISO_SLUG);
  await createPublishedArticle(apiCtx, acmeToken, {
    title: 'Acme warranty',
    slug: ACME_ISO_SLUG,
    body: 'Acme covers frames for five years.',
  });

  try {
    // Positive controls: each article is readable under its OWN workspace —
    // so the 404s below are isolation, not a broken workspace.
    expect((await request.get(fresh(kbArticle(ACME_KB_SLUG, ACME_ISO_SLUG)))).status()).toBe(200);
    expect((await request.get(fresh(kbArticle(NW_KB_SLUG, NW_ARTICLE_SLUG)))).status()).toBe(200);

    // The isolation claim, both directions: A's slug under B, B's slug under A.
    expect((await request.get(fresh(kbArticle(NW_KB_SLUG, ACME_ISO_SLUG)))).status()).toBe(404);
    expect((await request.get(fresh(kbArticle(ACME_KB_SLUG, NW_ARTICLE_SLUG)))).status()).toBe(404);
  } finally {
    await deleteArticleBySlug(apiCtx, acmeToken, ACME_ISO_SLUG);
  }
});
