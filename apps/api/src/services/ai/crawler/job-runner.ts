/**
 * The knowledge job runner (tm 312.3 · SiyahTuş analysis AI-17): crawls a
 * website source in the background, page by page, from the queue
 * `jobs.ts` keeps — never inside the request that asked for it.
 *
 *   1. **Finding work.** A claim pass every {@link KNOWLEDGE_JOB_POLL_MS},
 *      and whenever the route that queued a job asks ({@link
 *      KnowledgeJobWorker.wake}) or a job of this worker ends. At most
 *      {@link KNOWLEDGE_JOB_CONCURRENCY} jobs at once in a process (the
 *      global limit is that times the processes); `knowledge_jobs_claim`
 *      hands out one job per workspace at a time, across every process, and
 *      never the same job to two runners (`FOR UPDATE SKIP LOCKED`).
 *   2. **Where the pages come from.** The site's robots.txt first (cached a
 *      day, `robots.ts`); then, by the source's `crawl_scope`: `single` —
 *      the URL alone; `sitemap` — what its sitemaps list (`sitemap.ts`), the
 *      URL alone when it has none; `all` — the sitemap's pages, or without
 *      one the links followed breadth-first to depth 3 (`frontier.ts`).
 *      Always within the scope, the path lists, robots.txt and the page
 *      limit — the source's, and what is left of the workspace's 2,000.
 *   3. **Each page** is fetched through the configured fetcher
 *      (`CRAWLER_PROVIDER`; the real one re-checks SSRF on every hop and
 *      refuses a redirect off the scope before asking), read
 *      (`extract.ts`) and hashed. **Only a page whose text changed is
 *      embedded** — the same hash is `unchanged` and costs nothing; a changed
 *      page's chunks are replaced in one short transaction, its own and no
 *      other page's. A 404/410 counts a miss: the second in a row makes the
 *      page `removed` and deletes its chunks; any other failure keeps the
 *      chunks the page had (a stale answer, not none — the freshness sweep's
 *      rule). A page past the end of a finished crawl's scope is `removed`.
 *   4. **Durable.** Each page is written with the job's counters and
 *      frontier, fenced by the claim, so a runner that dies is taken over
 *      where it stopped (the lease runs out, the next claim restores the
 *      frontier and skips the pages this job already wrote).
 *   5. **The day's AI allowance.** An embedding today's cap refuses parks
 *      the job `waiting_budget` until the next UTC midnight with that page
 *      back at the head of its frontier; the pages indexed so far answer
 *      meanwhile. A workspace whose residency the embedding provider would
 *      break (NFR-C4) is not crawled at all.
 *   6. **The end.** The source is `ready` (every page it keeps answers),
 *      `partial` (some failed) or `failed` (none answers), with its
 *      `page_count`, `last_crawled_at` and next refresh.
 *   7. **Shutdown.** {@link KnowledgeJobWorker.stop}: no new claims; the jobs
 *      in flight stop after their page within {@link KNOWLEDGE_JOB_DRAIN_MS}
 *      and are handed back `queued` with their frontier.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  KNOWLEDGE_CRAWL_LIMITS,
  KNOWLEDGE_PAGE_INDEXED_STATUSES,
  KNOWLEDGE_PAGE_LIMIT,
  type KnowledgePageStatus,
} from '@siyahtus/types';
import { type TenantClient, type TenantContext, withTenant } from '../../../lib/tenant.js';
import { AiDailyCapError, nextUtcMidnight } from '../ai-daily-budget.js';
import { inferenceAllowed, readInferenceResidency, type InferenceProvider } from '../inference.js';
import { computeNextRefreshAt } from '../knowledge-refresh.js';
import type { KnowledgeService, PreparedChunks } from '../knowledge-service.js';
import { EmbeddingProviderError } from '../provider/embedding-error.js';
import { decodeHtmlBytes, extractPage, PageExtractError } from './extract.js';
import type { CrawlFetcher } from './fetcher.js';
import {
  createCrawlScope,
  CrawlFrontier,
  normalizeCrawlUrl,
  sha256Hex,
  type CrawlScope,
  type FrontierEntry,
  type FrontierPage,
} from './frontier.js';
import {
  claimKnowledgeJob,
  endJobClaim,
  extendJobLease,
  jobFence,
  KNOWLEDGE_JOB_LEASE_MS,
  KNOWLEDGE_JOB_MAX_ATTEMPTS,
  releaseJobClaim,
  type JobEnd,
  type KnowledgeJobClaim,
  type KnowledgeJobCounts,
} from './jobs.js';
import { RobotsCache, robotsAllows, type RobotsPolicy } from './robots.js';
import { discoverSitemapUrls } from './sitemap.js';

/** How often a runner looks for due jobs unasked. A crawl is not a visitor waiting. */
export const KNOWLEDGE_JOB_POLL_MS = 15_000;
/** Jobs one process crawls at once — each mostly waiting on a site's politeness gap. */
export const KNOWLEDGE_JOB_CONCURRENCY = 2;
/** How long {@link KnowledgeJobWorker.stop} waits for the pages in flight. */
export const KNOWLEDGE_JOB_DRAIN_MS = 10_000;

/** `last_refresh_error` for a crawl the residency rule refused. */
export const CRAWL_REFUSED_RESIDENCY =
  'Not crawled: this workspace is covered by a signed HIPAA agreement and the embedding provider runs outside its region.';
