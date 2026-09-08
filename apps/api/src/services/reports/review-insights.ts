/**
 * Insights for the Reviews / Ratings report (FR-MOD-07.8).
 *
 * The PRD line names four things — "rated good/bad; iki dönem karşılaştırma;
 * Ecommerce/Tracked sales; **Insights**". The first three are figures; this one
 * is the reading of them. What it is *not* is a model call: an insight has to be
 * reproducible from the same window twice, has to be assertable in a table test,
 * and has to be defensible to the person whose numbers it describes. So every
 * statement here is a rule over counts the report already computes — a
 * threshold, a ratio, a difference — and the same input always yields the same
 * output, in the same order. (The precedent is the spam filter's: a
 * deterministic rule engine, no LLM, for testability and false-positive review.)
 *
 * Two consequences of that choice are worth stating, because they are what keep
 * this honest rather than merely deterministic:
 *
 * 1. **A thin sample gets a caveat, not a trend.** Below
 *    {@link LOW_BASE_RESPONSES} ratings the only thing this module will say is
 *    that the sample is thin. "Satisfaction is down 30 points" over three
 *    ratings is arithmetic, not information, and putting it on the screen
 *    invites a decision the evidence cannot support. The threshold is the
 *    product's existing one (`apps/web/src/features/playbook/performance.ts`
 *    `LOW_BASE_THRESHOLD = 20`), so Nexa has one answer to "how few is too few".
 * 2. **No new measurement.** The rules read the tallies `buildReviewsReport`
 *    already has; nothing here opens a query, and the tracked-sales block is
 *    deliberately untouched — it carries no previous-window figure in this
 *    report, so any trend over it would be unfounded.
 *
 * The module returns identifiers, not sentences. The wording lives in the web
 * locales (`reports.reviews.insights.<id>`), which is what makes an insight as
 * translated as the card above it — the reply-suggestion chips' arrangement, for
 * the same reason: a sentence hard-coded in the derivation can only ever be
 * English.
 */

import { round } from '../../routes/reports-metrics.js';

/**
 * Below this many ratings a share is noise, and this module says so instead of
 * reading a trend out of it. Aligned with the product's other low-base rule
 * rather than chosen fresh — see the header.
 */
export const LOW_BASE_RESPONSES = 20;

/**
 * How far CSAT must move, in percentage points, before the change is called a
 * change. Under it the window is "steady": CSAT wobbles by a point or two on
 * ordinary volume, and a report that announces every wobble teaches its reader
 * to ignore it.
 */
export const TREND_THRESHOLD_POINTS = 5;

/**
 * The concentration rule needs a set big enough for "most of them on one day" to
 * mean anything. Four bad ratings, three on a Tuesday, is a coincidence.
 */
export const CONCENTRATION_MIN_BAD = 5;

/** Share of the window's negative ratings one day must hold to be called out. */
export const CONCENTRATION_SHARE = 0.5;

/** Every statement this module can make. Stable — the locales key off these. */
export type ReviewInsightId =
  | 'no_ratings'
  | 'low_base'
  | 'csat_no_baseline'
  | 'csat_improved'
  | 'csat_declined'
  | 'csat_steady'
  | 'all_positive'
  | 'all_negative'
  | 'bad_day_concentration';

/**
 * How a surface should colour the statement. `warning` is reserved for a caveat
 * about the evidence itself (the thin sample); `negative` is a real finding.
 */
export type ReviewInsightTone = 'positive' | 'negative' | 'warning' | 'neutral';

/**
 * The figures a statement interpolates. Every field optional and every one a
 * number or a date string: the sentence is the locale's, so nothing here is
 * text a reader sees untranslated.
 */
export interface ReviewInsightValues {
  /** Ratings in the window. */
  responses?: number;
  /** Ratings in the baseline window. */
  previous_responses?: number;
  /** CSAT change against the baseline window, in whole percentage points. */
  delta_points?: number;
  /** UTC day (`YYYY-MM-DD`) a statement points at. */
  date?: string;
  /** Negative ratings a statement counts. */
  bad?: number;
  /** A fraction (0–1) the surface formats as a percentage. */
  share?: number;
}

export interface ReviewInsight {
  id: ReviewInsightId;
  tone: ReviewInsightTone;
  values: ReviewInsightValues;
}

/** Good/bad ratings for one span — the report's own tally, unrounded. */
export interface ReviewInsightTally {
  good: number;
  bad: number;
}

