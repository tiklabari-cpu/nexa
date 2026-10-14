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
import type { WidgetFormField } from '@siyahtus/types';
import { mount } from './widget.js';

interface FetchCall {
  url: string;
  body: unknown;
}

let calls: FetchCall[] = [];
let preChatForm: WidgetFormField[] = [];
/** The transcript `GET /customer/chat` reports — empty for a first visit. */
let chatEvents: unknown[] = [];

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
          chat: chatEvents.length > 0 ? { id: 'chat-0', queue_position: null } : null,
          events: chatEvents,
        });
      }
      return jsonResponse({});
    }),
  );
}

function mountWidget(search: string): HTMLElement {
  window.history.replaceState({}, '', `/widget.html${search}`);
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
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

/** The fixed fields, in the order the form shows them; all four are required. */
function fillFixedFields(
  root: HTMLElement,
  values: { name?: string; username?: string; email?: string; message?: string } = {},
): void {
  const fields = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    '.nx-prechat-card > .nx-field .nx-prechat-input',
  );
  const { name = 'Jo Doe', username = 'jodoe', email = 'jo@example.com', message = 'hi' } = values;
  [name, username, email, message].forEach((value, i) => {
    fields[i]!.value = value;
  });
}

function sentMessage(): Record<string, unknown> | undefined {
  return calls.find((c) => c.url.includes('/customer/chat/events'))?.body as
    Record<string, unknown> | undefined;
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
  chatEvents = [];
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  // See widget.unread.test.ts: a stored customer id auto-connects the mount.
  window.localStorage.clear();
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

    // The fixed fields and the custom one filled: submitting the pre-chat form
    // sends "Your message" as the first message, with everything riding it.
    fillFixedFields(root, { message: 'my order is late' });
    root.querySelector<HTMLInputElement>('[data-def-id="f1"]')!.value = 'ACC-9';
    submit(root.querySelector('.nx-prechat')!);

    await waitFor(() => sentMessage() !== undefined);
    expect(sentMessage()).toMatchObject({
      text: 'my order is late',
      custom_fields: { f1: 'ACC-9' },
    });
  });

  it('blocks the pre-chat form while a required field is empty', async () => {
    preChatForm = [{ definition_id: 'f1', label: 'Account id', type: 'text', required: true }];
    const root = mountWidget('?organization_id=org-1');
    openPreChat(root);
    await waitFor(() => root.querySelector('[data-def-id="f1"]') !== null);

    // Fixed fields filled, required custom field left blank: submit must not
    // advance to the composer, so no message can be sent without the answer.
    fillFixedFields(root);
    submit(root.querySelector('.nx-prechat')!);

    expect(root.querySelector<HTMLElement>('.nx-prechat')!.hidden).toBe(false);
    expect(sentMessage()).toBeUndefined();
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

describe('widget fixed pre-chat fields (owner, 2026-10-14)', () => {
  it('asks name, username, e-mail and message, in that order, all required', () => {
    const root = mountWidget('?organization_id=org-1');
    openPreChat(root);

    const labels = [...root.querySelectorAll('.nx-prechat-card > .nx-field .nx-field-label')].map(
      (label) => label.firstChild?.textContent,
    );
    expect(labels).toEqual(['Full name', 'Username', 'Email', 'Your message']);
    const fields = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      '.nx-prechat-card > .nx-field .nx-prechat-input',
    );
    expect([...fields].every((field) => field.required)).toBe(true);
    expect(fields[2]!.type).toBe('email');
    expect(fields[3]!.tagName).toBe('TEXTAREA');
  });

  it('opens on the launcher too, not only on the greeting', () => {
    const root = mountWidget('?organization_id=org-1');
    root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();

    expect(root.querySelector<HTMLElement>('.nx-prechat')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.nx-form')!.hidden).toBe(true);
  });

  it('sends the message as the first line, with name, username and e-mail riding it', async () => {
    const root = mountWidget('?organization_id=org-1');
    openPreChat(root);
    fillFixedFields(root, {
      name: '  Ayşe Yılmaz ',
      username: 'ayse_y',
      email: 'ayse@example.com',
      message: 'Siparişim gecikti',
    });
    submit(root.querySelector('.nx-prechat')!);

    await waitFor(() => sentMessage() !== undefined);
    expect(sentMessage()).toMatchObject({
      text: 'Siparişim gecikti',
      name: 'Ayşe Yılmaz',
      username: 'ayse_y',
      email: 'ayse@example.com',
    });
    expect(root.querySelector<HTMLElement>('.nx-prechat')!.hidden).toBe(true);
  });

  it.each([
    ['name', { name: ' ' }],
    ['username', { username: '' }],
    ['e-mail', { email: '' }],
    ['a malformed e-mail', { email: 'not-an-email' }],
    ['message', { message: '   ' }],
  ])('sends nothing without %s', async (_what, values) => {
    const root = mountWidget('?organization_id=org-1');
    openPreChat(root);
    await waitFor(() => calls.some((c) => c.url.includes('/customer/chat')));
    fillFixedFields(root, values);
    submit(root.querySelector('.nx-prechat')!);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector<HTMLElement>('.nx-prechat')!.hidden).toBe(false);
    expect(sentMessage()).toBeUndefined();
  });

  describe('a returning visitor', () => {
    it('goes straight to their conversation, never past the form', async () => {
      window.localStorage.setItem('siyahtus.customer_id', 'cust-1');
      chatEvents = [
        {
          id: 'e1',
          type: 'message',
          text: 'earlier question',
          author_type: 'customer',
          created_at: '2026-10-13T10:00:00.000Z',
        },
      ];
      const root = mountWidget('?organization_id=org-1');
      root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();

      // Not even for a frame while the mint is out.
      expect(root.querySelector<HTMLElement>('.nx-prechat')!.hidden).toBe(true);
      await waitFor(
        () => root.querySelector('.nx-transcript')?.textContent?.includes('earlier') ?? false,
      );
      expect(root.querySelector<HTMLElement>('.nx-prechat')!.hidden).toBe(true);
    });

    it('meets the form once the mint finds no conversation', async () => {
      window.localStorage.setItem('siyahtus.customer_id', 'cust-1');
      const root = mountWidget('?organization_id=org-1');
      root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();

      await waitFor(() => !root.querySelector<HTMLElement>('.nx-prechat')!.hidden);
    });
  });
});
