/**
 * `robots.txt` (RFC 9309) for the website crawl (tm 312.2 · AI-17).
 *
 * A page the site's robots.txt disallows for this crawler is never fetched
 * (page status `robots_disallowed`). The rules followed are the RFC's:
 *
 *   - the group naming {@link CRAWLER_PRODUCT_TOKEN} (case-insensitively)
 *     applies, every such group together; with none, the `*` groups do; with
 *     neither, everything is allowed;
 *   - the longest matching `Allow`/`Disallow` pattern wins, `Allow` on a tie;
 *     `*` matches any run of characters and a final `$` anchors the end; the
 *     path and the patterns are compared with their percent-encoding
 *     normalised; `/robots.txt` itself is always allowed;
 *   - a 2xx is parsed (its first {@link ROBOTS_MAX_BYTES}); a 4xx means no
 *     rules; a 5xx, or no answer at all, means the site is unreachable and
 *     nothing is crawled (§2.3.1.4) — a crawler that cannot read the rules
 *     must not guess them. A 429 counts as unreachable too: the site asked
 *     for less traffic, not for more.
 *
 * Answers are cached per origin for {@link ROBOTS_TTL_MS} (§2.4: no longer
 * than 24 hours); an unreachable one only for {@link ROBOTS_UNREACHABLE_TTL_MS},
 * so a site briefly down at the start of a crawl is asked again soon.
 * `Sitemap:` lines are collected for the sitemap reader.
 */
import { CRAWLER_PRODUCT_TOKEN, type CrawlFetcher } from './fetcher.js';

/** RFC 9309 §2.5: a crawler parses at least the first 500 KiB. */
export const ROBOTS_MAX_BYTES = 500 * 1024;
export const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
export const ROBOTS_UNREACHABLE_TTL_MS = 10 * 60 * 1000;
/** `Sitemap:` lines kept from one file. */
export const ROBOTS_MAX_SITEMAPS = 50;

/**
 * What a site's robots.txt says for this crawler: `rules` — check each URL;
 * `allow_all` — no file, or nothing for this crawler; `unreachable` — the file
 * could not be read, so nothing may be crawled.
 */
export type RobotsPolicy =
  | { kind: 'rules'; rules: readonly RobotsRule[]; sitemaps: readonly string[] }
  | { kind: 'allow_all'; sitemaps: readonly string[] }
  | {
      kind: 'unreachable';
      sitemaps: readonly string[];
      /** Why it could not be read — a fetch error code or `http_<status>` — for the pages it holds back. */
      error?: string;
    };

export interface RobotsRule {
  allow: boolean;
  /** The pattern as written, percent-encoding normalised. */
  pattern: string;
}

/**
 * The policy a robots.txt body sets for `productToken`. `base` resolves a
 * relative `Sitemap:` value (the RFC wants absolute ones; sites write both).
 */
