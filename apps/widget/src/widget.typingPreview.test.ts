/**
 * The visitor's unsent draft, on its way out of the widget (tm 417.5 · K2, K3,
 * K11 · FR-MOD-11.8).
 *
 * The owner's two rules shape every case here: "the message in the box should
 * show even before it is sent", and "not a constant send-and-listen — only
 * when needed". So a draft goes only while the server's gate is open, only
 * when the text changed, at most once a second with the last keystrokes never
 * lost; and a draft that sits in the box costs nothing at all.
 *
 * Fake timers throughout: the cadence is the claim, and only a clock the test
 * owns can measure it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

const mounted: Array<() => void> = [];

const API = 'https://api.test/v1';
const RTM = 'ws://rtm.test/v1/customer/rtm/ws';

interface TypingCall {
  is_typing: boolean;
  text?: string;
  seq: number;
  keepalive: boolean;
}

/** Every `POST /customer/chat/typing`, in order. */
let typingCalls: TypingCall[] = [];
/** What the poll says of the gate; `undefined` leaves the field out (an older server). */
let gate: boolean | undefined = true;
let answeredBy: 'human' | 'ai' | 'none' | undefined;
/** How the typing route answers the next draft (once), else 204. */
let nextTypingAnswer: (() => Response) | null = null;
let rtmUrl: string | null = null;
let visibility: DocumentVisibilityState = 'visible';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

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
      if (url.endsWith('/customer/chat/typing')) {
        const body = JSON.parse(String(init?.body)) as Omit<TypingCall, 'keepalive'>;
        typingCalls.push({ ...body, keepalive: init?.keepalive === true });
        const answer = body.is_typing ? nextTypingAnswer : null;
        if (answer) nextTypingAnswer = null;
        return answer ? answer() : jsonResponse(null, 204);
      }
      if (url.endsWith('/customer/chat/events') && init?.method === 'POST') {
        return jsonResponse({ chat_id: 'chat-1', event: null }, 201);
      }
      if (url.endsWith('/customer/chat')) {
        return jsonResponse({
          online: true,
          agent_typing: false,
          ...(answeredBy ? { answered_by: answeredBy } : {}),
          ...(gate === undefined ? {} : { typing_preview: gate }),
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
}

/** Stands in for the browser's `WebSocket` — only (k) needs one. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly sent: Array<{ request_id: string; action: string }> = [];

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as { request_id: string; action: string });
  }

  close(): void {
    this.onclose?.();
  }

  reply(action: string, payload: Record<string, unknown>): void {
    const request = this.sent.find((frame) => frame.action === action);
    if (!request) throw new Error(`the widget sent no ${action}`);
    this.deliver({
      request_id: request.request_id,
      action,
      type: 'response',
      success: true,
      payload,
    });
  }

  push(action: string, payload: Record<string, unknown>): void {
    this.deliver({ action, type: 'push', payload });
  }

  deliver(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

/** Mount on fake timers, open the panel and let the first poll land. */
async function openPanel(): Promise<HTMLElement> {
  vi.useFakeTimers();
  window.history.replaceState({}, '', `/widget.html?organization_id=org-1&api=${API}`);
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mounted.push(mount(document, window));
  root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
  await settle();
  return root;
}

const input = (root: HTMLElement) => root.querySelector<HTMLTextAreaElement>('.nx-input')!;

/** What the visitor's keyboard does: the box changes, then `input` fires. */
async function type(root: HTMLElement, text: string): Promise<void> {
  input(root).value = text;
  input(root).dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}

async function wait(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

const drafts = () => typingCalls.filter((call) => call.is_typing);
const clears = () => typingCalls.filter((call) => !call.is_typing);

beforeEach(() => {
  typingCalls = [];
  gate = true;
  answeredBy = undefined;
  nextTypingAnswer = null;
  rtmUrl = null;
  visibility = 'visible';
  FakeSocket.instances = [];
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.localStorage.clear();
  stubFetch();
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  for (const stop of mounted.splice(0)) stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (document as { visibilityState?: unknown }).visibilityState;
  window.history.replaceState({}, '', '/');
});

describe('widget draft preview cadence (FR-MOD-11.8)', () => {
  it('(a) sends nothing while the gate is shut, however much is typed (FR-MOD-11.8)', async () => {
    gate = false;
    const root = await openPanel();
    for (let i = 1; i <= 20; i += 1) {
      await type(root, 'x'.repeat(i));
      await wait(300);
    }
    expect(typingCalls).toEqual([]);
  });

  it('(b) sends the first keystroke at once and the last one when the second is up (FR-MOD-11.8)', async () => {
    const root = await openPanel();
    await type(root, 'm');
    await wait(100);
    await type(root, 'me');
    await wait(100);
    await type(root, 'mer');
    expect(drafts().map((call) => call.text)).toEqual(['m']);

    await wait(799);
    expect(drafts()).toHaveLength(1);
    await wait(1);
    expect(drafts().map((call) => call.text)).toEqual(['m', 'mer']);

    // Nothing more to say: the box has not moved since.
    await wait(5_000);
    expect(typingCalls).toHaveLength(2);
    const [first, second] = typingCalls;
    expect(second!.seq).toBeGreaterThan(first!.seq);
  });

  it('(c) sends the same text once, however often `input` fires (FR-MOD-11.8)', async () => {
    const root = await openPanel();
    for (let i = 0; i < 5; i += 1) {
      await type(root, '  merhaba ');
      await wait(1_500);
    }
    expect(drafts().map((call) => call.text)).toEqual(['merhaba']);
    expect(clears()).toEqual([]);
  });

  it('(d) neither repeats nor retracts a draft left sitting in the box (FR-MOD-11.8)', async () => {
    const root = await openPanel();
    await type(root, 'beklemede');
    await wait(10_000);
    expect(typingCalls).toHaveLength(1);
    expect(typingCalls[0]).toMatchObject({ is_typing: true, text: 'beklemede' });
  });

  it('(e) leaves the draft showing when the box loses focus (FR-MOD-11.8)', async () => {
    const root = await openPanel();
    await type(root, 'sonra yazarım');
    input(root).dispatchEvent(new Event('blur'));
    await wait(2_000);
    expect(typingCalls).toHaveLength(1);
  });

  it('(f) retracts once when the box is emptied (FR-MOD-11.8)', async () => {
    const root = await openPanel();
    await type(root, 'vazgeçtim');
    await wait(1_200);
    await type(root, '   ');
    await type(root, '');
    await wait(2_000);
    expect(clears()).toHaveLength(1);
    expect(clears()[0]).toMatchObject({ is_typing: false, keepalive: false });
    expect(clears()[0]).not.toHaveProperty('text');
  });

  it('(g) retracts once on send, numbered after the last draft (FR-MOD-11.8)', async () => {
    const root = await openPanel();
    await type(root, 'sipariş nerede');
    input(root).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(2_000);
    expect(drafts()).toHaveLength(1);
    expect(clears()).toHaveLength(1);
    expect(clears()[0]!.seq).toBeGreaterThan(drafts()[0]!.seq);
  });

  it('(h) sends what is in the box once, the moment the gate opens (FR-MOD-11.8)', async () => {
    gate = false;
    const root = await openPanel();
    await type(root, 'kuyrukta yazdım');
    expect(typingCalls).toEqual([]);

    gate = true;
    await wait(4_000); // the open panel's poll
    expect(typingCalls).toEqual([
      expect.objectContaining({ is_typing: true, text: 'kuyrukta yazdım' }),
    ]);
    await wait(8_000);
    expect(typingCalls).toHaveLength(1);
  });

  it('(i) keeps quiet for Retry-After on a 429, then sends the latest once; Send stays usable (FR-MOD-11.8)', async () => {
    const root = await openPanel();
    nextTypingAnswer = () =>
      jsonResponse({ error: { type: 'too_many_requests', message: 'slow down' } }, 429, {
        'retry-after': '2',
      });
    await type(root, 'a');
    expect(typingCalls).toHaveLength(1);

    await wait(500);
    await type(root, 'ab');
    await wait(1_000);
    await type(root, 'abc');
    await wait(400);
    expect(typingCalls).toHaveLength(1);

    await wait(100); // two seconds after the refusal
    expect(drafts().map((call) => call.text)).toEqual(['a', 'abc']);
    await wait(3_000);
    expect(typingCalls).toHaveLength(2);
    expect(root.querySelector<HTMLButtonElement>('.nx-send')!.disabled).toBe(false);
  });

  it('(j) on a server without the field, previews for a person and not for the AI (FR-MOD-11.8)', async () => {
    gate = undefined;
    answeredBy = 'human';
    const human = await openPanel();
    await type(human, 'merhaba');
    expect(drafts()).toHaveLength(1);
    for (const stop of mounted.splice(0)) stop();
    document.body.replaceChildren();
    typingCalls = [];

    answeredBy = 'ai';
    const ai = await openPanel();
    await type(ai, 'merhaba');
    await wait(2_000);
    expect(typingCalls).toEqual([]);
  });

  it('(k) opens the gate on a hand-over pushed by the system, without waiting for a poll (FR-MOD-11.8)', async () => {
    gate = false;
    rtmUrl = RTM;
    const root = await openPanel();
    const socket = FakeSocket.instances[0]!;
    socket.onopen?.();
    await settle();
    socket.reply('login', { my_profile: { id: 'cust-1', kind: 'customer' } });
    await settle();
    if (socket.sent.some((frame) => frame.action === 'sync')) {
      socket.reply('sync', { chats: [], removed_chat_ids: [], new_chat_ids: [] });
      await settle();
    }
    await type(root, 'bir insan lazım');
    expect(typingCalls).toEqual([]);

    // A person has it now; the visitor is told by the transfer's system line.
    gate = true;
    socket.push('incoming_event', {
      chat_id: 'chat-1',
      event: {
        id: 'thr-1_9',
        text: 'Chat transferred',
        author_type: 'system',
        created_at: '2026-11-07T10:00:00.000Z',
        type: 'system_message',
        attachment_url: null,
      },
    });
    await settle();
    expect(typingCalls).toEqual([
      expect.objectContaining({ is_typing: true, text: 'bir insan lazım' }),
    ]);
  });

  it('(k) opens the gate on a takeover, whose system line the visitor never gets (FR-MOD-11.8)', async () => {
    gate = false;
    rtmUrl = RTM;
    const root = await openPanel();
    const socket = FakeSocket.instances[0]!;
    socket.onopen?.();
    await settle();
    socket.reply('login', { my_profile: { id: 'cust-1', kind: 'customer' } });
    await settle();
    await type(root, 'yapay zeka anlamadı');
    expect(typingCalls).toEqual([]);

    gate = true;
    socket.push('chat_taken_over', { chat_id: 'chat-1', new_assignee_id: 'agent-2' });
    await settle();
    expect(drafts().map((call) => call.text)).toEqual(['yapay zeka anlamadı']);
  });

  it('(l) stops once the server answers that its gate is shut (FR-MOD-11.8)', async () => {
    const root = await openPanel();
    // The AI took the chat back since the last poll; the poll agrees from now on.
    nextTypingAnswer = () => {
      gate = false;
      return jsonResponse({ typing_preview: false });
    };
    await type(root, 'a');
    await settle();
    // The gate shut under a draft: it is taken back, once.
    expect(typingCalls.map((call) => call.is_typing)).toEqual([true, false]);

    for (let i = 0; i < 10; i += 1) {
      await type(root, `a${'b'.repeat(i + 1)}`);
      await wait(1_100);
    }
    expect(typingCalls).toHaveLength(2);

    // Until a poll opens it again: then what is in the box goes, once.
    gate = true;
    await wait(4_000);
    expect(drafts().map((call) => call.text)).toEqual(['a', `a${'b'.repeat(10)}`]);
  });

  it('(m) sends nothing from a hidden tab, and what changed once it is back in view (FR-MOD-11.8)', async () => {
    const root = await openPanel();
    visibility = 'hidden';
    await type(root, 'arka planda');
    await wait(2_000);
    expect(typingCalls).toEqual([]);

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(drafts().map((call) => call.text)).toEqual(['arka planda']);
  });

  it('(n) retracts with keepalive on pagehide, only if a draft went out (FR-MOD-11.8)', async () => {
    const root = await openPanel();
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(typingCalls).toEqual([]);

    await type(root, 'sekmeyi kapatıyorum');
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(clears()).toEqual([expect.objectContaining({ is_typing: false, keepalive: true })]);
    expect(drafts()[0]!.keepalive).toBe(false);
  });

  it('takes its pagehide listener down with the widget (FR-MOD-11.8)', async () => {
    const root = await openPanel();
    await type(root, 'son söz');
    for (const stop of mounted.splice(0)) stop();
    await settle();
    // The teardown itself retracts the draft…
    expect(clears()).toHaveLength(1);
    // …and a later pagehide reaches nothing.
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(typingCalls).toHaveLength(2);
  });

  it('caps the draft at 500 units without splitting an emoji (FR-MOD-11.8)', async () => {
    const root = await openPanel();
    await type(root, `${'a'.repeat(499)}😀tail`);
    expect(drafts()[0]!.text).toBe('a'.repeat(499));
  });
});
