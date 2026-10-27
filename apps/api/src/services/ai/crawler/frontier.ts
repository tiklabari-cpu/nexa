/**
 * Which URLs a website crawl visits, in what order, and under what identity
 * (tm 312.2 · AI-17).
 *
 * Three things live here, all pure:
 *
 *   - **Normalisation** ({@link normalizeCrawlUrl}). One page reached by many
 *     spellings — `#section`, `?utm_source=…`, `?b=2&a=1`, `/yardim/` — is one
 *     page, fetched once and stored once (`knowledge_pages` is unique on the
 *     source and {@link NormalizedUrl.hash}). The URL actually fetched keeps
 *     its trailing slash and scheme; the identity drops both, and a leading
 *     `www.`, so a site that links itself both ways is still crawled once.
 *   - **Scope** ({@link createCrawlScope}). A crawl stays on the site it was
 *     given — same host (`www.` or not), same port, the same scheme or an
 *     upgrade to `https:` — under the start URL's path, and inside the
 *     source's include/exclude lists. Every link, sitemap entry, canonical
 *     and redirect goes through the same check, so "outside the scope" means
 *     one thing everywhere, and nothing outside it is ever requested.
 *   - **The frontier** ({@link CrawlFrontier}). Breadth-first, deduplicated
 *     on the identity, bounded by the source's page limit and the crawl depth,
 *     and saved as a plain JSON array (`knowledge_jobs.frontier`) so a job that
 *     stops — the day's AI allowance ran out, the runner restarted — resumes
 *     where it was.
 */
import { createHash } from 'node:crypto';
import { crawlPathInScope, KNOWLEDGE_CRAWL_LIMITS } from '@siyahtus/types';

/** `knowledge_pages.url`'s ceiling — the source URL's own (`source_url` maxLength). */
export const CRAWL_URL_MAX_LENGTH = 2048;

/** Query parameters that only record how a visitor arrived; the page is the same without them. */
const TRACKING_PARAMS = new Set(['gclid', 'fbclid']);
const TRACKING_PREFIX = 'utm_';

/** One URL as a crawl keeps it. */
export interface NormalizedUrl {
  /** What is fetched and stored: no fragment, no tracking parameters, parameters sorted. */
  url: string;
  /** The page's identity: {@link url} without its scheme, a leading `www.` or a trailing `/`. */
  key: string;
  /** `knowledge_pages.url_hash`: the identity's sha256, lowercase hex. */
  hash: string;
}

/**
 * A URL in the one spelling a crawl keeps, or null when it is nothing a crawl
 * can fetch: not a URL, not `http:`/`https:`, carrying a user name or
 * password, or longer than {@link CRAWL_URL_MAX_LENGTH}. `base` resolves a
 * relative link the way the page it was found on would.
 *
 * Parameters keep the exact bytes they arrived with — only their order and
 * the tracking ones change — so the server is asked for what the link said.
 */
