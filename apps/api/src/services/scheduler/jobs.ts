/**
 * The sweeps as scheduler jobs (M-SCHED-b, plus webhook redelivery M-SCHED-e ·
 * §D113/K1).
 *
 * Each of these already existed as a `pnpm --filter @nexa/api <job>:run`
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
 * job here runs for real: none of the other four is irreversible in the way
 * retention is (`chat-timeout-run.ts`, `sla-run.ts` and `siem-run.ts` take no
 * `--apply` either), and `scheduled-reports:run`'s dry-run exists only for an
 * operator eyeballing the CLI's output — the sweeper it calls under
 * `--apply` is the same `ScheduledReportSweeper.run` used here.
 */
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env.js';
import { SiemSink } from '../audit/siem-sink.js';
import { createSiemTarget } from '../audit/siem-target.js';
import { ChatService } from '../chat/chat-service.js';
import { ChatTimeoutSweeper } from '../chat/chat-timeout.js';
import type { Mailer } from '../mail/mailer.js';
import { ScheduledReportSweeper } from '../reports/scheduled-report-sweeper.js';
import { resolveRetentionPolicy } from '../retention/policy.js';
import { RetentionRunner } from '../retention/retention.js';
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
}: SchedulerJobsOptions): JobDefinition[] {
  const intervals = jobIntervals(env);

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
  );

  return [
    {
      name: 'chat_timeout',
      intervalMs: intervals.chat_timeout,
      async run() {
        const report = await new ChatTimeoutSweeper(db, chats).run();
        return { counts: { tenants: report.totals.tenants, closed: report.totals.closed } };
      },
    },
    {
      name: 'sla',
      intervalMs: intervals.sla,
      async run() {
        const report = await new SlaSweeper(db, mailer).run();
        return {
          counts: {
            tenants: report.totals.tenants,
            marked: report.totals.marked,
            notified: report.totals.notified,
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
        });
        // Not a preview: `enabled` above is the confirmation the CLI's
        // `--apply` flag stands for, so a pass that runs at all commits.
        const report = await runner.run({ dryRun: false });
        return {
          counts: {
            tenants: report.totals.tenants,
            threads: report.totals.threads,
            visits: report.totals.visits,
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
        // safe to send — the DNS re-check, the signature — lives inside
        // `WebhookDispatcher.attempt`, which is what the redeliverer calls.
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
  ];
}
