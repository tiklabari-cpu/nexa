/**
 * `siyahtus('identify', {...})` inside the widget document (ID-03 · K28 ·
 * tm 388): the operator's server signed the member logged in on the page, and
 * the loader relayed it here.
 *
 * Pinned: the identity is minted for at once — a first-time visitor too, since
 * a signature lives five minutes and is spent on first use — and as the page
 * gave it (the server checks it); a mint already out lands first and another
 * carries the identity; the socket logged in as the old customer closes before
 * that second mint; a poll fetched with the old token is never drawn over the
 * new customer's transcript; a command from another window, or on the hosted
 * Chat page, mints nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storageKeys } from './api.js';
import { mount } from './widget.js';

const mounted: Array<() => void> = [];

const API = 'https://api.test/v1';
const ORG = 'org-1';

/** What the page hands identify: opaque here, checked by the server. */
const IDENTITY = {
  user_id: 'player-42',
  username: 'ayse',
  ts: 1_730_000_000,
  user_hash: 'a'.repeat(64),
};

interface Mint {
  body: Record<string, unknown>;
}

let mints: Mint[] = [];
/** The customer and token each mint (1-based) answers with. */
let mintAnswer: (n: number) => { token: string; customer_id: string } = () => ({
  token: 'tok-1',
  customer_id: 'cust-1',
});
/** Held open by a test that needs a poll in flight across a mint. */
let heldPoll: ((events: unknown[]) => void) | null = null;
let holdNextPoll = false;
let mintExtra: Record<string, unknown> = {};

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

function message(id: string, text: string): Record<string, unknown> {
  return {
    id,
    text,
    author_type: 'customer',
    created_at: '2026-11-03T10:00:00.000Z',
    type: 'message',
    attachment_url: null,
  };
}

function snapshot(events: unknown[]): Record<string, unknown> {
  return {
    online: true,
    agent_typing: false,
    customer: { id: 'x', name: null, email: null },
    agent: null,
    chat: { id: 'chat-1', thread_id: 'thr-1', queue_position: null },
    events,
    campaign: null,
  };
}

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response;
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/customer/token') && init?.method === 'POST') {
        mints.push({ body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return jsonResponse({ ...mintAnswer(mints.length), ...mintExtra });
      }
      if (url.endsWith('/customer/chat')) {
        const auth = JSON.stringify(init?.headers ?? {});
        if (holdNextPoll) {
          holdNextPoll = false;
          return new Promise<Response>((resolve) => {
            heldPoll = (events) => resolve(jsonResponse(snapshot(events)));
          });
        }
        // Each customer's own transcript, by the token the request carried.
        return jsonResponse(
          snapshot(
            auth.includes('tok-2')
              ? [message('e2', 'the member’s own conversation')]
              : [message('e1', 'the browser’s earlier visitor')],
          ),
        );
      }
      return jsonResponse({});
    }),
  );
}

function mountWidget(path = '/widget.html'): HTMLElement {
  window.history.replaceState({}, '', `${path}?organization_id=${ORG}&api=${API}`);
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mounted.push(mount(document, window));
  return root;
}

function returningVisitor(): void {
  window.localStorage.setItem(storageKeys(ORG).customerId, 'cust-1');
}

function identify(payload: unknown = IDENTITY, source: Window | null = window.parent): void {
  const event = new MessageEvent('message', {
    data: { type: 'siyahtus:command', command: 'identify', payload },
  });
  Object.defineProperty(event, 'source', { value: source });
  window.dispatchEvent(event);
}

async function waitFor(predicate: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('waitFor timed out');
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  mints = [];
  mintAnswer = () => ({ token: 'tok-1', customer_id: 'cust-1' });
  heldPoll = null;
  holdNextPoll = false;
  mintExtra = {};
  FakeSocket.instances = [];
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.localStorage.clear();
  stubFetch();
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  for (const stop of mounted.splice(0)) stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe("widget siyahtus('identify') (ID-03 · K28 · tm 388)", () => {
  it('mints at once for a first-time visitor, sending the identity as the page gave it', async () => {
    mountWidget();
    await settle();
    expect(mints).toHaveLength(0); // a first-time visitor is not minted for on load

    identify();
    await waitFor(() => mints.length === 1);
    expect(mints[0]!.body['identity']).toEqual(IDENTITY);
    await settle();
    expect(mints).toHaveLength(1);
  });

  it('lets a mint already out land, then mints again with the identity', async () => {
    returningVisitor();
    mountWidget();
    // The mount's own connect is out; the identify arrives behind it.
    identify();
    await waitFor(() => mints.length === 2);
    expect(mints[0]!.body).not.toHaveProperty('identity');
    expect(mints[1]!.body['identity']).toEqual(IDENTITY);
  });

  it('closes the socket logged in as the old customer before the second mint opens a new one', async () => {
    mintExtra = { rtm_url: 'wss://rtm.test/v1/customer/rtm/ws' };
    returningVisitor();
    mountWidget();
    await waitFor(() => FakeSocket.instances.length === 1);
    const first = FakeSocket.instances[0]!;

    mintAnswer = (n) =>
      n === 1
        ? { token: 'tok-1', customer_id: 'cust-1' }
        : { token: 'tok-2', customer_id: 'cust-2' };
    identify();
    await waitFor(() => FakeSocket.instances.length === 2);
    expect(first.closed).toBe(true);
    expect(FakeSocket.instances[1]!.closed).toBe(false);
  });

  it('never draws a poll fetched with the old token over the member’s transcript', async () => {
    mintAnswer = (n) =>
      n === 1
        ? { token: 'tok-1', customer_id: 'cust-1' }
        : { token: 'tok-2', customer_id: 'cust-2' };
    returningVisitor();
    vi.useFakeTimers();
    const root = mountWidget();
    // Promise chains only: the clock is fake, so nothing that sleeps would wake.
    const flush = async (): Promise<void> => {
      for (let i = 0; i < 10; i += 1) await vi.advanceTimersByTimeAsync(0);
    };
    await flush();
    expect(mints).toHaveLength(1);
    expect(root.textContent).toContain('the browser’s earlier visitor');

    // The closed panel's next poll goes out with tok-1 and is held.
    holdNextPoll = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(heldPoll).not.toBeNull();

    identify();
    await flush();
    expect(mints).toHaveLength(2);
    expect(root.textContent).toContain('the member’s own conversation');
    expect(root.textContent).not.toContain('the browser’s earlier visitor');

    // The earlier visitor's transcript answers late: it is not drawn.
    heldPoll!([message('e1', 'the browser’s earlier visitor')]);
    await flush();
    expect(root.textContent).toContain('the member’s own conversation');
    expect(root.textContent).not.toContain('the browser’s earlier visitor');
  });

  it('mints nothing for a command from another window, nor on the hosted Chat page', async () => {
    mountWidget();
    await settle();
    identify(IDENTITY, null);
    await settle();
    expect(mints).toHaveLength(0);

    for (const stop of mounted.splice(0)) stop();
    document.body.replaceChildren();
    mountWidget('/chat.html');
    await waitFor(() => mints.length === 1); // the Chat page connects on its own
    identify();
    await settle();
    expect(mints).toHaveLength(1);
    expect(mints[0]!.body).not.toHaveProperty('identity');
  });
});
