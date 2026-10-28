/**
 * Raporlar › AI Kalite › Kalibrasyon (tm 319.3 · AI-24): an administrator
 * opens the month's round and closes it; every reviewer scores its
 * conversations under the review's rule (each critical criterion confirmed,
 * a verdict) and the request carries it; the report draws the agreement per
 * criterion and each reviewer's deviation, an outlier marked; a Team Lead
 * gets no "open" button.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLATFORM_QA_RUBRIC } from '@siyahtus/types';
import type * as AuthStore from '../../../lib/auth-store.js';
import type { QaCalibration as Round, QaCalibrationDetail } from './qa.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));

vi.mock('../../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { QaCalibration } = await import('./QaCalibration.js');
const { useAuth } = await import('../../../lib/auth-store.js');

const ROUND = 'k1111111-1111-4111-8111-111111111111';
const REVIEW = 'c1111111-1111-4111-8111-111111111111';
const LEAD = '44444444-4444-4444-8444-444444444444';

const ROUND_ROW: Round = {
  id: ROUND,
  period: '2026-10',
  rubric_id: 'r0000000-0000-4000-8000-000000000000',
  status: 'open',
  reviews: 1,
  my_scored: 0,
  created_by: null,
  created_at: '2026-10-28T08:00:00.000Z',
  closed_at: null,
};

function detail(overrides: Partial<QaCalibrationDetail> = {}): QaCalibrationDetail {
  return {
    ...ROUND_ROW,
    rubric: {
      id: ROUND_ROW.rubric_id,
      version: 1,
      criteria: PLATFORM_QA_RUBRIC.map((criterion) => ({ ...criterion })),
    },
    items: [
      {
        review_id: REVIEW,
        chat_id: 'TJ1H8CFKRV',
        thread_id: 'TJ1H8CFKRV-2',
        reasons: ['random'],
        excerpt: [
          {
            event_id: 'TJ1H8CFKRV-2_1',
            author_type: 'customer',
            is_ai: false,
            text: 'Bonus ne zaman yüklenir?',
            created_at: '2026-10-20T10:00:00.000Z',
          },
        ],
        excerpt_restricted: false,
        my_scores: null,
        my_final: null,
      },
    ],
    report: null,
    ...overrides,
  };
}

function signIn(role: string): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: '11111111-1111-4111-8111-111111111111',
      email: 'x@acme.localhost',
      name: 'X',
      role,
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: ['chats--access:rw'],
      routing_status: 'accepting_chats',
    },
  });
}

function renderRound(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <QaCalibration />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function serve(rounds: Round[], round: QaCalibrationDetail = detail()): void {
  api.get.mockImplementation((path: string) => {
    if (path === '/qa/calibrations') return Promise.resolve({ calibrations: rounds });
    if (path === `/qa/calibrations/${ROUND}`) return Promise.resolve(round);
    if (path === '/agents') return Promise.resolve({ items: [{ id: LEAD, name: 'Selin Kaya' }] });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function scoreAll(form: HTMLElement): Promise<void> {
  return (async () => {
    for (const box of within(form).getAllByTestId('qa-criterion')) {
      const first = within(box).getAllByRole('radio')[0]!;
      await userEvent.click(first);
      const confirm = within(box).queryByRole('checkbox');
      if (confirm) await userEvent.click(confirm);
    }
  })();
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe('QaCalibration (AI-24)', () => {
  it('lets an administrator open the month’s round', async () => {
    signIn('admin');
    serve([]);
    renderRound();
    api.post.mockResolvedValueOnce(ROUND_ROW);
    await userEvent.click(await screen.findByRole('button', { name: 'Open this month’s round' }));
    expect(api.post).toHaveBeenCalledWith('/qa/calibrations', {});
  });

  it('scores a conversation under the review’s rule', async () => {
    signIn('team_lead');
    serve([ROUND_ROW]);
    renderRound();

    expect(screen.queryByRole('button', { name: 'Open this month’s round' })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: /Conversation 1/ }));
    expect(screen.getByText('Bonus ne zaman yüklenir?')).toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'Your scores' });

    // Nothing scored: the button says what is missing, nothing is sent.
    await userEvent.click(within(form).getByRole('button', { name: 'Save scores' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(within(form).getAllByText('Score this criterion.')).toHaveLength(7);
    expect(within(form).getByText('Choose pass or fail.')).toBeInTheDocument();

    await scoreAll(form);
    const verdict = within(form).getByRole('group', { name: 'Verdict' });
    await userEvent.click(within(verdict).getByRole('radio', { name: 'Pass' }));
    api.post.mockResolvedValueOnce(detail({ my_scored: 1 }));
    await userEvent.click(within(form).getByRole('button', { name: 'Save scores' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [path, body] = api.post.mock.calls[0]!;
    expect(path).toBe(`/qa/calibrations/${ROUND}/scores`);
    expect(body).toMatchObject({
      review_id: REVIEW,
      final: 'pass',
      scores: {
        guardrails: { value: 'pass', confirmed: true },
        handoff_timing: { value: 'pass', confirmed: true },
        tone: { value: 1, confirmed: false },
      },
    });
    expect(await screen.findByText('Scores saved.')).toBeInTheDocument();
  });

  it('draws the report: agreement per criterion and each reviewer’s deviation', async () => {
    signIn('admin');
    serve(
      [{ ...ROUND_ROW, status: 'closed', closed_at: '2026-10-31T10:00:00.000Z' }],
      detail({
        status: 'closed',
        closed_at: '2026-10-31T10:00:00.000Z',
        report: {
          criteria: [
            {
              key: 'guardrails',
              label: 'Compliance rules kept',
              agreement_percent: 87.5,
              scored: 8,
            },
            { key: 'tone', label: 'Tone', agreement_percent: null, scored: 0 },
          ],
          reviewers: [{ reviewer_id: LEAD, scored: 4, deviation_percent: 42.9, outlier: true }],
        },
      }),
    );
    renderRound();

    const report = await screen.findByTestId('qa-calibration-report');
    const agreement = within(report).getByRole('table', { name: 'Agreement per criterion' });
    expect(within(agreement).getByText('Compliance rules kept').closest('tr')).toHaveTextContent(
      '88%',
    );
    expect(within(agreement).getByText('Tone').closest('tr')).toHaveTextContent('—');
    const reviewers = within(report).getByRole('table', { name: 'Reviewers' });
    expect(await within(reviewers).findByText('Selin Kaya')).toBeInTheDocument();
    expect(within(reviewers).getByText('Outlier')).toBeInTheDocument();
    // A closed round takes no more scores and cannot be closed again.
    expect(screen.queryByRole('button', { name: 'Close round' })).toBeNull();
  });

  it('says agreement needs two reviewers when only one scored', async () => {
    signIn('admin');
    serve(
      [ROUND_ROW],
      detail({
        report: {
          criteria: [{ key: 'tone', label: 'Tone', agreement_percent: null, scored: 0 }],
          reviewers: [],
        },
      }),
    );
    renderRound();
    expect(
      await screen.findByText(
        /Agreement is measured on conversations at least two reviewers scored/,
      ),
    ).toBeInTheDocument();
  });

  it('closes an open round for an administrator', async () => {
    signIn('admin');
    serve([ROUND_ROW]);
    renderRound();
    api.post.mockResolvedValueOnce(detail({ status: 'closed' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Close round' }));
    expect(api.post).toHaveBeenCalledWith(`/qa/calibrations/${ROUND}/close`, {});
  });
});
