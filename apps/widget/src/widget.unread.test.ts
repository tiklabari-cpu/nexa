/**
 * The launcher's unread badge and the closed-panel poll that feeds it
 * (FR-MOD-11.1, tm 195.1).
 *
 * The gap this closes had two halves. The badge did not exist at all — the
 * launcher carried a word and nothing else. And nothing could have driven one:
 * the widget only connected when the panel was opened, so a returning visitor
 * who reloaded the shop's page and left the panel shut never learned an agent
 * had answered, however long they stayed.
 *
 * Both halves are asserted here, and so are the two decisions behind them: the
 * closed panel polls at 30 s rather than the open panel's 4 s, and "read" is a
 * watermark in `localStorage` rather than an in-memory counter — the reply the
 * badge exists for usually arrives after the tab is gone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

const API = 'https://api.test/v1';

interface Event {
  id: string;
  text: string | null;
  author_type: 'agent' | 'customer' | 'bot' | 'system';
  created_at: string;
  type: string;
  attachment_url: string | null;
}

function message(
  id: string,
  author: Event['author_type'],
  createdAt: string,
  type = 'message',
): Event {
  return {
    id,
    text: `${author} ${id}`,
    author_type: author,
    created_at: createdAt,
    type,
    attachment_url: null,
  };
}

const AGENT_REPLY = message('e2', 'agent', '2026-09-05T10:00:02.000Z');
const VISITOR_ASK = message('e1', 'customer', '2026-09-05T10:00:01.000Z');

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

let chatPolls = 0;
let tokenMints = 0;
/** Overridable per test: the transcript the Nth (1-based) poll answers with. */
let eventsAt: (poll: number) => Event[] = () => [];

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/customer/token')) {
        tokenMints += 1;
        return jsonResponse({ token: 'tok', customer_id: 'cust-1', pre_chat_form: [] });
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
  root.id = 'nexa-widget-root';
  document.body.append(root);
  mount(document, window);
  return root;
}

/** Simulate the visitor having chatted here before — what `connect` stores. */
function returningVisitor(): void {
  window.localStorage.setItem('nexa.customer_id', 'cust-1');
}

function launcher(root: HTMLElement): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>('.nx-launcher')!;
}

function badge(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('.nx-badge')!;
}

