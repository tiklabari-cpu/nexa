/**
 * Playbook › Öneriler (tm 318.2 · AI-23): the queue lists what the API sends
 * and opens one with its masked excerpt and proposal; the proposal is edited
 * and accepted into the draft or rejected — a rejection needs its reason
 * before the button works; "the knowledge already has this" is said; a
 * proposal still being drafted says so and takes the draft when it arrives;
 * someone who may not review sees no buttons; a merge names the other
 * suggestion; the tab's badge follows `open_count` and its push.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/api-client.js';
import type * as AuthStore from '../../lib/auth-store.js';
import { applyPush } from '../inbox/useInbox.js';
import type { AiSuggestion, AiSuggestionList } from './ai-suggestions.js';
import { suggestionKeys } from './ai-suggestions.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { Suggestions } = await import('./Suggestions.js');
const { useSuggestionBadge } = await import('./useSuggestionBadge.js');

const AGENT_ID = '22222222-2222-4222-8222-222222222222';
const WRONG = 'a1111111-1111-4111-8111-111111111111';
const OFFER = 'a2222222-2222-4222-8222-222222222222';
const SKILL_ID = 'b1111111-1111-4111-8111-111111111111';

function suggestion(overrides: Partial<AiSuggestion>): AiSuggestion {
  return {
    id: WRONG,
    ai_agent_id: AGENT_ID,
    kind: 'wrong_answer',
    source: 'agent_flag',
    status: 'new',
    chat_id: 'TJ1H8CFKRV',
    thread_id: 'TJ1H8CFKRV-2',
    event_ids: ['TJ1H8CFKRV-2_3'],
    excerpt: [
      {
        event_id: 'TJ1H8CFKRV-2_1',
        author_type: 'customer',
        is_ai: false,
        text: 'Papara ile gece yatırım yapabilir miyim?',
        created_at: '2026-10-28T09:00:00.000Z',
        marked: false,
      },
      {
        event_id: 'TJ1H8CFKRV-2_3',
        author_type: 'bot',
        is_ai: true,
        text: 'Papara 7/24 çalışır.',
        created_at: '2026-10-28T09:00:05.000Z',
        marked: true,
      },
    ],
    note: 'Artık 7/24 değil',
    team_id: 3,
    proposed_change: null,
    removed_specifics: [],
    drafted_by: null,
    duplicate_of: null,
    cluster_id: null,
    already_known: false,
    similar_sources: [],
    reviewer_id: null,
    reviewed_at: null,
    review_note: null,
    resulting_change_id: null,
    created_by: 'agent-1',
    created_at: '2026-10-28T09:01:00.000Z',
    updated_at: '2026-10-28T09:01:00.000Z',
    ...overrides,
  };
}

const OFFERED = suggestion({
  id: OFFER,
  kind: 'promote_agent_answer',
  event_ids: ['TJ1H8CFKRV-2_5'],
  excerpt: [
    {
      event_id: 'TJ1H8CFKRV-2_5',
      author_type: 'agent',
      is_ai: false,
      text: 'Papara geceleri 02:00-04:00 arası bakımda.',
      created_at: '2026-10-28T09:02:00.000Z',
      marked: true,
    },
  ],
  note: null,
  proposed_change: {
    target: 'knowledge_snippet',
    title: 'Papara bakım saatleri',
    body: 'Papara geceleri 02:00-04:00 arası bakımdadır; [tarih] için duyuruya bakın.',
    source_id: null,
  },
  removed_specifics: ['username', 'amount'],
  drafted_by: 'llm',
  already_known: true,
  similar_sources: [
    {
      chunk_id: 'c1111111-1111-4111-8111-111111111111',
      source_id: 's1',
      source_name: 'Papara SSS',
    },
  ],
});

function list(rows: AiSuggestion[], openCount = rows.length): AiSuggestionList {
  return { suggestions: rows, total: rows.length, open_count: openCount };
}

function routes(rows: AiSuggestion[]): void {
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/ai/suggestions?')) return Promise.resolve(list(rows));
    const detail = rows.find((row) => path === `/ai/suggestions/${row.id}`);
    return detail ? Promise.resolve(detail) : Promise.reject(new Error(`unmocked GET ${path}`));
  });
}

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderQueue(props: Parameters<typeof Suggestions>[0], queryClient = client()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <Suggestions {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('Playbook suggestions — the queue (AI-23)', () => {
  it('lists the open suggestions and opens one with its masked excerpt and the note', async () => {
    routes([suggestion({}), OFFERED]);
    renderQueue({ canReview: true });

    const rows = await screen.findAllByTestId('ai-suggestion-row');
    expect(rows).toHaveLength(2);
    expect(api.get).toHaveBeenCalledWith('/ai/suggestions?status=open&limit=50');
    expect(within(rows[0]!).getByText('Wrong answer')).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/Already known/)).toBeInTheDocument();

    await userEvent.click(rows[0]!);
    const detail = await screen.findByTestId('ai-suggestion-detail');
    expect(
      within(detail).getByText('Papara ile gece yatırım yapabilir miyim?'),
    ).toBeInTheDocument();
    expect(within(detail).getByText('Papara 7/24 çalışır.')).toBeInTheDocument();
    expect(within(detail).getByText('Marked')).toBeInTheDocument();
    expect(within(detail).getByText(/Artık 7\/24 değil/)).toBeInTheDocument();
    // Both numbers are on the page, named through the ids catalogue.
    expect(within(detail).getByText('TJ1H8CFKRV')).toBeInTheDocument();
    expect(within(detail).getByText('TJ1H8CFKRV-2')).toBeInTheDocument();
  });

  it('says the knowledge already has the answer, and what was taken out of the agent’s words', async () => {
    routes([OFFERED]);
    renderQueue({ canReview: true });

    await userEvent.click(await screen.findByTestId('ai-suggestion-row'));
    const detail = await screen.findByTestId('ai-suggestion-detail');
    expect(within(detail).getByText('The knowledge already has this')).toBeInTheDocument();
    expect(within(detail).getByText(/Papara SSS/)).toBeInTheDocument();
    expect(within(detail).getByText(/\[kullanıcı adı\] \[tutar\]/)).toBeInTheDocument();
    expect(within(detail).getByLabelText('Title')).toHaveValue('Papara bakım saatleri');
  });

  it('shows an empty state when nobody has suggested anything', async () => {
    api.get.mockResolvedValueOnce(list([]));
    renderQueue({ canReview: true });
    expect(await screen.findByText('No suggestions')).toBeInTheDocument();
  });

  it('reads the status filter into the request', async () => {
    routes([]);
    renderQueue({ canReview: true });
    await screen.findByText('No suggestions');

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'rejected');
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/ai/suggestions?status=rejected&limit=50'),
    );
  });
});

describe('Playbook suggestions — reviewing (AI-23)', () => {
  it('accepts the edited proposal into the draft and says it is not live', async () => {
    routes([OFFERED]);
    api.patch.mockResolvedValue({ ...OFFERED, status: 'accepted' });
    renderQueue({ canReview: true });

    await userEvent.click(await screen.findByTestId('ai-suggestion-row'));
    const title = await screen.findByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Papara bakım');
    await userEvent.click(screen.getByRole('button', { name: 'Accept into the draft' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(`/ai/suggestions/${OFFER}`, {
        action: 'accept',
        proposed_change: {
          target: 'knowledge_snippet',
          title: 'Papara bakım',
          body: OFFERED.proposed_change!.body,
          source_id: null,
        },
      }),
    );
    expect(
      await screen.findByText(/goes live with the next published version/),
    ).toBeInTheDocument();
  });

  it('keeps the edit without deciding when only "Save edits" is pressed', async () => {
    routes([OFFERED]);
    api.patch.mockResolvedValue({ ...OFFERED, status: 'in_review' });
    renderQueue({ canReview: true });

    await userEvent.click(await screen.findByTestId('ai-suggestion-row'));
    expect(await screen.findByRole('button', { name: 'Save edits' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Text'), ' Ek not.');
    await userEvent.click(screen.getByRole('button', { name: 'Save edits' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch.mock.calls[0]![1]).toMatchObject({ action: 'edit' });
  });

  it('does not reject without a reason, and sends the reason with the rejection', async () => {
    let current = suggestion({});
    api.get.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith('/ai/suggestions?') ? list([current]) : current),
    );
    api.patch.mockImplementation(() => {
      current = suggestion({ status: 'rejected', review_note: 'Eski bilgi' });
      return Promise.resolve(current);
    });
    renderQueue({ canReview: true });

    await userEvent.click(await screen.findByTestId('ai-suggestion-row'));
    await userEvent.click(await screen.findByRole('button', { name: 'Reject…' }));
    const confirm = screen.getByRole('button', { name: 'Reject suggestion' });
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Why is it rejected/), '  Eski bilgi ');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(`/ai/suggestions/${WRONG}`, {
        action: 'reject',
        review_note: 'Eski bilgi',
      }),
    );
    expect(await screen.findByTestId('ai-suggestion-outcome')).toHaveTextContent(
      'Rejected. Reason: Eski bilgi',
    );
  });

  it('cannot accept a procedure change before a procedure is picked', async () => {
    const procedureChange = suggestion({
      id: OFFER,
      kind: 'missing_info',
      proposed_change: {
        target: 'procedure_example',
        title: 'Örnek',
        body: 'papara yatırım nerede',
        source_id: null,
      },
    });
    routes([procedureChange]);
    api.patch.mockResolvedValue({ ...procedureChange, status: 'accepted' });
    renderQueue({
      canReview: true,
      skills: [{ id: SKILL_ID, name: 'Yatırım sorunu', mode: 'procedure' }],
    });

    await userEvent.click(await screen.findByTestId('ai-suggestion-row'));
    const accept = await screen.findByRole('button', { name: 'Accept into the draft' });
    expect(accept).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('Procedure'), SKILL_ID);
    expect(accept).toBeEnabled();
    await userEvent.click(accept);
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch.mock.calls[0]![1]).toMatchObject({
      action: 'accept',
      proposed_change: { target: 'procedure_example', source_id: SKILL_ID },
    });
  });

  it('merges into another open suggestion it names', async () => {
    routes([suggestion({}), OFFERED]);
    api.patch.mockResolvedValue(suggestion({ status: 'merged', duplicate_of: OFFER }));
    renderQueue({ canReview: true });

    await userEvent.click((await screen.findAllByTestId('ai-suggestion-row'))[0]!);
    const merge = await screen.findByRole('button', { name: 'Merge' });
    expect(merge).toBeDisabled();
    await userEvent.selectOptions(
      screen.getByLabelText('Merge into another open suggestion'),
      OFFER,
    );
    await userEvent.click(merge);

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(`/ai/suggestions/${WRONG}`, {
        action: 'merge',
        duplicate_of: OFFER,
      }),
    );
  });

  it('keeps the conversation as a test scenario', async () => {
    routes([suggestion({})]);
    api.post.mockResolvedValue({ id: 'sc-1', name: 'Yanlış cevap: Papara' });
    renderQueue({ canReview: true });

    await userEvent.click(await screen.findByTestId('ai-suggestion-row'));
    await userEvent.click(await screen.findByRole('button', { name: 'Keep as a test scenario' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/ai/suggestions/${WRONG}/to-scenario`, {}),
    );
    expect(await screen.findByText(/Yanlış cevap: Papara/)).toBeInTheDocument();
  });

  it('shows the API sentence when a decision is refused', async () => {
    routes([suggestion({})]);
    api.patch.mockRejectedValue(
      new ApiClientError({
        type: 'ai_suggestion_state',
        status: 409,
        message: 'Already decided.',
        requestId: 'req-1',
      }),
    );
    renderQueue({ canReview: true });

    await userEvent.click(await screen.findByTestId('ai-suggestion-row'));
    await userEvent.click(await screen.findByRole('button', { name: 'Reject…' }));
    await userEvent.type(screen.getByLabelText(/Why is it rejected/), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Reject suggestion' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('offers no decision to someone who may not review, and shows how theirs ended', async () => {
    const ended = suggestion({ status: 'rejected', review_note: 'Zaten biliniyor' });
    routes([ended]);
    renderQueue({ canReview: false });

    // Only their own suggestions are asked for.
    await screen.findByTestId('ai-suggestion-row');
    expect(api.get).toHaveBeenCalledWith('/ai/suggestions?status=open&limit=50&mine=true');
    await userEvent.click(screen.getByTestId('ai-suggestion-row'));
    expect(await screen.findByTestId('ai-suggestion-outcome')).toHaveTextContent(
      'Reason: Zaten biliniyor',
    );
    expect(screen.queryByRole('button', { name: 'Accept into the draft' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject…' })).toBeNull();
  });

  it('says a proposal is being drafted, and takes it when the job writes it', async () => {
    const drafting = suggestion({ id: OFFER, kind: 'promote_agent_answer', status: 'drafting' });
    let current: AiSuggestion = drafting;
    api.get.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith('/ai/suggestions?') ? list([current]) : current),
    );
    renderQueue({ canReview: true });

    await userEvent.click(await screen.findByTestId('ai-suggestion-row'));
    expect(await screen.findByText(/being drafted from the agent/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).toBeNull();

    current = { ...OFFERED, status: 'new' };
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3_200));
    });
    expect(await screen.findByLabelText('Title', undefined, { timeout: 4_000 })).toHaveValue(
      'Papara bakım saatleri',
    );
  }, 15_000);
});

describe('Playbook suggestions — the badge (AI-23)', () => {
  function Badge(): React.ReactElement {
    return <span data-testid="badge">{useSuggestionBadge()}</span>;
  }

  it('reads the open count, and a push moves it without a request', async () => {
    api.get.mockResolvedValue(list([], 2));
    const queryClient = client();
    render(
      <QueryClientProvider client={queryClient}>
        <Badge />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('2'));
    expect(api.get).toHaveBeenCalledWith('/ai/suggestions?status=open&limit=1');

    act(() => applyPush(queryClient, 'ai_suggestion_created', { open_count: 3, kind: 'tone' }));
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('3'));
    expect(queryClient.getQueryData<AiSuggestionList>(suggestionKeys.badge)?.open_count).toBe(3);
  });

  it('ignores a push whose count is not a number', () => {
    const queryClient = client();
    applyPush(queryClient, 'ai_suggestion_created', { open_count: 'x' });
    expect(queryClient.getQueryData(suggestionKeys.badge)).toBeUndefined();
  });

  it('refreshes the queue when the author hears how theirs ended', () => {
    const queryClient = client();
    queryClient.setQueryData(suggestionKeys.list('open', true), list([suggestion({})]));
    applyPush(queryClient, 'ai_suggestion_reviewed', {
      suggestion_id: WRONG,
      status: 'accepted',
    });
    expect(queryClient.getQueryState(suggestionKeys.list('open', true))?.isInvalidated).toBe(true);
  });
});
