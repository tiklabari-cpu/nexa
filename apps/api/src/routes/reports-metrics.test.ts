import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_BASELINES,
  benchmarkWindow,
  channelLabel,
  DEFAULT_BENCHMARK_BASELINE,
  isBenchmarkBaseline,
  resolutionRate,
  round,
} from './reports-metrics.js';

describe('resolutionRate', () => {
  it('is null, not zero, when nothing closed', () => {
    // An empty window is unknown, not a 0% failure — and it guards the divide.
    expect(resolutionRate(0, 0)).toBeNull();
    expect(resolutionRate(5, 0)).toBeNull();
  });

  it('is the share of closed, rounded to three decimals', () => {
    expect(resolutionRate(1, 3)).toBe(0.333);
    expect(resolutionRate(2, 3)).toBe(0.667);
    expect(resolutionRate(1, 4)).toBe(0.25);
  });

  it('is 0 when the class had no cases but others closed', () => {
    // Distinct from the empty-window null above: here closing happened, this
    // class just accounts for none of it.
    expect(resolutionRate(0, 4)).toBe(0);
  });

  it('is 1 when the class accounts for every closed case', () => {
    expect(resolutionRate(7, 7)).toBe(1);
  });

  it("splits three ways so the parts sum to the whole's rate", () => {
    // manual + assisted + automated = closed, so their rates sum to 1.
    const closed = 8;
    const total =
      (resolutionRate(3, closed) ?? 0) +
      (resolutionRate(2, closed) ?? 0) +
      (resolutionRate(3, closed) ?? 0);
    expect(total).toBe(1);
  });
});

describe('round', () => {
  it('keeps three decimals', () => {
    expect(round(0.12345)).toBe(0.123);
    expect(round(1)).toBe(1);
  });
});

describe('channelLabel', () => {
  it('keeps a known adapter type as its own label', () => {
    expect(channelLabel('messenger')).toBe('messenger');
    expect(channelLabel('twilio')).toBe('twilio');
    expect(channelLabel('whatsapp')).toBe('whatsapp');
  });

  it("falls back to 'website' for null — the native web widget has no adapter type", () => {
    expect(channelLabel(null)).toBe('website');
  });

  it("falls back to 'website' for an unrecognized type", () => {
    expect(channelLabel('carrier-pigeon')).toBe('website');
  });
});

describe('benchmarkWindow', () => {
  const DAY = 86_400_000;
  const from = new Date('2026-07-01T00:00:00.000Z');
  const to = new Date('2026-07-31T00:00:00.000Z');
  const span = to.getTime() - from.getTime();

  it('defaults to the previous period', () => {
    expect(benchmarkWindow(from, to)).toEqual(benchmarkWindow(from, to, 'previous_period'));
    expect(DEFAULT_BENCHMARK_BASELINE).toBe('previous_period');
  });

  describe('previous_period', () => {
    it('ends one millisecond before `from`, so no instant is in both windows', () => {
      const window = benchmarkWindow(from, to, 'previous_period');
      expect(window.to.getTime()).toBe(from.getTime() - 1);
      expect(window.from.getTime()).toBe(from.getTime() - span);
    });

    it('is the same span as the requested window, immediately before it', () => {
      const window = benchmarkWindow(from, to, 'previous_period');
      // The 1 ms gap is the whole difference — nothing else shortens it.
      expect(window.to.getTime() - window.from.getTime()).toBe(span - 1);
    });

    it('reproduces the hand-rolled arithmetic the Overview and Reviews used', () => {
      // The exact three lines this helper replaced. Locked so the extraction
      // cannot quietly change what those two reports have always reported.
      const spanMs = to.getTime() - from.getTime();
      const expected = {
        from: new Date(from.getTime() - spanMs),
        to: new Date(from.getTime() - 1),
      };
      expect(benchmarkWindow(from, to, 'previous_period')).toEqual(expected);
    });

    it('handles a zero-length window without inventing a span', () => {
      const instant = new Date('2026-07-01T12:00:00.000Z');
      const window = benchmarkWindow(instant, instant, 'previous_period');
      expect(window.from.getTime()).toBe(instant.getTime());
      expect(window.to.getTime()).toBe(instant.getTime() - 1);
    });
  });

  describe('previous_year', () => {
    it('shifts both ends back 365 days', () => {
      const window = benchmarkWindow(from, to, 'previous_year');
      expect(window.from.getTime()).toBe(from.getTime() - 365 * DAY);
      expect(window.to.getTime()).toBe(to.getTime() - 365 * DAY);
    });

    it('keeps the requested window\'s exact length', () => {
      const window = benchmarkWindow(from, to, 'previous_year');
      expect(window.to.getTime() - window.from.getTime()).toBe(span);
    });

    it('shifts by a fixed 365 days even across a leap day', () => {
      // 2028 is a leap year: calendar arithmetic would land on 2027-03-01 and
      // make the two windows different lengths. A fixed offset does not.
      const leapFrom = new Date('2028-03-01T00:00:00.000Z');
      const leapTo = new Date('2028-03-08T00:00:00.000Z');
      const window = benchmarkWindow(leapFrom, leapTo, 'previous_year');
      expect(window.from.toISOString()).toBe('2027-03-02T00:00:00.000Z');
      expect(window.to.toISOString()).toBe('2027-03-09T00:00:00.000Z');
    });

    it('keeps UTC instants — no local-timezone drift', () => {
      const window = benchmarkWindow(from, to, 'previous_year');
      expect(window.from.toISOString()).toBe('2025-07-01T00:00:00.000Z');
      expect(window.to.toISOString()).toBe('2025-07-31T00:00:00.000Z');
    });
  });

  it('never returns a window that reaches past the requested one', () => {
    // Whichever baseline is asked for, the comparison looks backwards. A
    // baseline that started later than `from` would be comparing the window
    // against part of itself.
    for (const baseline of BENCHMARK_BASELINES) {
      expect(benchmarkWindow(from, to, baseline).from.getTime()).toBeLessThan(from.getTime());
    }
  });
});

describe('isBenchmarkBaseline', () => {
  it('accepts exactly the two same-license baselines', () => {
    expect(BENCHMARK_BASELINES).toEqual(['previous_period', 'previous_year']);
    for (const baseline of BENCHMARK_BASELINES) expect(isBenchmarkBaseline(baseline)).toBe(true);
  });

  it('rejects a cross-license baseline — the boundary is deliberate, not missing', () => {
    // §V1: benchmarking against other licenses is refused, so these names are
    // not "not implemented yet" — there is no value here that names anyone else.
    expect(isBenchmarkBaseline('industry')).toBe(false);
    expect(isBenchmarkBaseline('other_license')).toBe(false);
    expect(isBenchmarkBaseline('peer_cohort')).toBe(false);
    expect(isBenchmarkBaseline('')).toBe(false);
  });
});
