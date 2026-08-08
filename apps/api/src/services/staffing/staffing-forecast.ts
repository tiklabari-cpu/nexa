/**
 * Deterministic staffing forecast (PRD §5.3-Vardiya, WORKSCHED-f).
 *
 * Answers one question for every hour of a week: *how many agents does this
 * hour need, and how many were actually there?* The inputs are history — chats
 * that started (WORKSCHED-e) and online minutes that were logged
 * (WORKSCHED-d) — and the output is a fixed 7 × 24 grid of
 * `{requiredAgents, scheduledAgents, gap}`.
 *
 * ## Deterministic, and no model
 *
 * The same input always produces byte-identical output: no clock is read, no
 * randomness is drawn, no LLM and no fitted model is involved (a binding scope
 * decision, PLAN §5.2.22). Everything here is arithmetic anyone can redo on
 * paper, which matters more than sophistication would: a staffing number is
 * *plausible whatever it says*, so a wrong one is not noticed, it is staffed
 * to. Being able to point at the two numbers that produced a cell is what makes
 * it possible to disagree with it.
 *
 * ## The capacity model, in full
 *
 * Little's law, and nothing more. Chats arrive in a given hour at a rate λ and
 * each occupies an agent for T minutes, so the number of chats open at once
 * averages `L = λ × T / 60`. One agent holds `concurrentChatsLimit` of them
 * simultaneously (`AgentMembership.concurrentChatsLimit`, schema default 6), so
 *
 *     requiredAgents = ceil( (chats / occurrences) × (averageChatMinutes / 60)
 *                            / concurrentChatsLimit )
 *
 * where `occurrences` is how many times that weekday-hour actually occurred
 * inside the observed window — four Tuesday 14:00s in a 28-day window, so 80
 * chats there means an average of 20 an hour, not 80.
 *
 * The ceiling means a cell that produces a number always asks for at least one
 * agent: chats arrived, so somebody has to be there. What this model
 * deliberately does *not* do is size for a peak or a service level — an
 * Erlang-C staffing target needs an answer-time objective the PRD does not
 * state, and inventing one would bury a product decision inside arithmetic.
 * This is the mean load; a busier-than-average hour will queue.
 *
 * ## Unknown is not zero
 *
 * Two separate ways a cell can be unknown, and neither is ever reported as 0:
 *
 *   - **Too little history** → `requiredAgents: null`, `lowConfidence: true`.
 *     Below {@link DEFAULT_MINIMUM_SAMPLE_CHATS} observed chats a rate is noise;
 *     staffing a week from one Tuesday's four chats is a decision the sample
 *     cannot support. Zero chats observed is the same statement, not the
 *     stronger claim that nobody will ever write in that hour.
 *   - **No presence history** → `scheduledAgents: null`, and therefore
 *     `gap: null`. A workspace that has never recorded presence has *unknown*
 *     coverage (`presenceCoverage` returns `null` for exactly this, WORKSCHED-d);
 *     subtracting a 0 that means "we don't know" would report a full staffing
 *     shortfall for every hour of a week nobody has data about. Once a log
 *     exists, a cell with no online minutes is a real 0 and is reported as one.
 *
 * ## Pure, and blind to the tenant
 *
 * No Fastify, no Prisma, no env — the same philosophy as `reports-metrics.ts`
 * and `presence-coverage.ts`, so the whole capacity model is unit-testable on
 * paper values. It goes one step further than pure: coverage arrives as
 * *minutes already summed across agents*, so this module never sees an agent
 * id, a license id or any other tenant datum. Isolation cannot be broken here
 * because there is nothing here to leak; it is proved where the rows are read
 * (WORKSCHED-d, -e, -g).
 *
 * ## What the caller (WORKSCHED-g) must supply
 *
 * Both grids are keyed by **UTC** `dayOfWeek` (0 = Sunday … 6 = Saturday, the
 * convention `Date.getUTCDay()` and Postgres `EXTRACT(DOW …)` share) and UTC
 * `hour`, and both must be read over the same `[from, to)` window that is passed
 * here — the window is what turns totals into rates. Coverage is built by
 * folding `presenceCoverage()` per calendar day of the window into the weekday
 * bucket that day fell on; volume by grouping the breakdown query on
 * `EXTRACT(DOW …)` alongside its existing hour bucket.
 *
 * Field names are camelCase because this is an internal module; the endpoint
 * serialises them to the contract's snake_case (`required_agents`,
 * `scheduled_agents`, `low_confidence`), the way `reports.ts` already does for
 * every other service value.
 */

