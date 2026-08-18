/**
 * The cold-launch journey: one person, one uninterrupted walk, from an app they
 * have never opened to an app they have signed out of (13.7-w).
 *
 * Everything else in this suite proves a part. `App.test.tsx` proves the gate
 * branches, `SignInScreen.test.tsx` proves the form behaves, `ChatScreen.test.tsx`
 * proves the composer sends, `AccountScreen.test.tsx` proves sign-out asks first —
 * and §D111 is what happens when every part is proved and nobody walks the whole
 * line: twelve subtasks each delivered its own share, all of them green, and the
 * app could not be entered at all. `MobileSession.signIn` had zero production
 * callers for a month while three separate audits measured this item against its
 * acceptance criterion and found it met.
 *
 * So this file exists to be the walk. It is the phone's answer to the Playwright
 * suite the web app has and this workspace deliberately does not (§C-A28): one
 * test, the real `App`, the real navigator, the real session, the real stores —
 * stand-ins only where the device itself would be (the protected keystore, the
 * system browser, the notification service, the network). Where `13.7-k`'s parity
 * matrix says "this screen exists", this says "a person gets there".
 *
 * It is deliberately one test rather than seven. Seven would each start from a
 * fixture describing the state the previous one ended in, and a fixture is
 * exactly the thing that cannot go missing — the state here is whatever the app
 * itself left behind, which is the only version of it that can be wrong.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import App from '../App';
import { ROOT_TABS } from '../app/navigation';
import { navigationRef } from '../app/navigationRef';

/**
 * The protected store, as a thing this test can be — and as a thing it can
 * *read*, because "signed out" here has to mean the refresh token is gone from
 * disk rather than merely absent from the screen.
 */
const mockKeystore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockKeystore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockKeystore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockKeystore.delete(key);
  }),
  isAvailableAsync: jest.fn(async () => true),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 4,
}));

/**
 * The system browser. Nothing below opens it — this journey is the password
 * leg, and `App.test.tsx` walks the federated one — but `app/services.tsx`
 * imports the wrapper unconditionally, so the module has to resolve to
 * something that is not the real native call.
 */
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(async () => ({ type: 'dismiss' })),
}));

/** The platform's CSPRNG and SHA-256, stubbed as `pkce.test.ts` stubs them. */
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

/**
 * Notifications, denied. The permission calls are on the sign-in path
 * (`auth/push-tokens.ts`); answering "denied" keeps this walk about the walk
 * rather than about registration, which `push-tokens.test.ts` owns.
 */
jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({
    status: 'denied',
    granted: false,
    canAskAgain: false,
  })),
  requestPermissionsAsync: jest.fn(async () => ({
    status: 'denied',
    granted: false,
    canAskAgain: false,
  })),
  getDevicePushTokenAsync: jest.fn(async () => ({ data: '' })),
  IosAuthorizationStatus: {
    NOT_DETERMINED: 0,
    DENIED: 1,
    AUTHORIZED: 2,
    PROVISIONAL: 3,
    EPHEMERAL: 4,
  },
}));

/** Stands in for the manifest Expo injects; jest-expo leaves `extra` unset. */
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return {
        extra: {
          apiBaseUrl: 'https://api.nexa.test/api/v1',
          rtmBaseUrl: 'wss://rtm.nexa.test',
        },
      };
    },
  },
}));

const EMAIL = 'owner@acme.localhost';
const PASSWORD = 'nexa-demo-password';

/** Two workspaces, so the walk goes through the step a single membership skips. */
const MEMBERSHIPS = [
  {
    license_id: '4',
    organization_id: 'org-1',
    organization_name: 'Acme',
    role: 'owner',
    client_id: 'client-acme',
    password_login_available: true,
    sso_enforced_connection_id: null,
  },
  {
    license_id: '9',
    organization_id: 'org-2',
    organization_name: 'Globex',
    role: 'agent',
    client_id: 'client-globex',
    password_login_available: true,
    sso_enforced_connection_id: null,
  },
];

/** What `/auth/me` answers — and what the Account card is built from. */
const PRINCIPAL = {
  account_id: 'acc-1',
  email: EMAIL,
  name: 'Ada Owner',
  role: 'owner',
  organization_id: 'org-1',
  organization_name: 'Acme',
  license_id: '4',
  scopes: ['chats--all:ro', 'chats--all:rw'],
};

