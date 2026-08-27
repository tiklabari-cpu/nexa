/**
 * NFR budgets, and the k6 thresholds derived from them.
 *
 * This module is the reason the load suite is a *gate* rather than a report.
 * k6 exits non-zero when any threshold in `options.thresholds` is crossed, so
 * every number here is load-bearing: raise one and the product silently gets
 * slower permission to be slow.
 *
 * The numbers are NOT chosen here. They are copied from the PRD's §7.1/§7.4
 * tables, and `test/budgets.test.ts` re-reads those tables on every run and
 * fails if this file and the PRD ever disagree — in either direction. That
 * guard is the whole point of §D122's lesson: an NFR stamp whose measuring
 * command does not actually run is a claim, not a measurement.
 *
 * Deliberately free of `k6/*` imports. k6 runs its own runtime, Node cannot
 * load `k6/http`, and the guard test has to be able to import this file under
 * Node. Anything needing a k6 module goes in `metrics.js` instead.
 */

/**
 * The measured budgets, each tagged with the requirement it comes from.
 *
 * `apiSuccessRatio` / `rtmLoginSuccessRatio` are the *run-scoped* reading of
 * two 30-day SLOs (NFR-U1, NFR-U2). A single load run can falsify them — a run
 * that drops 1% of requests is definitely not meeting 99.95% — but it can never
 * confirm them, because availability is a property of a month, not of ten
 * minutes. They are here as a floor, and the summary labels them as such.
 */
export const NFR_BUDGETS = Object.freeze({
  /** NFR-P2 — core REST read latency, p99. */
  restReadP99Ms: 150,
  /** NFR-P2 — core REST write latency, p99. */
  restWriteP99Ms: 300,
  /** NFR-P1 (= NFR-U3) — RTM message delivery (fan-out) latency, p99. */
  rtmFanoutP99Ms: 500,
  /**
   * NFR-P8 — the *target* number of concurrent WebSocket connections per pod.
   *
   * Not a threshold and not something a run either meets or crosses: it is the
   * figure `scenarios/rtm.js` climbs towards, and what a rung actually held is
   * `nexa_rtm_connections_observed`. Kept here because `budgets.test.ts` pins it
   * against the PRD row, so a revised target cannot silently stop being the one
   * the ladder is measured against.
   */
  rtmConnectionsPerPod: 20_000,
  /** NFR-U2 — core API availability (5xx excluded), as a run-scoped floor. */
  apiSuccessRatio: 0.9995,
  /** NFR-U1 — RTM login success rate, as a run-scoped floor. */
  rtmLoginSuccessRatio: 0.999,
});

/**
 * Custom metric names, shared between `metrics.js` (which creates them) and the
 * threshold builders below (which reference them by string, because that is the
 * only way k6 takes them).
 *
 * One table so the two sides cannot drift apart in silence; `budgets.test.ts`
 * asserts `metrics.js` still declares every name listed here.
 */
export const METRIC_NAMES = Object.freeze({
  /** Counter — responses that came back 429. Must stay at zero (see README). */
  rateLimited: 'nexa_rate_limited',
  /**
   * Counter, tagged by `op` — one per operation actually performed.
   *
   * This is the anti-vacuum metric. See {@link exercised}.
   */
  measured: 'nexa_measured',
  /** Trend, ms — event publish → subscriber receipt. NFR-P1. */
  fanoutLatency: 'nexa_rtm_fanout_ms',
  /** Rate — RTM `login` attempts that succeeded. NFR-U1. */
  rtmLoginSuccess: 'nexa_rtm_login_success',
  /** Trend, ms — socket handshake → successful `login`. Degradation signal. */
  rtmConnectLatency: 'nexa_rtm_connect_ms',
  /** Counter — sockets that never reached a logged-in state. */
  rtmConnectFailed: 'nexa_rtm_connect_failed',
  /** Counter — live sockets the gateway or the network took away. */
  rtmSocketDropped: 'nexa_rtm_socket_dropped',
  /** Rate — reconnects whose `sync` replayed what the gap missed. NFR-R2. */
  rtmSyncRecovered: 'nexa_rtm_sync_recovered',
  /**
   * Trend — sockets the gateway itself reports holding, sampled from its own
   * `/health` while the plateau is up. NFR-P8's number, read from the pod
   * rather than from the load generator's intent: "we asked for 5000" and "the
   * pod is holding 5000" are different claims, and only the second one is the
   * requirement. `max` is the one that matters, which is why it is in
   * {@link SUMMARY_TREND_STATS}.
   */
  rtmConnectionsObserved: 'nexa_rtm_connections_observed',
  /**
   * Trend, ms — the publishing `POST /chats/:id/events` itself.
   *
   * The fan-out measurement starts when the publisher sends that request, so
   * the REST write is inside the number NFR-P1 is judged on (deliberately —
   * see `scenarios/rtm.js`). This is what lets a reader take it back out.
   * Recorded as its own metric rather than read off `http_req_duration{op:write}`
   * because k6 only materialises a tagged sub-metric when a threshold names it,
   * and this scenario has no business claiming NFR-P2's write budget.
   */
  rtmPublishLatency: 'nexa_rtm_publish_ms',
});

