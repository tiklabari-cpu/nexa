/**
 * The human check (tm 339.3 · GV-01 3/3).
 *
 * The API answers `403 challenge_required` to a visitor who looks scripted —
 * on the token mint or on the message that opens a conversation. The widget
 * then draws the provider's check in place of the conversation and repeats the
 * request with its token. A normal visitor never sees any of it, and nothing of
 * Cloudflare is loaded until a check is actually asked for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_CAPTCHA_PASS_TOKEN } from '@siyahtus/types';
import { TURNSTILE_SCRIPT_URL } from './challenge.js';
import { CATALOGS } from './locales/index.js';
import { mount } from './widget.js';

/** Every widget this file mounts, taken down after each test (`mount` returns its teardown). */
const mounted: Array<() => void> = [];

const API = 'https://api.test/v1';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response;
}

function challenge(
  reason: string,
  provider: 'mock' | 'turnstile' = 'mock',
  siteKey = provider === 'mock' ? 'mock-site-key' : '0x4AAAA-site',
): Response {
  return jsonResponse(
    {
      error: {
        type: 'challenge_required',
        message: 'Please confirm you are a person.',
        details: { reason, provider, site_key: siteKey },
      },
    },
    403,
  );
}

interface Call {
  path: string;
  body: Record<string, unknown>;
}

interface Harness {
  doc: Document;
  calls: Call[];
  mints: () => Call[];
  sends: () => Call[];
}

interface Routes {
  /** The n-th (0-based) answer to `POST /customer/token`; the default mints. */
  mint?: (call: Call, nth: number) => Response;
  /** The n-th answer to `POST /customer/chat/events`. */
  send?: (call: Call, nth: number) => Response;
}

function setUp(routes: Routes = {}, language = 'en'): Harness {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).slice(API.length);
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      const call = { path, body };
      if (method !== 'GET') calls.push(call);
      if (path === '/customer/token' && method === 'POST') {
        const nth = calls.filter((c) => c.path === path).length - 1;
        return (
          routes.mint?.(call, nth) ??
          jsonResponse({ token: 'nxc1.test-token', customer_id: 'cus_test' })
        );
      }
      if (path === '/customer/chat' && method === 'GET') {
        return jsonResponse({
          online: true,
          customer: { id: 'cus_test', name: null, email: null },
          agent: null,
          chat: { id: 'chat_test', thread_id: 'thr_test', queue_position: null },
          events: [],
        });
      }
      if (path === '/customer/chat/events') {
        const nth = calls.filter((c) => c.path === path).length - 1;
        return routes.send?.(call, nth) ?? jsonResponse({ chat_id: 'chat_test' });
      }
      if (path === '/customer/chat/typing') return jsonResponse(null, 204);
      throw new Error(`unexpected request: ${method} ${path}`);
    }),
  );

  const doc = document.implementation.createHTMLDocument('widget');
  const root = doc.createElement('div');
  root.id = 'siyahtus-widget-root';
  doc.body.append(root);

  window.history.replaceState({}, '', `/?organization_id=org_test&api=${API}&language=${language}`);
  mounted.push(mount(doc, window));
  return {
    doc,
    calls,
    mints: () => calls.filter((c) => c.path === '/customer/token'),
    sends: () => calls.filter((c) => c.path === '/customer/chat/events'),
  };
}

function el<T extends Element>(doc: Document, selector: string): T {
  const found = doc.querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
}

const openLauncher = (h: Harness): void => el<HTMLButtonElement>(h.doc, '.nx-launcher').click();

/** Press Send with `text`, once the panel is open and connected. */
async function submit(h: Harness, text: string): Promise<void> {
  el<HTMLTextAreaElement>(h.doc, '.nx-input').value = text;
  el<HTMLFormElement>(h.doc, '.nx-form').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true }),
  );
}

const boxShown = (h: Harness): boolean => !el<HTMLElement>(h.doc, '.nx-challenge').hidden;
const tick = (h: Harness): void => {
  const box = el<HTMLInputElement>(h.doc, '.nx-challenge-mock input');
  box.checked = true;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const stop of mounted.splice(0)) stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as unknown as { turnstile?: unknown }).turnstile;
});

