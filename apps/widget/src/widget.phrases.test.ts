/**
 * A brand's own widget texts and the queue's estimated wait (tm 344 · WG-05).
 *
 * The mint hands over the brand's texts for the one language the widget will
 * show, picked from the hints the widget sends; the widget reads them before
 * its catalog, only when it settled on that same language. The poll's
 * `estimated_wait` turns the queue line into "about X–Y min"; without it the
 * line is the position alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

const mounted: Array<() => void> = [];

interface Phrases {
  locale: string;
  phrases: Record<string, string>;
}

let phrases: Phrases | undefined;
let panelLanguage = 'auto';
let chat: Record<string, unknown> | null = null;
let online = false;
let mintBodies: Array<Record<string, unknown>> = [];

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response;
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/customer/token')) {
        mintBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return jsonResponse({
          token: 'tok',
          customer_id: 'cust-1',
          widget: {
            primary_color: '#2d67fa',
            position: 'bottom-right',
            theme: 'light',
            mobile_fullscreen: true,
            powered_by: true,
            welcome_title: null,
            welcome_text: null,
            language: panelLanguage,
            fallback_language: 'en',
          },
          ...(phrases ? { widget_phrases: phrases } : {}),
        });
      }
      if (url.includes('/customer/chat')) {
        return jsonResponse({
          online,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: null,
          chat,
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

async function waitFor(predicate: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('waitFor timed out');
}

async function openAndMint(root: HTMLElement): Promise<void> {
  root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
  await waitFor(() => (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length >= 2);
  await new Promise((resolve) => setTimeout(resolve, 20));
}

const statusText = (): string => document.querySelector('.nx-status')?.textContent ?? '';
const placeholder = (): string =>
  document.querySelector<HTMLTextAreaElement>('.nx-input')?.placeholder ??
  document.querySelector<HTMLTextAreaElement>('textarea')?.placeholder ??
  '';

beforeEach(() => {
  phrases = undefined;
  panelLanguage = 'auto';
  chat = null;
  online = false;
  mintBodies = [];
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.localStorage.clear();
  stubFetch();
  vi.spyOn(window, 'parent', 'get').mockReturnValue(window);
});

afterEach(() => {
  for (const stop of mounted.splice(0)) stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('brand widget texts (tm 344 · WG-05)', () => {
  it('tells the mint the snippet and browser languages it chooses from', async () => {
    browserSpeaks('tr-TR', 'en');
    const root = mountWidget('&language=tr');
    await openAndMint(root);
    expect(mintBodies[0]).toMatchObject({ language: 'tr', browser_languages: ['tr-TR', 'en'] });
  });

  it('shows the brand’s Turkish offline notice and placeholder in a Turkish widget', async () => {
    browserSpeaks('tr-TR');
    phrases = {
      locale: 'tr',
      phrases: {
        'status.offline': 'Değerli üyemiz, şu an kapalıyız.',
        'input.placeholder': 'Sorunuzu buraya yazın',
      },
    };
    const root = mountWidget();
    await openAndMint(root);

    await waitFor(() => statusText() !== '');
    expect(statusText()).toBe('Değerli üyemiz, şu an kapalıyız.');
    expect(placeholder()).toBe('Sorunuzu buraya yazın');
  });

  it('keeps the shipped text in an English widget when the texts are for another language', async () => {
    browserSpeaks('en-GB');
    // An older server, or a mismatch: texts named for Turkish never reach English.
    phrases = { locale: 'tr', phrases: { 'status.offline': 'Değerli üyemiz, şu an kapalıyız.' } };
    const root = mountWidget();
    await openAndMint(root);

    await waitFor(() => statusText() !== '');
    expect(statusText()).toBe('No one is available right now — leave a message and we will reply.');
    expect(placeholder()).toBe('Type your message…');
  });

  it('redraws in the brand texts when the panel pins the language the texts are for', async () => {
    browserSpeaks('en-GB');
    panelLanguage = 'tr';
    phrases = { locale: 'tr', phrases: { 'input.placeholder': 'Sorunuzu buraya yazın' } };
    const root = mountWidget();
    expect(placeholder()).toBe('Type your message…');
    await openAndMint(root);
    expect(placeholder()).toBe('Sorunuzu buraya yazın');
  });
});

describe('queue line with an estimated wait (tm 344 · WG-05)', () => {
  it('says roughly how long while the server has an estimate', async () => {
    browserSpeaks('tr-TR');
    online = true;
    chat = {
      id: 'chat-1',
      thread_id: 'thr-1',
      queue_position: 3,
      estimated_wait: { min_minutes: 3, max_minutes: 5 },
    };
    const root = mountWidget();
    await openAndMint(root);
    await waitFor(() => statusText() !== '');
    expect(statusText()).toBe('Sırada 3. sıradasınız · yaklaşık 3–5 dk');
  });

  it('shows the position alone without one', async () => {
    browserSpeaks('tr-TR');
    online = true;
    chat = { id: 'chat-1', thread_id: 'thr-1', queue_position: 3, estimated_wait: null };
    const root = mountWidget();
    await openAndMint(root);
    await waitFor(() => statusText() !== '');
    expect(statusText()).toBe('Sırada 3. sıradasınız');
    expect(statusText()).not.toContain('dk');
  });

  it('reads a brand’s own wait line, with the range in its {minutes}', async () => {
    browserSpeaks('tr-TR');
    online = true;
    phrases = {
      locale: 'tr',
      phrases: { 'status.queueWait': 'Değerli üyemiz, sıranız {n}; tahmini {minutes} dakika' },
    };
    chat = {
      id: 'chat-1',
      thread_id: 'thr-1',
      queue_position: 2,
      estimated_wait: { min_minutes: 4, max_minutes: 4 },
    };
    const root = mountWidget();
    await openAndMint(root);
    await waitFor(() => statusText() !== '');
    expect(statusText()).toBe('Değerli üyemiz, sıranız 2; tahmini 4 dakika');
  });
});
