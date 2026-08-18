/**
 * The job list and its intervals (M-SCHED-a).
 *
 * The names live here rather than next to the implementations because they are
 * the contract three other things are written against: a Redis lock key, a
 * `SCHEDULE_<JOB>_MS` environment key, and a row in the `/health` body. A job
 * renamed in one place and not the others produces a fleet where two instances
 * hold different locks for the same sweep, which is exactly the failure the lock
 * is there to prevent — so the name is declared once and imported.
 *
 * The `run` implementations are registered separately (M-SCHED-b); this module
 * knows only what exists and how often it should happen.
 */
import type { Env } from '../../config/env.js';

/**
 * Every job this deployment schedules, in the order `/health` lists them.
 *
 * The first five are the sweeps that had no scheduler at all (§D113/K1); the
 * sixth carries a failed webhook delivery past the request that triggered it
 * (M-SCHED-e).
 */
export const SCHEDULER_JOB_NAMES = [
  'chat_timeout',
  'sla',
  'siem',
  'scheduled_reports',
  'retention',
  'webhook_redelivery',
] as const;

export type SchedulerJobName = (typeof SCHEDULER_JOB_NAMES)[number];

/** The environment key that overrides a job's interval. */
export function intervalEnvKey(job: SchedulerJobName): string {
  return `SCHEDULE_${job.toUpperCase()}_MS`;
}

/** Just the interval keys, so a caller need not hold a whole parsed `Env`. */
export type SchedulerIntervalEnv = Pick<
  Env,
  | 'SCHEDULE_CHAT_TIMEOUT_MS'
  | 'SCHEDULE_SLA_MS'
  | 'SCHEDULE_SIEM_MS'
  | 'SCHEDULE_SCHEDULED_REPORTS_MS'
  | 'SCHEDULE_RETENTION_MS'
  | 'SCHEDULE_WEBHOOK_REDELIVERY_MS'
>;

/**
 * Interval per job, in milliseconds.
 *
 * Spelled out instead of built from the name at runtime: a dynamic
 * `env[`SCHEDULE_${name}_MS`]` lookup would type-check against anything and go
 * quietly undefined the day a job is renamed, where this stops compiling.
 */
export function jobIntervals(env: SchedulerIntervalEnv): Record<SchedulerJobName, number> {
  return {
    chat_timeout: env.SCHEDULE_CHAT_TIMEOUT_MS,
    sla: env.SCHEDULE_SLA_MS,
    siem: env.SCHEDULE_SIEM_MS,
    scheduled_reports: env.SCHEDULE_SCHEDULED_REPORTS_MS,
    retention: env.SCHEDULE_RETENTION_MS,
    webhook_redelivery: env.SCHEDULE_WEBHOOK_REDELIVERY_MS,
  };
}

export function jobIntervalMs(env: SchedulerIntervalEnv, job: SchedulerJobName): number {
  return jobIntervals(env)[job];
}