describe('a visitor nobody doubts', () => {
  it('opens, sends and never meets a check or loads a provider script', async () => {
    const h = setUp();
    openLauncher(h);
    await vi.waitFor(() => expect(h.calls.some((c) => c.path === '/customer/token')).toBe(true));
    await settle();
    await submit(h, 'hello');
    await vi.waitFor(() => expect(h.sends()).toHaveLength(1));

    expect(boxShown(h)).toBe(false);
    expect(h.mints()).toHaveLength(1);
    expect(h.mints()[0]!.body).not.toHaveProperty('challenge_token');
    expect(h.sends()[0]!.body).not.toHaveProperty('challenge_token');
    expect(h.doc.querySelector('script')).toBeNull();
  });
});

describe('a check on the token mint', () => {
  it('draws the box in place of the conversation and repeats the mint with the token', async () => {
    const h = setUp({
      mint: (call) =>
        call.body['challenge_token'] === MOCK_CAPTCHA_PASS_TOKEN
          ? jsonResponse({ token: 'nxc1.test-token', customer_id: 'cus_test' })
          : challenge('new_customers_per_ip'),
    });
    openLauncher(h);
    await vi.waitFor(() => expect(boxShown(h)).toBe(true));

    // The conversation and the composer wait behind it; the title takes focus.
    expect(el<HTMLElement>(h.doc, '.nx-form').hidden).toBe(true);
    expect(el<HTMLElement>(h.doc, '.nx-transcript').hidden).toBe(true);
    expect(el(h.doc, '.nx-challenge-title').textContent).toBe(CATALOGS.en['challenge.title']);
    expect(el(h.doc, '.nx-challenge').getAttribute('aria-labelledby')).toBe(
      el(h.doc, '.nx-challenge-title').id,
    );
    expect(el(h.doc, '.nx-challenge-mock').textContent).toBe(CATALOGS.en['challenge.mock']);
    // The mock draws no frame and loads no script.
    expect(h.doc.querySelector('script, iframe')).toBeNull();

    tick(h);
    await vi.waitFor(() => expect(boxShown(h)).toBe(false));
    expect(h.mints().map((c) => c.body['challenge_token'])).toEqual([
      undefined,
      MOCK_CAPTCHA_PASS_TOKEN,
    ]);
    // A first-time visitor goes on to the pre-chat form, not back to the box.
    expect(el<HTMLElement>(h.doc, '.nx-prechat').hidden).toBe(false);
  });

  it('asks again, saying so, when the provider refused the token', async () => {
    const h = setUp({
      mint: (_call, nth) =>
        nth === 0
          ? challenge('new_customers_per_ip')
          : nth === 1
            ? challenge('challenge_failed')
            : jsonResponse({ token: 'nxc1.test-token', customer_id: 'cus_test' }),
    });
    openLauncher(h);
    await vi.waitFor(() => expect(boxShown(h)).toBe(true));
    expect(el<HTMLElement>(h.doc, '.nx-challenge-notice').hidden).toBe(true);

    tick(h);
    await vi.waitFor(() =>
      expect(el<HTMLElement>(h.doc, '.nx-challenge-notice').hidden).toBe(false),
    );
    expect(el(h.doc, '.nx-challenge-notice').textContent).toBe(CATALOGS.en['challenge.failed']);
    // A fresh box, not the ticked one.
    expect(el<HTMLInputElement>(h.doc, '.nx-challenge-mock input').checked).toBe(false);

    tick(h);
    await vi.waitFor(() => expect(boxShown(h)).toBe(false));
    expect(h.mints()).toHaveLength(3);
  });

  it('gives up after a few refused rounds instead of asking for ever', async () => {
    const h = setUp({ mint: () => challenge('challenge_failed') });
    openLauncher(h);
    // Three boxes, then the fourth refusal is final.
    for (let round = 0; round < 3; round += 1) {
      await vi.waitFor(() => expect(boxShown(h)).toBe(true));
      tick(h);
      await settle();
    }
    await vi.waitFor(() => expect(boxShown(h)).toBe(false));
    await vi.waitFor(() =>
      expect(el(h.doc, '.nx-status').textContent).toBe(CATALOGS.en['error.challenge']),
    );
    expect(h.mints()).toHaveLength(4);
  });
});

