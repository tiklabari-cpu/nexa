/**
 * The circuit breaker in front of the model (tm 255.6).
 *
 * The retry loop answers "should this call try again?"; this answers "should
 * this call be made at all?". A model call runs inside the request that stored
 * the customer's message, so while the provider is down every message would
 * otherwise wait out its own deadline — up to `LLM_TIMEOUT_MS` each — before a
 * human got it anyway. After `failureThreshold` calls in a row fail for a
 * reason that is the provider's (`LlmProviderError.providerFault`) the circuit
 * opens: for `openMs` no request is made, and each call fails at once with
 * `circuit_open`, which the skill engine hands to a human like any other
 * failure. The first call after the window is the probe — the only one let
 * through while it is in flight — and its result closes the circuit or opens
 * it for another window.
 *
 * It counts *calls*, not attempts: a call that failed once and succeeded on its
 * retry is a healthy call. And it counts only while closed — a call admitted
 * before the circuit opened that finishes afterwards has no say; the window and
 * the probe decide from then on.
 *
 * Per process. Replicas each keep their own, which is the usual trade: a shared
 * breaker would put Redis on the path it exists to keep fast, and N replicas
 * probing once a window is still N requests, not N × traffic.
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

/** Admission to make one call. Hand it back to {@link CircuitBreaker.release}. */
export interface CircuitPermit {
  /** True for the single call let through to test whether the provider recovered. */
  readonly probe: boolean;
}

/** What a released call did to the circuit, for the log. */
export type CircuitTransition = 'opened' | 'closed' | null;

export interface CircuitBreakerOptions {
  /** Consecutive provider faults that open the circuit. */
  failureThreshold: number;
  /** How long the circuit stays open before a probe is let through. */
  openMs: number;
  now?: () => number;
}

export class CircuitBreaker {
  readonly #threshold: number;
  readonly #openMs: number;
  readonly #now: () => number;
  #state: CircuitState = 'closed';
  #failures = 0;
  #openUntil = 0;
  #probing = false;

  constructor(options: CircuitBreakerOptions) {
    this.#threshold = Math.max(1, options.failureThreshold);
    this.#openMs = Math.max(0, options.openMs);
    this.#now = options.now ?? Date.now;
  }

  /** Where the circuit stands now — an elapsed window already reads as half-open. */
  get state(): CircuitState {
    if (this.#state === 'open' && this.#now() >= this.#openUntil) return 'half_open';
    return this.#state;
  }

  get consecutiveFailures(): number {
    return this.#failures;
  }

  /** A permit to make one call, or `null` when no call may be made right now. */
  acquire(): CircuitPermit | null {
    if (this.#state === 'closed') return { probe: false };
    if (this.#state === 'open') {
      if (this.#now() < this.#openUntil) return null;
      this.#state = 'half_open';
    }
    // Half-open: one probe at a time. Everyone else keeps failing fast until it
    // reports, rather than all rushing a provider that may still be down.
    if (this.#probing) return null;
    this.#probing = true;
    return { probe: true };
  }

  /**
   * Report how a call made under `permit` ended. `faulty` means the provider
   * failed; anything else — an answer, or a failure that was the request's own
   * — is `healthy`, because it proves the provider is up and answering.
   */
  release(permit: CircuitPermit, outcome: 'healthy' | 'faulty'): CircuitTransition {
    if (permit.probe) {
      this.#probing = false;
      if (outcome === 'healthy') {
        this.#state = 'closed';
        this.#failures = 0;
        return 'closed';
      }
      this.#open();
      return 'opened';
    }

    if (this.#state !== 'closed') return null;
    if (outcome === 'healthy') {
      this.#failures = 0;
      return null;
    }
    this.#failures += 1;
    if (this.#failures < this.#threshold) return null;
    this.#open();
    return 'opened';
  }

  #open(): void {
    this.#state = 'open';
    this.#openUntil = this.#now() + this.#openMs;
  }
}