/** UTC weekday count and hours per day — the fixed axes of the output grid. */
const DAYS_PER_WEEK = 7;
const HOURS_PER_DAY = 24;
/** 7 × 24 = the number of cells in one week, and the length of every grid. */
const CELLS_PER_WEEK = DAYS_PER_WEEK * HOURS_PER_DAY;

const HOUR_MS = 3_600_000;
const MINUTES_PER_HOUR = 60;

/**
 * Below this many observed chats a cell reports `null` rather than a number.
 *
 * ASSUMPTION (PLAN §5.2.22 open question 4 — the PRD states no figure): one
 * fixed threshold, aligned with the product's existing low-base rule
 * (`apps/web/src/features/playbook/performance.ts` `LOW_BASE_THRESHOLD = 20`),
 * so there is a single "how few is too few" number in Nexa instead of two that
 * drift apart. It is the whole cell's observed chats — not the per-hour average —
 * because it measures how much evidence there is, and evidence accumulates with
 * every occurrence of that hour. Overridable per call so a surface that wants a
 * different confidence bar sets it explicitly rather than editing this constant.
 */
export const DEFAULT_MINIMUM_SAMPLE_CHATS = 20;

/** Chats that started in one UTC (weekday, hour) cell, summed over the window. */
export interface VolumeCell {
  /** 0 = Sunday … 6 = Saturday (UTC). */
  dayOfWeek: number;
  /** 0-23 (UTC). */
  hour: number;
  /** Chats started in this cell across every occurrence of it in the window. */
  chats: number;
}

/**
 * Online minutes in one UTC (weekday, hour) cell, summed over the window **and
 * over every agent** — see the header: the agent dimension is summed away by
 * the caller so this module holds no tenant data.
 */
export interface CoverageCell {
  /** 0 = Sunday … 6 = Saturday (UTC). */
  dayOfWeek: number;
  /** 0-23 (UTC). */
  hour: number;
  /** Agent-minutes of `accepting_chats` presence recorded in this cell. */
  onlineMinutes: number;
}

export interface StaffingForecastInput {
  /** Historical chat volume per cell (WORKSCHED-e). */
  volume: readonly VolumeCell[];
  /**
   * Presence coverage per cell (WORKSCHED-d), or `null` when the log says
   * nothing about this window — which makes `scheduledAgents` and `gap` null
   * rather than 0.
   */
  coverage: readonly CoverageCell[] | null;
  /** Start of the observed window, inclusive — the same one both grids were read over. */
  from: Date;
  /** End of the observed window, exclusive. */
  to: Date;
  /**
   * How many chats one agent handles at once — `AgentMembership.concurrentChatsLimit`
   * (schema default 6). May be fractional: with per-agent limits the caller's
   * honest figure is their mean, not any one agent's setting.
   */
  concurrentChatsLimit: number;
  /** Mean handling time of a chat, in minutes. */
  averageChatMinutes: number;
  /** Confidence bar; defaults to {@link DEFAULT_MINIMUM_SAMPLE_CHATS}. */
  minimumSampleChats?: number;
}

export interface StaffingForecastCell {
  /** 0 = Sunday … 6 = Saturday (UTC). */
  dayOfWeek: number;
  /** 0-23 (UTC). */
  hour: number;
  /** Chats observed in this cell across the window — what the verdict rests on. */
  observedChats: number;
  /** Whole agents this hour's mean load needs, or `null` on too little history. */
  requiredAgents: number | null;
  /** Mean agents online in this hour, or `null` when presence is unknown. */
  scheduledAgents: number | null;
  /** `requiredAgents − scheduledAgents`: positive is a shortfall, negative is slack. */
  gap: number | null;
  /** True exactly when `requiredAgents` is null — this cell has too little history. */
  lowConfidence: boolean;
}

export interface StaffingForecast {
  /** Exactly {@link CELLS_PER_WEEK} cells, ordered day 0-6 then hour 0-23. */
  cells: StaffingForecastCell[];
  /** False when presence coverage was unknown — every `gap` is null. */
  coverageKnown: boolean;
  /** True when *no* cell cleared the sample bar: the window forecasts nothing. */
  lowConfidence: boolean;
  /** The inputs the numbers were derived from, echoed so a cell can be explained. */
  concurrentChatsLimit: number;
  averageChatMinutes: number;
  minimumSampleChats: number;
}

