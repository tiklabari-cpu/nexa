/**
 * A returning visitor moving to the next page of a site mints no new token
 * (tm 429 · audit F11).
 *
 * Every page load used to mount the widget, connect, and so mint — and the
 * mint shared the API's anonymous per-address budget with sign-in, so an
 * office NAT's visitors browsing a few pages each locked the widget out. The
 * next page's widget now takes on the last mint the tab kept; the details of
 * the kept mint are pinned in `api.session.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';
import { storageKeys } from './api.js';

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

let tokenMints = 0;
/** The bearer each conversation read was made with, in order. */
let pollBearers: string[] = [];

beforeEach(() => {
  tokenMints = 0;
  pollBearers = [];
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.localStorage.clear();
  // The visitor has chatted here before, so the widget connects at once.
  window.localStorage.setItem(storageKeys('org-1').customerId, 'cust-1');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/customer/token')) {
        tokenMints += 1;
        return jsonResponse({
          token: `tok-${tokenMints}`,
          expires_in: 28_800,
          customer_id: 'cust-1',
          pre_chat_form: [],
        });
      }
      if (url.endsWith('/customer/chat')) {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        pollBearers.push(headers['authorization'] ?? '');
        return jsonResponse({
          online: true,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: null,
          chat: { id: 'chat-1', thread_id: 'thr-1', queue_position: null },
          events: [],
          campaign: null,
        });
      }
      return jsonResponse({});
    }),
  );
});

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** One page load: the widget document mounted afresh in the same tab. */
async function pageLoad(): Promise<void> {
  while (mounted.length > 0) mounted.pop()?.();
  document.body.replaceChildren();
  window.history.replaceState({}, '', `/widget.html?organization_id=org-1&api=${API}`);
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  const polled = pollBearers.length;
  mounted.push(mount(document, window));
  await vi.waitFor(() => expect(pollBearers.length).toBeGreaterThan(polled));
}

describe('a page change in the same tab (tm 429)', () => {
  it('connects the next page with the token the last one minted, minting nothing (NFR-S8)', async () => {
    await pageLoad();
    expect(tokenMints).toBe(1);

    await pageLoad();
    await pageLoad();
    expect(tokenMints).toBe(1);
    expect(new Set(pollBearers)).toEqual(new Set(['Bearer tok-1']));
  });

  it('mints for a new tab, which starts with nothing kept', async () => {
    await pageLoad();
    window.sessionStorage.clear(); // a new tab's sessionStorage is its own
    await pageLoad();
    expect(tokenMints).toBe(2);
    expect(pollBearers.at(-1)).toBe('Bearer tok-2');
  });
});
