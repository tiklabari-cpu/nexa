/**
 * Raporlar › AI Agent's quality panel (tm 320.3 · AI-25): the figures are the
 * API's `quality` block as the breakdown returns it, named and explained by
 * `AI_METRIC_DEFINITIONS`; the AI's "solved" stands beside the player's answer
 * (K9); mandatory hand-over violations are listed by id; AI versions sit side
 * by side, and a row narrows every figure to its group; the list behind a
 * figure pages by cursor.
 */
import { AI_METRIC_DEFINITIONS, emptyAiMetricCounts } from '@siyahtus/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import type {
  AiMetricConversationsWire,
  AiQualityBreakdownWire,
  AiQualityRatesWire,
  AiQualityWire,
} from './ai-metrics.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { AiMetricsPanel } = await import('./AiMetricsPanel.js');

const RANGE = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T00:00:00.000Z' };
const V12 = '11111111-1111-4111-8111-111111111112';
const V13 = '11111111-1111-4111-8111-111111111113';

/**
 * The task's acceptance fixture: 10 connections — 3 confirmed, 4 assumed (one
 * back about the same topic at 48 hours), 3 handed over (one a mandatory
 * responsible-gaming hand-over).
 */
function rates(over: Partial<AiQualityRatesWire> = {}): AiQualityRatesWire {
  return {
    conversations: 10,
    low_sample: true,
    confirmed_resolution: 0.3,
    assumed_resolution: 0.3,
    unsettled: 0,
    false_resolution: 0.1429,
    containment: 0.7,
    handoff_rate: 0.3,
    handoff_quality: 0.5,
    reask_rate: 0.5,
    mandatory_handoff_compliance: 1,
    guardrail_violation: 0,
    guardrail_suspected: 0.1,
    bsat: 0.75,
    csat_after_handoff: null,
    clarification_efficiency: 1.5,
    repeat_unmeasured: 1,
    counts: { ...emptyAiMetricCounts(), conversations: 10, bsat_good: 3, bsat_bad: 1 },
    ...over,
  };
}

function quality(over: Partial<AiQualityWire> = {}): AiQualityWire {
  return {
    ...rates(),
    claims: {
      ai_claimed_resolved: 5,
      player_confirmed: 3,
      player_denied: 1,
      claimed_unanswered: 1,
    },
    handoff_reasons: [
      { reason: 'player_request', count: 1 },
      { reason: 'no_knowledge', count: 1 },
      { reason: 'guardrail_rg', count: 1 },
    ],
    handoff_wait: {
      all: { count: 3, median_seconds: 90, p90_seconds: 300 },
      in_hours: { count: 2, median_seconds: 60, p90_seconds: 120 },
      out_of_hours: { count: 1, median_seconds: 600, p90_seconds: 600 },
    },
    consistency: 0.8,
    mandatory_violations: [],
    ...over,
  };
}

function breakdown(
  by: AiQualityBreakdownWire['by'],
  total: AiQualityWire = quality(),
): AiQualityBreakdownWire {
  const rows: AiQualityBreakdownWire['rows'] =
    by === 'version'
      ? [
          {
            key: V12,
            label: 'v12',
            quality: rates({ conversations: 6, confirmed_resolution: 0.1667 }),
          },
          {
            key: V13,
            label: 'v13',
            quality: rates({ conversations: 4, confirmed_resolution: 0.5 }),
          },
        ]
      : by === 'reason'
        ? [
            { key: 'no_knowledge', label: 'no_knowledge', quality: rates({ conversations: 1 }) },
            { key: null, label: null, quality: rates({ conversations: 7 }) },
          ]
        : [];
  return { range: RANGE, by, total, rows };
}

function conversations(cursor: string | undefined): AiMetricConversationsWire {
  const row = (id: string, thread: string) => ({
    id,
    thread_id: thread,
    chat_id: 'DAYCHAT001',
    started_at: '2026-10-20T10:00:00.000Z',
    ended_at: '2026-10-20T10:05:00.000Z',
    outcome: 'false_resolved',
    intent: 'withdrawal_status',
    language: 'en',
    config_version_id: V13,
    team_id: '1',
    brand_id: null,
    ai_turns: 2,
    ai_claimed_resolved: true,
    resolution_confirmation: null,
    handoff_reason: null,
    handoff_mandatory_rule: null,
    mandatory_handoff_violation: false,
    repeat_same_intent_72h: true,
    repeat_any_72h: true,
    qa_result: null,
    finalized_at: '2026-10-23T11:00:00.000Z',
  });
  return cursor === undefined
    ? {
        range: RANGE,
        metric: 'false_resolution',
        conversations: [row('00000000-0000-4000-8000-000000000001', 'CONNFIRST1')],
        next_cursor: 'page-2',
      }
    : {
        range: RANGE,
        metric: 'false_resolution',
        conversations: [row('00000000-0000-4000-8000-000000000002', 'CONNSECOND')],
        next_cursor: null,
      };
}

