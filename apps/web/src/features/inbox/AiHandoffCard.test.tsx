/**
 * The AI's hand-over card in the inbox (tm 304.2 · AI-10): at the top of the
 * Details panel, on its own line in the transcript, live over the push, and
 * the agent's one-click verdict on it.
 *
 * Acceptance (KK): a deposit card shows every field of the research's §3.1
 * example; a sensitive slot's value and an internal note are never on it; a
 * knowledge hand-over shows the question and why there was no answer; the
 * verdict is recorded and a second click on it sends nothing; the card a new
 * hand-over writes appears without a reload.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiHandoffCardView } from '@siyahtus/types';
import { ApiClientError } from '../../lib/api-client.js';
import { depositCard, knowledgeCard } from '../../test/ai-handoff.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import { AiHandoffCard } from './AiHandoffCard.js';
import { DetailsPanel } from './DetailsPanel.js';
import { Transcript } from './Transcript.js';
import { chatAiHandoffsKey } from './handoffCard.js';
import type { ChatDetail, ChatEvent } from './types.js';
import { applyPush } from './useInbox.js';

const { api, authState } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), request: vi.fn() },
  authState: {
    agent: null as { account_id: string; role: string; scopes: string[] } | null,
  },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
  useAuth: Object.assign((selector: (state: typeof authState) => unknown) => selector(authState), {
    getState: () => authState,
  }),
}));

const CHAT = 'CHAT1';

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function mount(ui: ReactElement, queryClient = client()) {
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}

function chatWith(card: AiHandoffCardView | null): ChatDetail {
  return {
    id: CHAT,
    license_id: '1000003',
    customer_id: 'cust-1',
    active: true,
    created_at: '2026-10-20T13:40:00.000Z',
    access: { group_ids: [] },
    users: [],
    thread: {
      id: 'TH1',
      chat_id: CHAT,
      active: true,
      assignee_id: null,
      queue_position: null,
      summary: card?.summary ?? null,
      created_at: '2026-10-20T13:40:00.000Z',
      closed_at: null,
      tags: [],
    },
    latest_ai_handoff: card,
  };
}

/** The agents-only line the hand-over writes into the transcript. */
function cardLine(card: AiHandoffCardView): ChatEvent {
  return {
    id: 'ev-card-1',
    chat_id: CHAT,
    thread_id: 'TH1',
    type: 'system_message',
    text: card.card_text,
    author_id: null,
    author_type: 'system',
    recipients: 'agents',
    attachment_url: null,
    properties: { system_event: 'ai_handoff_card', ai_handoff_id: card.id },
    created_at: card.created_at,
  };
}

/** Wraps a component so the verdict's cache write has the chat to land in. */
function CardHarness({
  queryClient,
  card,
  canJudge,
}: {
  queryClient: QueryClient;
  card: AiHandoffCardView;
  canJudge: boolean;
}): ReactElement {
  const current = queryClient.getQueryData<ChatDetail>(['chat', CHAT])?.latest_ai_handoff ?? card;
  return <AiHandoffCard card={current} chatId={CHAT} canJudge={canJudge} />;
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockResolvedValue({ items: [] });
  authState.agent = { account_id: 'agent-1', role: 'agent', scopes: ['chats--access:rw'] };
});

afterEach(() => resetLocale());

