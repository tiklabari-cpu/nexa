/**
 * The widget's half of campaign delivery (FR-MOD-03.3.2, tm 176.3): the poll
 * response's `campaign` field (`GET /customer/chat`, wired up in tm 176.2)
 * reaching the visitor as a proactive card.
 *
 * Deliberately not a second card system — this reuses the one proactive-card
 * slot the greeting (FR-MOD-11.2) already owns: same element, same
 * `GREETING` frame size, same "dismiss for the session" storage pattern, just
 * a different message and a different dismissal key. `widget.ts#activeCard`
 * is where the "campaign wins when both are pending" decision lives.
 *
 * Synchronisation throughout waits on `chatPolls` (how many times the mock
 * has answered `GET /customer/chat`), not on the card's `hidden` flag — the
 * plain greeting is already showing the instant the widget mounts (nothing
 * dismissed it yet), so `hidden` flips to `false` before the connect this
 * file is about has even started, and would make a `waitFor` on it resolve
 * without actually waiting for anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

const API = 'https://api.test/v1';

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

let calls: FetchCall[] = [];
/** How many `GET /customer/chat` calls the mock has answered so far. */
let chatPolls = 0;
/** Overridable per test: what the Nth (1-based) poll offers, if anything. */
let campaignAt: (poll: number) => { id: string; message: string } | null = () => null;

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });

      if (url.includes('/customer/token')) {
        return jsonResponse({ token: 'tok', customer_id: 'cust-1', pre_chat_form: [] });
      }
      if (url.includes('/customer/chat/sale')) {
        return jsonResponse({ id: 'sale-1' });
      }
      if (url.includes('/customer/chat/events')) {
        return jsonResponse({ chat_id: 'chat-1', event: null });
      }
      // Exact match only — the routes above also contain this substring.
      if (url.endsWith('/customer/chat')) {
        chatPolls += 1;
        return jsonResponse({
          online: true,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: null,
          chat: null,
          events: [],
          campaign: campaignAt(chatPolls),
        });
      }
      return jsonResponse({});
    }),
  );
}

function mountWidget(): HTMLElement {
  window.history.replaceState({}, '', `/widget.html?organization_id=org-1&api=${API}`);
  const root = document.createElement('div');
  root.id = 'nexa-widget-root';
  document.body.append(root);
  mount(document, window);
  return root;
}

/**
 * Connects the widget the way a checkout confirmation page would — via a
 * relayed `nexa('trackSale', …)` — without ever opening the panel. This is
 * the cleanest way to prove the card can appear from a poll the visitor never
 * triggered by clicking anything, which is the whole point of it being
 * "proactive": FR-MOD-03.3.2 reuses the greeting's poll for exactly this.
 */
function connectWithoutOpening(): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: {
        type: 'nexa:command',
        command: 'trackSale',
        payload: { external_order_id: 'o-1', amount_cents: 100, currency: 'USD' },
      },
    }),
  );
}

function card(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('.nx-greeting')!;
}

function cardMessage(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('.nx-greet-msg')!;
}

async function waitForPoll(n: number): Promise<void> {
  await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(n));
}

beforeEach(() => {
  calls = [];
  chatPolls = 0;
  campaignAt = () => null;
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.localStorage.clear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
});

