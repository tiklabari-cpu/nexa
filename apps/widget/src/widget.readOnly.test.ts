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

/** A widget whose send answers with `sendResponse`; everything else works. */
function setUp(sendResponse: () => Response, language = 'en'): Harness {
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
        return jsonResponse({
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
  mount(doc, window);
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