/** Route the two endpoints; `total` lets a test change the window's figures. */
function mockApi(total: AiQualityWire = quality()): void {
  api.get.mockImplementation((path: string) => {
    const url = new URL(path, 'http://x');
    if (url.pathname === '/reports/ai-agent/breakdown') {
      return Promise.resolve(
        breakdown(url.searchParams.get('by') as AiQualityBreakdownWire['by'], total),
      );
    }
    if (url.pathname === '/reports/ai-agent/conversations') {
      return Promise.resolve(conversations(url.searchParams.get('cursor') ?? undefined));
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function calls(pathname: string): URLSearchParams[] {
  return api.get.mock.calls
    .map(([path]) => new URL(path as string, 'http://x'))
    .filter((url) => url.pathname === pathname)
    .map((url) => url.searchParams);
}

function wrap(ui: ReactElement): ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

/** The card of one metric, by its stable key. */
function card(metric: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-metric="${metric}"]`);
  if (!found) throw new Error(`no card for ${metric}`);
  return found;
}

beforeEach(() => {
  api.get.mockReset();
  mockApi();
});

afterEach(() => {
  resetLocale();
});

describe('AiMetricsPanel (AI-25)', () => {
  it('shows the acceptance fixture: 30% confirmed, 30% assumed, 1/7 false, 30% handed over, 100% compliance (FR-MOD-07.4)', async () => {
    render(wrap(<AiMetricsPanel range={RANGE} rangeKey="30" />));

    expect(
      await screen.findByText('Over 10 ended conversations the AI wrote in'),
    ).toBeInTheDocument();
    expect(within(card('confirmed_resolution')).getByText('30%')).toBeInTheDocument();
    expect(within(card('assumed_resolution')).getByText('30%')).toBeInTheDocument();
    expect(within(card('false_resolution')).getByText('14%')).toBeInTheDocument();
    expect(within(card('handoff_rate')).getByText('30%')).toBeInTheDocument();
    expect(within(card('mandatory_handoff_compliance')).getByText('100%')).toBeInTheDocument();
    expect(
      within(card('mandatory_handoff_compliance')).getByText('Target 100%'),
    ).toBeInTheDocument();
    // N = 10 is under 20: the rates carry the few-samples caution.
    expect(screen.getByRole('status')).toHaveTextContent('Few samples: 10 conversations');

    // One read: the breakdown's `total` is the window's quality block.
    const [first] = calls('/reports/ai-agent/breakdown');
    expect(first?.get('by')).toBe('version');
    expect(first?.get('from')).toBe(RANGE.from);
    expect(first?.get('to')).toBe(RANGE.to);
  });

  it('names and explains each figure from the shared definitions, in Turkish too', async () => {
    const { restore } = renderWithLocale(
      wrap(<AiMetricsPanel range={RANGE} rangeKey="30" />),
      'tr',
    );
    try {
      const button = await screen.findByRole('button', { name: 'Onaylı çözüm neyi sayar' });
      expect(button).toHaveAccessibleDescription(
        AI_METRIC_DEFINITIONS.confirmed_resolution.hint.tr,
      );
      expect(within(card('false_resolution')).getByText('Yanlış çözüm')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'AI kalitesi' })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('keeps what the AI said apart from what the player answered (K9)', async () => {
    render(wrap(<AiMetricsPanel range={RANGE} rangeKey="30" />));
    await screen.findByText('Over 10 ended conversations the AI wrote in');

    const claims = screen.getByText('What the AI said beside what the player answered')
      .parentElement as HTMLElement;
    const figure = (label: string) =>
      within(claims).getByText(label).nextElementSibling as HTMLElement;
    expect(figure('AI said it is solved')).toHaveTextContent('5');
    expect(figure('Player said Yes')).toHaveTextContent('3');
    expect(figure('Player said No')).toHaveTextContent('1');
    // The confirmed rate is the player's 3, never the AI's 5.
    expect(within(card('confirmed_resolution')).getByText('30%')).toBeInTheDocument();
  });

  it('lists a mandatory hand-over violation by id and marks compliance below its target', async () => {
    mockApi(
      quality({
        mandatory_handoff_compliance: 0.5,
        mandatory_violations: [
          {
            thread_id: 'CONNMISSED',
            chat_id: 'DAYMISSED1',
            ended_at: '2026-10-21T09:00:00.000Z',
            handoff_mandatory_rule: null,
          },
        ],
      }),
    );
    render(wrap(<AiMetricsPanel range={RANGE} rangeKey="30" />));

    await screen.findByText('Over 10 ended conversations the AI wrote in');
    const value = within(card('mandatory_handoff_compliance')).getByText('50%');
    expect(value).toHaveClass('text-warning');
    const table = screen.getByRole('table', { name: 'Mandatory hand-over violations' });
    const [, row] = within(table).getAllByRole('row');
    expect(row).toHaveTextContent('CONNMISSED');
    expect(row).toHaveTextContent('DAYMISSED1');
    expect(row).toHaveTextContent('Found by QA');
  });

  it('puts v12 beside v13, and narrows every figure to the row picked', async () => {
    const user = userEvent.setup();
    render(wrap(<AiMetricsPanel range={RANGE} rangeKey="30" />));

    const table = await screen.findByRole('table', { name: 'AI quality by AI version' });
    const [, v12, v13] = within(table).getAllByRole('row');
    expect(v12).toHaveTextContent('v12');
    expect(v12).toHaveTextContent('17%');
    expect(v13).toHaveTextContent('v13');
    expect(v13).toHaveTextContent('50%');

    await user.click(within(table).getByRole('button', { name: 'Show only v13' }));
    await waitFor(() =>
      expect(calls('/reports/ai-agent/breakdown').at(-1)?.get('config_version_id')).toBe(V13),
    );
    const chip = screen.getByRole('button', { name: 'Remove the filter v13' });

    await user.click(chip);
    await waitFor(() =>
      expect(calls('/reports/ai-agent/breakdown').at(-1)?.has('config_version_id')).toBe(false),
    );
  });

  it('groups by hand-over reason in words, with no filter to set from it', async () => {
    const user = userEvent.setup();
    render(wrap(<AiMetricsPanel range={RANGE} rangeKey="30" />));
    await screen.findByRole('table', { name: 'AI quality by AI version' });

    await user.selectOptions(screen.getByLabelText('Compare by'), 'reason');
    const table = await screen.findByRole('table', { name: 'AI quality by Hand-over reason' });
    expect(calls('/reports/ai-agent/breakdown').at(-1)?.get('by')).toBe('reason');
    expect(within(table).getByText('No answer in the knowledge base')).toBeInTheDocument();
    expect(within(table).getByText('No hand-over')).toBeInTheDocument();
    expect(within(table).queryByRole('button', { name: /^Show only/ })).toBeNull();

    // The reasons' own distribution, with the knowledge-gap pointer (AI-22).
    const reasons = screen.getByRole('list', { name: 'Hand-over reasons' });
    expect(within(reasons).getAllByRole('listitem')).toHaveLength(3);
    expect(
      screen.getByText(/points at the unanswered questions list in the Playbook/),
    ).toBeInTheDocument();
  });

  it('opens the conversations behind a figure and pages them by cursor', async () => {
    const user = userEvent.setup();
    render(wrap(<AiMetricsPanel range={RANGE} rangeKey="30" />));
    await screen.findByText('Over 10 ended conversations the AI wrote in');

    await user.click(
      screen.getByRole('button', { name: 'Show the conversations: False resolution' }),
    );
    const table = await screen.findByRole('table', { name: 'False resolutions' });
    expect(within(table).getByText('CONNFIRST1')).toBeInTheDocument();
    expect(within(table).getAllByText('False resolution').length).toBeGreaterThan(0);
    expect(calls('/reports/ai-agent/conversations').at(-1)?.get('metric')).toBe('false_resolution');

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await within(table).findByText('CONNSECOND')).toBeInTheDocument();
    expect(calls('/reports/ai-agent/conversations').at(-1)?.get('cursor')).toBe('page-2');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('reads an empty window as unknown, not as 0%, with no few-samples caution', async () => {
    mockApi(
      quality({
        ...rates({
          conversations: 0,
          low_sample: true,
          confirmed_resolution: null,
          assumed_resolution: null,
          false_resolution: null,
          handoff_rate: null,
          mandatory_handoff_compliance: null,
          repeat_unmeasured: 0,
        }),
        handoff_reasons: [],
      }),
    );
    render(wrap(<AiMetricsPanel range={RANGE} rangeKey="30" />));

    expect(
      await screen.findByText('Over 0 ended conversations the AI wrote in'),
    ).toBeInTheDocument();
    expect(within(card('confirmed_resolution')).getByText('—')).toBeInTheDocument();
    expect(within(card('mandatory_handoff_compliance')).getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('No hand-overs in this window.')).toBeInTheDocument();
  });

  it('says so when the figures cannot be read', async () => {
    api.get.mockRejectedValue(new Error('403'));
    render(wrap(<AiMetricsPanel range={RANGE} rangeKey="30" />));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load the AI quality figures',
    );
  });
});