/** `last_refresh_error` for a crawl that kept no page. */
export const CRAWL_NO_PAGE =
  'Not crawled: no page of the site could be read. The pages table says why for each.';

/** The logger a job's lines go to; a Fastify or pino logger is one. */
export interface KnowledgeJobLogger {
  child(bindings: Record<string, unknown>): KnowledgeJobLogger;
  info(object: Record<string, unknown>, message: string): void;
  warn(object: Record<string, unknown>, message: string): void;
  error(object: Record<string, unknown>, message: string): void;
}

export interface KnowledgeJobWorkerOptions {
  db: PrismaClient;
  logger: KnowledgeJobLogger;
  /** Who fetches pages — `createCrawlFetcher(env.CRAWLER_PROVIDER)`, or a test's mock site. */
  fetcher: CrawlFetcher;
  /** Embeds changed pages, metered against the workspace's daily AI allowance. */
  knowledge: Pick<KnowledgeService, 'prepare'>;
  /** Where the embedding provider runs, as the NFR-C4 gate reads it. */
  embeddingInference: () => InferenceProvider;
  /** How often to look unasked; null — only when woken (a test server's). */
  pollMs?: number | null;
  leaseMs?: number;
  maxAttempts?: number;
  concurrency?: number;
  drainMs?: number;
  /** robots.txt per origin; one per worker unless a test brings its own. */
  robots?: RobotsCache;
  /** The clock a crawl stamps its pages with — tests move it past midnight. */
  now?: () => Date;
}

interface InFlight {
  claim: KnowledgeJobClaim;
  stopping: { value: boolean };
  abort: AbortController;
  done: Promise<void>;
}

/** The claim lost its job mid-write: the transaction rolls back, the crawl stops. */
class LostClaim extends Error {
  constructor() {
    super('the knowledge job is no longer this claim’s');
    this.name = 'LostClaim';
  }
}

export class KnowledgeJobWorker {
  readonly #db: PrismaClient;
  readonly #log: KnowledgeJobLogger;
  readonly #pollMs: number | null;
  readonly #leaseMs: number;
  readonly #maxAttempts: number;
  readonly #concurrency: number;
  readonly #drainMs: number;
  readonly #crawler: KnowledgeCrawler;

  #started = false;
  #stopping = false;
  #timer: NodeJS.Timeout | null = null;
  #pass: Promise<void> | null = null;
  #again = false;
  #claimFailing = false;
  readonly #inFlight = new Map<string, InFlight>();

