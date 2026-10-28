/**
 * Raporlar › AI Kalite › Kuyruk (tm 319.3 · AI-24): the queue draws what the
 * API serves with its reasons, status and due date; the filters are the
 * request's; "Review" claims a ready one and opens it, and a refused claim
 * says why; the last 30 days' figures sit above it; the page is a Team
 * Lead's and up, with Queue and Calibration as tabs.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../../lib/api-client.js';
import type * as AuthStore from '../../../lib/auth-store.js';
import type { QaReviewRow, QaSummary } from './qa.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));

vi.mock('../../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { AiQualityPage } = await import('./AiQualityPage.js');
const { useAuth } = await import('../../../lib/auth-store.js');

const ME = '11111111-1111-4111-8111-111111111111';
const READY = 'c1111111-1111-4111-8111-111111111111';
const MINE = 'c2222222-2222-4222-8222-222222222222';

function row(overrides: Partial<QaReviewRow>): QaReviewRow {
  return {
    id: READY,
    chat_id: 'TJ1H8CFKRV',
    thread_id: 'TJ1H8CFKRV-2',
    ai_agent_id: 'a0000000-0000-4000-8000-000000000000',
    config_version_id: null,
    team_id: 3,
    brand_id: null,
    reasons: ['risk_flag'],
    priority: 'risk',
    status: 'ready',
    sample_day: '2026-10-27',
    assigned_to: null,
    claimed_at: null,
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
    updated_at: '2026-10-28T02:00:00.000Z',
    ...overrides,
  };
}

const SUMMARY: QaSummary = {
  from: '2026-09-28T00:00:00.000Z',
  to: '2026-10-28T00:00:00.000Z',
  open: 2,
  overdue: 1,
  completed: 4,
  passed: 3,
  failed: 1,
  critical_failed: 1,
  by_reason: { random: 3, risk_flag: 1 },
  criteria_failed: { guardrails: 1 },
  mandatory_handoff: { reviewed: 2, violations: 1 },
  guardrail_violations_confirmed: 1,
  false_resolutions: 0,
};

function signIn(role: string, scopes: string[] = ['chats--access:rw']): void {
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
      scopes,
      routing_status: 'accepting_chats',
    },
  });
}

function renderPage(path = '/app/reports/ai-quality'): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/reports/ai-quality" element={<AiQualityPage />} />
          <Route path="/app/reports/ai-quality/:reviewId" element={<p>review page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function serve(rows: QaReviewRow[]): void {
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/qa/reviews?')) {
      return Promise.resolve({ reviews: rows, total: rows.length, open_count: rows.length });
    }
    if (path === '/qa/summary') return Promise.resolve(SUMMARY);
    if (path === '/qa/calibrations') return Promise.resolve({ calibrations: [] });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  signIn('team_lead');
});

describe('QaQueue (AI-24)', () => {
  it('lists the reviews with why each is there, its status and due date, under the period’s figures', async () => {
    serve([
      row({}),
      row({
        id: MINE,
        thread_id: 'TJ1H8CFKRV-3',
        reasons: ['random', 'manual'],
        priority: 'normal',
        status: 'in_review',
        assigned_to: ME,
        overdue: true,
      }),
    ]);
    renderPage();

    const rows = await screen.findAllByTestId('qa-queue-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Risk flag')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Ready')).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('button', { name: 'Review' })).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Sent by hand')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Overdue')).toBeInTheDocument();
    expect(within(rows[1]!).getByRole('link', { name: 'Continue' })).toHaveAttribute(
      'href',
      `/app/reports/ai-quality/${MINE}`,
    );
    expect(screen.getByText('2 reviews · 2 open')).toBeInTheDocument();

    const figures = screen.getByRole('region', { name: 'AI quality figures' });
    expect(within(figures).getByText('Pass rate').parentElement).toHaveTextContent('75%');
    expect(within(figures).getByText('Missed hand-overs').parentElement).toHaveTextContent(
      'of 2 mandatory hand-overs checked',
    );
    expect(api.get).toHaveBeenCalledWith('/qa/reviews?status=open&offset=0');
  });

  it('asks the API for what the filters say', async () => {
    serve([]);
    renderPage();
    expect(await screen.findByText('Nothing to review here')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'completed');
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'mandatory_handoff');
    await userEvent.click(screen.getByLabelText('Only the ones I hold'));
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(
        '/qa/reviews?status=completed&reason=mandatory_handoff&mine=true&offset=0',
      ),
    );
  });

  it('claims a ready review and opens it, or says why the claim was refused', async () => {
    serve([row({})]);
    renderPage();
    const review = await screen.findByRole('button', { name: 'Review' });

    api.post.mockRejectedValueOnce(
      new ApiClientError({
        type: 'qa_review_state',
        status: 409,
        message: 'claimed',
        requestId: 'r-1',
        details: { reason: 'claimed' },
      }),
    );
    await userEvent.click(review);
    expect(
      await screen.findByText('Another reviewer claimed this review first.'),
    ).toBeInTheDocument();

    api.post.mockResolvedValueOnce({ ...row({ status: 'in_review', assigned_to: ME }) });
    await userEvent.click(review);
    expect(api.post).toHaveBeenLastCalledWith(`/qa/reviews/${READY}/claim`, {});
    expect(await screen.findByText('review page')).toBeInTheDocument();
  });

  it('has the calibration round as a second tab', async () => {
    serve([]);
    renderPage('/app/reports/ai-quality?view=calibration');
    expect(await screen.findByRole('tab', { name: 'Calibration' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByText('No calibration round yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Queue' }));
    expect(await screen.findByText('Nothing to review here')).toBeInTheDocument();
  });

  it('is not drawn for a Team Member, whose every read would be refused', async () => {
    signIn('agent');
    serve([]);
    renderPage();
    expect(
      await screen.findByText('AI quality is reviewed by Team Leads and administrators'),
    ).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});
