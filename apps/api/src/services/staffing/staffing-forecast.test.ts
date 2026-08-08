/**
 * Deterministic staffing forecast (WORKSCHED-f).
 *
 * The negatives come first, and they carry most of the weight, because every
 * one of them is a way for this module to hand back a *believable* wrong number
 * instead of an error: an empty week reading as "nobody is needed", unknown
 * presence reading as a shortfall, a divide-by-zero limit producing Infinity
 * agents, one Tuesday's four chats sizing a roster. A staffing grid looks
 * equally convincing whichever of those produced it — which is precisely why
 * the rules have to be pinned down here rather than noticed in production.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MINIMUM_SAMPLE_CHATS,
  staffingForecast,
  type CoverageCell,
  type StaffingForecast,
  type StaffingForecastInput,
  type VolumeCell,
} from './staffing-forecast.js';

/** 2026-03-02 is a Monday; the window is exactly four weeks, so every cell occurs 4×. */
const WINDOW_FROM = new Date('2026-03-02T00:00:00.000Z');
const WINDOW_TO = new Date('2026-03-30T00:00:00.000Z');

const MONDAY = 1;
const TUESDAY = 2;
const WEDNESDAY = 3;

const volume = (dayOfWeek: number, hour: number, chats: number): VolumeCell => ({
  dayOfWeek,
  hour,
  chats,
});

const covered = (dayOfWeek: number, hour: number, onlineMinutes: number): CoverageCell => ({
  dayOfWeek,
  hour,
  onlineMinutes,
});

/**
 * A four-week window, six chats at a time per agent, chats averaging 18 minutes.
 * With those constants one agent absorbs 20 chats an hour (20 × 18/60 = 6
 * concurrent), which makes the expected numbers below readable by hand.
 */
const input = (overrides: Partial<StaffingForecastInput> = {}): StaffingForecastInput => ({
  volume: [],
  coverage: [],
  from: WINDOW_FROM,
  to: WINDOW_TO,
  concurrentChatsLimit: 6,
  averageChatMinutes: 18,
  ...overrides,
});

const cellAt = (forecast: StaffingForecast, dayOfWeek: number, hour: number) =>
  forecast.cells.find((cell) => cell.dayOfWeek === dayOfWeek && cell.hour === hour)!;

