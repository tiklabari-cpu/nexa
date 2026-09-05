/**
 * `nexa('trackSale', …)` inside the widget document (FR-MOD-13.5, 13.5-g).
 *
 * The loader half — queueing a call made before the widget is ready and
 * relaying it across the message boundary once it signals `nexa:ready` — is
 * pinned in `loader.test.ts`. This is the other half of the same wire: that a
 * relayed `nexa:command` reaches `POST /customer/chat/sale` with the expected
 * body, that an invalid payload never goes out at all, and that a server or
 * network failure is swallowed rather than thrown — the checkout page this is
 * called from must never see this feature break it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

interface FetchCall {
  url: string;
  body: unknown;
}

let calls: FetchCall[] = [];
/** Overridable per test; defaults to a plain 200 with no interesting body. */
let saleResponse: () => Response = () => jsonResponse({ id: 'sale-1' });
/** Overridable per test — makes the sale call itself reject, like a dropped connection. */
let saleNetworkFail = false;

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response;
}

function errorResponse(status: number, message: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: { message } }),
  } as unknown as Response;
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });

      if (url.includes('/customer/chat/sale')) {
        if (saleNetworkFail) throw new Error('offline');
        return saleResponse();
      }
      if (url.includes('/customer/token')) {
        return jsonResponse({ token: 'tok', customer_id: 'cust-1', pre_chat_form: [] });
      }
      if (url.includes('/customer/chat')) {
        return jsonResponse({
          online: true,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: null,
          chat: null,
          events: [],
        });
      }
      return jsonResponse({});
    }),
  );
}

function mountWidget(search: string): void {
  window.history.replaceState({}, '', `/widget.html${search}`);
  const root = document.createElement('div');
  root.id = 'nexa-widget-root';
  document.body.append(root);
  mount(document, window);
}

/** Simulates the loader relaying a command across the message boundary. */
function sendCommand(command: string, payload: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', { data: { type: 'nexa:command', command, payload } }),
  );
}

async function waitFor(predicate: () => boolean, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('waitFor timed out');
}

/** A couple of microtask/timer turns, for asserting something did NOT happen. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

const VALID_PAYLOAD = { external_order_id: 'order-9', amount_cents: 1999, currency: 'USD' };

beforeEach(() => {
  calls = [];
  saleResponse = () => jsonResponse({ id: 'sale-1' });
  saleNetworkFail = false;
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  // See widget.unread.test.ts: a stored customer id auto-connects the mount.
  window.localStorage.clear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('widget trackSale (FR-MOD-13.5)', () => {
  // Deliberately the one test in this file that checks call *order*: it must
  // run against a widget that has never authenticated, which only holds for
  // the very first mount+dispatch — `mount()` has no teardown, so every test
  // below this one may also be heard by this test's now-stale (but already
  // authenticated) message listener. That stale listener skips straight to
  // the sale call same as the fresh one would, which is harmless for the
  // `.some(...)` checks the other tests make, just not for an index compare.
  it('mints a token first, then reports the relayed sale with the expected body', async () => {
    mountWidget('?organization_id=org-1');
    sendCommand('trackSale', VALID_PAYLOAD);

    await waitFor(() => calls.some((c) => c.url.includes('/customer/chat/sale')));
    const tokenIndex = calls.findIndex((c) => c.url.includes('/customer/token'));
    const saleIndex = calls.findIndex((c) => c.url.includes('/customer/chat/sale'));
    expect(tokenIndex).toBeGreaterThanOrEqual(0);
    expect(tokenIndex).toBeLessThan(saleIndex);

    const sent = calls.find((c) => c.url.includes('/customer/chat/sale'))!;
    expect(sent.body).toEqual(VALID_PAYLOAD);
  });

  it('never sends a payload missing a required field', async () => {
    mountWidget('?organization_id=org-1');
    sendCommand('trackSale', { amount_cents: 500, currency: 'USD' });

    await settle();
    expect(calls.some((c) => c.url.includes('/customer/chat/sale'))).toBe(false);
  });

  it('never sends a payload with the wrong field types', async () => {
    mountWidget('?organization_id=org-1');
    sendCommand('trackSale', { external_order_id: 'o-1', amount_cents: '19.99', currency: 'USD' });

    await settle();
    expect(calls.some((c) => c.url.includes('/customer/chat/sale'))).toBe(false);
  });

  it('swallows a server rejection instead of throwing', async () => {
    saleResponse = () => errorResponse(400, 'currency mismatch');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mountWidget('?organization_id=org-1');

    expect(() => sendCommand('trackSale', VALID_PAYLOAD)).not.toThrow();
    await waitFor(() => warn.mock.calls.length > 0);
    warn.mockRestore();
  });

  it('swallows a network failure instead of throwing', async () => {
    saleNetworkFail = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mountWidget('?organization_id=org-1');

    expect(() => sendCommand('trackSale', VALID_PAYLOAD)).not.toThrow();
    await waitFor(() => warn.mock.calls.length > 0);
    warn.mockRestore();
  });

  it('ignores an unknown command', async () => {
    mountWidget('?organization_id=org-1');
    expect(() => sendCommand('doSomethingElse', VALID_PAYLOAD)).not.toThrow();
    await settle();
    expect(calls.some((c) => c.url.includes('/customer/chat/sale'))).toBe(false);
  });
});