/** Everything the rules read: this window, the baseline window, the day series. */
export interface ReviewInsightInput {
  csat: ReviewInsightTally;
  previous: ReviewInsightTally;
  byDay: Array<{ date: string } & ReviewInsightTally>;
}

/** Ratings in a tally. */
function responsesOf(tally: ReviewInsightTally): number {
  return tally.good + tally.bad;
}

/**
 * The day holding the most negative ratings, ties broken by the earlier date.
 * The tie-break is spelled out rather than left to sort stability because the
 * whole module's contract is that the same input yields the same output, and
 * "whichever day the database happened to return first" is not that.
 */
function worstDay(byDay: ReviewInsightInput['byDay']): { date: string; bad: number } | undefined {
  let worst: { date: string; bad: number } | undefined;
  for (const day of byDay) {
    if (day.bad === 0) continue;
    const better =
      worst === undefined ||
      day.bad > worst.bad ||
      // Dates are `YYYY-MM-DD`, so a string comparison is a chronological one.
      (day.bad === worst.bad && day.date < worst.date);
    if (better) worst = { date: day.date, bad: day.bad };
  }
  return worst;
}

/**
 * The Reviews report's insights for one window, in a fixed order: the evidence
 * rule first (it qualifies everything after it), then the trend, then what the
 * split itself says, then where the negatives fell.
 *
 * Nobody rated, or too few did, and the list is that one statement — see the
 * header for why the trend rules are suppressed rather than merely caveated.
 */
export function reviewInsights(input: ReviewInsightInput): ReviewInsight[] {
  const responses = responsesOf(input.csat);

  // An unrated window is unknown, not a bad one — the same rule the score
  // follows in reading null rather than 0%.
  if (responses === 0) return [{ id: 'no_ratings', tone: 'neutral', values: {} }];
  if (responses < LOW_BASE_RESPONSES) {
    return [{ id: 'low_base', tone: 'warning', values: { responses } }];
  }

  const insights: ReviewInsight[] = [];

  // --- Trend against the baseline window -----------------------------------
  // The baseline needs the same evidence bar as the window itself: comparing a
  // solid 200-rating month against a four-rating one produces a number, and the
  // number is about the four ratings.
  const previousResponses = responsesOf(input.previous);
  if (previousResponses < LOW_BASE_RESPONSES) {
    insights.push({
      id: 'csat_no_baseline',
      tone: 'neutral',
      values: { previous_responses: previousResponses },
    });
  } else {
    // Percentage points, from the raw fractions rather than from the rounded
    // score the payload carries: rounding twice is how a 5.0-point move becomes
    // a 4-point one.
    const deltaPoints = Math.round(
      (input.csat.good / responses - input.previous.good / previousResponses) * 100,
    );
    const values = { delta_points: deltaPoints, responses, previous_responses: previousResponses };
    if (Math.abs(deltaPoints) < TREND_THRESHOLD_POINTS) {
      insights.push({ id: 'csat_steady', tone: 'neutral', values });
    } else if (deltaPoints > 0) {
      insights.push({ id: 'csat_improved', tone: 'positive', values });
    } else {
      insights.push({ id: 'csat_declined', tone: 'negative', values });
    }
  }

  // --- What the split itself says ------------------------------------------
  // Only stated on a window that cleared the evidence bar; a clean sweep of
  // three ratings is the low-base case, and never reaches here.
  if (input.csat.bad === 0) {
    insights.push({ id: 'all_positive', tone: 'positive', values: { responses } });
  } else if (input.csat.good === 0) {
    insights.push({ id: 'all_negative', tone: 'negative', values: { responses } });
  }

  // --- Where the negatives fell --------------------------------------------
  // A single rated day trivially holds all of them, which says nothing about
  // that day; the rule needs at least two days with ratings to be a finding.
  const ratedDays = input.byDay.filter((day) => responsesOf(day) > 0);
  const worst = worstDay(input.byDay);
  if (input.csat.bad >= CONCENTRATION_MIN_BAD && ratedDays.length >= 2 && worst !== undefined) {
    const share = worst.bad / input.csat.bad;
    if (share >= CONCENTRATION_SHARE) {
      insights.push({
        id: 'bad_day_concentration',
        tone: 'negative',
        values: { date: worst.date, bad: worst.bad, share: round(share) },
      });
    }
  }

  return insights;
}
