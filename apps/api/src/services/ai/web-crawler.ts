/**
 * Website crawl + parse for the knowledge base (FR-MOD-06.3.2).
 *
 * External network access is mocked across Nexa (a real crawler needs egress
 * this build does not have), so the fetcher is a deterministic in-process stub:
 * the same URL always yields the same page, which is what lets an integration
 * test assert "crawl produced chunks" without a flaky network. The parse step is
 * real — it strips a genuine HTML document to text — so swapping the stub for a
 * real fetcher later changes only where the bytes come from, not how they are
 * turned into knowledge.
 *
 * The SSRF guard (`assertPublicHttpUrl`) runs *before* anything here, in the
 * route, so a private URL never reaches the fetcher at all.
 */

export interface CrawlResult {
  title: string;
  text: string;
}

/** Fetches a page's raw HTML. Replaceable so a real fetcher can drop in later. */
export type PageFetcher = (url: URL) => Promise<{ html: string }>;

/**
 * Deterministic mock page. Derives its content from the URL so the crawl is
 * reproducible and a test can recognise what came back, without any real I/O.
 */
export const mockFetcher: PageFetcher = async (url) => {
  const slug = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? 'home';
  const topic = slug.replace(/[-_]+/g, ' ');
  const html = `<!doctype html>
<html><head><title>${escapeHtml(topic)} — ${escapeHtml(url.hostname)}</title></head>
<body>
  <nav>Home About Contact</nav>
  <main>
    <h1>${escapeHtml(topic)}</h1>
    <p>This page from ${escapeHtml(url.hostname)} explains ${escapeHtml(topic)} for customers.</p>
    <p>Standard delivery takes three to five working days. Returns are accepted within
       thirty days when the item is unused and in its original packaging.</p>
    <p>For anything a self-service answer cannot cover, a human agent takes over.</p>
  </main>
  <script>console.log('tracking')</script>
  <style>body{color:#000}</style>
</body></html>`;
  return { html };
};

/** Fetch a URL and reduce it to a title and plain text ready for indexing. */
export async function crawl(url: URL, fetcher: PageFetcher = mockFetcher): Promise<CrawlResult> {
  const { html } = await fetcher(url);
  const title = extractTitle(html) ?? url.hostname;
  return { title, text: htmlToText(html) };
}

const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;

function extractTitle(html: string): string | null {
  const match = TITLE.exec(html);
  const title = match?.[1] ? decodeEntities(match[1]).trim() : '';
  return title || null;
}

/**
 * Strip an HTML document to readable text: drop script/style bodies (their
 * contents are code, not knowledge), remove every tag, decode the handful of
 * entities that survive that, and collapse whitespace to single spaces.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
