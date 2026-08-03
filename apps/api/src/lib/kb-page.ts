/**
 * Server-rendered SEO HTML for the public knowledge base (PUBKB-e · PRD
 * §5.3-Knowledge · NFR-P2 · NFR-A11Y1 · NFR-S6).
 *
 * The product SPA (`apps/web`) is client-rendered and deliberately un-indexable
 * (PRD A2, line 1045); the KK asks for a *SEO'lu* self-service KB, so these pages
 * are produced on the server as a template literal — no framework, no client
 * script needed to read them. The one hard rule: a crawler (and a reader with
 * JavaScript off) sees the article's title and full text in the very first bytes,
 * so everything a search engine needs is present before any script could run.
 * That is why nothing here loads a `<script src>`; the only `<script>` on the
 * page is the inert `application/ld+json` block.
 *
 * Safety is inherited, not reinvented. The article body is turned into markup by
 * `renderArticleBody` (PUBKB-d), whose escape-first/whitelist invariant is the
 * stored-XSS boundary; its output is the *only* HTML on the page that is not
 * escaped here. Every other interpolated value — titles, category names, the
 * meta description, every URL — passes through `escapeHtml`, the same audited
 * primitive the render core uses, so a `"`/`<`/`&` in a `seo_title` cannot break
 * out of an attribute or open a tag. The JSON-LD block is `JSON.stringify`d and
 * then has `<`/`>`/`&` unicode-escaped, so no field value (even one literally
 * containing `</script>`) can close the script element early.
 */
import { escapeHtml, renderArticleBody, renderPlainExcerpt } from './kb-render.js';

/**
 * Content language. Multi-language pages + `hreflang` are out of scope (§C
 * assumption 8: single language); the platform's locale is Turkish, so absent a
 * per-workspace language column that is the documented default for the `lang`
 * attribute a11y and crawlers require.
 */
const LANG = 'tr';

/** These pages exist to be found — the conscious opposite of `chat.html`'s noindex. */
const ROBOTS_INDEX = 'index, follow';
/** A miss must never be indexed, and carries no content to index anyway. */
const ROBOTS_NOINDEX = 'noindex, nofollow';

/** Minimal, self-contained reading styles. Inline (not a `<script>`), so the
 *  JS-free first paint stays fully readable without a network round-trip. */
const PAGE_STYLE =
  ':root{color-scheme:light dark}' +
  'body{margin:0 auto;max-width:44rem;padding:2rem 1.25rem;' +
  'font:1rem/1.65 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
  'main{overflow-wrap:break-word}h1{line-height:1.25}' +
  'nav[aria-label="Breadcrumb"] ol{list-style:none;display:flex;flex-wrap:wrap;gap:.5rem;padding:0}' +
  'nav[aria-label="Breadcrumb"] li+li::before{content:"/";margin-right:.5rem;opacity:.5}' +
  'a{color:inherit}pre,code{overflow-x:auto}';

/** Where the surface is served — `${API_BASE_URL}${API_PREFIX}`, no trailing slash. */
export interface KbPageLinks {
  base: string;
}

/** A single article as the index needs it (no body). */
export interface KbArticleLink {
  slug: string;
  title: string;
}

/** One index grouping: a category (or `null` for the uncategorised tail). */
export interface KbIndexSection {
  categoryName: string | null;
  articles: KbArticleLink[];
}

export interface KbIndexPageInput {
  workspaceSlug: string;
  siteTitle: string;
  sections: KbIndexSection[];
}

/** The article fields the page renders — the reader-facing subset only. */
export interface KbArticlePageInput {
  workspaceSlug: string;
  siteTitle: string;
  categoryName: string | null;
  article: {
    slug: string;
    title: string;
    body: string;
    excerpt: string | null;
    seoTitle: string | null;
    seoDescription: string | null;
    publishedAt: Date | null;
    updatedAt: Date;
  };
}

function indexUrl(base: string, workspaceSlug: string): string {
  return `${base}/public/kb/${encodeURIComponent(workspaceSlug)}`;
}

function articleUrl(base: string, workspaceSlug: string, articleSlug: string): string {
  return `${indexUrl(base, workspaceSlug)}/${encodeURIComponent(articleSlug)}`;
}

/**
 * Serialise a value into a safe `application/ld+json` block. `JSON.stringify`
 * already escapes `"` inside strings, but leaves `<`, `>` and `&` intact — a
 * field literally containing `</script>` would otherwise close the element. The
 * three unicode escapes keep the JSON valid while making that impossible.
 */
function jsonLdScript(data: Record<string, unknown>): string {
  const json = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  return `<script type="application/ld+json">${json}</script>`;
}

interface HeadInput {
  title: string;
  description: string;
  robots: string;
  canonical?: string;
  ogType: 'website' | 'article';
  publishedTime?: string;
  modifiedTime?: string;
  jsonLd?: string;
}

