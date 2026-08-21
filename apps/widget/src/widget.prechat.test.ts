/**
 * The configurable pre-chat form (FR-MOD-08.7.7). A workspace's fields ride the
 * token mint to the widget; the widget renders one input per field, and the
 * answers ride the visitor's first message. These pin both halves — that the
 * fields are shown ("widget'ta gösterim") and that what the visitor types is
 * sent along to be written to the contact.
 *
 * The fixed name/email pre-chat form (FR-MOD-11.2) is a separate feature the
 * widget always shows; the last test guards that a workspace with no form
 * builder configured still gets exactly that, unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetFormField } from '@nexa/types';
import { mount } from './widget.js';

interface FetchCall {
  url: string;
  body: unknown;
}

let calls: FetchCall[] = [];
let preChatForm: WidgetFormField[] = [];

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as unknown as Response;
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });

      // Order matters: the events URL also contains "/customer/chat".
      if (url.includes('/customer/chat/events')) {
        return jsonResponse({ chat_id: 'chat-1', event: null });
      }
      if (url.includes('/customer/token')) {
        return jsonResponse({ token: 'tok', customer_id: 'cust-1', pre_chat_form: preChatForm });
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

function mountWidget(search: string): HTMLElement {
  window.history.replaceState({}, '', `/widget.html${search}`);
  const root = document.createElement('div');
  root.id = 'nexa-widget-root';
  document.body.append(root);
  mount(document, window);
  return root;
}

/** "Let's chat" opens the panel straight into the pre-chat form. */
function openPreChat(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>('.nx-greet-chat')!.click();
}

function submit(form: Element): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

async function waitFor(predicate: () => boolean, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('waitFor timed out');
}

beforeEach(() => {
  calls = [];
  preChatForm = [];
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('widget pre-chat form (FR-MOD-08.7.7)', () => {
  it('renders the workspace fields the token minted', async () => {
    preChatForm = [
      { definition_id: 'f1', label: 'Account id', type: 'text', required: false },
      { definition_id: 'f2', label: 'VIP', type: 'boolean', required: false },
    ];
    const root = mountWidget('?organization_id=org-1');
    openPreChat(root);

    await waitFor(() => root.querySelector('[data-def-id="f1"]') !== null);
    const text = root.querySelector<HTMLInputElement>('[data-def-id="f1"]')!;
    expect(text.placeholder).toBe('Account id');
    const check = root.querySelector<HTMLInputElement>('[data-def-id="f2"]')!;
    expect(check.type).toBe('checkbox');
  });

  it('sends the answers along with the first message', async () => {
    preChatForm = [{ definition_id: 'f1', label: 'Account id', type: 'text', required: false }];
    const root = mountWidget('?organization_id=org-1');
    openPreChat(root);
    await waitFor(() => root.querySelector('[data-def-id="f1"]') !== null);

    // Name is required by the fixed form; fill it and the custom field, then
    // submit the pre-chat form and send the first message.
    root.querySelectorAll<HTMLInputElement>('.nx-prechat-input')[0]!.value = 'Jo';
    root.querySelector<HTMLInputElement>('[data-def-id="f1"]')!.value = 'ACC-9';
    submit(root.querySelector('.nx-prechat')!);

    root.querySelector<HTMLTextAreaElement>('.nx-input')!.value = 'my order is late';
    submit(root.querySelector('.nx-form')!);

    await waitFor(() => calls.some((c) => c.url.includes('/customer/chat/events')));
    const sent = calls.find((c) => c.url.includes('/customer/chat/events'))!;
    expect(sent.body).toMatchObject({
      text: 'my order is late',
      custom_fields: { f1: 'ACC-9' },
    });
  });

  it('blocks the pre-chat form while a required field is empty', async () => {
    preChatForm = [{ definition_id: 'f1', label: 'Account id', type: 'text', required: true }];
    const root = mountWidget('?organization_id=org-1');
    openPreChat(root);
    await waitFor(() => root.querySelector('[data-def-id="f1"]') !== null);

    // Name filled, required custom field left blank: submit must not advance to
    // the composer, so no message can be sent without the answer.
    root.querySelectorAll<HTMLInputElement>('.nx-prechat-input')[0]!.value = 'Jo';
    submit(root.querySelector('.nx-prechat')!);

    expect(root.querySelector<HTMLElement>('.nx-prechat')!.hidden).toBe(false);
  });

  it('leaves the fixed form untouched when no fields are configured', async () => {
    preChatForm = [];
    const root = mountWidget('?organization_id=org-1');
    openPreChat(root);
    // Give connect a chance to (not) add anything.
    await waitFor(() => calls.some((c) => c.url.includes('/customer/chat')));

    expect(root.querySelector('[data-def-id]')).toBeNull();
    // The fixed name field is still there (FR-MOD-11.2).
    expect(root.querySelector('.nx-prechat-input')).not.toBeNull();
  });
});
