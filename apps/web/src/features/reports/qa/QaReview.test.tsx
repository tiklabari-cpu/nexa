/**
 * Raporlar › AI Kalite › one review (tm 319.3 · AI-24): the three panes draw
 * what the API serves; a ready review is claimed first; the pre-score fills
 * what is not scored and confirms nothing — completing without ticking each
 * critical criterion sends nothing and says what is missing; a failed
 * critical criterion makes the verdict a fail; the request carries each
 * person's confirmation; a completed critical failure links its follow-ups;
 * a responsible-gaming excerpt says its text is withheld; the API's refusal
 * reads as the QA sentence.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLATFORM_QA_RUBRIC } from '@siyahtus/types';
import { ApiClientError } from '../../../lib/api-client.js';
import type * as AuthStore from '../../../lib/auth-store.js';
import type { QaReviewDetail } from './qa.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
}));

vi.mock('../../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { QaReviewPage } = await import('./QaReview.js');
const { useAuth } = await import('../../../lib/auth-store.js');

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const REVIEW = 'c1111111-1111-4111-8111-111111111111';

function review(overrides: Partial<QaReviewDetail> = {}): QaReviewDetail {
  return {
    id: REVIEW,
    chat_id: 'TJ1H8CFKRV',
    thread_id: 'TJ1H8CFKRV-2',
    ai_agent_id: 'a0000000-0000-4000-8000-000000000000',
    config_version_id: null,
    team_id: 3,
    brand_id: null,
    reasons: ['risk_flag', 'random'],
    priority: 'risk',
    status: 'in_review',
    sample_day: '2026-10-27',
    assigned_to: ME,
    claimed_at: '2026-10-28T09:00:00.000Z',
    due_at: '2026-10-30T09:00:00.000Z',
    overdue: false,
    rubric_id: 'r0000000-0000-4000-8000-000000000000',
    prescored: true,
    final: null,
    critical_fail: false,
    reviewer_id: null,
    reviewed_at: null,
    comments: null,
    created_at: '2026-10-28T02:00:00.000Z',
    updated_at: '2026-10-28T09:00:00.000Z',
    rubric: {
      id: 'r0000000-0000-4000-8000-000000000000',
      version: 1,
      criteria: PLATFORM_QA_RUBRIC.map((criterion) => ({ ...criterion })),
    },
    prescore: {
      criteria: [
        {
          key: 'topic',
          value: 'pass',
          evidence_event_ids: ['TJ1H8CFKRV-2_1'],
          rationale: 'Asked about deposits',
        },
        { key: 'required_info', value: 'pass', evidence_event_ids: [], rationale: '' },
        { key: 'faithfulness', value: 'pass', evidence_event_ids: [], rationale: '' },
        {
          key: 'guardrails',
          value: 'pass',
          evidence_event_ids: ['TJ1H8CFKRV-2_3'],
          rationale: 'No promise made',
        },
        { key: 'handoff_timing', value: 'pass', evidence_event_ids: [], rationale: '' },
        { key: 'handoff_summary', value: null, evidence_event_ids: [], rationale: 'No hand-over' },
        { key: 'tone', value: 4, evidence_event_ids: [], rationale: '' },
      ],
      critical_candidates: [],
      overall: 'pass',
      scored_at: '2026-10-28T02:01:00.000Z',
    },
    scores: {},
    excerpt: [
      {
        event_id: 'TJ1H8CFKRV-2_1',
        author_type: 'customer',
        is_ai: false,
        text: 'Gece yatırım yapabilir miyim?',
        created_at: '2026-10-27T21:00:00.000Z',
      },
      {
        event_id: 'TJ1H8CFKRV-2_3',
        author_type: 'bot',
        is_ai: true,
        text: 'Evet, Papara ile 7/24 yatırabilirsiniz.',
        created_at: '2026-10-27T21:00:05.000Z',
      },
    ],
    excerpt_restricted: false,
    trace: {
      decisions: [
        {
          id: 'd1',
          decision: 'answer',
          step: 'answer_from_knowledge',
          procedure_version: null,
          handoff_reason: null,
          knowledge_source_ids: ['k1', 'k2'],
          created_at: '2026-10-27T21:00:04.000Z',
        },
      ],
      guardrail_hits: [{ rule_key: 'G4', stage: 'output', action_taken: 'warn' }],
      handoffs: [],
      risk_flags: [{ type: 'self_exclusion', severity: 'high', status: 'open' }],
    },
    follow_ups: { suggestion_id: null, scenario_id: null },
    ...overrides,
  };
}

function signIn(role = 'team_lead'): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: ME,
      email: 'lead@acme.localhost',
      name: 'Lead',
      role,
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: ['chats--access:rw'],
      routing_status: 'accepting_chats',
    },
  });
}

function renderReview(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/app/reports/ai-quality/${REVIEW}`]}>
        <Routes>
          <Route path="/app/reports/ai-quality/:reviewId" element={<QaReviewPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function criterion(key: string): HTMLElement {
  const box = screen
    .getAllByTestId('qa-criterion')
    .find((element) => element.dataset['criterion'] === key);
  if (!box) throw new Error(`no criterion ${key}`);
  return box;
}

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  api.post.mockReset();
  signIn();
});

describe('QaReview (AI-24)', () => {
  it('draws the conversation, the decision trail and the rubric with the pre-score beside it', async () => {
    api.get.mockResolvedValue(review());
    renderReview();

    const conversation = await screen.findByRole('region', { name: 'Conversation' });
    expect(within(conversation).getByText('Gece yatırım yapabilir miyim?')).toBeInTheDocument();
    expect(within(conversation).getByText('AI')).toBeInTheDocument();

    const trail = screen.getByRole('region', { name: 'Decision trail' });
    expect(within(trail).getByText('answer')).toBeInTheDocument();
    expect(within(trail).getByText('G4')).toBeInTheDocument();
    expect(within(trail).getByText('self_exclusion')).toBeInTheDocument();

    expect(api.get).toHaveBeenCalledWith(`/qa/reviews/${REVIEW}`);
    expect(within(criterion('topic')).getByText(/AI pre-score: Pass/)).toBeInTheDocument();
    expect(within(criterion('guardrails')).getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('Risk flag')).toBeInTheDocument();

    // The evidence points at the excerpt's message.
    await userEvent.click(
      screen.getByRole('button', { name: 'Show message 1 cited for “Compliance rules kept”' }),
    );
    expect(
      within(conversation).getByText('Evet, Papara ile 7/24 yatırabilirsiniz.').closest('li'),
    ).toHaveAttribute('data-highlighted', 'true');
  });

  it('takes the pre-score without confirming anything, and refuses to complete until each critical criterion is ticked', async () => {
    api.get.mockResolvedValue(review());
    renderReview();

    await userEvent.click(await screen.findByRole('button', { name: 'Use the pre-score' }));
    expect(within(criterion('topic')).getByRole('radio', { name: 'Pass' })).toBeChecked();
    expect(within(criterion('tone')).getByRole('radio', { name: '4' })).toBeChecked();
    const guardrailsBox = within(criterion('guardrails')).getByRole('checkbox', {
      name: 'I checked “Compliance rules kept” myself',
    });
    expect(guardrailsBox).not.toBeChecked();

    await userEvent.click(screen.getByRole('radio', { name: 'Pass', checked: false }));
    await userEvent.click(screen.getByRole('button', { name: 'Complete review' }));

    expect(api.put).not.toHaveBeenCalled();
    expect(
      within(criterion('guardrails')).getByText('Confirm this critical criterion on its own.'),
    ).toBeInTheDocument();
    expect(
      within(criterion('handoff_timing')).getByText('Confirm this critical criterion on its own.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('2 things are still missing');

    // Each one by the person, then the request carries both confirmations.
    await userEvent.click(guardrailsBox);
    await userEvent.click(
      within(criterion('handoff_timing')).getByRole('checkbox', {
        name: 'I checked “Handed over at the right time” myself',
      }),
    );
    api.put.mockResolvedValue(
      review({
        status: 'completed',
        final: 'pass',
        reviewer_id: ME,
        reviewed_at: '2026-10-28T10:00:00.000Z',
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Complete review' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const [path, body] = api.put.mock.calls[0]!;
    expect(path).toBe(`/qa/reviews/${REVIEW}`);
    expect(body).toMatchObject({
      action: 'complete',
      final: 'pass',
      scores: {
        topic: { value: 'pass', confirmed: false },
        guardrails: { value: 'pass', confirmed: true },
        handoff_timing: { value: 'pass', confirmed: true },
        handoff_summary: { value: null, confirmed: false },
        tone: { value: 4, confirmed: false },
      },
    });
    expect(await screen.findByTestId('qa-review-outcome')).toHaveTextContent('Completed');
  });

  it('makes a failed critical criterion a fail, and a new value takes back its confirmation', async () => {
    api.get.mockResolvedValue(review({ prescore: null }));
    renderReview();

    const guardrails = await screen
      .findAllByTestId('qa-criterion')
      .then(() => criterion('guardrails'));
    await userEvent.click(within(guardrails).getByRole('radio', { name: 'Pass' }));
    const box = within(guardrails).getByRole('checkbox');
    await userEvent.click(box);
    expect(box).toBeChecked();

    const verdict = screen.getByRole('group', { name: 'Verdict' });
    await userEvent.click(within(verdict).getByRole('radio', { name: 'Pass' }));
    await userEvent.click(within(guardrails).getByRole('radio', { name: 'Fail' }));

    expect(box).not.toBeChecked();
    expect(within(verdict).getByRole('radio', { name: 'Fail' })).toBeChecked();
    expect(within(verdict).getByRole('radio', { name: 'Pass' })).toBeDisabled();
    expect(
      screen.getByText('A critical criterion failed, so the review is a fail.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/No pre-score for this one/)).toBeInTheDocument();
  });

  it('saves a draft and releases the review back to the queue', async () => {
    api.get.mockResolvedValue(review({ prescore: null }));
    renderReview();
    await userEvent.click(
      within(await screen.findByTestId('qa-review').then(() => criterion('topic'))).getByRole(
        'radio',
        { name: 'Fail' },
      ),
    );
    await userEvent.type(screen.getByLabelText('Comments'), 'Missed the limit');
    api.put.mockResolvedValueOnce(
      review({ prescore: null, scores: { topic: { value: 'fail', confirmed: false } } }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(`/qa/reviews/${REVIEW}`, {
        action: 'save',
        scores: { topic: { value: 'fail', confirmed: false } },
        comments: 'Missed the limit',
      }),
    );
    expect(await screen.findByText('Saved.')).toBeInTheDocument();

    api.put.mockResolvedValueOnce(review({ status: 'ready', assigned_to: null }));
    await userEvent.click(screen.getByRole('button', { name: 'Return to the queue' }));
    await waitFor(() => expect(api.put.mock.calls[1]![1]).toMatchObject({ action: 'release' }));
    expect(await screen.findByRole('button', { name: 'Claim' })).toBeInTheDocument();
  });

  it('claims a ready review first, and says why a claim was refused', async () => {
    api.get.mockResolvedValue(review({ status: 'ready', assigned_to: null }));
    renderReview();

    expect(await screen.findByText(/Claim the review to score it/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete review' })).toBeNull();

    api.post.mockRejectedValueOnce(
      new ApiClientError({
        type: 'authorization',
        status: 403,
        message: 'conflict',
        requestId: 'r-1',
        details: { reason: 'conflict_of_interest' },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Claim' }));
    expect(
      await screen.findByText('You took part in this conversation, so someone else reviews it.'),
    ).toBeInTheDocument();

    api.post.mockResolvedValueOnce(review());
    await userEvent.click(screen.getByRole('button', { name: 'Claim' }));
    expect(api.post).toHaveBeenLastCalledWith(`/qa/reviews/${REVIEW}/claim`, {});
    expect(await screen.findByRole('button', { name: 'Complete review' })).toBeInTheDocument();
  });

  it('shows another reviewer’s review without the controls', async () => {
    api.get.mockResolvedValue(review({ assigned_to: OTHER }));
    renderReview();
    expect(await screen.findByText('Another reviewer holds this review.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete review' })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('links a completed critical failure to its suggestion and scenario draft', async () => {
    api.get.mockResolvedValue(
      review({
        status: 'completed',
        final: 'fail',
        critical_fail: true,
        reviewer_id: ME,
        reviewed_at: '2026-10-28T10:00:00.000Z',
        scores: { guardrails: { value: 'fail', confirmed: true } },
        follow_ups: {
          suggestion_id: 's0000000-0000-4000-8000-000000000000',
          scenario_id: 't0000000-0000-4000-8000-000000000000',
          mandatory_handoff_violation: true,
        },
      }),
    );
    renderReview();

    const outcome = await screen.findByTestId('qa-review-outcome');
    expect(screen.getByText('Reviewed: critical failure')).toBeInTheDocument();
    expect(outcome).toHaveTextContent('The AI missed a hand-over it had to make');
    expect(
      within(outcome).getByRole('link', { name: 'Open the coaching suggestion' }),
    ).toHaveAttribute('href', '/app/playbook?view=suggestions');
    expect(
      within(outcome).getByRole('link', { name: 'Open the test scenario draft' }),
    ).toHaveAttribute('href', '/app/playbook?view=test');
    // Read-only: the scores are drawn, nothing can change them.
    expect(within(criterion('guardrails')).getByRole('radio', { name: 'Fail' })).toBeChecked();
    expect(within(criterion('guardrails')).getByRole('radio', { name: 'Fail' })).toBeDisabled();
  });

  it('says a responsible-gaming conversation’s text is withheld', async () => {
    api.get.mockResolvedValue(
      review({
        excerpt_restricted: true,
        excerpt: review().excerpt.map((message) => ({ ...message, text: '' })),
      }),
    );
    renderReview();
    expect(await screen.findByText('Responsible gaming conversation')).toBeInTheDocument();
    expect(screen.getAllByText('Text hidden')).toHaveLength(2);
  });

  it('says a review it cannot see could not be loaded', async () => {
    api.get.mockRejectedValue(
      new ApiClientError({ type: 'not_found', status: 404, message: 'x', requestId: 'r-2' }),
    );
    renderReview();
    expect(await screen.findByText('This review could not be loaded.')).toBeInTheDocument();
  });
});
