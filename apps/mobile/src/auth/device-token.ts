/**
 * The device push token's life, tied to the session's.
 *
 * This sits in `auth/` and not in a push module on purpose (§C-A31 · 13.7-b).
 * A push token is a standing permission to deliver one workspace's customer
 * messages to one physical handset; deciding when it is minted and — far more
 * importantly — when it stops being honoured is a session decision, not a
 * notification-preferences decision. `13.7-j` owns the screen that turns
 * notifications on and off. This owns the three moments nobody sees: launch,
 * sign-out, and the account switch between them.
 *
 * Two rules are absolute, and both exist because the failure they prevent is
 * silent:
 *
 *   1. **A failed revoke still deletes the local token.** The call can fail for
 *      a reason that has nothing to do with the server's opinion — no signal in
 *      a lift, a 500, an app killed mid-request. If a failure meant "keep it and
 *      try later", the token would stay usable by the next session on this
 *      device. It is dropped and never presented again; the next session
 *      registers a fresh one. The server-side row may outlive it, which is
 *      exactly what `13.7-d`'s cross-tenant refusal is for.
 *   2. **Switching accounts revokes before it registers.** Not after, and not
 *      concurrently. Register-first leaves a window in which one token is
 *      registered to two workspaces at once, and the phone that receives
 *      tenant A's chat while displaying tenant B's inbox is not a bug anybody
 *      reports — it is a bug somebody screenshots.
 *
 * The transport is injected because the endpoints it will call are `13.7-c`'s
 * and do not exist yet. What exists here is the ordering, and the ordering is
 * the part that is dangerous to get wrong later.
 */
import type { SessionStore } from './secure-store';

/** How this app learns its own push token — `expo-notifications` in `13.7-c`. */
export interface DeviceTokenProvider {
  /** `null` when the person has not granted notification permission. */
  getToken(): Promise<string | null>;
}

/** `POST`/`DELETE` against `13.7-c`'s `device_tokens` endpoints. */
export interface DeviceTokenTransport {
  register(input: { token: string; accessToken: string }): Promise<void>;
  revoke(input: { token: string; accessToken: string }): Promise<void>;
}

/**
 * The default until `13.7-c` lands: no permission has been asked for, so there
 * is no token, so every trigger below is a no-op. Chosen over leaving the
 * dependency optional because "no token" is a real runtime state — a person who
 * declined notifications — and the lifecycle has to handle it either way.
 */
export const noDeviceToken: DeviceTokenProvider = { getToken: async () => null };

export class DeviceTokenLifecycle {
  readonly #store: SessionStore;
  readonly #provider: DeviceTokenProvider;
  readonly #transport: DeviceTokenTransport | null;

  constructor(input: {
    store: SessionStore;
    provider?: DeviceTokenProvider;
    transport?: DeviceTokenTransport | null;
  }) {
    this.#store = input.store;
    this.#provider = input.provider ?? noDeviceToken;
    this.#transport = input.transport ?? null;
  }

  /**
   * A session has just started. Register whatever token this device has.
   *
   * Failure is swallowed: a person who has just signed in should reach their
   * inbox even if push registration is unreachable. What they lose is
   * notifications until the next launch, which is recoverable; being bounced
   * back to a login screen is not what they asked for.
   */
  async onSignedIn(accessToken: string): Promise<void> {
    if (!this.#transport) return;

    const token = await this.#provider.getToken();
    if (token === null) return;

    try {
      await this.#transport.register({ token, accessToken });
      await this.#store.writeDeviceToken(token);
    } catch {
      // Not stored, so nothing claims this token is registered. The next launch
      // tries again from a clean slate.
      await this.#store.clearDeviceToken();
    }
  }

  /**
   * A session is ending. Tell the server to stop delivering, then forget the
   * token locally **whatever the server said** — rule 1.
   *
   * `accessToken` may be null when the session was dropped rather than signed
   * out of (a refresh that failed): there is no credential left to revoke with,
   * and the local delete still has to happen.
   */
  async onSignedOut(accessToken: string | null): Promise<void> {
    const token = await this.#store.readDeviceToken();
    try {
      if (token !== null && accessToken !== null && this.#transport) {
        await this.#transport.revoke({ token, accessToken });
      }
    } catch {
      // Deliberately empty. The `finally` below is the guarantee this method
      // makes, and it must not depend on the network having cooperated.
    } finally {
      await this.#store.clearDeviceToken();
    }
  }

  /**
   * One person signs out and another signs in on the same handset.
   *
   * The whole method is rule 2: the outgoing account's revoke is awaited to
   * completion — success or failure — and the local token is cleared before the
   * incoming account is allowed to register anything. `onSignedIn` then asks
   * the provider afresh, so what gets registered to the new workspace is a
   * token this device has re-fetched rather than one inherited from the last
   * session.
   */
  async onAccountSwitched(input: {
    previousAccessToken: string | null;
    nextAccessToken: string;
  }): Promise<void> {
    await this.onSignedOut(input.previousAccessToken);
    await this.onSignedIn(input.nextAccessToken);
  }
}
