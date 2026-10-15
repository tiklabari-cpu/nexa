/**
 * The AI usage screen's arithmetic (tm 283.3 · AI-16, AI-16-S3): turn the
 * counters (`ai_daily_usage`), the ledger (`ai_usage_events`) and the caps
 * into the numbers `GET /ai/usage` answers with. Pure — the route reads the
 * rows, this shapes them — so the rules that matter are tested without a
 * database:
 *
 *   - **The day is UTC**, as the cap's is: a 30-day series keyed `yyyy-mm-dd`,
 *     today last, every day present (a day with no row is zeros, not a gap),
 *     and the screen says so. Not the workspace's time zone (ID-04): the bars
 *     would stop adding up to the allowance they are drawn against.
 *   - **Tokens come from the counter, the breakdown from the ledger.** The
 *     counter is what the cap counts; the ledger says which feature spent it.
 *     They agree unless a ledger row failed to write (logged, best-effort), in
 *     which case the counter is the one that is right.
 *   - **Money is an estimate, at today's prices, or absent.** Computed from
 *     the ledger's input/output split with the operator's unit prices at the
 *     moment of reading; never stored. A meter whose price is not configured
 *     gets no money field at all — not a zero, which would read as "free".
 */
import {
  AI_USAGE_METERS,
  aiLiveMeterOf,
  type AiUsageMeter,
  type AiUsageSurface,
} from '@siyahtus/types';
import type { Env } from '../../config/env.js';
import { utcDayKey } from './ai-daily-budget.js';

/** Unit prices in USD per million tokens, per live meter; null = not configured. */
export interface AiPrices {
  llm: { input: number; output: number } | null;
  embedding: number | null;
}

/** The three `AI_PRICE_*` settings. The LLM's price needs both halves. */
export function aiPrices(
  env: Pick<
    Env,
    | 'AI_PRICE_LLM_INPUT_USD_PER_MTOK'
    | 'AI_PRICE_LLM_OUTPUT_USD_PER_MTOK'
    | 'AI_PRICE_EMBEDDING_USD_PER_MTOK'
  >,
): AiPrices {
  const input = env.AI_PRICE_LLM_INPUT_USD_PER_MTOK;
  const output = env.AI_PRICE_LLM_OUTPUT_USD_PER_MTOK;
  return {
    llm: input !== undefined && output !== undefined ? { input, output } : null,
    embedding: env.AI_PRICE_EMBEDDING_USD_PER_MTOK ?? null,
  };
}

/** Dollars to a hundredth of a cent — what an estimate can honestly claim. */
function roundUsd(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * The estimated cost of `input` + `output` tokens on `meter`, or null when
 * that meter has no price. A test meter is priced as its live one: the same
 * provider bills it. An embedding has no output.
 */
export function estimateCostUsd(
  meter: AiUsageMeter,
  tokens: { input: number; output: number },
  prices: AiPrices,
): number | null {
  if (aiLiveMeterOf(meter) === 'llm') {
    if (!prices.llm) return null;
    return roundUsd((tokens.input * prices.llm.input + tokens.output * prices.llm.output) / 1e6);
  }
  if (prices.embedding === null) return null;
  return roundUsd(((tokens.input + tokens.output) * prices.embedding) / 1e6);
}

/** How many days the series covers, today included. */
export const AI_USAGE_WINDOW_DAYS = 30;

/** The window's UTC days as `yyyymmdd`, oldest first, ending with `now`'s. */
export function usageWindowDays(now: Date, days = AI_USAGE_WINDOW_DAYS): string[] {
  const out: string[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    out.push(
      utcDayKey(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back)),
      ),
    );
  }
  return out;
}

/** `yyyymmdd` → `yyyy-mm-dd`. */
function isoDay(day: string): string {
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
}

export interface CounterRow {
  day: string;
  meter: string;
  used: number;
  reserved: number;
}

export interface LedgerRow {
  day: string;
  surface: string;
  meter: string;
  input: number;
  output: number;
}

export interface UsageReportInput {
  now: Date;
  /** The workspace's caps per meter, as calls are checked against them now. */
  caps: Record<AiUsageMeter, number>;
  /** The workspace's `ai_daily_usage` rows within the window. */
  counters: readonly CounterRow[];
  /** The workspace's ledger, summed per (day, surface, meter), within the window. */
  ledger: readonly LedgerRow[];
  prices: AiPrices;
}

export interface UsageMeterToday {
  meter: AiUsageMeter;
  used: number;
  reserved: number;
  cap: number;
  /** `used` as a share of `cap`, in percent, to one decimal. May pass 100. */
  percent: number;
  cost_usd?: number;
}

