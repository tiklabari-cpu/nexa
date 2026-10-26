/**
 * Usage across every workspace, and the daily AI allowance (tm 389.12 ·
 * FR-ADMIN-13 · design.md §C usage, §B3 · PLAN §D218).
 *
 * **One source for a workspace's AI cap** (decision 1): the licence's
 * `ai_daily_{llm,embedding}_tokens_cap` columns (tm 283.2), which this module
 * writes, and nothing in `license_overrides`. What the tenant API applies is
 *
 *     override (until ai_daily_caps_expires_at)  ??  plan default  ??  deployment
 *
 * and {@link capLayers} reports each layer and which one won, through the very
 * function the tenant's budget resolves with (`resolveAiCaps`), so the panel
 * cannot show a cap the workspace is not held to. The plan defaults are the
 * panel's (`platform_settings` `ai.caps`, `ai-plan-caps.ts`) over the plan
 * catalogue's; the deployment's are the environment's, which this process
 * shares with the tenant API.
 *
 * **A change is announced, not waited for** (decision 5): the route publishes
 * `ai.caps_changed` after its commit — the licence, or `*` for a plan default —
 * and every tenant API process drops what it cached (`ai-caps-events.ts`).
 * Missing the message costs at most the cache's minute.
 *
 * `ai_daily_usage`'s row with no licence is the deployment's own counter; it is
 * read as such and never added to a workspace's (the task's trap). Reads name
 * their licence: this connection bypasses row level security.
 */
import { AI_USAGE_METERS, type AiLiveMeter, type AiUsageMeter } from '@siyahtus/types';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env.js';
import { ApiError } from '../../lib/api-error.js';
import { TRIAL_PLAN } from '../../lib/entitlements.js';
import {
  overrideInForce,
  resolveAiCaps,
  storedCap,
  testCap,
  type AiDailyCaps,
} from '../ai/ai-caps.js';
import { aiDailyCaps, utcDayKey } from '../ai/ai-daily-budget.js';
import {
  AI_CAPS_SETTING_KEY,
  parsePlanAiCaps,
  planAiDailyTokens,
  type PlanAiCapDefaults,
} from '../ai/ai-plan-caps.js';
import { currentPeriod } from '../billing/metering.js';
import {
  aiDailyTokensForPlan,
  isPlanId,
  PLAN_IDS,
  type PlanAiDailyTokens,
  type PlanId,
} from '../billing/subscription-service.js';
import { readPlanCapSetting } from './billing.js';
import { lockLicense, type ActionOutcome } from './workspace-actions.js';

type Tx = Prisma.TransactionClient;

const DAY_MS = 86_400_000;
export const GLOBAL_USAGE_DAYS_DEFAULT = 30;
export const GLOBAL_USAGE_DAYS_MAX = 90;
export const TOP_USAGE_DEFAULT = 20;
export const TOP_USAGE_MAX = 100;
/** The workspace detail's history. */
export const WORKSPACE_USAGE_DAYS = 30;

export const TOP_USAGE_METERS = ['llm', 'embedding', 'ai_resolutions', 'api_calls'] as const;
export type TopUsageMeter = (typeof TOP_USAGE_METERS)[number];

export type CapSource = 'override' | 'plan' | 'deployment';

export interface CapLayers {
  effective: number;
  source: CapSource;
  override: number | null;
  plan: number | null;
  deployment: number;
}

export interface WorkspaceAiCaps {
  llm: CapLayers;
  embedding: CapLayers;
  expires_at: string | null;
  in_force: boolean;
}

interface Counter {
  used: number;
  reserved: number;
  cap: number;
}

/** The licence columns a workspace's own caps are read from. */
interface CapColumns {
  aiDailyLlmTokensCap: bigint | null;
  aiDailyEmbeddingTokensCap: bigint | null;
  aiDailyCapsExpiresAt: Date | null;
}

/**
 * Each layer of a workspace's caps and which one applies — `resolveAiCaps`'s
 * answer, with its inputs beside it.
 */
