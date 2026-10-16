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
import type { PrechatConfig, WidgetFormField } from '@siyahtus/types';
import { mount } from './widget.js';
import { storageKeys } from './api.js';

interface FetchCall {
  url: string;
  body: unknown;
}

let calls: FetchCall[] = [];
let preChatForm: WidgetFormField[] = [];
/** The brand's built-in form the mint hands over (WG-01); undefined = not sent. */
let prechat: PrechatConfig | undefined;
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
        return jsonResponse({
          token: 'tok',
          customer_id: 'cust-1',
          pre_chat_form: preChatForm,
          ...(prechat ? { prechat } : {}),
        });
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
  prechat = undefined;
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
      window.localStorage.setItem(storageKeys('org-1').customerId, 'cust-1');
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
      window.localStorage.setItem(storageKeys('org-1').customerId, 'cust-1');
      const root = mountWidget('?organization_id=org-1');
      root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();

      await waitFor(() => !root.querySelector<HTMLElement>('.nx-prechat')!.hidden);
    });
  });
});

describe('the brand decides the built-in form (WG-01)', () => {
  const rule = (visible: boolean, required: boolean) => ({ visible, required });
  const allRequired = {
    name: rule(true, true),
    username: rule(true, true),
    email: rule(true, true),
    message: rule(true, true),
  };

  /** The four fixed rows, in form order. */
  const rows = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLElement>('.nx-prechat-card > .nx-field')].filter(
      (row) => !row.closest('.nx-prechat-fields'),
    );

  /** The mint has answered and the first state poll gone out. */
  const connected = () => waitFor(() => calls.some((c) => c.url.endsWith('/customer/chat')));

  it('switched off: the launcher opens the composer, and the first line opens the chat', async () => {
    prechat = { enabled: false, fields: allRequired };
    const root = mountWidget('?organization_id=org-1');
    root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
    await connected();
    await waitFor(() => root.querySelector<HTMLElement>('.nx-prechat')!.hidden);

    expect(root.querySelector<HTMLElement>('.nx-form')!.hidden).toBe(false);
    const input = root.querySelector<HTMLTextAreaElement>('.nx-input')!;
    input.value = 'site açılmıyor';
    submit(root.querySelector('.nx-form')!);
    await waitFor(() => sentMessage() !== undefined);
    expect(sentMessage()).toMatchObject({ text: 'site açılmıyor' });
    expect(sentMessage()).not.toHaveProperty('username');
  });

  it('switched off, custom questions are not asked either', async () => {
    prechat = { enabled: false, fields: allRequired };
    preChatForm = [{ definition_id: 'f1', label: 'Account id', type: 'text', required: true }];
    const root = mountWidget('?organization_id=org-1');
    openPreChat(root);
    await connected();
    await waitFor(() => root.querySelector<HTMLElement>('.nx-prechat')!.hidden);
    expect(root.querySelector<HTMLElement>('.nx-form')!.hidden).toBe(false);
  });

  it('an optional username may be left empty, and is then not sent', async () => {
    prechat = { enabled: true, fields: { ...allRequired, username: rule(true, false) } };
    const root = mountWidget('?organization_id=org-1');
    openPreChat(root);
    await connected();

    const username = rows(root)[1]!;
    expect(username.querySelector<HTMLElement>('.nx-field-required')!.hidden).toBe(true);
    expect(username.querySelector<HTMLInputElement>('input')!.required).toBe(false);

    fillFixedFields(root, { username: '' });
    submit(root.querySelector('.nx-prechat')!);
    await waitFor(() => sentMessage() !== undefined);
    expect(sentMessage()).toMatchObject({ name: 'Jo Doe', email: 'jo@example.com', text: 'hi' });
    expect(sentMessage()).not.toHaveProperty('username');
  });

  it('a hidden field leaves the form and is never sent', async () => {
    prechat = { enabled: true, fields: { ...allRequired, username: rule(false, false) } };
    const root = mountWidget('?organization_id=org-1');
    openPreChat(root);
    await connected();

    expect(rows(root).map((row) => row.hidden)).toEqual([false, true, false, false]);
    // Even a value a script slipped into the hidden input stays home.
    fillFixedFields(root, { username: 'ghost' });
    submit(root.querySelector('.nx-prechat')!);
    await waitFor(() => sentMessage() !== undefined);
    expect(sentMessage()).not.toHaveProperty('username');
  });

  it('without the message field, the composer’s first line opens the chat with the details', async () => {
    prechat = { enabled: true, fields: { ...allRequired, message: rule(false, false) } };
    const root = mountWidget('?organization_id=org-1');
    openPreChat(root);
    await connected();
    fillFixedFields(root);
    submit(root.querySelector('.nx-prechat')!);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The form is done, nothing sent yet: the composer is where the visitor writes.
    expect(root.querySelector<HTMLElement>('.nx-prechat')!.hidden).toBe(true);
    expect(sentMessage()).toBeUndefined();

    root.querySelector<HTMLTextAreaElement>('.nx-input')!.value = 'para çekimim gelmedi';
    submit(root.querySelector('.nx-form')!);
    await waitFor(() => sentMessage() !== undefined);
    expect(sentMessage()).toMatchObject({
      text: 'para çekimim gelmedi',
      name: 'Jo Doe',
      username: 'jodoe',
      email: 'jo@example.com',
    });
  });

  it('every field hidden and no custom questions is no form at all', async () => {
    prechat = {
      enabled: true,
      fields: {
        name: rule(false, false),
        username: rule(false, false),
        email: rule(false, false),
        message: rule(false, false),
      },
    };
    const root = mountWidget('?organization_id=org-1');
    openPreChat(root);
    await connected();
    await waitFor(() => root.querySelector<HTMLElement>('.nx-prechat')!.hidden);
    expect(root.querySelector<HTMLElement>('.nx-form')!.hidden).toBe(false);
  });

  it('a mint without the setting keeps today’s form, all four required', async () => {
    const root = mountWidget('?organization_id=org-1');
    openPreChat(root);
    await connected();
    expect(rows(root).every((row) => !row.hidden)).toBe(true);
    fillFixedFields(root, { username: '' });
    submit(root.querySelector('.nx-prechat')!);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sentMessage()).toBeUndefined();
  });
});