describe('a workspace the platform suspended (tm 389.2)', () => {
  const refused = (details?: Record<string, unknown>): Response =>
    jsonResponse(
      {
        error: {
          type: 'not_allowed',
          message: 'This workspace is temporarily suspended.',
          ...(details ? { details } : {}),
        },
      },
      403,
    );

  it('says it is out of service, not "try again shortly", and asks no check', async () => {
    const h = setUp({ mint: () => refused({ reason: 'workspace_suspended' }) }, 'tr');
    openLauncher(h);
    await vi.waitFor(() =>
      expect(el(h.doc, '.nx-status').textContent).toBe(CATALOGS.tr['error.suspended']),
    );
    expect(boxShown(h)).toBe(false);
    expect(h.mints()).toHaveLength(1);
  });

  it('keeps the ordinary outage text for any other refusal', async () => {
    const h = setUp({ mint: () => refused() });
    openLauncher(h);
    await vi.waitFor(() =>
      expect(el(h.doc, '.nx-status').textContent).toBe(CATALOGS.en['error.connect']),
    );
  });

  it('carries the sentence in all eight languages, none left in English', () => {
    for (const [language, catalog] of Object.entries(CATALOGS)) {
      expect(catalog['error.suspended']).toBeTruthy();
      if (language !== 'en')
        expect(catalog['error.suspended']).not.toBe(CATALOGS.en['error.suspended']);
    }
  });
});

describe('a check on the message that opens a conversation', () => {
  it('repeats the same message, with the same key, behind the check', async () => {
    const h = setUp({
      send: (call) =>
        call.body['challenge_token'] === MOCK_CAPTCHA_PASS_TOKEN
          ? jsonResponse({ chat_id: 'chat_test' })
          : challenge('always_on_chat_start'),
    });
    openLauncher(h);
    await vi.waitFor(() => expect(h.mints()).toHaveLength(1));
    await settle();
    await submit(h, 'hello there');
    await vi.waitFor(() => expect(boxShown(h)).toBe(true));
    expect(h.sends()).toHaveLength(1);

    tick(h);
    await vi.waitFor(() => expect(h.sends()).toHaveLength(2));
    const [first, second] = h.sends();
    expect(second!.body['challenge_token']).toBe(MOCK_CAPTCHA_PASS_TOKEN);
    expect(second!.body['text']).toBe('hello there');
    // One message, however many rounds: the server can tell it is a retry.
    expect(second!.body['idempotency_key']).toBe(first!.body['idempotency_key']);
    await vi.waitFor(() => expect(boxShown(h)).toBe(false));
    expect(el<HTMLTextAreaElement>(h.doc, '.nx-input').value).toBe('');
  });

  it('keeps what the visitor typed when they decline the check', async () => {
    const h = setUp({ send: () => challenge('messages_per_minute') });
    openLauncher(h);
    await vi.waitFor(() => expect(h.mints()).toHaveLength(1));
    await settle();
    await submit(h, 'please keep me');
    await vi.waitFor(() => expect(boxShown(h)).toBe(true));

    el<HTMLButtonElement>(h.doc, '.nx-challenge-cancel').click();
    await vi.waitFor(() =>
      expect(el<HTMLTextAreaElement>(h.doc, '.nx-input').value).toBe('please keep me'),
    );

    expect(boxShown(h)).toBe(false);
    expect(h.sends()).toHaveLength(1);
    expect(el(h.doc, '.nx-status').textContent).toBe(CATALOGS.en['error.challenge']);
  });
});