export interface UsageDay {
  day: string;
  llm: number;
  embedding: number;
  llm_test: number;
  embedding_test: number;
}

export interface UsageSurface {
  surface: AiUsageSurface;
  meter: AiUsageMeter;
  input_tokens: number;
  output_tokens: number;
  cost_usd?: number;
}

export interface UsageReport {
  day: string;
  resets_at: string;
  window_days: number;
  meters: UsageMeterToday[];
  daily: UsageDay[];
  surfaces: UsageSurface[];
  pricing?: {
    currency: 'USD';
    estimated: true;
    llm_input_usd_per_mtok?: number;
    llm_output_usd_per_mtok?: number;
    embedding_usd_per_mtok?: number;
  };
}

function isUsageMeter(meter: string): meter is AiUsageMeter {
  return (AI_USAGE_METERS as readonly string[]).includes(meter);
}

/** Shape the screen's numbers. Rows outside the window, or on an unknown meter, are ignored. */
export function buildUsageReport(input: UsageReportInput): UsageReport {
  const days = usageWindowDays(input.now);
  const today = days[days.length - 1]!;
  const inWindow = new Set(days);

  const daily = new Map<string, UsageDay>(
    days.map((day) => [
      day,
      { day: isoDay(day), llm: 0, embedding: 0, llm_test: 0, embedding_test: 0 },
    ]),
  );
  const todayCounter = new Map<AiUsageMeter, { used: number; reserved: number }>();
  for (const row of input.counters) {
    if (!inWindow.has(row.day) || !isUsageMeter(row.meter)) continue;
    daily.get(row.day)![row.meter] += row.used;
    if (row.day === today) todayCounter.set(row.meter, { used: row.used, reserved: row.reserved });
  }

  const todayTokens = new Map<AiUsageMeter, { input: number; output: number }>();
  const bySurface = new Map<string, UsageSurface>();
  for (const row of input.ledger) {
    if (!inWindow.has(row.day) || !isUsageMeter(row.meter)) continue;
    const key = `${row.surface}\u0000${row.meter}`;
    const entry = bySurface.get(key) ?? {
      surface: row.surface as AiUsageSurface,
      meter: row.meter,
      input_tokens: 0,
      output_tokens: 0,
    };
    entry.input_tokens += row.input;
    entry.output_tokens += row.output;
    bySurface.set(key, entry);
    if (row.day === today) {
      const sum = todayTokens.get(row.meter) ?? { input: 0, output: 0 };
      sum.input += row.input;
      sum.output += row.output;
      todayTokens.set(row.meter, sum);
    }
  }

  const priced = (meter: AiUsageMeter, tokens: { input: number; output: number }) => {
    const cost = estimateCostUsd(meter, tokens, input.prices);
    return cost === null ? {} : { cost_usd: cost };
  };

  const meters = AI_USAGE_METERS.map((meter): UsageMeterToday => {
    const counter = todayCounter.get(meter) ?? { used: 0, reserved: 0 };
    const cap = input.caps[meter];
    return {
      meter,
      used: counter.used,
      reserved: counter.reserved,
      cap,
      percent: Math.round((counter.used * 1000) / cap) / 10,
      ...priced(meter, todayTokens.get(meter) ?? { input: 0, output: 0 }),
    };
  });

  const surfaces = [...bySurface.values()]
    .sort(
      (a, b) =>
        b.input_tokens + b.output_tokens - (a.input_tokens + a.output_tokens) ||
        a.surface.localeCompare(b.surface) ||
        a.meter.localeCompare(b.meter),
    )
    .map((entry) => ({
      ...entry,
      ...priced(entry.meter, { input: entry.input_tokens, output: entry.output_tokens }),
    }));

  const { llm, embedding } = input.prices;
  const pricing =
    llm || embedding !== null
      ? {
          currency: 'USD' as const,
          estimated: true as const,
          ...(llm
            ? { llm_input_usd_per_mtok: llm.input, llm_output_usd_per_mtok: llm.output }
            : {}),
          ...(embedding !== null ? { embedding_usd_per_mtok: embedding } : {}),
        }
      : undefined;

  const tomorrow = new Date(
    Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), input.now.getUTCDate() + 1),
  );
  return {
    day: isoDay(today),
    resets_at: tomorrow.toISOString(),
    window_days: days.length,
    meters,
    daily: [...daily.values()],
    surfaces,
    ...(pricing ? { pricing } : {}),
  };
}
