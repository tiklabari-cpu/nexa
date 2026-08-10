/**
 * The visitor's referrer, from the loader's frame parameter to the message body
 * (FR-MOD-13.2 · 13.2-l).
 *
 * The loader half — reading `document.referrer` on the host page and trimming it
 * — is pinned in `loader.test.ts`. This is the other half of the same wire: that
 * the widget carries `host_referrer` into `POST /customer/chat/events`, and that
 * it invents nothing when there is no referrer to carry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

interface FetchCall {
  url: string;
  body: unknown;
}

let calls: FetchCall[] = [];

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response;
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });

      // Order matters: the events URL also contains "/customer/chat".
      if (url.includes('/customer/chat/events')) {
        return jsonResponse({ chat_id: 'chat-1', event: null });
      }
      if (url.includes('/customer/token')) {
        return jsonResponse({ token: 'tok', customer_id: 'cust-1', pre_chat_form: [] });
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

function submit(form: Element): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

async function waitFor(predicate: () => boolean, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('waitFor timed out');
}

/** Mount with the loader's query string, then send one message as the visitor. */
async function sendFirstMessage(search: string): Promise<Record<string, unknown>> {
  window.history.replaceState({}, '', `/widget.html${search}`);
  const root = document.createElement('div');
  root.id = 'nexa-widget-root';
  document.body.append(root);
  mount(document, window);

  root.querySelector<HTMLButtonElement>('.nx-greet-chat')!.click();
  await waitFor(() => root.querySelector('.nx-prechat-input') !== null);
  root.querySelectorAll<HTMLInputElement>('.nx-prechat-input')[0]!.value = 'Jo';
  submit(root.querySelector('.nx-prechat')!);

  root.querySelector<HTMLTextAreaElement>('.nx-input')!.value = 'my order is late';
  submit(root.querySelector('.nx-form')!);

  await waitFor(() => calls.some((c) => c.url.includes('/customer/chat/events')));
  return calls.find((c) => c.url.includes('/customer/chat/events'))!.body as Record<string, unknown>;
}

beforeEach(() => {
  calls = [];
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('widget referrer (FR-MOD-13.2)', () => {
  it("carries the loader's host_referrer into the message body", async () => {
    const body = await sendFirstMessage(
      '?organization_id=org-1&host_url=https%3A%2F%2Fshop.test%2Fcheckout' +
        '&host_referrer=https%3A%2F%2Fwww.searchy.test%2Fsearch',
    );

    expect(body).toMatchObject({
      text: 'my order is late',
      url: 'https://shop.test/checkout',
      referrer: 'https://www.searchy.test/search',
    });
  });

  it('sends no referrer when the loader passed none', async () => {
    // A direct arrival. Critically it must not fall back to the frame's own
    // `document.referrer`, which is the host page — that would record every
    // visitor as having come from the site they are already on.
    const body = await sendFirstMessage(
      '?organization_id=org-1&host_url=https%3A%2F%2Fshop.test%2Fcheckout',
    );

    expect(body).not.toHaveProperty('referrer');
    expect(body).toMatchObject({ url: 'https://shop.test/checkout' });
  });
});