describe('staffingForecast (PRD §5.3-Vardiya)', () => {
  // ==========================================================================
  // Divisors that would silently produce Infinity
  // ==========================================================================

  it('refuses a concurrency limit of zero rather than dividing by it', () => {
    // ceil(load / 0) is Infinity, and Infinity agents renders as happily as 3.
    expect(() => staffingForecast(input({ concurrentChatsLimit: 0 }))).toThrow(RangeError);
  });

  it('refuses a negative concurrency limit', () => {
    // Negative capacity would flip the sign of the whole grid: a busy hour would
    // report a *surplus*.
    expect(() => staffingForecast(input({ concurrentChatsLimit: -6 }))).toThrow(RangeError);
  });

  it('refuses a non-finite concurrency limit', () => {
    expect(() => staffingForecast(input({ concurrentChatsLimit: Number.NaN }))).toThrow(TypeError);
    expect(() =>
      staffingForecast(input({ concurrentChatsLimit: Number.POSITIVE_INFINITY })),
    ).toThrow(TypeError);
  });

  it('refuses a zero or negative mean chat duration', () => {
    // Zero minutes per chat means no chat ever occupies anybody: every hour
    // would need 0 agents no matter how many chats arrived.
    expect(() => staffingForecast(input({ averageChatMinutes: 0 }))).toThrow(RangeError);
    expect(() => staffingForecast(input({ averageChatMinutes: -18 }))).toThrow(RangeError);
  });

  // ==========================================================================
  // Unknown is never zero
  // ==========================================================================

  it('reports no volume as null and low confidence — never as "0 agents needed"', () => {
    const forecast = staffingForecast(input());
    const cell = cellAt(forecast, TUESDAY, 14);

    expect(cell.requiredAgents).toBeNull();
    expect(cell.requiredAgents).not.toBe(0);
    expect(cell.lowConfidence).toBe(true);
    expect(cell.observedChats).toBe(0);
    // Nothing anywhere cleared the bar, so the forecast as a whole says so.
    expect(forecast.lowConfidence).toBe(true);
    expect(forecast.cells.every((c) => c.requiredAgents === null)).toBe(true);
  });

  it('reports a sample below the threshold as null, not as the number it computes to', () => {
    // 19 chats over four Tuesdays is under five an hour, and it is also noise:
    // one unusual afternoon moves it by 30%.
    const below = staffingForecast(
      input({ volume: [volume(TUESDAY, 14, DEFAULT_MINIMUM_SAMPLE_CHATS - 1)] }),
    );
    const cell = cellAt(below, TUESDAY, 14);

    expect(cell.requiredAgents).toBeNull();
    expect(cell.lowConfidence).toBe(true);
    // The evidence is still reported — the UI says "too little data", not "no data".
    expect(cell.observedChats).toBe(19);

    // One more chat clears the bar and the same cell now answers.
    const atBar = staffingForecast(
      input({ volume: [volume(TUESDAY, 14, DEFAULT_MINIMUM_SAMPLE_CHATS)] }),
    );
    expect(cellAt(atBar, TUESDAY, 14).requiredAgents).toBe(1);
    expect(cellAt(atBar, TUESDAY, 14).lowConfidence).toBe(false);
    expect(atBar.lowConfidence).toBe(false);
  });

  it('honours a caller-supplied confidence bar', () => {
    const forecast = staffingForecast(
      input({ volume: [volume(TUESDAY, 14, 8)], minimumSampleChats: 5 }),
    );

    expect(cellAt(forecast, TUESDAY, 14).lowConfidence).toBe(false);
    expect(forecast.minimumSampleChats).toBe(5);
  });

  it('leaves the gap unknown when presence coverage is unknown', () => {
    // `presenceCoverage` returns null for a workspace that has never recorded
    // presence. Treating that as 0 online would report a full staffing shortfall
    // for all 168 hours of a week nobody has any data about.
    const forecast = staffingForecast(
      input({ volume: [volume(TUESDAY, 14, 160)], coverage: null }),
    );
    const cell = cellAt(forecast, TUESDAY, 14);

    expect(forecast.coverageKnown).toBe(false);
    expect(cell.requiredAgents).toBe(2);
    expect(cell.scheduledAgents).toBeNull();
    expect(cell.gap).toBeNull();
    expect(forecast.cells.every((c) => c.scheduledAgents === null && c.gap === null)).toBe(true);
  });

  it('treats a log with nothing in this window as a real zero, not as unknown', () => {
    // The mirror of the rule above, and the same one `presenceCoverage` holds:
    // once a log exists, "nobody was online" is a fact worth reporting.
    const forecast = staffingForecast(input({ volume: [volume(TUESDAY, 14, 160)], coverage: [] }));
    const cell = cellAt(forecast, TUESDAY, 14);

    expect(forecast.coverageKnown).toBe(true);
    expect(cell.scheduledAgents).toBe(0);
    expect(cell.gap).toBe(2);
  });

  // ==========================================================================
  // Malformed input raises rather than returning a number
  // ==========================================================================

  it('refuses a window that does not move forward', () => {
    expect(() => staffingForecast(input({ from: WINDOW_TO, to: WINDOW_FROM }))).toThrow(RangeError);
    expect(() => staffingForecast(input({ from: WINDOW_FROM, to: WINDOW_FROM }))).toThrow(
      RangeError,
    );
  });

  it('refuses an unparseable window bound rather than producing NaN cells', () => {
    expect(() => staffingForecast(input({ from: new Date('not-a-date') }))).toThrow(TypeError);
    expect(() => staffingForecast(input({ to: new Date('nope') }))).toThrow(TypeError);
  });

  it('refuses negative or non-finite tallies', () => {
    expect(() => staffingForecast(input({ volume: [volume(TUESDAY, 14, -1)] }))).toThrow(
      RangeError,
    );
    expect(() => staffingForecast(input({ volume: [volume(TUESDAY, 14, Number.NaN)] }))).toThrow(
      TypeError,
    );
    expect(() => staffingForecast(input({ coverage: [covered(TUESDAY, 14, -60)] }))).toThrow(
      RangeError,
    );
    expect(() => staffingForecast(input({ minimumSampleChats: -1 }))).toThrow(RangeError);
  });

  it('refuses a cell outside the 7 × 24 grid', () => {
    expect(() => staffingForecast(input({ volume: [volume(TUESDAY, 24, 100)] }))).toThrow(
      RangeError,
    );
    expect(() => staffingForecast(input({ volume: [volume(7, 14, 100)] }))).toThrow(RangeError);
    expect(() => staffingForecast(input({ volume: [volume(-1, 14, 100)] }))).toThrow(RangeError);
    expect(() => staffingForecast(input({ volume: [volume(TUESDAY, 14.5, 100)] }))).toThrow(
      TypeError,
    );
  });

  it('refuses the same cell twice instead of quietly summing it', () => {
    // Two rows for one hour means the caller grouped its query twice over;
    // adding them would double the forecast where nothing downstream could tell.
    expect(() =>
      staffingForecast(input({ volume: [volume(TUESDAY, 14, 100), volume(TUESDAY, 14, 60)] })),
    ).toThrow(RangeError);
  });

  it('refuses a volume grid that is not an array', () => {
    expect(() => staffingForecast(input({ volume: undefined as unknown as VolumeCell[] }))).toThrow(
      TypeError,
    );
  });

  // ==========================================================================
  // Determinism — the KK's first clause
  // ==========================================================================

  it('returns byte-identical output for the same input, twice', () => {
    const build = (): StaffingForecastInput =>
      input({
        volume: [volume(TUESDAY, 14, 160), volume(MONDAY, 9, 80), volume(WEDNESDAY, 3, 25)],
        coverage: [covered(TUESDAY, 14, 720), covered(MONDAY, 9, 240)],
      });

    const first = staffingForecast(build());
    const second = staffingForecast(build());

    expect(second).toEqual(first);
    // Deep equality would tolerate a reordered grid; the serialisation would not.
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('does not depend on the order rows arrive in', () => {
    const rows = [volume(TUESDAY, 14, 160), volume(MONDAY, 9, 80), volume(WEDNESDAY, 3, 25)];
    const forwards = staffingForecast(input({ volume: rows }));
    const backwards = staffingForecast(input({ volume: [...rows].reverse() }));

    expect(backwards).toEqual(forwards);
  });

  // ==========================================================================
  // The capacity model
  // ==========================================================================

  it('always returns the complete 7 × 24 grid, in a fixed order', () => {
    const forecast = staffingForecast(input({ volume: [volume(TUESDAY, 14, 160)] }));

    expect(forecast.cells).toHaveLength(168);
    expect(forecast.cells.map((cell) => `${cell.dayOfWeek}:${cell.hour}`)).toEqual(
      Array.from({ length: 168 }, (_, index) => `${Math.floor(index / 24)}:${index % 24}`),
    );
  });

  it('sizes an hour from its mean arrival rate, not its window total', () => {
    // 160 chats over four Tuesdays is 40 an hour; at 18 minutes each that is 12
    // chats open at once, which six-at-a-time agents cover with 2 people.
    const forecast = staffingForecast(input({ volume: [volume(TUESDAY, 14, 160)] }));

    expect(cellAt(forecast, TUESDAY, 14).observedChats).toBe(160);
    expect(cellAt(forecast, TUESDAY, 14).requiredAgents).toBe(2);
    // The same 160 chats spread over a cell that occurred four times is not the
    // same as 160 in one hour — the neighbouring hour saw nothing.
    expect(cellAt(forecast, TUESDAY, 15).requiredAgents).toBeNull();
  });

  it('counts a weekday-hour once per occurrence in the window, not once per week', () => {
    // Nine days from a Monday: Monday and Tuesday come round twice, the rest once.
    // The same 80 chats therefore mean 40 an hour on Tuesday and 80 on Wednesday.
    const forecast = staffingForecast(
      input({
        from: WINDOW_FROM,
        to: new Date('2026-03-11T00:00:00.000Z'),
        volume: [volume(TUESDAY, 14, 80), volume(WEDNESDAY, 14, 80)],
      }),
    );

    expect(cellAt(forecast, TUESDAY, 14).requiredAgents).toBe(2);
    expect(cellAt(forecast, WEDNESDAY, 14).requiredAgents).toBe(4);
  });

  it('scales a part-hour window by the fraction it actually covered', () => {
    // Half an hour of history holding 20 chats is a 40-an-hour rate, not 20.
    const forecast = staffingForecast(
      input({
        from: WINDOW_FROM,
        to: new Date('2026-03-02T00:30:00.000Z'),
        volume: [volume(MONDAY, 0, 20)],
        coverage: [covered(MONDAY, 0, 30)],
        concurrentChatsLimit: 5,
        averageChatMinutes: 15,
      }),
    );
    const cell = cellAt(forecast, MONDAY, 0);

    // 40/h × 15 min = 10 open at once, five at a time → 2 agents.
    expect(cell.requiredAgents).toBe(2);
    // 30 online minutes across half an occurrence of the hour is one agent.
    expect(cell.scheduledAgents).toBe(1);
    expect(cell.gap).toBe(1);
    // An hour the window never reached stays unknown on both sides.
    expect(cellAt(forecast, MONDAY, 1).requiredAgents).toBeNull();
    expect(cellAt(forecast, MONDAY, 1).scheduledAgents).toBeNull();
  });

  it('asks for at least one agent whenever chats arrive at all', () => {
    // 20 chats over four weeks is a trickle — five an hour, 1.5 open at once,
    // a quarter of one agent's capacity. It still needs somebody there.
    const forecast = staffingForecast(input({ volume: [volume(TUESDAY, 14, 20)] }));

    expect(cellAt(forecast, TUESDAY, 14).requiredAgents).toBe(1);
  });

  it('respects a per-agent concurrency limit that is not the default', () => {
    // The same 40 chats an hour, 12 open at once: one-at-a-time agents need 12.
    const forecast = staffingForecast(
      input({ volume: [volume(TUESDAY, 14, 160)], concurrentChatsLimit: 1 }),
    );

    expect(cellAt(forecast, TUESDAY, 14).requiredAgents).toBe(12);
  });

  it('accepts a fractional mean limit, since agents may be capped differently', () => {
    // 12 open chats across agents averaging 4.5 slots → 2.67 → 3 people.
    const forecast = staffingForecast(
      input({ volume: [volume(TUESDAY, 14, 160)], concurrentChatsLimit: 4.5 }),
    );

    expect(cellAt(forecast, TUESDAY, 14).requiredAgents).toBe(3);
  });

  // ==========================================================================
  // Gap: what the roster owes the hour
  // ==========================================================================

  it('turns online minutes into the agents that were actually there', () => {
    // Three agents present for the whole hour on each of four Tuesdays.
    const forecast = staffingForecast(
      input({ volume: [volume(TUESDAY, 14, 160)], coverage: [covered(TUESDAY, 14, 3 * 60 * 4)] }),
    );
    const cell = cellAt(forecast, TUESDAY, 14);

    expect(cell.scheduledAgents).toBe(3);
    expect(cell.requiredAgents).toBe(2);
    // More cover than the hour needs — a surplus reads as a negative gap.
    expect(cell.gap).toBe(-1);
    expect(cell.gap!).toBeLessThanOrEqual(0);
  });

  it('reports a shortfall as a positive gap', () => {
    const forecast = staffingForecast(
      input({ volume: [volume(TUESDAY, 14, 160)], coverage: [covered(TUESDAY, 14, 60 * 4)] }),
    );

    expect(cellAt(forecast, TUESDAY, 14).scheduledAgents).toBe(1);
    expect(cellAt(forecast, TUESDAY, 14).gap).toBe(1);
  });

  it('reports partial cover as a fraction of an agent', () => {
    // 150 minutes over four occurrences of the hour: 0.625 of an agent, on average.
    const forecast = staffingForecast(
      input({ volume: [volume(TUESDAY, 14, 160)], coverage: [covered(TUESDAY, 14, 150)] }),
    );
    const cell = cellAt(forecast, TUESDAY, 14);

    expect(cell.scheduledAgents).toBe(0.625);
    expect(cell.gap).toBe(1.375);
  });

  it('reports cover for an hour that needs no forecast, without inventing a gap', () => {
    // Presence is known here, volume is not: the hour was staffed, and whether
    // that was the right amount is not something this window can say.
    const forecast = staffingForecast(input({ coverage: [covered(MONDAY, 3, 120)] }));
    const cell = cellAt(forecast, MONDAY, 3);

    expect(cell.scheduledAgents).toBe(0.5);
    expect(cell.requiredAgents).toBeNull();
    expect(cell.gap).toBeNull();
  });

  // ==========================================================================
  // Structural: pure, and blind to the tenant
  // ==========================================================================

  it('imports nothing — no Fastify, no Prisma, no env', () => {
    // The purity claim is checked against the file rather than argued in a
    // comment: with no imports at all, none of them can be a framework, a
    // database client or configuration.
    const source = readFileSync(
      fileURLToPath(new URL('./staffing-forecast.ts', import.meta.url)),
      'utf8',
    );

    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/process\s*\.\s*env/);
  });

  it('reads no clock and draws no randomness', () => {
    // The other half of determinism: `new Date(ms)` is arithmetic, `new Date()`
    // would make the same input answer differently tomorrow.
    const source = readFileSync(
      fileURLToPath(new URL('./staffing-forecast.ts', import.meta.url)),
      'utf8',
    );

    expect(source).not.toMatch(/Math\s*\.\s*random/);
    expect(source).not.toMatch(/Date\s*\.\s*now/);
    expect(source).not.toMatch(/new Date\(\s*\)/);
  });

  it('never receives an agent, license or customer identifier', () => {
    // Coverage arrives as minutes already summed across agents, so there is no
    // tenant datum in this module to leak — isolation is proved where the rows
    // are read (WORKSCHED-d, -e, -g), and cannot be broken here.
    const cell: CoverageCell = covered(TUESDAY, 14, 720);
    const volumeCell: VolumeCell = volume(TUESDAY, 14, 160);

    expect(Object.keys(cell).sort()).toEqual(['dayOfWeek', 'hour', 'onlineMinutes']);
    expect(Object.keys(volumeCell).sort()).toEqual(['chats', 'dayOfWeek', 'hour']);

    const forecast = staffingForecast(input({ volume: [volumeCell], coverage: [cell] }));
    expect(JSON.stringify(forecast)).not.toMatch(/agent_?[Ii]d|license_?[Ii]d|customer_?[Ii]d/);
  });
});
