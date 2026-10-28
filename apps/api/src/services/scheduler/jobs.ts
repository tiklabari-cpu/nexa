/**
 * The sweeps as scheduler jobs (M-SCHED-b, plus webhook redelivery M-SCHED-e ·
 * §D113/K1).
 *
 * Each of these already existed as a `pnpm --filter @siyahtus/api <job>:run`
 * script wrapping a class with its own `run()` — the CLI entry point and the
 * pass itself were already split, so this module does not touch either. It
 * only gives {@link import('./scheduler.js').Scheduler.register} what it
 * needs: a name, an interval and a `run` that builds and calls the same
 * class the CLI does, the same way the CLI does.
 *
 * `retention` is the one job that is not simply the CLI's `--apply` path
 * wired to a timer. The CLI defaults to `dryRun: true` because an operator
 * has to type `--apply` to confirm an irreversible delete; a scheduled pass
 * has no operator, so `RETENTION_ENABLED` stands in for that confirmation —
 * unset, the job is registered (`/health` lists it) but its `run` is never
 * called, exactly the shape `JobDefinition.enabled` documents. Every other
 * job here runs for real: none of the other five is irreversible in the way
 * retention is (`chat-timeout-run.ts`, `sla-run.ts`, `siem-run.ts` and
 * `knowledge-refresh-run.ts` take no `--apply` either — a refused refresh
 * leaves the source untouched by construction, not by a flag), and
 * `scheduled-reports:run`'s dry-run exists only for an operator eyeballing the
 * CLI's output — the sweeper it calls under `--apply` is the same
 * `ScheduledReportSweeper.run` used here. `invoice_close` is the same shape as
 * those: `invoice-close-run.ts` takes no `--apply` either, because freezing a
 * closed period moves no money and cannot happen twice. `webhook_redelivery`
 * has no CLI script at all (see README.md).
 *
 * `unverified_signups` (tm 257.19) is the second job that can be registered
 * switched off, and the second that deletes. It runs only while
 * `SIGNUP_EMAIL_VERIFICATION` is on: off, `/auth/authorize` reads no gate and
 * an unverified account signs in like any other, so deleting it for not having
 * verified would delete a working account. What may go, and the locking that
 * keeps a concurrent verification safe, live in its database function; it has
 * no CLI script either.
 *
 * `ai_stall` (tm 293.6) is the one job a visitor is waiting on, and the one that
 * pushes: it routes a conversation the AI left unanswered to a person, who has
 * to hear about it now rather than on their next poll — so it is the only
 * sweep given the server's realtime publisher. No CLI script: a watchdog
 * measured in seconds has no hand-run equivalent.
 *
 * `ai_sandbox_sessions` (tm 314.2) deletes the AI test bench's "talk like a
 * player" sessions past their `expires_at`, which the routes already refuse —
 * test data, never a conversation; no CLI script either.
 *
 * `ai_unresolved_cluster` and `ai_unresolved_merge` (tm 317.2) group the
 * questions the AI could not resolve, title them, count them and raise the
 * surge alarm (`services/ai/unresolved/cluster-job.ts`) — the second job given
 * the realtime publisher, for the console's notice. They embed and title with
 * the server's providers, metered on the workspace's allowance; no CLI script.
 *
 * `chat_inactivity` (tm 340.2 · WG-03) passes a connection its agent left
 * unanswered to someone else in the team and marks a quiet one inactive, out
 * of its agent's limit (`services/chat/chat-inactivity.ts`). It shares the
 * watchdog's publisher-wired chat service: the agent it hands a connection to,
 * the one it stops routing to and the lead of a team nobody could take it in
 * all hear now. No CLI script, for the watchdog's reason.
 *
 * `ai_scheduled_publish` (tm 316.6 · AI-20-S4) publishes an AI configuration
 * version approved with a `publish_at` that has come
 * (`services/ai/config-schedule.ts`) — given the publisher for the
 * `ai_config_published` push and the mailer for a refusal. `knowledge_chunk_gc`
 * (tm 316.6 · ADR-14b §2.8 (7)) deletes the knowledge chunks no version answers
 * from any more (`services/ai/knowledge-chunk-gc.ts`). Neither has a CLI script.
 */
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env.js';
import { AiDailyBudget, aiDailyCaps } from '../ai/ai-daily-budget.js';
import { ScheduledAiConfigPublisher } from '../ai/config-schedule.js';
import {
  resolveEmbeddingInferenceProvider,
  resolveInferenceProvider,
  type InferenceProvider,
} from '../ai/inference.js';
import { KbArticleKnowledgeSweeper } from '../ai/kb-article-knowledge.js';
import { KnowledgeChunkCollector } from '../ai/knowledge-chunk-gc.js';
import { KnowledgeDocumentObjectSweeper } from '../ai/knowledge-document-sweep.js';
import { KnowledgeRefreshSweeper } from '../ai/knowledge-refresh-sweep.js';
import { KnowledgeService } from '../ai/knowledge-service.js';
import { createMeteredEmbeddings } from '../ai/metered-embeddings.js';
import { MeteredLlm } from '../ai/metered-llm.js';
import { createLlmProvider, type LlmProvider } from '../ai/provider/llm-provider.js';
import { defaultLlmLogger } from '../ai/provider/openai-llm-provider.js';
import { UnresolvedClusterer, UnresolvedClusterMerger } from '../ai/unresolved/cluster-job.js';
import { KnowledgeTableRowKnowledgeSweeper } from '../knowledge-tables/row-knowledge.js';
import { KnowledgeTableStaleSweeper } from '../knowledge-tables/stale-sweep.js';
import { SandboxSessionSweeper } from '../ai/simulation/sandbox-sweep.js';
import { SiemSink } from '../audit/siem-sink.js';
import { createSiemTarget } from '../audit/siem-target.js';
import {
  UnverifiedInviteeSweeper,
  UnverifiedSignupSweeper,
} from '../auth/unverified-signup-sweep.js';
import { InvoiceCloseSweeper } from '../billing/invoice-close-sweep.js';
import { AiStallWatchdog } from '../chat/ai-stall.js';
import { ChatInactivitySweeper } from '../chat/chat-inactivity.js';
import { ChatService } from '../chat/chat-service.js';
import type { WorkspaceEventDispatcher } from '../webhooks/workspace-events.js';
import { ChatTimeoutSweeper } from '../chat/chat-timeout.js';
import type { Mailer } from '../mail/mailer.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { ScheduledReportSweeper } from '../reports/scheduled-report-sweeper.js';
import { resolveRetentionPolicy } from '../retention/policy.js';
import { RetentionRunner } from '../retention/retention.js';
import { createObjectStore } from '../storage/object-store.js';
import { SlaSweeper } from '../sla/sla-sweep.js';
import { WebhookRedeliverer } from '../webhooks/redelivery.js';
import { createHttpWebhookSender } from '../webhooks/webhook-dispatcher.js';
import { jobIntervals } from './intervals.js';
import type { JobDefinition } from './types.js';

