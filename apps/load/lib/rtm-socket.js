/**
 * One agent socket, spoken to the way the panel speaks to it.
 *
 * The k6 module choice is not incidental, so it is written down: this uses
 * **`k6/websockets`**, the asynchronous API. The older `k6/ws` blocks the whole
 * VU inside `ws.connect()` until the socket closes, which pins one VU to one
 * connection — and a VU is a full JavaScript runtime. Measuring thousands of
 * connections that way measures how much memory k6 needs, not how many sockets
 * the gateway holds. With the async API one VU owns many sockets and the VU
 * count stays small. (`k6/experimental/websockets` still resolves in k6 v2.2.0
 * but warns that it is deprecated; `k6/net/websockets` does not exist there at
 * all — measured, not assumed.)
 *
 * Deliberately thin: it knows about frames, request/response correlation and
 * closing, and nothing about NFRs. What the socket is *for* is the scenario's
 * business. It is the same shape as `apps/rtm/test/helpers/rtm-harness.ts`'s
 * `TestSocket`, and for the same reason — the login window, the framing and the
 * delivery path only exist at the socket level, so a fake would test the fake.
 *
 * No `class` and no `#private` fields on purpose: k6 runs its own JavaScript
 * engine, and this file has no business being the place where its support for
 * a newer syntax is discovered.
 */
import { WebSocket } from 'k6/websockets';
import { RTM_PROTOCOL_VERSION } from './protocol.js';

/** How long a `request` waits for its response — the gateway's own deadline. */
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** How long the handshake gets before the attempt counts as a failure. */
const DEFAULT_OPEN_TIMEOUT_MS = 30_000;

/**
 * Open a socket and resolve once it is connected (not yet logged in).
 *
 * Rejects on a handshake error, on a close that arrives before the open, and on
 * a timeout — all three are the same fact for a capacity run ("this connection
 * was refused"), and the caller counts them as one.
 *
 * @param {string} url
 * @param {{
 *   onPush?: (frame: object) => void,
 *   onDropped?: (code: number | null) => void,
 *   openTimeoutMs?: number,
 * }} [options] `onDropped` fires only for a close the caller did not ask for —
 *   a socket the gateway or the network took away, which is a degradation
 *   signal, as opposed to `close()`, which is the scenario finishing.
 * @returns {Promise<object>} the socket handle
 */
export function openRtmSocket(url, options = {}) {
  const onPush = options.onPush ?? (() => {});
  const onDropped = options.onDropped ?? (() => {});
  const openTimeoutMs = options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    /** @type {Map<string, { resolve: (frame: object) => void, reject: (error: Error) => void, timer: unknown }>} */
    const pending = new Map();
    let counter = 0;
    let settled = false;
    let closed = false;
    let deliberate = false;
    /**
     * Whether this attempt already reported itself as a failed *open*.
     *
     * Measured, at the 8000-socket rung: an errored or timed-out handshake
     * settles the promise and then still delivers an `onclose`, so without this
     * flag the same socket is counted once as "could not connect" and once as
     * "a live connection was lost" — two different kinds of degradation, from
     * one event that was only the first. The two counters came back exactly
     * equal (53 and 53) twice in a row, which is how it was noticed.
     */
    let failedToOpen = false;

    const ws = new WebSocket(url);

    const openTimer = setTimeout(() => {
      fail(new Error(`socket did not open within ${openTimeoutMs} ms`));
      try {
        ws.close();
      } catch {
        // Nothing to close — the handshake never got that far.
      }
    }, openTimeoutMs);

    function fail(error) {
      if (settled) return;
      settled = true;
      failedToOpen = true;
      clearTimeout(openTimer);
      reject(error);
    }

    /** Settle every in-flight request, so no `await` outlives the socket. */
    function abandonPending(reason) {
      for (const waiting of pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error(reason));
      }
      pending.clear();
    }

    const handle = {
      /**
       * Send an action and resolve with its response frame — success or not.
       * A refusal is an answer, and the caller decides what it means; only a
       * missing answer rejects.
       */
      request(action, payload = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
        return new Promise((resolveRequest, rejectRequest) => {
          if (closed) {
            rejectRequest(new Error(`socket is closed — cannot send "${action}"`));
            return;
          }
          const requestId = `k6-${(counter += 1)}`;
          const timer = setTimeout(() => {
            pending.delete(requestId);
            rejectRequest(new Error(`"${action}" got no response within ${timeoutMs} ms`));
          }, timeoutMs);
          pending.set(requestId, { resolve: resolveRequest, reject: rejectRequest, timer });

          try {
            ws.send(
              JSON.stringify({
                version: RTM_PROTOCOL_VERSION,
                request_id: requestId,
                action,
                payload,
              }),
            );
          } catch (error) {
            pending.delete(requestId);
            clearTimeout(timer);
            rejectRequest(error instanceof Error ? error : new Error(String(error)));
          }
        });
      },

      /** Close on purpose — this is what keeps `onDropped` meaning "we lost it". */
      close() {
        deliberate = true;
        try {
          ws.close();
        } catch {
          // Already gone; `onclose` has run or will not run at all.
        }
      },

      isClosed() {
        return closed;
      },
    };

    ws.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(openTimer);
      resolve(handle);
    };

    ws.onerror = (event) => {
      fail(new Error(`socket error: ${describe(event)}`));
    };

    ws.onmessage = (event) => {
      let frame;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        // A frame this suite cannot parse is the gateway's problem to report,
        // not something to crash a 5000-socket run over.
        return;
      }

      if (frame.type === 'push') {
        onPush(frame);
        return;
      }

      const waiting = typeof frame.request_id === 'string' ? pending.get(frame.request_id) : null;
      if (!waiting) return;
      pending.delete(frame.request_id);
      clearTimeout(waiting.timer);
      waiting.resolve(frame);
    };

    ws.onclose = (event) => {
      closed = true;
      const code = event && typeof event.code === 'number' ? event.code : null;
      abandonPending(`socket closed (code ${code === null ? 'unknown' : code})`);
      if (!settled) {
        fail(
          new Error(`socket closed before it opened (code ${code === null ? 'unknown' : code})`),
        );
        return;
      }
      // A connection is only "lost" if it was ever had. An attempt that already
      // failed to open reports itself once, as a failed connection.
      if (!deliberate && !failedToOpen) onDropped(code);
    };
  });
}

/** Whatever the runtime gave us about a failure, in one line. */
function describe(event) {
  if (!event) return 'no detail';
  if (typeof event === 'string') return event;
  if (typeof event.error === 'string') return event.error;
  if (event.error && typeof event.error.message === 'string') return event.error.message;
  if (typeof event.message === 'string') return event.message;
  return 'no detail';
}
