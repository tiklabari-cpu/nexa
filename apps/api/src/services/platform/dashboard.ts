/**
 * What the root panel's dashboard reads (tm 389.8 · FR-ADMIN-07 · design.md §C).
 *
 * Counts and states only. A tenant's name, a message, a player, a knowledge
 * article never enters a response from here (requirements §2 — content is
 * reached by impersonation, 389.15, and nowhere else); the dashboard names no
 * workspace at all, it links to the list.
 *
 * Reads as `siyahtus_platform` (BYPASSRLS) through `app.platformDb`, so every
 * count spans all workspaces; sandboxes (`sandbox_of_license_id`) are not
 * counted as workspaces — they are a second tenant of the same customer.
 *
 * Two sources are deliberately not exact: "today's" AI spend is the
 * deployment-wide `ai_daily_usage` row (tokens, not turns — the table the cap
 * enforces on), and the month's resolutions and API calls come from
 * `usage_records`. Counting chats would scan `chats` across every tenant on
 * every dashboard load (it has no cross-tenant time index), which a landing
 * page must not do.
 */
import type { PrismaClient } from '@prisma/client';
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from '@siyahtus/types';
import {
  emptyComponentStatuses,
  readComponentStatuses,
  type ComponentStatus,
} from '../ops/component-status.js';
import { OPS_HEALTH_KEY, OPS_HEALTH_TTL_S, type StoredHealthSnapshot } from '../ops/health-keys.js';
import type { HealthSnapshotBody } from '../ops/health-snapshot.js';

export const DASHBOARD_TRIAL_WINDOW_DAYS = 7;
export const SIGNUP_DAYS_DEFAULT = 30;
export const SIGNUP_DAYS_MAX = 90;
/** A snapshot older than the key's own expiry is stale even if the key lingers. */
export const SNAPSHOT_STALE_AFTER_S = OPS_HEALTH_TTL_S;

const DAY_MS = 86_400_000;

export interface DashboardKpis {
  generated_at: string;
  workspaces: { total: number; by_status: Record<SubscriptionStatus, number> };
  trials_ending_7d: number;
  active_operator_sessions: number;
  pending_payment_requests: number;
  usage: {
    /** `yyyymmdd`, UTC. */
    day: string;
    ai_tokens_today: { llm: number; embedding: number };
    /** `yyyymm`, UTC. */
    period: string;
    ai_resolutions_month: number;
    api_calls_month: number;
  };
}

export interface SignupSeries {
  days: number;
  total: number;
  data: Array<{ date: string; count: number }>;
}

export interface DashboardHealth {
  /** No snapshot, or one older than {@link SNAPSHOT_STALE_AFTER_S}. */
  stale: boolean;
  generated_at: string | null;
  age_s: number | null;
  snapshot: HealthSnapshotBody | null;
  components: ComponentStatus[];
}

