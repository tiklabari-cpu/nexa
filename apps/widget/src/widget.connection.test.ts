/**
 * A dropped connection is said, and what arrived during it is caught up once
 * (tm 259.11 · UX audit O2).
 *
 * A failed poll used to go to `console.warn` and nowhere else. The agent's
 * replies stopped arriving, Send stayed live, and the visitor had no way to tell
 * a dead line from an agent who had gone quiet. Measured in a real browser
 * (`context.setOffline`) before the change: thirteen seconds offline, an agent
 * reply written in that window, and the panel showed exactly what it showed
 * before — no line, no hint, Send enabled.
 *
 * Delivery is the part that must not regress: a reconnect that drops a reply,
 * or draws one twice, is worse than the silence it replaces. So the catch-up is
 * pinned from both paths — the poll's snapshot and the socket's replay — and
 * against the two of them delivering the same event.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

const API = 'https://api.test/v1';
const RTM = 'ws://rtm.test/v1/customer/rtm/ws';
const LOST = 'Connection lost. Reconnecting…';

interface Event {
  id: string;
  text: string | null;
  author_type: 'agent' | 'customer' | 'bot' | 'system';
  created_at: string;
  type: string;
  attachment_url: string | null;
}

function message(id: string, author: Event['author_type'], text: string): Event {
  return {
    id,
    text,
    author_type: author,
    created_at: '2026-10-08T10:00:00.000Z',
    type: 'message',
    attachment_url: null,
  };
}

const VISITOR_ASK = message('thr-1_1', 'customer', 'is my order on its way?');
const AGENT_REPLY = message('thr-1_2', 'agent', 'it left the depot this morning');

interface SentFrame {
  request_id: string;
  action: string;
  payload: Record<string, unknown>;
}

/** Stands in for the browser's `WebSocket` (same shape as `widget.socket.test.ts`). */
class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly sent: SentFrame[] = [];
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as SentFrame);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  frame(action: string): SentFrame | undefined {
    return this.sent.find((f) => f.action === action);
  }

  answer(action: string, payload: Record<string, unknown>): void {
    const request = this.frame(action);
    if (!request) throw new Error(`the widget did not send a ${action}`);
    this.onmessage?.({
      data: JSON.stringify({
        request_id: request.request_id,
        action,
        type: 'response',
        success: true,
        payload,
      }),
    });
  }
}

/** What the network does with the next request: answers, or is not there. */
let network: 'up' | 'down' = 'up';
/** A status the poll answers with instead of the snapshot, when set. */
let pollStatus: number | null = null;
let chatPolls = 0;
let sends = 0;
let serverEvents: Event[] = [];
let rtmUrl: string | null = null;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response;
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      // A dead line fails the request itself, the way `fetch` does offline.
      if (network === 'down') throw new TypeError('Failed to fetch');
      if (url.includes('/customer/token')) {
        return jsonResponse({
          token: 'nxc1.body.sig',
          customer_id: 'cust-1',
          ...(rtmUrl ? { rtm_url: rtmUrl } : {}),
        });
      }
      if (url.endsWith('/customer/chat/events') && init?.method === 'POST') {
        sends += 1;
        return jsonResponse({ chat_id: 'chat-1', event: null });
      }
      if (url.endsWith('/customer/chat')) {
        chatPolls += 1;
        if (pollStatus !== null) {
          return jsonResponse({ error: { type: 'authorization', message: 'no' } }, pollStatus);
        }
        return jsonResponse({
          online: true,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: null,
          chat: { id: 'chat-1', thread_id: 'thr-1', queue_position: null },
          events: [...serverEvents],
          campaign: null,
        });
      }
      return jsonResponse({});
    }),
  );
}

function mountWidget(): HTMLElement {
  window.history.replaceState({}, '', `/widget.html?organization_id=org-1&api=${API}`);
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mount(document, window);
  return root;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

const line = (root: HTMLElement): HTMLElement => root.querySelector<HTMLElement>('.nx-connection')!;
const sendButton = (root: HTMLElement): HTMLButtonElement =>
  root.querySelector<HTMLButtonElement>('.nx-send')!;
const bubbles = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('.nx-bubble')].map((el) => el.textContent ?? '');

/** Open the panel on fake timers and let the first poll land. */
async function openPanel(): Promise<HTMLElement> {
  vi.useFakeTimers();
  const root = mountWidget();
  root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
  await settle();
  expect(chatPolls).toBe(1);
  return root;
}

/** One open-panel poll interval, plus the promise chain it starts. */
async function nextPoll(ms = 4_000): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

function expectLost(root: HTMLElement): void {
  expect(line(root).hidden).toBe(false);
  expect(line(root).textContent).toBe(LOST);
  expect(sendButton(root).disabled).toBe(true);
}

