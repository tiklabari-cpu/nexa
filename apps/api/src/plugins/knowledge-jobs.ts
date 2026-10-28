/**
 * `app.knowledgeJobs` — the knowledge job runner (tm 312.3 · SiyahTuş analysis
 * AI-17), one per server: crawls the website sources the routes and the
 * freshness sweep queue (`services/ai/crawler/job-runner.ts`).
 *
 * The pages come through `CRAWLER_PROVIDER`'s fetcher — `mock` (no network,
 * the default) or `http` (the real one behind the SSRF guard) — unless the
 * server is handed one: a test passes a mock site, so a suite decides what a
 * site says without a socket.
 *
 * {@link AiJobDiscovery} decides how the runner finds jobs, as it does for
 * the AI job worker: `shared` polls, so any process crawls any workspace's
 * source — the one that queued it may have gone; `in_process` (every test
 * server) crawls only what its own requests woke it for.
 *
 * A `document` job (tm 313.3 · AI-18) reads a PDF or Word original from the
 * object store `STORAGE_PROVIDER` names, in a worker process of its own
 * (`services/ai/document-ingest.ts`).
 *
 * Registered after `database`, so that its drain on close runs while the pool
 * is still open; a job cut off is handed back to the queue with its frontier.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';
import type { CrawlFetcher } from '../services/ai/crawler/fetcher.js';
import { KNOWLEDGE_JOB_POLL_MS, KnowledgeJobWorker } from '../services/ai/crawler/job-runner.js';
import { createCrawlFetcher } from '../services/ai/crawler/provider.js';
import type { DocumentIngestOptions } from '../services/ai/document-ingest.js';
import type { InferenceProvider } from '../services/ai/inference.js';
import type { KnowledgeService } from '../services/ai/knowledge-service.js';
import { createObjectStore } from '../services/storage/object-store.js';
import type { AiJobDiscovery } from './ai-jobs.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Crawls the queued website sources (tm 312.3). */
    knowledgeJobs: KnowledgeJobWorker;
  }
}

export interface KnowledgeJobsPluginOptions {
  env: Env;
  /** The server's one knowledge service — metered, in the space questions are asked in. */
  knowledge: KnowledgeService;
  /** Where the embedding provider runs now (the AI registry's, hot-swappable). */
  embeddingInference: () => InferenceProvider;
  /** Who fetches pages; omitted, `CRAWLER_PROVIDER`'s. */
  fetcher?: CrawlFetcher;
  discovery?: AiJobDiscovery;
  /** The document reader; omitted, the isolated worker process (a test passes a canned one). */
  parseDocument?: DocumentIngestOptions['parse'];
}

async function knowledgeJobsPlugin(
  app: FastifyInstance,
  options: KnowledgeJobsPluginOptions,
): Promise<void> {
  const log = app.log.child({ component: 'knowledge-jobs' });
  const worker = new KnowledgeJobWorker({
    db: app.db,
    logger: log,
    fetcher: options.fetcher ?? createCrawlFetcher(options.env.CRAWLER_PROVIDER),
    knowledge: options.knowledge,
    documents: {
      store: createObjectStore(options.env.STORAGE_PROVIDER, options.env.storage),
      knowledge: options.knowledge,
      ...(options.parseDocument ? { parse: options.parseDocument } : {}),
    },
    embeddingInference: options.embeddingInference,
    pollMs: (options.discovery ?? 'shared') === 'shared' ? KNOWLEDGE_JOB_POLL_MS : null,
  });
  app.decorate('knowledgeJobs', worker);
  worker.start();
  app.addHook('onClose', async () => {
    await worker.stop();
  });
}

export default fp(knowledgeJobsPlugin, { name: 'knowledge-jobs', dependencies: ['database'] });
