/**
 * The Redis side of the health publication (tm 389.8) — kept apart from the
 * publisher so the platform process, which only reads, imports a file with no
 * dependencies instead of the tenant API's scheduler and mail modules.
 */
import type { SchedulerDetail } from '../scheduler/types.js';
import type { HealthSnapshotBody } from './health-snapshot.js';

export const OPS_HEALTH_KEY = 'siyahtus:ops:health';
/** The key's expiry: with the leader gone, nothing renews it. */
export const OPS_HEALTH_TTL_S = 90;

export interface StoredHealthSnapshot {
  /** ISO-8601, the publisher's clock. */
  generated_at: string;
  health: HealthSnapshotBody;
}

/**
 * The scheduler's job table for the root panel (tm 389.14): the leader's
 * {@link SchedulerDetail}, published beside the health body with the same
 * 90-second expiry.
 */
export const OPS_SCHEDULER_KEY = 'siyahtus:ops:scheduler';

export interface StoredSchedulerDetail {
  generated_at: string;
  scheduler: SchedulerDetail;
}

/**
 * The outcome of the last "run now" per job (tm 389.14): a Redis hash, one JSON
 * field per job name, written by the process that ran — or refused — the
 * request. Apart from {@link OPS_SCHEDULER_KEY} because the instance that ran
 * it is not necessarily the one publishing the job table.
 */
export const OPS_JOB_RUNS_KEY = 'siyahtus:ops:job-runs';

export interface StoredJobRun {
  /** ISO-8601, when the request was settled. */
  at: string;
  result: 'finished' | 'already_running' | 'disabled' | 'unknown_job';
  status: 'ok' | 'error' | null;
  duration_ms: number | null;
  error_class: string | null;
}

/** One claim per "run now" request id, so exactly one process acts on a broadcast. */
export const OPS_JOB_CLAIM_PREFIX = 'siyahtus:platform:run-claim:';
export const OPS_JOB_CLAIM_TTL_S = 120;
