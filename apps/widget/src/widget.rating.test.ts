/**
 * CSAT rating (FR-MOD-07.8-b / FR-MOD-08.7.7 / FR-MOD-11.4).
 *
 * Two ways the prompt reaches the visitor: automatically, once the widget's
 * poll (`refresh`, every `POLL_INTERVAL_MS`) discovers the one active chat is
 * gone — an agent archived it or the idle-timeout swept it, and the widget
 * holds no socket to be told directly — and manually, from the header "⋮"
 * menu's "Rate this chat" item while a conversation is still open. Both paths
 * end at the same `POST /customer/chat/rating` (`api.ts#rate`), which the
 * server accepts for the visitor's most recent chat whether it is active or
 * not, and never rejects a second vote (`routes/customer.ts` inserts a fresh
 * row every time) — so the UI does not block a changed mind either.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

const API = 'https://api.test/v1';

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const OPEN_EVENT = {
  id: 'evt-1',
  text: 'Hi, my order is late',
  author_type: 'customer' as const,
  created_at: '2026-01-01T00:00:00.000Z',
  type: 'message',
  attachment_url: null,
};

let calls: FetchCall[] = [];
/** How many `GET /customer/chat` calls the mock has answered so far. */
let chatPolls = 0;
/** Overridable per test: what the Nth (1-based) `GET /customer/chat` returns. */
let chatStateAt: (poll: number) => { chat: unknown; events: unknown[] } = () => ({
  chat: { id: 'chat-1', thread_id: 'thr-1', queue_position: null },
  events: [OPEN_EVENT],
});

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });

      if (url.includes('/customer/token')) {
        return jsonResponse({ token: 'tok', customer_id: 'cust-1', pre_chat_form: [] });
      }
      if (url.includes('/customer/chat/rating')) {
        return jsonResponse(
          { id: `rating-${calls.length}`, value: body.value, chat_id: 'chat-1' },
          201,
        );
      }
      // Exact match only — `/customer/chat/events` etc. also contain this
      // substring, so an `includes` check here would misroute them.
      if (url.endsWith('/customer/chat')) {
        chatPolls += 1;
        const { chat, events } = chatStateAt(chatPolls);
        return jsonResponse({
          online: true,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: null,
          chat,
          events,
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

function openPanel(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
}

function ratingCalls(): FetchCall[] {
  return calls.filter((c) => c.url.includes('/customer/chat/rating'));
}

beforeEach(() => {
  calls = [];
  chatPolls = 0;
  chatStateAt = () => ({
    chat: { id: 'chat-1', thread_id: 'thr-1', queue_position: null },
    events: [OPEN_EVENT],
  });
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.localStorage.clear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
});

describe('widget rating — automatic prompt on close (FR-MOD-07.8-b)', () => {
  it('shows the prompt once the poll finds the chat gone, posts the vote, and thanks the visitor', async () => {
    // First poll (inside `connect`): an active chat. Every poll after: closed —
    // simulates an agent archiving it, or the idle-timeout sweep, mid-session.
    chatStateAt = (poll) =>
      poll === 1
        ? { chat: { id: 'chat-1', thread_id: 'thr-1', queue_position: null }, events: [OPEN_EVENT] }
        : { chat: null, events: [] };

    vi.useFakeTimers();
    const root = mountWidget();
    openPanel(root);
    await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(1));

    expect(root.querySelector<HTMLElement>('.nx-rating')!.hidden).toBe(true);

    // Advance past the widget's own poll interval to trigger the discovery.
    await vi.advanceTimersByTimeAsync(4_000);
    await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(2));

    const rating = root.querySelector<HTMLElement>('.nx-rating')!;
    expect(rating.hidden).toBe(false);
    // a11y: a named group, not just two bare buttons (07.8-b KK).
    expect(rating.getAttribute('role')).toBe('group');
    expect(rating.getAttribute('aria-label')).toBeTruthy();
    expect(root.querySelector<HTMLElement>('.nx-rating-prompt')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.nx-rating-thanks')!.hidden).toBe(true);

    // Text-labeled, not emoji-only.
    const good = root.querySelector<HTMLButtonElement>('.nx-rating-good')!;
    const bad = root.querySelector<HTMLButtonElement>('.nx-rating-bad')!;
    expect(good.textContent).toMatch(/[a-zA-Z]/);
    expect(bad.textContent).toMatch(/[a-zA-Z]/);

    good.click();
    await vi.waitFor(() => expect(ratingCalls()).toHaveLength(1));
    expect(ratingCalls()[0]!.body).toEqual({ value: 'good' });

    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-rating-thanks')!.hidden).toBe(false),
    );
    expect(root.querySelector<HTMLElement>('.nx-rating-prompt')!.hidden).toBe(true);
    expect(good.getAttribute('aria-pressed')).toBe('true');
  });

  it('lets the visitor change their vote — the server neither blocks nor dedupes a second one', async () => {
    chatStateAt = (poll) =>
      poll === 1
        ? { chat: { id: 'chat-1', thread_id: 'thr-1', queue_position: null }, events: [OPEN_EVENT] }
        : { chat: null, events: [] };

    vi.useFakeTimers();
    const root = mountWidget();
    openPanel(root);
    await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(1));
    await vi.advanceTimersByTimeAsync(4_000);
    await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(2));

    const good = root.querySelector<HTMLButtonElement>('.nx-rating-good')!;
    const bad = root.querySelector<HTMLButtonElement>('.nx-rating-bad')!;

    good.click();
    await vi.waitFor(() => expect(ratingCalls()).toHaveLength(1));
    // Let the first vote's round trip fully settle (`ratingSubmitting` back to
    // false) before firing the second — otherwise the in-flight guard in
    // `vote()` silently drops a click that lands mid-request.
    await vi.waitFor(() => expect(good.getAttribute('aria-pressed')).toBe('true'));

    bad.click();
    await vi.waitFor(() => expect(bad.getAttribute('aria-pressed')).toBe('true'));
    expect(ratingCalls().map((c) => c.body)).toEqual([{ value: 'good' }, { value: 'bad' }]);

    expect(good.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector<HTMLElement>('.nx-rating-thanks')!.hidden).toBe(false);
  });

  it('dismissing the prompt hides it without voting', async () => {
    chatStateAt = (poll) =>
      poll === 1
        ? { chat: { id: 'chat-1', thread_id: 'thr-1', queue_position: null }, events: [OPEN_EVENT] }
        : { chat: null, events: [] };

    vi.useFakeTimers();
    const root = mountWidget();
    openPanel(root);
    await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(1));
    await vi.advanceTimersByTimeAsync(4_000);
    await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(2));

    expect(root.querySelector<HTMLElement>('.nx-rating')!.hidden).toBe(false);
    root.querySelector<HTMLButtonElement>('.nx-rating-dismiss')!.click();
    expect(root.querySelector<HTMLElement>('.nx-rating')!.hidden).toBe(true);
    expect(ratingCalls()).toHaveLength(0);
  });
});