function expectConnected(root: HTMLElement): void {
  expect(line(root).hidden).toBe(true);
  expect(line(root).textContent).toBe('');
  expect(sendButton(root).disabled).toBe(false);
}

beforeEach(() => {
  network = 'up';
  pollStatus = null;
  chatPolls = 0;
  sends = 0;
  serverEvents = [VISITOR_ASK];
  rtmUrl = null;
  FakeSocket.instances = [];
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.localStorage.clear();
  stubFetch();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
});

describe('a dropped connection is said (tm 259.11 · O2)', () => {
  it('stays quiet for one failed poll and speaks up on the second', async () => {
    const root = await openPanel();
    expectConnected(root);
    // A live region from the first frame, so the change is announced.
    expect(line(root).getAttribute('role')).toBe('status');

    network = 'down';
    await nextPoll();
    // One lost request is a blip — a line that flickered on every one would
    // teach the visitor to ignore it.
    expectConnected(root);

    await nextPoll();
    expectLost(root);
  });

  it('clears on the first answered poll and brings the reply that arrived meanwhile, once', async () => {
    const root = await openPanel();
    expect(bubbles(root)).toEqual(['is my order on its way?']);

    network = 'down';
    await nextPoll();
    await nextPoll();
    expectLost(root);

    // The agent answers while the visitor is cut off.
    serverEvents = [VISITOR_ASK, AGENT_REPLY];
    network = 'up';
    // The third retry is the back-off's eight seconds, not four.
    await nextPoll(8_000);

    expectConnected(root);
    expect(bubbles(root)).toEqual(['is my order on its way?', 'it left the depot this morning']);

    // And the next ordinary poll — carrying the same events — draws nothing new.
    await nextPoll();
    expect(bubbles(root)).toEqual(['is my order on its way?', 'it left the depot this morning']);
  });

  it("raises the line on the browser's offline event, before any poll fails", async () => {
    const root = await openPanel();
    const polls = chatPolls;

    window.dispatchEvent(new window.Event('offline'));

    expectLost(root);
    expect(chatPolls).toBe(polls);
  });

  it('catches up the moment the browser is back online, without waiting out the back-off', async () => {
    const root = await openPanel();
    network = 'down';
    window.dispatchEvent(new window.Event('offline'));
    // Long enough for the back-off to have stretched to thirty seconds.
    for (let i = 0; i < 4; i += 1) await nextPoll(30_000);
    expectLost(root);
    const polls = chatPolls;

    serverEvents = [VISITOR_ASK, AGENT_REPLY];
    network = 'up';
    window.dispatchEvent(new window.Event('online'));
    // No timer advanced: the `online` event polls by itself. (At least one —
    // widgets earlier tests mounted on this same `window` hear the event too.)
    await settle();

    expect(chatPolls).toBeGreaterThan(polls);
    expectConnected(root);
    expect(bubbles(root)).toEqual(['is my order on its way?', 'it left the depot this morning']);
  });

  it('keeps the line until a poll is answered when only the network interface came back', async () => {
    const root = await openPanel();
    network = 'down';
    await nextPoll();
    await nextPoll();
    expectLost(root);

    // The browser says online, but the server is still out of reach: the line
    // must not promise a connection the next request disproves.
    window.dispatchEvent(new window.Event('online'));
    await settle();
    expectLost(root);
  });

  it('backs off 4 → 8 → 16 → 30 s while the server cannot be reached, and no further', async () => {
    await openPanel();
    network = 'down';

    // `chatPolls` counts answered requests only, so count attempts on `fetch`.
    const attempts = (): number =>
      vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith('/customer/chat'))
        .length;

    const start = attempts();
    await nextPoll(4_000); // first failure, at the usual cadence
    expect(attempts()).toBe(start + 1);
    await nextPoll(4_000); // second, still at the usual cadence
    expect(attempts()).toBe(start + 2);
    await nextPoll(7_900);
    expect(attempts()).toBe(start + 2);
    await nextPoll(100); // eight seconds after the second
    expect(attempts()).toBe(start + 3);
    await nextPoll(16_000);
    expect(attempts()).toBe(start + 4);
    await nextPoll(29_900);
    expect(attempts()).toBe(start + 4);
    await nextPoll(100);
    expect(attempts()).toBe(start + 5);
    // The ceiling holds: thirty again, not sixty.
    await nextPoll(30_000);
    expect(attempts()).toBe(start + 6);

    // Back to four seconds the moment the server answers.
    network = 'up';
    await nextPoll(30_000);
    expect(attempts()).toBe(start + 7);
    await nextPoll(4_000);
    expect(attempts()).toBe(start + 8);
  });

  it('holds Send while the line shows: Enter posts nothing and the text stays', async () => {
    const root = await openPanel();
    window.dispatchEvent(new window.Event('offline'));
    expectLost(root);

    const input = root.querySelector<HTMLTextAreaElement>('.nx-input')!;
    input.value = 'are you still there?';
    root
      .querySelector<HTMLFormElement>('.nx-form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    expect(sends).toBe(0);
    expect(input.value).toBe('are you still there?');
    expect(bubbles(root)).toEqual(['is my order on its way?']);
  });

  it('does not call a refusal a dropped line: a 4xx poll is the server answering', async () => {
    const root = await openPanel();
    pollStatus = 403;
    await nextPoll();
    await nextPoll();
    await nextPoll();
    expectConnected(root);
  });

  it('a 5xx poll is a line that is not getting through', async () => {
    const root = await openPanel();
    pollStatus = 503;
    await nextPoll();
    await nextPoll();
    expectLost(root);
  });

  it('a hidden tab keeps not polling, and coming online there waits for it to be seen', async () => {
    const root = await openPanel();
    window.dispatchEvent(new window.Event('offline'));
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    try {
      const polls = chatPolls;
      network = 'up';
      window.dispatchEvent(new window.Event('online'));
      await settle();
      await nextPoll();
      await nextPoll();
      expect(chatPolls).toBe(polls);
    } finally {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    }
    await nextPoll();
    expectConnected(root);
  });
});

