/**
 * The RTM wire facts a scenario needs, kept where a Node test can read them.
 *
 * `lib/rtm-socket.js` speaks the protocol, but it imports `k6/websockets` and
 * so nothing under Node can load it. These constants live here instead, free
 * of every `k6/*` import, for exactly the reason `thresholds.js` is:
 * `test/budgets.test.ts` has to be able to check them against the product's
 * own source (`packages/types/src/rtm.ts`).
 *
 * That check is worth more here than it looks. If the protocol version is ever
 * bumped, this scenario does not break loudly — the gateway answers
 * `unsupported_version` on a *frame*, the socket stays open, and a run in which
 * every login failed still prints a summary and writes a results file. The
 * guard turns a silently wrong measurement into a red unit test.
 */

/** ADR-15 envelope version — `RTM_VERSION` in `packages/types/src/rtm.ts`. */
export const RTM_PROTOCOL_VERSION = '3.6';

/** The agent socket — `RTM_PATHS.agent`. */
export const RTM_AGENT_PATH = '/v1/agent/rtm/ws';

/** The push a fan-out measurement listens for. */
export const RTM_FANOUT_PUSH = 'incoming_event';

/**
 * How often a held socket sends `ping`.
 *
 * The gateway closes a socket that has sent nothing for `RTM_LIMITS
 * .idleTimeoutMs` (30 s) — and it is *client frames* that move `lastSeenAt`,
 * not the transport's own ping/pong. A load run that skipped this would watch
 * every socket drop half a minute in and read it as the pod's capacity limit.
 * Half the idle window, so one lost ping is not yet a disconnect;
 * `budgets.test.ts` re-reads the gateway's timeout and fails if the margin
 * ever disappears.
 */
export const RTM_PING_INTERVAL_MS = 10_000;

/**
 * The text every message this scenario publishes carries.
 *
 * Two jobs. It carries the publish instant, which is what makes fan-out
 * measurable at all: sender and receiver are VUs inside the same k6 process,
 * so the two readings of `Date.now()` come from one clock and the difference
 * is a latency rather than a clock comparison. And it marks the row as this
 * suite's, so a push from anything else on the workspace cannot land in the
 * NFR-P1 trend — and so the run can be cleaned up afterwards with a `DELETE`
 * narrow enough to name (README §"Cleaning up after a write scenario").
 *
 * ## Why the timestamp is split at the decimal point
 *
 * Because the product edits this text on the way in, and the first version of
 * this marker walked straight into it. `POST /chats/:id/events` masks card
 * numbers before persisting (`apps/api/src/lib/cc-mask.ts`, FR-MOD-08.9.5 /
 * PCI SAQ A): any run of 13–19 digits that passes the Luhn checksum becomes
 * `**** **** **** 1234`. An epoch-ms timestamp is exactly 13 digits, and a
 * mod-10 checksum over a free-running counter passes **one time in ten** —
 * measured, both in the abstract (1000 of 10 000 consecutive milliseconds) and
 * on a real run, where 2 of 20 published messages came back with their text
 * masked and their fan-out samples silently missing. The product did nothing
 * wrong: over-masking a Luhn-valid non-card is the trade `cc-mask.ts` documents
 * choosing. The harness was asking to be masked.
 *
 * A `.` between the seconds and the milliseconds is enough, because the
 * detector's separator class is space-or-hyphen only, so the longest digit run
 * left is the 10-digit second count. `test/budgets.test.ts` re-reads that
 * detector's own pattern and fails if a marker ever becomes a candidate again —
 * the failure mode being silent sample loss, which no threshold can see.
 */
const MARKER_PREFIX = 'load rtm.js —';
const MARKER_RE = new RegExp(`^${MARKER_PREFIX} t(\\d+)\\.(\\d{3}) `);

/** @param {number} sentAtMs @param {number} vu @param {number} iteration */
export function markerText(sentAtMs, vu, iteration) {
  const seconds = Math.floor(sentAtMs / 1_000);
  const millis = String(sentAtMs % 1_000).padStart(3, '0');
  return `${MARKER_PREFIX} t${seconds}.${millis} VU${vu} i${iteration}`;
}

/**
 * The publish instant carried by an event's text, or `null` when the text is
 * not this suite's. `null` is the important half: an unrecognised event must be
 * skipped rather than measured, because a fan-out sample computed from someone
 * else's timestamp is not wrong in a way anything downstream could notice.
 *
 * @param {unknown} text
 * @returns {number | null}
 */
export function markerTimestamp(text) {
  if (typeof text !== 'string') return null;
  const match = MARKER_RE.exec(text);
  return match ? Number(match[1]) * 1_000 + Number(match[2]) : null;
}

/** `LIKE` pattern that matches exactly the rows a run of `rtm.js` added. */
export const MARKER_SQL_PATTERN = `${MARKER_PREFIX} %`;