export function capLayers(
  columns: CapColumns,
  plan: string,
  defaults: PlanAiCapDefaults,
  deployment: AiDailyCaps,
  now: number,
): WorkspaceAiCaps {
  const inForce = overrideInForce(columns.aiDailyCapsExpiresAt, now);
  const stored = {
    llm: storedCap(columns.aiDailyLlmTokensCap),
    embedding: storedCap(columns.aiDailyEmbeddingTokensCap),
  };
  const override: PlanAiDailyTokens = {
    llm: inForce ? stored.llm : null,
    embedding: inForce ? stored.embedding : null,
  };
  const planFigures = planAiDailyTokens(
    defaults,
    isPlanId(plan) ? plan : null,
    aiDailyTokensForPlan(plan),
  );
  const resolved = resolveAiCaps({ override, plan: planFigures }, deployment);
  const layer = (meter: AiLiveMeter): CapLayers => ({
    effective: resolved.workspace[meter],
    source:
      override[meter] !== null ? 'override' : planFigures[meter] !== null ? 'plan' : 'deployment',
    override: stored[meter],
    plan: planFigures[meter],
    deployment: deployment[meter].workspace,
  });
  return {
    llm: layer('llm'),
    embedding: layer('embedding'),
    expires_at: columns.aiDailyCapsExpiresAt?.toISOString() ?? null,
    in_force: inForce && (stored.llm !== null || stored.embedding !== null),
  };
}

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The last `days` UTC days, oldest first, as `YYYY-MM-DD` and the counters' `YYYYMMDD`. */
function dayWindow(now: number, days: number): Array<{ date: string; key: string }> {
  const today = new Date(now);
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Array.from({ length: days }, (_, index) => {
    const date = isoDate(todayMs - (days - 1 - index) * DAY_MS);
    return { date, key: date.replaceAll('-', '') };
  });
}

/** The plan a workspace's latest subscription is on, or the trial's. */
const LATEST_PLAN = (licence: string) =>
  Prisma.raw(`COALESCE((SELECT plan FROM subscriptions WHERE license_id = ${licence}
                         ORDER BY created_at DESC LIMIT 1), '${TRIAL_PLAN}')`);

export interface PlatformUsageOptions {
  env: Env;
  now?: () => number;
}

export class PlatformUsage {
  readonly #db: PrismaClient;
  readonly #deployment: AiDailyCaps;
  readonly #now: () => number;

  constructor(db: PrismaClient, options: PlatformUsageOptions) {
    this.#db = db;
    this.#deployment = aiDailyCaps(options.env);
    this.#now = options.now ?? Date.now;
  }

  get deployment(): AiDailyCaps {
    return this.#deployment;
  }

