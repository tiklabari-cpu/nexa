/**
 * A visitor writing to a workspace whose trial is over (tm 257.15 ·
 * FR-MOD-10.2).
 *
 * The license gate refuses every write on a read-only workspace, the visitor's
 * message included — 402 `license_expired`. The widget used to answer every
 * failed send with "Message not sent. Check your connection and try again.",
 * which sends the visitor hunting for a fault that is not theirs and that a
 * retry will never fix. A 402 `license_expired` now gets its own sentence;
 * every other failure keeps the connection one. The text and attachment are put
 * back either way, so nothing the visitor typed is lost.
 *
 * Fix is independent of any deployment flag: the right sentence for a closed
 * conversation is the same everywhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOGS } from './locales/index.js';
import { mount } from './widget.js';

/** Every widget this file mounts, taken down after each test (`mount` returns its teardown). */
const mounted: Array<() => void> = [];

const API = 'https://api.test/v1';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** What the API sends for a write on a read-only workspace (`license-gate.ts`). */
const LICENSE_EXPIRED = {
  error: {
    type: 'license_expired',
    message: 'This workspace is read-only.',
    details: { access: 'read_only' },
  },
};

interface Harness {
  doc: Document;
  sends: () => number;
}

interface Options {
  /** What each poll says about `read_only` (tm 406); absent, the field is not sent. */
  readOnly?: () => boolean | undefined;
  /** Holds every poll until it settles, to type ahead of the first one. */
  gate?: Promise<void>;
}

/** A widget whose send answers with `sendResponse`; everything else works. */
function setUp(sendResponse: () => Response, language = 'en', options: Options = {}): Harness {
  let sends = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).slice(API.length);
      const method = init?.method ?? 'GET';
      if (path === '/customer/token') {
        return jsonResponse({ token: 'nxc1.test-token', customer_id: 'cus_test' });
      }
      if (path === '/customer/chat' && method === 'GET') {
        await options.gate;
        return jsonResponse({
          read_only: options.readOnly?.(),
          online: true,
          customer: { id: 'cus_test', name: null, email: null },
          agent: null,
          chat: { id: 'chat_test', thread_id: 'thr_test', queue_position: null },
          events: [],
        });
      }
      if (path === '/customer/chat/events') {
        sends += 1;
        return sendResponse();
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
  return { doc, sends: () => sends };
}

function el<T extends Element>(doc: Document, selector: string): T {
  const found = doc.querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
}

async function sendMessage(h: Harness, text: string): Promise<void> {
  el<HTMLButtonElement>(h.doc, '.nx-launcher').click();
  await vi.waitFor(() => expect(el(h.doc, '.nx-status')).toBeTruthy());
  el<HTMLTextAreaElement>(h.doc, '.nx-input').value = text;
  el<HTMLFormElement>(h.doc, '.nx-form').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() => expect(h.sends()).toBe(1));
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const stop of mounted.splice(0)) stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('widget send on a read-only workspace (tm 257.15)', () => {
  it('says the conversation cannot take new messages, not that the connection failed', async () => {
    const h = setUp(() => jsonResponse(LICENSE_EXPIRED, 402));
    await sendMessage(h, 'is anyone there?');

    await vi.waitFor(() => {
      expect(el(h.doc, '.nx-status').textContent).toBe(CATALOGS.en['error.readOnly']);
    });
    expect(el(h.doc, '.nx-status').textContent).not.toContain('connection');
    // What the visitor typed is back in the box, and no bubble is left behind.
    expect(el<HTMLTextAreaElement>(h.doc, '.nx-input').value).toBe('is anyone there?');
    expect(el(h.doc, '.nx-transcript').textContent).not.toContain('is anyone there?');
    // And it stays on screen, but Send is held: a retry would only be refused again (tm 406).
    expect(el<HTMLElement>(h.doc, '.nx-form').hidden).toBe(false);
    expect(el<HTMLButtonElement>(h.doc, '.nx-send').disabled).toBe(true);
  });

  it('answers in the visitor’s language', async () => {
    const h = setUp(() => jsonResponse(LICENSE_EXPIRED, 402), 'tr');
    await sendMessage(h, 'merhaba');

    await vi.waitFor(() => {
      expect(el(h.doc, '.nx-status').textContent).toBe(CATALOGS.tr['error.readOnly']);
    });
  });

  it('keeps the connection sentence for every other failure', async () => {
    for (const [status, body] of [
      [500, { error: { type: 'internal', message: 'boom' } }],
      // A 402 that is not the licence gate's is not a read-only workspace.
      [402, { error: { type: 'limit_reached', message: 'plan limit' } }],
      // And a licence refusal with a different status is not this either.
      [403, LICENSE_EXPIRED],
      [503, { not: 'an error envelope' }],
    ] as const) {
      const h = setUp(() => jsonResponse(body, status));
      await sendMessage(h, `try ${status}`);
      await vi.waitFor(() => {
        expect(el(h.doc, '.nx-status').textContent, `status ${status}`).toBe(
          CATALOGS.en['error.send'],
        );
      });
      vi.unstubAllGlobals();
    }
  });
});

