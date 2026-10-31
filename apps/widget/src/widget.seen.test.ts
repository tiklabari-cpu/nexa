/**
 * The read receipt the widget sends (IN-05 · tm 362).
 *
 * A receipt says "the player has had the team's messages in front of them", so
 * it is sent only when that is true: panel open, tab visible, list at the
 * newest message — and a second after, not at once. A message that arrived
 * while the panel was shut or the tab in the background was not read, and a
 * missing receipt is better than a wrong one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';
import { storageKeys } from './api.js';

const mounted: Array<() => void> = [];

const API = 'https://api.test/v1';

interface Event {
  id: string;
  text: string | null;
  author_type: 'agent' | 'customer' | 'bot' | 'system';
  created_at: string;
  type: string;
  attachment_url: string | null;
}

function message(id: string, author: Event['author_type'], createdAt: string): Event {
  return {
    id,
    text: `${author} ${id}`,
    author_type: author,
    created_at: createdAt,
    type: 'message',
    attachment_url: null,
  };
}

const VISITOR_ASK = message('e1', 'customer', '2026-10-31T10:00:01.000Z');
const AGENT_REPLY = message('e2', 'agent', '2026-10-31T10:00:02.000Z');

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

let chatPolls = 0;
let eventsAt: (poll: number) => Event[] = () => [];
/** The bodies of every `POST /customer/chat/seen` the widget made. */
let seenCalls: Array<{ seen_up_to: string }> = [];
let seenStatus = 204;
let visibility: DocumentVisibilityState = 'visible';

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/customer/token')) {
        return jsonResponse({ token: 'tok', customer_id: 'cust-1', pre_chat_form: [] });
      }
      if (url.endsWith('/customer/chat/seen')) {
        seenCalls.push(JSON.parse(String(init?.body)) as { seen_up_to: string });
        return jsonResponse({}, seenStatus);
      }
      if (url.endsWith('/customer/chat')) {
        chatPolls += 1;
        return jsonResponse({
          online: true,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: null,
          chat: { id: 'chat-1', thread_id: 'thr-1', queue_position: null },
          events: eventsAt(chatPolls),
          campaign: null,
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

function returningVisitor(): void {
  window.localStorage.setItem(storageKeys('org-1').customerId, 'cust-1');
}

function launcher(root: HTMLElement): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>('.nx-launcher')!;
}

async function waitForPoll(n: number): Promise<void> {
  await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(n));
  await new Promise((resolve) => setTimeout(resolve, 5));
}

/** Longer than the one-second delay, so "nothing was sent" means it. */
const PAST_THE_DELAY_MS = 1_300;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  chatPolls = 0;
  eventsAt = () => [VISITOR_ASK, AGENT_REPLY];
  seenCalls = [];
  seenStatus = 204;
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.localStorage.clear();
  stubFetch();
});

afterEach(() => {
  for (const stop of mounted.splice(0)) stop();
  vi.unstubAllGlobals();
  delete (document as { visibilityState?: unknown }).visibilityState;
  window.history.replaceState({}, '', '/');
});

describe('widget read receipt (IN-05)', () => {
  it("sends the newest team message's time a second after the panel is open and visible", async () => {
    returningVisitor();
    const root = mountWidget();
    await waitForPoll(1);
    launcher(root).click();

    // Not at once: a second is the pause that lets a reply be seen rather than
    // merely rendered.
    expect(seenCalls).toHaveLength(0);
    await vi.waitFor(() => expect(seenCalls).toHaveLength(1), { timeout: 3_000 });
    expect(seenCalls[0]).toEqual({ seen_up_to: AGENT_REPLY.created_at });
  });

  it('sends nothing while the panel is minimised — the reply was never on screen', async () => {
    returningVisitor();
    mountWidget();
    await waitForPoll(1);

    await pause(PAST_THE_DELAY_MS);
    expect(seenCalls).toHaveLength(0);
  });

  it('sends nothing from a background tab, and sends once it comes back to the front', async () => {
    visibility = 'hidden';
    returningVisitor();
    const root = mountWidget();
    await waitForPoll(1);
    launcher(root).click();

    await pause(PAST_THE_DELAY_MS);
    expect(seenCalls).toHaveLength(0);

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(seenCalls).toHaveLength(1), { timeout: 3_000 });
  });

  it('waits for the list to be at the newest message', async () => {
    returningVisitor();
    const root = mountWidget();
    await waitForPoll(1);

    // The visitor has scrolled back through history: the newest reply is below the fold.
    const list = root.querySelector<HTMLElement>('.nx-transcript')!;
    let scrollTop = 0;
    Object.defineProperty(list, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: () => undefined,
    });
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => 1_000 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => 300 });
    launcher(root).click();

    await pause(PAST_THE_DELAY_MS);
    expect(seenCalls).toHaveLength(0);

    scrollTop = 700;
    list.dispatchEvent(new Event('scroll'));
    await vi.waitFor(() => expect(seenCalls).toHaveLength(1), { timeout: 3_000 });
  });

  it('says nothing for a conversation with no message from the team', async () => {
    eventsAt = () => [VISITOR_ASK];
    returningVisitor();
    const root = mountWidget();
    await waitForPoll(1);
    launcher(root).click();

    await pause(PAST_THE_DELAY_MS);
    expect(seenCalls).toHaveLength(0);
  });

  it('does not repeat itself for a message it already reported', async () => {
    returningVisitor();
    const root = mountWidget();
    await waitForPoll(1);
    launcher(root).click();
    await vi.waitFor(() => expect(seenCalls).toHaveLength(1), { timeout: 3_000 });

    document.dispatchEvent(new Event('visibilitychange'));
    await pause(PAST_THE_DELAY_MS);
    expect(seenCalls).toHaveLength(1);
  });

  it('tries again after a refused call, rather than believing it was recorded', async () => {
    seenStatus = 429;
    returningVisitor();
    const root = mountWidget();
    await waitForPoll(1);
    launcher(root).click();
    await vi.waitFor(() => expect(seenCalls).toHaveLength(1), { timeout: 3_000 });
    await pause(20);

    seenStatus = 204;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(seenCalls).toHaveLength(2), { timeout: 3_000 });
  });
});