export function parseRobotsTxt(
  text: string,
  base: string | URL,
  productToken: string = CRAWLER_PRODUCT_TOKEN,
): RobotsPolicy {
  const token = productToken.toLowerCase();
  const sitemaps: string[] = [];
  const mine: RobotsRule[] = [];
  const anyone: RobotsRule[] = [];
  let namedMine = false;
  let namedAnyone = false;

  // The group being read: which agents it names, and whether a rule has been
  // seen yet (a `User-agent` line after a rule starts a new group).
  let groupMine = false;
  let groupAnyone = false;
  let inRules = false;

  for (const rawLine of withoutBom(text).split(/\r\n|\r|\n/)) {
    const hash = rawLine.indexOf('#');
    const line = (hash === -1 ? rawLine : rawLine.slice(0, hash)).trim();
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      if (inRules) {
        groupMine = false;
        groupAnyone = false;
        inRules = false;
      }
      const agent = value.toLowerCase();
      if (agent === '*') {
        groupAnyone = true;
        namedAnyone = true;
      } else if (agent === token) {
        groupMine = true;
        namedMine = true;
      }
      continue;
    }
    if (field === 'allow' || field === 'disallow') {
      inRules = true;
      // An empty `Disallow:` disallows nothing; an empty `Allow:` allows
      // nothing extra — neither is a rule.
      if (value === '') continue;
      const rule = { allow: field === 'allow', pattern: normalizeRobotsPath(value) };
      if (groupMine) mine.push(rule);
      if (groupAnyone) anyone.push(rule);
      continue;
    }
    if (field === 'sitemap') {
      if (sitemaps.length >= ROBOTS_MAX_SITEMAPS) continue;
      try {
        const url = new URL(value, base);
        if (url.protocol === 'http:' || url.protocol === 'https:') sitemaps.push(url.href);
      } catch {
        // Not a URL; nothing to read.
      }
      continue;
    }
    // Any other line (`Crawl-delay`, `Host`, …) is outside the RFC and ignored.
  }

  if (namedMine)
    return mine.length > 0
      ? { kind: 'rules', rules: mine, sitemaps }
      : { kind: 'allow_all', sitemaps };
  if (namedAnyone && anyone.length > 0) return { kind: 'rules', rules: anyone, sitemaps };
  return { kind: 'allow_all', sitemaps };
}

/** A text without the byte-order mark an editor may have saved in front of it. */
function withoutBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Whether `url` may be fetched under `policy`. */
export function robotsAllows(policy: RobotsPolicy, url: string | URL): boolean {
  if (policy.kind === 'allow_all') return true;
  if (policy.kind === 'unreachable') return false;
  const parsed = typeof url === 'string' ? new URL(url) : url;
  if (parsed.pathname === '/robots.txt') return true;
  const path = normalizeRobotsPath(`${parsed.pathname}${parsed.search}`);
  let best: RobotsRule | null = null;
  for (const rule of policy.rules) {
    if (!robotsPatternMatches(rule.pattern, path)) continue;
    // "Most specific" is the longest pattern in octets — after normalisation
    // every character is one.
    if (
      best === null ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return best === null || best.allow;
}

/**
 * Whether a robots pattern matches a path from its start. `*` is any run of
 * characters; a `$` at the end anchors it; everything else is literal.
 *
 * Greedy over the literal pieces between `*`s — each taken at its earliest
 * position — which is exact for patterns with no other wildcard, and linear
 * in the path per piece: no backtracking for a hostile file to exploit.
 */
export function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const pieces = body.split('*');
  const first = pieces[0]!;
  if (!path.startsWith(first)) return false;
  if (pieces.length === 1) return anchored ? path.length === first.length : true;

  let at = first.length;
  const last = pieces[pieces.length - 1]!;
  for (let i = 1; i < pieces.length - 1; i += 1) {
    const piece = pieces[i]!;
    if (piece === '') continue;
    const found = path.indexOf(piece, at);
    if (found === -1) return false;
    at = found + piece.length;
  }
  if (!anchored) return last === '' || path.indexOf(last, at) !== -1;
  return path.length - last.length >= at && path.endsWith(last);
}

const UNRESERVED = /^[A-Za-z0-9\-._~]$/;
const HEX_PAIR = /^[0-9A-Fa-f]{2}$/;

/**
 * A path or pattern with its percent-encoding in one form (RFC 3986 §6.2.2):
 * escapes in uppercase, escaped unreserved characters decoded, and characters
 * outside ASCII written as their UTF-8 escapes — so `/yardım`, `/yard%c4%b1m`
 * and `/yard%C4%B1m` are one path.
 */
export function normalizeRobotsPath(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]!;
    if (char === '%' && i + 2 < value.length && HEX_PAIR.test(value.slice(i + 1, i + 3))) {
      const hex = value.slice(i + 1, i + 3).toUpperCase();
      const decoded = String.fromCharCode(Number.parseInt(hex, 16));
      out += UNRESERVED.test(decoded) ? decoded : `%${hex}`;
      i += 2;
      continue;
    }
    const code = char.charCodeAt(0);
    if (code > 0x7e || code < 0x21) {
      // A surrogate pair is one character; encode it whole.
      const whole = code >= 0xd800 && code <= 0xdbff ? value.slice(i, i + 2) : char;
      if (whole.length === 2) i += 1;
      out += encodeURIComponent(whole).toUpperCase();
      continue;
    }
    out += char;
  }
  return out;
}

