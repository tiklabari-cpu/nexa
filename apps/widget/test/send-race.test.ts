/**
 * tm 106 — the visitor beats the token mint.
 *
 * The composer is on screen from the first frame: `renderPrechat` only hides it
 * when a pre-chat form is configured, so a workspace without one shows a usable
 * "Message" box and Send button *before* `connect()` has resolved. Anyone who
 * types fast — or any test driving the widget at machine speed — reaches
 * `api.send()` while `#token` is still null, which throws "not connected"; the
 * optimistic bubble is then rolled back and the transcript is left empty, with
 * nothing on screen to say why.
 *
 * These tests drive that race deliberately by holding the token mint open until
 * after Send is pressed. The mint is also counted: a second caller must *join*
 * the in-flight mint, not start its own. On a first-ever visit neither request
 * carries a stored customer id, so two mints would create two customers and the
 * losing token would speak for a conversation the visitor cannot see.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../src/widget.js';

const API = 'https://api.test/v1';

interface ServerEvent {
  id: string;
  text: string | null;
  author_type: 'agent' | 'customer' | 'bot' | 'system';
  created_at: string;
  type: string;
  attachment_url: string | null;
}

/**
 * Minimal stand-in for `Response`: the widget only reads `ok`, `status` and
 * `json()`, and a real one would drag in a body stream for no added proof.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

interface Harness {
  doc: Document;
  /** Resolve to let the held `POST /customer/token` finish. */
  releaseToken: () => void;
  calls: string[];
  countOf: (call: string) => number;
  events: ServerEvent[];
}

function setUp(options: { holdToken: boolean }): Harness {
  const calls: string[] = [];
  const events: ServerEvent[] = [];

  let release = (): void => {};
  const gate = options.holdToken
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = url.slice(API.length);
    calls.push(`${method} ${path}`);

    if (path === '/customer/token') {
      await gate;
      return jsonResponse({ token: 'nxc1.test-token', customer_id: 'cus_test' });
    }
    if (path === '/customer/chat' && method === 'GET') {
      return jsonResponse({
        online: true,
        customer: { id: 'cus_test', name: null, email: null },
        agent: null,
        chat: { id: 'chat_test', thread_id: 'thr_test', queue_position: null },
        events: [...events],
      });
    }
    if (path === '/customer/chat/events') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { text?: string };
      const event: ServerEvent = {
        id: `evt_${events.length + 1}`,
        text: body.text ?? null,
        author_type: 'customer',
        created_at: '2026-08-09T10:00:00.000Z',
        type: 'message',
        attachment_url: null,
      };
      events.push(event);
      return jsonResponse({ chat_id: 'chat_test', event }, 201);
    }
    if (path === '/customer/chat/typing') return jsonResponse(null, 204);

    throw new Error(`unexpected request: ${method} ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  // A document of its own per test, so one mount's DOM listeners can never
  // answer another's clicks.
  const doc = document.implementation.createHTMLDocument('widget');
  const root = doc.createElement('div');
  root.id = 'nexa-widget-root';
  doc.body.append(root);

  window.history.replaceState({}, '', `/?organization_id=org_test&api=${API}`);
  mount(doc, window);

  return {
    doc,
    releaseToken: () => release(),
    calls,
    countOf: (call) => calls.filter((c) => c === call).length,
    events,
  };
}

function el<T extends Element>(doc: Document, selector: string): T {
  const found = doc.querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
}

/** Open the panel — this is what fires `connect()` in the real widget. */
function openPanel(doc: Document): void {
  el<HTMLButtonElement>(doc, '.nx-launcher').click();
}

/** Type and submit, exactly as the composer's own listener does. */
function submitMessage(doc: Document, text: string): void {
  el<HTMLTextAreaElement>(doc, '.nx-input').value = text;
  el<HTMLFormElement>(doc, '.nx-form').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true }),
  );
}

function transcriptText(doc: Document): string {
  return el(doc, '.nx-transcript').textContent ?? '';
}

describe('widget send / connect race (tm 106)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('delivers a message pressed before the token mint resolves', async () => {
    const h = setUp({ holdToken: true });

    openPanel(h.doc);
    // The composer is usable now, while the mint is still in flight — that is
    // the whole point, and asserting it keeps this test honest if the widget
    // ever starts hiding the composer until connect finishes.
    expect(el<HTMLTextAreaElement>(h.doc, '.nx-input').hidden).toBe(false);
    expect(h.countOf('POST /customer/token')).toBe(1);

    submitMessage(h.doc, 'hello before the token');

    // Nothing could have reached the server yet; the widget must be waiting,
    // not failing.
    expect(h.countOf('POST /customer/chat/events')).toBe(0);

    h.releaseToken();

    // Settle on the *server* first, then look at the DOM. Waiting on the
    // transcript instead would pass on the optimistic bubble that is on screen
    // for a microtask before the broken path rolls it back — which is exactly
    // how this bug hid.
    await vi.waitFor(() => {
      expect(h.countOf('POST /customer/chat/events')).toBe(1);
    });
    // …and on the refresh that follows the send, so what is on screen is the
    // server's view rather than the optimistic guess.
    await vi.waitFor(() => {
      expect(h.countOf('GET /customer/chat')).toBeGreaterThanOrEqual(2);
    });

    expect(transcriptText(h.doc)).toContain('hello before the token');
    expect(h.events.map((e) => e.text)).toEqual(['hello before the token']);
    // The visitor is told nothing went wrong, because nothing did.
    expect(el(h.doc, '.nx-status').textContent).toBe('');
    // One identity: the fast Send joined the in-flight mint instead of racing
    // a second one, which on a first visit would create a second customer.
    expect(h.countOf('POST /customer/token')).toBe(1);
  });

  it('still sends normally once the mint has already resolved', async () => {
    const h = setUp({ holdToken: false });

    openPanel(h.doc);
    await vi.waitFor(() => {
      expect(h.countOf('GET /customer/chat')).toBeGreaterThan(0);
    });

    submitMessage(h.doc, 'hello after the token');

    await vi.waitFor(() => {
      expect(h.countOf('POST /customer/chat/events')).toBe(1);
    });
    await vi.waitFor(() => {
      expect(transcriptText(h.doc)).toContain('hello after the token');
    });
    // The guard added for the race must not re-mint on the settled path.
    expect(h.countOf('POST /customer/token')).toBe(1);
  });
});