/**
 * The `op` tag every measured call carries.
 *
 * `read` and `write` keep the two NFR-P2 budgets apart; `fanout` marks an RTM
 * delivery; `setup` marks the sign-in round trips, which are counted but
 * budgeted by nothing — three sequential auth calls would drag a p99 that is
 * meant to describe one endpoint.
 */
export const OP_TAGS = Object.freeze({
  read: 'read',
  write: 'write',
  fanout: 'fanout',
  setup: 'setup',
  /**
   * An observation *about* the run rather than part of it — today the RTM
   * `/health` poll that reads how many sockets the pod is holding. Kept out of
   * `read` for the same reason `setup` is: it is the suite's own traffic, and
   * folding it into a budget would let the harness flatter or spoil a number
   * that is supposed to describe the product's endpoints.
   */
  probe: 'probe',
});

/** `p(99)<N`, in the one place the expression is spelled. */
function p99Under(budgetMs) {
  return `p(99)<${budgetMs}`;
}

/** `rate<N`, from a success ratio: 99.95% available means <0.05% failed. */
function failureRateUnder(successRatio) {
  // Written out rather than left as 1 - 0.9995 = 0.0005000000000000004, which
  // k6 accepts but prints back in threshold failures as noise.
  return `rate<${Number((1 - successRatio).toFixed(6))}`;
}

/**
 * Thresholds every scenario carries, whatever it exercises.
 *
 * The 429 counter is not a nicety. Agent traffic is capped at 180/min per
 * account (ADR-07), so a scenario that out-runs its own quota stops measuring
 * the product and starts measuring the rate limiter — while still producing a
 * confident-looking latency number. Failing the run is the only honest answer;
 * README.md §"Staying under the rate limit" says how to buy headroom.
 */
export function sharedThresholds() {
  return {
    [`${METRIC_NAMES.rateLimited}`]: ['count==0'],
    checks: ['rate==1.00'],
    http_req_failed: [failureRateUnder(NFR_BUDGETS.apiSuccessRatio)],
  };
}

/**
 * The proof that a latency budget was actually driven.
 *
 * k6 evaluates a percentile threshold on a metric that received **no samples**
 * as passing. Measured here on the first green `smoke.js` run: it reported
 * `http_req_duration{op:write} p(99)<300` as PASS while sending zero writes. A
 * suite whose whole job is to refuse unmeasured stamps must not hand one out
 * for a budget nothing touched.
 *
 * `count>0` is not available on a trend (k6 refuses: "unsupported aggregation
 * method count on metric of type trend"), so the proof is a counter alongside
 * it. `lib/http.js` increments it from the same call that sets the `op` tag, so
 * the two cannot drift.
 */
function exercised(op) {
  return { [`${METRIC_NAMES.measured}{op:${op}}`]: ['count>0'] };
}

/**
 * Which counter proves which latency budget was driven.
 *
 * Explicit rather than derived: `budgets.test.ts` walks every p99 threshold and
 * fails if it has no entry here, which is what stops a future scenario from
 * adding a budget with no proof that anything exercised it.
 */
export const BUDGET_PROOFS = Object.freeze({
  [`http_req_duration{op:${OP_TAGS.read}}`]: OP_TAGS.read,
  [`http_req_duration{op:${OP_TAGS.write}}`]: OP_TAGS.write,
  [METRIC_NAMES.fanoutLatency]: OP_TAGS.fanout,
});