describe('widget campaign card (FR-MOD-03.3.2)', () => {
  it('shows the workspace message as-is, with the translated CTAs, panel still closed', async () => {
    campaignAt = () => ({ id: 'camp-1', message: 'Questions about pricing? We are here.' });
    const root = mountWidget();
    connectWithoutOpening();
    await waitForPoll(1);

    expect(card(root).hidden).toBe(false);
    expect(cardMessage(root).textContent).toBe('Questions about pricing? We are here.');
    // The translated CTAs the greeting already had — no second vocabulary.
    expect(root.querySelector<HTMLElement>('.nx-greet-chat')!.textContent).toBe("Let's chat");
    expect(root.querySelector<HTMLElement>('.nx-greet-browse')!.textContent).toBe('Just browsing');
    // The panel itself never opened — this reached the visitor without a click.
    expect(root.querySelector<HTMLElement>('.nx-panel')!.hidden).toBe(true);
  });

  it('keeps a workspace-authored <script> as inert text (NFR-S6)', async () => {
    campaignAt = () => ({ id: 'camp-1', message: '<script>alert(1)</script> nice price!' });
    const root = mountWidget();
    connectWithoutOpening();
    await waitForPoll(1);

    expect(cardMessage(root).textContent).toBe('<script>alert(1)</script> nice price!');
    // textContent, never innerHTML: no element was parsed out of the string.
    expect(cardMessage(root).querySelector('script')).toBeNull();
    expect(cardMessage(root).children).toHaveLength(0);
  });

  it('wins over an undismissed greeting — one slot, the targeted message takes it', async () => {
    campaignAt = () => ({ id: 'camp-1', message: 'Free shipping today only.' });
    const root = mountWidget();
    connectWithoutOpening();
    await waitForPoll(1);

    expect(card(root).dataset['kind']).toBe('campaign');
    expect(cardMessage(root).textContent).toBe('Free shipping today only.');
    expect(cardMessage(root).textContent).not.toMatch(/Have a question/);
  });

  it('falls back to the greeting once nothing is owed', async () => {
    campaignAt = () => null;
    const root = mountWidget();
    connectWithoutOpening();
    await waitForPoll(1);

    expect(card(root).hidden).toBe(false);
    expect(card(root).dataset['kind']).toBe('greeting');
    expect(cardMessage(root).textContent).toMatch(/Have a question/);
  });

  it("the CTA opens straight into the pre-chat form, same as the greeting's", async () => {
    campaignAt = () => ({ id: 'camp-1', message: 'Free shipping today only.' });
    const root = mountWidget();
    connectWithoutOpening();
    await waitForPoll(1);
    expect(card(root).dataset['kind']).toBe('campaign');

    root.querySelector<HTMLButtonElement>('.nx-greet-chat')!.click();

    expect(root.querySelector<HTMLElement>('.nx-panel')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.nx-prechat')!.hidden).toBe(false);
    expect(card(root).hidden).toBe(true);
  });

  it('dismissing is keyed per campaign id — a later, different campaign still shows', async () => {
    campaignAt = (poll) =>
      poll <= 1
        ? { id: 'camp-1', message: 'First offer.' }
        : { id: 'camp-2', message: 'Second offer.' };

    vi.useFakeTimers();
    const root = mountWidget();
    connectWithoutOpening();
    await waitForPoll(1);
    expect(cardMessage(root).textContent).toBe('First offer.');

    root.querySelector<HTMLButtonElement>('.nx-greet-browse')!.click();
    expect(card(root).hidden).toBe(true);

    // The background poll keeps running with the panel closed the whole time
    // (tm 176.3 widened it past "only while open") — this is what discovers
    // the second, different campaign. It runs at the closed cadence, which
    // tm 195.1 slowed from 4 s to 30 s when it started connecting returning
    // visitors at mount: a nudge is not worth 900 requests an hour from every
    // idle tab.
    await vi.advanceTimersByTimeAsync(30_000);
    await waitForPoll(2);
    expect(card(root).hidden).toBe(false);
    expect(cardMessage(root).textContent).toBe('Second offer.');
  });

  it('dismissing a campaign also suppresses the plain greeting for the rest of the session', async () => {
    campaignAt = (poll) => (poll <= 1 ? { id: 'camp-1', message: 'First offer.' } : null);

    vi.useFakeTimers();
    const root = mountWidget();
    connectWithoutOpening();
    await waitForPoll(1);
    expect(card(root).dataset['kind']).toBe('campaign');

    root.querySelector<HTMLButtonElement>('.nx-greet-browse')!.click();
    expect(card(root).hidden).toBe(true);

    // No campaign left to offer on the next poll — a downgrade to the generic
    // greeting is exactly what this dismissal was meant to also rule out.
    // Closed cadence, same as above (tm 195.1).
    await vi.advanceTimersByTimeAsync(30_000);
    await waitForPoll(2);
    expect(card(root).hidden).toBe(true);
  });

  it('a fresh reload does not re-offer a campaign already dismissed this session', async () => {
    campaignAt = () => ({ id: 'camp-1', message: 'First offer.' });
    const root = mountWidget();
    connectWithoutOpening();
    await waitForPoll(1);

    root.querySelector<HTMLButtonElement>('.nx-greet-browse')!.click();

    // Simulates the server somehow answering with the same send again — the
    // real server never would (at-most-once, campaign-delivery.ts), but this
    // isolates the widget's own session-storage guard from that guarantee.
    document.head.replaceChildren();
    document.body.replaceChildren();
    const reloaded = mountWidget();
    connectWithoutOpening();
    await waitForPoll(2);

    expect(card(reloaded).hidden).toBe(true);
  });
});
