/**
 * The widget on a live socket (FR-MOD-11.6).
 *
 * `socket.test.ts` covers the client in isolation — the handshake, the cursor,
 * what it refuses to pass on. This file covers the half that only exists once
 * the two are wired together, and that is where the requirement actually lives:
 *
 *   - a reply reaches the transcript with **no poll at all**, which is the only
 *     measurable difference between "live" and "four seconds late";
 *   - the poll does not stop, it *demotes* — three server-driven features have
 *     no push behind them (see `SOCKET_POLL_INTERVAL_MS`);
 *   - a socket that never connects costs nothing: the four-second poll is still
 *     there, which is what makes this an optimisation rather than a rewrite;
 *   - the same event arriving on both paths is rendered once. That is not a
 *     nicety — the paths overlap by construction, so without it every reconnect
 *     and every visitor's own message double up on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

const API = 'https://api.test/v1';
const RTM = 'ws://rtm.test/v1/customer/rtm/ws';

interface Event {
  id: string;
  text: string | null;
  author_type: 'agent' | 'customer' | 'bot' | 'system';
  created_at: string;
  type: string;
  attachment_url: string | null;
  properties?: Record<string, unknown>;
}

function message(id: string, author: Event['author_type'], text: string): Event {
  return {
    id,
    text,
    author_type: author,
    created_at: '2026-09-06T10:00:00.000Z',
    type: 'message',
    attachment_url: null,
  };
}

const VISITOR_ASK = message('thr-1_1', 'customer', 'my order is late');
const AGENT_REPLY = message('thr-1_2', 'agent', 'let me look that up');

interface SentFrame {
  request_id: string;
  action: string;
  payload: Record<string, unknown>;
}

/** Stands in for the browser's `WebSocket`, which jsdom would really dial. */
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

  /** The gateway accepting the handshake. */
  acceptLogin(): void {
    const login = this.sent.find((frame) => frame.action === 'login');
    if (!login) throw new Error('the widget did not send a login');
    this.deliver({
      request_id: login.request_id,
      action: 'login',
      type: 'response',
      success: true,
      payload: { my_profile: { id: 'cust-1', kind: 'customer' } },
    });
  }

  /**
   * Answer the `sync` that follows every login the widget already has a cursor
   * for — which, on a panel that has polled once, is every login. That gap is
   * small and real: an agent replying between the poll's response and the
   * socket's login would otherwise wait out the heartbeat.
   */
  acceptSync(payload: Record<string, unknown> = {}): void {
    const sync = this.sent.find((frame) => frame.action === 'sync');
    if (!sync) throw new Error('the widget did not send a sync');
    this.deliver({
      request_id: sync.request_id,
      action: 'sync',
      type: 'response',
      success: true,
      payload: { chats: [], removed_chat_ids: [], new_chat_ids: [], ...payload },
    });
  }

  /** The `sync` the widget is waiting on, once it has sent one. */
  syncRequest(): SentFrame | undefined {
    return this.sent.find((frame) => frame.action === 'sync');
  }

  push(action: string, payload: Record<string, unknown>): void {
    this.deliver({ action, type: 'push', payload });
  }

  deliver(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

let chatPolls = 0;
let sends = 0;
/** Overridable per test: what the Nth (1-based) poll answers with. */
let eventsAt: (poll: number) => Event[] = () => [];
/** Overridable per test: the gateway address the mint publishes. */
let rtmUrl: string | null = RTM;
let chatId: string | null = 'chat-1';

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/customer/token')) {
        return jsonResponse({
          token: 'nxc1.body.sig',
          customer_id: 'cust-1',
          pre_chat_form: [],
          ...(rtmUrl ? { rtm_url: rtmUrl } : {}),
        });
      }
      if (url.endsWith('/customer/chat/events') && init?.method === 'POST') {
        sends += 1;
        return jsonResponse({ chat_id: 'chat-1', event: null });
      }
      if (url.endsWith('/customer/chat')) {
        chatPolls += 1;
        return jsonResponse({
          online: true,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: null,
          chat: chatId ? { id: chatId, thread_id: 'thr-1', queue_position: null } : null,
          events: eventsAt(chatPolls),
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
  root.id = 'nexa-widget-root';
  document.body.append(root);
  mount(document, window);
  return root;
}

/** Drain the promise chain a mount or a handshake kicks off, without the clock. */
async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

function bubbles(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.nx-bubble')].map((el) => el.textContent ?? '');
}

function launcher(root: HTMLElement): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>('.nx-launcher')!;
}

/**
 * Take a socket through the full handshake the widget performs: `login`, then
 * the `sync` that closes the gap between the last poll and this connection.
 * The socket is not live until both have settled — announcing it earlier would
 * let the caller slow the poll that is still covering that gap.
 */
async function handshake(socket: FakeSocket): Promise<void> {
  socket.onopen?.();
  await settle();
  socket.acceptLogin();
  await settle();
  if (socket.syncRequest()) {
    socket.acceptSync();
    await settle();
  }
}

/** Open the panel and let the socket finish its handshake. */
async function openLive(root: HTMLElement): Promise<FakeSocket> {
  launcher(root).click();
  await settle();
  const socket = FakeSocket.instances[0]!;
  await handshake(socket);
  return socket;
}

beforeEach(() => {
  chatPolls = 0;
  sends = 0;
  eventsAt = () => [];
  rtmUrl = RTM;
  chatId = 'chat-1';
  FakeSocket.instances = [];
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.localStorage.clear();
  stubFetch();
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
});

describe('widget RTM connection (FR-MOD-11.6)', () => {
  it("shows an agent's reply with no poll behind it", async () => {
    eventsAt = () => [VISITOR_ASK];
    const root = mountWidget();
    const socket = await openLive(root);

    expect(socket.url).toBe(`${RTM}?organization_id=org-1`);
    const pollsBefore = chatPolls;
    expect(bubbles(root)).toEqual(['my order is late']);

    // The agent answers. No timer is advanced and no request is made — this is
    // the claim "live" makes, and the only way to measure it.
    socket.push('incoming_event', { chat_id: 'chat-1', event: AGENT_REPLY });
    await settle();

    expect(bubbles(root)).toEqual(['my order is late', 'let me look that up']);
    expect(chatPolls).toBe(pollsBefore);
  });

  it('demotes the four-second poll to a heartbeat while the socket is live', async () => {
    vi.useFakeTimers();
    eventsAt = () => [VISITOR_ASK];
    const root = mountWidget();
    launcher(root).click();
    await settle();
    await handshake(FakeSocket.instances[0]!);

    const baseline = chatPolls;
    // Four seconds is the open panel's cadence without a socket. With one, the
    // request that cadence exists for has already been made obsolete.
    await vi.advanceTimersByTimeAsync(4_000);
    await settle();
    expect(chatPolls).toBe(baseline);

    // It does not stop, though: campaigns, the agent-typing line and
    // online/queue status arrive on this request and nowhere else.
    await vi.advanceTimersByTimeAsync(27_000);
    await settle();
    expect(chatPolls).toBe(baseline + 1);
  });

  it('keeps the fast poll when the socket never comes up', async () => {
    vi.useFakeTimers();
    eventsAt = () => [VISITOR_ASK];
    const root = mountWidget();
    launcher(root).click();
    await settle();

    // Dialled, but the upgrade never completes — a corporate proxy, a CSP that
    // does not name the gateway. The visitor must not be able to tell.
    const baseline = chatPolls;
    await vi.advanceTimersByTimeAsync(4_100);
    await settle();
    expect(chatPolls).toBe(baseline + 1);
  });

  it('publishes no socket at all when the deployment names no gateway', async () => {
    vi.useFakeTimers();
    rtmUrl = null;
    eventsAt = () => [VISITOR_ASK];
    const root = mountWidget();
    launcher(root).click();
    await settle();

    expect(FakeSocket.instances).toHaveLength(0);
    const baseline = chatPolls;
    await vi.advanceTimersByTimeAsync(4_100);
    await settle();
    expect(chatPolls).toBe(baseline + 1);
  });

  it('returns to the fast poll the moment the socket drops', async () => {
    vi.useFakeTimers();
    eventsAt = () => [VISITOR_ASK];
    const root = mountWidget();
    launcher(root).click();
    await settle();
    const socket = FakeSocket.instances[0]!;
    await handshake(socket);

    socket.close();
    await settle();
    const baseline = chatPolls;
    // Not at the end of the 30-second heartbeat it was midway through — the
    // visitor would otherwise wait out a window that no longer applies.
    await vi.advanceTimersByTimeAsync(4_100);
    await settle();
    expect(chatPolls).toBe(baseline + 1);
  });

  it('does not let a flapping socket starve the closed-panel poll', async () => {
    vi.useFakeTimers();
    eventsAt = () => [VISITOR_ASK];
    // A returning visitor with the panel shut: the poll is the only thing
    // carrying the proactive card and the unread badge, and it runs at 30 s.
    window.localStorage.setItem('nexa.customer_id', 'cust-1');
    mountWidget();
    await settle();
    await handshake(FakeSocket.instances[0]!);
    const baseline = chatPolls;

    // A flaky network: five up/down cycles inside one 30-second window. Each
    // transition asks the poll to move to the cadence that now applies — which,
    // with the panel shut, is the one it is already on. Rescheduling anyway
    // restarts the countdown every nine seconds, and the poll never fires.
    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(8_000);
      FakeSocket.instances.at(-1)!.close();
      await settle();
      await vi.advanceTimersByTimeAsync(1_000);
      const next = FakeSocket.instances.at(-1)!;
      if (!next.closed) await handshake(next);
    }

    // 45 seconds of wall clock have passed; at least one 30-second heartbeat
    // owes the visitor a look at the transcript.
    expect(chatPolls).toBeGreaterThan(baseline);
  });

  it('renders an event once when both paths deliver it', async () => {
    vi.useFakeTimers();
    // The poll's transcript catches up with what the push already delivered —
    // which is the normal case, not a corner one: the two paths run at the same
    // time by design.
    eventsAt = (poll) => (poll <= 1 ? [VISITOR_ASK] : [VISITOR_ASK, AGENT_REPLY]);
    const root = mountWidget();
    launcher(root).click();
    await settle();
    const socket = FakeSocket.instances[0]!;
    await handshake(socket);

    socket.push('incoming_event', { chat_id: 'chat-1', event: AGENT_REPLY });
    await settle();
    expect(bubbles(root)).toEqual(['my order is late', 'let me look that up']);

    await vi.advanceTimersByTimeAsync(31_000);
    await settle();
    expect(bubbles(root)).toEqual(['my order is late', 'let me look that up']);

    // And again, from the socket, after the poll has installed it.
    socket.push('incoming_event', { chat_id: 'chat-1', event: AGENT_REPLY });
    await settle();
    expect(bubbles(root)).toEqual(['my order is late', 'let me look that up']);
  });

  it("does not double the visitor's own message when the server echoes it back", async () => {
    const root = mountWidget();
    const socket = await openLive(root);

    const input = root.querySelector<HTMLTextAreaElement>('.nx-input')!;
    input.value = 'is anyone there?';
    // The echo beats the send's own response, which is what a live socket makes
    // possible: an optimistic bubble is on screen and the real event arrives
    // before the request that created it has returned.
    eventsAt = () => [message('thr-1_7', 'customer', 'is anyone there?')];
    root.querySelector<HTMLButtonElement>('.nx-send')!.click();
    await Promise.resolve();
    socket.push('incoming_event', {
      chat_id: 'chat-1',
      event: message('thr-1_7', 'customer', 'is anyone there?'),
    });
    await settle();

    expect(bubbles(root)).toEqual(['is anyone there?']);
    expect(sends).toBe(1);
  });

  it('resumes from where the poll left off, not from the top of the thread', async () => {
    vi.useFakeTimers();
    eventsAt = () => [VISITOR_ASK, AGENT_REPLY];
    const root = mountWidget();
    launcher(root).click();
    await settle();
    const first = FakeSocket.instances[0]!;
    await handshake(first);

    first.close();
    await settle();
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();

    const second = FakeSocket.instances[1]!;
    second.onopen?.();
    await settle();
    second.acceptLogin();
    await settle();

    const sync = second.syncRequest();
    // The poll fetched up to `thr-1_2`; the reconnect asks for what came after
    // it, not for the conversation the visitor is looking at.
    expect(sync?.payload['cursors']).toEqual({ 'chat-1': 'thr-1_2' });

    second.deliver({
      request_id: sync!.request_id,
      action: 'sync',
      type: 'response',
      success: true,
      payload: {
        chats: [
          {
            chat_id: 'chat-1',
            events: [AGENT_REPLY, message('thr-1_3', 'agent', 'found it')],
            truncated: false,
          },
        ],
        removed_chat_ids: [],
        new_chat_ids: [],
      },
    });
    await settle();

    // `thr-1_2` came back in the replay — the gateway resumes *after* the cursor
    // but a client cannot rely on that alone, so it is deduplicated here too.
    expect(bubbles(root)).toEqual(['my order is late', 'let me look that up', 'found it']);
  });

  it('badges a reply pushed while the panel is shut', async () => {
    eventsAt = () => [VISITOR_ASK];
    // A returning visitor connects on mount without ever opening the panel
    // (FR-MOD-11.1) — which is exactly the state a push has to reach.
    window.localStorage.setItem('nexa.customer_id', 'cust-1');
    const root = mountWidget();
    await settle();
    const socket = FakeSocket.instances[0]!;
    await handshake(socket);

    expect(root.querySelector<HTMLElement>('.nx-panel')!.hidden).toBe(true);
    socket.push('incoming_event', { chat_id: 'chat-1', event: AGENT_REPLY });
    await settle();

    const badge = root.querySelector<HTMLElement>('.nx-badge')!;
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('1');
  });

  it('ends the conversation on a deactivation push, without waiting for a poll', async () => {
    eventsAt = () => [VISITOR_ASK];
    const root = mountWidget();
    const socket = await openLive(root);
    const pollsBefore = chatPolls;

    socket.push('chat_deactivated', { chat_id: 'chat-1' });
    await settle();

    expect(root.querySelector<HTMLElement>('.nx-closed')!.hidden).toBe(false);
    expect(chatPolls).toBe(pollsBefore);
  });

  it('ignores an event for a conversation that is not the one on screen', async () => {
    eventsAt = () => [VISITOR_ASK];
    const root = mountWidget();
    const socket = await openLive(root);

    // Same visitor, an older conversation of theirs. The gateway addresses this
    // socket by customer id, so such a frame is legitimate — it just does not
    // belong in the transcript now on screen.
    socket.push('incoming_event', {
      chat_id: 'chat-old',
      event: message('thr-0_9', 'agent', 'from last week'),
    });
    await settle();

    expect(bubbles(root)).toEqual(['my order is late']);
  });

  it('does not resurrect a conversation the visitor just ended', async () => {
    eventsAt = () => [VISITOR_ASK];
    const root = mountWidget();
    const socket = await openLive(root);

    socket.push('chat_deactivated', { chat_id: 'chat-1' });
    await settle();
    expect(root.querySelector<HTMLElement>('.nx-closed')!.hidden).toBe(false);

    // An event still in flight when the chat closed. Adopting its chat id would
    // put the visitor back into a conversation that is over.
    socket.push('incoming_event', { chat_id: 'chat-1', event: AGENT_REPLY });
    await settle();

    expect(root.querySelector<HTMLElement>('.nx-closed')!.hidden).toBe(false);
    expect(bubbles(root)).toEqual(['my order is late']);
  });

  // =========================================================================
  // A message corrected after it was sent (FR-MOD-02.3.7)
  // =========================================================================
  //
  // The visitor is who a correction is *for*. An agent who fixes a wrong order
  // number, sees their own transcript change and leaves the person it was sent
  // to reading the wrong one has not corrected anything.

  it("replaces an agent's message in place when it is corrected", async () => {
    eventsAt = () => [VISITOR_ASK, AGENT_REPLY];
    const root = mountWidget();
    const socket = await openLive(root);
    expect(bubbles(root)).toEqual(['my order is late', 'let me look that up']);

    socket.push('event_updated', {
      chat_id: 'chat-1',
      event: {
        ...AGENT_REPLY,
        text: 'your order ships tomorrow',
        properties: { edited_at: '2026-09-06T10:05:00.000Z' },
      },
    });
    await settle();

    // Replaced, not appended: the old wording is gone and there is no second
    // bubble beside it.
    expect(bubbles(root)).toEqual(['my order is late', 'your order ships tomorrow']);
    expect(root.textContent).not.toContain('let me look that up');
    // The honest half — the visitor cannot see what it used to say, so they are
    // told that it changed.
    expect([...root.querySelectorAll('.nx-edited')].map((el) => el.textContent)).toEqual([
      'edited',
    ]);
  });

  it('marks nothing as edited when no message has been', async () => {
    eventsAt = () => [VISITOR_ASK, AGENT_REPLY];
    const root = mountWidget();
    await openLive(root);

    expect(root.querySelector('.nx-edited')).toBeNull();
  });

  it('ignores a correction for an event this transcript does not hold', async () => {
    eventsAt = () => [VISITOR_ASK];
    const root = mountWidget();
    const socket = await openLive(root);

    // A message the visitor never received. Adopting it here would show them
    // something they were never sent, on the grounds that somebody edited it.
    socket.push('event_updated', {
      chat_id: 'chat-1',
      event: { ...AGENT_REPLY, text: 'meant for somebody else' },
    });
    await settle();

    expect(bubbles(root)).toEqual(['my order is late']);
  });

  it('ignores a correction addressed to a different conversation', async () => {
    eventsAt = () => [VISITOR_ASK, AGENT_REPLY];
    const root = mountWidget();
    const socket = await openLive(root);

    socket.push('event_updated', {
      chat_id: 'chat-9',
      event: { ...AGENT_REPLY, text: 'another visitor entirely' },
    });
    await settle();

    expect(bubbles(root)).toEqual(['my order is late', 'let me look that up']);
  });
});
