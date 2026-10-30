/**
 * The rich card in the widget (EN-02 · tm 353): a card campaign drawn in the
 * proactive slot from its own chunk (`card.ts`), its "send a message" button
 * sent as the visitor's message with the postback, its coupon copied to the
 * clipboard (or shown to copy by hand), and a `rich_message` from the team
 * drawn in the transcript. A text campaign stays exactly what it was.
 *
 * Same harness as `widget.campaign.test.ts`: the card arrives on a poll the
 * visitor never triggered (`trackSale` connects without opening the panel).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

const mounted: Array<() => void> = [];
const API = 'https://api.test/v1';

interface FetchCall {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

const CARD = {
  title: 'Deposit trouble?',
  body: 'We can sort it out in a minute.',
  image: { url: 'https://cdn.example.com/coins.png', alt: 'A pile of coins' },
  buttons: [
    { label: 'Get help', style: 'primary', action: { type: 'send_message' } },
    {
      label: 'Read the rules',
      style: 'default',
      action: { type: 'open_url', url: 'https://casino.example/rules' },
    },
    {
      label: 'Copy the code',
      style: 'default',
      action: { type: 'copy_coupon', code: 'WELCOME50' },
    },
  ],
};
const FALLBACK = 'Deposit trouble?\nWe can sort it out in a minute.\n1. Get help';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

let calls: FetchCall[] = [];
let chatPolls = 0;
let campaignAt: (poll: number) => unknown = () => null;
let snapshot: () => { chat: unknown; events: unknown[] } = () => ({ chat: null, events: [] });

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
      if (url.includes('/customer/chat/sale')) return jsonResponse({ id: 'sale-1' });
      if (url.includes('/customer/chat/events'))
        return jsonResponse({ chat_id: 'chat-1', event: null });
      if (url.endsWith('/customer/chat')) {
        chatPolls += 1;
        return jsonResponse({
          online: true,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: null,
          ...snapshot(),
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
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mounted.push(mount(document, window));
  return root;
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

const slot = (root: HTMLElement) => root.querySelector<HTMLElement>('.nx-greet-msg')!;
const posts = (path: string) => calls.filter((c) => c.method === 'POST' && c.url.endsWith(path));

async function offeredCard(): Promise<HTMLElement> {
  campaignAt = (poll) => (poll === 1 ? { id: 'camp-1', message: FALLBACK, card: CARD } : null);
  const root = mountWidget();
  connectWithoutOpening();
  await vi.waitFor(() => expect(slot(root).querySelector('.nx-card')).not.toBeNull());
  return root;
}

beforeEach(() => {
  calls = [];
  chatPolls = 0;
  campaignAt = () => null;
  snapshot = () => ({ chat: null, events: [] });
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

describe('a card campaign in the proactive slot (EN-02)', () => {
  it('draws the title, the image with its alt text, the body and three buttons (FR-MOD-03.3.2)', async () => {
    const root = await offeredCard();
    const card = slot(root);
    expect(card.querySelector('.nx-card-title')!.textContent).toBe('Deposit trouble?');
    expect(card.querySelector('.nx-card-body')!.textContent).toBe(
      'We can sort it out in a minute.',
    );
    const image = card.querySelector<HTMLImageElement>('.nx-card-img')!;
    expect(image.src).toBe('https://cdn.example.com/coins.png');
    expect(image.alt).toBe('A pile of coins');
    const buttons = [...card.querySelectorAll<HTMLElement>('.nx-card-btn')];
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Get help',
      'Read the rules',
      'Copy the code',
    ]);
    expect(buttons[0]!.dataset['style']).toBe('primary');
    const link = buttons[1] as HTMLAnchorElement;
    expect(link.href).toBe('https://casino.example/rules');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
  });

  it('"Get help" opens the conversation and sends the label as the visitor message, with the postback (FR-MOD-03.3.2)', async () => {
    const root = await offeredCard();
    slot(root).querySelector<HTMLButtonElement>('.nx-card-btn')!.click();
    // A first visit goes through the pre-chat form; the label waits in its message box.
    const fields = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      '.nx-prechat-card > .nx-field .nx-prechat-input',
    );
    expect(fields[3]!.value).toBe('Get help');
    ['Jo Doe', 'jodoe', 'jo@example.com'].forEach((value, i) => {
      fields[i]!.value = value;
    });
    root
      .querySelector('.nx-prechat')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(posts('/customer/chat/events')).toHaveLength(1));
    expect(posts('/customer/chat/events')[0]!.body).toMatchObject({
      text: 'Get help',
      postback: { campaign_id: 'camp-1', button: 0 },
    });
    expect(root.querySelector<HTMLElement>('.nx-panel')!.hidden).toBe(false);
  });

  it('"Copy the code" writes the coupon to the clipboard, says so and counts the click', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const root = await offeredCard();
    [...slot(root).querySelectorAll<HTMLButtonElement>('.nx-card-btn')][2]!.click();
    await vi.waitFor(() =>
      expect(slot(root).querySelector('[role="status"]')!.textContent).toBe(
        'Code copied: WELCOME50',
      ),
    );
    expect(writeText).toHaveBeenCalledWith('WELCOME50');
    expect(posts('/customer/campaigns/camp-1/clicked')[0]!.body).toEqual({ button: 2 });
    // No message was sent for it.
    expect(posts('/customer/chat/events')).toHaveLength(0);
  });

  it('shows the code selected to copy by hand when the browser refuses the clipboard', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
    });
    const root = await offeredCard();
    [...slot(root).querySelectorAll<HTMLButtonElement>('.nx-card-btn')][2]!.click();
    await vi.waitFor(() => expect(slot(root).querySelector('.nx-card-code')).not.toBeNull());
    const field = slot(root).querySelector<HTMLInputElement>('.nx-card-code')!;
    expect(field.value).toBe('WELCOME50');
    expect(field.readOnly).toBe(true);
  });

  it('counts a link press, and leaves a text campaign exactly as it was', async () => {
    const root = await offeredCard();
    [...slot(root).querySelectorAll<HTMLAnchorElement>('.nx-card-btn')][1]!.dispatchEvent(
      new MouseEvent('click', { cancelable: true }),
    );
    await vi.waitFor(() => expect(posts('/customer/campaigns/camp-1/clicked')).toHaveLength(1));

    for (const stop of mounted.splice(0)) stop();
    document.body.replaceChildren();
    chatPolls = 0;
    campaignAt = (poll) => (poll === 1 ? { id: 'camp-2', message: 'Need a hand?' } : null);
    const plain = mountWidget();
    connectWithoutOpening();
    await vi.waitFor(() => expect(slot(plain).textContent).toBe('Need a hand?'));
    expect(slot(plain).querySelector('.nx-card')).toBeNull();
  });
});

describe('a card in the conversation (rich_message, EN-02)', () => {
  it('draws the card in place of its plain text; a quick reply is sent with the event postback', async () => {
    const quick = {
      body: 'Which method did you use?',
      buttons: [
        { label: 'Papara', style: 'default', action: { type: 'send_message' } },
        { label: 'Crypto', style: 'default', action: { type: 'send_message' } },
      ],
    };
    snapshot = () => ({
      chat: { id: 'chat-1', thread_id: 'th1', queue_position: null },
      events: [
        {
          id: 'th1_2',
          type: 'rich_message',
          author_type: 'bot',
          text: 'Which method did you use?\n1. Papara\n2. Crypto',
          created_at: '2026-10-30T10:00:00.000Z',
          attachment_url: null,
          properties: { card: quick },
        },
      ],
    });
    const root = mountWidget();
    root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
    await vi.waitFor(() => expect(root.querySelector('.nx-transcript .nx-card')).not.toBeNull());
    const buttons = root.querySelectorAll<HTMLButtonElement>('.nx-transcript .nx-card-btn');
    expect([...buttons].map((b) => b.textContent)).toEqual(['Papara', 'Crypto']);
    buttons[1]!.click();
    await vi.waitFor(() => expect(posts('/customer/chat/events')).toHaveLength(1));
    expect(posts('/customer/chat/events')[0]!.body).toMatchObject({
      text: 'Crypto',
      postback: { event_id: 'th1_2', button: 1 },
    });
  });
});
