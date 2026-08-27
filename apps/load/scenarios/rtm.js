/**
 * N concurrent agent sockets, one publisher, and the two numbers this suite was
 * built to produce: **NFR-P1** (fan-out p99 < 500 ms) and the first real
 * measurement of **NFR-P8** (concurrent WebSocket connections a single pod
 * holds). NFR-R2 — reconnect plus missed-event sync — is exercised at the same
 * time, because a resilience property that only holds on an idle gateway is not
 * the property the requirement is about.
 *
 * ## What is being timed
 *
 * A publisher VU POSTs a message whose text carries the instant it was sent
 * (`lib/protocol.js#markerText`); every subscribed socket reads that instant
 * back out of the push it receives and records the difference. Publisher and
 * subscriber are VUs inside one k6 process, so both readings come from one
 * clock — the measurement is a latency, not a comparison of two machines'
 * ideas of the time.
 *
 * The span therefore covers **`POST /chats/:id/events` → transaction commit →
 * Redis publish → gateway fan-out → socket receipt**, not the gateway alone.
 * That is deliberate and it is an *upper bound* on NFR-P1: what the requirement
 * promises is a subset of what is measured, so a run inside the budget is
 * honest evidence, and the REST share is separately visible in the summary as
 * `http_req_duration{op:write}` for anyone who wants to subtract it. The
 * alternative — publishing straight onto the Redis channel — would measure a
 * path no message in production ever takes.
 *
 * ## What "degraded" means
 *
 * Written down before the measurement, and encoded as thresholds so the ladder
 * cannot be argued with afterwards — see `lib/thresholds.js#rtmThresholds`.
 * Fan-out p99 outside NFR-P1's budget, a connection that could not be
 * established, a live connection lost, or a socket that stayed open and stopped
 * receiving: any one of those exits the run non-zero, and the threshold that
 * failed names which kind it was.
 *
 * ## Rate limits (ADR-07)
 *
 * A held socket sends `login`, then one `ping` every 10 s, plus at most one
 * `sync` — far inside the 10 messages/second/connection cap. The publisher's
 * REST traffic is one write per `LOAD_RTM_PUBLISH_INTERVAL`, i.e. 30/min at the
 * default, inside the 180/min agent cap without raising anything. Push the
 * publish rate up and the shared `nexa_rate_limited count==0` threshold turns
 * the run red rather than quietly measuring the rate limiter.
 *
 * Run it: `make load-rtm`, or `k6 run scenarios/rtm.js` with `LOAD_RTM_*` set.
 * README §"Finding NFR-P8" has the ladder, and §"Cleaning up after a write
 * scenario" has the `DELETE` that removes what a run added.
 */
import { check, sleep } from 'k6';
import { CONFIG, firstSocketForVu, rtmPlan, socketsForVu } from '../lib/config.js';
import { get, postJson } from '../lib/http.js';
import {
  fanoutLatency,
  observe,
  rtmConnectFailed,
  rtmConnectionsObserved,
  rtmConnectLatency,
  rtmLoginSuccess,
  rtmPublishLatency,
  rtmSocketDropped,
  rtmSyncRecovered,
} from '../lib/metrics.js';
import {
  markerText,
  markerTimestamp,
  RTM_FANOUT_PUSH,
  RTM_PING_INTERVAL_MS,
  RTM_PROTOCOL_VERSION,
} from '../lib/protocol.js';
import { openRtmSocket } from '../lib/rtm-socket.js';
import { findQueuedChatId } from '../lib/seed.js';
import { authHeaders, signIn } from '../lib/session.js';
import { summaryHandler } from '../lib/summary.js';
import { OP_TAGS, rtmThresholds, SUMMARY_TREND_STATS } from '../lib/thresholds.js';

const PLAN = rtmPlan();

