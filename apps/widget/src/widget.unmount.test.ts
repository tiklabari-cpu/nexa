/**
 * `mount`'s teardown (2026-10-25).
 *
 * The widget is loaded once per page and never taken down there, so this exists for the
 * tests: a widget left running from an earlier test kept polling, and the moment its real
 * timer fired after the next test had switched to fake timers, it re-armed itself on that
 * fake clock — `widget.unread.test.ts` then counted 10–18 polls where it expected 2, but
 * only when the gate kept the machine busy enough to stretch a test past four seconds.
 * What the teardown must stop is everything that outlives the DOM: the poll, the socket,
 * and the listeners on `window` and `document`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';
import { storageKeys } from './api.js';

const API = 'https://api.test/v1';

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

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

let requests: string[] = [];

beforeEach(() => {
  requests = [];
  FakeSocket.instances = [];
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/customer/token')) {
        return jsonResponse({
          token: 'nxc1.body.sig',
          customer_id: 'cust-1',
          pre_chat_form: [],
          rtm_url: 'ws://rtm.test/v1/customer/rtm/ws',
        });
      }
      if (url.endsWith('/customer/chat')) {
        return jsonResponse({
          online: true,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: null,
          chat: { id: 'chat-1', thread_id: 'thr-1', queue_position: null },
          events: [],
          campaign: null,
        });
      }
      return jsonResponse({});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
});

/** A returning visitor's widget, which connects at mount without being opened. */
function mountReturning(): { root: HTMLElement; stop: () => void } {
  window.history.replaceState({}, '', `/widget.html?organization_id=org-1&api=${API}`);
  window.localStorage.setItem(storageKeys('org-1').customerId, 'cust-1');
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  return { root, stop: mount(document, window) };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

const polls = (): number => requests.filter((url) => url.endsWith('/customer/chat')).length;

describe('mount teardown', () => {
  it('stops the poll: an open panel asks every four seconds, a stopped one never again', async () => {
    vi.useFakeTimers();
    const { root, stop } = mountReturning();
    await settle();
    root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
    await settle();
    await vi.advanceTimersByTimeAsync(8_000);
    const before = polls();
    expect(before).toBeGreaterThanOrEqual(2);

    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(polls()).toBe(before);
  });

  it('closes the socket it opened', async () => {
    const { stop } = mountReturning();
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    expect(FakeSocket.instances[0]!.closed).toBe(false);

    stop();
    expect(FakeSocket.instances[0]!.closed).toBe(true);
  });

  it('takes its window and document listeners with it', async () => {
    const { root, stop } = mountReturning();
    await vi.waitFor(() => expect(polls()).toBeGreaterThanOrEqual(1));
    stop();
    const before = requests.length;

    // Each of these reaches the widget only through a listener on `window`: coming back
    // online re-polls, and the host page's command opens the panel.
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'siyahtus:host-open' } }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(requests.length).toBe(before);
    expect(root.querySelector<HTMLElement>('.nx-panel')!.hidden).toBe(true);
  });

  it('is safe to call on a page with no widget root', () => {
    expect(() => mount(document, window)()).not.toThrow();
  });
});
