/**
 * "End chat" (FR-MOD-11.4-b): the visitor can end their own conversation from
 * the header "⋮" menu, alongside "Rate this chat" (07.8-b). Menu → a focused
 * `role=dialog` confirmation → `POST /customer/chat/close` → the composer
 * swaps for a "chat ended" banner and 134.1's CSAT prompt raises for the chat
 * that just ended, sharing the exact trigger `refresh`'s poll-based detection
 * uses (`noteChatClosed` in `widget.ts`). Cancelling sends nothing.
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
/** Flips once `/customer/chat/close` is called, so the next poll sees no chat. */
let closed = false;
/** `/customer/chat/close` responds with this status; 500 exercises the failure path. */
let closeStatus = 204;

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
      if (url.includes('/customer/chat/close')) {
        if (closeStatus < 300) closed = true;
        return jsonResponse({}, closeStatus);
      }
      if (url.includes('/customer/chat/events')) {
        // A message sent with no active chat opens a fresh one — the widget's
        // one "new message → new chat" path, unchanged by this feature.
        closed = false;
        return jsonResponse({ chat_id: 'chat-2', event: null });
      }
      // Exact match only — other `/customer/chat...` routes also contain this
      // substring, so an `includes` check here would misroute them.
      if (url.endsWith('/customer/chat')) {
        return jsonResponse({
          online: true,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: null,
          chat: closed ? null : { id: 'chat-1', thread_id: 'thr-1', queue_position: null },
          events: closed ? [] : [OPEN_EVENT],
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

function closeCalls(): FetchCall[] {
  return calls.filter((c) => c.url.includes('/customer/chat/close'));
}

/** Header "⋮" → "End chat" — reaches the confirm dialog every test starts from. */
function openEndConfirm(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>('.nx-menu-btn')!.click();
  root.querySelector<HTMLButtonElement>('.nx-menu-end')!.click();
}

beforeEach(() => {
  calls = [];
  closed = false;
  closeStatus = 204;
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.localStorage.clear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('widget "End chat" (FR-MOD-11.4-b)', () => {
  it('menu → focused confirm dialog → request → closed banner + rating prompt, composer disabled', async () => {
    const root = mountWidget();
    openPanel(root);
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-menu-wrap')!.hidden).toBe(false),
    );

    openEndConfirm(root);

    const dialog = root.querySelector<HTMLElement>('.nx-end-confirm')!;
    expect(dialog.hidden).toBe(false);
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-label')).toBeTruthy();
    // a11y: focus lands inside the dialog once it opens.
    expect(dialog.contains(document.activeElement)).toBe(true);

    root.querySelector<HTMLButtonElement>('.nx-end-confirm-confirm')!.click();
    // The dialog closes synchronously on click, before the request settles.
    expect(dialog.hidden).toBe(true);

    // The menu itself is gone — `renderHeader` hides it once `chatId` is null.
    // `endChat` sets that, and every other render below, in the same
    // synchronous block once `api.close()` resolves, so waiting on this one
    // signal is enough to know the rest already ran.
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-menu-wrap')!.hidden).toBe(true),
    );

    expect(closeCalls()).toHaveLength(1);
    expect(closeCalls()[0]!.method).toBe('POST');

    const banner = root.querySelector<HTMLElement>('.nx-closed')!;
    expect(banner.hidden).toBe(false);
    const input = root.querySelector<HTMLTextAreaElement>('.nx-input')!;
    const send = root.querySelector<HTMLButtonElement>('.nx-send')!;
    expect(input.disabled).toBe(true);
    expect(send.disabled).toBe(true);

    // 134.1's CSAT prompt raised for the chat that just ended.
    const rating = root.querySelector<HTMLElement>('.nx-rating')!;
    expect(rating.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.nx-rating-prompt')!.hidden).toBe(false);
  });

  it('cancelling sends no request and leaves the chat open', async () => {
    const root = mountWidget();
    openPanel(root);
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-menu-wrap')!.hidden).toBe(false),
    );

    openEndConfirm(root);
    const dialog = root.querySelector<HTMLElement>('.nx-end-confirm')!;
    expect(dialog.hidden).toBe(false);

    root.querySelector<HTMLButtonElement>('.nx-end-confirm-cancel')!.click();

    expect(dialog.hidden).toBe(true);
    expect(closeCalls()).toHaveLength(0);
    // The chat is untouched — menu (and "End chat" with it) still reachable.
    expect(root.querySelector<HTMLElement>('.nx-menu-wrap')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.nx-closed')!.hidden).toBe(true);
    expect(root.querySelector<HTMLTextAreaElement>('.nx-input')!.disabled).toBe(false);
  });

  it('Escape closes the dialog the same way Cancel does', async () => {
    const root = mountWidget();
    openPanel(root);
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-menu-wrap')!.hidden).toBe(false),
    );

    openEndConfirm(root);
    expect(root.querySelector<HTMLElement>('.nx-end-confirm')!.hidden).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(root.querySelector<HTMLElement>('.nx-end-confirm')!.hidden).toBe(true);
    expect(closeCalls()).toHaveLength(0);
  });

  it('a failed close surfaces an error and leaves the chat open, not "ended"', async () => {
    closeStatus = 500;
    const root = mountWidget();
    openPanel(root);
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-menu-wrap')!.hidden).toBe(false),
    );

    openEndConfirm(root);
    root.querySelector<HTMLButtonElement>('.nx-end-confirm-confirm')!.click();
    // `endChat`'s catch block sets this and nothing else — a signal specific
    // to the failure path, unlike `closeCalls()` which the mock records
    // before the response (and so the catch block) has resolved.
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-status')!.textContent).toBeTruthy(),
    );

    expect(closeCalls()).toHaveLength(1);
    expect(root.querySelector<HTMLElement>('.nx-closed')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.nx-menu-wrap')!.hidden).toBe(false);
  });

  it('"Start a new chat" re-enables the composer, and sending opens a fresh chat — no second path', async () => {
    const root = mountWidget();
    openPanel(root);
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-menu-wrap')!.hidden).toBe(false),
    );

    openEndConfirm(root);
    root.querySelector<HTMLButtonElement>('.nx-end-confirm-confirm')!.click();
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-closed')!.hidden).toBe(false),
    );

    const input = root.querySelector<HTMLTextAreaElement>('.nx-input')!;
    const form = root.querySelector<HTMLFormElement>('.nx-form')!;
    expect(input.disabled).toBe(true);

    root.querySelector<HTMLButtonElement>('.nx-closed-restart')!.click();
    expect(root.querySelector<HTMLElement>('.nx-closed')!.hidden).toBe(true);
    expect(input.disabled).toBe(false);

    input.value = 'Hello again';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // No dedicated "start new chat" endpoint — sending a message with no active
    // chat is the one path `/customer/chat/events` already had, and it lands
    // the widget back in an active-chat state (menu reachable again).
    await vi.waitFor(() =>
      expect(calls.filter((c) => c.url.includes('/customer/chat/events'))).toHaveLength(1),
    );
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-menu-wrap')!.hidden).toBe(false),
    );
    expect(root.querySelector<HTMLElement>('.nx-closed')!.hidden).toBe(true);
  });
});