/** Open the panel the way a visitor does. */
function open(h: Harness): void {
  el<HTMLButtonElement>(h.doc, '.nx-launcher').click();
}

const hidden = (h: Harness, selector: string): boolean => el<HTMLElement>(h.doc, selector).hidden;

describe('a read-only workspace announced by the poll (tm 406)', () => {
  it('says so before the visitor types, and offers no form and no composer', async () => {
    const h = setUp(() => jsonResponse(LICENSE_EXPIRED, 402), 'en', { readOnly: () => true });
    open(h);

    await vi.waitFor(() => {
      expect(el(h.doc, '.nx-status').textContent).toBe(CATALOGS.en['error.readOnly']);
    });
    // The way out is in the line itself: contact the business another way.
    expect(el(h.doc, '.nx-status').textContent).toContain('contact us another way');
    expect(hidden(h, '.nx-status')).toBe(false);
    expect(hidden(h, '.nx-prechat')).toBe(true);
    expect(hidden(h, '.nx-offline')).toBe(true);
    expect(hidden(h, '.nx-form')).toBe(true);

    // Enter does not reach the server either.
    el<HTMLTextAreaElement>(h.doc, '.nx-input').value = 'hello?';
    el(h.doc, '.nx-input').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
    await Promise.resolve();
    expect(h.sends()).toBe(0);
  });

  it('answers in the visitor’s language', async () => {
    const h = setUp(() => jsonResponse(LICENSE_EXPIRED, 402), 'tr', { readOnly: () => true });
    open(h);
    await vi.waitFor(() => {
      expect(el(h.doc, '.nx-status').textContent).toBe(CATALOGS.tr['error.readOnly']);
    });
  });

  it('keeps a line already typed in the pre-chat form, in the composer with Send held', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const h = setUp(() => jsonResponse(LICENSE_EXPIRED, 402), 'en', { readOnly: () => true, gate });
    open(h);
    await vi.waitFor(() => expect(hidden(h, '.nx-prechat')).toBe(false));
    el<HTMLTextAreaElement>(h.doc, '.nx-prechat .nx-prechat-message').value =
      'my order never arrived';

    release();
    await vi.waitFor(() => expect(hidden(h, '.nx-prechat')).toBe(true));
    expect(el<HTMLTextAreaElement>(h.doc, '.nx-input').value).toBe('my order never arrived');
    expect(hidden(h, '.nx-form')).toBe(false);
    expect(el<HTMLButtonElement>(h.doc, '.nx-send').disabled).toBe(true);
    expect(el(h.doc, '.nx-status').textContent).toBe(CATALOGS.en['error.readOnly']);
    expect(h.sends()).toBe(0);
  });

  it('opens again on the poll that says the workspace is writable', async () => {
    vi.useFakeTimers();
    let readOnly = true;
    const h = setUp(() => jsonResponse({ id: 'evt_1', chat_id: 'chat_test' }, 201), 'en', {
      readOnly: () => readOnly,
    });
    // A document made by `createHTMLDocument` reports itself hidden, and a hidden page is not polled.
    Object.defineProperty(h.doc, 'hidden', { value: false });
    open(h);
    await vi.advanceTimersByTimeAsync(0);
    expect(el(h.doc, '.nx-status').textContent).toBe(CATALOGS.en['error.readOnly']);

    readOnly = false;
    await vi.advanceTimersByTimeAsync(4_000);
    expect(el(h.doc, '.nx-status').textContent).not.toBe(CATALOGS.en['error.readOnly']);
    expect(hidden(h, '.nx-prechat') && hidden(h, '.nx-form')).toBe(false);
    expect(el<HTMLButtonElement>(h.doc, '.nx-send').disabled).toBe(false);
  });

  it('changes nothing for a server that does not send the field', async () => {
    const h = setUp(() => jsonResponse(LICENSE_EXPIRED, 402));
    open(h);
    await vi.waitFor(() => expect(hidden(h, '.nx-prechat')).toBe(false));
    expect(el(h.doc, '.nx-status').textContent).not.toBe(CATALOGS.en['error.readOnly']);
  });
});