/** The `<head>` — every value escaped; canonical/OG omitted when there is no URL. */
function renderHead(input: HeadInput): string {
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description);
  const canonical = input.canonical ? escapeHtml(input.canonical) : '';
  const lines = [
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<meta name="robots" content="${escapeHtml(input.robots)}" />`,
    `<title>${title}</title>`,
    description ? `<meta name="description" content="${description}" />` : '',
    canonical ? `<link rel="canonical" href="${canonical}" />` : '',
    `<meta property="og:title" content="${title}" />`,
    description ? `<meta property="og:description" content="${description}" />` : '',
    `<meta property="og:type" content="${input.ogType}" />`,
    canonical ? `<meta property="og:url" content="${canonical}" />` : '',
    input.publishedTime
      ? `<meta property="article:published_time" content="${escapeHtml(input.publishedTime)}" />`
      : '',
    input.modifiedTime
      ? `<meta property="article:modified_time" content="${escapeHtml(input.modifiedTime)}" />`
      : '',
    input.jsonLd ?? '',
    `<style>${PAGE_STYLE}</style>`,
  ];
  return lines.filter(Boolean).join('\n    ');
}

function renderDocument(head: string, body: string): string {
  return `<!doctype html>
<html lang="${LANG}">
  <head>
    ${head}
  </head>
  <body>
${body}
  </body>
</html>
`;
}

interface Crumb {
  label: string;
  href?: string;
}

/** An accessible breadcrumb: an ordered list inside a labelled `<nav>` landmark;
 *  the current page is a non-link `aria-current="page"`. */
function renderBreadcrumb(crumbs: Crumb[]): string {
  const items = crumbs
    .map((crumb) => {
      const label = escapeHtml(crumb.label);
      const inner = crumb.href
        ? `<a href="${escapeHtml(crumb.href)}">${label}</a>`
        : `<span aria-current="page">${label}</span>`;
      return `<li>${inner}</li>`;
    })
    .join('');
  return `<nav aria-label="Breadcrumb"><ol>${items}</ol></nav>`;
}

/**
 * The workspace KB home: an `<h1>`, then one `<section>` per non-empty category
 * (each a single `<h2>` — no skipped heading levels, NFR-A11Y1) listing its
 * published articles, followed by the uncategorised tail. Links point at the
 * article pages on the same surface.
 */
export function renderIndexPage(input: KbIndexPageInput, links: KbPageLinks): string {
  const canonical = indexUrl(links.base, input.workspaceSlug);
  const sections = input.sections
    .map((section) => {
      const heading = section.categoryName ? `<h2>${escapeHtml(section.categoryName)}</h2>` : '';
      const items = section.articles
        .map(
          (article) =>
            `<li><a href="${escapeHtml(
              articleUrl(links.base, input.workspaceSlug, article.slug),
            )}">${escapeHtml(article.title)}</a></li>`,
        )
        .join('');
      return `<section>${heading}<ul>${items}</ul></section>`;
    })
    .join('\n      ');

  const head = renderHead({
    title: input.siteTitle,
    description: input.siteTitle,
    robots: ROBOTS_INDEX,
    canonical,
    ogType: 'website',
  });

  const body = `    <main>
      <h1>${escapeHtml(input.siteTitle)}</h1>
      ${sections || '<p></p>'}
    </main>`;

  return renderDocument(head, body);
}

/**
 * A single article. The `<title>`/description come from the SEO overrides when
 * set (`seo_title`/`seo_description`), else the article's own title/excerpt, with
 * the description always reduced to bounded, tag-free plain text by
 * `renderPlainExcerpt`. The body is `renderArticleBody`'s safe output — the one
 * pre-built HTML fragment on the page — under a single `<h1>` inside `<article>`,
 * with the breadcrumb providing the `<nav>` landmark and an `Article` JSON-LD
 * block describing the page.
 */
export function renderArticlePage(input: KbArticlePageInput, links: KbPageLinks): string {
  const { article } = input;
  const canonical = articleUrl(links.base, input.workspaceSlug, article.slug);
  const titleText = article.seoTitle ?? article.title;
  const description = renderPlainExcerpt(article.seoDescription ?? article.excerpt ?? article.body);
  const bodyHtml = renderArticleBody(article.body);
  const publishedIso = article.publishedAt ? article.publishedAt.toISOString() : undefined;
  const modifiedIso = article.updatedAt.toISOString();

  const jsonLd = jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    ...(description ? { description } : {}),
    url: canonical,
    ...(publishedIso ? { datePublished: publishedIso } : {}),
    dateModified: modifiedIso,
    ...(input.categoryName ? { articleSection: input.categoryName } : {}),
  });

  const head = renderHead({
    title: titleText,
    description,
    robots: ROBOTS_INDEX,
    canonical,
    ogType: 'article',
    publishedTime: publishedIso,
    modifiedTime: modifiedIso,
    jsonLd,
  });

  const breadcrumb = renderBreadcrumb([
    { label: input.siteTitle, href: indexUrl(links.base, input.workspaceSlug) },
    ...(input.categoryName ? [{ label: input.categoryName }] : []),
    { label: article.title },
  ]);

  const body = `    <main>
      ${breadcrumb}
      <article>
        <h1>${escapeHtml(article.title)}</h1>
${bodyHtml ? indent(bodyHtml, 8) : ''}
      </article>
    </main>`;

  return renderDocument(head, body);
}

/**
 * The single indistinguishable 404 (NFR-S5): a fixed, `noindex` page with no
 * canonical and no content — every kind of miss (unknown workspace, disabled KB,
 * cancelled licence, draft, another workspace's article) answers exactly this,
 * so nothing about what exists can be enumerated from the HTML surface either.
 */
export function renderNotFoundPage(): string {
  const head = renderHead({
    title: 'Not found',
    description: '',
    robots: ROBOTS_NOINDEX,
    ogType: 'website',
  });
  const body = `    <main>
      <h1>Not found</h1>
      <p>This page could not be found.</p>
    </main>`;
  return renderDocument(head, body);
}

/** Left-pad every line of an already-built HTML fragment, for readable output. */
function indent(html: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return html
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}
