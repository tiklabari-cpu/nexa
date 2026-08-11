/**
 * Website rows in a bulk knowledge import (FR-MOD-06.3.2 · NFR-S7 · NFR-S8).
 *
 * The single-source endpoint fetches one admin-supplied URL per request. Bulk
 * import turns that into N fetches from one request, and that is a different
 * thing: a loop the server runs from inside the network, aimed wherever a
 * spreadsheet column points, is a port scanner with an HTTP front door. So this
 * module exists to make the amplification bounded and the failures quiet.
 *
 * Four rules carry it.
 *
 * 1. **The guard runs per row, and it runs first.** `assertPublicHttpUrl` is
 *    the same guard the single-source path uses — reused, not reimplemented —
 *    and a row that fails it never reaches the crawler at all. There is no
 *    "checked the first one, the rest looked similar": every row pays.
 *
 * 2. **One refusal message for every refused URL.** The guard distinguishes a
 *    malformed URL from a loopback address from a link-local one, and saying
 *    which is which is helpful when an admin typed one URL. Across 200 rows it
 *    is an oracle: the difference between "cannot be fetched" and "points at a
 *    private host" maps the network for free. So every refusal returns the same
 *    sentence and the real reason goes to the log.
 *
 * 3. **A shared wall-clock budget, spent sequentially.** Crawls run one at a
 *    time against one deadline for the whole request. When it is gone the
 *    remaining website rows are refused without a fetch, so a file cannot buy
 *    more outbound requests by making each one slow.
 *
 * 4. **No database handle anywhere in here.** This module takes a URL and a
 *    crawler and returns text. It cannot open, join or hold a transaction
 *    because it is never given one — which is how the "crawl outside the
 *    transaction" discipline of the single-source path (`routes/playbook.ts`)
 *    survives being put in a loop, rather than depending on the loop being
 *    written carefully.
 */
import { neutraliseFormula } from '../../lib/csv-import.js';
import { assertPublicHttpUrl } from '../../lib/ssrf.js';
import { crawl } from './web-crawler.js';

/** The amplification budget one bulk request gets. */
export interface BulkCrawlLimits {
  /** Website rows one file may ask for. Over it, the file is refused whole. */
  readonly maxWebsiteRows: number;
  /** Wall-clock milliseconds every crawl in one request shares. */
  readonly totalBudgetMs: number;
}

/** Fetch and parse one page. Injectable so a test can watch what was called. */
export type PageCrawler = (url: URL) => Promise<{ text: string }>;

export type BulkCrawlRefusalReason =
  /** The URL did not pass the SSRF guard, or is not a URL at all. */
  | 'url_refused'
  /** The guard passed; fetching or parsing the page did not. */
  | 'crawl_failed'
  /** The request's shared crawl time was gone before (or during) this row. */
  | 'budget_exhausted';

export interface BulkCrawlRefusal {
  readonly ok: false;
  readonly reason: BulkCrawlRefusalReason;
  /** Safe to return over HTTP: names no host, address, scheme or network. */
  readonly message: string;
  /** The real reason, for the server log only — never sent to a client. */
  readonly detail: string;
}

export type BulkUrlCheck = { readonly ok: true; readonly url: string } | BulkCrawlRefusal;

export type BulkCrawlOutcome =
  { readonly ok: true; readonly url: string; readonly content: string } | BulkCrawlRefusal;

/**
 * The three sentences a website row can be refused with, phrased so that
 * knowing which one came back tells an attacker nothing about the target. They
 * open with the field name so a row's verdict reads like every other row's
 * verdict in the results table (`type: …`, `content: …`).
 */
const REFUSED_MESSAGE = 'source_url: this URL cannot be fetched.';
const FAILED_MESSAGE = 'source_url: this URL could not be read.';
const BUDGET_MESSAGE =
  'source_url: this import ran out of crawl time; import the remaining website rows in a second file.';

function refuse(reason: BulkCrawlRefusalReason, detail: string): BulkCrawlRefusal {
  const message =
    reason === 'url_refused'
      ? REFUSED_MESSAGE
      : reason === 'crawl_failed'
        ? FAILED_MESSAGE
        : BUDGET_MESSAGE;
  return { ok: false, reason, message, detail };
}