/**
 * REST latency thresholds — read and write are separate budgets (NFR-P2).
 *
 * @param {{ read?: boolean, write?: boolean }} exercises which budgets this
 *   scenario actually drives. `smoke.js` reads and does not write.
 */
export function restThresholds({ read = true, write = true } = {}) {
  const thresholds = sharedThresholds();
  if (read) {
    thresholds[`http_req_duration{op:${OP_TAGS.read}}`] = [p99Under(NFR_BUDGETS.restReadP99Ms)];
    Object.assign(thresholds, exercised(OP_TAGS.read));
  }
  if (write) {
    thresholds[`http_req_duration{op:${OP_TAGS.write}}`] = [p99Under(NFR_BUDGETS.restWriteP99Ms)];
    Object.assign(thresholds, exercised(OP_TAGS.write));
  }
  return thresholds;
}

/**
 * RTM thresholds — and, with them, the definition of "this pod is degraded".
 *
 * NFR-P8 is not a budget a run either meets or crosses; it is a number to be
 * *found*, by holding more and more sockets until the single pod stops coping.
 * Which means "stops coping" has to be written down **before** the measurement,
 * or the number it produces is whatever the operator felt like calling a limit.
 * It is written down here, as thresholds, so the ladder is self-terminating:
 * the first rung whose run exits non-zero is the degradation point, and the
 * threshold that failed says which of the three kinds of degradation it was.
 *
 *   1. **Too slow** — `nexa_rtm_fanout_ms p(99) ≥ 500 ms`: the sockets are all
 *      still there and delivery has fallen outside NFR-P1's budget.
 *   2. **Refusing connections** — `nexa_rtm_connect_failed > 0`: a socket could
 *      not be opened, or opened and could not log in.
 *   3. **Dropping connections** — `nexa_rtm_socket_dropped > 0`: a socket that
 *      was live went away without the scenario asking it to.
 *
 * A fourth kind — sockets that stay open and stop *receiving* — is not a
 * threshold because it is per-socket rather than aggregate; `rtm.js` checks it
 * on every socket at close, and `checks rate==1.00` (inherited) is what makes
 * it fail the run.
 *
 * The three above are all product-side readings. The load *generator* hitting
 * an operating-system limit — file descriptors, ephemeral ports — produces the
 * same red as (2), and the two must not be reported as one thing: see
 * README §"Reading a red run: the pod, or this laptop?".
 *
 * @param {{ reconnect?: boolean }} [options] whether this run drives the
 *   reconnect + missed-event-sync path (NFR-R2). Declared rather than always
 *   claimed, for the same reason `restThresholds` lets a read-only scenario
 *   decline the write budget: a `Rate` with no samples reads as 0, so an
 *   unconditional `rate==1.00` would fail every run that does no reconnects.
 * @returns {Record<string, string[]>} metric → k6 threshold expressions
 */
export function rtmThresholds({ reconnect = false } = {}) {
  const thresholds = {
    ...sharedThresholds(),
    [METRIC_NAMES.fanoutLatency]: [p99Under(NFR_BUDGETS.rtmFanoutP99Ms)],
    ...exercised(OP_TAGS.fanout),
    // A Rate with no samples reads as 0, so this one already fails when the
    // scenario never logs in — it needs no companion.
    [METRIC_NAMES.rtmLoginSuccess]: [`rate>=${NFR_BUDGETS.rtmLoginSuccessRatio}`],
    [METRIC_NAMES.rtmConnectFailed]: ['count==0'],
    [METRIC_NAMES.rtmSocketDropped]: ['count==0'],
  };
  if (reconnect) {
    // NFR-R2 under load. Not a floor: a reconnect that came back and could not
    // recover its missed events is the failure this requirement exists about,
    // so one is one too many.
    thresholds[METRIC_NAMES.rtmSyncRecovered] = ['rate==1.00'];
  }
  return thresholds;
}

/**
 * The percentiles k6 keeps for every trend.
 *
 * k6's default stops at p(95); every budget in this file is a p99, so without
 * this the summary would not contain the number the thresholds are judged on
 * and 161.4 would have nothing to write into PLAN §7.2.
 */
export const SUMMARY_TREND_STATS = Object.freeze([
  'avg',
  'min',
  'med',
  'p(95)',
  'p(99)',
  'max',
  'count',
]);
