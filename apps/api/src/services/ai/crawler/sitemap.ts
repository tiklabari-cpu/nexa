/**
 * Sitemaps for the website crawl (tm 312.2 · AI-17): where `all` and
 * `sitemap` scopes find their pages before (or instead of) following links.
 *
 * The sitemaps a site's robots.txt names are read — or, when it names none,
 * `/sitemap.xml` at the start URL's origin. A sitemap index is followed
 * {@link KNOWLEDGE_CRAWL_LIMITS}`.sitemapIndexDepth` levels below the first;
 * reading stops after `sitemapUrls` entries in all, after
 * {@link SITEMAP_MAX_DOCUMENTS} documents, or once the crawl has as many
 * in-scope pages as it wants. Each entry goes through the crawl's scope, so
 * a sitemap that lists another site, or pages outside the start path or the
 * source's path lists, adds nothing — and since only sitemaps on the source's
 * own site are requested, nothing outside it is asked for either.
 *
 * The XML is read by a linear scanner, not a parser: it looks for `<loc>`
 * inside `<url>`/`<sitemap>` and nothing else, never builds a tree, has no
 * entity expansion beyond the five predefined ones and character references
 * (no DTD, so no billion laughs), and keeps whatever it read when a body was
 * cut off at its ceiling. `<image:loc>` and the other extension elements are
 * not page addresses and are skipped. A gzip-compressed sitemap
 * (`sitemap.xml.gz`) is inflated up to the same ceiling; a plain-text sitemap
 * (one URL per line) is read too.
 */
import zlib from 'node:zlib';
import { KNOWLEDGE_CRAWL_LIMITS } from '@siyahtus/types';
import { fetchCeiling, type CrawlFetcher } from './fetcher.js';
import { normalizeCrawlUrl, type CrawlScope } from './frontier.js';

/** Sitemap documents one discovery reads at most, the index ones included. */
export const SITEMAP_MAX_DOCUMENTS = 100;

export interface ParsedSitemap {
  /** `urlset` lists pages; `sitemapindex` lists further sitemaps. */
  kind: 'urlset' | 'sitemapindex';
  /** The `<loc>` values in document order, trimmed, not yet checked. */
  locs: string[];
}

/**
 * The entries of a sitemap document, or null when the text is not one. Reads
 * at most `maxLocs` entries.
 */
export function parseSitemap(
  text: string,
  maxLocs = Number.POSITIVE_INFINITY,
): ParsedSitemap | null {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const start = body.search(/\S/);
  if (start === -1) return null;
  if (body[start] !== '<') return parseTextSitemap(body, maxLocs);

  let root: { kind: ParsedSitemap['kind']; prefix: string } | null = null;
  const locs: string[] = [];
  let inEntry = false;
  let inLoc = false;
  let pieces: string[] = [];
  let at = start;

  while (at < body.length && locs.length < maxLocs) {
    const open = body.indexOf('<', at);
    const textEnd = open === -1 ? body.length : open;
    if (inLoc && textEnd > at) pieces.push(decodeXmlText(body.slice(at, textEnd)));
    if (open === -1) break;

    if (body.startsWith('<!--', open)) {
      const end = body.indexOf('-->', open + 4);
      if (end === -1) break;
      at = end + 3;
      continue;
    }
    if (body.startsWith('<![CDATA[', open)) {
      const end = body.indexOf(']]>', open + 9);
      if (end === -1) break;
      if (inLoc) pieces.push(body.slice(open + 9, end));
      at = end + 3;
      continue;
    }
    const close = body.indexOf('>', open);
    if (close === -1) break;
    at = close + 1;
    // `<?xml …?>` and `<!DOCTYPE …>` say nothing about entries.
    if (body[open + 1] === '?' || body[open + 1] === '!') continue;

    const inner = body.slice(open + 1, close);
    const closing = inner.startsWith('/');
    const name = tagName(closing ? inner.slice(1) : inner);
    const selfClosing = !closing && inner.endsWith('/');

    if (root === null) {
      if (closing) continue;
      const colon = name.indexOf(':');
      const local = colon === -1 ? name : name.slice(colon + 1);
      if (local !== 'urlset' && local !== 'sitemapindex') return null;
      root = { kind: local, prefix: colon === -1 ? '' : name.slice(0, colon + 1) };
      continue;
    }
    const entry = root.kind === 'urlset' ? `${root.prefix}url` : `${root.prefix}sitemap`;
    if (name === entry) {
      inEntry = !closing && !selfClosing;
      inLoc = false;
      continue;
    }
    if (name !== `${root.prefix}loc` || !inEntry) continue;
    if (!closing) {
      inLoc = !selfClosing;
      pieces = [];
    } else if (inLoc) {
      inLoc = false;
      const value = pieces.join('').trim();
      if (value !== '') locs.push(value);
    }
  }
  return root === null ? null : { kind: root.kind, locs };
}