const CHAT = {
  id: 'chat-1',
  customer_id: 'customer-1',
  customer_name: 'Dana Visitor',
  active: true,
  created_at: '2026-08-18T09:00:00.000Z',
  thread_id: 'THREAD1',
  assignee_id: 'acc-1',
  queue_position: null,
  unread_count: 1,
  last_event: null,
  tags: [],
};

/** The message waiting in that conversation when it is opened. */
const CUSTOMER_EVENT = {
  id: 'THREAD1_1',
  chat_id: CHAT.id,
  thread_id: 'THREAD1',
  type: 'message',
  text: 'My invoice is missing.',
  author_id: 'customer-1',
  author_type: 'customer',
  recipients: 'all',
  attachment_url: null,
  properties: {},
  created_at: '2026-08-18T09:01:00.000Z',
};

/** Every channel on — the shape `13.7-c`'s default preference row ships. */
const NOTIFICATION_PREFERENCES = {
  enabled: true,
  sound: true,
  desktop: true,
  push: true,
  email: true,
};

const REPLY = 'The invoice is on its way.';

interface RecordedRequest {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

describe('the cold-launch journey', () => {
  let requests: RecordedRequest[];
  /** Held open so the optimistic bubble can be seen before the server answers. */
  let answerSend: () => void;

  beforeEach(() => {
    mockKeystore.clear();
    requests = [];
    let releaseSend: () => void = () => {};
    const sendAnswered = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    answerSend = () => releaseSend();

    globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const body =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      const { pathname } = new URL(url);
      requests.push({ method, path: pathname, body });

      const json = (payload: unknown) =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      if (pathname.endsWith('/auth/login')) return json({ memberships: MEMBERSHIPS });
      if (pathname.endsWith('/auth/authorize')) return json({ code: 'code-1' });
      if (pathname.endsWith('/auth/token')) {
        return json({
          access_token: 'access-1',
          refresh_token: 'refresh-2',
          license_id: '4',
          account_id: 'acc-1',
        });
      }
      if (pathname.endsWith('/auth/me')) return json(PRINCIPAL);
      if (pathname.endsWith('/auth/revoke')) return json({});

      // Before the bare `/chats` branch: this path ends in `/events`, but a
      // looser match on `/chats` would swallow it.
      if (pathname.endsWith(`/chats/${CHAT.id}/events`)) {
        if (method !== 'POST') return json({ items: [CUSTOMER_EVENT] });
        // The send is held until the test releases it, which is the only way
        // the optimistic bubble can be observed rather than inferred: resolve
        // immediately and the pending frame is gone before an assertion runs.
        await sendAnswered;
        return json({
          ...CUSTOMER_EVENT,
          id: 'THREAD1_2',
          text: body?.['text'],
          author_id: 'acc-1',
          author_type: 'agent',
          recipients: body?.['recipients'],
          created_at: '2026-08-18T09:05:00.000Z',
        });
      }
      if (pathname.endsWith('/chats')) return json({ items: [CHAT] });
      if (pathname.endsWith('/agents/me/notification-preferences')) {
        return json(NOTIFICATION_PREFERENCES);
      }
      return json({ items: [] });
    }) as unknown as typeof fetch;
  });

