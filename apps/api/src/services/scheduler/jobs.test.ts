/**
 * `buildSchedulerJobs` — wiring the sweeps into `JobDefinition`s (M-SCHED-b,
 * plus webhook redelivery M-SCHED-e · §D113/K1).
 *
 * Each sweep's own behaviour — does an idle chat actually close, does a
 * breach actually get marked — is already proven against real fixtures in
 * `test/integration/{chat-timeout,sla,siem-sink,scheduled-reports-sweep,
 * retention,webhook-redelivery}.test.ts`. This suite is only about what this module adds on top
 * of that: does every job get the interval its own `SCHEDULE_<JOB>_MS` names,
 * do `retention` and `unverified_signups` alone answer to their switches
 * (`RETENTION_ENABLED`, `SIGNUP_EMAIL_VERIFICATION`), and does calling
 * `run()` the way the scheduler will actually resolve — against a real
 * database rather than a stub, since the sweepers underneath issue real SQL
 * (`retention_list_tenants()` among them) that a stub would prove nothing
 * about.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NullMailer } from '../mail/mailer.js';
import { ownerClient, resetDatabase, testEnv } from '../../../test/helpers/fixtures.js';
import { silentLogger } from '../../../test/helpers/scheduler.js';
import { SCHEDULER_JOB_NAMES } from './intervals.js';
import { buildSchedulerJobs } from './jobs.js';

describe('buildSchedulerJobs', () => {
  let db: PrismaClient;

  beforeAll(async () => {
    const env = testEnv();
    db = new PrismaClient({ datasourceUrl: env.runtimeDatabaseUrl });
    // Every job below is asserted against an empty database — deterministic
    // regardless of what an earlier file in this run's shared isolated
    // database (CONVENTIONS §1.1) left behind. `seedFixtures` truncates
    // before seeding; this truncates and seeds nothing.
    await resetDatabase(ownerClient());
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('registers every job in SCHEDULER_JOB_NAMES, and nothing else', () => {
    const jobs = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() });
    // Also the order `/health` lists them in: registration order.
    expect(jobs.map((job) => job.name)).toEqual([
      'chat_timeout',
      'sla',
      'siem',
      'scheduled_reports',
      'retention',
      'webhook_redelivery',
      'knowledge_refresh',
      'invoice_close',
      'unverified_signups',
      'ai_stall',
      'ai_sandbox_sessions',
      'ai_unresolved_cluster',
      'ai_unresolved_merge',
      'chat_inactivity',
      'ai_scheduled_publish',
      'knowledge_chunk_gc',
      'ai_suggestion_drafts',
      'qa_sampling',
      'qa_prescore',
      'qa_consistency',
      'ai_outcomes_finalize',
      'ai_metrics_rollup',
    ]);
    // A name declared but never registered is a job somebody forgot to wire,
    // and `/health` would simply not mention it.
    expect(jobs.map((job) => job.name).sort()).toEqual([...SCHEDULER_JOB_NAMES].sort());
  });

  it('gives each job its own SCHEDULE_<JOB>_MS interval', () => {
    const env = testEnv({
      SCHEDULE_CHAT_TIMEOUT_MS: '11000',
      SCHEDULE_SLA_MS: '22000',
      SCHEDULE_SIEM_MS: '33000',
      SCHEDULE_SCHEDULED_REPORTS_MS: '44000',
      SCHEDULE_RETENTION_MS: '55000',
      SCHEDULE_WEBHOOK_REDELIVERY_MS: '66000',
      SCHEDULE_KNOWLEDGE_REFRESH_MS: '77000',
      SCHEDULE_INVOICE_CLOSE_MS: '88000',
      SCHEDULE_UNVERIFIED_SIGNUPS_MS: '99000',
      SCHEDULE_AI_STALL_MS: '12000',
      SCHEDULE_AI_SANDBOX_SESSIONS_MS: '13000',
      SCHEDULE_AI_UNRESOLVED_CLUSTER_MS: '14000',
      SCHEDULE_AI_UNRESOLVED_MERGE_MS: '15000',
      SCHEDULE_CHAT_INACTIVITY_MS: '16000',
      SCHEDULE_AI_SCHEDULED_PUBLISH_MS: '17000',
      SCHEDULE_KNOWLEDGE_CHUNK_GC_MS: '18000',
      SCHEDULE_AI_SUGGESTION_DRAFTS_MS: '19000',
      SCHEDULE_QA_SAMPLING_MS: '20000',
      SCHEDULE_QA_PRESCORE_MS: '21000',
      SCHEDULE_QA_CONSISTENCY_MS: '23000',
      SCHEDULE_AI_OUTCOMES_FINALIZE_MS: '24000',
      SCHEDULE_AI_METRICS_ROLLUP_MS: '25000',
    });
    const jobs = buildSchedulerJobs({ db, env, mailer: new NullMailer() });
    const intervalOf = (name: string): number | undefined =>
      jobs.find((job) => job.name === name)?.intervalMs;

    expect(intervalOf('chat_timeout')).toBe(11_000);
    expect(intervalOf('sla')).toBe(22_000);
    expect(intervalOf('siem')).toBe(33_000);
    expect(intervalOf('scheduled_reports')).toBe(44_000);
    expect(intervalOf('retention')).toBe(55_000);
    expect(intervalOf('webhook_redelivery')).toBe(66_000);
    expect(intervalOf('knowledge_refresh')).toBe(77_000);
    expect(intervalOf('invoice_close')).toBe(88_000);
    expect(intervalOf('unverified_signups')).toBe(99_000);
    expect(intervalOf('ai_stall')).toBe(12_000);
    expect(intervalOf('ai_sandbox_sessions')).toBe(13_000);
    expect(intervalOf('ai_unresolved_cluster')).toBe(14_000);
    expect(intervalOf('ai_unresolved_merge')).toBe(15_000);
    expect(intervalOf('chat_inactivity')).toBe(16_000);
    expect(intervalOf('ai_scheduled_publish')).toBe(17_000);
    expect(intervalOf('knowledge_chunk_gc')).toBe(18_000);
    expect(intervalOf('ai_suggestion_drafts')).toBe(19_000);
    expect(intervalOf('qa_sampling')).toBe(20_000);
    expect(intervalOf('qa_prescore')).toBe(21_000);
    expect(intervalOf('qa_consistency')).toBe(23_000);
    expect(intervalOf('ai_outcomes_finalize')).toBe(24_000);
    expect(intervalOf('ai_metrics_rollup')).toBe(25_000);
  });

  it('registers retention and the unverified sign-up sweep disabled unless their switches are set — no other job is gated', () => {
    const GATED = ['retention', 'unverified_signups'];
    const off = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() });
    for (const name of GATED)
      expect(off.find((job) => job.name === name)?.enabled, name).toBe(false);
    for (const job of off) {
      if (GATED.includes(job.name)) continue;
      expect(job.enabled, job.name).not.toBe(false);
    }

    // Each switch turns on its own job and nothing else.
    const retention = buildSchedulerJobs({
      db,
      env: testEnv({ RETENTION_ENABLED: 'true' }),
      mailer: new NullMailer(),
    });
    expect(retention.find((job) => job.name === 'retention')?.enabled).toBe(true);
    expect(retention.find((job) => job.name === 'unverified_signups')?.enabled).toBe(false);

    // Off, an unverified account signs in like any other (tm 257.19), so the
    // sweep that deletes one for not having verified runs only while it is on.
    const verification = buildSchedulerJobs({
      db,
      env: testEnv({ SIGNUP_EMAIL_VERIFICATION: 'true' }),
      mailer: new NullMailer(),
    });
    expect(verification.find((job) => job.name === 'unverified_signups')?.enabled).toBe(true);
    expect(verification.find((job) => job.name === 'retention')?.enabled).toBe(false);
  });

  describe('each job resolves against a real database', () => {
    const context = () => ({ signal: new AbortController().signal, logger: silentLogger() });

    it('chat_timeout finds nothing to close and reports zero tenants', async () => {
      const job = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() }).find(
        (j) => j.name === 'chat_timeout',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({ tenants: 0, closed: 0, queue_entries_closed: 0 });
    });

    it('ai_stall finds nothing stalled and reports zero tenants', async () => {
      const job = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() }).find(
        (j) => j.name === 'ai_stall',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({ tenants: 0, stalled: 0, handed_over: 0 });
    });

    it('chat_inactivity finds nothing to pass on and reports zero tenants (tm 340.2)', async () => {
      const job = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() }).find(
        (j) => j.name === 'chat_inactivity',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({
        tenants: 0,
        asked_email: 0,
        replied_here: 0,
        transferred: 0,
        queued: 0,
        unclaimed: 0,
        marked_inactive: 0,
        cleared_inactive: 0,
      });
    });

    it('ai_scheduled_publish finds nothing due and publishes nothing (tm 316.6)', async () => {
      const job = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() }).find(
        (j) => j.name === 'ai_scheduled_publish',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({
        tenants: 0,
        due: 0,
        published: 0,
        refused: 0,
        skipped: 0,
        failed: 0,
        mailed: 0,
      });
    });

    it('knowledge_chunk_gc finds no workspace and deletes nothing (tm 316.6)', async () => {
      const job = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() }).find(
        (j) => j.name === 'knowledge_chunk_gc',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({
        tenants: 0,
        unpublished: 0,
        hidden: 0,
        sources: 0,
        busy: 0,
      });
    });

    it('ai_suggestion_drafts finds no workspace and drafts nothing (tm 318.1)', async () => {
      const job = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() }).find(
        (j) => j.name === 'ai_suggestion_drafts',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({ tenants: 0, opened: 0, drafted: 0, llm: 0, duplicates: 0 });
    });

    it('qa_sampling finds no workspace and queues nothing (tm 319.1)', async () => {
      const job = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() }).find(
        (j) => j.name === 'qa_sampling',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({
        tenants: 0,
        days: 0,
        eligible: 0,
        random: 0,
        mandatory: 0,
        queued: 0,
      });
    });

    it('qa_prescore finds no workspace and scores nothing (tm 319.2)', async () => {
      const job = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() }).find(
        (j) => j.name === 'qa_prescore',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({ tenants: 0, scored: 0, dropped: 0, skipped: 0, failed: 0 });
    });

    it('qa_consistency finds no workspace and queues nothing (tm 319.2)', async () => {
      const job = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() }).find(
        (j) => j.name === 'qa_consistency',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({ tenants: 0, groups: 0, pairs: 0, queued: 0 });
    });

    it('ai_outcomes_finalize and ai_metrics_rollup find no workspace and settle nothing (tm 320.2)', async () => {
      const jobs = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() });
      const finalize = await jobs.find((j) => j.name === 'ai_outcomes_finalize')?.run(context());
      expect(finalize?.counts).toEqual({ tenants: 0, finalized: 0, repeated: 0, unmeasured: 0 });
      const rollup = await jobs.find((j) => j.name === 'ai_metrics_rollup')?.run(context());
      expect(rollup?.counts).toEqual({ tenants: 0, days: 0, rows: 0 });
    });

    it('ai_sandbox_sessions finds nothing expired and deletes nothing (tm 314.2)', async () => {
      const job = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() }).find(
        (j) => j.name === 'ai_sandbox_sessions',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({ purged: 0, batches: 1 });
    });

    it('ai_unresolved_cluster and ai_unresolved_merge find nothing to group (tm 317.2)', async () => {
      const jobs = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() });
      const cluster = await jobs.find((j) => j.name === 'ai_unresolved_cluster')?.run(context());
      expect(cluster?.counts).toEqual({
        tenants: 0,
        embedded: 0,
        rebuilt: 0,
        assigned: 0,
        opened: 0,
        labelled: 0,
        reopened: 0,
        alerted: 0,
      });
      const merge = await jobs.find((j) => j.name === 'ai_unresolved_merge')?.run(context());
      expect(merge?.counts).toEqual({ tenants: 0, merged: 0, absorbed: 0 });
    });

    it('sla finds nothing to mark and reports zero tenants', async () => {
      const job = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() }).find(
        (j) => j.name === 'sla',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({ tenants: 0, marked: 0, notified: 0, unannounced: 0 });
    });

    it('siem finds nothing to export and reports zero tenants', async () => {
      const job = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() }).find(
        (j) => j.name === 'siem',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({ tenants: 0, delivered: 0, failed: 0 });
    });

    it('scheduled_reports finds nothing due and reports zero tenants', async () => {
      const job = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() }).find(
        (j) => j.name === 'scheduled_reports',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({ tenants: 0, delivered: 0, skipped: 0, failed: 0 });
    });

    it('retention, once RETENTION_ENABLED, prunes nothing and reports zero tenants', async () => {
      // A fresh temp dir, not the shared default `MAIL_DIR`: `#pruneMail` sweeps
      // it whole-directory rather than tenant-scoped, so the default would
      // count whatever a developer's own `pnpm dev` happened to leave behind.
      const mailDir = await mkdtemp(join(tmpdir(), 'siyahtus-scheduler-jobs-mail-'));
      const env = testEnv({ RETENTION_ENABLED: 'true', MAIL_DIR: mailDir });
      const job = buildSchedulerJobs({ db, env, mailer: new NullMailer() }).find(
        (j) => j.name === 'retention',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({
        tenants: 0,
        threads: 0,
        visits: 0,
        aiDecisions: 0,
        unresolvedItems: 0,
        sensitiveFiles: 0,
        mailFiles: 0,
        auditEntries: 0,
      });
    });

    it('webhook_redelivery finds nothing owed and reports zero tenants', async () => {
      // Built with the real HTTP sender — which is exactly why an empty
      // database matters here: with nothing queued there is no send to make,
      // so the job resolves without ever touching the network.
      const job = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() }).find(
        (j) => j.name === 'webhook_redelivery',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({
        tenants: 0,
        attempted: 0,
        delivered: 0,
        requeued: 0,
        exhausted: 0,
        skipped: 0,
      });
    });

    it('knowledge_refresh finds nothing due or stale and reports zero tenants', async () => {
      const job = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() }).find(
        (j) => j.name === 'knowledge_refresh',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({
        tenants: 0,
        checked: 0,
        queued: 0,
        failed: 0,
        kb_checked: 0,
        kb_synced: 0,
        kb_deferred: 0,
        table_rows_checked: 0,
        table_rows_synced: 0,
        table_rows_deferred: 0,
        table_rows_stale: 0,
        table_rows_stale_announced: 0,
        table_rows_stale_mailed: 0,
        document_originals_checked: 0,
        document_originals_removed: 0,
        document_originals_failed: 0,
      });
    });

    it('invoice_close finds no closed period and reports zero tenants', async () => {
      const job = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() }).find(
        (j) => j.name === 'invoice_close',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({ tenants: 0, issued: 0, reconstructed: 0, skipped: 0 });
    });

    it('unverified_signups, once SIGNUP_EMAIL_VERIFICATION is on, finds nothing to purge in one batch', async () => {
      // Through the application role, as the server calls it: the purge is a
      // SECURITY DEFINER function granted to that role alone.
      const job = buildSchedulerJobs({
        db,
        env: testEnv({ SIGNUP_EMAIL_VERIFICATION: 'true' }),
        mailer: new NullMailer(),
      }).find((j) => j.name === 'unverified_signups');
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({ purged: 0, batches: 1, invitees: 0 });
    });
  });
});