interface DashboardRedis {
  get(key: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
}

export interface PlatformDashboardOptions {
  now: () => number;
  /** `PLATFORM_IDLE_TTL`, seconds — a session idle longer is not "active". */
  idleTtlS: number;
}

const pad = (value: number) => String(value).padStart(2, '0');

function dayKey(at: Date): string {
  return `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}`;
}

function isoDate(at: Date): string {
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

export class PlatformDashboard {
  readonly #db: PrismaClient;
  readonly #redis: DashboardRedis;
  readonly #options: PlatformDashboardOptions;

  constructor(db: PrismaClient, redis: DashboardRedis, options: PlatformDashboardOptions) {
    this.#db = db;
    this.#redis = redis;
    this.#options = options;
  }

  async kpis(): Promise<DashboardKpis> {
    const nowMs = this.#options.now();
    const now = new Date(nowMs);
    const trialEnd = new Date(nowMs + DASHBOARD_TRIAL_WINDOW_DAYS * DAY_MS);
    const idleSince = new Date(nowMs - this.#options.idleTtlS * 1000);
    const day = dayKey(now);
    const period = day.slice(0, 6);

    const [statuses, trials, sessions, tokens, usage, payments] = await Promise.all([
      this.#db.$queryRaw<Array<{ status: string; n: number }>>`
        SELECT status, count(*)::int AS n FROM licenses
        WHERE sandbox_of_license_id IS NULL GROUP BY status`,
      this.#db.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM licenses
        WHERE sandbox_of_license_id IS NULL AND status = 'trialing'
          AND trial_ends_at >= ${now} AND trial_ends_at < ${trialEnd}`,
      this.#db.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM platform_sessions
        WHERE stage = 'active' AND expires_at > ${now} AND last_seen_at > ${idleSince}`,
      this.#db.$queryRaw<Array<{ meter: string; n: bigint }>>`
        SELECT meter, COALESCE(sum(used), 0)::bigint AS n FROM ai_daily_usage
        WHERE license_id IS NULL AND day = ${day} AND meter IN ('llm', 'embedding')
        GROUP BY meter`,
      this.#db.$queryRaw<Array<{ metric: string; n: bigint }>>`
        SELECT metric, COALESCE(sum(quantity), 0)::bigint AS n FROM usage_records
        WHERE period = ${period} AND metric IN ('ai_resolutions', 'api_calls')
        GROUP BY metric`,
      this.#pendingPaymentRequests(),
    ]);

    const byStatus = Object.fromEntries(SUBSCRIPTION_STATUSES.map((s) => [s, 0])) as Record<
      SubscriptionStatus,
      number
    >;
    let total = 0;
    for (const row of statuses) {
      total += row.n;
      if ((SUBSCRIPTION_STATUSES as readonly string[]).includes(row.status)) {
        byStatus[row.status as SubscriptionStatus] = row.n;
      }
    }
    const meter = (name: string) => Number(tokens.find((row) => row.meter === name)?.n ?? 0);
    const metric = (name: string) => Number(usage.find((row) => row.metric === name)?.n ?? 0);

    return {
      generated_at: now.toISOString(),
      workspaces: { total, by_status: byStatus },
      trials_ending_7d: trials[0]?.n ?? 0,
      active_operator_sessions: sessions[0]?.n ?? 0,
      pending_payment_requests: payments,
      usage: {
        day,
        ai_tokens_today: { llm: meter('llm'), embedding: meter('embedding') },
        period,
        ai_resolutions_month: metric('ai_resolutions'),
        api_calls_month: metric('api_calls'),
      },
    };
  }

  /**
   * The manual crypto payment queue (tm 382) — 0 until its table exists. The
   * table is looked up, not assumed: the dashboard ships before the queue, and
   * a missing relation must not be a 500 on the landing page.
   */
  async #pendingPaymentRequests(): Promise<number> {
    try {
      const exists = await this.#db.$queryRaw<Array<{ present: boolean }>>`
        SELECT to_regclass('public.crypto_payment_requests') IS NOT NULL AS present`;
      if (!exists[0]?.present) return 0;
      const rows = await this.#db.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM crypto_payment_requests WHERE status = 'pending'`;
      return rows[0]?.n ?? 0;
    } catch {
      return 0;
    }
  }

  /** New workspaces per UTC day, oldest first, today included, zero days filled in. */
  async signups(days: number): Promise<SignupSeries> {
    const today = new Date(this.#options.now());
    const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const startMs = todayMs - (days - 1) * DAY_MS;
    const rows = await this.#db.$queryRaw<Array<{ d: Date; n: number }>>`
      SELECT (created_at AT TIME ZONE 'UTC')::date AS d, count(*)::int AS n FROM licenses
      WHERE sandbox_of_license_id IS NULL AND created_at >= ${new Date(startMs)}
      GROUP BY 1`;
    const counts = new Map(rows.map((row) => [isoDate(row.d), row.n]));
    const data = Array.from({ length: days }, (_, index) => {
      const date = isoDate(new Date(startMs + index * DAY_MS));
      return { date, count: counts.get(date) ?? 0 };
    });
    return { days, total: data.reduce((sum, row) => sum + row.count, 0), data };
  }

  /**
   * The tenant API leader's last publication and the component record. Redis
   * unreachable, a missing key or an unreadable value all answer 200 with
   * `stale: true` — the health view is the one screen that must still render
   * when the thing it describes is down.
   */
  async health(): Promise<DashboardHealth> {
    const [raw, components] = await Promise.all([
      this.#redis.get(OPS_HEALTH_KEY).catch(() => null),
      readComponentStatuses(this.#redis).catch(() => emptyComponentStatuses()),
    ]);
    const stored = parseStored(raw);
    if (stored === null) {
      return { stale: true, generated_at: null, age_s: null, snapshot: null, components };
    }
    const ageMs = this.#options.now() - Date.parse(stored.generated_at);
    const ageS = Math.max(0, Math.round(ageMs / 100) / 10);
    return {
      stale: ageS > SNAPSHOT_STALE_AFTER_S,
      generated_at: stored.generated_at,
      age_s: ageS,
      snapshot: stored.health,
      components,
    };
  }
}

function parseStored(raw: string | null): StoredHealthSnapshot | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredHealthSnapshot>;
    if (typeof value.generated_at !== 'string' || Number.isNaN(Date.parse(value.generated_at))) {
      return null;
    }
    if (typeof value.health !== 'object' || value.health === null) return null;
    return value as StoredHealthSnapshot;
  } catch {
    return null;
  }
}
