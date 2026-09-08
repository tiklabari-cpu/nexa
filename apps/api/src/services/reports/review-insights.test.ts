/**
 * `reviewInsights` — the Reviews report's deterministic reading of its own
 * figures (FR-MOD-07.8).
 *
 * The table below is the module's contract: a known tally in, a known list of
 * statements out. Three properties are asserted separately from the table
 * because they are the ones a plausible implementation loses quietly — the same
 * input twice gives the same answer, a thin sample is caveated rather than
 * trended, and an empty window does not throw.
 */
import { describe, expect, it } from 'vitest';

import {
  CONCENTRATION_MIN_BAD,
  LOW_BASE_RESPONSES,
  TREND_THRESHOLD_POINTS,
  reviewInsights,
  type ReviewInsight,
  type ReviewInsightId,
  type ReviewInsightInput,
} from './review-insights.js';

/** A window with no ratings at all — the baseline most cases want. */
const NONE = { good: 0, bad: 0 };

/** Ratings spread over `days` UTC days, so the concentration rule has a series. */
function spread(good: number, bad: number, days: number): ReviewInsightInput['byDay'] {
  const rows: ReviewInsightInput['byDay'] = [];
  for (let i = 0; i < days; i++) {
    const date = `2026-09-${String(i + 1).padStart(2, '0')}`;
    rows.push({
      date,
      good: Math.floor(good / days) + (i < good % days ? 1 : 0),
      bad: Math.floor(bad / days) + (i < bad % days ? 1 : 0),
    });
  }
  return rows;
}

const ids = (insights: ReviewInsight[]): ReviewInsightId[] => insights.map((i) => i.id);

describe('reviewInsights — the table (FR-MOD-07.8)', () => {
  interface Case {
    name: string;
    input: ReviewInsightInput;
    expected: ReviewInsightId[];
  }

  const cases: Case[] = [
    {
      name: 'nobody rated — one neutral statement, and nothing read into the silence',
      input: { csat: NONE, previous: { good: 50, bad: 10 }, byDay: [] },
      expected: ['no_ratings'],
    },
    {
      // The mandatory caveat. 19 is one short of the bar; the baseline is a
      // solid 100 ratings, so a trend *could* have been computed — and is not.
      name: 'a thin sample — the caveat only, with no trend read out of it',
      input: {
        csat: { good: 4, bad: 15 },
        previous: { good: 80, bad: 20 },
        byDay: spread(4, 15, 5),
      },
      expected: ['low_base'],
    },
    {
      name: 'no comparable baseline — the window stands on its own',
      input: {
        csat: { good: 30, bad: 10 },
        previous: { good: 3, bad: 1 },
        byDay: spread(30, 10, 8),
      },
      expected: ['csat_no_baseline'],
    },
    {
      // 75% now against 60% before: 15 points up, well past the threshold.
      name: 'CSAT up past the threshold',
      input: {
        csat: { good: 30, bad: 10 },
        previous: { good: 30, bad: 20 },
        byDay: spread(30, 10, 8),
      },
      expected: ['csat_improved'],
    },
    {
      // 60% now against 75% before: 15 points down.
      name: 'CSAT down past the threshold',
      input: {
        csat: { good: 30, bad: 20 },
        previous: { good: 30, bad: 10 },
        byDay: spread(30, 20, 8),
      },
      expected: ['csat_declined'],
    },
    {
      // 80% against 78%: a 2-point wobble is not a change.
      name: 'a wobble under the threshold reads as steady',
      input: {
        csat: { good: 80, bad: 20 },
        previous: { good: 78, bad: 22 },
        byDay: spread(80, 20, 10),
      },
      expected: ['csat_steady'],
    },
    {
      name: 'a clean sweep is stated as well as compared',
      input: {
        csat: { good: 40, bad: 0 },
        previous: { good: 30, bad: 10 },
        byDay: spread(40, 0, 8),
      },
      expected: ['csat_improved', 'all_positive'],
    },
    {
      // Every rating negative, and they are spread out, so the concentration
      // rule stays silent — "all of them, everywhere" is the sweep, not a day.
      name: 'a window with nothing but negatives',
      input: {
        csat: { good: 0, bad: 40 },
        previous: { good: 30, bad: 10 },
        byDay: spread(0, 40, 8),
      },
      expected: ['csat_declined', 'all_negative'],
    },
    {
      // 12 of 20 negatives on one day: 60%, past the share, and the set is big
      // enough for the concentration to mean something.
      name: 'negatives piled onto one day',
      input: {
        csat: { good: 80, bad: 20 },
        previous: { good: 78, bad: 22 },
        byDay: [
          { date: '2026-09-01', good: 40, bad: 4 },
          { date: '2026-09-02', good: 20, bad: 12 },
          { date: '2026-09-03', good: 20, bad: 4 },
        ],
      },
      expected: ['csat_steady', 'bad_day_concentration'],
    },
    {
      // The same 20 negatives, evenly spread: no day holds half of them.
      name: 'negatives spread evenly — no day is called out',
      input: {
        csat: { good: 80, bad: 20 },
        previous: { good: 78, bad: 22 },
        byDay: spread(80, 20, 10),
      },
      expected: ['csat_steady'],
    },
    {
      // Four negatives, three of them on one day: 75% of the set, but the set
      // is under CONCENTRATION_MIN_BAD, so this is a coincidence, not a finding.
      name: 'too few negatives for a concentration to mean anything',
      input: {
        csat: { good: 96, bad: 4 },
        previous: { good: 94, bad: 6 },
        byDay: [
          { date: '2026-09-01', good: 48, bad: 3 },
          { date: '2026-09-02', good: 48, bad: 1 },
        ],
      },
      expected: ['csat_steady'],
    },
    {
      // One rated day holds 100% of the negatives by construction; saying so
      // would be a statement about the window, not about the day.
      name: 'a single rated day is never a concentration',
      input: {
        csat: { good: 20, bad: 10 },
        previous: { good: 20, bad: 10 },
        byDay: [{ date: '2026-09-01', good: 20, bad: 10 }],
      },
      expected: ['csat_steady'],
    },
  ];

  it.each(cases)('$name', ({ input, expected }) => {
    expect(ids(reviewInsights(input))).toEqual(expected);
  });
});

