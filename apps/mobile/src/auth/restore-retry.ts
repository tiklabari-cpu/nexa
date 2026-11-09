/**
 * Launch, again, until it decides (tm 435 · F17).
 *
 * `MobileSession.restore()` has two ways to finish and one way not to. A
 * refresh token the server refuses ends as "signed out"; one it accepts ends as
 * "signed in". A request that never reached a server — no signal, a 503, a
 * timeout — is neither: `#rotate` rethrows it on purpose, because signing a
 * person out for riding through a tunnel would be the worse bug. But the launch
 * used to call it once with `void` and nothing behind the rejection, so a phone
 * opened without bars stayed on "Opening SiyahTuş…" for as long as the process
 * lived, even after the bars came back.
 *
 * This is the missing caller: it tries again on its own with an exponential
 * backoff (1, 2, 4 … 30 s), tries at once when the app comes back to the
 * foreground (the moment a person is looking, and the likeliest moment the
 * network has changed), and tries at once when asked to — the loading screen's
 * "Try again".
 *
 * **Why `AppState` and not `lib/connectivity`.** The connectivity store hears
 * only the authenticated client's traffic, and while the session is undecided
 * there is none: `restore()` speaks through the session's own anonymous client.
 * Subscribing to it here would listen to a signal that cannot change on this
 * screen.
 *
 * **What it retries.** Any rejection that leaves the session still `unknown`.
 * The ones expected are the retryable network errors `#rotate` rethrows; the
 * rest (a protected store that failed to read) leave the person on the same
 * screen with the same question, and another attempt is the only thing this
 * layer can offer. A rejection after the session has decided — `/auth/me` or
 * the push registration failing once the inbox is already up — is not retried:
 * the launch is over, and running it again would rotate a refresh token for no
 * reason.
 */
import { AppState, type AppStateStatus } from 'react-native';

import type { AppStateLike } from '../rtm/client';
import type { SessionStatus } from './session';

/** First wait after a failed attempt. */
export const RESTORE_RETRY_BASE_MS = 1_000;
/** No wait grows past this — a phone back in coverage should not sit out minutes. */
export const RESTORE_RETRY_MAX_MS = 30_000;

/** The wait after the `failures`-th consecutive failure (1 → 1 s, 2 → 2 s, … capped at 30 s). */
export function restoreRetryDelay(failures: number): number {
  const exponent = Math.max(0, failures - 1);
  // Capped before the power so a long night offline cannot overflow to Infinity.
  return Math.min(RESTORE_RETRY_BASE_MS * 2 ** Math.min(exponent, 16), RESTORE_RETRY_MAX_MS);
}

/** The slice of `MobileSession` this needs. */
export interface RestorableSession {
  restore(): Promise<void>;
  getState(): { status: SessionStatus };
}

export interface SessionRestorerOptions {
  session: RestorableSession;
  /** Injectable for tests; the app uses React Native's own. */
  appState?: AppStateLike;
}

export class SessionRestorer {
  readonly #session: RestorableSession;
  readonly #appState: AppStateLike;
  #inFlight = false;
  #failures = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #subscription: { remove(): void } | null = null;
  #stopped = true;

  constructor(options: SessionRestorerOptions) {
    this.#session = options.session;
    this.#appState = options.appState ?? AppState;
  }

  /**
   * Begin — or, after a `stop()`, resume. Idempotent against an attempt already
   * in flight: React's development double-mount runs effect, cleanup, effect,
   * and a second concurrent `restore()` would read the store and register the
   * handset twice.
   */
  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#subscription = this.#appState.addEventListener('change', this.#onAppStateChange);
    if (!this.#inFlight && this.#timer === null) this.#attempt();
  }

  /**
   * Try now rather than at the end of the current wait. A no-op while an
   * attempt is already running (its answer is the one coming) and once the
   * session has decided. The backoff starts over: a person pressing the button
   * is a fresh start, not the seventh failure in a row. Bound, so a screen can
   * hand it to `onPress` as it is.
   */
  readonly retryNow = (): void => {
    if (this.#stopped || this.#inFlight || !this.#undecided()) return;
    this.#clearTimer();
    this.#failures = 0;
    this.#attempt();
  };

  /** Unmount: no timer and no listener may outlive the provider. */
  stop(): void {
    this.#stopped = true;
    this.#clearTimer();
    this.#subscription?.remove();
    this.#subscription = null;
  }

  readonly #onAppStateChange = (state: AppStateStatus): void => {
    if (state === 'active') this.retryNow();
  };

  #attempt(): void {
    this.#inFlight = true;
    this.#session.restore().then(
      () => {
        this.#inFlight = false;
        this.#failures = 0;
      },
      () => {
        this.#inFlight = false;
        if (this.#stopped || !this.#undecided()) return;
        this.#failures += 1;
        this.#timer = setTimeout(() => {
          this.#timer = null;
          if (!this.#stopped && this.#undecided()) this.#attempt();
        }, restoreRetryDelay(this.#failures));
      },
    );
  }

  #undecided(): boolean {
    return this.#session.getState().status === 'unknown';
  }

  #clearTimer(): void {
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#timer = null;
  }
}
