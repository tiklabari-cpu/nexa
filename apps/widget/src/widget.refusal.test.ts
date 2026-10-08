/**
 * Refusals the visitor can act on (tm 259.10 · UX audit O1 + D16).
 *
 * The widget answered every failed send — a spam-filter refusal (403
 * `message_rejected`), a rate limit (429) and a dead connection alike — with
 * "Message not sent. Check your connection and try again.". A real visitor whose
 * message was misread as spam then checked their network and retried the same
 * text for nothing. Each cause now gets its own sentence; only a network error
 * keeps the connection one. Upload refusals name their reason too, and message
 * times follow the widget language rather than the browser's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOGS } from './locales/index.js';
import { mount } from './widget.js';

const API = 'https://api.test/v1';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Response;
}

const REJECTED = {
  error: { type: 'message_rejected', message: 'This message could not be sent.' },
};

interface Harness {
  doc: Document;
  sends: () => number;
  grants: () => number;
}

interface Routes {
  /** The answer to `POST /customer/chat/events`; a throw is a dead network. */
  send?: () => Response;
  /** The answer to `POST /uploads` (the grant). */
  grant?: () => Response;
  /** Events the transcript opens with. */
  events?: unknown[];
}

function setUp(routes: Routes, language = 'en'): Harness {
  let sends = 0;
  let grants = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).slice(API.length);
      const method = init?.method ?? 'GET';
      if (path === '/customer/token') {
        return jsonResponse({ token: 'nxc1.test-token', customer_id: 'cus_test' });
      }
      if (path === '/customer/chat' && method === 'GET') {
        return jsonResponse({
          online: true,
          customer: { id: 'cus_test', name: null, email: null },
          agent: null,
          chat: { id: 'chat_test', thread_id: 'thr_test', queue_position: null },
          events: routes.events ?? [],
        });
      }
      if (path === '/customer/chat/events') {
        sends += 1;
        return (routes.send ?? (() => jsonResponse({ chat_id: 'chat_test' })))();
      }
      if (path === '/uploads') {
        grants += 1;
        return (routes.grant ?? (() => jsonResponse({}, 500)))();
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
  mount(doc, window);
  return { doc, sends: () => sends, grants: () => grants };
}

function el<T extends Element>(doc: Document, selector: string): T {
  const found = doc.querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
}

