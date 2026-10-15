/**
 * Settings → AI usage (tm 283.4 · AI-16).
 *
 * Every number on this screen is `GET /ai/usage`'s. What these tests pin is
 * what a reader of that endpoint can get wrong on its own:
 *
 *   1. It never shows money the server did not send — no `cost_usd`, no dollar
 *      sign and no "free" zero (AI-16-S3).
 *   2. It says the day is UTC and when the allowance renews, instead of
 *      drawing the series in the viewer's time zone.
 *   3. An agent is shown nothing and asks for nothing (the route is admin+);
 *      an admin reads the recipients but cannot change them (owner only).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), put: vi.fn() } }));

let currentRole = 'owner';

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { role: string } }) => unknown) =>
      selector({ agent: { role: currentRole } }),
  };
});

const { AiUsage } = await import('./AiUsage.js');

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const VICE_ID = '22222222-2222-4222-8222-222222222222';

const ROSTER = {
  items: [
    { id: 'owner-id', name: 'Dana Owner', role: 'owner' },
    { id: ADMIN_ID, name: 'Alex Admin', role: 'admin' },
    { id: VICE_ID, name: 'Vic Vice', role: 'viceowner' },
    { id: 'agent-id', name: 'Amy Agent', role: 'agent' },
    { id: 'gone-id', name: 'Sam Suspended', role: 'admin', suspended: true },
  ],
};

function days(): Array<Record<string, number | string>> {
  return Array.from({ length: 30 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 9, 15 - (29 - i))).toISOString().slice(0, 10),
    llm: i === 29 ? 160_000 : 1_000 * i,
    embedding: i === 29 ? 5_000 : 0,
    llm_test: 0,
    embedding_test: 0,
  }));
}

function usage(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    day: '2026-10-15',
    resets_at: '2026-10-16T00:00:00.000Z',
    window_days: 30,
    time_zone: 'UTC',
    meters: [
      { meter: 'llm', used: 160_000, reserved: 0, cap: 200_000, percent: 80 },
      { meter: 'embedding', used: 5_000, reserved: 0, cap: 1_000_000, percent: 0.5 },
      { meter: 'llm_test', used: 0, reserved: 0, cap: 40_000, percent: 0 },
      { meter: 'embedding_test', used: 0, reserved: 0, cap: 200_000, percent: 0 },
    ],
    daily: days(),
    surfaces: [
      { surface: 'ai_agent', meter: 'llm', input_tokens: 120_000, output_tokens: 40_000 },
      { surface: 'knowledge_index', meter: 'embedding', input_tokens: 5_000, output_tokens: 0 },
    ],
    alerts: [
      {
        meter: 'llm',
        threshold: 80,
        used: 160_000,
        cap: 200_000,
        created_at: '2026-10-15T09:30:00Z',
      },
    ],
    alert_recipients: [ADMIN_ID],
    ...over,
  };
}

function serve(body: Record<string, unknown>): void {
  api.get.mockImplementation((path: string) => {
    if (path === '/ai/usage') return Promise.resolve(body);
    if (path === '/agents') return Promise.resolve(ROSTER);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function renderScreen(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  currentRole = 'owner';
  api.get.mockReset();
  api.put.mockReset();
});

describe('AiUsage (AI-16)', () => {
  it('shows today’s use of each meter against its cap, as a percentage', async () => {
    serve(usage());
    renderScreen(<AiUsage isOwner />);

    const bar = await screen.findByRole('progressbar', { name: 'Language model tokens' });
    expect(bar).toHaveAttribute('aria-valuenow', '80');
    expect(screen.getByText('160,000 of 200,000 today (80%)')).toBeInTheDocument();
    // The simulation allowance is its own, separately labelled pair.
    expect(
      screen.getByRole('progressbar', { name: 'Language model tokens (tests)' }),
    ).toBeVisible();
  });

  it('says the day is UTC and when the allowance renews', async () => {
    serve(usage());
    renderScreen(<AiUsage isOwner />);

    expect(
      await screen.findByText(/in UTC\. The allowance renews at .*\(00:00 UTC\)/),
    ).toBeVisible();
  });

  it('shows no money at all when the server sent no cost (AI-16-S3)', async () => {
    serve(usage());
    renderScreen(<AiUsage isOwner />);

    await screen.findByRole('progressbar', { name: 'Language model tokens' });
    expect(screen.queryByText('Estimated cost today')).not.toBeInTheDocument();
    expect(screen.queryByText('Estimated cost')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('labels money as an estimate and sums only what the server priced', async () => {
    const body = usage({
      meters: [
        { meter: 'llm', used: 160_000, reserved: 0, cap: 200_000, percent: 80, cost_usd: 0.4 },
        {
          meter: 'embedding',
          used: 5_000,
          reserved: 0,
          cap: 1_000_000,
          percent: 0.5,
          cost_usd: 0.0001,
        },
        { meter: 'llm_test', used: 0, reserved: 0, cap: 40_000, percent: 0, cost_usd: 0 },
        { meter: 'embedding_test', used: 0, reserved: 0, cap: 200_000, percent: 0, cost_usd: 0 },
      ],
      surfaces: [
        {
          surface: 'ai_agent',
          meter: 'llm',
          input_tokens: 120_000,
          output_tokens: 40_000,
          cost_usd: 0.4,
        },
      ],
      pricing: {
        currency: 'USD',
        estimated: true,
        llm_input_usd_per_mtok: 2.5,
        llm_output_usd_per_mtok: 10,
        embedding_usd_per_mtok: 0.02,
      },
    });
    serve(body);
    renderScreen(<AiUsage isOwner />);

    expect(await screen.findByText('Estimated cost today')).toBeVisible();
    expect(screen.getByText('$0.4001')).toBeVisible();
    expect(screen.getByText(/An estimate — it will not match an invoice/)).toBeVisible();
    expect(screen.getByText(/Estimated at the prices configured/)).toBeVisible();
  });

  it('breaks the window down by feature from the ledger', async () => {
    serve(usage());
    renderScreen(<AiUsage isOwner />);

    const row = (await screen.findByRole('rowheader', { name: 'AI agent' })).closest('tr')!;
    expect(within(row).getByText('120,000')).toBeVisible();
    expect(within(row).getByText('40,000')).toBeVisible();
    expect(screen.getByRole('rowheader', { name: 'Knowledge indexing' })).toBeVisible();
  });

  it('lists today’s alerts', async () => {
    serve(usage());
    renderScreen(<AiUsage isOwner />);

    expect(await screen.findByText(/^80% of Language model tokens — sent /)).toBeVisible();
  });

  it('renders nothing and asks for nothing when the caller is an agent', () => {
    currentRole = 'agent';
    serve(usage());
    renderScreen(<AiUsage isOwner={false} />);

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('lets the owner choose recipients among vice-owners and admins, and saves their ids', async () => {
    const user = userEvent.setup();
    serve(usage());
    api.put.mockResolvedValue({ alert_recipients: [ADMIN_ID, VICE_ID] });
    renderScreen(<AiUsage isOwner />);

    // The owner is told regardless, an agent cannot be named, a suspended admin is not offered.
    expect(await screen.findByRole('checkbox', { name: 'Alex Admin' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Vic Vice' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Dana Owner' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Amy Agent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Sam Suspended' })).not.toBeInTheDocument();

    const save = screen.getByRole('button', { name: 'Save recipients' });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Vic Vice' }));
    await user.click(save);

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/ai/usage/alert-recipients', {
        account_ids: expect.arrayContaining([ADMIN_ID, VICE_ID]),
      }),
    );
    expect(await screen.findByText('Saved.')).toBeVisible();
  });

  it('shows an admin the recipients but not the means to change them', async () => {
    currentRole = 'admin';
    serve(usage());
    renderScreen(<AiUsage isOwner={false} />);

    const box = await screen.findByRole('checkbox', { name: 'Alex Admin' });
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save recipients' })).not.toBeInTheDocument();
  });

  it('says so when the usage cannot be loaded', async () => {
    api.get.mockRejectedValue(new Error('boom'));
    renderScreen(<AiUsage isOwner />);

    expect(await screen.findByRole('alert')).toHaveTextContent('The AI usage could not be loaded.');
  });
});