/**
 * The idle-chat sweep touches Redis only through the send path's idempotency
 * check, never through a close — `chat-timeout-run.ts` uses the same stub for
 * the same reason, so a scheduled pass needs no live cache either.
 */
const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

export interface SchedulerJobsOptions {
  db: PrismaClient;
  /**
   * The read path (M-SCALE-c) — `app.dbRead`, which is the replica when one is
   * configured. Only the scheduled-report sweep uses it, and only to build the
   * CSV: the other four jobs exist to *change* rows, so there is nothing here to
   * move off the primary. Defaults to `db` for callers that have no replica to
   * offer, which is every test and both CLI entry points.
   */
  readDb?: PrismaClient;
  env: Env;
  /** Same mailer the server answers requests with — an idle-chat transcript,
   *  an SLA alert and a scheduled report are all outgoing mail like any other
   *  (PLAN A4), so a test server's `NullMailer` keeps a sweep from leaving
   *  files behind exactly as it keeps requests from doing so. */
  mailer: Mailer;
  /**
   * Fans a sweep-driven lifecycle event out to Zapier/Make subscriptions
   * (FR-MOD-09.4). Optional: without one the sweeps behave exactly as they did,
   * they simply announce nothing outside the building. Wired by the server
   * plugin so a chat the timeout sweep archives reaches the same zap as one an
   * agent archived — an automation that quietly stopped overnight would be
   * worse than one that never existed.
   */
  automations?: WorkspaceEventDispatcher;
  /**
   * Indexes what the freshness sweep re-crawls — the server's one instance,
   * so the sweep embeds with the provider (and the circuit breaker) requests
   * use (tm 255.7). Omitted, one is built from `env` the way the CLI builds it:
   * the configured provider, never a silent stub, metered against the daily AI
   * caps over `db` (tm 257.20).
   */
  knowledge?: KnowledgeService;
  /**
   * Realtime fan-out for the stalled-AI watchdog's hand-over (tm 293.6): the
   * agent it routes to gets `incoming_chat` and the inbox's badge moves, as
   * when a person hands a chat over. Omitted — every test, both CLI entry
   * points — the hand-over is written all the same and seen on the next poll.
   */
  publisher?: RealtimePublisher;
  /**
   * The model that titles the unresolved questions' clusters (tm 317.2) — the
   * server's metered instance. Omitted, one is built from `env` the way
   * {@link createMeteredEmbeddings} builds the embeddings: the configured
   * provider, metered over `db`.
   */
  llm?: LlmProvider | MeteredLlm;
  /**
   * Where the two providers run, as the NFR-C4 gate reads it (tm 389.17): the
   * server's AI registry, which the root panel can change without a restart.
   * Omitted, the environment's.
   */
  inference?: () => { llm: InferenceProvider; embedding: InferenceProvider };
}

