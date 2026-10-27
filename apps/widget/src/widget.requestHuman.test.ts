/**
 * "Talk to an agent" (tm 308 · SiyahTuş analysis AI-29 §2, §3, §5 · G16).
 *
 * Shown while the AI has the open connection (`owner: 'ai'` on the poll) —
 * a person assigned or the queue hides it, and so does no connection at all;
 * the workspace may reword it, never hide it (AI-29-S1). Its words come
 * resolved from the server (the workspace's, or the default in the
 * conversation's language — the bundle carries none, NFR-P3). A press posts
 * `/customer/chat/request-human` once, says "Connecting…" in the visitor's
 * language while it waits and goes away when the answer names a person or
 * the queue. A real `<button>` with its words as its name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

const mounted: Array<() => void> = [];

const API = 'https://api.test/v1';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

let owner: 'ai' | 'human' | 'queue' | null = 'ai';
/** The button's words, as the server resolves them (the workspace's, or its default). */
let label: string | null = 'Talk to an agent';
let chat: { id: string; thread_id: string; queue_position: number | null } | null = null;
let polls = 0;
let presses = 0;
/** Holds the press's answer until the test lets it go. */
let releasePress: (() => void) | null = null;
let pressStatus = 200;

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/customer/token')) {
        return jsonResponse({ token: 'tok', customer_id: 'cust-1', pre_chat_form: [] });
      }
      if (url.endsWith('/customer/chat/request-human')) {
        presses += 1;
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ reason: 'button' });
        await new Promise<void>((resolve) => {
          releasePress = resolve;
        });
        if (pressStatus !== 200) {
          return jsonResponse({ error: { type: 'internal', message: 'no' } }, pressStatus);
        }
        owner = 'human';
        return jsonResponse({ owner: 'human', human_available: true, requested: true });
      }
      if (url.endsWith('/customer/chat')) {
        polls += 1;
        return jsonResponse({
          online: true,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: { name: 'Ada', avatar_url: null },
          chat,
          events: chat
            ? [
                {
                  id: 'e1',
                  text: 'Merhaba',
                  author_type: 'customer',
                  created_at: '2026-10-27T10:00:00.000Z',
                  type: 'message',
                  attachment_url: null,
                },
              ]
            : [],
          campaign: null,
          owner: chat ? owner : null,
          human_available: true,
          human_button_label: label,
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

const button = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.nx-human')!;

beforeEach(() => {
  owner = 'ai';
  label = 'Talk to an agent';
  chat = { id: 'chat-1', thread_id: 'thr-1', queue_position: null };
  polls = 0;
  presses = 0;
  releasePress = null;
  pressStatus = 200;
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.localStorage.clear();
  stubFetch();
});

afterEach(() => {
  releasePress?.();
  for (const stop of mounted.splice(0)) stop();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('"Talk to an agent" (AI-29)', () => {
  it('shows while the AI has the connection, as a named button the keyboard reaches', async () => {
    const root = await open('en');
    await vi.waitFor(() => expect(button(root).hidden).toBe(false));

    const human = button(root);
    expect(human.tagName).toBe('BUTTON');
    expect(human.type).toBe('button');
    expect(human.textContent).toBe('Talk to an agent');
    expect(human.disabled).toBe(false);
    human.focus();
    expect(document.activeElement).toBe(human);
  });

  it('says the words the server sends, in Turkish for a Turkish conversation', async () => {
    label = 'Temsilciyle görüş';
    const root = await open('tr');
    await vi.waitFor(() => expect(button(root).hidden).toBe(false));
    expect(button(root).textContent).toBe('Temsilciyle görüş');
  });

  it('says the workspace’s words when it reworded it — it cannot hide it', async () => {
    label = 'Canlı destek';
    const root = await open('tr');
    await vi.waitFor(() => expect(button(root).hidden).toBe(false));
    expect(button(root).textContent).toBe('Canlı destek');
  });

  it('is hidden when a person has the connection, in the queue, and with none open', async () => {
    for (const [state, open_] of [
      ['human', chat],
      ['queue', chat],
      ['ai', null],
    ] as const) {
      for (const stop of mounted.splice(0)) stop();
      document.body.replaceChildren();
      owner = state;
      chat = open_;
      polls = 0;
      const root = await open('en');
      // Anchored on the poll having drawn the panel: the header names Ada then.
      await vi.waitFor(() => expect(root.querySelector('.nx-title')!.textContent).toBe('Ada'));
      expect(button(root).hidden).toBe(true);
    }
  });

  it('posts once, says it is connecting while it waits, and goes once a person has it', async () => {
    const root = await open('tr');
    await vi.waitFor(() => expect(button(root).hidden).toBe(false));

    button(root).click();
    await vi.waitFor(() => expect(presses).toBe(1));
    expect(button(root).textContent).toBe('Temsilci bağlanıyor…');
    expect(button(root).disabled).toBe(true);
    // A second click while it waits sends nothing.
    button(root).click();
    expect(presses).toBe(1);

    releasePress!();
    await vi.waitFor(() => expect(button(root).hidden).toBe(true));
    expect(presses).toBe(1);
  });

  it('comes back with an error line when the press fails', async () => {
    pressStatus = 500;
    const root = await open('en');
    await vi.waitFor(() => expect(button(root).hidden).toBe(false));

    button(root).click();
    await vi.waitFor(() => expect(presses).toBe(1));
    releasePress!();

    await vi.waitFor(() => expect(button(root).disabled).toBe(false));
    expect(button(root).hidden).toBe(false);
    expect(button(root).textContent).toBe('Talk to an agent');
    expect(root.querySelector('.nx-status')!.textContent).toBe(
      'Chat is unavailable right now. Please try again shortly.',
    );
  });
});
