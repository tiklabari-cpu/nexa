/**
 * The inline "leave your e-mail" card (WG-08 · tm 342).
 *
 * While nobody answers, the server writes a system event with
 * `properties.system_event` = `ask_email` and the widget draws it as a card:
 * the server's sentence, an e-mail box and a send button. Sending posts the
 * address once to `/customer/chat/email`; the card then reads as sent — here
 * and on a reload, when the server's `ask_email_answered` event follows it. A
 * wrong address is refused in the card without a request, a failed request
 * keeps the box and says so. The "we will reply here" line (`reply_here`) is a
 * plain notice, no card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

const mounted: Array<() => void> = [];

const API = 'https://api.test/v1';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

interface Event {
  id: string;
  text: string;
  author_type: 'customer' | 'system';
  created_at: string;
  type: 'message' | 'system_message';
  attachment_url: null;
  properties?: Record<string, unknown>;
}

const system = (id: string, systemEvent: string, text: string): Event => ({
  id,
  text,
  author_type: 'system',
  created_at: '2026-10-29T10:03:00.000Z',
  type: 'system_message',
  attachment_url: null,
  properties: { system_event: systemEvent },
});

let events: Event[] = [];
let polls = 0;
let answers: unknown[] = [];
let answerStatus = 204;

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/customer/token')) {
        return jsonResponse({ token: 'tok', customer_id: 'cust-1', pre_chat_form: [] });
      }
      if (url.endsWith('/customer/chat/email')) {
        expect(init?.method).toBe('POST');
        answers.push(JSON.parse(String(init?.body)));
        if (answerStatus >= 400) {
          return jsonResponse({ error: { type: 'internal', message: 'no' } }, answerStatus);
        }
        return { ok: true, status: 204, json: async () => ({}) } as unknown as Response;
      }
      if (url.endsWith('/customer/chat')) {
        polls += 1;
        return jsonResponse({
          online: false,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: null,
          chat: { id: 'chat-1', thread_id: 'thr-1', queue_position: 1 },
          events: [
            {
              id: 'e1',
              text: 'Param yatmadı',
              author_type: 'customer',
              created_at: '2026-10-29T10:00:00.000Z',
              type: 'message',
              attachment_url: null,
            },
            ...events,
          ],
          campaign: null,
          owner: 'queue',
          human_available: false,
          human_button_label: null,
        });
      }
      return jsonResponse({});
    }),
  );
}

async function open(language = 'en'): Promise<HTMLElement> {
  window.history.replaceState(
    {},
    '',
    `/widget.html?organization_id=org-1&api=${API}&language=${language}`,
  );
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mounted.push(mount(document, window));
  root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
  await vi.waitFor(() => expect(polls).toBeGreaterThanOrEqual(1));
  return root;
}

const card = (root: HTMLElement) => root.querySelector<HTMLFormElement>('.nx-askemail');
const box = (root: HTMLElement) => root.querySelector<HTMLInputElement>('.nx-askemail input')!;
const press = (root: HTMLElement) =>
  root.querySelector<HTMLButtonElement>('.nx-askemail-send')!.click();

beforeEach(() => {
  events = [system('e2', 'ask_email', 'Leave your e-mail address and we will write back.')];
  polls = 0;
  answers = [];
  answerStatus = 204;
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.localStorage.clear();
  stubFetch();
});

afterEach(() => {
  for (const stop of mounted.splice(0)) stop();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('the e-mail card (WG-08)', () => {
  it('draws the server sentence with a named e-mail box once', async () => {
    const root = await open();
    await vi.waitFor(() => expect(card(root)).not.toBeNull());
    expect(root.querySelectorAll('.nx-askemail')).toHaveLength(1);
    expect(card(root)!.textContent).toContain('Leave your e-mail address and we will write back.');
    expect(box(root).type).toBe('email');
    expect(box(root).getAttribute('aria-label')).toBe('Your e-mail address');
  });

  it('posts the address once and reads as sent', async () => {
    const root = await open();
    await vi.waitFor(() => expect(card(root)).not.toBeNull());
    box(root).value = '  oyuncu@example.com ';
    press(root);

    await vi.waitFor(() => expect(card(root)!.dataset['answered']).toBe('true'));
    expect(answers).toEqual([{ email: 'oyuncu@example.com' }]);
    expect(card(root)!.querySelector('input')).toBeNull();
    expect(card(root)!.textContent).toContain('Sent');
  });

  it('refuses an address that is not one, without a request', async () => {
    const root = await open();
    await vi.waitFor(() => expect(card(root)).not.toBeNull());
    box(root).value = 'not-an-address';
    press(root);

    const note = root.querySelector<HTMLElement>('.nx-askemail-note')!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe('Enter a valid e-mail address.');
    expect(answers).toEqual([]);
    expect(box(root).getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps the box and says so when the request fails', async () => {
    answerStatus = 500;
    const root = await open();
    await vi.waitFor(() => expect(card(root)).not.toBeNull());
    box(root).value = 'oyuncu@example.com';
    press(root);

    await vi.waitFor(() => {
      expect(root.querySelector<HTMLElement>('.nx-askemail-note')!.hidden).toBe(false);
    });
    expect(root.querySelector('.nx-askemail-note')!.textContent).toBe(
      'Could not send it. Please try again.',
    );
    expect(card(root)!.dataset['answered']).toBeUndefined();
    expect(root.querySelector<HTMLButtonElement>('.nx-askemail-send')!.disabled).toBe(false);
  });

  it('shows an answered card as sent after a reload: the answered event follows it', async () => {
    events = [
      system('e2', 'ask_email', 'Leave your e-mail address and we will write back.'),
      system('e3', 'ask_email_answered', 'We have your e-mail address.'),
    ];
    const root = await open();
    await vi.waitFor(() => expect(card(root)?.dataset['answered']).toBe('true'));
    expect(card(root)!.querySelector('input')).toBeNull();
    expect(root.textContent).toContain('We have your e-mail address.');
  });

  it('draws the "we will reply here" line as a plain notice, no card', async () => {
    events = [system('e2', 'reply_here', 'We will reply to you here.')];
    const root = await open();
    await vi.waitFor(() => expect(root.textContent).toContain('We will reply to you here.'));
    expect(card(root)).toBeNull();
    expect(root.querySelector('.nx-system')!.textContent).toBe('We will reply to you here.');
  });

  it('writes the card labels in the visitor language', async () => {
    const root = await open('tr');
    await vi.waitFor(() => expect(card(root)).not.toBeNull());
    expect(box(root).getAttribute('aria-label')).toBe('E-posta adresiniz');
  });
});
