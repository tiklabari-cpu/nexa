/**
 * The custom metrics the thresholds in `thresholds.js` are written against.
 *
 * Split from `thresholds.js` because these need `k6/metrics` and that module
 * only exists inside k6's runtime — the guard test has to import the budgets
 * under Node. The two halves are tied together by `METRIC_NAMES`, and
 * `test/budgets.test.ts` fails if this file stops declaring one of them.
 */
import { Counter, Rate, Trend } from 'k6/metrics';
import { METRIC_NAMES } from './thresholds.js';

/**
 * Responses that came back 429.
 *
 * Thresholded at `count==0`. A load run that trips the rate limiter is not
 * measuring the product: the limiter answers in microseconds without touching
 * Postgres, so it *improves* the latency percentiles while the requests it
 * rejects never reach the code under test. The resulting number looks better
 * than the truth, which is the worst kind of wrong for a capacity measurement.
 */
export const rateLimited = new Counter(METRIC_NAMES.rateLimited);

/**
 * One increment per operation performed, tagged by `op`.
 *
 * The companion to every latency budget: `p(99)<150` on a metric with no
 * samples passes, `nexa_measured{op:read} count>0` on the same empty run does
 * not. Incremented by `lib/http.js` from the same call that applies the tag.
 */
export const measured = new Counter(METRIC_NAMES.measured);

/** Event publish → subscriber receipt, in ms (NFR-P1). Filled in by 161.3. */
export const fanoutLatency = new Trend(METRIC_NAMES.fanoutLatency, true);

/** RTM `login` attempts that succeeded (NFR-U1). Filled in by 161.3. */
export const rtmLoginSuccess = new Rate(METRIC_NAMES.rtmLoginSuccess);

/**
 * Book-keeping every HTTP call in this suite goes through.
 *
 * Prefer `lib/http.js`, which calls this with the same `op` it puts in the
 * request tags. Calling it directly is for the non-HTTP path (an RTM frame),
 * where there is no response to tag.
 *
 * @param {{ status: number } | null} response the k6 response, or null for a
 *   non-HTTP operation
 * @param {string} op one of `OP_TAGS`
 */
export function observe(response, op) {
  if (response) rateLimited.add(response.status === 429 ? 1 : 0);
  measured.add(1, { op });
  return response;
}
