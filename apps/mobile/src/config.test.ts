import appJson from '../app.json';

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

describe('readMobileConfig', () => {
  it('returns both bases when app.json supplies them', () => {
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
        apiBaseUrl: 'http://localhost:3000/api/v1',
        rtmBaseUrl: 'ws://localhost:3001',
      }),
    ).toEqual({ apiBaseUrl: 'http://localhost:3000/api/v1', rtmBaseUrl: 'ws://localhost:3001' });
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

  it('accepts the extra block actually committed in app.json', () => {
    // Guards the file itself: `expo-constants` faithfully delivers whatever
    // app.json holds, so a typo there would only surface on a device.
    expect(() => readMobileConfig(appJson.expo.extra)).not.toThrow();
  });
});