  it('is walked end to end: sign in, read, reply, and sign out again', async () => {
    // --- 1. Cold launch, nothing on disk -----------------------------------
    await render(<App />);

    // The screen §D111 found missing. Before `13.7-p` this launch mounted the
    // inbox, which asked for `/chats` without a token and left a 401 on screen
    // with no way forward.
    expect(await screen.findByTestId('sign-in')).toBeOnTheScreen();
    for (const label of ROOT_TABS) {
      expect(screen.queryByLabelText(new RegExp(`^${label}, tab,`))).not.toBeOnTheScreen();
    }

    // --- 2. Email and password ---------------------------------------------
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), EMAIL);
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('sign-in-submit'));

    // --- 3. Two workspaces, so one has to be chosen -------------------------
    expect(await screen.findByTestId('workspace-4')).toBeOnTheScreen();
    expect(screen.getByTestId('workspace-9')).toBeOnTheScreen();
    // `/auth/login` issues no token, so nothing has been entered yet.
    expect(pathsRequested(requests)).not.toContain('/api/v1/auth/token');
    // The credentials travelled in component state, not in the navigation tree
    // — which is serialised, persisted across restarts and, since `13.7-q`
    // added `linking`, addressable as a URL (`app/navigation.ts`).
    expect(JSON.stringify(navigationRef.getRootState())).not.toContain(PASSWORD);

    await fireEvent.press(screen.getByTestId('workspace-4'));

    // --- 4. The inbox, which is what signing in was for ---------------------
    expect(await screen.findByTestId('chat-list')).toBeOnTheScreen();
    expect(screen.getByTestId(`chat-row-${CHAT.id}`)).toBeOnTheScreen();
    // The whole tab bar came with it: signed in is a different tree, not the
    // same one with a form removed.
    for (const label of ROOT_TABS) {
      expect(screen.getByLabelText(new RegExp(`^${label}, tab,`))).toBeOnTheScreen();
    }

    // --- 5. One conversation, opened from the list --------------------------
    await fireEvent.press(screen.getByTestId(`chat-row-${CHAT.id}`));

    expect(await screen.findByTestId(`event-${CUSTOMER_EVENT.id}`)).toBeOnTheScreen();
    expect(screen.getByText(CUSTOMER_EVENT.text)).toBeOnTheScreen();

    // --- 6. A reply, sent ---------------------------------------------------
    await fireEvent.changeText(screen.getByTestId('composer-input'), REPLY);
    await fireEvent.press(screen.getByTestId('composer-send'));

    // On screen before the server has answered: an agent who sees nothing
    // happen presses send again, and on a slow connection that is how one
    // message becomes three (`inbox/store.ts`).
    expect(await screen.findByText(REPLY)).toBeOnTheScreen();
    expect(screen.getByText('Sending…')).toBeOnTheScreen();

    answerSend();

    // The optimistic bubble is replaced by the persisted event — same text, a
    // real id, and no second copy of the sentence.
    expect(await screen.findByTestId('event-THREAD1_2')).toBeOnTheScreen();
    expect(screen.getAllByText(REPLY)).toHaveLength(1);
    expect(screen.queryByText('Sending…')).not.toBeOnTheScreen();

    const sent = requests.find(
      (request) => request.method === 'POST' && request.path.endsWith('/events'),
    );
    expect(sent?.body).toMatchObject({ type: 'message', text: REPLY, recipients: 'all' });
    // Survives a retry after a timeout without posting twice.
    expect(sent?.body?.['idempotency_key']).toEqual(expect.any(String));

    // --- 7. Settings → Account: who this is, on which workspace -------------
    await fireEvent.press(screen.getByLabelText(/^Settings, tab,/));
    await fireEvent.press(await screen.findByTestId('settings-open-account'));

    expect(await screen.findByTestId('account-screen')).toBeOnTheScreen();
    // Read off `sessionState.principal`, not fetched again: the Account card
    // makes no request of its own (13.7-r).
    expect(screen.getByTestId('account-email')).toHaveTextContent(EMAIL);
    expect(screen.getByTestId('account-workspace')).toHaveTextContent('Acme');
    expect(screen.getByTestId('account-role')).toHaveTextContent('owner');

    // --- 8. Out again -------------------------------------------------------
    await fireEvent.press(screen.getByTestId('account-sign-out'));
    // The one destructive thing on the screen, so it is the one that asks.
    expect(screen.getByTestId('account-sign-out-confirm')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('account-sign-out-confirm'));

    expect(await screen.findByTestId('sign-in')).toBeOnTheScreen();
    for (const label of ROOT_TABS) {
      expect(screen.queryByLabelText(new RegExp(`^${label}, tab,`))).not.toBeOnTheScreen();
    }
    // Signed out means both halves: the server was told, and the refresh token
    // is gone from the only place it was ever written down (`session.ts`).
    await waitFor(() => expect(pathsRequested(requests)).toContain('/api/v1/auth/revoke'));
    expect(mockKeystore.size).toBe(0);
  });
});

function pathsRequested(requests: readonly RecordedRequest[]): string[] {
  return requests.map((request) => request.path);
}
