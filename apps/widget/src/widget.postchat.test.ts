/**
 * Post-chat form (FR-MOD-08.7.7, the "post" half of "Forms builder
 * (pre/post-chat)"): the workspace's questions arrive with the token mint as
 * `post_chat_form`, are held until the conversation ends, and are then shown
 * above 134.1's CSAT prompt on the same closing screen. Answers go to
 * `POST /customer/chat/form-response` and land on the contact.
 *
 * The trigger is `noteChatClosed` — the same one the rating and the "chat
 * ended" banner ride — so the form appears whether the visitor ended the chat
 * themselves (134.2's "End chat") or the poll noticed an agent archived it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetFormField } from '@nexa/types';
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
/** What the mint reports as the workspace's post-chat form. */
let postChatForm: WidgetFormField[] = [];
/** Flips once the chat is closed, so the next poll sees no chat. */
let closed = false;
/** The live chat's id — a message sent after a close opens a different one. */
let chatId = 'chat-1';
/** `/customer/chat/form-response` responds with this — 400 exercises the failure path. */
let formStatus = 204;

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });

      if (url.includes('/customer/token')) {
        return jsonResponse({
          token: 'tok',
          customer_id: 'cust-1',
          pre_chat_form: [],
          post_chat_form: postChatForm,
        });
      }
      if (url.includes('/customer/chat/form-response')) {
        return jsonResponse(formStatus < 300 ? {} : { error: { message: 'nope' } }, formStatus);
      }
      if (url.includes('/customer/chat/close')) {
        closed = true;
        return jsonResponse({}, 204);
      }
      if (url.includes('/customer/chat/events')) {
        // A message with no active chat opens a fresh one, with a fresh id.
        if (closed) chatId = 'chat-2';
        closed = false;
        return jsonResponse({ chat_id: chatId, event: null });
      }
      if (url.endsWith('/customer/chat')) {
        return jsonResponse({
          online: true,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: null,
          chat: closed ? null : { id: chatId, thread_id: 'thr-1', queue_position: null },
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

/** Header "⋮" → "End chat" → confirm: the shortest route to a closed chat. */
async function endChat(root: HTMLElement): Promise<void> {
  await vi.waitFor(() =>
    expect(root.querySelector<HTMLElement>('.nx-menu-wrap')!.hidden).toBe(false),
  );
  root.querySelector<HTMLButtonElement>('.nx-menu-btn')!.click();
  root.querySelector<HTMLButtonElement>('.nx-menu-end')!.click();
  root.querySelector<HTMLButtonElement>('.nx-end-confirm-confirm')!.click();
  await vi.waitFor(() => expect(root.querySelector<HTMLElement>('.nx-closed')!.hidden).toBe(false));
}

function formCalls(): FetchCall[] {
  return calls.filter((c) => c.url.includes('/customer/chat/form-response'));
}

beforeEach(() => {
  calls = [];
  closed = false;
  chatId = 'chat-1';
  formStatus = 204;
  postChatForm = [
    { definition_id: 'f-order', label: 'Order number', type: 'text', required: true },
    { definition_id: 'f-again', label: 'Would you shop again?', type: 'boolean', required: false },
  ];
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

describe('widget post-chat form (FR-MOD-08.7.7)', () => {
  it('stays hidden while the conversation is open', async () => {
    const root = mountWidget();
    openPanel(root);
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-menu-wrap')!.hidden).toBe(false),
    );

    expect(root.querySelector<HTMLElement>('.nx-postchat')!.hidden).toBe(true);
    expect(formCalls()).toHaveLength(0);
  });

  it('appears on close with one input per configured field, above the rating prompt', async () => {
    const root = mountWidget();
    openPanel(root);
    await endChat(root);

    const form = root.querySelector<HTMLElement>('.nx-postchat')!;
    expect(form.hidden).toBe(false);

    const inputs = form.querySelectorAll<HTMLInputElement>('input[data-def-id]');
    expect(Array.from(inputs).map((el) => el.dataset['defId'])).toEqual(['f-order', 'f-again']);
    // The required text field is marked as such, and the boolean is a checkbox.
    expect(inputs[0]!.required).toBe(true);
    expect(inputs[0]!.getAttribute('aria-label')).toBe('Order number');
    expect(inputs[1]!.type).toBe('checkbox');

    // 134.1's CSAT prompt is on the same screen, and *below* the form: the
    // workspace's own questions come first.
    const rating = root.querySelector<HTMLElement>('.nx-rating')!;
    expect(rating.hidden).toBe(false);
    expect(form.compareDocumentPosition(rating) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('submits the answers and swaps the inputs for a thank-you', async () => {
    const root = mountWidget();
    openPanel(root);
    await endChat(root);

    const form = root.querySelector<HTMLFormElement>('.nx-postchat')!;
    const order = form.querySelector<HTMLInputElement>('input[data-def-id="f-order"]')!;
    order.value = 'ORD-42';
    form.querySelector<HTMLInputElement>('input[data-def-id="f-again"]')!.checked = true;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(formCalls()).toHaveLength(1));
    expect(formCalls()[0]!.method).toBe('POST');
    expect(formCalls()[0]!.body).toEqual({
      custom_fields: { 'f-order': 'ORD-42', 'f-again': 'true' },
    });

    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-postchat-thanks')!.hidden).toBe(false),
    );
    // The questions are gone once answered — nothing left to submit twice.
    expect(root.querySelector<HTMLElement>('.nx-postchat-intro')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.nx-postchat-submit')!.hidden).toBe(true);
  });

  it('refuses to send while a required answer is blank', async () => {
    const root = mountWidget();
    openPanel(root);
    await endChat(root);

    const form = root.querySelector<HTMLFormElement>('.nx-postchat')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(formCalls()).toHaveLength(0);
    // The visitor is taken to the field that is missing.
    expect(document.activeElement).toBe(
      form.querySelector<HTMLInputElement>('input[data-def-id="f-order"]'),
    );
    expect(root.querySelector<HTMLElement>('.nx-postchat-thanks')!.hidden).toBe(true);
  });

  it('a rejected submit surfaces an error and keeps the answers on screen', async () => {
    formStatus = 400;
    const root = mountWidget();
    openPanel(root);
    await endChat(root);

    const form = root.querySelector<HTMLFormElement>('.nx-postchat')!;
    const order = form.querySelector<HTMLInputElement>('input[data-def-id="f-order"]')!;
    order.value = 'ORD-42';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-postchat-error')!.hidden).toBe(false),
    );
    expect(root.querySelector<HTMLElement>('.nx-postchat-thanks')!.hidden).toBe(true);
    // Still answerable — the typed value was not thrown away.
    expect(root.querySelector<HTMLElement>('.nx-postchat-submit')!.hidden).toBe(false);
    expect(order.value).toBe('ORD-42');
  });

  it('does not appear at all when the workspace configures no post-chat fields', async () => {
    postChatForm = [];
    const root = mountWidget();
    openPanel(root);
    await endChat(root);

    // The closing screen is exactly 134.1/134.2's: banner + rating, no form.
    expect(root.querySelector<HTMLElement>('.nx-postchat')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.nx-rating')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.nx-closed')!.hidden).toBe(false);
  });

  it('clears once a new conversation starts', async () => {
    const root = mountWidget();
    openPanel(root);
    await endChat(root);
    expect(root.querySelector<HTMLElement>('.nx-postchat')!.hidden).toBe(false);

    root.querySelector<HTMLButtonElement>('.nx-closed-restart')!.click();
    const input = root.querySelector<HTMLTextAreaElement>('.nx-input')!;
    input.value = 'Hello again';
    root
      .querySelector<HTMLFormElement>('.nx-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // `send` refreshes, which sees a live chat and drops the previous chat's
    // questions — leaving them over a new conversation would be nonsense.
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-postchat')!.hidden).toBe(true),
    );
  });
});