export const options = {
  scenarios: {
    // Holds the connections. `per-vu-iterations` with a single iteration
    // because each VU's iteration *is* the whole run for its own sockets:
    // open, hold, close. A ramping executor would keep starting new
    // iterations, i.e. keep opening more sockets, which is not what a
    // "how many can it hold at once" measurement means.
    sockets: {
      executor: 'per-vu-iterations',
      exec: 'sockets',
      vus: PLAN.vus,
      iterations: 1,
      maxDuration: `${PLAN.holdSeconds + 60}s`,
      gracefulStop: '15s',
    },
    // Starts only once every socket is up, so no message is published to an
    // audience that is still connecting — a missed delivery has to mean the
    // gateway missed it, not that nobody was listening yet.
    publisher: {
      executor: 'shared-iterations',
      exec: 'publisher',
      vus: 1,
      iterations: PLAN.publishes,
      startTime: `${PLAN.connectSeconds}s`,
      maxDuration: `${PLAN.publishSeconds + 60}s`,
      gracefulStop: '5s',
    },
  },
  thresholds: rtmThresholds({ reconnect: PLAN.reconnects > 0 }),
  summaryTrendStats: SUMMARY_TREND_STATS,
};

/** Runs once, before any VU. Both calls are tagged `setup` — see `rest.js`. */
export function setup() {
  const ready = get(CONFIG.healthUrl, OP_TAGS.setup);
  if (!check(ready, { 'stack is ready': (r) => r.status === 200 })) {
    throw new Error(`${CONFIG.healthUrl} answered ${ready.status} — is the stack up?`);
  }

  const session = signIn();
  return { session, chatId: findQueuedChatId(session) };
}

// ---------------------------------------------------------------------------
// The sockets
// ---------------------------------------------------------------------------

/**
 * One VU's share of the connections, opened at the run-wide rate, held to the
 * same deadline, then closed.
 *
 * Every socket runs to completion on its own; `runSocket` never rejects, so one
 * refused connection cannot abandon the other twenty-four this VU is holding —
 * which would turn a single failure into a wave of them and misreport the
 * capacity by a whole VU's worth.
 */
export async function sockets(data) {
  const startedAt = Date.now();
  const closeAt = startedAt + PLAN.holdSeconds * 1_000;
  const publishStartAt = startedAt + PLAN.connectSeconds * 1_000;
  // Halfway through the publish window: late enough that the socket has
  // received something to hold a cursor from, early enough that there is still
  // traffic to miss while it is away.
  const reconnectAt =
    startedAt + (PLAN.connectSeconds + Math.floor(PLAN.publishSeconds / 2)) * 1_000;

  const first = firstSocketForVu(PLAN, __VU);
  const count = socketsForVu(PLAN, __VU);

  const running = [];
  for (let i = 0; i < count; i += 1) {
    running.push(runSocket(data, { index: first + i, closeAt, reconnectAt, publishStartAt }));
    if (i < count - 1) await delay(PLAN.staggerMs);
  }
  await Promise.all(running);
}

/** Open → log in → hold (perhaps reconnecting once) → close. Never rejects. */
async function runSocket(data, { index, closeAt, reconnectAt, publishStartAt }) {
  const state = { received: 0, lastEventId: null };
  let socket = await connect(data, state);
  if (!socket) return;

  // A pod that cannot accept connections as fast as this rung asks is a
  // finding — but it is a *different* finding from one that accepts them and
  // then fails to deliver, and the two would look identical in the delivery
  // check below (a socket that logged in late genuinely missed the messages
  // sent before it arrived). Separated here so the failing check names which
  // one happened.
  const inTime = Date.now() <= publishStartAt;
  check(inTime, { 'socket was logged in before the first publish': (ok) => ok });

  // The gateway closes a socket that has sent nothing for 30 s, and only client
  // frames count. Without this every socket would drop mid-run and the drop
  // would be read as the pod's limit.
  const pinger = setInterval(() => {
    if (!socket.isClosed()) socket.request('ping').catch(ignore);
  }, RTM_PING_INTERVAL_MS);

  try {
    if (PLAN.reconnects > 0 && index % CONFIG.rtmReconnectEvery === 0) {
      await sleepUntil(reconnectAt);
      const recovered = await reconnect(data, state, socket);
      if (recovered === null) return;
      socket = recovered;
    }
    await sleepUntil(closeAt);
  } finally {
    clearInterval(pinger);
    socket.close();
  }

  // The fourth kind of degradation: a socket that is still open and has
  // stopped receiving. Aggregate thresholds cannot see it — the run's total
  // delivery count stays high while one socket goes deaf — so it is checked
  // here, per socket, and `checks rate==1.00` is what fails the run.
  //
  // Only for the sockets that were live before the first publish: for a late
  // one the missing messages are already reported, by name, above.
  if (inTime) {
    check(state, {
      [`socket received at least ${PLAN.expectedPushes} of ${PLAN.publishes} published events`]: (
        s,
      ) => s.received >= PLAN.expectedPushes,
    });
  }
}

