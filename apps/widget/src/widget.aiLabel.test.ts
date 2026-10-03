/**
 * The "AI" mark on a reply (FR-MOD-11.3, tm 257.17).
 *
 * `author_type: 'bot'` is three different authors: the LLM AI Agent, a rule bot
 * following a script, and an API bot token posting on an integration's behalf.
 * Telling a visitor "AI" about the second and third is untrue, so the mark keys
 * on the AI Agent's own `author_id` — and a reply an agent polished with the
 * Copilot before sending is `agent`, a person's message, and carries nothing.
 *
 * Asserted against the transcript the widget really builds (`renderBubble` is
 * not exported); a test of a predicate alone would have passed with the mark
 * wired to the wrong event.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_BOT_ID } from '@siyahtus/types';
import { mount } from './widget.js';

const API = 'https://api.test/v1';

interface Event {
  id: string;
  text: string | null;
  author_type: 'agent' | 'customer' | 'bot' | 'system';
  author_id?: string | null;
  created_at: string;
  type: string;
  attachment_url: string | null;
}

function message(id: string, author: Event['author_type'], authorId?: string | null): Event {
  return {
    id,
    text: `text of ${id}`,
    author_type: author,
    ...(authorId === undefined ? {} : { author_id: authorId }),
    created_at: '2026-10-03T10:00:00.000Z',
    type: 'message',
    attachment_url: null,
  };
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

let events: Event[] = [];
let chatPolls = 0;

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

async function openTranscript(language = 'en'): Promise<HTMLElement> {
  window.history.replaceState(
    {},
    '',
    `/widget.html?organization_id=org-1&api=${API}&language=${language}`,
  );
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mount(document, window);
  root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
  await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(1));
  await vi.waitFor(() =>
    expect(root.querySelectorAll('.nx-bubble').length).toBeGreaterThanOrEqual(events.length),
  );
  return root;
}

/** The row holding a given message, found by its text. */
function rowOf(root: HTMLElement, id: string): HTMLElement {
  const bubble = [...root.querySelectorAll<HTMLElement>('.nx-bubble')].find(
    (b) => b.textContent === `text of ${id}`,
  );
  if (!bubble?.parentElement) throw new Error(`no row for ${id}`);
  return bubble.parentElement;
}

beforeEach(() => {
  events = [];
  chatPolls = 0;
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

describe('widget AI mark (FR-MOD-11.3)', () => {
  it('marks the AI Agent’s reply, beside the time and outside the bubble', async () => {
    events = [message('ai', 'bot', AI_BOT_ID)];
    const root = await openTranscript();
    const row = rowOf(root, 'ai');

    const mark = row.querySelector<HTMLElement>('.nx-ai-label');
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe('AI');
    expect(mark!.getAttribute('aria-label')).toBe('Reply written by AI');
    // Outside the bubble, so copying the message does not copy the mark …
    expect(row.querySelector('.nx-bubble')!.contains(mark)).toBe(false);
    expect(row.querySelector('.nx-bubble')!.textContent).toBe('text of ai');
    // … and next to the clock it belongs with.
    expect(mark!.parentElement).toBe(row.querySelector('time')!.parentElement);
  });

  it('does not mark a rule bot’s message', async () => {
    events = [message('rule', 'bot', 'rule-bot-7')];
    const root = await openTranscript();
    expect(rowOf(root, 'rule').querySelector('.nx-ai-label')).toBeNull();
  });

  it('does not mark an API bot token’s message', async () => {
    events = [message('api', 'bot', '9f1c2a7e-0000-4000-8000-000000000001')];
    const root = await openTranscript();
    expect(rowOf(root, 'api').querySelector('.nx-ai-label')).toBeNull();
  });

  it('does not mark a bot message that arrives without an author id', async () => {
    events = [message('old', 'bot'), message('nul', 'bot', null)];
    const root = await openTranscript();
    expect(rowOf(root, 'old').querySelector('.nx-ai-label')).toBeNull();
    expect(rowOf(root, 'nul').querySelector('.nx-ai-label')).toBeNull();
  });

  it('does not mark an agent’s message, even one carrying the AI Agent’s id', async () => {
    // What a Copilot-improved reply looks like: a person sent it.
    events = [message('agent', 'agent', AI_BOT_ID), message('visitor', 'customer', AI_BOT_ID)];
    const root = await openTranscript();
    expect(rowOf(root, 'agent').querySelector('.nx-ai-label')).toBeNull();
    expect(rowOf(root, 'visitor').querySelector('.nx-ai-label')).toBeNull();
  });

  it('says it in the visitor’s language', async () => {
    events = [message('ai', 'bot', AI_BOT_ID)];
    const root = await openTranscript('tr');
    const mark = rowOf(root, 'ai').querySelector<HTMLElement>('.nx-ai-label')!;
    expect(mark.textContent).toBe('Yapay zekâ');
    expect(mark.getAttribute('aria-label')).toBe('Yanıt yapay zekâ tarafından yazıldı');
  });

  it('keeps an unmarked row exactly as it was — bubble then time', async () => {
    events = [message('agent', 'agent')];
    const root = await openTranscript();
    const row = rowOf(root, 'agent');
    expect([...row.children].map((c) => c.tagName)).toEqual(['DIV', 'TIME']);
  });
});
