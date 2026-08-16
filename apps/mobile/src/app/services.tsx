/**
 * The app's long-lived objects — configuration, the session, the client that
 * carries it — in one place a screen can reach.
 *
 * `13.7-b` built the session and the authenticated client but nothing mounted
 * them; `13.7-f` is the first screen that needs to make a request, so this is
 * where they are constructed. Deliberately thin: it owns no state of its own
 * beyond "restore the session once at launch", because everything a screen
 * would want to know is already `MobileSession`'s job.
 *
 * The whole bundle is injectable so a test can supply a fake client without
 * standing up secure storage or a network.
 */
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { PropsWithChildren } from 'react';

import { SessionApiClient } from '../api/client';
import { DeviceTokenLifecycle } from '../auth/device-token';
import { createDeviceTokenTransport } from '../auth/device-token-transport';
import { currentDevicePlatform, expoPushTokens } from '../auth/push-tokens';
import { SessionStore } from '../auth/secure-store';
import { MobileSession, type SessionState } from '../auth/session';
import type { MobileConfig } from '../config';

export interface AppServices {
  config: MobileConfig;
  session: MobileSession;
  api: SessionApiClient;
}

const ServicesContext = createContext<AppServices | null>(null);

export interface ServicesProviderProps extends PropsWithChildren {
  config: MobileConfig;
  /** Supplied by tests; the app builds its own from `config`. */
  services?: AppServices;
}

export function ServicesProvider({ config, services, children }: ServicesProviderProps) {
  const value = useMemo<AppServices>(() => {
    if (services !== undefined) return services;
    // One store, shared: the session's refresh token and this handset's push
    // registration are cleared together (`SessionStore.clearAll`), which two
    // instances over the same keys would still do — but only one of them can be
    // the object the rest of the app reasons about.
    const store = new SessionStore();
    const session = new MobileSession({
      apiBaseUrl: config.apiBaseUrl,
      store,
      deviceTokens: buildDeviceTokens(config, store),
    });
    return {
      config,
      session,
      api: new SessionApiClient({ session, baseUrl: config.apiBaseUrl }),
    };
  }, [config, services]);

  useEffect(() => {
    // Turn whatever survived in the protected store into a live session, or
    // decide there is not one. Failure here is not exceptional — an expired or
    // revoked refresh token ends as "signed out", which the session has already
    // told its subscribers by the time this settles.
    void value.session.restore();
  }, [value]);

  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

/**
 * The push-token lifecycle, with the two halves `13.7-b` left injectable
 * actually supplied (`13.7-l`).
 *
 * Until this existed the app constructed the lifecycle with neither, so it held
 * the ordering rules for a call it never made — the server side of
 * `/notifications/devices` was complete and tested, and nothing on the phone
 * reached it.
 *
 * A platform that is neither iOS nor Android gets no transport rather than a
 * guess. The lifecycle already treats a missing transport as "do nothing",
 * which is the honest answer for a device that cannot receive a push anyway.
 */
function buildDeviceTokens(config: MobileConfig, store: SessionStore): DeviceTokenLifecycle {
  const platform = currentDevicePlatform();
  return new DeviceTokenLifecycle({
    store,
    provider: expoPushTokens,
    transport:
      platform === null
        ? null
        : createDeviceTokenTransport({ baseUrl: config.apiBaseUrl, store, platform }),
  });
}

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (services === null) throw new Error('useServices must be called within a ServicesProvider');
  return services;
}

/** The session as it stands right now, re-rendering the caller when it moves. */
export function useSessionState(): SessionState {
  const { session } = useServices();
  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getState(),
  );
}
