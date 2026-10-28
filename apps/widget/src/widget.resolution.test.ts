/**
 * "Is it solved?" Yes / No (tm 320.1 · SiyahTuş analysis AI-25-S2, K9).
 *
 * Under the AI's newest message when it asked "is it solved?" or said so
 * (event property `resolution_prompt`), while the AI has the open connection.
 * Anything newer — the visitor's words, the AI's thanks — and a person or
 * the queue taking the connection hide them. A press posts
 * `/customer/chat/resolution` once with the answer; the buttons stay away
 * for that message afterwards, and come back when the press failed. Real
 * `<button>`s in a group named by the question, in the visitor's language.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

const mounted: Array<() => void> = [];

const API = 'https://api.test/v1';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

interface Event {
  id: string;
  text: string;
  author_type: 'customer' | 'bot' | 'agent';
  author_id?: string;
  created_at: string;
  type: 'message';
  attachment_url: null;
  properties?: Record<string, unknown>;
}

const question = (prompt: string | null): Event => ({
  id: 'e2',
  text: 'Sorununuz çözüldü mü?',
  author_type: 'bot',
  author_id: 'ai-agent',
  created_at: '2026-10-27T10:00:05.000Z',
  type: 'message',
  attachment_url: null,
  ...(prompt ? { properties: { resolution_prompt: prompt } } : {}),
});

let owner: 'ai' | 'human' | 'queue' = 'ai';
let events: Event[] = [];
let polls = 0;
let answers: unknown[] = [];
let answerStatus = 200;

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/customer/token')) {
        return jsonResponse({ token: 'tok', customer_id: 'cust-1', pre_chat_form: [] });
      }
      if (url.endsWith('/customer/chat/resolution')) {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body)) as { answer: 'yes' | 'no' };
        answers.push(body);
        if (answerStatus !== 200) {
          return jsonResponse({ error: { type: 'internal', message: 'no' } }, answerStatus);
        }
        if (body.answer === 'no') owner = 'queue';
        return jsonResponse({
          answer: body.answer,
          recorded: true,
          owner,
          human_available: true,
        });
      }
      if (url.endsWith('/customer/chat')) {
        polls += 1;
        return jsonResponse({
          online: true,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: null,
          chat: { id: 'chat-1', thread_id: 'thr-1', queue_position: null },
          events: [
            {
              id: 'e1',
              text: 'Param yatmadı',
              author_type: 'customer',
              created_at: '2026-10-27T10:00:00.000Z',
              type: 'message',
              attachment_url: null,
            },
            ...events,
          ],
          campaign: null,
          owner,
          human_available: true,
          human_button_label: 'Talk to an agent',
        });
      }
      return jsonResponse({});
    }),
  );
}

async function open(language = 'en'): Promise<HTMLElement> {
  window.history.replaceState(
    {},
    '',
    `/widget.html?organization_id=org-1&api=${API}&language=${language}`,
  );
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mounted.push(mount(document, window));
  root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
  await vi.waitFor(() => expect(polls).toBeGreaterThanOrEqual(1));
  return root;
}

const group = (root: HTMLElement) => root.querySelector<HTMLElement>('.nx-resolution')!;
const yes = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.nx-resolution-yes')!;
const no = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.nx-resolution-no')!;

beforeEach(() => {
  owner = 'ai';
  events = [question('asked')];
  polls = 0;
  answers = [];
  answerStatus = 200;
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

describe('"Is it solved?" Yes / No (AI-25-S2)', () => {
  it('shows under the AI’s prompt as a named group of two real buttons', async () => {
    const root = await open('en');
    await vi.waitFor(() => expect(group(root).hidden).toBe(false));
    expect(group(root).getAttribute('role')).toBe('group');
    expect(group(root).getAttribute('aria-label')).toBe('Was your problem solved?');
    expect(yes(root).tagName).toBe('BUTTON');
    expect(yes(root).type).toBe('button');
    expect(yes(root).textContent).toBe('Yes, solved');
    expect(no(root).textContent).toBe('No');
  });

  it('speaks the visitor’s language', async () => {
    const root = await open('tr');
    await vi.waitFor(() => expect(group(root).hidden).toBe(false));
    expect(group(root).getAttribute('aria-label')).toBe('Sorununuz çözüldü mü?');
    expect(yes(root).textContent).toBe('Evet, çözüldü');
    expect(no(root).textContent).toBe('Hayır');
  });

  it('shows too when the AI said it is solved without asking', async () => {
    events = [question('resolved')];
    const root = await open();
    await vi.waitFor(() => expect(group(root).hidden).toBe(false));
  });

  it('stays hidden under an AI message that asks nothing', async () => {
    events = [question(null)];
    const root = await open();
    await vi.waitFor(() => expect(polls).toBeGreaterThanOrEqual(1));
    expect(group(root).hidden).toBe(true);
  });

  it('stays hidden when something newer was written after the prompt', async () => {
    events = [
      question('asked'),
      {
        id: 'e3',
        text: 'Bir sorum daha var',
        author_type: 'customer',
        created_at: '2026-10-27T10:00:09.000Z',
        type: 'message',
        attachment_url: null,
      },
    ];
    const root = await open();
    await vi.waitFor(() => expect(polls).toBeGreaterThanOrEqual(1));
    expect(group(root).hidden).toBe(true);
  });

  it('stays hidden while a person or the queue has the connection', async () => {
    owner = 'queue';
    const root = await open();
    await vi.waitFor(() => expect(polls).toBeGreaterThanOrEqual(1));
    expect(group(root).hidden).toBe(true);
  });

  it('Yes posts the answer once and the buttons go for that message', async () => {
    const root = await open();
    await vi.waitFor(() => expect(group(root).hidden).toBe(false));
    yes(root).click();
    yes(root).click();
    await vi.waitFor(() => expect(answers).toEqual([{ answer: 'yes' }]));
    expect(group(root).hidden).toBe(true);
  });

  it('No posts the answer and the queue taking the connection keeps them away', async () => {
    const root = await open();
    await vi.waitFor(() => expect(group(root).hidden).toBe(false));
    no(root).click();
    await vi.waitFor(() => expect(answers).toEqual([{ answer: 'no' }]));
    expect(group(root).hidden).toBe(true);
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLButtonElement>('.nx-human')!.hidden).toBe(true),
    );
  });

  it('a failed press brings the buttons back', async () => {
    answerStatus = 500;
    const root = await open();
    await vi.waitFor(() => expect(group(root).hidden).toBe(false));
    yes(root).click();
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    await vi.waitFor(() => expect(group(root).hidden).toBe(false));
  });
});
