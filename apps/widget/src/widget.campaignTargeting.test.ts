/**
 * The widget's half of multi-condition campaigns (EN-03 · tm 352.2): a card the
 * server offers with `show_when` is held until the browser-side rules hold,
 * counts as displayed only when it is drawn, goes when the visitor moves to a
 * page it does not apply to, and the page changes and site variables reach the
 * server only for a workspace with a campaign running.
 *
 * Real timers: the rules count whole seconds, and the chunk the logic lives in
 * is fetched by a dynamic import that fake timers cannot drive. The clock
 * itself is pinned down in `targeting.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

const mounted: Array<() => void> = [];
const API = 'https://api.test/v1';

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

let calls: FetchCall[] = [];
let chatPolls = 0;
let tracking = true;
type Offer = {
  id: string;
  message: string;
  show_when?: { match: 'all' | 'any'; rules: unknown[] };
} | null;
let offerAt: (poll: number) => Offer = () => null;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes('/customer/token')) {
        return jsonResponse({
          token: 'tok',
          customer_id: 'cust-1',
          pre_chat_form: [],
          campaign_tracking: tracking,
        });
      }
      if (url.includes('/customer/visit') || url.includes('/shown')) {
        return { ok: true, status: 204, json: async () => undefined } as unknown as Response;
      }
      if (url.includes('/customer/chat/sale')) return jsonResponse({ id: 'sale-1' });
      if (url.endsWith('/customer/chat')) {
        chatPolls += 1;
        return jsonResponse({
          online: true,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: null,
          chat: null,
          events: [],
          campaign: offerAt(chatPolls),
        });
      }
      return jsonResponse({});
    }),
  );
}

function mountWidget(): HTMLElement {
  window.history.replaceState({}, '', `/widget.html?organization_id=org-1&api=${API}`);
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mounted.push(mount(document, window));
  return root;
}

/** A message from the embedding page (the loader), as the widget accepts them. */
function fromHost(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data, source: window.parent }));
}

function connectWithoutOpening(): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: {
        type: 'siyahtus:command',
        command: 'trackSale',
        payload: { external_order_id: 'o-1', amount_cents: 100, currency: 'USD' },
      },
    }),
  );
}

const card = (root: HTMLElement): HTMLElement => root.querySelector<HTMLElement>('.nx-greeting')!;
const shownCalls = (): FetchCall[] => calls.filter((call) => call.url.includes('/shown'));
const visitCalls = (): FetchCall[] => calls.filter((call) => call.url.endsWith('/customer/visit'));
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitSeconds = {
  match: 'all' as const,
  rules: [{ field: 'time_on_page', op: 'gte', value: 1 }],
};
const exitIntent = {
  match: 'all' as const,
  rules: [{ field: 'exit_intent', op: 'equals', value: true }],
};