export interface RobotsCacheOptions {
  now?: () => number;
  ttlMs?: number;
  unreachableTtlMs?: number;
  /** Origins remembered at most; the oldest is forgotten first. */
  maxEntries?: number;
}

interface CacheEntry {
  until: number;
  policy: Promise<RobotsPolicy>;
}

/**
 * Each origin's robots policy, fetched once and kept for a day. Concurrent
 * asks for one origin share one fetch.
 */
export class RobotsCache {
  readonly #fetcher: CrawlFetcher;
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #unreachableTtlMs: number;
  readonly #maxEntries: number;
  readonly #entries = new Map<string, CacheEntry>();

  constructor(fetcher: CrawlFetcher, options: RobotsCacheOptions = {}) {
    this.#fetcher = fetcher;
    this.#now = options.now ?? Date.now;
    this.#ttlMs = options.ttlMs ?? ROBOTS_TTL_MS;
    this.#unreachableTtlMs = options.unreachableTtlMs ?? ROBOTS_UNREACHABLE_TTL_MS;
    this.#maxEntries = options.maxEntries ?? 1000;
  }

  /** The policy for the origin of `url`. */
  policyFor(url: string | URL, signal?: AbortSignal): Promise<RobotsPolicy> {
    const origin = (typeof url === 'string' ? new URL(url) : url).origin;
    const now = this.#now();
    const cached = this.#entries.get(origin);
    if (cached && cached.until > now) return cached.policy;

    const entry: CacheEntry = { until: now + this.#ttlMs, policy: Promise.resolve(UNREACHABLE) };
    entry.policy = this.#load(origin, signal)
      .catch((): RobotsPolicy => UNREACHABLE)
      .then((policy) => {
        // A cancelled job learned nothing about the site; the next one asks again.
        if (policy === null) {
          if (this.#entries.get(origin) === entry) this.#entries.delete(origin);
          return UNREACHABLE;
        }
        if (policy.kind === 'unreachable') entry.until = this.#now() + this.#unreachableTtlMs;
        return policy;
      });
    this.#entries.delete(origin);
    this.#entries.set(origin, entry);
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    return entry.policy;
  }

  /** Whether `url` may be fetched. */
  async allows(url: string | URL, signal?: AbortSignal): Promise<boolean> {
    return robotsAllows(await this.policyFor(url, signal), url);
  }

  async #load(origin: string, signal?: AbortSignal): Promise<RobotsPolicy | null> {
    const robotsUrl = `${origin}/robots.txt`;
    const result = await this.#fetcher.fetch({
      url: robotsUrl,
      purpose: 'robots',
      maxBytes: ROBOTS_MAX_BYTES,
      truncate: true,
      ...(signal ? { signal } : {}),
    });
    if (result.kind === 'ok') return parseRobotsTxt(result.body.toString('utf8'), result.url);
    if (result.kind === 'failed' && result.error === 'cancelled') return null;
    if (result.kind === 'failed') return { kind: 'unreachable', sitemaps: [], error: result.error };
    if (
      result.kind === 'http_error' &&
      result.status >= 400 &&
      result.status < 500 &&
      result.status !== 429
    ) {
      return ALLOW_ALL;
    }
    return {
      kind: 'unreachable',
      sitemaps: [],
      error: result.kind === 'blocked' ? 'bot_wall' : `http_${result.status}`,
    };
  }
}

const ALLOW_ALL: RobotsPolicy = { kind: 'allow_all', sitemaps: [] };
const UNREACHABLE: RobotsPolicy = { kind: 'unreachable', sitemaps: [] };
