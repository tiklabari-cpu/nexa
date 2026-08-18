/**
 * `buildSchedulerJobs` — wiring the five sweeps into `JobDefinition`s
 * (M-SCHED-b · §D113/K1).
 *
 * Each sweep's own behaviour — does an idle chat actually close, does a
 * breach actually get marked — is already proven against real fixtures in
 * `test/integration/{chat-timeout,sla,siem-sink,scheduled-reports-sweep,
 * retention}.test.ts`. This suite is only about what this module adds on top
 * of that: does every job get the interval its own `SCHEDULE_<JOB>_MS` names,
 * does `retention` alone answer to `RETENTION_ENABLED`, and does calling
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

  it('registers the five sweeps that had no scheduler — not webhook redelivery, which is M-SCHED-e', () => {
    const jobs = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() });
    // Also the order `/health` lists them in: registration order.
    expect(jobs.map((job) => job.name)).toEqual([
      'chat_timeout',
      'sla',
      'siem',
      'scheduled_reports',
      'retention',
    ]);
  });

  it('gives each job its own SCHEDULE_<JOB>_MS interval', () => {
    const env = testEnv({
      SCHEDULE_CHAT_TIMEOUT_MS: '11000',
      SCHEDULE_SLA_MS: '22000',
      SCHEDULE_SIEM_MS: '33000',
      SCHEDULE_SCHEDULED_REPORTS_MS: '44000',
      SCHEDULE_RETENTION_MS: '55000',
    });
    const jobs = buildSchedulerJobs({ db, env, mailer: new NullMailer() });
    const intervalOf = (name: string): number | undefined =>
      jobs.find((job) => job.name === name)?.intervalMs;

    expect(intervalOf('chat_timeout')).toBe(11_000);
    expect(intervalOf('sla')).toBe(22_000);
    expect(intervalOf('siem')).toBe(33_000);
    expect(intervalOf('scheduled_reports')).toBe(44_000);
    expect(intervalOf('retention')).toBe(55_000);
  });

  it('registers retention disabled unless RETENTION_ENABLED is set — the other four are never gated', () => {
    const off = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() });
    expect(off.find((job) => job.name === 'retention')?.enabled).toBe(false);
    for (const job of off) {
      if (job.name === 'retention') continue;
      expect(job.enabled).not.toBe(false);
    }

    const on = buildSchedulerJobs({
      db,
      env: testEnv({ RETENTION_ENABLED: 'true' }),
      mailer: new NullMailer(),
    });
    expect(on.find((job) => job.name === 'retention')?.enabled).toBe(true);
  });

  describe('each job resolves against a real database', () => {
    const context = () => ({ signal: new AbortController().signal, logger: silentLogger() });

    it('chat_timeout finds nothing to close and reports zero tenants', async () => {
      const job = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() }).find(
        (j) => j.name === 'chat_timeout',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({ tenants: 0, closed: 0 });
    });

    it('sla finds nothing to mark and reports zero tenants', async () => {
      const job = buildSchedulerJobs({ db, env: testEnv(), mailer: new NullMailer() }).find(
        (j) => j.name === 'sla',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({ tenants: 0, marked: 0, notified: 0 });
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
      const mailDir = await mkdtemp(join(tmpdir(), 'nexa-scheduler-jobs-mail-'));
      const env = testEnv({ RETENTION_ENABLED: 'true', MAIL_DIR: mailDir });
      const job = buildSchedulerJobs({ db, env, mailer: new NullMailer() }).find(
        (j) => j.name === 'retention',
      );
      const outcome = await job?.run(context());
      expect(outcome?.counts).toEqual({
        tenants: 0,
        threads: 0,
        visits: 0,
        mailFiles: 0,
        auditEntries: 0,
      });
    });
  });
});