describe('reviewInsights — the properties the table cannot state (FR-MOD-07.8)', () => {
  const busy: ReviewInsightInput = {
    csat: { good: 80, bad: 20 },
    previous: { good: 50, bad: 50 },
    byDay: [
      { date: '2026-09-01', good: 40, bad: 4 },
      { date: '2026-09-02', good: 20, bad: 12 },
      { date: '2026-09-03', good: 20, bad: 4 },
    ],
  };

  it('is deterministic — the same window twice gives the same statements', () => {
    // The whole reason this is a rule engine and not a model call: a report
    // that reads differently on a refresh is not a report.
    expect(reviewInsights(busy)).toEqual(reviewInsights(busy));
    expect(reviewInsights(busy)).toEqual(reviewInsights({ ...busy, byDay: [...busy.byDay] }));
  });

  it('never invents a trend on a thin sample, however the baseline moved', () => {
    // Swept every shape of baseline against a 19-rating window: a collapse, a
    // surge and a matching window all produce exactly the caveat.
    for (const previous of [
      NONE,
      { good: 100, bad: 0 },
      { good: 0, bad: 100 },
      { good: 4, bad: 15 },
    ]) {
      const insights = reviewInsights({
        csat: { good: 4, bad: 15 },
        previous,
        byDay: spread(4, 15, 5),
      });
      expect(ids(insights)).toEqual(['low_base']);
      expect(insights[0]?.values).toEqual({ responses: 19 });
      expect(insights[0]?.tone).toBe('warning');
    }
  });

  it('does not throw on empty input, and reads the silence as unknown', () => {
    const insights = reviewInsights({ csat: NONE, previous: NONE, byDay: [] });
    expect(insights).toEqual([{ id: 'no_ratings', tone: 'neutral', values: {} }]);
  });

  it('carries the figures the sentence interpolates, not the sentence', () => {
    const insights = reviewInsights(busy);
    // 80% now against 50% before — 30 points, measured off the raw fractions.
    expect(insights[0]).toEqual({
      id: 'csat_improved',
      tone: 'positive',
      values: { delta_points: 30, responses: 100, previous_responses: 100 },
    });
    // 12 of the window's 20 negatives landed on 2026-09-02.
    expect(insights[1]).toEqual({
      id: 'bad_day_concentration',
      tone: 'negative',
      values: { date: '2026-09-02', bad: 12, share: 0.6 },
    });
  });

  it('breaks a tie on the earlier day rather than on the row order', () => {
    // Two days hold six negatives each. Which one is named must not depend on
    // how the series arrived, so the later day is offered first and the rule
    // still has to reach past it.
    const byDay = [
      { date: '2026-09-02', good: 40, bad: 6 },
      { date: '2026-09-01', good: 40, bad: 6 },
      { date: '2026-09-03', good: 20, bad: 0 },
    ];
    const insights = reviewInsights({
      csat: { good: 100, bad: 12 },
      previous: { good: 100, bad: 12 },
      byDay,
    });
    const concentration = insights.find((i) => i.id === 'bad_day_concentration');
    expect(concentration?.values.date).toBe('2026-09-01');
    // …and reversing the series does not change the answer.
    const reversed = reviewInsights({
      csat: { good: 100, bad: 12 },
      previous: { good: 100, bad: 12 },
      byDay: [...byDay].reverse(),
    });
    expect(reversed.find((i) => i.id === 'bad_day_concentration')?.values.date).toBe('2026-09-01');
  });

  it('holds the thresholds the header names, so a silent retune is visible here', () => {
    expect(LOW_BASE_RESPONSES).toBe(20);
    expect(TREND_THRESHOLD_POINTS).toBe(5);
    expect(CONCENTRATION_MIN_BAD).toBe(5);
    // Exactly at the bar, in both directions: 20 ratings is enough evidence,
    // and a 5-point move is a move.
    expect(ids(reviewInsights({ csat: { good: 10, bad: 10 }, previous: NONE, byDay: [] }))).toEqual(
      ['csat_no_baseline'],
    );
    expect(
      ids(
        reviewInsights({
          csat: { good: 65, bad: 35 },
          previous: { good: 60, bad: 40 },
          byDay: spread(65, 35, 10),
        }),
      ),
    ).toEqual(['csat_improved']);
  });
});
