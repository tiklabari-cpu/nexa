/**
 * Event-bound suggested replies in the composer (IN-07 · tm 364).
 *
 * The acceptance criteria, as the agent meets them: a reply bound to "chat
 * transferred" shows as a chip to the agent the chat was handed to; clicking it
 * puts the text in the box and sends nothing; with the agent's own switch off
 * there is no chip; and in a conversation whose player is kept from promotions a
 * promotion reply is never offered. Around those: a chip shows once, in the empty
 * box only, at most four wide, event before template.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';
import { eventsKey } from './useInbox.js';
import { useEventSuggestionStore } from './eventSuggestionState.js';
import { useAuth } from '../../lib/auth-store.js';
import type { ChatEvent } from './types.js';

const ME = 'agent-me';

function event(partial: Partial<ChatEvent> & Pick<ChatEvent, 'id'>): ChatEvent {
  return {
    chat_id: 'CHAT1',
    thread_id: 't1',
    type: 'message',
    text: 'merhaba',
    author_id: null,
    author_type: 'customer',
    recipients: 'all',
    attachment_url: null,
    properties: {},
    created_at: '2026-10-01T10:00:00.000Z',
    ...partial,
  };
}

const CUSTOMER_HELLO = event({ id: 'm1' });
const TRANSFER_TO_ME = event({
  id: 's1',
  type: 'system_message',
  author_type: 'system',
  text: 'Chat transferred',
  created_at: '2026-10-01T10:01:00.000Z',
  properties: { system_event: 'chat_transferred', agent_id: ME },
});
const TRANSFER_TO_OTHER = event({
  id: 's2',
  type: 'system_message',
  author_type: 'system',
  text: 'Chat transferred',
  created_at: '2026-10-01T10:01:00.000Z',
  properties: { system_event: 'chat_transferred', agent_id: 'someone-else' },
});
const AGENT_SAID = event({
  id: 'a1',
  author_type: 'agent',
  author_id: ME,
  text: 'Nasıl yardımcı olabilirim?',
  created_at: '2026-10-01T10:02:00.000Z',
});

interface Reply {
  id: string;
  shortcut: string;
  text: string;
  visibility: 'all';
  suggest_on: string[];
  suggest_order?: number;
  category?: 'general' | 'promotion';
}

function reply(id: string, text: string, on: string[], extra: Partial<Reply> = {}): Reply {
  return { id, shortcut: id, text, visibility: 'all', suggest_on: on, ...extra };
}

interface World {
  replies: Reply[];
  promoSuppressed?: boolean;
  suggestionsEnabled?: boolean;
  idleSeconds?: number;
  rating?: { value: 'good' | 'bad'; rated_at: string } | null;
  assignee?: string | null;
}

let calls: Array<{ url: string; method: string }> = [];

function mount(events: ChatEvent[], world: World) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      calls.push({ url, method: init?.method ?? 'GET' });
      let body: unknown = { items: [] };
      if (url.includes('/settings/canned-responses')) {
        body = {
          items: world.replies,
          fallback_text: 'Değerli üyemiz',
          company_name: 'Acme',
          customer_idle_seconds: world.idleSeconds ?? 180,
        };
      } else if (url.includes('/risk-flags')) {
        body = { items: [], promo_suppressed: world.promoSuppressed ?? false };
      } else if (url.includes('/agents/me/ui-preferences')) {
        body = {
          settings_nav_pinned: true,
          suggestions_event_enabled: world.suggestionsEnabled ?? true,
          font_preset: null,
          font_preset_set_at: null,
        };
      } else if (/\/chats\/CHAT1$/.test(url)) {
        body = {
          id: 'CHAT1',
          customer_id: 'cu1',
          active: true,
          thread: {
            id: 't1',
            assignee_id: world.assignee === undefined ? ME : world.assignee,
            rating: world.rating ?? null,
            tags: [],
          },
        };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(eventsKey('CHAT1'), {
    pages: [{ items: [...events].reverse() }],
    pageParams: [undefined],
  });
  const view = render(
    <QueryClientProvider client={client}>
      <Composer chatId="CHAT1" disabled={false} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

function box(): HTMLTextAreaElement {
  return screen.getByLabelText('Reply to the customer') as HTMLTextAreaElement;
}

beforeEach(() => {
  // A picked chip leaves a draft behind; the next test must not restore it.
  localStorage.clear();
  useEventSuggestionStore.setState({ used: {}, rated: {} });
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: ME,
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'agent',
      organization_id: 'o-1',
      license_id: '1',
      scopes: ['agents--my:ro', 'agents--my:rw'],
      routing_status: 'accepting_chats',
    },
  });
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Composer — event suggested replies (IN-07)', () => {
  it('shows the chip bound to "chat transferred" to the agent it was handed to, and a click fills the box without sending', async () => {
    mount([CUSTOMER_HELLO, TRANSFER_TO_ME], {
      replies: [reply('devir', 'Sohbeti devraldım, buradayım.', ['chat_transferred'])],
    });

    const row = await screen.findByTestId('event-suggestions');
    await userEvent.click(
      within(row).getByRole('button', { name: 'Sohbeti devraldım, buradayım.' }),
    );

    expect(box().value).toBe('Sohbeti devraldım, buradayım.');
    // Gone from the row, and nothing was sent.
    expect(screen.queryByTestId('event-suggestions')).not.toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('offers nothing when the chat was handed to somebody else', async () => {
    mount([CUSTOMER_HELLO, TRANSFER_TO_OTHER], {
      replies: [reply('devir', 'Sohbeti devraldım.', ['chat_transferred'])],
      assignee: 'someone-else',
    });
    await waitFor(() => expect(calls.some((c) => c.url.includes('canned-responses'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId('event-suggestions')).not.toBeInTheDocument();
  });

  it('offers nothing once the agent has answered after the hand-over', async () => {
    mount([CUSTOMER_HELLO, TRANSFER_TO_ME, AGENT_SAID], {
      replies: [reply('devir', 'Sohbeti devraldım.', ['chat_transferred'])],
    });
    await waitFor(() => expect(calls.some((c) => c.url.includes('canned-responses'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId('event-suggestions')).not.toBeInTheDocument();
  });

  it('shows no chip while the agent has switched event suggestions off for themselves', async () => {
    mount([CUSTOMER_HELLO, TRANSFER_TO_ME], {
      replies: [reply('devir', 'Sohbeti devraldım.', ['chat_transferred'])],
      suggestionsEnabled: false,
    });
    await waitFor(() => expect(calls.some((c) => c.url.includes('ui-preferences'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(screen.queryByTestId('event-suggestions')).not.toBeInTheDocument();
  });

  it('never offers a promotion reply to a player kept from promotions, but offers the rest', async () => {
    mount([CUSTOMER_HELLO, TRANSFER_TO_ME], {
      replies: [
        reply('bonus', 'Size özel %100 bonus!', ['chat_transferred'], { category: 'promotion' }),
        reply('devir', 'Sohbeti devraldım.', ['chat_transferred']),
      ],
      promoSuppressed: true,
    });
    const row = await screen.findByTestId('event-suggestions');
    expect(within(row).getByRole('button', { name: 'Sohbeti devraldım.' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /bonus/ })).not.toBeInTheDocument();
  });

  it('offers the promotion reply when the player is not kept from promotions', async () => {
    mount([CUSTOMER_HELLO, TRANSFER_TO_ME], {
      replies: [
        reply('bonus', 'Size özel %100 bonus!', ['chat_transferred'], { category: 'promotion' }),
      ],
      promoSuppressed: false,
    });
    const row = await screen.findByTestId('event-suggestions');
    expect(within(row).getByRole('button', { name: 'Size özel %100 bonus!' })).toBeInTheDocument();
  });

  it('offers the chat_started reply while no person has answered yet, and not after', async () => {
    const first = mount([CUSTOMER_HELLO], {
      replies: [reply('hos', 'Hoş geldiniz!', ['chat_started'])],
    });
    expect(await screen.findByRole('button', { name: 'Hoş geldiniz!' })).toBeInTheDocument();
    first.unmount();

    useEventSuggestionStore.setState({ used: {}, rated: {} });
    mount([CUSTOMER_HELLO, AGENT_SAID], {
      replies: [reply('hos', 'Hoş geldiniz!', ['chat_started'])],
    });
    await waitFor(() => expect(calls.some((c) => c.url.includes('canned-responses'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button', { name: 'Hoş geldiniz!' })).not.toBeInTheDocument();
  });

  it('shows at most four chips, ordered by suggest_order', async () => {
    mount([CUSTOMER_HELLO], {
      replies: [
        reply('e', 'Beşinci', ['chat_started'], { suggest_order: 5 }),
        reply('b', 'İkinci', ['chat_started'], { suggest_order: 2 }),
        reply('a', 'Birinci', ['chat_started'], { suggest_order: 1 }),
        reply('d', 'Dördüncü', ['chat_started'], { suggest_order: 4 }),
        reply('c', 'Üçüncü', ['chat_started'], { suggest_order: 3 }),
      ],
    });
    const row = await screen.findByTestId('event-suggestions');
    const labels = within(row)
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((text) => text !== '×');
    expect(labels).toEqual(['Birinci', 'İkinci', 'Üçüncü', 'Dördüncü']);
  });

  it('does not bring a dismissed chip back, even when the composer is opened again', async () => {
    const first = mount([CUSTOMER_HELLO], {
      replies: [reply('hos', 'Hoş geldiniz!', ['chat_started'])],
    });
    await screen.findByTestId('event-suggestions');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss these suggestions' }));
    expect(screen.queryByTestId('event-suggestions')).not.toBeInTheDocument();
    first.unmount();

    mount([CUSTOMER_HELLO], { replies: [reply('hos', 'Hoş geldiniz!', ['chat_started'])] });
    await waitFor(() => expect(calls.some((c) => c.url.includes('canned-responses'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId('event-suggestions')).not.toBeInTheDocument();
  });

  it('retracts the chips for good once the agent starts typing', async () => {
    mount([CUSTOMER_HELLO], { replies: [reply('hos', 'Hoş geldiniz!', ['chat_started'])] });
    await screen.findByTestId('event-suggestions');

    await userEvent.type(box(), 'x');
    expect(screen.queryByTestId('event-suggestions')).not.toBeInTheDocument();
    await userEvent.clear(box());
    expect(screen.queryByTestId('event-suggestions')).not.toBeInTheDocument();
  });

  it('fires customer_idle when the agent spoke last and the silence is long enough', async () => {
    const old = { ...AGENT_SAID, created_at: new Date(Date.now() - 600_000).toISOString() };
    mount([CUSTOMER_HELLO, old], {
      replies: [reply('sessiz', 'Hâlâ orada mısınız?', ['customer_idle'])],
      idleSeconds: 180,
    });
    expect(await screen.findByRole('button', { name: 'Hâlâ orada mısınız?' })).toBeInTheDocument();
  });

  it('holds customer_idle back until the delay has passed, then fires on its own timer', async () => {
    const justNow = { ...AGENT_SAID, created_at: new Date().toISOString() };
    mount([CUSTOMER_HELLO, justNow], {
      replies: [reply('sessiz', 'Hâlâ orada mısınız?', ['customer_idle'])],
      idleSeconds: 1,
    });
    // Replies have loaded but the second has not passed yet…
    await waitFor(() => expect(calls.some((c) => c.url.includes('canned-responses'))).toBe(true));
    expect(screen.queryByRole('button', { name: 'Hâlâ orada mısınız?' })).not.toBeInTheDocument();
    // …and then it fires without anything else happening.
    expect(
      await screen.findByRole('button', { name: 'Hâlâ orada mısınız?' }, { timeout: 4000 }),
    ).toBeInTheDocument();
  });

  it('does not fire customer_idle when the player spoke last', async () => {
    const old = { ...AGENT_SAID, created_at: new Date(Date.now() - 600_000).toISOString() };
    const answer = { ...CUSTOMER_HELLO, id: 'm2', created_at: new Date().toISOString() };
    mount([old, answer], {
      replies: [reply('sessiz', 'Hâlâ orada mısınız?', ['customer_idle'])],
    });
    await waitFor(() => expect(calls.some((c) => c.url.includes('canned-responses'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button', { name: 'Hâlâ orada mısınız?' })).not.toBeInTheDocument();
  });

  it('offers rated_good/rated_bad replies after the chat_rated push, by the value the chat now carries', async () => {
    useEventSuggestionStore.getState().markRated('CHAT1');
    mount([CUSTOMER_HELLO, AGENT_SAID], {
      replies: [
        reply('tesekkur', 'Puanınız için teşekkürler!', ['rated_good']),
        reply('ozur', 'Üzgünüz, yardımcı olamadık.', ['rated_bad']),
      ],
      rating: { value: 'bad', rated_at: '2026-10-01T10:05:00.000Z' },
    });
    expect(
      await screen.findByRole('button', { name: 'Üzgünüz, yardımcı olamadık.' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Puanınız için teşekkürler!' }),
    ).not.toBeInTheDocument();
  });

  it('offers no rated reply when no push told the panel (an old vote is not news)', async () => {
    mount([CUSTOMER_HELLO, AGENT_SAID], {
      replies: [reply('tesekkur', 'Puanınız için teşekkürler!', ['rated_good'])],
      rating: { value: 'good', rated_at: '2026-10-01T10:05:00.000Z' },
    });
    await waitFor(() => expect(calls.some((c) => c.url.includes('canned-responses'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId('event-suggestions')).not.toBeInTheDocument();
  });

  it('puts the event chip ahead of the template chips when the agent presses Space', async () => {
    mount([CUSTOMER_HELLO], { replies: [reply('hos', 'Hoş geldiniz!', ['chat_started'])] });
    await screen.findByTestId('event-suggestions');

    await userEvent.click(box());
    await userEvent.keyboard(' ');

    const row = await screen.findByRole('group', { name: 'Reply suggestions' });
    const labels = within(row)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(labels[0]).toBe('Hoş geldiniz!');
    expect(labels.filter((text) => text !== '×').length).toBeLessThanOrEqual(4);
    // The auto row yields to the Space row rather than showing the chip twice.
    expect(screen.queryByTestId('event-suggestions')).not.toBeInTheDocument();
  });

  it('offers a "close for me" switch on the # picker gear', async () => {
    mount([CUSTOMER_HELLO], {
      replies: [reply('hos', 'Hoş geldiniz!', ['chat_started'])],
    });
    await userEvent.type(box(), '#hos');
    const toggle = await screen.findByTestId('event-suggestions-toggle');
    expect(toggle).toHaveTextContent('Close event suggestions for me');

    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'PUT' && c.url.includes('/agents/me/ui-preferences')),
      ).toBe(true),
    );
  });
});
