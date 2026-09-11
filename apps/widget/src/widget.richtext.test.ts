/**
 * The agent's formatting as the visitor reads it (FR-MOD-11.4, tm 235).
 *
 * The gap this closes was silent in exactly the way that matters: the console
 * offered bold/italic/list buttons and rendered them in the agent's own
 * transcript, so from the answering side everything looked right. The widget
 * printed the identical string with `textContent`, so the customer — the only
 * person the message was for — read the asterisks.
 *
 * Three claims are made here, and the first two are the whole decision:
 *
 *   1. **The team's side is parsed.** Agent and bot alike, since the persona
 *      answers for the team.
 *   2. **The visitor's side is not.** The same input in a customer bubble
 *      stays character-for-character what they typed — a product rule, not a
 *      safety one (`#### K02.3.5`).
 *   3. **Nothing becomes markup.** Markup in a message is characters on both
 *      sides, whatever the author type, which is the NFR-S6 guarantee the
 *      widget has always made and must not lose by gaining a renderer.
 *
 * Asserted against the real transcript the widget builds — `renderBubble` is
 * not exported, and a test of the parser alone would have passed both before
 * and after this change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';
import { appendRichText } from './rich-text.js';

const API = 'https://api.test/v1';

interface Event {
  id: string;
  text: string | null;
  author_type: 'agent' | 'customer' | 'bot' | 'system';
  created_at: string;
  type: string;
  attachment_url: string | null;
}

function message(id: string, author: Event['author_type'], text: string): Event {
  return {
    id,
    text,
    author_type: author,
    created_at: '2026-09-11T10:00:00.000Z',
    type: 'message',
    attachment_url: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

let chatPolls = 0;
let events: Event[] = [];

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/customer/token')) {
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
          events,
          campaign: null,
        });
      }
      return jsonResponse({});
    }),
  );
}

/** Opens the panel, so the transcript is actually built and polling starts. */
async function openTranscript(): Promise<HTMLElement> {
  window.history.replaceState({}, '', `/widget.html?organization_id=org-1&api=${API}`);
  const root = document.createElement('div');
  root.id = 'nexa-widget-root';
  document.body.append(root);
  mount(document, window);
  root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
  await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(1));
  await vi.waitFor(() =>
    expect(root.querySelectorAll('.nx-bubble').length).toBeGreaterThanOrEqual(events.length),
  );
  return root;
}

function bubbles(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('.nx-bubble')];
}

beforeEach(() => {
  chatPolls = 0;
  events = [];
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.localStorage.clear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('widget transcript rich text (FR-MOD-11.4)', () => {
  it("renders the agent's bold, italic and list markers as the console does", async () => {
    events = [message('e1', 'agent', 'This is **important** and *this* matters\n- one\n- two')];
    const [bubble] = bubbles(await openTranscript());

    expect(bubble!.querySelector('strong')!.textContent).toBe('important');
    expect(bubble!.querySelector('em')!.textContent).toBe('this');
    // The markers are gone from what the visitor reads — the actual complaint.
    expect(bubble!.textContent).not.toContain('*');
    expect(bubble!.textContent).toContain('• one\n• two');
  });

  it('formats the AI persona too — it answers for the team', async () => {
    events = [message('e1', 'bot', 'Your order is **on its way**')];
    const [bubble] = bubbles(await openTranscript());

    expect(bubble!.querySelector('strong')!.textContent).toBe('on its way');
  });

  it("leaves the visitor's own asterisks exactly as they typed them", async () => {
    const typed = 'I want the **big** one, *please*\n- in blue';
    events = [message('e1', 'customer', typed), message('e2', 'agent', typed)];
    const [visitor, agent] = bubbles(await openTranscript());

    // Same string, two authors, two different readings — this is the rule.
    expect(visitor!.textContent).toBe(typed);
    expect(visitor!.querySelector('strong')).toBeNull();
    expect(visitor!.querySelector('em')).toBeNull();
    expect(agent!.querySelector('strong')!.textContent).toBe('big');
  });

  it('never turns markup into elements, from either side (NFR-S6)', async () => {
    const attack = '<img src=x onerror=alert(1)> **<script>alert(1)</script>**';
    events = [message('e1', 'agent', attack), message('e2', 'customer', attack)];
    const [fromAgent, fromVisitor] = bubbles(await openTranscript());

    for (const bubble of [fromAgent!, fromVisitor!]) {
      expect(bubble.querySelector('img')).toBeNull();
      expect(bubble.querySelector('script')).toBeNull();
      // The characters survive; only their meaning as markup does not.
      expect(bubble.textContent).toContain('<img src=x onerror=alert(1)>');
      expect(bubble.textContent).toContain('<script>alert(1)</script>');
    }
    // The agent's emphasis still applied around the inert text.
    expect(fromAgent!.querySelector('strong')!.textContent).toBe('<script>alert(1)</script>');
  });

  it('appends to whatever it is given without clearing it', () => {
    // `renderBubble` appends the attachment after the text; a renderer that
    // assigned instead of appending would drop it.
    const host = document.createElement('div');
    host.append(document.createTextNode('before '));
    appendRichText(document, host, '**after**');

    expect(host.childNodes).toHaveLength(2);
    expect(host.textContent).toBe('before after');
  });
});