/** A tag's name: up to the first whitespace or `/`. */
function tagName(inner: string): string {
  let end = 0;
  while (end < inner.length) {
    const code = inner.charCodeAt(end);
    if (code === 0x2f || code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) break;
    end += 1;
  }
  return inner.slice(0, end);
}

const XML_ENTITY = /&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos));/g;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXmlText(text: string): string {
  return text.replace(XML_ENTITY, (whole, decimal?: string, hex?: string, named?: string) => {
    if (named) return NAMED[named] ?? whole;
    const code = decimal ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? '', 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** A text sitemap: one absolute http(s) URL per line; anything else ignored. */
function parseTextSitemap(text: string, maxLocs: number): ParsedSitemap | null {
  const locs: string[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    if (locs.length >= maxLocs) break;
    const line = raw.trim();
    if (!line.startsWith('http://') && !line.startsWith('https://')) continue;
    locs.push(line);
  }
  return locs.length > 0 ? { kind: 'urlset', locs } : null;
}

export interface SitemapDiscoveryOptions {
  fetcher: CrawlFetcher;
  scope: CrawlScope;
  /** The `Sitemap:` lines of the site's robots.txt; none means `/sitemap.xml`. */
  declared: readonly string[];
  /** In-scope pages wanted — the crawl's page limit; reading stops there. */
  want?: number;
  /** One document's ceiling; default a page's. */
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface SitemapDiscovery {
  /** In-scope page URLs, normalised and deduplicated, in the order the sitemaps list them. */
  urls: string[];
  /** Whether any sitemap could be read. */
  found: boolean;
  /** Sitemap documents requested. */
  documents: number;
  /** Bytes read off the wire for them. */
  bytes: number;
  /** Entries read, in scope or not. */
  entries: number;
}

/** The in-scope pages a site's sitemaps list. Never throws for anything the site did. */
export async function discoverSitemapUrls(
  options: SitemapDiscoveryOptions,
): Promise<SitemapDiscovery> {
  const { fetcher, scope } = options;
  const want = options.want ?? Number.POSITIVE_INFINITY;
  const maxBytes = options.maxBytes ?? fetchCeiling({ url: '', purpose: 'sitemap' });
  const result: SitemapDiscovery = { urls: [], found: false, documents: 0, bytes: 0, entries: 0 };
  const keys = new Set<string>();

  const declared = options.declared.filter((url) => scope.sameSite(url));
  const queue: Array<{ url: string; level: number }> = (
    declared.length > 0 ? declared : [new URL('/sitemap.xml', scope.root.url).href]
  ).map((url) => ({ url, level: 0 }));
  const asked = new Set(queue.map((entry) => entry.url));

  while (queue.length > 0) {
    if (options.signal?.aborted) break;
    if (result.documents >= SITEMAP_MAX_DOCUMENTS) break;
    if (result.entries >= KNOWLEDGE_CRAWL_LIMITS.sitemapUrls) break;
    if (result.urls.length >= want) break;
    const { url, level } = queue.shift()!;

    result.documents += 1;
    const fetched = await fetcher.fetch({
      url,
      purpose: 'sitemap',
      maxBytes,
      truncate: true,
      allowRedirect: (next) => scope.sameSite(next),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    result.bytes += fetched.bytes;
    if (fetched.kind !== 'ok') continue;

    const text = sitemapText(fetched.body, maxBytes);
    if (text === null) continue;
    const parsed = parseSitemap(text, KNOWLEDGE_CRAWL_LIMITS.sitemapUrls - result.entries);
    if (!parsed) continue;
    result.found = true;
    result.entries += parsed.locs.length;

    if (parsed.kind === 'sitemapindex') {
      if (level >= KNOWLEDGE_CRAWL_LIMITS.sitemapIndexDepth) continue;
      for (const loc of parsed.locs) {
        let child: string;
        try {
          child = new URL(loc, fetched.url).href;
        } catch {
          continue;
        }
        if (asked.has(child) || !scope.sameSite(child)) continue;
        asked.add(child);
        queue.push({ url: child, level: level + 1 });
      }
      continue;
    }

    for (const loc of parsed.locs) {
      if (scope.check(loc, fetched.url) !== 'in') continue;
      const normalized = normalizeCrawlUrl(loc, fetched.url)!;
      if (keys.has(normalized.key)) continue;
      keys.add(normalized.key);
      result.urls.push(normalized.url);
      if (result.urls.length >= want) break;
    }
  }
  return result;
}

/** A sitemap body as text: inflated first when it is gzip (`.xml.gz`), up to the ceiling. */
function sitemapText(body: Buffer, maxBytes: number): string | null {
  if (body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b) {
    try {
      return zlib.gunzipSync(body, { maxOutputLength: maxBytes }).toString('utf8');
    } catch {
      // Corrupt, or inflates past the ceiling: not a sitemap this reads.
      return null;
    }
  }
  return body.toString('utf8');
}