/**
 * Run one row's URL past the SSRF guard without fetching anything.
 *
 * This is what a dry run uses. A preview that crawled would be a way to probe
 * hosts N times over with nothing written and nothing to show for it, and the
 * verdict admins actually need from a preview — "is this URL one we will
 * accept?" — is decided by the guard, before any fetch, so withholding the
 * fetch costs the preview nothing.
 */
export function checkWebsiteUrl(raw: string): BulkUrlCheck {
  try {
    return { ok: true, url: assertPublicHttpUrl(raw).toString() };
  } catch (error) {
    return refuse('url_refused', error instanceof Error ? error.message : String(error));
  }
}

/**
 * One request's crawl budget.
 *
 * Constructed per request, right before the import loop, so the deadline covers
 * exactly the rows of one file. Calls must not overlap — `crawl` throws if they
 * do, because "sequential" is the property that keeps the budget meaningful and
 * a future caller reaching for `Promise.all` should fail loudly rather than
 * silently turn one request into N simultaneous outbound connections.
 */
export class BulkWebsiteCrawler {
  readonly #crawl: PageCrawler;
  readonly #deadline: number;
  #inFlight = false;

  /**
   * The clock starts here, not on the first crawl: the budget belongs to the
   * request, and time the caller spends validating rows between fetches is time
   * the file has spent.
   */
  constructor(limits: BulkCrawlLimits, crawler: PageCrawler = crawl) {
    this.#crawl = crawler;
    this.#deadline = Date.now() + limits.totalBudgetMs;
  }

  /** Milliseconds left in the shared budget; never negative. */
  get remainingMs(): number {
    return Math.max(0, this.#deadline - Date.now());
  }

  /**
   * Guard, then fetch, then neutralise — in that order, with the budget
   * enforced on both sides of the fetch.
   *
   * The crawled text goes through the same formula guard `parseCsv` applies to
   * a pasted cell. The page is not a CSV cell, but the text is on its way into
   * a knowledge source that the 07.7 report export can put back into a CSV
   * later, and a page whose first characters are `=cmd|…` would arrive in a
   * spreadsheet live. Neutralising on the way in is the only place that covers
   * both readers.
   */
  async crawl(raw: string): Promise<BulkCrawlOutcome> {
    if (this.#inFlight) {
      throw new Error('BulkWebsiteCrawler.crawl: crawls must run one at a time');
    }

    const checked = checkWebsiteUrl(raw);
    if (!checked.ok) return checked;

    // Checked before the fetch as well as after: an exhausted budget must not
    // buy one more outbound request just because a row happens to be next.
    const budget = this.remainingMs;
    if (budget <= 0) return refuse('budget_exhausted', 'crawl budget exhausted before this row');

    this.#inFlight = true;
    try {
      const settled = await raceDeadline(this.#crawl(new URL(checked.url)), budget);
      if (settled.state === 'expired') {
        return refuse('budget_exhausted', `crawl exceeded the remaining ${budget}ms of the budget`);
      }
      if (settled.state === 'rejected') {
        return refuse(
          'crawl_failed',
          settled.error instanceof Error ? settled.error.message : String(settled.error),
        );
      }
      return { ok: true, url: checked.url, content: neutraliseFormula(settled.value.text) };
    } finally {
      this.#inFlight = false;
    }
  }
}

type Settled<T> =
  { state: 'fulfilled'; value: T } | { state: 'rejected'; error: unknown } | { state: 'expired' };

/**
 * Await `work` for at most `ms`, reporting the outcome instead of throwing.
 *
 * `work` is wrapped before the race so that a fetch which loses the race and
 * *then* fails cannot surface as an unhandled rejection — the timeout does not
 * cancel the work, it only stops waiting for it.
 */
async function raceDeadline<T>(work: Promise<T>, ms: number): Promise<Settled<T>> {
  const settled: Promise<Settled<T>> = work.then(
    (value) => ({ state: 'fulfilled', value }) as const,
    (error: unknown) => ({ state: 'rejected', error }) as const,
  );

  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<Settled<T>>((resolve) => {
    timer = setTimeout(() => resolve({ state: 'expired' }), ms);
    // The request should never be held open by this timer alone.
    timer.unref?.();
  });

  try {
    return await Promise.race([settled, expiry]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
