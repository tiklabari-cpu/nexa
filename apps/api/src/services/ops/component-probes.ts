/**
 * What the health leader reports about the modules it can see (tm 389.14 ·
 * FR-ADMIN-20 · design.md §A).
 *
 * `HealthSnapshotPublisher` judges mail, Redis, the database and the scheduler
 * itself. The rest of the root panel's component grid belongs to modules with
 * their own state — the GeoIP database file, the CAPTCHA provider, the AI job
 * queue, webhook redelivery — and this file is where each is turned into a
 * `{ key, state, detail }` the leader writes into the component record. Every
 * probe is a pure function of something already in the process (a status
 * object, the validated environment, the health body just built): none opens a
 * connection or runs a query of its own, because the leader runs them every
 * thirty seconds.
 *
 * A module that is not in this build is `not_installed`, written only when
 * nothing has reported it ({@link reportComponentNotInstalled}): the day its
 * own task makes it report for real, the leader's placeholder must never
 * overwrite that.
 */
import type { CaptchaProvider, OpsComponentKey, OpsComponentState } from '@siyahtus/types';
import type { GeoStatus } from '../geo/geo-locator.js';
import type { HealthSnapshotBody } from './health-snapshot.js';

export interface ComponentProbeResult {
  key: OpsComponentKey;
  state: OpsComponentState;
  detail: string | null;
}

/** A GeoIP file older than this places new address blocks wrongly (runbook geoip-database.md). */
export const GEOIP_STALE_AFTER_DAYS = 90;
/** The oldest unanswered AI job a healthy worker leaves: its poll is half a second. */
export const AI_JOBS_DEGRADED_AFTER_S = 120;
export const AI_JOBS_DOWN_AFTER_S = 900;

const DAY_MS = 86_400_000;

/** Modules the plan names but this build does not contain yet; their tasks make them report. */
export const COMPONENTS_NOT_IN_THIS_BUILD: ReadonlyArray<{
  key: OpsComponentKey;
  detail: string;
}> = [
  { key: 'knowledge_jobs', detail: 'knowledge job queue (tm 312) is not part of this build' },
  { key: 'doc_worker', detail: 'document worker (tm 313) is not part of this build' },
  { key: 'channel_whatsapp', detail: 'WhatsApp live adapter (tm 380) is not part of this build' },
  {
    key: 'channel_meta',
    detail: 'Messenger/Instagram live adapter (tm 381) is not part of this build',
  },
];

export function geoipProbe(status: GeoStatus, now: number): ComponentProbeResult {
  if (status.state === 'disabled') {
    return { key: 'geoip', state: 'not_installed', detail: 'GEOIP_DB_PATH is not set' };
  }
  if (status.state === 'error') {
    return { key: 'geoip', state: 'down', detail: status.detail.error ?? 'database unreadable' };
  }
  const { db_type: type, db_version: version, built_at: builtAt } = status.detail;
  const label = [type, version].filter(Boolean).join(' ') || 'database loaded';
  const ageDays = builtAt === null ? null : Math.floor((now - Date.parse(builtAt)) / DAY_MS);
  if (ageDays !== null && ageDays > GEOIP_STALE_AFTER_DAYS) {
    return { key: 'geoip', state: 'degraded', detail: `${label} · ${ageDays} days old` };
  }
  return {
    key: 'geoip',
    state: 'ok',
    detail: ageDays === null ? label : `${label} · ${ageDays} days old`,
  };
}

/**
 * Whether the widget's human check can run. Provider and key *presence* only —
 * never a key, and never a call to the provider (an outage there is the
 * visitor-facing `unavailable` verdict, not this tile's business).
 */
export function captchaProbe(provider: CaptchaProvider, usable: boolean): ComponentProbeResult {
  if (provider === 'none') {
    return { key: 'captcha', state: 'not_installed', detail: 'CAPTCHA_PROVIDER=none' };
  }
  if (!usable) {
    return {
      key: 'captcha',
      state: 'degraded',
      detail: `${provider} is configured but cannot run (keys missing or not allowed here)`,
    };
  }
  return { key: 'captcha', state: 'ok', detail: `${provider}, keys set` };
}

/** The durable AI queue: how long the oldest owed reply has waited (`ai_jobs_health()`). */
export function aiJobsProbe(health: HealthSnapshotBody['ai_jobs']): ComponentProbeResult | null {
  if (health === null) return null;
  const detail = `${health.pending} pending, ${health.running} running`;
  const age = health.oldest_age_s;
  if (age !== null && age > AI_JOBS_DOWN_AFTER_S) {
    return { key: 'ai_jobs', state: 'down', detail: `${detail}, oldest ${Math.round(age)} s` };
  }
  if (age !== null && age > AI_JOBS_DEGRADED_AFTER_S) {
    return { key: 'ai_jobs', state: 'degraded', detail: `${detail}, oldest ${Math.round(age)} s` };
  }
  return { key: 'ai_jobs', state: 'ok', detail };
}

/**
 * Webhook delivery, judged by the sweep that works the backlog off: the
 * redelivery job is the thing that is either keeping up or failing, and its
 * outcome is already in the snapshot — a backlog count would be a cross-tenant
 * table scan every thirty seconds.
 */
export function webhooksProbe(
  jobs: HealthSnapshotBody['scheduler']['jobs'],
): ComponentProbeResult | null {
  const job = jobs.find((row) => row.name === 'webhook_redelivery');
  if (!job) return null;
  if (!job.enabled) {
    return { key: 'webhooks', state: 'not_installed', detail: 'redelivery sweep is switched off' };
  }
  if (job.last_status === 'error') {
    return {
      key: 'webhooks',
      state: 'degraded',
      detail: `redelivery sweep failing${job.last_error_class ? ` (${job.last_error_class})` : ''}`,
    };
  }
  return { key: 'webhooks', state: 'ok', detail: 'redelivery sweep running' };
}