  async global(days: number) {
    const now = this.#now();
    const window = dayWindow(now, days);
    const period = currentPeriod(new Date(now));
    const [daily, records] = await Promise.all([
      this.#db.aiDailyUsage.findMany({
        where: {
          licenseId: null,
          day: { in: window.map((day) => day.key) },
          meter: { in: ['llm', 'embedding'] },
        },
        select: { day: true, meter: true, used: true, reserved: true },
      }),
      this.#db.usageRecord.groupBy({
        by: ['metric'],
        where: { period },
        _sum: { quantity: true },
      }),
    ]);
    const at = new Map(daily.map((row) => [`${row.day}:${row.meter}`, row]));
    const todayKey = window.at(-1)!.key;
    const counter = (meter: AiLiveMeter): Counter => {
      const row = at.get(`${todayKey}:${meter}`);
      return {
        used: Number(row?.used ?? 0n),
        reserved: Number(row?.reserved ?? 0n),
        cap: this.#deployment[meter].global,
      };
    };
    const metric = (name: string) =>
      Number(records.find((row) => row.metric === name)?._sum.quantity ?? 0n);
    return {
      days,
      series: window.map(({ date, key }) => ({
        date,
        llm: Number(at.get(`${key}:llm`)?.used ?? 0n),
        embedding: Number(at.get(`${key}:embedding`)?.used ?? 0n),
      })),
      today: { llm: counter('llm'), embedding: counter('embedding') },
      period: {
        period,
        ai_resolutions: metric('ai_resolutions'),
        api_calls: metric('api_calls'),
      },
    };
  }

  async top(meter: TopUsageMeter, top: number) {
    const now = this.#now();
    if (meter === 'llm' || meter === 'embedding') {
      const day = utcDayKey(new Date(now));
      const [rows, { defaults }] = await Promise.all([
        this.#db.$queryRaw<
          Array<
            CapColumns & {
              license_id: bigint;
              organization_name: string;
              plan: string;
              used: bigint;
            }
          >
        >`
          SELECT u.license_id, o.name AS organization_name, ${LATEST_PLAN('u.license_id')} AS plan,
                 u.used, l.ai_daily_llm_tokens_cap AS "aiDailyLlmTokensCap",
                 l.ai_daily_embedding_tokens_cap AS "aiDailyEmbeddingTokensCap",
                 l.ai_daily_caps_expires_at AS "aiDailyCapsExpiresAt"
            FROM ai_daily_usage u
            JOIN licenses l ON l.id = u.license_id
            JOIN organizations o ON o.id = l.organization_id
           WHERE u.license_id IS NOT NULL AND u.day = ${day} AND u.meter = ${meter}
             AND u.used > 0
           ORDER BY u.used DESC, u.license_id ASC
           LIMIT ${top}`,
        readPlanCapSetting(this.#db),
      ]);
      return {
        meter,
        window: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`,
        data: rows.map((row) => {
          const cap = capLayers(row, row.plan, defaults, this.#deployment, now)[meter].effective;
          const used = Number(row.used);
          return {
            license_id: row.license_id.toString(),
            organization_name: row.organization_name,
            plan: row.plan,
            used,
            limit: cap,
            percent: Math.floor((used * 100) / cap),
          };
        }),
      };
    }

    const period = currentPeriod(new Date(now));
    const rows = await this.#db.$queryRaw<
      Array<{
        license_id: bigint;
        organization_name: string;
        plan: string;
        quantity: bigint;
        included: bigint;
      }>
    >`
      SELECT r.license_id, o.name AS organization_name, ${LATEST_PLAN('r.license_id')} AS plan,
             r.quantity, r.included
        FROM usage_records r
        JOIN licenses l ON l.id = r.license_id
        JOIN organizations o ON o.id = l.organization_id
       WHERE r.period = ${period} AND r.metric = ${meter} AND r.quantity > 0
       ORDER BY r.quantity DESC, r.license_id ASC
       LIMIT ${top}`;
    return {
      meter,
      window: period,
      data: rows.map((row) => {
        const used = Number(row.quantity);
        const included = Number(row.included);
        return {
          license_id: row.license_id.toString(),
          organization_name: row.organization_name,
          plan: row.plan,
          used,
          limit: included,
          percent: included > 0 ? Math.floor((used * 100) / included) : null,
        };
      }),
    };
  }

  /** One workspace's caps, today's counters and its last 30 days — or null for an unknown licence. */
  async workspace(licenseId: bigint, db: PrismaClient | Tx = this.#db) {
    const now = this.#now();
    const [license, planRows, { defaults }] = await Promise.all([
      db.license.findUnique({
        where: { id: licenseId },
        select: {
          id: true,
          aiDailyLlmTokensCap: true,
          aiDailyEmbeddingTokensCap: true,
          aiDailyCapsExpiresAt: true,
          organization: { select: { name: true } },
        },
      }),
      db.subscription.findMany({
        where: { licenseId },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { plan: true },
      }),
      readPlanCapSetting(db),
    ]);
    if (!license) return null;
    const plan = planRows[0]?.plan ?? TRIAL_PLAN;
    const caps = capLayers(license, plan, defaults, this.#deployment, now);

    const window = dayWindow(now, WORKSPACE_USAGE_DAYS);
    const daily = await db.aiDailyUsage.findMany({
      where: { licenseId, day: { in: window.map((day) => day.key) } },
      select: { day: true, meter: true, used: true, reserved: true },
    });
    const at = new Map(daily.map((row) => [`${row.day}:${row.meter}`, row]));
    const todayKey = window.at(-1)!.key;
    const capOf: Record<AiUsageMeter, number> = {
      llm: caps.llm.effective,
      embedding: caps.embedding.effective,
      llm_test: testCap(caps.llm.effective),
      embedding_test: testCap(caps.embedding.effective),
    };
    const today = Object.fromEntries(
      AI_USAGE_METERS.map((meter) => {
        const row = at.get(`${todayKey}:${meter}`);
        return [
          meter,
          {
            used: Number(row?.used ?? 0n),
            reserved: Number(row?.reserved ?? 0n),
            cap: capOf[meter],
          },
        ];
      }),
    ) as Record<AiUsageMeter, Counter>;

    return {
      license_id: license.id.toString(),
      organization_name: license.organization.name,
      plan,
      caps,
      today,
      series: window.map(({ date, key }) => ({
        date,
        llm: Number(at.get(`${key}:llm`)?.used ?? 0n),
        embedding: Number(at.get(`${key}:embedding`)?.used ?? 0n),
      })),
    };
  }

  /** The plans' defaults as the panel shows them: set, catalogue, deployment. */
  async planCaps(db: PrismaClient | Tx = this.#db) {
    const { row, defaults } = await readPlanCapSetting(db);
    return {
      plans: PLAN_IDS.map((plan) => ({
        plan,
        set: { llm: defaults[plan]?.llm ?? null, embedding: defaults[plan]?.embedding ?? null },
        catalogue: aiDailyTokensForPlan(plan),
      })),
      deployment: {
        llm: this.#deployment.llm.workspace,
        embedding: this.#deployment.embedding.workspace,
      },
      updated_at: row?.updatedAt.toISOString() ?? null,
    };
  }
}

// --- Mutations (inside the route's transaction) -------------------------------

export interface WorkspaceAiCapsInput {
  llm: number | null;
  embedding: number | null;
  expiresAt: Date | null;
}

/**
 * Replace the workspace's AI cap override — the whole of it. Both caps null
 * removes it (and its end date); an end date needs a cap beside it and must
 * be ahead. The same values again change nothing and record nothing.
 */
export async function putWorkspaceAiCaps(
  tx: Tx,
  licenseId: bigint,
  input: WorkspaceAiCapsInput,
  now: Date,
): Promise<ActionOutcome> {
  if (input.expiresAt !== null) {
    if (input.llm === null && input.embedding === null) {
      throw ApiError.validation('expires_at needs a cap to end.', {
        reason: 'expires_without_override',
      });
    }
    if (input.expiresAt.getTime() <= now.getTime()) {
      throw ApiError.validation('expires_at must be in the future.', {
        reason: 'expires_at_past',
      });
    }
  }
  await lockLicense(tx, licenseId);
  const before = await tx.license.findUniqueOrThrow({
    where: { id: licenseId },
    select: {
      aiDailyLlmTokensCap: true,
      aiDailyEmbeddingTokensCap: true,
      aiDailyCapsExpiresAt: true,
    },
  });
  // Keyed by meter, not by the request's field names: an audit payload never
  // carries a key that reads like a credential (`platform-audit.test.ts`).
  const next = {
    llm: input.llm,
    embedding: input.embedding,
    expires_at: input.expiresAt?.toISOString() ?? null,
  };
  const previous = {
    llm: storedCap(before.aiDailyLlmTokensCap),
    embedding: storedCap(before.aiDailyEmbeddingTokensCap),
    expires_at: before.aiDailyCapsExpiresAt?.toISOString() ?? null,
  };
  const changed = (Object.keys(next) as Array<keyof typeof next>).filter(
    (field) => next[field] !== previous[field],
  );
  if (changed.length === 0) return { unchanged: true, payload: {} };

  await tx.license.update({
    where: { id: licenseId },
    data: {
      aiDailyLlmTokensCap: input.llm === null ? null : BigInt(input.llm),
      aiDailyEmbeddingTokensCap: input.embedding === null ? null : BigInt(input.embedding),
      aiDailyCapsExpiresAt: input.expiresAt,
    },
  });
  return { unchanged: false, payload: { changed, from: previous, to: next } };
}

/**
 * Replace the plans' default AI caps under `ai.caps`, keeping whatever else
 * the key holds (389.17's deployment figures). A plan whose figures are both
 * null is dropped from the setting — it falls back to the catalogue.
 */
export async function putPlanAiCaps(
  tx: Tx,
  plans: Partial<Record<PlanId, PlanAiDailyTokens>>,
  adminId: string,
  now: Date,
): Promise<ActionOutcome> {
  const [current] = await tx.$queryRaw<Array<{ value: unknown; version: number }>>`
    SELECT value, version FROM platform_settings WHERE key = ${AI_CAPS_SETTING_KEY} FOR UPDATE`;
  const before = parsePlanAiCaps(current?.value ?? null);
  const after: PlanAiCapDefaults = parsePlanAiCaps({ plans });

  const changed: string[] = [];
  for (const plan of PLAN_IDS) {
    for (const meter of ['llm', 'embedding'] as const) {
      if ((before[plan]?.[meter] ?? null) !== (after[plan]?.[meter] ?? null)) {
        changed.push(`${plan}.${meter}`);
      }
    }
  }
  if (changed.length === 0) return { unchanged: true, payload: {} };

  const stored =
    current?.value !== null && typeof current?.value === 'object' && !Array.isArray(current.value)
      ? (current.value as Record<string, unknown>)
      : {};
  const value = { ...stored, plans: after } as unknown as Prisma.InputJsonObject;
  await tx.platformSetting.upsert({
    where: { key: AI_CAPS_SETTING_KEY },
    create: { key: AI_CAPS_SETTING_KEY, value, updatedBy: adminId, updatedAt: now },
    update: { value, updatedBy: adminId, updatedAt: now, version: { increment: 1 } },
  });
  return { unchanged: false, payload: { key: AI_CAPS_SETTING_KEY, changed } };
}
