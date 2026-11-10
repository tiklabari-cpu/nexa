/**
 * The gateway's dependency probe, shared between callers (tm 454 · F34).
 *
 * `/health` and `/health/ready` are public and the gateway's HTTP path has no
 * limiter, so each request used to cost a `SELECT 1` and a Redis `PING` of its
 * own: a flood of health requests became a flood of pool checkouts, and the
 * pool it drained is the one every agent login reads from. Two rules keep the
 * cost bounded by time rather than by request count:
 *
 * - **Single flight.** While a probe is running, every caller waits on that
 *   same promise — a hundred concurrent requests cost one `SELECT 1`.
 * - **Short TTL.** A finished result answers for {@link HEALTH_PROBE_TTL_MS},
 *   measured from when the probe *finished*: a probe that spent its whole
 *   two-second timeout must not come back already expired.
 *
 * The TTL is far below any orchestrator's probe interval (Helm readiness
 * `periodSeconds: 10`; compose gives api/rtm no healthcheck of their own), so
 * no orchestrator ever reads a result older than the one it would have
 * produced itself. A degraded result is cached like a healthy one: it is a
 * real observation, and re-probing a dependency that just timed out on every
 * request is exactly the load this exists to stop.
 *
 * The drain answer is not cached here — `server.ts` returns 503 `draining`
 * before it ever asks this class, so a drain is visible on the very next
 * request rather than after the TTL.
 *
 * A probe that rejects is not cached: nothing to remember, and the next
 * caller starts a fresh one.
 */

/** How long a finished probe answers for. */
export const HEALTH_PROBE_TTL_MS = 1_000;

export class SharedProbe<T> {
  readonly #run: () => Promise<T>;
  readonly #ttlMs: number;
  readonly #now: () => number;
  #last: { result: T; at: number } | null = null;
  #inFlight: Promise<T> | null = null;
  #runs = 0;

  constructor(run: () => Promise<T>, options: { ttlMs?: number; now?: () => number } = {}) {
    this.#run = run;
    this.#ttlMs = options.ttlMs ?? HEALTH_PROBE_TTL_MS;
    this.#now = options.now ?? Date.now;
  }

  /** How many probes have actually started — what a flood of requests is measured against. */
  get runs(): number {
    return this.#runs;
  }

  read(): Promise<T> {
    const last = this.#last;
    if (last !== null && this.#now() - last.at < this.#ttlMs) return Promise.resolve(last.result);
    if (this.#inFlight !== null) return this.#inFlight;

    this.#runs += 1;
    const flight = this.#run().then((result) => {
      this.#last = { result, at: this.#now() };
      return result;
    });
    this.#inFlight = flight;
    const clear = () => {
      if (this.#inFlight === flight) this.#inFlight = null;
    };
    flight.then(clear, clear);
    return flight;
  }
}
