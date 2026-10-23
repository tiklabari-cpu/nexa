/**
 * The player card at the top of the Details panel (IN-02 · tm 331.2): who the
 * player is, their pre-chat answers, the day's earlier connections and 90 days
 * of history — read from `GET /chats/{chatId}/customer-context`, the server
 * deciding what is hidden and what is restricted; the card only says so.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationRef, CustomerContext } from '@siyahtus/types';
import { depositCard } from '../../test/ai-handoff.js';
import { DetailsPanel } from './DetailsPanel.js';
import { applyPush } from './useInbox.js';
import { customerContextKey } from './useCustomerContext.js';
import type { ChatDetail, ChatEvent } from './types.js';

const { api, authState } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  authState: { agent: { role: 'agent', scopes: ['chats--access:rw', 'customers:ro'] } },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
  useAuth: Object.assign((selector: (state: typeof authState) => unknown) => selector(authState), {
    getState: () => ({ agent: null }),
  }),
}));

const CHAT: ChatDetail = {
  id: 'TJ1H8CFKRV',
  license_id: '1000003',
  customer_id: 'cust-1',
  active: true,
  created_at: '2026-07-20T10:00:00.000Z',
  access: { group_ids: [] },
  users: [],
  thread: {
    id: 'TH2',
    chat_id: 'TJ1H8CFKRV',
    active: true,
    assignee_id: null,
    queue_position: null,
    summary: null,
    created_at: '2026-07-20T14:00:00.000Z',
    closed_at: null,
    tags: [],
  },
};

function ref(overrides: Partial<ConversationRef> = {}): ConversationRef {
  return {
    accessible: true,
    chat_id: 'TJ1H8CFKRV',
    thread_id: 'TH1',
    started_at: '2026-07-20T10:00:00.000Z',
    ended_at: '2026-07-20T10:12:30.000Z',
    connections_count: 1,
    assignee: { id: 'agent-1', name: 'Deniz' },
    teams: [{ id: 1, name: 'Finance' }],
    topics: ['finance'],
    tags: [],
    summary: null,
    outcome: null,
    rating: null,
    ai_handoff: null,
    ...overrides,
  };
}

function context(overrides: Partial<CustomerContext> = {}): CustomerContext {
  return {
    chat_id: CHAT.id,
    customer: {
      id: 'cust-1',
      name: 'Ayşe K.',
      username: 'ayse_k',
      email: 'ayse@example.com',
      country_code: 'TR',
      country: 'Turkey',
      city: 'Istanbul',
      banned: false,
    },
    contact_visible: true,
    pre_chat: [{ label: 'Topic', value: 'Deposit' }],
    today: [],
    history: { items: [] },
    restricted_count: 0,
    ...overrides,
  };
}

/** `customer-context` answers with `pages[page_id ?? '']`, events with `events`; anything else is an empty list. */
function answer(pages: Record<string, CustomerContext>, events: ChatEvent[] = []): void {
  api.get.mockImplementation((path: string) => {
    const url = new URL(path, 'http://x');
    if (url.pathname === `/chats/${CHAT.id}/customer-context`) {
      return Promise.resolve(pages[url.searchParams.get('page_id') ?? '']);
    }
    if (url.pathname.endsWith('/events')) return Promise.resolve({ items: events });
    return Promise.resolve({ items: [] });
  });
}

function renderPanel(chat: ChatDetail = CHAT) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <DetailsPanel chat={chat} chatId={chat.id} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return queryClient;
}

beforeEach(() => {
  api.get.mockReset();
});

