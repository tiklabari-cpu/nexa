/**
 * Widget visitors, the way an office NAT or a tunnel puts them on the wire:
 * many visitors, one address (tm 407).
 *
 * Every VU is one visitor of the seeded Acme Bikes workspace. Its first
 * iteration mints a customer token through the real door (`POST
 * /customer/token`, from the trusted origin), and every iteration then does
 * what the widget does — sends a message and polls the conversation:
 *   - `POST /customer/chat/events`  — the visitor's message      (op:write)
 *   - `GET /customer/chat`          — the widget's poll          (op:read)
 *
 * Every VU runs on this one machine, so every visitor arrives from one
 * address. That is the point of the scenario. A widget request used to be
 * charged to the anonymous 30/min of its address as well as to its visitor,
 * so the pilot's load run was refused on its 28th message; the shared
 * `siyahtus_rate_limited count==0` threshold is what turns that back red if it
 * ever returns. Run at the stack's default limits — nothing to raise first,
 * unlike `rest.js`: per visitor this asks `2 ÷ LOAD_WIDGET_PACING_SECONDS × 60`
 * = 30/min of the per-visitor 60, and per address `LOAD_VUS` times that, inside
 * the address-wide 600 up to 20 VUs. The mints are anonymous: one per VU plus
 * the two sign-in calls of `setup()`, inside the 30/min up to 28 VUs.
 */
import { check, fail, sleep } from 'k6';
import { CONFIG, stages } from '../lib/config.js';
import { get, postJson } from '../lib/http.js';
import { signIn } from '../lib/session.js';
import { OP_TAGS, restThresholds, SUMMARY_TREND_STATS } from '../lib/thresholds.js';
import { summaryHandler } from '../lib/summary.js';

export const options = {
  scenarios: {
    widget: { executor: 'ramping-vus', startVUs: 0, stages: stages(), gracefulRampDown: '5s' },
  },
  thresholds: restThresholds(),
  summaryTrendStats: SUMMARY_TREND_STATS,
};

/**
 * Runs once, before any VU. Signs in only to learn the workspace's id — the
 * one thing the mint needs that the seed does not spell in a fixed form.
 */
export function setup() {
  const ready = get(CONFIG.healthUrl, OP_TAGS.setup);
  if (!check(ready, { 'stack is ready': (r) => r.status === 200 })) {
    fail(`${CONFIG.healthUrl} answered ${ready.status} — is the stack up? (README §Running)`);
  }
  return { organizationId: signIn().organizationId };
}

/** This VU's visitor. VU-local: k6 gives every VU its own module scope. */
let visitorHeaders = null;

/**
 * A visitor's token, or null when the mint refused — a failed check, retried
 * on the next iteration. Not `fail()`: that aborts the iteration before its
 * sleep, so a refused mint was retried in a tight loop, and the measured
 * pre-fix run (tm 407) logged ~14 000 requests where the widget would send ~200.
 */
function mint(organizationId) {
  const minted = postJson(
    `${CONFIG.apiBaseUrl}/customer/token`,
    { organization_id: organizationId },
    OP_TAGS.setup,
    { headers: { Origin: CONFIG.widgetOrigin } },
  );
  if (!check(minted, { 'POST /customer/token is 200': (r) => r.status === 200 })) return null;
  return { Authorization: `Bearer ${minted.json('token')}` };
}

export default function ({ organizationId }) {
  visitorHeaders ??= mint(organizationId);
  if (visitorHeaders) visit(visitorHeaders);
  sleep(CONFIG.widgetPacingSeconds);
}

/** One beat of the widget: the visitor's message, then the poll. */
function visit(headers) {
  const sent = postJson(
    `${CONFIG.apiBaseUrl}/customer/chat/events`,
    { text: `load widget.js — visitor ${__VU} message ${__ITER}` },
    OP_TAGS.write,
    { headers },
  );
  check(sent, { 'POST /customer/chat/events is 201': (r) => r.status === 201 });

  const polled = get(`${CONFIG.apiBaseUrl}/customer/chat`, OP_TAGS.read, { headers });
  check(polled, {
    'GET /customer/chat is 200': (r) => r.status === 200,
    'GET /customer/chat has the conversation': (r) => r.status === 200 && r.json('chat') !== null,
  });
}

// The visitor's pacing, not the suite-wide `LOAD_PACING_SECONDS` this scenario
// never reads — a results file naming the wrong dial misstates the profile.
export const handleSummary = summaryHandler('widget', {
  profile: { pacing_seconds: CONFIG.widgetPacingSeconds },
});
