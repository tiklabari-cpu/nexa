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

/** Event publish → subscriber receipt, in ms (NFR-P1). Driven by `rtm.js`. */
export const fanoutLatency = new Trend(METRIC_NAMES.fanoutLatency, true);

/** RTM `login` attempts that succeeded (NFR-U1). Driven by `rtm.js`. */
export const rtmLoginSuccess = new Rate(METRIC_NAMES.rtmLoginSuccess);

/**
 * Handshake → logged-in, in ms.
 *
 * No threshold: there is no NFR for it. It is here because it is the earliest
 * visible sign of a saturating pod — connect time climbs while fan-out is still
 * inside its budget — so the rung *before* the one that fails is not a blank.
 */
export const rtmConnectLatency = new Trend(METRIC_NAMES.rtmConnectLatency, true);

/**
 * Sockets that never reached a logged-in state — refused handshake, handshake
 * timeout, a close before the open, or a `login` the gateway rejected.
 *
 * Thresholded at `count==0`: this is degradation kind (2), and one refusal is
 * the answer to "how many connections does a pod take". Reading a red here
 * needs care — the load generator running out of file descriptors or ephemeral
 * ports looks identical from inside k6. README §"Reading a red run".
 */
export const rtmConnectFailed = new Counter(METRIC_NAMES.rtmConnectFailed);

/**
 * Live sockets that went away without the scenario asking.
 *
 * Thresholded at `count==0` — degradation kind (3). The usual innocent cause is
 * the gateway's 30 s idle timeout, which is why a held socket pings
 * (`RTM_PING_INTERVAL_MS`); if that margin ever narrows, `budgets.test.ts`
 * fails rather than this counter quietly filling up mid-run.
 */
export const rtmSocketDropped = new Counter(METRIC_NAMES.rtmSocketDropped);

/** Reconnects whose `sync` replayed the events missed during the gap (NFR-R2). */
export const rtmSyncRecovered = new Rate(METRIC_NAMES.rtmSyncRecovered);

/**
 * How many sockets the gateway says it is holding, sampled from its own
 * `/health` during the plateau.
 *
 * The load generator knows how many it *asked* for; only the pod knows how many
 * it has. NFR-P8 is a statement about the pod, so this is the number that
 * answers it — and a gap between the two is itself the finding.
 */
export const rtmConnectionsObserved = new Trend(METRIC_NAMES.rtmConnectionsObserved);

/**
 * The publishing write, on its own, so the REST share of a fan-out figure can
 * be subtracted rather than guessed at.
 */
export const rtmPublishLatency = new Trend(METRIC_NAMES.rtmPublishLatency, true);

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