describe('PlayerCard (IN-02)', () => {
  it('names the player, their username as their own claim, email, country and pre-chat answers (FR-MOD-02.4.1–.6)', async () => {
    answer({ '': context() });
    renderPanel();

    const card = await screen.findByTestId('player-card');
    expect(within(card).getByText('Ayşe K.')).toBeInTheDocument();
    expect(within(card).getByText('ayse_k')).toBeInTheDocument();
    expect(within(card).getByText('Player’s own claim, not verified')).toBeInTheDocument();
    expect(within(card).getByText('ayse@example.com')).toBeInTheDocument();
    expect(within(card).getByText('Istanbul, Turkey')).toBeInTheDocument();
    expect(within(card).getByText('Topic')).toBeInTheDocument();
    expect(within(card).getByText('Deposit')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Open profile' })).toHaveAttribute(
      'href',
      '/app/customers?customer=cust-1',
    );
    expect(api.get).toHaveBeenCalledWith(`/chats/${CHAT.id}/customer-context`);
  });

  it('shows "—" for what the player never gave, and "Hidden" where the caller may not see contact details (FR-MOD-02.4.1–.6)', async () => {
    answer({
      '': context({
        customer: {
          id: 'cust-1',
          name: null,
          username: null,
          email: null,
          country_code: null,
          country: null,
          city: null,
          banned: false,
        },
        pre_chat: [],
      }),
    });
    renderPanel();

    const card = await screen.findByTestId('player-card');
    expect(within(card).getByText('Unnamed visitor')).toBeInTheDocument();
    // Username, email, country and the pre-chat answers.
    expect(within(card).getAllByText('—')).toHaveLength(4);
    expect(within(card).queryByText('Hidden')).not.toBeInTheDocument();
    expect(within(card).queryByText('Player’s own claim, not verified')).not.toBeInTheDocument();
  });

  it('reads "Hidden", not "—", for a caller without customers.contact.view', async () => {
    const masked = context({ contact_visible: false });
    masked.customer = { ...masked.customer, username: null, email: null };
    answer({ '': masked });
    renderPanel();

    const card = await screen.findByTestId('player-card');
    expect(within(card).getAllByText('Hidden')).toHaveLength(2);
    expect(within(card).queryByText('ayse@example.com')).not.toBeInTheDocument();
  });

  it('lists the earlier connection of the day under "Earlier today" — time, outcome, card — and opens it read-only (FR-MOD-02.4.1–.6)', async () => {
    const earlier = ref({
      outcome: 'handed_off',
      rating: 'good',
      ai_handoff: depositCard({ chat_id: CHAT.id, thread_id: 'TH1' }),
    });
    answer({ '': context({ today: [earlier] }) }, [
      {
        id: 'e1',
        chat_id: CHAT.id,
        thread_id: 'TH1',
        type: 'message',
        text: 'Yatırımım geçmedi',
        author_id: 'cust-1',
        author_type: 'customer',
        recipients: 'all',
        attachment_url: null,
        properties: {},
        created_at: '2026-07-20T10:00:05.000Z',
      },
    ]);
    renderPanel();

    const today = await screen.findByTestId('player-card-today');
    expect(within(today).getByText(/12m 30s/)).toBeInTheDocument();
    expect(within(today).getByText(/Handed over/)).toBeInTheDocument();
    expect(within(today).getByText(/Rated good/)).toBeInTheDocument();
    expect(
      within(today).getByText('Yatırım geçmedi: Papara, 2.500 TL, 13:42.'),
    ).toBeInTheDocument();

    fireEvent.click(within(today).getByRole('button', { name: 'Read' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Yatırımım geçmedi')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(`/chats/${CHAT.id}/events?thread_id=TH1&limit=100`);
    // Read-only: nothing in the dialog writes.
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('says so when today has no other connection and there is no history', async () => {
    answer({ '': context() });
    renderPanel();

    expect(await screen.findByText('No other connection today.')).toBeInTheDocument();
    expect(screen.getByText('No earlier conversations.')).toBeInTheDocument();
  });

  it("shows another team's day as a restricted row — date and topic, nothing to open (FR-MOD-02.4.1–.6 · NFR-S5)", async () => {
    const open = ref({
      chat_id: 'TPREVDAY01',
      thread_id: 'THPREV',
      started_at: '2026-07-19T09:00:00.000Z',
      ended_at: '2026-07-19T09:30:00.000Z',
      connections_count: 2,
      summary: 'Bonus question answered.',
      tags: ['bonus'],
    });
    const restricted = ref({
      accessible: false,
      chat_id: null,
      thread_id: null,
      started_at: '2026-07-18T09:00:00.000Z',
      ended_at: null,
      connections_count: null,
      assignee: null,
      teams: [],
      topics: ['kyc_risk'],
    });
    answer({ '': context({ history: { items: [open, restricted] }, restricted_count: 1 }) });
    renderPanel();

    const history = await screen.findByTestId('player-card-history');
    const [first, second] = within(history).getAllByRole('listitem');
    expect(within(first!).getByText('Bonus question answered.')).toBeInTheDocument();
    expect(within(first!).getByText(/2 connections/)).toBeInTheDocument();
    expect(within(first!).getByRole('button', { name: 'Read' })).toBeInTheDocument();

    expect(second).toHaveAttribute('data-restricted');
    expect(within(second!).getByText('Another team’s conversation')).toBeInTheDocument();
    expect(within(second!).getByText('KYC / Risk')).toBeInTheDocument();
    expect(within(second!).queryByRole('button')).not.toBeInTheDocument();
    expect(
      screen.getByText('1 conversation in these 90 days belongs to another team.'),
    ).toBeInTheDocument();
  });

  it('puts both numbers of a history row on the copy buttons', async () => {
    answer({
      '': context({
        history: { items: [ref({ chat_id: 'TPREVDAY01', thread_id: 'THPREV01AB' })] },
      }),
    });
    renderPanel();

    const history = await screen.findByTestId('player-card-history');
    expect(within(history).getByText('TPREVDAY01')).toBeInTheDocument();
    expect(within(history).getByText('THPREV01AB')).toBeInTheDocument();
  });

  it('reads the next 20 days with the page id the first page gave', async () => {
    answer({
      '': context({
        history: {
          items: [ref({ chat_id: 'TDAY000001', summary: 'First page' })],
          next_page_id: 'p2',
        },
      }),
      p2: context({ history: { items: [ref({ chat_id: 'TDAY000002', summary: 'Second page' })] } }),
    });
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Second page')).toBeInTheDocument();
    expect(screen.getByText('First page')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(`/chats/${CHAT.id}/customer-context?page_id=p2`);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('sits under the AI hand-over card, which stays first in a conversation the AI handed over', async () => {
    answer({ '': context() });
    renderPanel({
      ...CHAT,
      latest_ai_handoff: depositCard({
        chat_id: CHAT.id,
        player: { ...depositCard().player, recognized_device: true },
      }),
    });

    const card = await screen.findByTestId('player-card');
    const handoff = screen.getByTestId('ai-handoff-summary');
    expect(handoff.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card).getByText('Recognised device')).toBeInTheDocument();
  });

  it('draws nothing of a card when the read fails', async () => {
    api.get.mockImplementation((path: string) =>
      path.includes('customer-context')
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ items: [] }),
    );
    renderPanel();

    expect(await screen.findByText('The player card could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByTestId('player-card')).not.toBeInTheDocument();
  });
});

describe('PlayerCard refresh over RTM (IN-02)', () => {
  it.each([
    ['incoming_chat', { chat: { id: CHAT.id } }],
    ['chat_transferred', { chat_id: CHAT.id, transferred_to: { agent_ids: [] } }],
  ])('re-reads the card on %s', (action, payload) => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyPush(queryClient, action, payload);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: customerContextKey(CHAT.id) });
  });

  it('shows the connection a member came back with after the push', async () => {
    answer({ '': context() });
    const queryClient = renderPanel();
    expect(await screen.findByText('No other connection today.')).toBeInTheDocument();

    answer({ '': context({ today: [ref({ summary: 'Came back about the deposit' })] }) });
    applyPush(queryClient, 'incoming_chat', { chat: { id: CHAT.id } });
    await waitFor(() =>
      expect(screen.getByText('Came back about the deposit')).toBeInTheDocument(),
    );
  });
});