describe('widget rating — early vote from the header menu (FR-MOD-07.8-b)', () => {
  it('is reachable mid-conversation, and posts the same request the auto-prompt would', async () => {
    const root = mountWidget();
    openPanel(root);
    await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(1));

    const menuButton = root.querySelector<HTMLButtonElement>('.nx-menu-btn')!;
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-menu-wrap')!.hidden).toBe(false),
    );
    expect(root.querySelector<HTMLElement>('.nx-rating')!.hidden).toBe(true);

    menuButton.click();
    expect(root.querySelector<HTMLElement>('.nx-menu')!.hidden).toBe(false);
    root.querySelector<HTMLButtonElement>('.nx-menu-rate')!.click();

    expect(root.querySelector<HTMLElement>('.nx-menu')!.hidden).toBe(true);
    const rating = root.querySelector<HTMLElement>('.nx-rating')!;
    expect(rating.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.nx-rating-prompt')!.hidden).toBe(false);

    root.querySelector<HTMLButtonElement>('.nx-rating-good')!.click();
    await vi.waitFor(() => expect(ratingCalls()).toHaveLength(1));
    expect(ratingCalls()[0]!.body).toEqual({ value: 'good' });
  });

  it('the menu is hidden before any conversation exists', () => {
    const root = mountWidget();
    openPanel(root);
    expect(root.querySelector<HTMLElement>('.nx-menu-wrap')!.hidden).toBe(true);
  });

  it('closes on an outside click without voting', async () => {
    const root = mountWidget();
    openPanel(root);
    await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(1));

    root.querySelector<HTMLButtonElement>('.nx-menu-btn')!.click();
    expect(root.querySelector<HTMLElement>('.nx-menu')!.hidden).toBe(false);

    document.body.click();
    expect(root.querySelector<HTMLElement>('.nx-menu')!.hidden).toBe(true);
  });
});