/**
 * Open a socket and log it in, or count the failure and return `null`.
 *
 * A handshake that never completed is deliberately *not* counted as a failed
 * login: NFR-U1 is about logins that were attempted, and folding "the pod
 * refused the connection" into it would make one number mean two things.
 * `nexa_rtm_connect_failed` is the one that covers both.
 */
async function connect(data, state) {
  const url = `${CONFIG.rtmUrl}?organization_id=${encodeURIComponent(data.session.organizationId)}`;
  const startedAt = Date.now();

  let socket;
  try {
    socket = await openRtmSocket(url, {
      onPush: (frame) => track(frame, state),
      onDropped: (code) => {
        rtmSocketDropped.add(1);
        report(`socket dropped with close code ${code === null ? 'unknown' : code}`);
      },
    });
  } catch (error) {
    rtmConnectFailed.add(1);
    report(`could not open the socket: ${error.message}`);
    return null;
  }

  try {
    const response = await socket.request('login', {
      token: `Bearer ${data.session.accessToken}`,
      pushes: { [RTM_PROTOCOL_VERSION]: [RTM_FANOUT_PUSH] },
    });
    rtmLoginSuccess.add(response.success === true);
    if (response.success !== true) {
      rtmConnectFailed.add(1);
      socket.close();
      return null;
    }
  } catch (error) {
    // No answer at all — the socket is up but the gateway is not keeping up.
    rtmLoginSuccess.add(false);
    rtmConnectFailed.add(1);
    report(`login got no answer: ${error.message}`);
    socket.close();
    return null;
  }

  rtmConnectLatency.add(Date.now() - startedAt);
  return socket;
}

/**
 * Drop the socket, stay away long enough to miss a message, come back and ask
 * for what was missed — NFR-R2, under whatever load this rung is applying.
 *
 * The events `sync` replays are added to the socket's received count, so a
 * reconnecting socket is held to the same delivery expectation as one that
 * never left: recovering the gap is the requirement, not an excuse for a hole.
 *
 * @returns the new socket, or `null` when the reconnect could not be made
 */
async function reconnect(data, state, socket) {
  const cursor = state.lastEventId;
  socket.close();
  await delay(PLAN.reconnectGapMs);

  const reopened = await connect(data, state);
  if (!reopened) return null;

  let recovered = 0;
  try {
    const response = await reopened.request('sync', { cursors: { [data.chatId]: cursor } });
    if (response.success === true) recovered = countReplayed(response, state);
  } catch {
    recovered = 0;
  }

  rtmSyncRecovered.add(recovered > 0);
  check(recovered, {
    'reconnect replayed the events missed while the socket was away': (n) => n > 0,
  });
  return reopened;
}

/** A push this run published, timed and counted. Anything else is ignored. */
function track(frame, state) {
  if (frame.action !== RTM_FANOUT_PUSH) return;
  const event = frame.payload && frame.payload.event;
  if (!event) return;

  // The cursor follows every event on the chat, not only this suite's, so a
  // reconnect asks `sync` for the right position even on a workspace where
  // something else is also writing.
  if (typeof event.id === 'string') state.lastEventId = event.id;

  const sentAt = markerTimestamp(event.text);
  if (sentAt === null) return;
  fanoutLatency.add(Date.now() - sentAt);
  observe(null, OP_TAGS.fanout);
  state.received += 1;
}

/** This suite's events inside a `sync` response, folded into the socket's count. */
function countReplayed(response, state) {
  const chats = (response.payload && response.payload.chats) || [];
  let recovered = 0;
  for (const chat of chats) {
    for (const event of chat.events || []) {
      if (typeof event.id === 'string') state.lastEventId = event.id;
      if (markerTimestamp(event.text) === null) continue;
      recovered += 1;
      state.received += 1;
    }
  }
  return recovered;
}

// ---------------------------------------------------------------------------
// The publisher
// ---------------------------------------------------------------------------

