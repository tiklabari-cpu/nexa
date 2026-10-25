/**
 * `siyahtus('logout')` inside the widget document (ID-03 · K4 · tm 287.3).
 *
 * The loader half — the promise the host page awaits, and the fresh document
 * it opens once the widget answers — is pinned in `loader.test.ts`. This is
 * the other half: a relayed `logout` from the embedding page stops the poll,
 * forgets every stored identity (the localStorage copies here, the `HttpOnly`
 * cookies through `DELETE /customer/token`) and the unread watermark, then
 * answers `siyahtus:logged-out` — and nothing after it mints for the visitor
 * who just left. A command from any other window is ignored.
 *
 * Each test's widget is taken down after it (`mount` returns its teardown), so an
 * earlier one cannot answer a later test's command.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';
import { storageKeys } from './api.js';

/** Every widget this file mounts, taken down after each test (`mount` returns its teardown). */
const mounted: Array<() => void> = [];

const API = 'https://api.test/v1';
const ORG = 'org-1';

interface Call {
  url: string;
  method: string;
  credentials: RequestCredentials | undefined;
}

let calls: Call[] = [];
let posted: unknown[] = [];
/** Merged into every mint's answer — a test that wants the socket adds `rtm_url`. */
let mintExtra: Record<string, unknown> = {};

/** Stands in for the browser's `WebSocket`; only whether it was closed matters here. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
}

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response;
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET', credentials: init?.credentials });
      if (url.endsWith('/customer/token') && init?.method === 'DELETE') {
        return { ok: true, status: 204 } as Response;
      }
      if (url.endsWith('/customer/token')) {
        return jsonResponse({
          token: 'tok',
          customer_id: 'cust-1',
          member_token: 'nxm1.1.b.s',
          ...mintExtra,
        });
      }
      return jsonResponse({
        online: true,
        agent_typing: false,
        customer: { id: 'cust-1', name: null, email: null },
        agent: null,
        chat: { id: 'chat-1', thread_id: 'thread-1', queue_position: null },
        events: [],
        campaign: null,
      });
    }),
  );
}

function mountWidget(path = '/widget.html'): void {
  window.history.replaceState({}, '', `${path}?organization_id=${ORG}&api=${API}`);
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mounted.push(mount(document, window));
}

/** The loader relaying a command — from `source`, the embedding page by default. */
function sendCommand(command: string, source: Window | null = window.parent): void {
  const event = new MessageEvent('message', {
    data: { type: 'siyahtus:command', command, payload: undefined },
  });
  Object.defineProperty(event, 'source', { value: source });
  window.dispatchEvent(event);
}

async function waitFor(predicate: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('waitFor timed out');
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

const loggedOut = (): boolean =>
  posted.some((data) => (data as { type?: unknown })?.type === 'siyahtus:logged-out');
const forgets = (): Call[] =>
  calls.filter((c) => c.url.endsWith('/customer/token') && c.method === 'DELETE');
const mints = (): Call[] =>
  calls.filter((c) => c.url.endsWith('/customer/token') && c.method === 'POST');

const onMessage = (event: MessageEvent): void => {
  posted.push(event.data);
};

beforeEach(() => {
  calls = [];
  posted = [];
  mintExtra = {};
  FakeSocket.instances = [];
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.addEventListener('message', onMessage);
  stubFetch();
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  for (const stop of mounted.splice(0)) stop();
  window.removeEventListener('message', onMessage);
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe("widget siyahtus('logout') (ID-03 · K4 · tm 287.3)", () => {
  it('ignores another frame, then on the embedding page’s word forgets the visitor and says so', async () => {
    // A returning visitor: the mount connects on its own and starts polling.
    window.localStorage.setItem(storageKeys(ORG).customerId, 'cust-1');
    window.localStorage.setItem(storageKeys(ORG).memberToken, 'nxm1.1.kept.s');
    window.localStorage.setItem('siyahtus.last_read_at', '2026-10-16T10:00:00.000Z');
    mountWidget();
    await waitFor(() => calls.some((c) => c.url.endsWith('/customer/chat')));

    // Another frame on the host page can reach this one too; it is not the
    // page the visitor signed out of.
    const other = document.createElement('iframe');
    document.body.append(other);
    sendCommand('logout', other.contentWindow);
    sendCommand('logout', null);
    await settle();
    expect(forgets()).toHaveLength(0);
    expect(loggedOut()).toBe(false);
    expect(window.localStorage.getItem(storageKeys(ORG).customerId)).toBe('cust-1');

    sendCommand('logout');
    await waitFor(loggedOut);

    // The cookie is HttpOnly: expired by a credentialed request, once.
    expect(forgets()).toHaveLength(1);
    expect(forgets()[0]?.url).toBe(`${API}/customer/token`);
    expect(forgets()[0]?.credentials).toBe('include');
    for (const key of [
      storageKeys(ORG).customerId,
      storageKeys(ORG).memberToken,
      'siyahtus.last_read_at',
    ]) {
      expect(window.localStorage.getItem(key), key).toBeNull();
    }

    // Nothing speaks for the visitor who left: a command that would mint is
    // dropped until the loader's fresh document — opening the panel included,
    // which would otherwise try, fail and say the chat is unavailable.
    const before = calls.length;
    sendCommand('logout');
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'siyahtus:host-open' } }));
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'siyahtus:command',
          command: 'trackSale',
          payload: { external_order_id: 'o-1', amount_cents: 100, currency: 'USD' },
        },
      }),
    );
    await settle();
    expect(calls.slice(before)).toEqual([]);
    expect(forgets()).toHaveLength(1);
    expect(document.body.textContent).not.toContain('Chat is unavailable');
  });

  it('lets a mint already out land first, so its cookie is expired with the rest', async () => {
    mountWidget();
    // The visitor opens the panel: a first-time mint goes out…
    document.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
    // …and the page signs out before it has answered.
    sendCommand('logout');
    await waitFor(loggedOut);

    const tokenCalls = calls.filter((c) => c.url.endsWith('/customer/token'));
    expect(tokenCalls.map((c) => c.method)).toEqual(['POST', 'DELETE']);
    expect(window.localStorage.getItem(storageKeys(ORG).customerId)).toBeNull();
    expect(window.localStorage.getItem(storageKeys(ORG).memberToken)).toBeNull();
    expect(mints()).toHaveLength(1);
  });

  it('keeps no poll or socket going for the visitor who left — not even those the late mint starts', async () => {
    mintExtra = { rtm_url: 'wss://rtm.test/v1/customer/rtm/ws' };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      mountWidget();
      // Open: the mint goes out and, once it lands, starts the 4-second poll.
      document.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
      sendCommand('logout');
      for (let i = 0; i < 100 && forgets().length === 0; i += 1) {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(forgets()).toHaveLength(1);

      const before = calls.length;
      await vi.advanceTimersByTimeAsync(120_000);
      expect(calls.slice(before).map((c) => c.url)).toEqual([]);
      // The mint opened its socket before the sign-out closed it.
      expect(FakeSocket.instances.length).toBeGreaterThan(0);
      expect(FakeSocket.instances.every((socket) => socket.closed)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('has nothing to do on the hosted Chat page, which no host page embeds', async () => {
    mountWidget('/chat.html');
    await waitFor(() => mints().length === 1);
    sendCommand('logout');
    await settle();
    expect(forgets()).toHaveLength(0);
    expect(loggedOut()).toBe(false);
    expect(window.localStorage.getItem(storageKeys(ORG).customerId)).toBe('cust-1');
  });
});
