/**
 * `siyahtus('trackEvent', …)` inside the widget document (EN-06).
 *
 * The same wire as `trackSale` (widget.tracksale.test.ts): a relayed
 * `siyahtus:command` reaches `POST /customer/events` with only the name and the
 * short label, a bad name never goes out at all, an amount the page adds never
 * leaves the widget, and a failure is swallowed — the page that calls this must
 * never see the feature break it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

/** Every widget this file mounts, taken down after each test (`mount` returns its teardown). */
const mounted: Array<() => void> = [];

interface FetchCall {
  url: string;
  body: unknown;
}

let calls: FetchCall[] = [];
/** Overridable per test; defaults to a plain 200 with no interesting body. */
let eventResponse: () => Response = () => jsonResponse({});
/** Overridable per test — makes the event call itself reject, like a dropped connection. */
let eventNetworkFail = false;

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

      if (url.includes('/customer/events')) {
        if (eventNetworkFail) throw new Error('offline');
        return eventResponse();
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
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mounted.push(mount(document, window));
}

/** Simulates the loader relaying a command across the message boundary. */
function sendCommand(
  command: string,
  payload: unknown,
  source: MessageEventSource | null = window.parent,
): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'siyahtus:command', command, payload },
      source,
    }),
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

/** Another frame on the embedding page — it can reach the widget's window too. */
function otherFrame(): Window {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  return frame.contentWindow!;
}

const VALID_PAYLOAD = { name: 'registration_completed' };

beforeEach(() => {
  calls = [];
  eventResponse = () => jsonResponse({});
  eventNetworkFail = false;
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  // See widget.unread.test.ts: a stored customer id auto-connects the mount.
  window.localStorage.clear();
  stubFetch();
});

afterEach(() => {
  for (const stop of mounted.splice(0)) stop();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('widget trackEvent (EN-06)', () => {
  it('takes an event only from the page the widget is embedded in (tm 449)', async () => {
    mountWidget('?organization_id=org-1');
    sendCommand('trackEvent', { name: 'forged_by_a_frame' }, otherFrame());
    sendCommand('trackEvent', VALID_PAYLOAD, null);
    await settle();
    expect(calls.some((c) => c.url.includes('/customer/events'))).toBe(false);

    sendCommand('trackEvent', VALID_PAYLOAD);
    await waitFor(() => calls.some((c) => c.url.includes('/customer/events')));
    const events = calls.filter((c) => c.url.includes('/customer/events'));
    expect(events.map((c) => c.body)).toEqual([VALID_PAYLOAD]);
  });

  // The one test in this file that checks call *order*: it needs a widget that has never
  // authenticated. Each test's widget is taken down after it, so none from an earlier test
  // can answer this one's command first.
  it('mints a token first, then reports the relayed event with the expected body', async () => {
    mountWidget('?organization_id=org-1');
    sendCommand('trackEvent', VALID_PAYLOAD);

    await waitFor(() => calls.some((c) => c.url.includes('/customer/events')));
    const tokenIndex = calls.findIndex((c) => c.url.includes('/customer/token'));
    const eventIndex = calls.findIndex((c) => c.url.includes('/customer/events'));
    expect(tokenIndex).toBeGreaterThanOrEqual(0);
    expect(tokenIndex).toBeLessThan(eventIndex);

    const sent = calls.find((c) => c.url.includes('/customer/events'))!;
    expect(sent.body).toEqual(VALID_PAYLOAD);
  });

  it('sends the value, trimmed, and nothing else the page added — no amount', async () => {
    mountWidget('?organization_id=org-1');
    sendCommand('trackEvent', {
      name: 'plan_chosen',
      value: '  pro ',
      amount_cents: 4990,
      amount: 49.9,
      license_id: 7,
    });

    await waitFor(() => calls.some((c) => c.url.includes('/customer/events')));
    expect(calls.find((c) => c.url.includes('/customer/events'))!.body).toEqual({
      name: 'plan_chosen',
      value: 'pro',
    });
  });

  it('drops a value that is not a short string but still reports the event', async () => {
    mountWidget('?organization_id=org-1');
    sendCommand('trackEvent', { name: 'deposit_viewed', value: 49.9 });
    await waitFor(() => calls.some((c) => c.url.includes('/customer/events')));
    expect(calls.find((c) => c.url.includes('/customer/events'))!.body).toEqual({
      name: 'deposit_viewed',
    });
  });

  it.each([
    ['a missing name', { value: 'x' }],
    ['an upper-case name', { name: 'Registration' }],
    ['a name with a space', { name: 'sign up' }],
    ['a name over 40 characters', { name: 'a'.repeat(41) }],
    ['an empty name', { name: '' }],
    ['a name that is not a string', { name: 7 }],
    ['no payload at all', undefined],
    ['a payload that is not an object', 'registration_completed'],
  ])('never sends %s — and does not break the page', async (_label, payload) => {
    mountWidget('?organization_id=org-1');
    expect(() => sendCommand('trackEvent', payload)).not.toThrow();

    await settle();
    expect(calls.some((c) => c.url.includes('/customer/events'))).toBe(false);
  });

  it('swallows a server rejection instead of throwing', async () => {
    eventResponse = () => errorResponse(400, 'currency mismatch');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mountWidget('?organization_id=org-1');

    expect(() => sendCommand('trackEvent', VALID_PAYLOAD)).not.toThrow();
    await waitFor(() => warn.mock.calls.length > 0);
    warn.mockRestore();
  });

  it('swallows a network failure instead of throwing', async () => {
    eventNetworkFail = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mountWidget('?organization_id=org-1');

    expect(() => sendCommand('trackEvent', VALID_PAYLOAD)).not.toThrow();
    await waitFor(() => warn.mock.calls.length > 0);
    warn.mockRestore();
  });

  it('ignores an unknown command', async () => {
    mountWidget('?organization_id=org-1');
    expect(() => sendCommand('doSomethingElse', VALID_PAYLOAD)).not.toThrow();
    await settle();
    expect(calls.some((c) => c.url.includes('/customer/events'))).toBe(false);
  });
});