describe('Turnstile', () => {
  interface RenderOptions {
    sitekey: string;
    language?: string;
    callback: (token: string) => void;
    'error-callback': () => void;
  }

  /**
   * What Cloudflare's script would define once it ran — installed by the test
   * after the widget has added the tag, since a `window.turnstile` that
   * already existed would be used without any script being added.
   */
  function turnstileLoads(h: Harness): {
    render: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  } {
    const api = { render: vi.fn(() => 'widget-1'), remove: vi.fn() };
    (window as unknown as { turnstile: unknown }).turnstile = api;
    script(h).onload?.(new Event('load'));
    return api;
  }

  const script = (h: Harness): HTMLScriptElement => el<HTMLScriptElement>(h.doc, 'script');

  it('loads Cloudflare only once a check is asked for, then sends its token', async () => {
    const h = setUp({
      mint: (call) =>
        call.body['challenge_token'] === 'cf-token'
          ? jsonResponse({ token: 'nxc1.test-token', customer_id: 'cus_test' })
          : challenge('new_customers_per_ip', 'turnstile'),
    });
    // Nothing is fetched at mount: the visitor may never be asked.
    expect(h.doc.querySelector('script')).toBeNull();

    openLauncher(h);
    await vi.waitFor(() => expect(h.doc.querySelector('script')).not.toBeNull());
    expect(script(h).src).toBe(TURNSTILE_SCRIPT_URL);
    expect(el(h.doc, '.nx-challenge-loading').textContent).toBe(CATALOGS.en['challenge.loading']);

    const api = turnstileLoads(h);
    await vi.waitFor(() => expect(api.render).toHaveBeenCalledTimes(1));
    const options = (api.render.mock.calls[0] as unknown as [HTMLElement, RenderOptions])[1];
    expect(options.sitekey).toBe('0x4AAAA-site');
    expect(options.language).toBe('en');
    expect(el(h.doc, '.nx-challenge-provider').textContent).toBe(CATALOGS.en['challenge.provider']);

    options.callback('cf-token');
    await vi.waitFor(() => expect(boxShown(h)).toBe(false));
    expect(h.mints().map((c) => c.body['challenge_token'])).toEqual([undefined, 'cf-token']);
    expect(api.remove).toHaveBeenCalledWith('widget-1');
  });

  it('says so and offers another try when the script cannot be loaded', async () => {
    const h = setUp({ mint: () => challenge('new_customers_per_ip', 'turnstile') });
    openLauncher(h);
    await vi.waitFor(() => expect(h.doc.querySelector('script')).not.toBeNull());

    script(h).onerror?.(new Event('error'));
    await vi.waitFor(() =>
      expect(el<HTMLElement>(h.doc, '.nx-challenge-retry').hidden).toBe(false),
    );
    expect(el(h.doc, '.nx-challenge-notice').textContent).toBe(
      CATALOGS.en['challenge.unavailable'],
    );

    // Another try adds a fresh script rather than reusing the dead one.
    el<HTMLButtonElement>(h.doc, '.nx-challenge-retry').click();
    await vi.waitFor(() => expect(h.doc.querySelectorAll('script')).toHaveLength(1));
    expect(el<HTMLElement>(h.doc, '.nx-challenge-retry').hidden).toBe(true);
    expect(boxShown(h)).toBe(true);
  });

  it('asks Turnstile for Brazilian Portuguese where the widget shows Portuguese', async () => {
    const h = setUp({ mint: () => challenge('new_customers_per_ip', 'turnstile') }, 'pt');
    openLauncher(h);
    await vi.waitFor(() => expect(h.doc.querySelector('script')).not.toBeNull());
    const api = turnstileLoads(h);
    await vi.waitFor(() => expect(api.render).toHaveBeenCalled());
    const options = (api.render.mock.calls[0] as unknown as [HTMLElement, RenderOptions])[1];
    expect(options.language).toBe('pt-br');
  });
});

describe('the box speaks the visitor language (K25)', () => {
  it('shows the Turkish catalog and mirrors for Arabic', async () => {
    const tr = setUp({ mint: () => challenge('new_customers_per_ip') }, 'tr');
    openLauncher(tr);
    await vi.waitFor(() => expect(boxShown(tr)).toBe(true));
    expect(el(tr.doc, '.nx-challenge-title').textContent).toBe(CATALOGS.tr['challenge.title']);
    expect(el(tr.doc, '.nx-challenge-mock').textContent).toBe('Robot değilim');
    expect(el(tr.doc, '.nx-challenge-cancel').textContent).toBe(CATALOGS.tr['challenge.cancel']);
  });

  it('carries every challenge sentence in all eight languages, none left in English', () => {
    const keys = Object.keys(CATALOGS.en).filter(
      (key) => key.startsWith('challenge.') || key === 'error.challenge',
    );
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      if (locale === 'en') continue;
      for (const key of keys) {
        // The provider's name is the same everywhere; every other sentence is translated.
        if (key === 'challenge.provider') continue;
        expect(catalog[key], `${locale}['${key}']`).not.toBe(CATALOGS.en[key]);
      }
    }
  });
});
