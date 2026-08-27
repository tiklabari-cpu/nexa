/**
 * Harness self-check — the scenario that proves the *suite* works, not the
 * scenario that measures the product.
 *
 * It exercises every seam the real scenarios depend on: the readiness probe
 * answers, the PKCE sign-in survives against a seeded stack, an authenticated
 * read is measured and tagged against the NFR-P2 read budget, and a crossed
 * threshold turns into a non-zero exit code. Run it first whenever a load run
 * looks wrong — if smoke is red, the fault is in the harness or the stack, and
 * the numbers from `rest.js` / `rtm.js` mean nothing.
 *
 * The realistic mixes belong to their own files:
 *   - `scenarios/rest.js` — list + transcript + send, NFR-P2 (tm 161.2)
 *   - `scenarios/rtm.js`  — N sockets + fan-out, NFR-P1 / NFR-P8 (tm 161.3)
 */
import { check, fail, sleep } from 'k6';
import { CONFIG, stages } from '../lib/config.js';
import { get } from '../lib/http.js';
import { authHeaders, signIn } from '../lib/session.js';
import { OP_TAGS, restThresholds, SUMMARY_TREND_STATS } from '../lib/thresholds.js';
import { summaryHandler } from '../lib/summary.js';

export const options = {
  scenarios: {
    smoke: { executor: 'ramping-vus', startVUs: 0, stages: stages(), gracefulRampDown: '5s' },
  },
  // Reads only. Claiming the write budget too would have k6 report
  // `op:write p(99)<300` as passing on zero samples — see `exercised`.
  thresholds: restThresholds({ write: false }),
  summaryTrendStats: SUMMARY_TREND_STATS,
};

/**
 * Runs once, before any VU. Both calls here are tagged `op:setup`, which keeps
 * them out of the `op:read` / `op:write` budgets — sign-in is three round trips
 * and would drag a p99 that is supposed to describe one endpoint.
 */
export function setup() {
  const ready = get(CONFIG.healthUrl, OP_TAGS.setup);
  const isReady = check(ready, { 'stack is ready': (r) => r.status === 200 });
  if (!isReady) {
    // Abort rather than let the run spend its whole plateau collecting
    // connection errors that would still be summarised as a latency result.
    fail(`${CONFIG.healthUrl} answered ${ready.status} — is the stack up? (README §Running)`);
  }

  return signIn();
}

export default function (session) {
  const url = `${CONFIG.apiBaseUrl}/chats?view=all&limit=25`;
  const response = get(url, OP_TAGS.read, { headers: authHeaders(session) });

  check(response, {
    'GET /chats is 200': (r) => r.status === 200,
    'GET /chats returns a list': (r) => Array.isArray(r.json('items')),
  });

  sleep(CONFIG.pacingSeconds);
}

export const handleSummary = summaryHandler('smoke');