describe('the catch-up after a dropped connection delivers once (tm 259.11 · O2)', () => {
  it('a reply the poll caught up and the socket then replays is drawn once, and the replay resumes after it', async () => {
    rtmUrl = RTM;
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const root = await openPanel();

    // The socket comes up and goes live.
    const first = FakeSocket.instances[0]!;
    first.onopen?.();
    await settle();
    first.answer('login', { my_profile: { id: 'cust-1', kind: 'customer' } });
    await settle();
    first.answer('sync', { chats: [], removed_chat_ids: [], new_chat_ids: [] });
    await settle();

    // The line drops: socket and poll alike.
    network = 'down';
    window.dispatchEvent(new window.Event('offline'));
    first.close();
    await settle();
    expectLost(root);

    // The agent answers in the gap; coming back, the poll catches up first.
    serverEvents = [VISITOR_ASK, AGENT_REPLY];
    network = 'up';
    window.dispatchEvent(new window.Event('online'));
    await settle();
    expectConnected(root);
    expect(bubbles(root)).toEqual(['is my order on its way?', 'it left the depot this morning']);

    // Then the socket reconnects and its replay carries the same reply.
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    const second = FakeSocket.instances.at(-1)!;
    expect(second).not.toBe(first);
    second.onopen?.();
    await settle();
    second.answer('login', { my_profile: { id: 'cust-1', kind: 'customer' } });
    await settle();
    // The cursor is the newest event on screen — the one the poll just
    // brought — so a correct gateway replays nothing.
    expect(second.frame('sync')?.payload).toEqual({ cursors: { 'chat-1': AGENT_REPLY.id } });
    // A gateway that replays it anyway must still not draw it twice.
    second.answer('sync', {
      chats: [{ chat_id: 'chat-1', events: [AGENT_REPLY] }],
      removed_chat_ids: [],
      new_chat_ids: [],
    });
    await settle();

    expect(bubbles(root)).toEqual(['is my order on its way?', 'it left the depot this morning']);
  });

  it('a reply the socket replays before the poll catches up is drawn once when the poll lands', async () => {
    rtmUrl = RTM;
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const root = await openPanel();
    const first = FakeSocket.instances[0]!;
    first.onopen?.();
    await settle();
    first.answer('login', { my_profile: { id: 'cust-1', kind: 'customer' } });
    await settle();
    first.answer('sync', { chats: [], removed_chat_ids: [], new_chat_ids: [] });
    await settle();

    network = 'down';
    first.close();
    await nextPoll();
    await nextPoll();
    expectLost(root);

    // The socket gets through first this time and replays the reply.
    serverEvents = [VISITOR_ASK, AGENT_REPLY];
    const second = FakeSocket.instances.at(-1)!;
    expect(second).not.toBe(first);
    second.onopen?.();
    await settle();
    second.answer('login', { my_profile: { id: 'cust-1', kind: 'customer' } });
    await settle();
    expect(second.frame('sync')?.payload).toEqual({ cursors: { 'chat-1': VISITOR_ASK.id } });
    second.answer('sync', {
      chats: [{ chat_id: 'chat-1', events: [AGENT_REPLY] }],
      removed_chat_ids: [],
      new_chat_ids: [],
    });
    await settle();
    expect(bubbles(root)).toEqual(['is my order on its way?', 'it left the depot this morning']);

    // Then the poll answers with the same transcript.
    network = 'up';
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expectConnected(root);
    expect(bubbles(root)).toEqual(['is my order on its way?', 'it left the depot this morning']);
  });
});