export function normalizeCrawlUrl(raw: string, base?: string | URL): NormalizedUrl | null {
  let url: URL;
  try {
    url = base === undefined ? new URL(raw) : new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // A URL that carries credentials would replay them — the SSRF guard refuses
  // it as well; a crawl never even queues one.
  if (url.username || url.password) return null;

  url.hash = '';
  const pairs = url.search
    .slice(1)
    .split('&')
    .filter((pair) => pair !== '' && !isTrackingParam(paramName(pair)));
  // Stable: two values of one parameter keep their order, which can matter.
  pairs.sort((a, b) => compareStrings(paramName(a), paramName(b)));
  url.search = pairs.length > 0 ? `?${pairs.join('&')}` : '';

  const href = url.href;
  if (href.length > CRAWL_URL_MAX_LENGTH) return null;

  const path = withoutTrailingSlashes(url.pathname);
  const key = `${siteHost(url.hostname)}${url.port ? `:${url.port}` : ''}${path}${url.search}`;
  return { url: href, key, hash: sha256Hex(key) };
}

/** `/a/b//` → `/a/b`; the root stays `/`. A loop, not a regex: a path is a stranger's. */
function withoutTrailingSlashes(pathname: string): string {
  let end = pathname.length;
  while (end > 1 && pathname.charCodeAt(end - 1) === 0x2f) end -= 1;
  return pathname.slice(0, end);
}

function paramName(pair: string): string {
  const equals = pair.indexOf('=');
  const name = equals === -1 ? pair : pair.slice(0, equals);
  try {
    return decodeURIComponent(name.replace(/\+/g, ' ')).toLowerCase();
  } catch {
    return name.toLowerCase();
  }
}

function isTrackingParam(name: string): boolean {
  return name.startsWith(TRACKING_PREFIX) || TRACKING_PARAMS.has(name);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A host without the `www.` a site answers to either way. */
function siteHost(hostname: string): string {
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** What a source says about where its crawl may go. */
export interface CrawlScopeSettings {
  /** The source's URL — where the crawl starts and what bounds it. */
  rootUrl: string;
  /** Path prefixes a page must be under (none: any), `include_paths`. */
  include: readonly string[];
  /** Path prefixes no page may be under, `exclude_paths` — these win. */
  exclude: readonly string[];
}

/**
 * Why a URL is not in scope: `invalid` — not a URL a crawl can fetch;
 * `other_site` — another host, port or a downgrade to `http:`;
 * `outside_root` — not under the start URL's path; `path_rule` — refused by
 * the source's include/exclude lists.
 */
export type CrawlScopeVerdict = 'in' | 'invalid' | 'other_site' | 'outside_root' | 'path_rule';

export interface CrawlScope {
  /** The start URL, normalised. */
  readonly root: NormalizedUrl;
  /** Whether `url` (absolute, or relative to `base`) is one this crawl may request. */
  check(url: string | URL, base?: string | URL): CrawlScopeVerdict;
  /** The same host, port and scheme rule, without the path rules — where a sitemap may be read from. */
  sameSite(url: string | URL): boolean;
}

/**
 * The scope of one source's crawl. Throws when the root itself is not a URL a
 * crawl can fetch; the API refused such a source long before it got here.
 *
 * The start URL's path bounds the crawl like a directory: `/yardim` and
 * `/yardim/` both take `/yardim/…`, but not `/yardimlar`; a start URL naming
 * a file (`/yardim/sss.html`) takes the directory it is in. Include and
 * exclude lists are matched on the decoded path, so `/yardım` written by a
 * person matches the `/yard%C4%B1m` a server sends.
 */
export function createCrawlScope(settings: CrawlScopeSettings): CrawlScope {
  const root = normalizeCrawlUrl(settings.rootUrl);
  if (!root) throw new Error('The crawl root is not an http(s) URL a crawl can fetch.');
  const rootUrl = new URL(root.url);
  const host = siteHost(rootUrl.hostname);
  const port = rootUrl.port;
  const allowHttp = rootUrl.protocol === 'http:';
  const prefix = rootPrefix(rootUrl.pathname);
  const include = settings.include.map(safeDecode);
  const exclude = settings.exclude.map(safeDecode);

  const sameSite = (url: URL): boolean =>
    (url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')) &&
    siteHost(url.hostname) === host &&
    url.port === port;

  return {
    root,
    check(raw, base) {
      const normalized = normalizeCrawlUrl(
        typeof raw === 'string' ? raw : raw.href,
        base === undefined ? undefined : base,
      );
      if (!normalized) return 'invalid';
      const url = new URL(normalized.url);
      if (!sameSite(url)) return 'other_site';
      if (!underPrefix(url.pathname, prefix)) return 'outside_root';
      return crawlPathInScope(safeDecode(url.pathname), include, exclude) ? 'in' : 'path_rule';
    },
    sameSite(raw) {
      try {
        return sameSite(typeof raw === 'string' ? new URL(raw) : raw);
      } catch {
        return false;
      }
    },
  };
}

/**
 * The path prefix a start URL bounds its crawl with: the path itself, or the
 * directory of a path whose last segment names a file (has a dot).
 */
function rootPrefix(pathname: string): string {
  if (pathname.endsWith('/')) return pathname;
  const lastSlash = pathname.lastIndexOf('/');
  const last = pathname.slice(lastSlash + 1);
  return last.includes('.') ? pathname.slice(0, lastSlash + 1) : pathname;
}

/** `crawlPathInScope`'s segment-boundary rule for one prefix. */
function underPrefix(path: string, prefix: string): boolean {
  if (prefix === '/' || path === prefix) return true;
  return prefix.endsWith('/') ? path.startsWith(prefix) : path.startsWith(`${prefix}/`);
}

function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** One page waiting to be fetched, as `knowledge_jobs.frontier` stores it. */
export interface FrontierEntry {
  url: string;
  /** Links followed from the start URL to reach it; a sitemap entry is 0. */
  depth: number;
}

/** A page taken from the frontier: its entry plus its identity. */
export type FrontierPage = FrontierEntry & NormalizedUrl;

/**
 * What became of an offered URL: `queued`; `seen` — already queued or done;
 * `too_deep`; `full` — the page limit is reached; or a scope verdict.
 */
export type FrontierVerdict =
  'queued' | 'seen' | 'too_deep' | 'full' | Exclude<CrawlScopeVerdict, 'in'>;

export interface CrawlFrontierOptions {
  scope: CrawlScope;
  /** Pages this crawl may take in at most — the source's `page_limit`. */
  pageLimit: number;
  /** Links followed from the start URL at most. */
  maxDepth?: number;
}

/**
 * A breadth-first queue of in-scope pages, each identity at most once.
 *
 * Every page let in counts towards the page limit — whatever becomes of it —
 * so a crawl requests at most `pageLimit` pages whatever the site links to.
 * Pages are taken in the order they were let in; with links offered at their
 * page's depth + 1 that order is breadth-first.
 */
export class CrawlFrontier {
  readonly scope: CrawlScope;
  readonly pageLimit: number;
  readonly maxDepth: number;
  readonly #pending: FrontierPage[] = [];
  #head = 0;
  /** Identities let in — queued or done — and the canonicals pages adopted. */
  readonly #seen = new Set<string>();
  /** Pages let in, each counted once whatever identity it ends up with. */
  #admitted = 0;

  constructor(options: CrawlFrontierOptions) {
    this.scope = options.scope;
    this.pageLimit = Math.max(0, Math.floor(options.pageLimit));
    this.maxDepth = options.maxDepth ?? KNOWLEDGE_CRAWL_LIMITS.depth;
  }

  /**
   * A frontier a stopped job resumes: `saved` is what {@link toJSON} wrote
   * (anything else in it is dropped, not trusted), `done` the identities the
   * job already recorded. Saved entries are re-checked against the scope — the
   * source's lists may have changed since — and keep their order.
   */
  static restore(
    options: CrawlFrontierOptions,
    saved: unknown,
    done: Iterable<string> = [],
  ): CrawlFrontier {
    const frontier = new CrawlFrontier(options);
    for (const key of done) {
      if (frontier.#seen.has(key)) continue;
      frontier.#seen.add(key);
      frontier.#admitted += 1;
    }
    if (Array.isArray(saved)) {
      for (const entry of saved) {
        if (!isFrontierEntry(entry)) continue;
        frontier.add(entry.url, entry.depth);
      }
    }
    return frontier;
  }

  /** Offer a URL found at `depth` (absolute, or relative to `base`). */
  add(raw: string, depth: number, base?: string | URL): FrontierVerdict {
    const verdict = this.scope.check(raw, base);
    if (verdict !== 'in') return verdict;
    const normalized = normalizeCrawlUrl(raw, base)!;
    if (this.#seen.has(normalized.key)) return 'seen';
    if (depth > this.maxDepth) return 'too_deep';
    if (this.#admitted >= this.pageLimit) return 'full';
    this.#seen.add(normalized.key);
    this.#admitted += 1;
    this.#pending.push({ ...normalized, depth });
    return 'queued';
  }

  /** The next page to fetch, or undefined when none is left. */
  next(): FrontierPage | undefined {
    if (this.#head >= this.#pending.length) return undefined;
    const page = this.#pending[this.#head]!;
    this.#head += 1;
    // Compact now and then, so a long crawl does not keep every taken entry.
    if (this.#head > 64 && this.#head * 2 > this.#pending.length) {
      this.#pending.splice(0, this.#head);
      this.#head = 0;
    }
    return page;
  }

  /** Whether an identity was let in — queued or done. */
  has(key: string): boolean {
    return this.#seen.has(key);
  }

  /** Pages let in so far, queued or done — never more than the page limit. */
  get admitted(): number {
    return this.#admitted;
  }

  /** Pages still waiting. */
  get pending(): number {
    return this.#pending.length - this.#head;
  }

  /**
   * The page a fetched page asked to be known as (`<link rel="canonical">`).
   * A canonical outside the scope, or not a URL, changes nothing: the page
   * stays itself. One in scope becomes the page's identity — and when that
   * identity was already let in under its own URL, the page is a `duplicate`
   * of it and is not recorded twice.
   */
  adoptCanonical(
    page: FrontierPage,
    canonical: string | null,
  ): { page: FrontierPage; duplicate: boolean } {
    if (canonical === null || this.scope.check(canonical, page.url) !== 'in') {
      return { page, duplicate: false };
    }
    const normalized = normalizeCrawlUrl(canonical, page.url)!;
    if (normalized.key === page.key) return { page, duplicate: false };
    const adopted: FrontierPage = { ...normalized, depth: page.depth };
    if (this.#seen.has(normalized.key)) return { page: adopted, duplicate: true };
    // The canonical takes the place this page was let in under; both stay
    // seen, so neither spelling is fetched again.
    this.#seen.add(normalized.key);
    return { page: adopted, duplicate: false };
  }

  /** The pages still waiting, as `knowledge_jobs.frontier` stores them. */
  toJSON(): FrontierEntry[] {
    return this.#pending.slice(this.#head).map(({ url, depth }) => ({ url, depth }));
  }
}

function isFrontierEntry(value: unknown): value is FrontierEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['url'] === 'string' &&
    typeof entry['depth'] === 'number' &&
    Number.isInteger(entry['depth']) &&
    entry['depth'] >= 0
  );
}