/**
 * Drain the promise chain a mount kicks off, without touching the clock — the
 * cadence test runs on fake timers, where anything that sleeps for real would
 * simply never wake.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

async function waitForPoll(n: number): Promise<void> {
  await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(n));
  // The counter ticks when the mock answers; the widget renders a promise
  // chain later. Without this, a negative assertion ("still no badge") can
  // pass by arriving before the paint it is meant to be about.
  await new Promise((resolve) => setTimeout(resolve, 5));
}

beforeEach(() => {
  chatPolls = 0;
  tokenMints = 0;
  eventsAt = () => [];
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

describe('widget unread badge (FR-MOD-11.1)', () => {
  it('badges a reply that arrives with the panel closed, and clears it on open', async () => {
    eventsAt = () => [VISITOR_ASK, AGENT_REPLY];
    returningVisitor();
    const root = mountWidget();
    await waitForPoll(1);

    // The panel never opened — this is the state the widget had no way to
    // reach before, and the badge is the whole point of reaching it.
    expect(root.querySelector<HTMLElement>('.nx-panel')!.hidden).toBe(true);
    expect(badge(root).hidden).toBe(false);
    expect(badge(root).textContent).toBe('1');
    // The count is on the button's own name, not left to the badge to say.
    expect(launcher(root).getAttribute('aria-label')).toBe('Open chat (1 unread)');

    launcher(root).click();

    expect(badge(root).hidden).toBe(true);
    expect(badge(root).textContent).toBe('');
    expect(launcher(root).getAttribute('aria-label')).toBe('Close chat');
  });

  it('renders no badge at zero — an empty bubble on every launcher means nothing', async () => {
    eventsAt = () => [VISITOR_ASK];
    returningVisitor();
    const root = mountWidget();
    await waitForPoll(1);

    expect(badge(root).hidden).toBe(true);
    expect(launcher(root).getAttribute('aria-label')).toBe('Open chat');
  });

  it('counts only messages from the team — not the visitor, not a system notice', async () => {
    eventsAt = () => [
      VISITOR_ASK,
      AGENT_REPLY,
      message('e3', 'bot', '2026-09-05T10:00:03.000Z'),
      message('e4', 'customer', '2026-09-05T10:00:04.000Z'),
      message('e5', 'system', '2026-09-05T10:00:05.000Z', 'system_message'),
    ];
    returningVisitor();
    const root = mountWidget();
    await waitForPoll(1);

    // The agent's and the AI's, and nothing else: two.
    expect(badge(root).textContent).toBe('2');
  });

  it('caps the number the 64 px launcher shows', async () => {
    eventsAt = () =>
      Array.from({ length: 12 }, (_, i) =>
        message(`e${i}`, 'agent', `2026-09-05T10:00:${String(i).padStart(2, '0')}.000Z`),
      );
    returningVisitor();
    const root = mountWidget();
    await waitForPoll(1);

    expect(badge(root).textContent).toBe('9+');
    // …but the accessible name still says how many, where there is room.
    expect(launcher(root).getAttribute('aria-label')).toBe('Open chat (12 unread)');
  });

  /**
   * The decision, asserted by name: "read" is a `localStorage` watermark, so a
   * reload does NOT resurrect a badge the visitor already answered — and does
   * not lose one they never saw. A `sessionStorage` counter would have failed
   * the second of these, which is the case the feature exists for.
   */
  it('remembers what was read across a reload, and keeps badging what was not', async () => {
    eventsAt = () => [VISITOR_ASK, AGENT_REPLY];
    returningVisitor();
    const first = mountWidget();
    await waitForPoll(1);
    expect(badge(first).textContent).toBe('1');

    // The visitor reads it.
    launcher(first).click();
    expect(badge(first).hidden).toBe(true);

    // A reload: same browser, same stored identity, same transcript.
    document.head.replaceChildren();
    document.body.replaceChildren();
    const reloaded = mountWidget();
    await waitForPoll(2);
    expect(badge(reloaded).hidden).toBe(true);

    // Now a reply lands that they have not seen — the panel is closed and the
    // widget only just booted, which is exactly the tab-was-gone case.
    document.head.replaceChildren();
    document.body.replaceChildren();
    eventsAt = () => [VISITOR_ASK, AGENT_REPLY, message('e9', 'agent', '2026-09-05T11:00:00.000Z')];
    const later = mountWidget();
    await waitForPoll(3);

    expect(badge(later).hidden).toBe(false);
    expect(badge(later).textContent).toBe('1');
  });

  it('lights the launcher for a proactive card too, and drops it when dismissed', async () => {
    const root = mountWidget();

    // The greeting owns the card slot from the first frame; it has no number
    // to show, so the animation is its half of the KK's "badge/animation".
    expect(launcher(root).classList.contains('nx-attention')).toBe(true);

    root.querySelector<HTMLButtonElement>('.nx-greet-browse')!.click();
    expect(launcher(root).classList.contains('nx-attention')).toBe(false);
  });
});

describe('widget closed-panel polling (FR-MOD-11.1)', () => {
  it('connects at mount for a returning visitor, and leaves a first-time one alone', async () => {
    // Nobody has chatted here: no identity is minted for someone merely
    // looking at the page, and nothing could be unread for them anyway.
    const stranger = mountWidget();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(tokenMints).toBe(0);
    expect(chatPolls).toBe(0);
    expect(badge(stranger).hidden).toBe(true);

    document.head.replaceChildren();
    document.body.replaceChildren();
    returningVisitor();
    mountWidget();
    await waitForPoll(1);
    expect(tokenMints).toBe(1);
  });

  it('polls at 30 s while closed and at 4 s once open', async () => {
    eventsAt = () => [VISITOR_ASK];
    returningVisitor();
    vi.useFakeTimers();
    const root = mountWidget();
    await settle();
    expect(chatPolls).toBe(1); // the connect the mount started

    // Four seconds is the open panel's budget, and a closed one does not get
    // it: 900 requests an hour from an idle tab buys nothing a badge needs.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(chatPolls).toBe(1);

    await vi.advanceTimersByTimeAsync(26_000);
    expect(chatPolls).toBe(2);

    // Opening switches cadence immediately rather than waiting out the 30 s
    // already on the clock — the visitor is watching the transcript now, and
    // half a minute of nothing is what "live chat" cannot look like.
    launcher(root).click();
    await settle();
    expect(chatPolls).toBe(3);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(chatPolls).toBe(4);
  });
});
