import { MOBILE_REDIRECT_URI } from '@nexa/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import App from './App';
import { ROOT_TABS } from './app/navigation';
import { RETURNED_FROM_BROWSER } from './features/auth/messages';
import type { ChatSummary } from './features/inbox/types';

/**
 * The tab bar renders every label as plain text, and — for whichever tab is
 * focused — that same word also appears as the header title and the
 * placeholder screen's own heading. `getByText('Inbox')` on the focused tab
 * is therefore ambiguous; the accessibility label React Navigation puts on
 * the tab button itself (`"Inbox, tab, 1 of 4"`) is not.
 */
const tabButton = (label: string) => screen.getByLabelText(new RegExp(`^${label}, tab,`));

/**
 * The shell now builds a session and an API client from the config (13.7-f), so
 * this suite has to stand in for both ends of that: the protected store, and the
 * network, which answers with an empty inbox rather than reaching for a real one.
 *
 * What the store answers is the whole subject of half this file since `13.7-p`:
 * `RootNavigator` branches on the session, so "is there a refresh token here?"
 * now decides which tree renders. `mockStore.session` is that answer, and
 * `mockStore.hang` is the third case — a read still in flight, which is what a
 * cold launch actually looks like for a second or two.
 */
const mockStore: { session: string | null; hang: boolean } = { session: null, hang: false };
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => {
    if (key !== 'nexa.session') return null;
    if (mockStore.hang) return new Promise<string | null>(() => {});
    return mockStore.session;
  }),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  isAvailableAsync: jest.fn(async () => true),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 4,
}));

/** A refresh token in the protected store — what a returning launch finds. */
const STORED_SESSION = JSON.stringify({
  refreshToken: 'refresh-1',
  clientId: 'client-acme',
  licenseId: '4',
  accountId: 'acc-1',
});

/** What `/auth/me` answers once that token has been rotated for an access token. */
const PRINCIPAL = {
  account_id: 'acc-1',
  email: 'owner@acme.localhost',
  name: 'Ada Owner',
  role: 'owner',
  organization_id: 'org-1',
  license_id: '4',
  scopes: ['chats--all:ro', 'chats--all:rw'],
};

/**
 * The system browser, as a thing this suite can be (13.7-q).
 *
 * `openAuthSessionAsync` is the whole of the federated leg — the app hands it a
 * URL and gets a callback or nothing back — so standing in for it is what lets
 * the SSO path be walked here rather than described. `answer` reads the URL it
 * was given, because the callback has to echo the `state` the session just
 * minted; hard-coding one would test a coincidence.
 */
const mockBrowser: {
  urls: string[];
  answer: (url: string) => { type: 'success'; url: string } | { type: 'dismiss' };
} = {
  urls: [],
  answer: (url: string) => ({
    type: 'success',
    url: `${MOBILE_REDIRECT_URI}?code=code-1&state=${new URL(url).searchParams.get('state')}`,
  }),
};
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(async (url: string) => {
    mockBrowser.urls.push(url);
    return mockBrowser.answer(url);
  }),
}));

/**
 * `expo-crypto` is the platform's CSPRNG and SHA-256, and there is no platform
 * here — stubbed the same way `pkce.test.ts` stubs it. Nothing below asserts
 * anything about the verifier; `pkce.test.ts` owns that. What matters here is
 * only that PKCE can run at all, since every sign-in goes through it.
 */
jest.mock('expo-crypto', () => {
  let counter = 0;
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoEncoding: { HEX: 'hex', BASE64: 'base64' },
    getRandomBytesAsync: async (count: number) => {
      counter += 1;
      return Uint8Array.from({ length: count }, (_, i) => (i * 31 + counter * 7) % 256);
    },
    digestStringAsync: async (_algorithm: string, data: string) => `sha256(${data})`,
  };
});

/** A workspace that federates sign-in: the password is not the way in (S11-h). */
const SSO_MEMBERSHIP = {
  license_id: '4',
  organization_id: 'org-1',
  organization_name: 'Acme',
  role: 'owner',
  client_id: 'client-acme',
  password_login_available: false,
  sso_enforced_connection_id: 'conn-1',
};

