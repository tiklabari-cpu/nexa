/**
 * The AI test bench's machinery (tm 314.2 · SiyahTuş analysis AI-19), one per
 * server: `app.aiSimulation`, the scenario runner — the live engine with the
 * server's model, knowledge search and access information, inside the
 * simulation context — and `app.aiTestRuns`, the worker that plays the queued
 * runs with it (`services/ai/simulation/run-worker.ts`).
 *
 * {@link AiJobDiscovery} decides how the worker finds runs, as it does for the
 * AI job worker: `shared` polls, so any process plays any workspace's run —
 * the one that queued it may have gone; `in_process` (every test server) plays
 * only what its own requests woke it for.
 *
 * Registered after `database`, so that its drain on close runs while the pool
 * is still open; a run cut off is handed back to the queue, not lost.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';
import type { SafeHttp } from '../lib/safe-fetch.js';
import type { KnowledgeService } from '../services/ai/knowledge-service.js';
import type { MeteredLlm } from '../services/ai/metered-llm.js';
import { AI_TEST_RUN_POLL_MS, AiTestRunWorker } from '../services/ai/simulation/run-worker.js';
import { ScenarioRunner } from '../services/ai/simulation/runner.js';
import {
  AccessInfoResolver,
  createAccessInfoFetcher,
} from '../services/knowledge-tables/access-info.js';
import type { AiJobDiscovery } from './ai-jobs.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Plays a scenario or a sandbox turn on the live engine, writing nothing (tm 314.2). */
    aiSimulation: ScenarioRunner;
    /** Plays the queued test runs (tm 314.2). */
    aiTestRuns: AiTestRunWorker;
  }
}

export interface AiTestingPluginOptions {
  env: Env;
  /** The visitors' model, metered: a simulation is counted on the test meter (AI-19-S2). */
  llm: MeteredLlm;
  /** The server's one knowledge service — the space a live question is asked in. */
  knowledge: KnowledgeService;
  /** How the access information's `dynamic_url` is fetched; a test pins a fake. */
  accessInfoHttp?: SafeHttp;
  discovery?: AiJobDiscovery;
}

async function aiTestingPlugin(
  app: FastifyInstance,
  options: AiTestingPluginOptions,
): Promise<void> {
  const { env } = options;
  const log = app.log.child({ component: 'ai-testing' });
  const runner = new ScenarioRunner({
    db: app.db,
    knowledge: options.knowledge,
    llm: options.llm,
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
    timeoutMs: env.LLM_TIMEOUT_MS,
    maxPromptChars: env.LLM_MAX_PROMPT_CHARS,
    historyBudget: { maxMessages: env.AI_HISTORY_MAX_MESSAGES, maxChars: env.AI_HISTORY_MAX_CHARS },
    access: new AccessInfoResolver({ fetcher: createAccessInfoFetcher(options.accessInfoHttp) }),
    logger: log,
  });
  const worker = new AiTestRunWorker({
    db: app.db,
    logger: log,
    runner,
    pollMs: (options.discovery ?? 'shared') === 'shared' ? AI_TEST_RUN_POLL_MS : null,
  });
  app.decorate('aiSimulation', runner);
  app.decorate('aiTestRuns', worker);
  worker.start();
  app.addHook('onClose', async () => {
    await worker.stop();
  });
}

export default fp(aiTestingPlugin, { name: 'ai-testing', dependencies: ['database'] });
