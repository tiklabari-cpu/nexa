import type { ConfigContext } from 'expo/config';

import appConfig from '../app.config';

import { MobileConfigError, readMobileConfig } from './config';

/** Stands in for the manifest Expo injects; jest-expo leaves `extra` unset. */
const mockExtra: { value: unknown } = { value: undefined };
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: mockExtra.value };
    },
  },
}));

const valid = {
  apiBaseUrl: 'https://api.example.com/api/v1',
  rtmBaseUrl: 'wss://rtm.example.com',
};

/** `app.config.ts` receives `{ config }` from the Expo CLI; tests supply an empty stand-in. */
const emptyContext = { config: {} } as ConfigContext;

describe('readMobileConfig', () => {
  it('returns both bases when app.config.ts supplies them', () => {
    expect(readMobileConfig(valid)).toEqual({
      apiBaseUrl: 'https://api.example.com/api/v1',
      rtmBaseUrl: 'wss://rtm.example.com',
    });
  });

  it('strips trailing slashes so callers can concatenate a path safely', () => {
    expect(readMobileConfig({ ...valid, apiBaseUrl: 'https://api.example.com/api/v1//' })).toEqual({
      apiBaseUrl: 'https://api.example.com/api/v1',
      rtmBaseUrl: 'wss://rtm.example.com',
    });
  });

  it('accepts the plain-http/ws pair a local dev server serves', () => {
    expect(
      readMobileConfig({
        apiBaseUrl: 'http://localhost:4000/api/v1',
        rtmBaseUrl: 'ws://localhost:4001',
      }),
    ).toEqual({ apiBaseUrl: 'http://localhost:4000/api/v1', rtmBaseUrl: 'ws://localhost:4001' });
  });

  it('rejects a swapped pair by protocol rather than letting a socket fail later', () => {
    expect(() =>
      readMobileConfig({ apiBaseUrl: 'ws://a.example', rtmBaseUrl: 'https://b.example' }),
    ).toThrow(MobileConfigError);
  });

  it('reports every broken key at once, not just the first', () => {
    let thrown: unknown;
    try {
      readMobileConfig({ apiBaseUrl: '', rtmBaseUrl: 'not a url' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MobileConfigError);
    expect((thrown as MobileConfigError).problems).toEqual([
      'apiBaseUrl must be a non-empty string',
      'rtmBaseUrl is not a valid URL: not a url',
    ]);
  });

  it('says the whole section is missing when expo.extra is absent', () => {
    let thrown: unknown;
    try {
      readMobileConfig(null);
    } catch (error) {
      thrown = error;
    }

    expect((thrown as MobileConfigError).problems[0]).toBe('expo.extra is missing');
  });

  it('defaults to what expo-constants reports, which is the only path production takes', () => {
    mockExtra.value = {
      apiBaseUrl: 'https://api.nexa.test/api/v1',
      rtmBaseUrl: 'wss://rtm.nexa.test',
    };

    expect(readMobileConfig()).toEqual({
      apiBaseUrl: 'https://api.nexa.test/api/v1',
      rtmBaseUrl: 'wss://rtm.nexa.test',
    });
  });
});

describe('app.config.ts', () => {
  const originalApi = process.env.NEXA_API_BASE_URL;
  const originalRtm = process.env.NEXA_RTM_BASE_URL;

  afterEach(() => {
    if (originalApi === undefined) delete process.env.NEXA_API_BASE_URL;
    else process.env.NEXA_API_BASE_URL = originalApi;
    if (originalRtm === undefined) delete process.env.NEXA_RTM_BASE_URL;
    else process.env.NEXA_RTM_BASE_URL = originalRtm;
  });

  it('defaults the API base to port 4000, matching the root README port table', () => {
    delete process.env.NEXA_API_BASE_URL;
    delete process.env.NEXA_RTM_BASE_URL;

    expect(appConfig(emptyContext).extra).toEqual({
      apiBaseUrl: 'http://localhost:4000/api/v1',
      rtmBaseUrl: 'ws://localhost:4001',
    });
  });

  it('lets NEXA_API_BASE_URL / NEXA_RTM_BASE_URL override the default, for a physical device', () => {
    process.env.NEXA_API_BASE_URL = 'http://192.168.1.20:4000/api/v1';
    process.env.NEXA_RTM_BASE_URL = 'ws://192.168.1.20:4001';

    expect(appConfig(emptyContext).extra).toEqual({
      apiBaseUrl: 'http://192.168.1.20:4000/api/v1',
      rtmBaseUrl: 'ws://192.168.1.20:4001',
    });
  });

  it('produces an extra block that readMobileConfig accepts', () => {
    // Guards the file itself: `expo-constants` faithfully delivers whatever
    // app.config.ts holds, so a typo there would only surface on a device.
    expect(() => readMobileConfig(appConfig(emptyContext).extra)).not.toThrow();
  });
});