/** What `/auth/login` answers, and what `/chats` lists — set per test. */
const mockMemberships: { value: unknown[] } = { value: [] };
const mockChats: { value: ChatSummary[] } = { value: [] };

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

/**
 * A well-formed, all-zero `ReportsOverview` (13.7-h) — the shared `{ items: [] }`
 * stand-in every other endpoint gets does not satisfy this shape, and the
 * screen reading `totals.chats` off a mis-shaped body is exactly the crash a
 * real empty-window response would not cause.
 */
const EMPTY_REPORTS_OVERVIEW = {
  range: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-31T00:00:00.000Z' },
  previous_period: {
    baseline: 'previous_period',
    range: { from: '2025-12-01T00:00:00.000Z', to: '2025-12-31T00:00:00.000Z' },
    chats: 0,
    tickets: 0,
    total_cases: 0,
    closed: 0,
    manual: 0,
    assisted: 0,
    automated: 0,
    avg_first_response_seconds: null,
    avg_duration_seconds: null,
    satisfaction_score: null,
    achieved_goals: 0,
    sla_breaches: 0,
  },
  totals: {
    chats: 0,
    tickets: 0,
    total_cases: 0,
    closed: 0,
    manual: 0,
    assisted: 0,
    automated: 0,
    manual_rate: null,
    assisted_rate: null,
    automated_rate: null,
    queued_now: 0,
    achieved_goals: 0,
  },
  chats: { automated_per_hour: 0, automated_avg_duration_seconds: null, total_duration_seconds: 0 },
  response_times: { avg_first_response_seconds: null, avg_duration_seconds: null },
  satisfaction: { good: 0, bad: 0, score: null, responses: 0 },
  by_agent: [],
  top_tags: [],
  sla: { active: false, breaches: 0, low_confidence: false },
};

/**
 * Every channel on, the shape `13.7-c`'s default row ships — the same
 * well-formed-but-empty rule `EMPTY_REPORTS_OVERVIEW` follows: `{ items: [] }`
 * does not satisfy this endpoint's object-of-booleans response, and a screen
 * reading `prefs.enabled` off the wrong shape is exactly the crash a real
 * response would not cause.
 */
const DEFAULT_NOTIFICATION_PREFERENCES = {
  enabled: true,
  sound: true,
  desktop: true,
  push: true,
  email: true,
};