/**
 * One message per iteration, stamped with the instant it was sent, plus a read
 * of how many sockets the gateway says it is holding.
 *
 * The health poll rides along here rather than in its own scenario because it
 * has to happen while the plateau is up, and this is the VU that is awake for
 * exactly that window.
 */
export function publisher(data) {
  const startedAt = Date.now();
  const reply = postJson(
    `${CONFIG.apiBaseUrl}/chats/${data.chatId}/events`,
    { type: 'message', text: markerText(startedAt, __VU, __ITER) },
    OP_TAGS.write,
    { headers: authHeaders(data.session) },
  );
  check(reply, {
    'POST /chats/:id/events is 200 or 201': (r) => r.status === 200 || r.status === 201,
  });
  rtmPublishLatency.add(reply.timings.duration);

  observeConnections(data);

  // Sleep the *remainder* of the interval, not the whole of it.
  //
  // Sleeping a fixed 2 s would make each iteration cost 2 s **plus** the two
  // requests above, and under load those are not free. Measured at the 8000
  // rung before this was fixed: iterations stretched to ~4 s, the twenty
  // publishes ran ~40 s past the schedule `rtmPlan()` sized the run against,
  // and the last of them went out after every socket had already closed. The
  // result looked exactly like the gateway failing to deliver — 7949 sockets
  // "missing" messages — and was the harness publishing into an empty room.
  const elapsed = (Date.now() - startedAt) / 1_000;
  // If an iteration cannot fit inside its own interval the schedule has slipped
  // and the delivery numbers this run produces are not about the product. Said
  // by name rather than left to be misread as a gateway fault.
  check(elapsed, {
    'a publish iteration fits inside its interval': (e) => e <= CONFIG.rtmPublishIntervalSeconds,
  });
  sleep(Math.max(0, CONFIG.rtmPublishIntervalSeconds - elapsed));
}

/**
 * How many sockets the pod reports holding, from its own `/health`.
 *
 * Admin-gated (M-SEC-b2), which the seeded owner's session satisfies. A run
 * whose credential cannot read the detail simply records nothing rather than
 * failing: the connection count is the finding, not the gate, and losing a
 * whole capacity run to a health-route permission would be the worse outcome.
 */
function observeConnections(data) {
  const response = get(CONFIG.rtmHealthUrl, OP_TAGS.probe, {
    headers: authHeaders(data.session),
  });
  if (response.status !== 200) return;
  const connections = response.json('connections');
  if (typeof connections === 'number') rtmConnectionsObserved.add(connections);
}

// ---------------------------------------------------------------------------

/**
 * The reason behind the first socket failure this VU sees.
 *
 * A capacity run's whole output is "it broke at N" — and the next decision
 * turns entirely on *why*, because "the gateway refused" and "this laptop ran
 * out of ephemeral ports" are the same counter and completely different
 * findings (README §"Reading a red run"). The counters say how many; nothing
 * else would say what.
 *
 * Once per VU, not once per socket: at the rung where things break, thousands
 * of sockets break the same way, and a run that prints all of them buries the
 * summary. Module scope is per-VU in k6, so this bounds the output to the VU
 * count. A green run prints nothing at all.
 */
let reported = false;
function report(reason) {
  if (reported) return;
  reported = true;
  console.log(`rtm.js — first socket failure in VU ${__VU}: ${reason}`);
}

/** `sleep()` blocks the VU's event loop, which would stall every socket it owns. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepUntil(deadline) {
  return delay(Math.max(0, deadline - Date.now()));
}

function ignore() {}

export const handleSummary = summaryHandler('rtm', {
  // Each rung of the ladder keeps its own file — the whole point is comparing
  // them, and a single `rtm.json` would leave only the last one.
  fileStem: `rtm-${PLAN.connections}`,
  profile: {
    rtm_connections: PLAN.connections,
    rtm_vus: PLAN.vus,
    rtm_sockets_per_vu: PLAN.socketsPerVu,
    rtm_connect_rate_per_second: CONFIG.rtmConnectRatePerSecond,
    rtm_connect_seconds: PLAN.connectSeconds,
    rtm_hold_seconds: PLAN.holdSeconds,
    rtm_publishes: PLAN.publishes,
    rtm_publish_interval_seconds: CONFIG.rtmPublishIntervalSeconds,
    rtm_reconnecting_sockets: PLAN.reconnects,
  },
});