/** Three decimals, the precision `reports-metrics.round` settled on. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function assertTime(value: Date, label: string): number {
  const time = value instanceof Date ? value.getTime() : Number.NaN;
  if (!Number.isFinite(time))
    throw new TypeError(`staffingForecast: ${label} must be a valid Date.`);
  return time;
}

/** A rate divisor: finite and strictly positive, so no division by zero and no Infinity. */
function assertPositive(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`staffingForecast: ${label} must be a finite number.`);
  }
  if (value <= 0) throw new RangeError(`staffingForecast: ${label} must be greater than 0.`);
  return value;
}

/** A tally: finite and not negative. Negative history is a caller bug, not a small number. */
function assertCount(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`staffingForecast: ${label} must be a finite number.`);
  }
  if (value < 0) throw new RangeError(`staffingForecast: ${label} must not be negative.`);
  return value;
}

function assertAxis(value: number, max: number, label: string): number {
  if (!Number.isInteger(value))
    throw new TypeError(`staffingForecast: ${label} must be an integer.`);
  if (value < 0 || value > max) {
    throw new RangeError(`staffingForecast: ${label} must be between 0 and ${max}.`);
  }
  return value;
}

function cellIndex(dayOfWeek: number, hour: number): number {
  return dayOfWeek * HOURS_PER_DAY + hour;
}

/** The week cell an instant falls in, in UTC. */
function cellIndexAt(ms: number): number {
  const moment = new Date(ms);
  return cellIndex(moment.getUTCDay(), moment.getUTCHours());
}

/**
 * Fold `{dayOfWeek, hour, …}` rows into a dense 168-slot grid.
 *
 * A repeated cell throws instead of being summed: two rows for the same hour
 * means the caller grouped its query twice over, and silently adding them would
 * double a forecast in a way nothing downstream could detect.
 */
function toGrid<T extends { dayOfWeek: number; hour: number }>(
  cells: readonly T[],
  label: string,
  valueOf: (cell: T) => number,
  valueLabel: string,
): number[] {
  if (!Array.isArray(cells)) throw new TypeError(`staffingForecast: ${label} must be an array.`);

  const grid = new Array<number>(CELLS_PER_WEEK).fill(0);
  const seen = new Set<number>();

  for (const cell of cells) {
    const dayOfWeek = assertAxis(cell.dayOfWeek, DAYS_PER_WEEK - 1, `${label}.dayOfWeek`);
    const hour = assertAxis(cell.hour, HOURS_PER_DAY - 1, `${label}.hour`);
    const index = cellIndex(dayOfWeek, hour);
    if (seen.has(index)) {
      throw new RangeError(
        `staffingForecast: ${label} lists day ${dayOfWeek} hour ${hour} more than once.`,
      );
    }
    seen.add(index);
    grid[index] = assertCount(valueOf(cell), `${label}.${valueLabel}`);
  }

  return grid;
}

/**
 * Add a sub-window to the occurrence weights, splitting it at hour boundaries.
 *
 * Epoch milliseconds and UTC hours share an origin, so a boundary is integer
 * arithmetic — no timezone conversion, and therefore no DST discontinuity,
 * enters the walk. Only ever called on spans shorter than two hours (see
 * {@link occurrenceWeights}), so the loop is bounded by construction.
 */
function addSlice(weights: number[], startMs: number, endMs: number): void {
  let cursor = startMs;
  while (cursor < endMs) {
    const hourEnd = Math.floor(cursor / HOUR_MS) * HOUR_MS + HOUR_MS;
    const sliceEnd = Math.min(endMs, hourEnd);
    const index = cellIndexAt(cursor);
    weights[index] = (weights[index] ?? 0) + (sliceEnd - cursor) / HOUR_MS;
    cursor = sliceEnd;
  }
}

/**
 * How many times each week cell occurred inside `[fromMs, toMs)`, in hours — the
 * divisor that turns "80 chats" into "20 an hour".
 *
 * Fractional on purpose: a window that covers half of Monday 09:00 gives that
 * cell 0.5, because the volume query counted only that half hour's chats and
 * dividing by a whole occurrence would halve the rate.
 *
 * The whole hours in the middle are counted arithmetically rather than walked —
 * every complete week contributes exactly 1 to all 168 cells, so only the
 * remainder (at most 167 hours) is stepped through. Without that, a caller
 * passing a century-wide range would spin through millions of iterations inside
 * an HTTP request; the range parser upstream (`resolveRange`) caps nothing.
 */
