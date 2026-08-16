/**
 * The two calls `DeviceTokenLifecycle` makes on `13.7-c`'s endpoints
 * (FR-MOD-13.7 · 13.7-l).
 *
 * The lifecycle has always taken this as an interface because the endpoints did
 * not exist when it was written. This fills it in, and it is deliberately the
 * whole of what the phone knows about registering itself: the ordering rules
 * stay in `device-token.ts`, the permission prompt stays in `push-tokens.ts`,
 * and this file is two requests and one thing it has to remember.
 *
 * **The transport, not the session client.** `SessionApiClient` reads the
 * credential off the live session and answers a 401 by renewing it; both are
 * wrong here. The lifecycle hands in an *explicit* access token because on an
 * account switch the token that must revoke is the outgoing account's, not
 * whatever the session holds by then — and a renewal fired from inside
 * `signOut()` would be this app renewing a session it is in the middle of
 * ending. So this uses `ApiClient` directly, per credential, exactly as
 * `session.ts` already does for `/auth/*` (`#clientFor`). It is the same
 * transport and the same generated contract types; there is no second client.
 *
 * **Why the registration id is written down.** `DELETE` takes a `deviceId`, and
 * nothing in that API will ever hand one back for a token: no read surface
 * returns a token, on purpose (13.7-c). So the id that `POST` answers with is
 * the only chance to learn it, and a phone that did not keep it could never
 * revoke its own registration — sign-out would leave the row delivering to a
 * handset that has since been handed to somebody else. It goes into the same
 * protected store as the token, written just before it and cleared in the same
 * call, so the two can never disagree about which registration this is.
 */
import { isDevicePlatform, type DevicePlatform } from '@nexa/types';

import { ApiClient } from '../lib/api-client';
import type { DeviceTokenTransport } from './device-token';
import type { SessionStore } from './secure-store';

export interface DeviceTokenTransportOptions {
  /** Absolute, e.g. `https://api.example.com/api/v1` — see `src/config.ts`. */
  baseUrl: string;
  /** Where the registration id is remembered between launches. */
  store: SessionStore;
  /** This handset's platform — `currentDevicePlatform()` in the real app. */
  platform: DevicePlatform;
  fetchImpl?: typeof fetch;
}

export function createDeviceTokenTransport(
  options: DeviceTokenTransportOptions,
): DeviceTokenTransport {
  if (!isDevicePlatform(options.platform)) {
    throw new Error(`Unsupported device platform: ${String(options.platform)}`);
  }

  // Built per credential rather than once, because the credential is an
  // argument here: a client that captured one would present the wrong account's
  // token on the next call, which on the account-switch path is precisely the
  // token the switch exists to stop using.
  const clientFor = (accessToken: string): ApiClient =>
    new ApiClient({
      baseUrl: options.baseUrl,
      getAccessToken: () => accessToken,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });

  return {
    /**
     * Register this handset, or refresh a registration it already has — one
     * call for both, which is the endpoint's own design: the app cannot tell
     * them apart and does not have to.
     *
     * The id is stored only after the request succeeds. A failed register that
     * left an id behind would point the next revoke at a registration this
     * device does not hold.
     */
    async register({ token, accessToken }) {
      const device = await clientFor(accessToken).request('post', '/notifications/devices', {
        body: { token, platform: options.platform },
      });
      await options.store.writeDeviceId(device.id);
    },

    /**
     * Stop delivering to this handset.
     *
     * The push token itself is not sent: the endpoint identifies a registration
     * by id, and the id is what was written down at register time. It is not
     * checked against the token argument because the two are written and
     * cleared together and so cannot describe different registrations — see
     * `SessionStore.clearDeviceToken`.
     *
     * No id means there is nothing this device can name, which is a real state
     * rather than an error: a register that failed, or a store cleared under
     * us. Returning quietly lets the lifecycle finish dropping the local token,
     * which is the guarantee that actually matters (§C-A31 rule 1).
     */
    async revoke({ accessToken }) {
      const deviceId = await options.store.readDeviceId();
      if (deviceId === null) return;

      await clientFor(accessToken).request('delete', '/notifications/devices/{deviceId}', {
        params: { deviceId },
      });
    },
  };
}
