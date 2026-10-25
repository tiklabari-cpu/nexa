/**
 * Which language the widget opens in (WG-02, NFR-I18N1).
 *
 * The order is snippet → panel → browser → the panel's fallback. The panel's
 * half rides the token mint, so the widget draws once with what it knows and
 * redraws at most once when the mint names another language. These pin each
 * rung, the redraw (and that it keeps what the visitor typed), the direction,
 * and that the language on screen travels with the visitor's message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

/** Every widget this file mounts, taken down after each test (`mount` returns its teardown). */
const mounted: Array<() => void> = [];

interface Minted {
  language?: string;
  fallback_language?: string;
}

let minted: Minted | undefined;
let sent: Array<Record<string, unknown>> = [];
let posted: Array<Record<string, unknown>> = [];

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response;
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/customer/chat/events')) {
        sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return jsonResponse({ chat_id: 'chat-1', event: null });
      }
      if (url.includes('/customer/token')) {
        return jsonResponse({
          token: 'tok',
          customer_id: 'cust-1',
          ...(minted
            ? {
                widget: {
                  primary_color: '#2d67fa',
                  position: 'bottom-right',
                  theme: 'light',
                  mobile_fullscreen: true,
                  powered_by: true,
                  welcome_title: null,
                  welcome_text: null,
                  ...minted,
                },
              }
            : {}),
        });
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

function browserSpeaks(...languages: string[]): void {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages);
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(languages[0] ?? '');
}

function mountWidget(search = ''): HTMLElement {
  window.history.replaceState(
    {},
    '',
    `/widget.html?organization_id=org-1&api=https://api.test/v1${search}`,
  );
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mounted.push(mount(document, window));
  return root;
}

/** Opening the panel is what mints; resolve once the mint's redraw has run. */
async function openAndMint(root: HTMLElement): Promise<void> {
  root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
  await waitFor(() => (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length >= 2);
  await new Promise((resolve) => setTimeout(resolve, 20));
}

async function waitFor(predicate: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('waitFor timed out');
}

const launcherText = (): string => document.querySelector('.nx-launcher')?.textContent ?? '';

beforeEach(() => {
  minted = undefined;
  sent = [];
  posted = [];
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('lang');
  window.sessionStorage.clear();
  window.localStorage.clear();
  stubFetch();
  window.addEventListener('message', onMessage);
  // The iframe posts to its parent; in jsdom that is the window itself.
  vi.spyOn(window, 'parent', 'get').mockReturnValue(window);
});

function onMessage(event: MessageEvent): void {
  if (event.data && typeof event.data === 'object') posted.push(event.data);
}

afterEach(() => {
  for (const stop of mounted.splice(0)) stop();
  window.removeEventListener('message', onMessage);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('widget language (WG-02 · NFR-I18N1)', () => {
  it('opens in Turkish for a tr-TR browser with no snippet language and the panel on auto', async () => {
    browserSpeaks('tr-TR', 'en');
    minted = { language: 'auto', fallback_language: 'en' };
    const root = mountWidget();

    // First draw, before any mint: already the final answer.
    expect(launcherText()).toBe('Sohbet');
    expect(document.documentElement.lang).toBe('tr');
    const launcher = document.querySelector('.nx-launcher');

    await openAndMint(root);

    expect(launcherText()).toBe('Sohbet');
    expect(document.documentElement.lang).toBe('tr');
    // Nothing was redrawn: the common case costs the visitor no flash.
    expect(document.querySelector('.nx-launcher')).toBe(launcher);
  });

  it('takes the first browser language it ships, not just the first one', async () => {
    browserSpeaks('ja-JP', 'de-AT', 'tr');
    mountWidget();
    expect(document.documentElement.lang).toBe('de');
  });

  it('shows the panel language over the browser, redrawing once when the mint says so', async () => {
    browserSpeaks('tr-TR');
    minted = { language: 'en', fallback_language: 'tr' };
    const root = mountWidget();
    expect(launcherText()).toBe('Sohbet');
    const launcher = document.querySelector('.nx-launcher');

    await openAndMint(root);

    expect(launcherText()).toBe('Chat');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    // One redraw: the elements are new, and the stylesheet was not stacked.
    expect(document.querySelector('.nx-launcher')).not.toBe(launcher);
    expect(document.head.querySelectorAll('style')).toHaveLength(1);
    expect(document.querySelectorAll('.nx-launcher')).toHaveLength(1);
  });

  it('lets a language in the snippet beat the panel', async () => {
    browserSpeaks('tr-TR');
    minted = { language: 'en', fallback_language: 'tr' };
    const root = mountWidget('&language=de');
    expect(launcherText()).toBe('Chat');
    expect(document.documentElement.lang).toBe('de');

    await openAndMint(root);

    expect(document.documentElement.lang).toBe('de');
    expect(document.querySelector('.nx-send')?.textContent).toBe('Senden');
  });

  it('ignores a snippet language it does not ship instead of pinning English', async () => {
    browserSpeaks('tr-TR');
    mountWidget('&language=ru');
    expect(document.documentElement.lang).toBe('tr');
  });

  it('uses the panel fallback when the browser speaks none of the eight', async () => {
    browserSpeaks('ja-JP', 'zh-CN');
    minted = { language: 'auto', fallback_language: 'tr' };
    const root = mountWidget();
    // Until the mint the fallback is unknown: English.
    expect(document.documentElement.lang).toBe('en');

    await openAndMint(root);

    expect(launcherText()).toBe('Sohbet');
    expect(document.documentElement.lang).toBe('tr');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('flips to dir="rtl" when the panel picks Arabic, and tells the loader', async () => {
    browserSpeaks('en-US');
    minted = { language: 'ar', fallback_language: 'en' };
    const root = mountWidget();
    expect(document.documentElement.dir).toBe('ltr');

    await openAndMint(root);

    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(posted.filter((m) => m['type'] === 'siyahtus:resize').at(-1)).toMatchObject({
      rtl: true,
    });
  });

  it('keeps what the visitor typed across the redraw', async () => {
    browserSpeaks('tr-TR');
    minted = { language: 'en', fallback_language: 'tr' };
    const root = mountWidget();
    root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
    const early = document.querySelector<HTMLTextAreaElement>('.nx-input');
    expect(early).not.toBeNull();
    early!.value = 'merhaba';

    await waitFor(() => document.documentElement.lang === 'en');

    expect(document.querySelector<HTMLTextAreaElement>('.nx-input')?.value).toBe('merhaba');
    // …and the rebuilt panel still works: its listeners were wired again.
    expect(document.querySelector<HTMLElement>('.nx-panel')?.hidden).toBe(false);
  });

  it('sends the language on screen with the visitor’s first message', async () => {
    browserSpeaks('tr-TR');
    minted = { language: 'auto', fallback_language: 'en' };
    const root = mountWidget();
    root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
    await waitFor(() => (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length >= 2);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const fields = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      '.nx-prechat-card > .nx-field .nx-prechat-input',
    );
    ['Jo Doe', 'jodoe', 'jo@example.com', 'selam'].forEach((value, i) => {
      fields[i]!.value = value;
    });
    root
      .querySelector('.nx-prechat')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => sent.length > 0);
    expect(sent[0]).toMatchObject({ text: 'selam', locale: 'tr' });
  });
});