/**
 * Every job the scheduler registers, in the order `/health` lists them —
 * {@link import('./intervals.js').SCHEDULER_JOB_NAMES}, in full.
 */
export function buildSchedulerJobs({
  db,
  readDb = db,
  env,
  mailer,
  automations,
  publisher,
  llm,
  inference = () => ({
    llm: resolveInferenceProvider(env),
    embedding: resolveEmbeddingInferenceProvider(env),
  }),
  knowledge = new KnowledgeService({
    embeddings: createMeteredEmbeddings(db, env),
    retrievalThreshold: env.RETRIEVAL_THRESHOLD,
  }),
}: SchedulerJobsOptions): JobDefinition[] {
  const intervals = jobIntervals(env);
  // The unresolved questions' providers (tm 317.2): the knowledge service's
  // embeddings, so a cluster lives in the space the turns search in.
  const clusterLlm =
    llm ??
    new MeteredLlm(
      createLlmProvider(env.LLM_PROVIDER, env.llm, { logger: defaultLlmLogger() }),
      new AiDailyBudget(db, aiDailyCaps(env), { logger: defaultLlmLogger() }),
    );
  const clusterEmbeddings = knowledge.embeddings;

  // Built once and reused across passes, the same instance a long-lived
  // request-handling server would already have — construction itself does no
  // I/O, so there is nothing to gain from rebuilding it every tick.
  const chats = new ChatService(
    db,
    NO_REDIS,
    undefined,
    undefined,
    { aiOverageCents: env.AI_OVERAGE_CENTS, aiIncluded: env.AI_RESOLUTIONS_INCLUDED },
    mailer,
    undefined,
    automations,
  );
  // The watchdog's and the inactivity sweep's, with the publisher: the sweeps
  // above stay as they were.
  const aiChats = new ChatService(
    db,
    NO_REDIS,
    publisher,
    undefined,
    { aiOverageCents: env.AI_OVERAGE_CENTS, aiIncluded: env.AI_RESOLUTIONS_INCLUDED },
    mailer,
    undefined,
    automations,
  );

  return [
    {
      name: 'chat_timeout',
      intervalMs: intervals.chat_timeout,
      async run() {
        const report = await new ChatTimeoutSweeper(db, chats, env.AUDIT_CHAIN_SECRET).run();
        return {
          counts: {
            tenants: report.totals.tenants,
            closed: report.totals.closed,
            queue_entries_closed: report.totals.queueEntriesClosed,
          },
        };
      },
    },
    {
      name: 'sla',
      intervalMs: intervals.sla,
      async run() {
        const report = await new SlaSweeper(db, mailer, env.WEB_APP_URL).run();
        return {
          counts: {
            tenants: report.totals.tenants,
            marked: report.totals.marked,
            notified: report.totals.notified,
            unannounced: report.totals.unannounced,
          },
        };
      },
    },
    {
      name: 'siem',
      intervalMs: intervals.siem,
      async run() {
        const sink = new SiemSink(db, {
          siemDir: env.SIEM_DIR,
          target: createSiemTarget(env.SIEM_PROVIDER, { siemDir: env.SIEM_DIR }),
          auditChainSecret: env.AUDIT_CHAIN_SECRET,
          horizonMs: env.SIEM_EXPORT_HORIZON_MS,
        });
        const report = await sink.run();
        return {
          counts: {
            tenants: report.totals.tenants,
            delivered: report.totals.delivered,
            failed: report.totals.failed,
          },
        };
      },
    },
    {
      name: 'scheduled_reports',
      intervalMs: intervals.scheduled_reports,
      async run() {
        const report = await new ScheduledReportSweeper(db, mailer, readDb).run();
        return {
          counts: {
            tenants: report.totals.tenants,
            delivered: report.totals.delivered,
            skipped: report.totals.skipped,
            failed: report.totals.failed,
          },
        };
      },
    },
    {
      name: 'retention',
      intervalMs: intervals.retention,
      enabled: env.RETENTION_ENABLED,
      async run() {
        const runner = new RetentionRunner(db, {
          policy: resolveRetentionPolicy(env),
          mailDir: env.MAIL_DIR,
          auditChainSecret: env.AUDIT_CHAIN_SECRET,
          store: createObjectStore(env.STORAGE_PROVIDER, env.storage),
        });
        // Not a preview: `enabled` above is the confirmation the CLI's
        // `--apply` flag stands for, so a pass that runs at all commits.
        const report = await runner.run({ dryRun: false });
        return {
          counts: {
            tenants: report.totals.tenants,
            threads: report.totals.threads,
            visits: report.totals.visits,
            aiDecisions: report.totals.aiDecisions,
            unresolvedItems: report.totals.unresolvedItems,
            sensitiveFiles: report.totals.sensitiveFiles,
            mailFiles: report.totals.mailFiles,
            auditEntries: report.totals.auditEntries,
          },
        };
      },
    },
    {
      name: 'webhook_redelivery',
      intervalMs: intervals.webhook_redelivery,
      async run(context) {
        // The only job here that talks to the outside world, so it is the only
        // one built with the real HTTP sender. Everything that makes a webhook
        // safe to send — the DNS re-check, the connection pinned to what it
        // checked, the signature — lives inside `WebhookDispatcher.attempt`,
        // which is what the redeliverer calls.
        const report = await new WebhookRedeliverer(db, {
          sender: createHttpWebhookSender(),
          auditChainSecret: env.AUDIT_CHAIN_SECRET,
          maxAttempts: env.WEBHOOK_MAX_ATTEMPTS,
        }).run({ signal: context.signal });
        return {
          counts: {
            tenants: report.totals.tenants,
            attempted: report.totals.attempted,
            delivered: report.totals.delivered,
            requeued: report.totals.requeued,
            exhausted: report.totals.exhausted,
            skipped: report.totals.skipped,
          },
        };
      },
    },
    {
      // The store's freshness: the `website` sources past their window, then
      // the published KB articles whose knowledge source is not what they say
      // (tm 309.2 · AI-14-S2 — `kb-article-knowledge.ts`), then the structured
      // table rows whose source is not (tm 310.2 · AI-13 — `row-knowledge.ts`), and
      // last the table rows past their review date, announced once to the
      // owner and admins (tm 310.5 · AI-13-S2 — `stale-sweep.ts`), and
      // finally the PDF and Word originals no source holds any more (tm 313.3 ·
      // AI-18 — `knowledge-document-sweep.ts`).
      name: 'knowledge_refresh',
      intervalMs: intervals.knowledge_refresh,
      async run() {
        const embeddingInference = inference().embedding;
        const report = await new KnowledgeRefreshSweeper(db, { embeddingInference }).run();
        const articles = await new KbArticleKnowledgeSweeper(db, {
          knowledge,
          embeddingInference,
        }).run();
        const rows = await new KnowledgeTableRowKnowledgeSweeper(db, {
          knowledge,
          embeddingInference,
        }).run();
        const stale = await new KnowledgeTableStaleSweeper(db, mailer, env.WEB_APP_URL).run();
        const originals = await new KnowledgeDocumentObjectSweeper(
          db,
          createObjectStore(env.STORAGE_PROVIDER, env.storage),
        ).run();
        return {
          counts: {
            tenants: report.totals.tenants,
            checked: report.totals.checked,
            queued: report.totals.queued,
            failed: report.totals.failed,
            kb_checked: articles.totals.checked,
            kb_synced: articles.totals.synced,
            kb_deferred: articles.totals.deferred,
            table_rows_checked: rows.totals.checked,
            table_rows_synced: rows.totals.synced,
            table_rows_deferred: rows.totals.deferred,
            table_rows_stale: stale.totals.stale,
            table_rows_stale_announced: stale.totals.announced,
            table_rows_stale_mailed: stale.totals.mailed,
            document_originals_checked: originals.totals.checked,
            document_originals_removed: originals.totals.removed,
            document_originals_failed: originals.totals.failed,
          },
        };
      },
    },
    {
      // Freezes a closed billing period into a statement (FR-MOD-10.3). Like
      // the sweeps above it takes no `--apply`: the pass writes a row saying
      // what a month already cost — no money moves, no quota changes, nothing
      // leaves the building — and a period it has closed cannot be closed twice.
      name: 'invoice_close',
      intervalMs: intervals.invoice_close,
      async run() {
        const report = await new InvoiceCloseSweeper(db, env).run();
        return {
          counts: {
            tenants: report.totals.tenants,
            issued: report.totals.issued,
            reconstructed: report.totals.reconstructed,
            skipped: report.totals.skipped,
          },
        };
      },
    },
    {
      // Deletes a sign-up nobody verified once it has expired with its
      // workspace still empty (tm 257.19). Off with the flag — see the
      // header — and registered either way, so `/health` says `disabled`.
      name: 'unverified_signups',
      intervalMs: intervals.unverified_signups,
      enabled: env.SIGNUP_EMAIL_VERIFICATION,
      async run(context) {
        const report = await new UnverifiedSignupSweeper(db, {
          ttlHours: env.UNVERIFIED_SIGNUP_TTL_HOURS,
        }).run({ signal: context.signal });
        if (report.totals.purged > 0) {
          // The purged workspaces' audit trail went with them, so this line is
          // the record that they existed. A count and nothing else: no
          // address, name or id.
          context.logger.info(
            { event: 'signup.unverified_purged', count: report.totals.purged },
            'expired unverified sign-ups purged',
          );
        }
        // Accounts an invitation link created and nobody verified (tm 282),
        // with the same TTL. In the same job rather than one of its own: the
        // same switch, the same reasons, and a second job would be one more
        // name on `/health` for the same chore.
        const invitees = await new UnverifiedInviteeSweeper(db, {
          ttlHours: env.UNVERIFIED_SIGNUP_TTL_HOURS,
        }).run({ signal: context.signal });
        if (invitees.totals.purged > 0) {
          context.logger.info(
            { event: 'invitation.unverified_purged', count: invitees.totals.purged },
            'expired unverified invitees purged',
          );
        }
        return {
          counts: {
            purged: report.totals.purged,
            batches: report.totals.batches,
            invitees: invitees.totals.purged,
          },
        };
      },
    },
    {
      // Sends a person to a visitor the AI left unanswered (tm 293.6 · AI-11
      // §5) — the safety net "Önce AI" takes away. Not gated: a workspace with
      // no AI-first conversation has nothing for it to find.
      name: 'ai_stall',
      intervalMs: intervals.ai_stall,
      async run(context) {
        const report = await new AiStallWatchdog(db, aiChats).run({ signal: context.signal });
        if (report.totals.handedOver > 0) {
          context.logger.info(
            { event: 'ai.stall_handed_over', count: report.totals.handedOver },
            'stalled ai conversations handed to a person',
          );
        }
        return {
          counts: {
            tenants: report.totals.tenants,
            stalled: report.totals.stalled,
            handed_over: report.totals.handedOver,
          },
        };
      },
    },
    {
      // The AI test bench's expired sandbox sessions (tm 314.2 · AI-19 §8).
      name: 'ai_sandbox_sessions',
      intervalMs: intervals.ai_sandbox_sessions,
      async run(context) {
        const report = await new SandboxSessionSweeper(db).run({ signal: context.signal });
        return { counts: { purged: report.totals.purged, batches: report.totals.batches } };
      },
    },
    {
      // The unresolved questions (tm 317.2 · AI-22): embed, group, title,
      // count, reopen and alarm. Not gated: a workspace whose AI resolved
      // everything has nothing for it to find.
      name: 'ai_unresolved_cluster',
      intervalMs: intervals.ai_unresolved_cluster,
      async run(context) {
        const report = await new UnresolvedClusterer(db, {
          embeddings: clusterEmbeddings,
          llm: clusterLlm,
          llmLimits: {
            maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
            timeoutMs: env.LLM_TIMEOUT_MS,
            maxPromptChars: env.LLM_MAX_PROMPT_CHARS,
          },
          llmInference: inference().llm,
          embeddingInference: inference().embedding,
          publisher: publisher ?? null,
          logger: context.logger,
        }).run({ signal: context.signal });
        return {
          counts: {
            tenants: report.totals.tenants,
            embedded: report.totals.embedded,
            rebuilt: report.totals.rebuilt,
            assigned: report.totals.assigned,
            opened: report.totals.opened,
            labelled: report.totals.labelled,
            reopened: report.totals.reopened,
            alerted: report.totals.alerted,
          },
        };
      },
    },
    {
      // The clusters the 15-minute pass split, merged nightly (tm 317.2 · AI-22 §4).
      name: 'ai_unresolved_merge',
      intervalMs: intervals.ai_unresolved_merge,
      async run(context) {
        const report = await new UnresolvedClusterMerger(db, {
          space: clusterEmbeddings.space,
          logger: context.logger,
        }).run({ signal: context.signal });
        return {
          counts: {
            tenants: report.totals.tenants,
            merged: report.totals.merged,
            absorbed: report.totals.absorbed,
          },
        };
      },
    },
    {
      // A connection its agent left unanswered, passed on; a quiet one out of
      // its agent's limit (tm 340.2 · WG-03). Not gated: both windows are off
      // until a workspace sets them, and then a pass reads one settings row.
      name: 'chat_inactivity',
      intervalMs: intervals.chat_inactivity,
      async run(context) {
        const report = await new ChatInactivitySweeper(db, aiChats).run({
          signal: context.signal,
        });
        if (report.totals.transferred + report.totals.queued > 0) {
          context.logger.info(
            {
              event: 'chat.unanswered_passed_on',
              transferred: report.totals.transferred,
              queued: report.totals.queued,
            },
            'unanswered conversations passed on',
          );
        }
        return {
          counts: {
            tenants: report.totals.tenants,
            transferred: report.totals.transferred,
            queued: report.totals.queued,
            marked_inactive: report.totals.markedInactive,
            cleared_inactive: report.totals.clearedInactive,
          },
        };
      },
    },
    {
      // An approved AI configuration version whose time has come, published
      // (tm 316.6 · AI-20-S4). Not gated: a workspace with nothing scheduled
      // reads one empty row set.
      name: 'ai_scheduled_publish',
      intervalMs: intervals.ai_scheduled_publish,
      async run(context) {
        const report = await new ScheduledAiConfigPublisher(db, {
          auditChainSecret: env.AUDIT_CHAIN_SECRET,
          publisher: publisher ?? null,
          mailer,
          appUrl: env.WEB_APP_URL,
          logger: context.logger,
        }).run({ signal: context.signal });
        if (report.totals.published + report.totals.refused > 0) {
          context.logger.info(
            {
              event: 'ai.config_scheduled_publish',
              published: report.totals.published,
              refused: report.totals.refused,
            },
            'scheduled ai configuration versions published',
          );
        }
        return {
          counts: {
            tenants: report.totals.tenants,
            due: report.totals.due,
            published: report.totals.published,
            refused: report.totals.refused,
            skipped: report.totals.skipped,
            failed: report.totals.failed,
            mailed: report.totals.mailed,
          },
        };
      },
    },
    {
      // The knowledge chunks no AI configuration version answers from any
      // more (tm 316.6 · ADR-14b §2.8 (7)).
      name: 'knowledge_chunk_gc',
      intervalMs: intervals.knowledge_chunk_gc,
      async run(context) {
        const report = await new KnowledgeChunkCollector(db).run({ signal: context.signal });
        return {
          counts: {
            tenants: report.totals.tenants,
            unpublished: report.totals.unpublished,
            hidden: report.totals.hidden,
            sources: report.totals.sources,
            busy: report.totals.busy,
          },
        };
      },
    },
  ];
}
