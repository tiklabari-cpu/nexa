/**
 * The widget's "Help" tab (WG-12 · tm 348), mounted.
 *
 * The header's "?" is there only when the mint says the workspace turned the
 * tab on. Opening it loads the tab (its own module) under the header and hides
 * the conversation; a search goes to `/customer/kb/search` with the visitor's
 * token, a result opens the article from `/customer/kb/articles/{slug}`, and
 * "Start a chat" — on the search screen and on the article — takes the visitor
 * to the conversation in one click: the pre-chat form for a first visitor, the
 * composer for one who already has a conversation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

const mounted: Array<() => void> = [];
const API = 'https://api.test/v1';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

let helpEnabled = true;
let conversation = false;
let polls = 0;
let reads: Array<{ url: string; auth: string | null }> = [];

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/customer/launcher'))
        return jsonResponse({ launcher_visibility: 'always' });
      if (url.includes('/customer/token')) {
        return jsonResponse({
          token: 'tok',
          customer_id: 'cust-1',
          pre_chat_form: [],
          widget: {
            primary_color: '#2d67fa',
            position: 'bottom-right',
            theme: 'light',
            mobile_fullscreen: true,
            powered_by: true,
            help_enabled: helpEnabled,
          },
        });
      }
      if (url.includes('/customer/kb/')) {
        reads.push({
          url,
          auth: new Headers(init?.headers).get('authorization'),
        });
        if (url.includes('/customer/kb/search')) {
          const q = new URL(url).searchParams.get('q');
          return jsonResponse({
            items:
              q === 'papara'
                ? [
                    {
                      slug: 'papara-ile-yatirim',
                      title: 'Papara ile yatırım',
                      excerpt: 'Kasiyer sayfasında Papara’yı seçin.',
                    },
                  ]
                : [],
          });
        }
        return jsonResponse({
          slug: 'papara-ile-yatirim',
          title: 'Papara ile yatırım',
          body: '## Adımlar\n\n- **Papara**yı seçin.\n- [Kasiyer](https://casino.example/cashier) sayfası.',
          updated_at: '2026-10-30T10:00:00.000Z',
        });
      }
      if (url.endsWith('/customer/chat')) {
        polls += 1;
        return jsonResponse({
          online: true,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: null,
          chat: conversation ? { id: 'chat-1', thread_id: 'thr-1', queue_position: null } : null,
          events: conversation
            ? [
                {
                  id: 'e1',
                  text: 'Merhaba',
                  author_type: 'customer',
                  created_at: '2026-10-30T10:00:00.000Z',
                  type: 'message',
                  attachment_url: null,
                },
              ]
            : [],
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

async function open(): Promise<HTMLElement> {
  window.history.replaceState({}, '', `/widget.html?organization_id=org-1&api=${API}&language=tr`);
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mounted.push(mount(document, window));
  root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
  await vi.waitFor(() => expect(polls).toBeGreaterThanOrEqual(1));
  return root;
}

const helpButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.nx-help-btn')!;
const tab = (root: HTMLElement) => root.querySelector<HTMLElement>('.nx-help');

async function openTab(root: HTMLElement): Promise<HTMLElement> {
  await vi.waitFor(() => expect(helpButton(root).hidden).toBe(false));
  helpButton(root).click();
  await vi.waitFor(() => expect(tab(root)).not.toBeNull());
  return tab(root)!;
}

async function searchFor(help: HTMLElement, q: string): Promise<void> {
  const input = help.querySelector<HTMLInputElement>('input[type="search"]')!;
  input.value = q;
  help.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
}

beforeEach(() => {
  helpEnabled = true;
  conversation = false;
  polls = 0;
  reads = [];
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

describe('Help tab (WG-12)', () => {
  it('shows no "?" while the workspace has the tab off', async () => {
    helpEnabled = false;
    const root = await open();
    await vi.waitFor(() => expect(root.querySelector('.nx-prechat')).not.toBeNull());
    expect(helpButton(root).hidden).toBe(true);
    expect(helpButton(root).getAttribute('aria-label')).toBe('Yardım');
  });

  it('opens under the header, searches with the token and reads an article', async () => {
    const root = await open();
    const help = await openTab(root);
    const panel = root.querySelector<HTMLElement>('.nx-panel')!;
    expect(panel.classList.contains('nx-help-on')).toBe(true);
    expect(helpButton(root).getAttribute('aria-pressed')).toBe('true');
    expect(help.previousElementSibling?.classList.contains('nx-header')).toBe(true);
    expect(help.querySelector('input')!.placeholder).toBe('Yardım makalelerinde ara');
    expect(document.activeElement).toBe(help.querySelector('input'));

    await searchFor(help, 'papara');
    await vi.waitFor(() => expect(help.querySelectorAll('.nx-help-hit')).toHaveLength(1));
    const search = new URL(reads[0]!.url);
    expect(search.pathname).toBe('/v1/customer/kb/search');
    expect(search.searchParams.get('q')).toBe('papara');
    expect(search.searchParams.get('locale')).toBe('tr');
    expect(reads[0]!.auth).toBe('Bearer tok');

    help.querySelector<HTMLButtonElement>('.nx-help-hit')!.click();
    await vi.waitFor(() =>
      expect(help.querySelector('.nx-help-article h2')?.textContent).toBe('Papara ile yatırım'),
    );
    expect(reads[1]!.url).toBe(`${API}/customer/kb/articles/papara-ile-yatirim`);
    const link = help.querySelector<HTMLAnchorElement>('.nx-help-article a')!;
    expect(link.href).toBe('https://casino.example/cashier');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer nofollow');
    expect(help.querySelector('input')!.closest('form')!.hidden).toBe(true);

    help.querySelector<HTMLButtonElement>('.nx-help-back')!.click();
    expect(help.querySelector<HTMLElement>('.nx-help-article')!.hidden).toBe(true);
    expect(help.querySelectorAll('.nx-help-hit')).toHaveLength(1);
  });

  it('says so when nothing matches, and asks nothing for a single letter', async () => {
    const root = await open();
    const help = await openTab(root);
    await searchFor(help, 'p');
    expect(reads).toHaveLength(0);
    await searchFor(help, 'kripto');
    await vi.waitFor(() =>
      expect(help.querySelector('[role="status"]')!.textContent).toBe(
        'Eşleşen makale yok. Sohbet başlatın, yardımcı olalım.',
      ),
    );
  });

  it('"Start a chat" opens the pre-chat form for a first visitor in one click (FR-MOD-08.7.7)', async () => {
    const root = await open();
    const help = await openTab(root);
    const chat = [...help.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Sohbet başlat',
    )!;
    chat.click();
    expect(tab(root)).toBeNull();
    const panel = root.querySelector<HTMLElement>('.nx-panel')!;
    expect(panel.classList.contains('nx-help-on')).toBe(false);
    expect(helpButton(root).getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector<HTMLFormElement>('.nx-prechat')!.hidden).toBe(false);
  });

  it('"Start a chat" from an article lands on the composer of an open conversation', async () => {
    conversation = true;
    const root = await open();
    const help = await openTab(root);
    await searchFor(help, 'papara');
    await vi.waitFor(() => expect(help.querySelectorAll('.nx-help-hit')).toHaveLength(1));
    help.querySelector<HTMLButtonElement>('.nx-help-hit')!.click();
    await vi.waitFor(() => expect(help.querySelector('.nx-help-article h2')).not.toBeNull());
    help.querySelector<HTMLButtonElement>('.nx-human')!.click();
    expect(tab(root)).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('textarea.nx-input'));
  });

  it('the "?" closes the tab again', async () => {
    const root = await open();
    await openTab(root);
    helpButton(root).click();
    expect(tab(root)).toBeNull();
    expect(root.querySelector<HTMLElement>('.nx-panel')!.classList.contains('nx-help-on')).toBe(
      false,
    );
  });
});