function occurrenceWeights(fromMs: number, toMs: number): number[] {
  const weights = new Array<number>(CELLS_PER_WEEK).fill(0);
  const firstWholeHour = Math.ceil(fromMs / HOUR_MS) * HOUR_MS;
  const lastWholeHour = Math.floor(toMs / HOUR_MS) * HOUR_MS;

  // Shorter than two hours: it touches at most two cells, so walk it directly.
  if (lastWholeHour <= firstWholeHour) {
    addSlice(weights, fromMs, toMs);
    return weights;
  }

  if (firstWholeHour > fromMs) addSlice(weights, fromMs, firstWholeHour);
  if (toMs > lastWholeHour) addSlice(weights, lastWholeHour, toMs);

  const wholeHours = (lastWholeHour - firstWholeHour) / HOUR_MS;
  const fullWeeks = Math.floor(wholeHours / CELLS_PER_WEEK);
  if (fullWeeks > 0) {
    for (let index = 0; index < CELLS_PER_WEEK; index += 1) {
      weights[index] = (weights[index] ?? 0) + fullWeeks;
    }
  }

  const remainder = wholeHours % CELLS_PER_WEEK;
  for (let step = 0; step < remainder; step += 1) {
    const index = cellIndexAt(firstWholeHour + step * HOUR_MS);
    weights[index] = (weights[index] ?? 0) + 1;
  }

  return weights;
}

/**
 * The 7 × 24 staffing grid for one observed window — see the module header for
 * the model, the unknown-is-not-zero rules and what the caller must supply.
 *
 * Throws (rather than returning a plausible number) on anything that would make
 * the arithmetic meaningless: a non-positive concurrency limit or mean duration,
 * a window that does not move forward, a negative tally, an out-of-range
 * weekday or hour, or the same cell twice.
 */
export function staffingForecast(input: StaffingForecastInput): StaffingForecast {
  const fromMs = assertTime(input.from, '`from`');
  const toMs = assertTime(input.to, '`to`');
  if (fromMs >= toMs) {
    throw new RangeError('staffingForecast: `from` must be strictly before `to`.');
  }

  const concurrentChatsLimit = assertPositive(input.concurrentChatsLimit, '`concurrentChatsLimit`');
  const averageChatMinutes = assertPositive(input.averageChatMinutes, '`averageChatMinutes`');
  const minimumSampleChats = assertCount(
    input.minimumSampleChats ?? DEFAULT_MINIMUM_SAMPLE_CHATS,
    '`minimumSampleChats`',
  );

  const volume = toGrid(input.volume, '`volume`', (cell) => cell.chats, 'chats');
  // Nullish, not just null: an omitted coverage reads as unknown, which produces
  // nulls rather than a fabricated shortfall for every hour of the week.
  const coverage =
    input.coverage == null
      ? null
      : toGrid(input.coverage, '`coverage`', (cell) => cell.onlineMinutes, 'onlineMinutes');

  const occurrences = occurrenceWeights(fromMs, toMs);

  const cells: StaffingForecastCell[] = [];
  let anyForecast = false;

  for (let dayOfWeek = 0; dayOfWeek < DAYS_PER_WEEK; dayOfWeek += 1) {
    for (let hour = 0; hour < HOURS_PER_DAY; hour += 1) {
      const index = cellIndex(dayOfWeek, hour);
      const cellOccurrences = occurrences[index] ?? 0;
      const observedChats = volume[index] ?? 0;

      // A cell the window never covered has no evidence at all, whatever the
      // volume grid claims about it.
      const enoughHistory = cellOccurrences > 0 && observedChats >= minimumSampleChats;
      const requiredAgents = enoughHistory
        ? Math.ceil(
            ((observedChats / cellOccurrences) * (averageChatMinutes / MINUTES_PER_HOUR)) /
              concurrentChatsLimit,
          )
        : null;
      if (requiredAgents !== null) anyForecast = true;

      const scheduledAgents =
        coverage === null || cellOccurrences === 0
          ? null
          : round((coverage[index] ?? 0) / (MINUTES_PER_HOUR * cellOccurrences));

      const gap =
        requiredAgents === null || scheduledAgents === null
          ? null
          : round(requiredAgents - scheduledAgents);

      cells.push({
        dayOfWeek,
        hour,
        observedChats,
        requiredAgents,
        scheduledAgents,
        gap,
        lowConfidence: requiredAgents === null,
      });
    }
  }

  return {
    cells,
    coverageKnown: coverage !== null,
    lowConfidence: !anyForecast,
    concurrentChatsLimit,
    averageChatMinutes,
    minimumSampleChats,
  };
}