async function open(h: Harness): Promise<void> {
  el<HTMLButtonElement>(h.doc, '.nx-launcher').click();
  await vi.waitFor(() => expect(el(h.doc, '.nx-status')).toBeTruthy());
  // Let the connect the launcher started finish: a send that races it makes a
  // second `connect`, whose late success wipes the error the send just set.
  await vi.waitFor(() => {
    const paths = vi.mocked(fetch).mock.calls.map(([input]) => String(input).slice(API.length));
    expect(paths).toContain('/customer/chat');
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
}

async function sendMessage(h: Harness, text: string, nth = 1): Promise<void> {
  await open(h);
  el<HTMLTextAreaElement>(h.doc, '.nx-input').value = text;
  el<HTMLFormElement>(h.doc, '.nx-form').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() => expect(h.sends()).toBe(nth));
}

async function pickFile(h: Harness, file: File): Promise<void> {
  await open(h);
  const input = el<HTMLInputElement>(h.doc, '.nx-file');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await vi.waitFor(() => expect(h.grants()).toBe(1));
}

const status = (h: Harness): string => el(h.doc, '.nx-status').textContent ?? '';

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a refused message says why (O1)', () => {
  it('403 message_rejected names the message, not the connection, and keeps the text', async () => {
    const h = setUp({ send: () => jsonResponse(REJECTED, 403) });
    await sendMessage(h, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    await vi.waitFor(() => expect(status(h)).toBe(CATALOGS.en['error.rejected']));
    expect(status(h)).not.toContain('connection');
    // The sentence names no rule — the server keeps the filter unprobeable.
    expect(status(h)).not.toMatch(/spam|character|repeat/i);
    expect(el<HTMLTextAreaElement>(h.doc, '.nx-input').value).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(el<HTMLButtonElement>(h.doc, '.nx-send').disabled).toBe(false);
  });

  it('a banned visitor gets the same generic sentence (the ban is not announced)', async () => {
    const h = setUp({
      send: () =>
        jsonResponse(
          { error: { type: 'customer_banned', message: 'This customer is banned.' } },
          403,
        ),
    });
    await sendMessage(h, 'hello');
    await vi.waitFor(() => expect(status(h)).toBe(CATALOGS.en['error.rejected']));
  });

  it('429 asks the visitor to slow down, keeps the text and holds Send for Retry-After', async () => {
    const h = setUp({
      send: () =>
        jsonResponse(
          { error: { type: 'too_many_requests', message: 'Rate limit exceeded.' } },
          429,
          { 'Retry-After': '1' },
        ),
    });
    await sendMessage(h, 'one more thing');

    await vi.waitFor(() => expect(status(h)).toBe(CATALOGS.en['error.rateLimited']));
    expect(status(h)).not.toContain('connection');
    expect(el<HTMLTextAreaElement>(h.doc, '.nx-input').value).toBe('one more thing');
    const send = el<HTMLButtonElement>(h.doc, '.nx-send');
    expect(send.disabled).toBe(true);

    // Pressing enter must not slip past the disabled button.
    el<HTMLFormElement>(h.doc, '.nx-form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(h.sends()).toBe(1);

    await vi.waitFor(() => expect(send.disabled).toBe(false), { timeout: 3000 });
    // The wait is over, so the stale "too fast" line goes with it.
    expect(status(h)).toBe('');
  });

  it('429 without Retry-After still pauses Send briefly', async () => {
    const h = setUp({
      send: () => jsonResponse({ error: { type: 'too_many_requests', message: 'x' } }, 429),
    });
    await sendMessage(h, 'hi');
    await vi.waitFor(() => expect(status(h)).toBe(CATALOGS.en['error.rateLimited']));
    expect(el<HTMLButtonElement>(h.doc, '.nx-send').disabled).toBe(true);
  });

  it('a dead network keeps the connection sentence', async () => {
    const h = setUp({
      send: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await sendMessage(h, 'hello?');
    await vi.waitFor(() => expect(status(h)).toBe(CATALOGS.en['error.send']));
    expect(el<HTMLTextAreaElement>(h.doc, '.nx-input').value).toBe('hello?');
  });

  it('answers in the widget language', async () => {
    const h = setUp({ send: () => jsonResponse(REJECTED, 403) }, 'tr');
    await sendMessage(h, 'merhaba');
    await vi.waitFor(() => expect(status(h)).toBe(CATALOGS.tr['error.rejected']));
    expect(CATALOGS.tr['error.rejected']).not.toBe(CATALOGS.en['error.rejected']);
  });
});

describe('a refused upload says why (D16)', () => {
  const big = (): File => new File([new Uint8Array(16)], 'huge.pdf', { type: 'application/pdf' });

  it('too large names the limit from the server’s answer', async () => {
    const h = setUp({
      grant: () =>
        jsonResponse(
          {
            error: {
              type: 'validation',
              message: 'File is larger than this licence allows.',
              details: { max_file_size_bytes: 10_485_760 },
            },
          },
          400,
        ),
    });
    await pickFile(h, big());
    await vi.waitFor(() =>
      expect(status(h)).toBe(CATALOGS.en['error.uploadTooLargeMax']!.replace('{max}', '10 MB')),
    );
  });

  it('a 413 without a number still says the file is too large', async () => {
    const h = setUp({
      grant: () => jsonResponse({ error: { type: 'validation', message: 'x' } }, 413),
    });
    await pickFile(h, big());
    await vi.waitFor(() => expect(status(h)).toBe(CATALOGS.en['error.uploadTooLarge']));
  });

  it('an unsupported type says so', async () => {
    const h = setUp({
      grant: () =>
        jsonResponse(
          {
            error: {
              type: 'validation',
              message: 'Files of type application/zip are not allowed.',
              details: { allowed_file_types: ['image/png', 'application/pdf'] },
            },
          },
          400,
        ),
    });
    await pickFile(h, new File([new Uint8Array(4)], 'a.zip', { type: 'application/zip' }));
    await vi.waitFor(() => expect(status(h)).toBe(CATALOGS.en['error.uploadType']));
  });

  it('415 says the type is not allowed', async () => {
    const h = setUp({
      grant: () => jsonResponse({ error: { type: 'validation', message: 'x' } }, 415),
    });
    await pickFile(h, big());
    await vi.waitFor(() => expect(status(h)).toBe(CATALOGS.en['error.uploadType']));
  });

  it('any other failure keeps the generic sentence', async () => {
    const h = setUp({
      grant: () => jsonResponse({ error: { type: 'internal', message: 'x' } }, 500),
    });
    await pickFile(h, big());
    await vi.waitFor(() => expect(status(h)).toBe(CATALOGS.en['error.upload']));
  });
});

describe('message times follow the widget language (D16)', () => {
  const at = new Date(2026, 9, 8, 14, 21).toISOString(); // local 14:21, any time zone
  const events = [
    { id: 'evt_1', text: 'Hi there', author_type: 'agent', created_at: at, type: 'message' },
  ];
  const timeOf = (h: Harness): string => el(h.doc, '.nx-transcript time').textContent ?? '';

  it('tr shows a 24-hour clock', async () => {
    const h = setUp({ events }, 'tr');
    await open(h);
    await vi.waitFor(() => expect(timeOf(h)).toBe('14:21'));
  });

  it('en shows a 12-hour clock', async () => {
    const h = setUp({ events }, 'en');
    await open(h);
    await vi.waitFor(() => expect(timeOf(h).replace(/\s/g, ' ')).toBe('2:21 PM'));
  });
});

describe('catalogs', () => {
  it('every new sentence is real text in all eight languages', () => {
    for (const key of [
      'error.rejected',
      'error.rateLimited',
      'error.uploadTooLarge',
      'error.uploadTooLargeMax',
      'error.uploadType',
    ]) {
      for (const [locale, catalog] of Object.entries(CATALOGS)) {
        expect(catalog[key], `${locale}['${key}']`).toBeTruthy();
        if (locale !== 'en')
          expect(catalog[key], `${locale}['${key}'] is English`).not.toBe(CATALOGS.en[key]);
      }
    }
    expect(CATALOGS.en['error.uploadTooLargeMax']).toContain('{max}');
    for (const catalog of Object.values(CATALOGS)) {
      expect(catalog['error.uploadTooLargeMax']).toContain('{max}');
    }
  });
});