describe('the card, short and in full (AI-10)', () => {
  it('shows the summary, why, how urgent and who the player claims to be — the rest behind one click', () => {
    mount(<AiHandoffCard card={depositCard()} chatId={CHAT} canJudge />);
    const card = screen.getByRole('article', { name: 'AI hand-over card' });

    expect(within(card).getByTestId('ai-handoff-summary')).toHaveTextContent(
      'Yatırım geçmedi: Papara, 2.500 TL, 13:42.',
    );
    expect(within(card).getByText('A procedure’s hand-over step')).toBeInTheDocument();
    expect(within(card).getByText('(+1 more)')).toBeInTheDocument();
    expect(within(card).getByText('High')).toHaveAttribute('data-priority', 'high');
    expect(within(card).getByText('ayse_k · Ayşe K. · ayse@example.com')).toBeInTheDocument();
    expect(within(card).getByText('Player’s own claim, not verified')).toBeInTheDocument();
    expect(within(card).queryByText('Recognised device')).not.toBeInTheDocument();

    // The details wait for the agent.
    const toggle = within(card).getByRole('button', { name: 'Show details' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(card).queryByText('What the AI collected')).not.toBeInTheDocument();
  });

  it('opens every field of the deposit card, with each slot’s status (§3.1)', () => {
    mount(<AiHandoffCard card={depositCard()} chatId={CHAT} canJudge />);
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    expect(screen.getByText('Topic').nextSibling).toHaveTextContent('Yatırım geçmedi');
    const method = document.querySelector('[data-slot="method"]')!;
    expect(method).toHaveTextContent('Yöntem: Papara · given');
    expect(document.querySelector('[data-slot="paid_at"]')).toHaveTextContent(
      'Ödeme saati: 13:42 · partly given',
    );
    // The decision's basis: the facts the conversation knows; an unknown one is left out.
    expect(screen.getByText('What the decision rests on').parentElement).toHaveTextContent(
      'elapsed_minutes: 1 saat 35 dk',
    );
    expect(screen.queryByText(/expected_minutes/)).not.toBeInTheDocument();
    expect(screen.getByText('Papara işlem kaydı')).toBeInTheDocument();
    expect(
      screen.getByText('Papara yatırımları genellikle 30 dakika içinde hesaba geçer.'),
    ).toBeInTheDocument();
    expect(screen.getByText('A draft was rewritten')).toBeInTheDocument();
    expect(
      screen.getByText('A procedure’s hand-over step · Negative sentiment'),
    ).toBeInTheDocument();
    expect(screen.getByText('Formal complaint')).toBeInTheDocument();
    expect(screen.getByText('Negative')).toBeInTheDocument();
    expect(screen.getByText('dekont.png')).toBeInTheDocument();
    expect(
      screen.getByText('Papara kaydını kontrol edip oyuncuya süre verin.'),
    ).toBeInTheDocument();
  });

  it('says a sensitive slot was shared and never shows a value for it', () => {
    const card = depositCard();
    // Whatever arrives in `text`, a sensitive line shows none of it.
    card.slots[3] = { ...card.slots[3]!, text: 'TR00 1234' };
    mount(<AiHandoffCard card={card} chatId={CHAT} canJudge />);
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    const iban = document.querySelector('[data-slot="iban"]')!;
    expect(iban).toHaveTextContent('IBAN: shared, not shown on the card');
    expect(document.body).not.toHaveTextContent('TR00 1234');
  });

  it('shows the question and why there was no answer on a knowledge hand-over', () => {
    mount(<AiHandoffCard card={knowledgeCard()} chatId={CHAT} canJudge />);
    expect(screen.getByTestId('ai-handoff-summary')).toHaveTextContent(
      'Soru: USDT cüzdan adresimi nasıl değiştiririm?',
    );
    expect(screen.getByText('No answer in the knowledge base')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    expect(screen.getByText('The player’s question').nextSibling).toHaveTextContent(
      'USDT cüzdan adresimi nasıl değiştiririm?',
    );
    expect(
      screen.getByText('Nothing in the knowledge base matched the question'),
    ).toBeInTheDocument();
    expect(screen.getByText('The AI wrote nothing to the player.')).toBeInTheDocument();
    expect(screen.getByText('No promise caught')).toBeInTheDocument();
    expect(screen.queryByText('What the AI collected')).not.toBeInTheDocument();
  });

  it('marks a recognised device and the moment a person took the card up', () => {
    const card = depositCard({
      player: { ...depositCard().player, recognized_device: true },
      accepted_at: '2026-10-20T14:01:00.000Z',
    });
    mount(<AiHandoffCard card={card} chatId={CHAT} canJudge />);
    expect(screen.getByText('Recognised device')).toBeInTheDocument();
    expect(screen.getByText(/^Taken up at /)).toBeInTheDocument();
  });

  it('copies the card’s own text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount(<AiHandoffCard card={depositCard()} chatId={CHAT} canJudge />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(depositCard().card_text);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('speaks Turkish to a Turkish console', () => {
    renderWithLocale(
      <QueryClientProvider client={client()}>
        <AiHandoffCard card={depositCard()} chatId={CHAT} canJudge />
      </QueryClientProvider>,
      'tr',
    );
    expect(screen.getByText('Oyuncu beyanı, doğrulanmadı')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kopyala' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yeterli' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yetersiz' })).toBeInTheDocument();
  });
});

describe('a hand-over the player asked for with the button (tm 308 · AI-29)', () => {
  it('says the player pressed “Talk to an agent”, in English and in Turkish', () => {
    const pressed = {
      ...depositCard(),
      primary_reason: 'player_request' as const,
      requested_via: 'button' as const,
    };
    mount(<AiHandoffCard card={pressed} chatId={CHAT} canJudge />);
    const card = screen.getByRole('article', { name: 'AI hand-over card' });
    expect(within(card).getByText('The player pressed “Talk to an agent”')).toBeInTheDocument();
    cleanup();

    renderWithLocale(
      <QueryClientProvider client={client()}>
        <AiHandoffCard card={pressed} chatId={CHAT} canJudge />
      </QueryClientProvider>,
      'tr',
    );
    expect(screen.getByText('Oyuncu “Temsilciyle görüş” butonuna bastı')).toBeInTheDocument();
  });

  it('names the reason as before when the player wrote it', () => {
    const written = {
      ...depositCard(),
      primary_reason: 'player_request' as const,
      requested_via: null,
    };
    mount(<AiHandoffCard card={written} chatId={CHAT} canJudge />);
    expect(screen.getByText('The player asks for a person')).toBeInTheDocument();
  });
});

describe('the verdict (AI-10-S2)', () => {
  it('records one click, and a second click on the same verdict sends nothing', async () => {
    const queryClient = client();
    queryClient.setQueryData(['chat', CHAT], chatWith(depositCard()));
    api.post.mockImplementation(async (_path: string, body: { value: string }) =>
      depositCard({ feedback: body.value as 'sufficient', feedback_by: 'agent-1' }),
    );
    const { rerender } = mount(
      <CardHarness queryClient={queryClient} card={depositCard()} canJudge />,
      queryClient,
    );

    const enough = screen.getByRole('button', { name: 'Enough' });
    expect(enough).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(enough);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/ai-handoffs/${depositCard().id}/feedback`, {
        value: 'sufficient',
      }),
    );
    await waitFor(() =>
      expect(
        queryClient.getQueryData<ChatDetail>(['chat', CHAT])?.latest_ai_handoff?.feedback,
      ).toBe('sufficient'),
    );
    rerender(
      <QueryClientProvider client={queryClient}>
        <CardHarness queryClient={queryClient} card={depositCard()} canJudge />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Enough' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Enough' }));
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('asks what was missing after "Not enough", optionally, and sends it with the verdict', async () => {
    api.post.mockImplementation(async (_path: string, body: { value: string; reason?: string }) =>
      depositCard({
        feedback: 'insufficient',
        feedback_reason: body.reason ?? null,
      }),
    );
    const queryClient = client();
    const { rerender } = mount(
      <AiHandoffCard card={depositCard()} chatId={CHAT} canJudge />,
      queryClient,
    );
    expect(screen.queryByLabelText('What was missing? (optional)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not enough' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/ai-handoffs/${depositCard().id}/feedback`, {
        value: 'insufficient',
      }),
    );

    rerender(
      <QueryClientProvider client={queryClient}>
        <AiHandoffCard card={depositCard({ feedback: 'insufficient' })} chatId={CHAT} canJudge />
      </QueryClientProvider>,
    );
    const field = screen.getByLabelText('What was missing? (optional)');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.change(field, { target: { value: '  The transaction id  ' } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.post).toHaveBeenLastCalledWith(`/ai-handoffs/${depositCard().id}/feedback`, {
        value: 'insufficient',
        reason: 'The transaction id',
      }),
    );
  });

  it('says why a verdict was refused', async () => {
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'authorization',
        status: 403,
        message: 'no',
        requestId: 'req-1',
      }),
    );
    mount(<AiHandoffCard card={depositCard()} chatId={CHAT} canJudge />);
    fireEvent.click(screen.getByRole('button', { name: 'Enough' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('offers no buttons to a reader who may not write — only the verdict already given', () => {
    const { rerender, queryClient } = mount(
      <AiHandoffCard card={depositCard()} chatId={CHAT} canJudge={false} />,
    );
    expect(screen.queryByRole('button', { name: 'Enough' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Marked as/)).not.toBeInTheDocument();
    rerender(
      <QueryClientProvider client={queryClient}>
        <AiHandoffCard
          card={depositCard({ feedback: 'insufficient' })}
          chatId={CHAT}
          canJudge={false}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Marked as not enough to start.')).toBeInTheDocument();
  });
});

describe('where the card is shown', () => {
  it('opens the Details panel, above the conversation’s own section', () => {
    mount(<DetailsPanel chat={chatWith(depositCard())} chatId={CHAT} />);
    const sections = screen.getAllByRole('group');
    expect(sections[0]).toHaveTextContent('AI hand-over');
    expect(within(sections[0]!).getByRole('article')).toHaveAttribute(
      'data-ai-handoff',
      depositCard().id,
    );
  });

  it('is not in the Details panel of a chat the AI handed nothing over', () => {
    mount(<DetailsPanel chat={chatWith(null)} chatId={CHAT} />);
    expect(screen.queryByRole('article', { name: 'AI hand-over card' })).not.toBeInTheDocument();
  });

  it('withholds the verdict buttons in the panel from a reader without write access', () => {
    authState.agent = { account_id: 'agent-2', role: 'viewer', scopes: ['chats--access:ro'] };
    mount(<DetailsPanel chat={chatWith(depositCard())} chatId={CHAT} />);
    expect(screen.getByRole('article', { name: 'AI hand-over card' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enough' })).not.toBeInTheDocument();
  });

  it('draws the transcript’s card line in place of the raw text, and opens the card from the day’s cards', async () => {
    const card = depositCard();
    api.get.mockImplementation(async (path: string) =>
      path === `/chats/${CHAT}/ai-handoffs` ? { items: [knowledgeCard(), card] } : { items: [] },
    );
    mount(
      <Transcript chatId={CHAT} events={[cardLine(card)]} loading={false} currentAgentId={null} />,
    );
    // The line names the reason once the day's cards are read; the card's raw text is not on it.
    expect(
      await screen.findByText(/The AI handed this conversation over: A procedure’s hand-over step/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Konu: Yatırım geçmedi/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show the card' }));
    const shown = screen.getByRole('article', { name: 'AI hand-over card' });
    expect(shown).toHaveAttribute('data-ai-handoff', card.id);
    // Opened from the transcript, the card is open in full.
    expect(within(shown).getByText('What the AI collected')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(`/chats/${CHAT}/ai-handoffs`);
  });

  it('falls back to the line’s own text when the card cannot be read', async () => {
    const card = depositCard();
    api.get.mockRejectedValue(new Error('offline'));
    mount(
      <Transcript chatId={CHAT} events={[cardLine(card)]} loading={false} currentAgentId={null} />,
    );
    expect(screen.getByText(/The AI handed this conversation over/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show the card' }));
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.getByText(/Konu: Yatırım geçmedi/)).toBeInTheDocument();
  });

  it('leaves every other system line as it was', () => {
    const event: ChatEvent = {
      ...cardLine(depositCard()),
      id: 'ev-sys',
      text: 'Chat transferred',
      recipients: 'all',
      properties: { system_event: 'transfer' },
    };
    mount(<Transcript chatId={CHAT} events={[event]} loading={false} currentAgentId={null} />);
    expect(screen.getByText('Chat transferred')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show the card' })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe('a new card over the push (AI-10: within a second)', () => {
  it('re-reads the chat and its day’s cards on `ai_handoff_created`', () => {
    const queryClient = client();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    applyPush(queryClient, 'ai_handoff_created', {
      chat_id: CHAT,
      thread_id: 'TH1',
      handoff_id: depositCard().id,
      primary_reason: 'procedure_rule',
      priority: 'high',
      target_group_id: 2,
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['chat', CHAT] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatAiHandoffsKey(CHAT) });
  });
});
