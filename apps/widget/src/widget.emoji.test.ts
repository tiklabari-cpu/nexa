/**
 * The composer's emoji picker (FR-MOD-11.4) — the widget's own version of
 * `apps/web`'s composer tool (tm 189.5), not shared with it (see `emoji.ts`).
 *
 * The KK's other three composer promises — live delivery, the file-sharing
 * rule, the empty-message guard — were already met and tested; this file
 * closes the fourth ("message + attach + emoji + send"): there was no
 * picker in `widget.ts` at all before this, a plain textarea relying on the
 * visitor's own OS keyboard.
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

let calls: FetchCall[] = [];

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
      if (url.includes('/customer/chat/events')) {
        return jsonResponse({ chat_id: 'chat-1', event: null });
      }
      // Exact match only — other `/customer/chat...` routes also contain this
      // substring, so an `includes` check here would misroute them.
      if (url.endsWith('/customer/chat')) {
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

function trigger(root: HTMLElement): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>('.nx-emoji-btn')!;
}

function panel(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('.nx-emoji-panel')!;
}

function input(root: HTMLElement): HTMLTextAreaElement {
  return root.querySelector<HTMLTextAreaElement>('.nx-input')!;
}

function glyphButton(root: HTMLElement, glyph: string): HTMLButtonElement {
  const items = root.querySelectorAll<HTMLButtonElement>('.nx-emoji-item');
  return [...items].find((item) => item.dataset.emoji === glyph)!;
}

beforeEach(() => {
  calls = [];
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

describe('widget composer emoji picker (FR-MOD-11.4)', () => {
  it('opens on trigger click, inserts the glyph at the caret with no trailing space, and closes', () => {
    const root = mountWidget();
    openPanel(root);
    const field = input(root);
    field.value = 'Hello !';
    field.setSelectionRange(6, 6);

    expect(panel(root).hidden).toBe(true);
    expect(trigger(root).getAttribute('aria-expanded')).toBe('false');

    trigger(root).click();
    expect(panel(root).hidden).toBe(false);
    expect(trigger(root).getAttribute('aria-expanded')).toBe('true');

    glyphButton(root, '👍').click();

    expect(field.value).toBe('Hello 👍!');
    expect(panel(root).hidden).toBe(true);
    expect(trigger(root).getAttribute('aria-expanded')).toBe('false');
    // Focus returns to the field, caret right after the glyph — ready to type on.
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(8);
  });

  it('chains two glyphs with nothing between them', () => {
    const root = mountWidget();
    openPanel(root);
    const field = input(root);

    trigger(root).click();
    glyphButton(root, '🎉').click();
    trigger(root).click();
    glyphButton(root, '🎉').click();

    expect(field.value).toBe('🎉🎉');
  });

  it('carries an accessible name on the trigger and groups categories for a screen reader', () => {
    const root = mountWidget();

    expect(trigger(root).getAttribute('aria-label')).toBe('Insert emoji');
    expect(trigger(root).getAttribute('aria-haspopup')).toBe('true');

    const groups = panel(root).querySelectorAll('[role="group"]');
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      const labelledBy = group.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      expect(document.getElementById(labelledBy!)).not.toBeNull();
    }
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const root = mountWidget();

    trigger(root).click();
    expect(panel(root).hidden).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(panel(root).hidden).toBe(true);
    expect(trigger(root).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger(root));
  });

  it('closes on a click outside the picker', () => {
    const root = mountWidget();

    trigger(root).click();
    expect(panel(root).hidden).toBe(false);

    root
      .querySelector<HTMLElement>('.nx-transcript')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(panel(root).hidden).toBe(true);
  });

  it('disables the trigger once the chat has ended, alongside attach and send', async () => {
    const root = mountWidget();
    openPanel(root);
    const field = input(root);
    field.value = 'hello';
    root
      .querySelector<HTMLFormElement>('.nx-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    // This stub's `/customer/chat` always answers `chat: null`, so `send`'s
    // own post-send `refresh` immediately finds the chat it just opened gone
    // again and calls `noteChatClosed` — the same "closed" `renderClosed`
    // reacts to whichever way a chat actually ends.
    await vi.waitFor(() => expect(trigger(root).disabled).toBe(true));
    expect(root.querySelector<HTMLButtonElement>('.nx-attach')!.disabled).toBe(true);
  });

  /**
   * `maxLength` only constrains a *typed or pasted* keystroke — it does not
   * constrain the picker's own `.value =` assignment. Without the explicit
   * guard in `insertEmoji`, a click here would silently grow the composer
   * past the server's `z.string().max(10_000)` (`routes/customer.ts`), and
   * the visitor would only learn about it from a rejected send.
   */
  it('refuses an insertion that would cross the 10,000-character limit — same call the server makes', () => {
    const root = mountWidget();
    openPanel(root);
    const field = input(root);
    expect(field.maxLength).toBe(10_000);

    // A 2-code-unit emoji ('😀'.length === 2) would land this at 10,001.
    field.value = 'a'.repeat(9_999);
    field.setSelectionRange(9_999, 9_999);
    trigger(root).click();
    glyphButton(root, '😀').click();
    expect(field.value.length).toBe(9_999);

    // One code unit under that boundary, the same insertion lands exactly at
    // the limit and is allowed — the guard is a boundary, not a ban.
    field.value = 'a'.repeat(9_998);
    field.setSelectionRange(9_998, 9_998);
    trigger(root).click();
    glyphButton(root, '😀').click();
    expect(field.value.length).toBe(10_000);
    expect(field.value.endsWith('😀')).toBe(true);
  });

  it('sends a surrogate-pair emoji through to the server intact', async () => {
    const root = mountWidget();
    openPanel(root);

    trigger(root).click();
    glyphButton(root, '😀').click();
    expect(input(root).value).toBe('😀');

    root
      .querySelector<HTMLFormElement>('.nx-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.includes('/customer/chat/events'))).toBe(true),
    );
    const sendCall = calls.find((c) => c.url.includes('/customer/chat/events'))!;
    expect((sendCall.body as { text: string }).text).toBe('😀');
  });
});