  constructor(options: KnowledgeJobWorkerOptions) {
    this.#db = options.db;
    this.#log = options.logger;
    this.#pollMs = options.pollMs === undefined ? KNOWLEDGE_JOB_POLL_MS : options.pollMs;
    this.#leaseMs = options.leaseMs ?? KNOWLEDGE_JOB_LEASE_MS;
    this.#maxAttempts = options.maxAttempts ?? KNOWLEDGE_JOB_MAX_ATTEMPTS;
    this.#concurrency = options.concurrency ?? KNOWLEDGE_JOB_CONCURRENCY;
    this.#drainMs = options.drainMs ?? KNOWLEDGE_JOB_DRAIN_MS;
    this.#crawler = new KnowledgeCrawler({
      db: options.db,
      fetcher: options.fetcher,
      knowledge: options.knowledge,
      embeddingInference: options.embeddingInference,
      robots: options.robots ?? new RobotsCache(options.fetcher),
      leaseMs: this.#leaseMs,
      now: options.now ?? (() => new Date()),
    });
  }

  /** Begin taking jobs. Once per worker. */
  start(): void {
    if (this.#started) throw new Error('KnowledgeJobWorker: start() once per worker');
    this.#started = true;
    if (this.#pollMs !== null) {
      this.#timer = setInterval(() => this.wake(), this.#pollMs);
      this.#timer.unref();
      this.wake();
    }
  }

  /** Jobs this worker is crawling right now. */
  get inFlight(): number {
    return this.#inFlight.size;
  }

  /** Drop the fetch in flight of a job this worker is crawling — it was cancelled. */
  abort(jobId: string): void {
    for (const job of this.#inFlight.values()) {
      if (job.claim.id === jobId) job.abort.abort();
    }
  }

  /** Look for due jobs now. Concurrent calls fold into one pass. */
  wake(): void {
    if (!this.#started || this.#stopping) return;
    if (this.#pass) {
      this.#again = true;
      return;
    }
    this.#pass = this.#claimPass().finally(() => {
      this.#pass = null;
      if (this.#again) {
        this.#again = false;
        this.wake();
      }
    });
  }

  /**
   * Resolves once nothing is in flight and no pass is under way — "what was
   * queued and due so far has been crawled". For tests and scripts.
   */
  async idle(): Promise<void> {
    while (this.#pass || this.#inFlight.size > 0) {
      await this.#pass;
      await Promise.all([...this.#inFlight.values()].map((job) => job.done));
    }
  }

  /** Stop: no new claims; the jobs in flight get `drainMs` to finish their page, then go back to the queue. */
  async stop(options: { drainMs?: number } = {}): Promise<void> {
    if (!this.#started || this.#stopping) return;
    this.#stopping = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#pass;
    if (this.#inFlight.size === 0) return;
    for (const job of this.#inFlight.values()) job.stopping.value = true;
    const drainMs = options.drainMs ?? this.#drainMs;
    let timer: NodeJS.Timeout | undefined;
    const finished = await Promise.race([
      Promise.all([...this.#inFlight.values()].map((job) => job.done)).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), drainMs);
        timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (finished) return;
    const left = [...this.#inFlight.values()];
    this.#log.warn(
      { in_flight: left.length, drain_ms: drainMs },
      'knowledge jobs still crawling at shutdown; handing them back',
    );
    for (const job of left) job.abort.abort();
    await Promise.all(
      left.map(({ claim }) =>
        releaseJobClaim(this.#db, claim).catch((error: unknown) =>
          this.#log.warn(
            { err: error, job_id: claim.id },
            'knowledge job could not be handed back; its lease will free it',
          ),
        ),
      ),
    );
  }

  /** One claim pass. Never rejects: a failing claim is retried by the next poll. */
  async #claimPass(): Promise<void> {
    while (this.#inFlight.size < this.#concurrency && !this.#stopping) {
      let claim: KnowledgeJobClaim | null;
      try {
        claim = await claimKnowledgeJob(this.#db, {
          leaseMs: this.#leaseMs,
          maxAttempts: this.#maxAttempts,
        });
      } catch (error) {
        if (!this.#claimFailing) {
          this.#claimFailing = true;
          this.#log.error(
            { err: error },
            'knowledge jobs could not be claimed; retrying every poll',
          );
        }
        return;
      }
      if (this.#claimFailing) {
        this.#claimFailing = false;
        this.#log.info({}, 'knowledge jobs can be claimed again');
      }
      if (claim === null) return;
      this.#launch(claim);
    }
  }

  #launch(claim: KnowledgeJobClaim): void {
    const stopping = { value: false };
    const abort = new AbortController();
    const key = `${claim.id}:${claim.attempts}`;
    const log = this.#log.child({
      license_id: String(claim.context.licenseId),
      organization_id: claim.context.organizationId,
      job_id: claim.id,
      source_id: claim.sourceId,
      attempt: claim.attempts,
    });
    const beat = setInterval(
      () => {
        void extendJobLease(this.#db, claim, this.#leaseMs)
          .then((held) => {
            if (!held) abort.abort();
          })
          .catch((error: unknown) => log.warn({ err: error }, 'knowledge job lease not extended'));
      },
      Math.max(1_000, Math.floor(this.#leaseMs / 3)),
    );
    beat.unref();
    const done = this.#crawler
      .run(claim, { stopping, signal: abort.signal, log })
      .catch((error: unknown) => {
        log.error({ err: error }, 'knowledge job stopped on an error');
        return endWith(this.#db, claim, { status: 'failed', error: 'internal' }).catch(() => {});
      })
      .finally(() => {
        clearInterval(beat);
        this.#inFlight.delete(key);
        this.wake();
      })
      .then(() => undefined);
    this.#inFlight.set(key, { claim, stopping, abort, done });
  }
}

/** End a claim and, when the job ended for good, say on its source what the crawl left. */
async function endWith(db: PrismaClient, claim: KnowledgeJobClaim, end: JobEnd): Promise<void> {
  await withTenant(db, claim.context, async (tx) => {
    const ended = await endJobClaim(tx, claim, end);
    if (ended && (end.status === 'done' || end.status === 'failed')) {
      await settleCrawledSource(tx, claim.sourceId, new Date());
    }
  });
}

interface CrawlerOptions {
  db: PrismaClient;
  fetcher: CrawlFetcher;
  knowledge: Pick<KnowledgeService, 'prepare'>;
  embeddingInference: () => InferenceProvider;
  robots: RobotsCache;
  leaseMs: number;
  now: () => Date;
}

interface ClaimedJob {
  status: string;
  frontier: unknown;
  startedAt: Date | null;
  counts: KnowledgeJobCounts;
}

interface StoredPage {
  id: string;
  url: string;
  status: string;
  contentHash: string | null;
  missCount: number;
  chunkCount: number;
  depth: number;
}

/** What one page came to — a status, and what to write for it. */
type PageOutcome =
  | {
      kind: 'indexed';
      title: string | null;
      lang: string | null;
      /** The text embedded — the source keeps its start page's as `content`. */
      body: string;
      hash: string;
      prepared: PreparedChunks;
      httpStatus: number;
    }
  | { kind: 'unchanged'; title: string | null; lang: string | null; httpStatus: number }
  | {
      kind: 'other';
      status: Exclude<KnowledgePageStatus, 'ok' | 'unchanged'>;
      error: string | null;
      httpStatus: number | null;
      /** Delete the chunks the page had. */
      dropChunks: boolean;
      title?: string | null;
      lang?: string | null;
    }
  | { kind: 'miss'; httpStatus: number };

/** Which counter a page's status moves. */
function counterFor(
  status: KnowledgePageStatus,
): Exclude<keyof KnowledgeJobCounts, 'bytesFetched' | 'pagesDone' | 'pagesDiscovered'> {
  switch (status) {
    case 'ok':
      return 'pagesOk';
    case 'unchanged':
      return 'pagesUnchanged';
    case 'skipped_scope':
    case 'robots_disallowed':
      return 'pagesSkipped';
    case 'removed':
      return 'pagesRemoved';
    default:
      return 'pagesFailed';
  }
}

/** The text a page is embedded (and hashed) as: its title on top, when its text does not already open with it. */
function pageBody(title: string | null, text: string): string {
  if (!title || text.startsWith(`# ${title}`)) return text;
  return `# ${title}\n\n${text}`;
}

/** Plays one claim of one job. */
export class KnowledgeCrawler {
  readonly #db: PrismaClient;
  readonly #fetcher: CrawlFetcher;
  readonly #knowledge: Pick<KnowledgeService, 'prepare'>;
  readonly #embeddingInference: () => InferenceProvider;
  readonly #robots: RobotsCache;
  readonly #leaseMs: number;
  readonly #now: () => Date;

  constructor(options: CrawlerOptions) {
    this.#db = options.db;
    this.#fetcher = options.fetcher;
    this.#knowledge = options.knowledge;
    this.#embeddingInference = options.embeddingInference;
    this.#robots = options.robots;
    this.#leaseMs = options.leaseMs;
    this.#now = options.now;
  }

  async run(
    claim: KnowledgeJobClaim,
    run: { stopping: { value: boolean }; signal: AbortSignal; log: KnowledgeJobLogger },
  ): Promise<void> {
    const context = claim.context;
    const read = await withTenant(
      this.#db,
      context,
      async (tx) => {
        const job = await tx.knowledgeJob.findFirst({
          where: jobFence(claim),
          select: {
            status: true,
            frontier: true,
            startedAt: true,
            pagesDiscovered: true,
            pagesDone: true,
            pagesOk: true,
            pagesUnchanged: true,
            pagesSkipped: true,
            pagesFailed: true,
            pagesRemoved: true,
            bytesFetched: true,
          },
        });
        const source = await tx.knowledgeSource.findFirst({
          where: { id: claim.sourceId },
          select: {
            type: true,
            sourceUrl: true,
            crawlScope: true,
            pageLimit: true,
            includePaths: true,
            excludePaths: true,
          },
        });
        // The workspace's other website sources' pages (AI-17-S2: 2,000 together).
        const others = await tx.knowledgeSource.aggregate({
          where: { type: 'website', id: { not: claim.sourceId } },
          _sum: { pageCount: true },
        });
        const residency = await readInferenceResidency(tx, context);
        return { job, source, otherPages: others._sum.pageCount ?? 0, residency };
      },
      { readOnly: true },
    );
    if (!read.job) return;
    const {
      pagesDiscovered,
      pagesDone,
      pagesOk,
      pagesUnchanged,
      pagesSkipped,
      pagesFailed,
      pagesRemoved,
      bytesFetched,
    } = read.job;
    const job: ClaimedJob = {
      status: read.job.status,
      frontier: read.job.frontier,
      startedAt: read.job.startedAt,
      counts: {
        pagesDiscovered,
        pagesDone,
        pagesOk,
        pagesUnchanged,
        pagesSkipped,
        pagesFailed,
        pagesRemoved,
        bytesFetched,
      },
    };

    if (claim.kind === 'document') {
      // A PDF or Word document (tm 313 · AI-18) is read by the document
      // worker, which arrives with its job branch (tm 313.2–313.3). Until
      // then the job ends `unsupported_kind` and its source `failed` — not
      // through `settleCrawledSource`, whose page counts and crawl dates are
      // a website's.
      await withTenant(this.#db, claim.context, async (tx) => {
        if (await endJobClaim(tx, claim, { status: 'failed', error: 'unsupported_kind' })) {
          await tx.knowledgeSource.updateMany({
            where: { id: claim.sourceId, status: 'processing' },
            data: { status: 'failed' },
          });
        }
      });
      return;
    }
    const source = read.source;
    if (!source || source.type !== 'website' || !source.sourceUrl) {
      await endWith(this.#db, claim, { status: 'failed', error: 'not_website' });
      return;
    }
    const allowed =
      read.residency !== null &&
      inferenceAllowed({
        provider: this.#embeddingInference(),
        workspaceRegion: read.residency.region,
        hipaaScope: read.residency.hipaaScope,
      });
    if (!allowed) {
      await withTenant(this.#db, context, async (tx) => {
        if (!(await endJobClaim(tx, claim, { status: 'failed', error: 'residency_refused' }))) {
          return;
        }
        await settleCrawledSource(tx, claim.sourceId, this.#now(), CRAWL_REFUSED_RESIDENCY);
      });
      return;
    }

    let scope: CrawlScope;
    try {
      scope = createCrawlScope({
        rootUrl: source.sourceUrl,
        include: source.includePaths,
        exclude: source.excludePaths,
      });
    } catch {
      await endWith(this.#db, claim, { status: 'failed', error: 'invalid_url' });
      return;
    }
    const crawlScope = source.crawlScope ?? 'single';
    const pageLimit = Math.min(
      source.pageLimit ?? KNOWLEDGE_PAGE_LIMIT.default,
      KNOWLEDGE_CRAWL_LIMITS.pagesPerWorkspace - read.otherPages,
    );
    if (pageLimit < 1) {
      await endWith(this.#db, claim, { status: 'failed', error: 'workspace_page_limit' });
      return;
    }

    await new CrawlPass(this, claim, run, {
      job,
      scope,
      crawlScope,
      pageLimit,
    }).run();
  }

  // The pass's collaborators, for `CrawlPass` alone.
  get db(): PrismaClient {
    return this.#db;
  }
  get fetcher(): CrawlFetcher {
    return this.#fetcher;
  }
  get knowledge(): Pick<KnowledgeService, 'prepare'> {
    return this.#knowledge;
  }
  get robots(): RobotsCache {
    return this.#robots;
  }
  get leaseMs(): number {
    return this.#leaseMs;
  }
  now(): Date {
    return this.#now();
  }
}

/** One claim's walk through its frontier. */
class CrawlPass {
  readonly #crawler: KnowledgeCrawler;
  readonly #claim: KnowledgeJobClaim;
  readonly #context: TenantContext;
  readonly #run: { stopping: { value: boolean }; signal: AbortSignal; log: KnowledgeJobLogger };
  readonly #scope: CrawlScope;
  readonly #crawlScope: string;
  readonly #pageLimit: number;
  readonly #job: ClaimedJob;
  readonly #counts: KnowledgeJobCounts;
  #legacyCleared = false;

  constructor(
    crawler: KnowledgeCrawler,
    claim: KnowledgeJobClaim,
    run: { stopping: { value: boolean }; signal: AbortSignal; log: KnowledgeJobLogger },
    settings: { job: ClaimedJob; scope: CrawlScope; crawlScope: string; pageLimit: number },
  ) {
    this.#crawler = crawler;
    this.#claim = claim;
    this.#context = claim.context;
    this.#run = run;
    this.#scope = settings.scope;
    this.#crawlScope = settings.crawlScope;
    this.#pageLimit = settings.pageLimit;
    this.#job = settings.job;
    this.#counts = { ...settings.job.counts };
  }

  get #db(): PrismaClient {
    return this.#crawler.db;
  }

  async run(): Promise<void> {
    const signal = this.#run.signal;
    const policy = await this.#crawler.robots.policyFor(this.#scope.root.url, signal);
    const stored = await this.#storedPages();
    const frontier = await this.#frontier(policy);
    if (frontier === null) return;

    for (;;) {
      if (signal.aborted) return;
      const page = frontier.next();
      if (!page) break;

      if (this.#run.stopping.value) {
        // Handed back with this page at the head, for the next claim.
        await this.#park(frontier, page, { status: 'queued' });
        return;
      }
      if (this.#counts.bytesFetched >= BigInt(KNOWLEDGE_CRAWL_LIMITS.jobBytes)) {
        await this.#finish(stored, 'job_bytes_limit');
        return;
      }

      let outcome: PageOutcome;
      let identity: FrontierPage = page;
      if (policy.kind === 'unreachable') {
        // No robots.txt to read is no permission (RFC 9309 §2.3.1.4): the page
        // is not fetched, and says why the file could not be read.
        outcome = {
          kind: 'other',
          status: 'error',
          error: policy.error ?? 'robots_unreachable',
          httpStatus: null,
          dropChunks: false,
        };
      } else if (!robotsAllows(policy, page.url)) {
        outcome = {
          kind: 'other',
          status: 'robots_disallowed',
          error: null,
          httpStatus: null,
          dropChunks: true,
        };
      } else {
        const fetched = await this.#fetchPage(page);
        if (fetched === 'stop') return;
        if (fetched.kind === 'read') {
          const adopted = frontier.adoptCanonical(page, fetched.canonical);
          // Already recorded under its canonical name: not a page of its own.
          if (adopted.duplicate) continue;
          identity = adopted.page;
          if (this.#linkMode && !fetched.nofollow && page.depth < frontier.maxDepth) {
            for (const link of fetched.links) frontier.add(link, page.depth + 1, page.url);
            this.#counts.pagesDiscovered = frontier.admitted;
          }
          const embedded = await this.#embed(identity, fetched, stored);
          if (embedded === 'capped') {
            await this.#park(frontier, page, {
              status: 'waiting_budget',
              availableAt: nextUtcMidnight(this.#crawler.now()),
            });
            this.#run.log.info({}, 'knowledge job waiting for the daily AI allowance');
            return;
          }
          if (embedded === 'unavailable') {
            await this.#finish(stored, 'embedding_unavailable', true);
            return;
          }
          outcome = embedded;
        } else {
          outcome = fetched.outcome;
        }
      }

      const written = await this.#write(identity, outcome, stored, frontier);
      if (!written) return;
    }

    await this.#finish(stored, null);
  }

  /** Set with the frontier: `all` follows links only when the site has no sitemap. */
  #linkMode = false;
  /** The identities this job already wrote a page for (a resumed job's). */
  #doneKeys: string[] = [];
  /** Whether a page this job wrote sits deeper than the start — it was following links. */
  #wroteDeeper = false;

  async #storedPages(): Promise<Map<string, StoredPage>> {
    const rows = await withTenant(
      this.#db,
      this.#context,
      (tx) =>
        tx.knowledgePage.findMany({
          where: { sourceId: this.#claim.sourceId },
          select: {
            id: true,
            url: true,
            urlHash: true,
            status: true,
            contentHash: true,
            missCount: true,
            chunkCount: true,
            depth: true,
            updatedAt: true,
          },
        }),
      { readOnly: true },
    );
    const pages = new Map<string, StoredPage>();
    for (const row of rows) pages.set(row.urlHash, row);
    const startedAt = this.#job.startedAt;
    if (this.#resuming && startedAt !== null) {
      // Written since the job first started: this job's — not fetched again.
      const mine = rows.filter((row) => row.updatedAt >= startedAt);
      this.#doneKeys = mine
        .map((row) => normalizeCrawlUrl(row.url)?.key)
        .filter((key): key is string => key !== undefined);
      this.#wroteDeeper = mine.some((row) => row.depth > 0);
    }
    return pages;
  }

  /**
   * A job that has already written a page goes on from its frontier; one
   * that has not starts over — reading the sitemap again costs less than
   * guessing what it had found.
   */
  get #resuming(): boolean {
    return this.#job.counts.pagesDone > 0;
  }

  /** The frontier: restored for a job that already began, discovered for a new one. Null: the claim was lost. */
  async #frontier(policy: RobotsPolicy): Promise<CrawlFrontier | null> {
    const options = { scope: this.#scope, pageLimit: this.#pageLimit };
    if (this.#resuming) {
      // A sitemap's pages all sit at depth 0; a link-following crawl went deeper.
      const saved = Array.isArray(this.#job.frontier) ? (this.#job.frontier as unknown[]) : [];
      this.#linkMode =
        this.#crawlScope === 'all' &&
        (this.#wroteDeeper ||
          saved.some((entry) => (entry as Partial<FrontierEntry> | null)?.depth !== 0));
      return CrawlFrontier.restore(options, this.#job.frontier, this.#doneKeys);
    }

    const frontier = new CrawlFrontier(options);
    if (this.#crawlScope === 'single') {
      frontier.add(this.#scope.root.url, 0);
    } else {
      const discovery = await discoverSitemapUrls({
        fetcher: this.#crawler.fetcher,
        scope: this.#scope,
        declared: policy.sitemaps,
        want: this.#pageLimit,
        signal: this.#run.signal,
      });
      this.#counts.bytesFetched += BigInt(discovery.bytes);
      for (const url of discovery.urls) frontier.add(url, 0);
      // `all` without a sitemap follows links from the start URL; `sitemap`
      // without one reads the start URL alone, rather than nothing.
      if (frontier.admitted === 0) {
        frontier.add(this.#scope.root.url, 0);
        this.#linkMode = this.#crawlScope === 'all';
      }
    }
    this.#counts.pagesDiscovered = frontier.admitted;
    const saved = await withTenant(this.#db, this.#context, (tx) =>
      this.#progress(tx, frontier.toJSON()),
    );
    return saved ? frontier : null;
  }

  /** The job's counters, frontier and lease, fenced. */
  async #progress(tx: TenantClient, frontier: FrontierEntry[]): Promise<boolean> {
    const { count } = await tx.knowledgeJob.updateMany({
      where: jobFence(this.#claim),
      data: {
        ...this.#counts,
        frontier: frontier as unknown as Prisma.InputJsonValue,
        leaseUntil: new Date(Date.now() + this.#crawler.leaseMs),
      },
    });
    return count > 0;
  }

  /** Fetch and read a page; `stop` when the job was cancelled under it. */
  async #fetchPage(page: FrontierPage): Promise<
    | 'stop'
    | { kind: 'outcome'; outcome: PageOutcome }
    | {
        kind: 'read';
        title: string | null;
        lang: string | null;
        text: string;
        canonical: string | null;
        links: string[];
        nofollow: boolean;
        httpStatus: number;
      }
  > {
    const jobBytesLeft = KNOWLEDGE_CRAWL_LIMITS.jobBytes - Number(this.#counts.bytesFetched);
    const result = await this.#crawler.fetcher.fetch({
      url: page.url,
      purpose: 'page',
      allowRedirect: (next) => this.#scope.check(next) === 'in',
      maxBytes: Math.max(1, Math.min(KNOWLEDGE_CRAWL_LIMITS.pageBytes, jobBytesLeft)),
      signal: this.#run.signal,
    });
    this.#counts.bytesFetched += BigInt(result.bytes);
    const other = (
      status: Exclude<KnowledgePageStatus, 'ok' | 'unchanged'>,
      error: string | null,
      httpStatus: number | null,
      dropChunks = false,
    ) => ({
      kind: 'outcome' as const,
      outcome: { kind: 'other' as const, status, error, httpStatus, dropChunks },
    });

    switch (result.kind) {
      case 'failed':
        if (result.error === 'cancelled') return 'stop';
        if (result.error === 'redirect_out_of_scope') {
          return other('skipped_scope', result.error, result.status ?? null, true);
        }
        return other('error', result.error, result.status ?? null);
      case 'blocked':
        return other('blocked', 'bot_wall', result.status);
      case 'http_error':
        if (result.status === 404 || result.status === 410) {
          return { kind: 'outcome', outcome: { kind: 'miss', httpStatus: result.status } };
        }
        return other('error', `http_${result.status}`, result.status);
      case 'ok': {
        let extracted;
        try {
          extracted = extractPage(decodeHtmlBytes(result.body, result.contentType), result.url);
        } catch (error) {
          if (error instanceof PageExtractError) return other('error', error.code, result.status);
          throw error;
        }
        if (extracted.noindex) {
          // The page's own robots meta: never indexed, what it had goes.
          return other('robots_disallowed', 'noindex', result.status, true);
        }
        if (extracted.needsJs) {
          return {
            kind: 'outcome',
            outcome: {
              kind: 'other',
              status: 'needs_js',
              error: null,
              httpStatus: result.status,
              dropChunks: true,
              title: extracted.title,
              lang: extracted.lang,
            },
          };
        }
        return {
          kind: 'read',
          title: extracted.title,
          lang: extracted.lang,
          text: extracted.text,
          canonical: extracted.canonical,
          links: extracted.links,
          nofollow: extracted.nofollow,
          httpStatus: result.status,
        };
      }
    }
  }

  /** Hash the page, and embed it only when its text changed. */
  async #embed(
    page: FrontierPage,
    read: { title: string | null; lang: string | null; text: string; httpStatus: number },
    stored: Map<string, StoredPage>,
  ): Promise<PageOutcome | 'capped' | 'unavailable'> {
    const body = pageBody(read.title, read.text);
    const hash = sha256Hex(body);
    const before = stored.get(page.hash);
    if (
      before &&
      before.contentHash === hash &&
      before.chunkCount > 0 &&
      (KNOWLEDGE_PAGE_INDEXED_STATUSES as readonly string[]).includes(before.status)
    ) {
      return { kind: 'unchanged', title: read.title, lang: read.lang, httpStatus: read.httpStatus };
    }
    let prepared: PreparedChunks;
    try {
      prepared = await this.#crawler.knowledge.prepare(body, this.#context);
    } catch (error) {
      if (error instanceof AiDailyCapError) return 'capped';
      if (error instanceof EmbeddingProviderError) {
        this.#run.log.warn(
          { kind: error.kind },
          'knowledge job: the embedding provider did not answer',
        );
        return 'unavailable';
      }
      throw error;
    }
    if (prepared.chunks.length === 0) {
      return {
        kind: 'other',
        status: 'error',
        error: 'empty_page',
        httpStatus: read.httpStatus,
        dropChunks: true,
        title: read.title,
        lang: read.lang,
      };
    }
    return {
      kind: 'indexed',
      title: read.title,
      lang: read.lang,
      body,
      hash,
      prepared,
      httpStatus: read.httpStatus,
    };
  }

  /** One page's row, chunks and the job's progress, in one short transaction. False: the claim was lost. */
  async #write(
    page: FrontierPage,
    outcome: PageOutcome,
    stored: Map<string, StoredPage>,
    frontier: CrawlFrontier,
  ): Promise<boolean> {
    const now = this.#crawler.now();
    const before = stored.get(page.hash);
    const base = {
      licenseId: this.#context.licenseId,
      sourceId: this.#claim.sourceId,
      url: page.url.slice(0, 2048),
      urlHash: page.hash,
      depth: page.depth,
    };
    let status: KnowledgePageStatus;
    let data: {
      status: KnowledgePageStatus;
      httpStatus: number | null;
      error: string | null;
      fetchedAt: Date | null;
      missCount: number;
      title?: string | null;
      lang?: string | null;
      contentHash?: string | null;
      changedAt?: Date;
      chunkCount?: number;
    };
    let chunks: 'replace' | 'drop' | 'keep' = 'keep';

    switch (outcome.kind) {
      case 'indexed':
        status = 'ok';
        chunks = 'replace';
        data = {
          status,
          httpStatus: outcome.httpStatus,
          error: null,
          fetchedAt: now,
          missCount: 0,
          title: clipTitle(outcome.title),
          lang: outcome.lang,
          contentHash: outcome.hash,
          changedAt: now,
          chunkCount: outcome.prepared.chunks.length,
        };
        break;
      case 'unchanged':
        status = 'unchanged';
        data = {
          status,
          httpStatus: outcome.httpStatus,
          error: null,
          fetchedAt: now,
          missCount: 0,
          title: clipTitle(outcome.title),
          lang: outcome.lang,
        };
        break;
      case 'miss': {
        // Two 404/410 in a row: gone. One: the page keeps what it had and is tried again.
        const misses = (before?.missCount ?? 0) + 1;
        status = misses >= 2 ? 'removed' : 'error';
        if (status === 'removed') chunks = 'drop';
        data = {
          status,
          httpStatus: outcome.httpStatus,
          error: status === 'removed' ? 'gone' : `http_${outcome.httpStatus}`,
          fetchedAt: now,
          missCount: misses,
          ...(status === 'removed' ? { chunkCount: 0 } : {}),
        };
        break;
      }
      case 'other':
        status = outcome.status;
        if (outcome.dropChunks) chunks = 'drop';
        data = {
          status,
          httpStatus: outcome.httpStatus,
          error: outcome.error,
          fetchedAt: outcome.httpStatus === null ? null : now,
          missCount: 0,
          ...(outcome.title === undefined ? {} : { title: clipTitle(outcome.title) }),
          ...(outcome.lang === undefined ? {} : { lang: outcome.lang }),
          ...(outcome.dropChunks ? { chunkCount: 0 } : {}),
        };
        break;
    }

    this.#counts[counterFor(status)] += 1;
    this.#counts.pagesDone += 1;
    this.#counts.pagesDiscovered = Math.max(this.#counts.pagesDiscovered, frontier.admitted);

    try {
      const written = await withTenant(this.#db, this.#context, async (tx) => {
        if (!(await this.#progress(tx, frontier.toJSON()))) throw new LostClaim();
        const row = await tx.knowledgePage.upsert({
          where: { sourceId_urlHash: { sourceId: base.sourceId, urlHash: base.urlHash } },
          create: { ...base, ...data },
          update: { ...data, depth: base.depth, url: base.url },
          select: {
            id: true,
            url: true,
            status: true,
            contentHash: true,
            missCount: true,
            chunkCount: true,
            depth: true,
          },
        });
        if (chunks !== 'keep') {
          await tx.knowledgeChunk.deleteMany({ where: { pageId: row.id } });
        }
        if (chunks === 'replace' && outcome.kind === 'indexed') {
          for (const [position, piece] of outcome.prepared.chunks.entries()) {
            await tx.$executeRaw`
              INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding,
                                            embedding_space, token_count, position, page_id)
              VALUES (gen_random_uuid(), ${base.sourceId}::uuid, ${base.licenseId}, ${piece.text},
                      ${piece.vector}::vector, ${outcome.prepared.space}, ${piece.tokenCount},
                      ${position}, ${row.id}::uuid)
            `;
          }
          // The text a website source held before its pages were tracked
          // goes with its first page that answers: the page says it now.
          if (!this.#legacyCleared) {
            await tx.knowledgeChunk.deleteMany({
              where: { sourceId: base.sourceId, pageId: null },
            });
            this.#legacyCleared = true;
          }
          if (page.key === this.#scope.root.key) {
            await tx.knowledgeSource.updateMany({
              where: { id: base.sourceId },
              data: { content: outcome.body },
            });
          }
        }
        return row;
      });
      stored.set(page.hash, { ...written });
      return true;
    } catch (error) {
      if (error instanceof LostClaim) return false;
      throw error;
    }
  }

  /** Save where the job is (this page back at the head) and end the claim so. */
  async #park(
    frontier: CrawlFrontier,
    page: FrontierPage,
    end: Extract<JobEnd, { status: 'queued' | 'waiting_budget' }>,
  ): Promise<void> {
    const left: FrontierEntry[] = [{ url: page.url, depth: page.depth }, ...frontier.toJSON()];
    await withTenant(this.#db, this.#context, async (tx) => {
      if (!(await this.#progress(tx, left))) return;
      await endJobClaim(tx, this.#claim, end);
    });
  }

  /**
   * The crawl is over. A crawl that went through its whole frontier removes
   * the pages its source keeps that are out of its scope now; one stopped
   * early (`error`) leaves them. Then the job ends and the source says what
   * it has.
   */
  async #finish(
    stored: Map<string, StoredPage>,
    error: string | null,
    failed = false,
  ): Promise<void> {
    const now = this.#crawler.now();
    const outOfScope =
      error === null
        ? [...stored.values()].filter((page) => page.status !== 'removed' && !this.#keeps(page.url))
        : [];
    this.#counts.pagesRemoved += outOfScope.length;
    this.#counts.pagesDone += outOfScope.length;
    await withTenant(this.#db, this.#context, async (tx) => {
      if (!(await this.#progress(tx, []))) return;
      if (outOfScope.length > 0) {
        const ids = outOfScope.map((page) => page.id);
        await tx.knowledgeChunk.deleteMany({ where: { pageId: { in: ids } } });
        await tx.knowledgePage.updateMany({
          where: { id: { in: ids } },
          data: { status: 'removed', error: 'out_of_scope', chunkCount: 0 },
        });
      }
      const end: JobEnd =
        failed && error
          ? { status: 'failed', error }
          : { status: 'done', ...(error ? { error } : {}) };
      if (!(await endJobClaim(tx, this.#claim, end))) return;
      await settleCrawledSource(tx, this.#claim.sourceId, now);
    });
    this.#run.log.info(
      {
        pages_ok: this.#counts.pagesOk,
        pages_unchanged: this.#counts.pagesUnchanged,
        pages_failed: this.#counts.pagesFailed,
        pages_removed: this.#counts.pagesRemoved,
      },
      'knowledge job finished',
    );
  }

  /** Whether a stored page is still the source's: in scope, and for `single` the start URL itself. */
  #keeps(url: string): boolean {
    if (this.#scope.check(url) !== 'in') return false;
    if (this.#crawlScope !== 'single') return true;
    return normalizeCrawlUrl(url)?.key === this.#scope.root.key;
  }
}

function clipTitle(title: string | null): string | null {
  return title === null ? null : title.slice(0, 500);
}

/**
 * What a source says once its job has ended — the runner's end, a cancel, a
 * residency refusal: `ready` when every page it keeps answers, `partial` when
 * some failed (or only text from before page tracking answers), `failed` when
 * nothing does; `page_count` the pages that answer; the next refresh counted
 * from now.
 */
export async function settleCrawledSource(
  tx: TenantClient,
  sourceId: string,
  now: Date,
  refusal?: string,
): Promise<void> {
  const [indexed, failed, legacy, source] = await Promise.all([
    tx.knowledgePage.count({
      where: { sourceId, status: { in: [...KNOWLEDGE_PAGE_INDEXED_STATUSES] } },
    }),
    tx.knowledgePage.count({
      where: { sourceId, status: { in: ['error', 'blocked', 'needs_js'] } },
    }),
    tx.knowledgeChunk.count({ where: { sourceId, pageId: null } }),
    tx.knowledgeSource.findFirst({ where: { id: sourceId }, select: { refreshAfterDays: true } }),
  ]);
  if (!source) return;
  const status =
    indexed > 0 ? (failed > 0 ? 'partial' : 'ready') : legacy > 0 ? 'partial' : 'failed';
  await tx.knowledgeSource.updateMany({
    where: { id: sourceId },
    data: {
      status,
      pageCount: indexed,
      lastCrawledAt: now,
      lastRefreshError: refusal ?? (status === 'failed' ? CRAWL_NO_PAGE : null),
      nextRefreshAt: computeNextRefreshAt(source.refreshAfterDays, now),
      updatedAt: now,
    },
  });
}