describe('App', () => {
  beforeEach(() => {
    mockStore.session = null;
    mockStore.hang = false;
    mockBrowser.urls = [];
    mockBrowser.answer = (url: string) => ({
      type: 'success',
      url: `${MOBILE_REDIRECT_URI}?code=code-1&state=${new URL(url).searchParams.get('state')}`,
    });
    mockMemberships.value = [];
    mockChats.value = [];
    mockExtra.value = {
      apiBaseUrl: 'https://api.nexa.test/api/v1',
      rtmBaseUrl: 'wss://rtm.nexa.test',
    };
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body = url.includes('/auth/login')
        ? { memberships: mockMemberships.value }
        : url.includes('/auth/token')
          ? {
              access_token: 'access-1',
              refresh_token: 'refresh-2',
              license_id: '4',
              account_id: 'acc-1',
            }
          : url.includes('/auth/me')
            ? PRINCIPAL
            : url.includes('/reports/overview')
              ? EMPTY_REPORTS_OVERVIEW
              : url.includes('/agents/me/notification-preferences')
                ? DEFAULT_NOTIFICATION_PREFERENCES
                : url.includes('/chats?') || url.endsWith('/chats')
                  ? { items: mockChats.value }
                  : { items: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  });

  it('says nothing yet while the session is still being restored', async () => {
    // The launch gap `13.7-p` gave a screen: neither a password box nor an
    // inbox is true here, and before this branch existed the inbox was shown
    // anyway — then failed its first request with a 401 (§D111).
    mockStore.hang = true;

    await render(<App />);

    expect(screen.getByTestId('session-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('sign-in')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText(/^Inbox, tab,/)).not.toBeOnTheScreen();
  });

  it('opens the sign-in screen, not the inbox, when there is no session', async () => {
    await render(<App />);

    expect(await screen.findByTestId('sign-in')).toBeOnTheScreen();
    // The four tabs are not merely hidden — the navigator that owns them is not
    // mounted, so there is nowhere for a signed-out person to navigate to.
    for (const label of ROOT_TABS) {
      expect(screen.queryByLabelText(new RegExp(`^${label}, tab,`))).not.toBeOnTheScreen();
    }
  });

  it('mounts the shell and shows Inbox — the tab the navigator opens on', async () => {
    mockStore.session = STORED_SESSION;

    await render(<App />);

    // The real conversation list, not a placeholder: 13.7-f replaced it.
    expect(await screen.findByTestId('chat-list')).toBeOnTheScreen();
  });

  it('names all four FR-MOD-13.7 surfaces on the tab bar', async () => {
    mockStore.session = STORED_SESSION;

    await render(<App />);

    await screen.findByTestId('chat-list');
    for (const label of ROOT_TABS) {
      expect(tabButton(label)).toBeOnTheScreen();
    }
  });

  it('switches screens when a tab is pressed, each showing its own placeholder', async () => {
    mockStore.session = STORED_SESSION;

    await render(<App />);

    await screen.findByTestId('chat-list');

    // The real Customers list, not a placeholder: 13.7-g replaced it. The
    // shared mock answers every endpoint with `{ items: [] }`, so an empty
    // directory is what a real fetch would show too.
    await fireEvent.press(tabButton('Customers'));
    expect(await screen.findByText('No customers yet.')).toBeOnTheScreen();

    // The real Reports overview, not a placeholder: 13.7-h replaced it. The
    // shared mock answers `/reports/overview` with an all-zero window, so an
    // empty-but-well-formed dashboard is what a real fetch would show too.
    await fireEvent.press(tabButton('Reports'));
    expect(await screen.findByTestId('reports-overview')).toBeOnTheScreen();
    expect(screen.getByText('Volume')).toBeOnTheScreen();

    // The real notification preferences screen, not a placeholder: 13.7-j
    // replaced it. The shared mock answers every channel as on.
    await fireEvent.press(tabButton('Settings'));
    expect(await screen.findByTestId('notification-settings')).toBeOnTheScreen();
    expect(screen.getByText('Enable notifications')).toBeOnTheScreen();
  });

  /**
   * The federated leg, walked rather than described (13.7-q).
   *
   * `13.7-b` wrote `signInWithSso` and the `openAuthSessionAsync` wrapper and
   * `13.7-p` drew the button; between them sat one unset constructor option, so
   * the button's honest answer was "No browser is available for single
   * sign-on." These three tests are the seam: the real `App`, the real
   * `MobileSession`, the real `systemBrowser`, and a stand-in only where the
   * device would be.
   */
  describe('single sign-on', () => {
    async function offerSso(): Promise<void> {
      mockMemberships.value = [SSO_MEMBERSHIP];
      await render(<App />);
      await screen.findByTestId('sign-in');

      await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'owner@acme.localhost');
      await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'nexa-demo-password');
      await fireEvent.press(screen.getByTestId('sign-in-submit'));

      // The membership already said a password is not the way in, so none was
      // spent on `/auth/authorize` to be told so (13.7-p · `enter.ts`).
      await screen.findByTestId('sign-in-sso');
    }

    it('hands the identity provider to the device browser and comes back signed in', async () => {
      await offerSso();

      await fireEvent.press(screen.getByTestId('sign-in-sso'));

      // The callback was redeemed and the gate swapped the tree — the whole
      // point, and the thing that could not happen before this subtask.
      expect(await screen.findByTestId('chat-list')).toBeOnTheScreen();

      expect(mockBrowser.urls).toHaveLength(1);
      const opened = new URL(mockBrowser.urls[0]!);
      expect(opened.pathname).toBe('/api/v1/auth/saml/conn-1/login');
      // Same mandatory S256 PKCE and the same exact-matched redirect the
      // console uses — the phone adds no second way to mint a token (13.7-b).
      expect(opened.searchParams.get('code_challenge_method')).toBe('S256');
      expect(opened.searchParams.get('redirect_uri')).toBe(MOBILE_REDIRECT_URI);
      expect(opened.searchParams.get('client_id')).toBe('client-acme');
      expect(opened.searchParams.get('state')).toBeTruthy();
    });

    it('says the sheet was closed, which is not the same as a failure', async () => {
      mockBrowser.answer = () => ({ type: 'dismiss' });
      await offerSso();

      await fireEvent.press(screen.getByTestId('sign-in-sso'));

      expect(await screen.findByText('Sign-in was cancelled.')).toBeOnTheScreen();
      // Still offered: a dismissed sheet is the one outcome worth pressing
      // again for.
      expect(screen.getByTestId('sign-in-sso')).toBeOnTheScreen();
    });

    it('refuses a callback that did not start here, and says which problem it is', async () => {
      mockBrowser.answer = () => ({
        type: 'success',
        url: `${MOBILE_REDIRECT_URI}?code=code-1&state=somebody-else`,
      });
      await offerSso();

      await fireEvent.press(screen.getByTestId('sign-in-sso'));

      expect(await screen.findByText('This sign-in did not start in this app.')).toBeOnTheScreen();
      expect(screen.queryByTestId('chat-list')).not.toBeOnTheScreen();
    });
  });

  /**
   * `nexa://` URLs, end to end: the prefix `app.json` registers, stripped by
   * React Navigation and matched against the map in `app/linking.ts`. That map
   * is parsed on its own in `linking.test.ts`; what is proved here is that the
   * container is actually given it.
   */
  describe('deep links', () => {
    const chat: ChatSummary = {
      id: 'chat-1',
      customer_id: 'customer-1',
      customer_name: 'Dana',
      active: true,
      created_at: '2026-08-17T09:00:00.000Z',
      thread_id: 'THREAD1',
      assignee_id: null,
      queue_position: null,
      unread_count: 0,
      last_event: null,
      tags: [],
    } as unknown as ChatSummary;

    it('opens the conversation a link names instead of the tab it landed on', async () => {
      mockStore.session = STORED_SESSION;
      mockChats.value = [chat];
      jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('nexa://chats/chat-1');

      await render(<App />);

      // The transcript, not the list: `/chats/chat-1/events` answers empty, so
      // this is the conversation open with nothing said in it yet.
      expect(await screen.findByTestId('transcript-empty')).toBeOnTheScreen();
    });

    it('loads the inbox underneath it, which is where the header gets a name', async () => {
      mockStore.session = STORED_SESSION;
      mockChats.value = [chat];
      jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('nexa://chats/chat-1');

      await render(<App />);
      await screen.findByTestId('transcript-empty');

      // `initialRouteName` in the linking config keeps `InboxHome` on the stack
      // under the deep-linked screen. Without it "back" would leave the app and
      // `/chats` would never be asked — which is the only thing that knows the
      // customer's name, since a URL cannot carry one (`inbox/title.ts`).
      await waitFor(() =>
        expect(
          (globalThis.fetch as jest.Mock).mock.calls.some(([input]: [RequestInfo | URL]) =>
            String(input).includes('/chats?'),
          ),
        ).toBe(true),
      );
    });

    it('sends a late SSO callback to the sign-in screen with nothing it carried', async () => {
      // The sheet was dismissed, or the OS killed this process while the
      // browser was in front and relaunched it to deliver the URL. Either way
      // the verifier is gone (`session.ts` holds it on the stack), so the code
      // is unredeemable — say so rather than showing a blank form.
      jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(`${MOBILE_REDIRECT_URI}?code=code-1`);

      await render(<App />);

      expect(await screen.findByTestId('sign-in')).toBeOnTheScreen();
      expect(screen.getByTestId('sign-in-error')).toHaveTextContent(RETURNED_FROM_BROWSER);
    });
  });

  it('says why the screen is empty instead of white-screening on a bad app.json', async () => {
    mockExtra.value = { apiBaseUrl: 'nope', rtmBaseUrl: 'wss://rtm.nexa.test' };

    await render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent(/apiBaseUrl is not a valid URL: nope/);
    // The broken config must not fall through to a navigator that needs it.
    expect(screen.queryByLabelText(/^Inbox, tab,/)).not.toBeOnTheScreen();
  });
});