beforeEach(() => {
  calls = [];
  chatPolls = 0;
  tracking = true;
  offerAt = () => null;
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

describe('a campaign card that waits for the browser (EN-03)', () => {
  it('stays back until its seconds on the page are up, then shows and reports itself shown, once (FR-MOD-03.3.2)', async () => {
    offerAt = () => ({ id: 'camp-1', message: 'Still thinking?', show_when: waitSeconds });
    const root = mountWidget();
    connectWithoutOpening();
    await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(1));

    expect(card(root).hidden).toBe(true);
    expect(shownCalls()).toEqual([]);

    await vi.waitFor(() => expect(card(root).hidden).toBe(false), { timeout: 3_000 });
    expect(card(root).dataset['kind']).toBe('campaign');
    expect(card(root).querySelector('.nx-greet-msg')!.textContent).toBe('Still thinking?');
    await vi.waitFor(() => expect(shownCalls()).toHaveLength(1));
    expect(shownCalls()[0]).toMatchObject({
      method: 'POST',
      url: `${API}/customer/campaigns/camp-1/shown`,
    });

    // Drawn again by anything that re-renders the card: still reported once.
    fromHost({ type: 'siyahtus:exit-intent' });
    await pause(100);
    expect(shownCalls()).toHaveLength(1);
  });

  it('shows an exit-intent card on the exit, not before, and an exit made earlier does not count (FR-MOD-03.3.2)', async () => {
    offerAt = () => ({ id: 'camp-2', message: 'Wait — 10% off.', show_when: exitIntent });
    const root = mountWidget();
    fromHost({ type: 'siyahtus:exit-intent' });
    connectWithoutOpening();
    await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(1));
    await pause(50);
    expect(card(root).hidden).toBe(true);

    fromHost({ type: 'siyahtus:exit-intent' });
    await vi.waitFor(() => expect(card(root).hidden).toBe(false));
    expect(card(root).dataset['kind']).toBe('campaign');
    await vi.waitFor(() => expect(shownCalls()).toHaveLength(1));
  });

  it('ignores an exit that does not come from the embedding page', async () => {
    offerAt = () => ({ id: 'camp-2', message: 'Wait.', show_when: exitIntent });
    const root = mountWidget();
    connectWithoutOpening();
    await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(1));
    await pause(30);

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'siyahtus:exit-intent' } }));
    await pause(50);
    expect(card(root).hidden).toBe(true);
    expect(shownCalls()).toEqual([]);
  });

  it('does not count a card as shown while the panel is open, and does not bring it back after', async () => {
    offerAt = () => ({ id: 'camp-3', message: 'Hi.', show_when: exitIntent });
    const root = mountWidget();
    connectWithoutOpening();
    await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(1));
    await pause(30);

    root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
    fromHost({ type: 'siyahtus:exit-intent' });
    await pause(50);
    expect(shownCalls()).toEqual([]);

    root.querySelector<HTMLButtonElement>('.nx-close')!.click();
    await pause(50);
    expect(card(root).hidden).toBe(true);
    expect(shownCalls()).toEqual([]);
  });

  it('drops a waiting card when the visitor moves to another page, and reports the page', async () => {
    // The server offers the card only while the visitor is on the first page.
    offerAt = () =>
      visitCalls().length === 0
        ? { id: 'camp-4', message: 'Pricing help?', show_when: waitSeconds }
        : null;
    const root = mountWidget();
    connectWithoutOpening();
    await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(1));
    await pause(50);

    fromHost({ type: 'siyahtus:page', url: 'https://shop.test/deposit' });
    await vi.waitFor(() => expect(visitCalls()).toHaveLength(1));
    expect(visitCalls()[0]!.body).toEqual({ url: 'https://shop.test/deposit' });

    // The poll that follows the report finds nothing offered; the card never shows.
    await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(2));
    await pause(1_300);
    expect(card(root).hidden).toBe(true);
    expect(shownCalls()).toEqual([]);
  });

  it('shows the campaign the server offers for the new page', async () => {
    offerAt = () =>
      visitCalls().length === 0
        ? { id: 'camp-5', message: 'Old page offer.', show_when: exitIntent }
        : { id: 'camp-6', message: 'Deposit offer.', show_when: exitIntent };
    const root = mountWidget();
    connectWithoutOpening();
    await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(1));
    await pause(30);

    fromHost({ type: 'siyahtus:page', url: 'https://shop.test/deposit' });
    await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(2));
    await pause(30);
    fromHost({ type: 'siyahtus:exit-intent' });
    await vi.waitFor(() => expect(card(root).hidden).toBe(false));
    expect(card(root).querySelector('.nx-greet-msg')!.textContent).toBe('Deposit offer.');
    await vi.waitFor(() => expect(shownCalls()).toHaveLength(1));
    expect(shownCalls()[0]!.url).toContain('/campaigns/camp-6/shown');
  });

  it('still shows a card with no show_when at once and reports nothing', async () => {
    offerAt = () => ({ id: 'camp-7', message: 'Free shipping.' });
    const root = mountWidget();
    connectWithoutOpening();
    await vi.waitFor(() => expect(card(root).hidden).toBe(false));
    await pause(50);
    expect(shownCalls()).toEqual([]);
  });
});

describe('page changes and session variables', () => {
  it('tells the embedding page to start watching only when the mint says a campaign runs', async () => {
    const told: unknown[] = [];
    const listener = (event: MessageEvent): void => {
      if ((event.data as { type?: string })?.type === 'siyahtus:campaign-tracking') {
        told.push(event.data);
      }
    };
    window.addEventListener('message', listener);
    try {
      tracking = false;
      mountWidget();
      connectWithoutOpening();
      await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(1));
      await pause(50);
      expect(told).toEqual([]);
    } finally {
      for (const stop of mounted.splice(0)) stop();
      document.body.replaceChildren();
    }

    try {
      tracking = true;
      chatPolls = 0;
      mountWidget();
      connectWithoutOpening();
      await vi.waitFor(() => expect(told).toHaveLength(1));
    } finally {
      window.removeEventListener('message', listener);
    }
  });

  it('reports the site variables, whole and sanitised, and merges later calls into them', async () => {
    mountWidget();
    // Set before the widget has connected: held until the mint says to report.
    fromHost({
      type: 'siyahtus:command',
      command: 'setSessionVariables',
      payload: { plan: 'premium', vip: true, nested: { a: 1 }, long: 'x'.repeat(150) },
    });
    connectWithoutOpening();
    await vi.waitFor(() => expect(visitCalls()).toHaveLength(1));
    expect(visitCalls()[0]!.body).toEqual({
      url: expect.any(String),
      variables: { plan: 'premium', vip: true, long: 'x'.repeat(100) },
    });

    fromHost({ type: 'siyahtus:command', command: 'setSessionVariables', payload: { cart: 3 } });
    await vi.waitFor(() => expect(visitCalls()).toHaveLength(2), { timeout: 4_000 });
    expect(visitCalls()[1]!.body).toMatchObject({
      variables: { plan: 'premium', vip: true, cart: 3 },
    });
  });

  it('sends nothing to the server for a workspace with no campaign running', async () => {
    tracking = false;
    mountWidget();
    connectWithoutOpening();
    await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(1));
    fromHost({
      type: 'siyahtus:command',
      command: 'setSessionVariables',
      payload: { plan: 'premium' },
    });
    fromHost({ type: 'siyahtus:page', url: 'https://shop.test/other' });
    await pause(100);
    expect(visitCalls()).toEqual([]);
  });

  it('takes variable commands from the embedding page only', async () => {
    mountWidget();
    connectWithoutOpening();
    await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(1));
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'siyahtus:command', command: 'setSessionVariables', payload: { a: '1' } },
      }),
    );
    await pause(100);
    expect(visitCalls()).toEqual([]);
  });
});
