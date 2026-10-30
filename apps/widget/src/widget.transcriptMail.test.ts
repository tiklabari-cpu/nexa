/**
 * "E-mail me the transcript" (WG-06 · tm 345).
 *
 * K26: a closing chat no longer mails the player; they ask for their copy
 * from the header "⋮" menu while a conversation is open, or from the "Chat
 * ended" banner after it. The dialog offers the address they gave before, an
 * empty box asks for one; sending posts it once to `/customer/chat/transcript`
 * and the dialog reads as sent. A wrong address is refused without a request,
 * a 429 says why, any other failure keeps the box.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

const mounted: Array<() => void> = [];

const API = 'https://api.test/v1';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

let polls = 0;
let requests: unknown[] = [];
let requestStatus = 202;
let knownEmail: string | null = null;
let closed = false;

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/customer/token')) {
        return jsonResponse({ token: 'tok', customer_id: 'cust-1', pre_chat_form: [] });
      }
      if (url.endsWith('/customer/chat/transcript')) {
        expect(init?.method).toBe('POST');
        requests.push(JSON.parse(String(init?.body)));
        if (requestStatus >= 400) {
          return jsonResponse({ error: { type: 'rate_limited', message: 'no' } }, requestStatus);
        }
        return jsonResponse({ accepted: true }, 202);
      }
      if (url.endsWith('/customer/chat/close')) {
        closed = true;
        return jsonResponse({});
      }
      if (url.endsWith('/customer/chat')) {
        polls += 1;
        return jsonResponse({
          online: true,
          agent_typing: false,
          customer: { id: 'cust-1', name: 'Vic', email: knownEmail },
          agent: null,
          chat: closed ? null : { id: 'chat-1', thread_id: 'thr-1', queue_position: null },
          events: closed
            ? []
            : [
                {
                  id: 'e1',
                  text: 'Param yatmadı',
                  author_type: 'customer',
                  created_at: '2026-10-30T10:00:00.000Z',
                  type: 'message',
                  attachment_url: null,
                },
              ],
          campaign: null,
          owner: 'agent',
          human_available: true,
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
  await vi.waitFor(() =>
    expect(root.querySelector<HTMLElement>('.nx-menu-wrap')!.hidden).toBe(false),
  );
  return root;
}

const menuItem = (root: HTMLElement, label: string): HTMLButtonElement =>
  [...root.querySelectorAll<HTMLButtonElement>('.nx-menu [role="menuitem"]')].find(
    (b) => b.textContent === label,
  )!;
const dialog = (root: HTMLElement) =>
  root.querySelector<HTMLFormElement>('form.nx-end-confirm[role="dialog"]')!;
const box = (root: HTMLElement) => dialog(root).querySelector<HTMLInputElement>('input')!;
const send = (root: HTMLElement) =>
  dialog(root).querySelector<HTMLButtonElement>('.nx-end-confirm-confirm')!;
const note = (root: HTMLElement) => dialog(root).querySelector<HTMLElement>('[role="alert"]')!;

async function openDialog(root: HTMLElement, label = 'E-mail me the transcript'): Promise<void> {
  root.querySelector<HTMLButtonElement>('.nx-menu-btn')!.click();
  menuItem(root, label).click();
  await vi.waitFor(() => expect(dialog(root).hidden).toBe(false));
}

beforeEach(() => {
  polls = 0;
  requests = [];
  requestStatus = 202;
  knownEmail = null;
  closed = false;
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

describe('"E-mail me the transcript" (WG-06)', () => {
  it('offers the address the player gave before and sends the copy once', async () => {
    knownEmail = 'vic@example.com';
    const root = await open();
    await openDialog(root);
    expect(dialog(root).textContent).toContain("We'll e-mail you a copy of this conversation.");
    expect(box(root).type).toBe('email');
    expect(box(root).value).toBe('vic@example.com');
    expect(root.querySelector('.nx-menu')!.hasAttribute('hidden')).toBe(true);

    send(root).click();
    await vi.waitFor(() => expect(dialog(root).textContent).toContain('Sent'));
    expect(requests).toEqual([{ email: 'vic@example.com' }]);
    expect(box(root).hidden).toBe(true);
    expect(send(root).hidden).toBe(true);

    const close = dialog(root).querySelector<HTMLButtonElement>('.nx-end-confirm-cancel')!;
    expect(close.textContent).toBe('Close');
    close.click();
    expect(dialog(root).hidden).toBe(true);
  });

  it('asks for an address when none is known, and refuses a wrong one without a request', async () => {
    const root = await open();
    await openDialog(root);
    expect(box(root).value).toBe('');
    send(root).click();
    expect(note(root).hidden).toBe(false);
    expect(note(root).textContent).toBe('Enter a valid e-mail address.');
    expect(requests).toEqual([]);

    box(root).value = ' oyuncu@example.com ';
    send(root).click();
    await vi.waitFor(() => expect(requests).toEqual([{ email: 'oyuncu@example.com' }]));
  });

  it('says the copy was asked for too often on a 429, and keeps the box', async () => {
    requestStatus = 429;
    knownEmail = 'vic@example.com';
    const root = await open();
    await openDialog(root);
    send(root).click();
    await vi.waitFor(() =>
      expect(note(root).textContent).toBe(
        'You have asked for this too often. Please try again later.',
      ),
    );
    expect(box(root).hidden).toBe(false);
    expect(send(root).disabled).toBe(false);
  });

  it('reads in the widget language (WG-02)', async () => {
    const root = await open('tr');
    await openDialog(root, 'Dökümü e-postama gönder');
    expect(dialog(root).textContent).toContain(
      'Bu konuşmanın bir kopyasını e-postanıza gönderelim.',
    );
  });

  it('is offered on the "Chat ended" banner once the conversation closed', async () => {
    knownEmail = 'vic@example.com';
    const root = await open();
    root.querySelector<HTMLButtonElement>('.nx-menu-btn')!.click();
    menuItem(root, 'End chat').click();
    root.querySelector<HTMLButtonElement>('.nx-end-confirm-confirm')!.click();
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-closed')!.hidden).toBe(false),
    );

    const offer = [...root.querySelectorAll<HTMLButtonElement>('.nx-closed button')].find(
      (b) => b.textContent === 'E-mail me the transcript',
    )!;
    offer.click();
    expect(dialog(root).hidden).toBe(false);
    send(root).click();
    await vi.waitFor(() => expect(requests).toEqual([{ email: 'vic@example.com' }]));
  });
});
