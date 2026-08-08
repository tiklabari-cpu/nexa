/**
 * Settings → Scheduled exports (FR-MOD-07.7, PRD §5.3-Reports).
 *
 * Pins the management surface: a meaningful empty state (never a bare
 * rectangle), Schedule export stays disabled until a report and a recipient
 * are both chosen with a field-under error under the report select, an empty
 * `/reports/groups` catalogue closes creation (permission-based visibility),
 * a row's badge reflects its most recent run in all three states, and
 * cancelling requires a second confirming click before it DELETEs and the
 * row leaves the list.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { ScheduledExports } = await import('./ScheduledExports.js');

const GROUPS = {
  groups: [
    { id: 'overview', label: 'Overview' },
    { id: 'breakdown', label: 'Breakdown' },
  ],
};

const AGENTS = {
  items: [
    { id: 'agent-1', name: 'Ada Lovelace', email: 'ada@example.com' },
    { id: 'agent-2', name: 'Grace Hopper', email: 'grace@example.com' },
  ],
};

const SCHEDULED_EXPORTS = [
  {
    id: 'se-1',
    group: 'overview',
    frequency: 'daily',
    format: 'csv',
    recipients: ['ada@example.com'],
    enabled: true,
    created_at: '2026-07-01T00:00:00.000Z',
    last_run_at: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'se-2',
    group: 'breakdown',
    frequency: 'weekly',
    format: 'csv',
    recipients: ['grace@example.com'],
    enabled: true,
    created_at: '2026-07-02T00:00:00.000Z',
    last_run_at: null,
  },
  {
    id: 'se-3',
    group: 'overview',
    frequency: 'monthly',
    format: 'csv',
    recipients: ['ada@example.com', 'grace@example.com'],
    enabled: true,
    created_at: '2026-07-03T00:00:00.000Z',
    last_run_at: null,
  },
];

const DELIVERED_RUN = {
  id: 'run-1',
  period_key: '2026-08-01',
  period_from: '2026-08-01T00:00:00.000Z',
  period_to: '2026-08-01T23:59:59.999Z',
  status: 'delivered',
  row_count: 12,
  recipient_count: 1,
  error: null,
  created_at: '2026-08-02T00:00:00.000Z',
};

const FAILED_RUN = {
  ...DELIVERED_RUN,
  id: 'run-2',
  status: 'failed',
  error: 'SMTP timeout',
};

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function mockGet(path: string): unknown {
  if (path === '/reports/scheduled-exports') return Promise.resolve({ items: [] });
  if (path === '/reports/groups') return Promise.resolve(GROUPS);
  if (path === '/agents') return Promise.resolve(AGENTS);
  if (path.startsWith('/reports/scheduled-exports/')) return Promise.resolve({ items: [] });
  throw new Error(`unexpected GET ${path}`);
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  api.get.mockImplementation(mockGet);
  api.delete.mockResolvedValue(undefined);
});

describe('ScheduledExports', () => {
  it('shows a meaningful empty state when no exports are scheduled', async () => {
    renderComponent(<ScheduledExports canEdit />);
    expect(await screen.findByText('No scheduled exports')).toBeInTheDocument();
    expect(
      screen.getByText(/Schedule a report group above and it lands in your team's inbox/),
    ).toBeInTheDocument();
  });

  it('keeps Schedule export disabled until a report and a recipient are chosen', async () => {
    renderComponent(<ScheduledExports canEdit />);
    const submit = await screen.findByRole('button', { name: 'Schedule export' });
    expect(submit).toBeDisabled();

    await screen.findByRole('option', { name: 'Overview' }); // groups loaded
    await userEvent.selectOptions(screen.getByLabelText('Report'), 'overview');
    expect(submit).toBeDisabled(); // no recipient yet

    const recipient = await screen.findByRole('checkbox', { name: 'Ada Lovelace' });
    await userEvent.click(recipient);
    expect(submit).toBeEnabled();
  });

  it('shows a field-under error when no report is selected', async () => {
    renderComponent(<ScheduledExports canEdit />);
    const select = await screen.findByLabelText('Report');
    await userEvent.click(select);
    await userEvent.tab(); // blur without choosing
    expect(screen.getByText('Select a report group.')).toBeInTheDocument();
  });

  it('closes creation when no report groups are visible (İzin bazlı görünürlük)', async () => {
    api.get.mockImplementation((path: string) =>
      path === '/reports/groups' ? Promise.resolve({ groups: [] }) : mockGet(path),
    );
    renderComponent(<ScheduledExports canEdit />);
    const submit = await screen.findByRole('button', { name: 'Schedule export' });

    const recipient = await screen.findByRole('checkbox', { name: 'Ada Lovelace' });
    await userEvent.click(recipient);
    expect(submit).toBeDisabled();

    const select = screen.getByLabelText('Report') as HTMLSelectElement;
    expect(select.options).toHaveLength(1); // only the placeholder
  });

  it('creates a scheduled export by POSTing the group, frequency and recipients', async () => {
    api.post.mockResolvedValue(SCHEDULED_EXPORTS[0]);
    renderComponent(<ScheduledExports canEdit />);
    await screen.findByRole('button', { name: 'Schedule export' });

    await screen.findByRole('option', { name: 'Overview' }); // groups loaded
    await userEvent.selectOptions(screen.getByLabelText('Report'), 'overview');
    await userEvent.selectOptions(screen.getByLabelText('Frequency'), 'weekly');
    const recipient = await screen.findByRole('checkbox', { name: 'Ada Lovelace' });
    await userEvent.click(recipient);
    await userEvent.click(screen.getByRole('button', { name: 'Schedule export' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/reports/scheduled-exports', {
        group: 'overview',
        frequency: 'weekly',
        recipients: ['ada@example.com'],
      }),
    );
  });

  it('shows the last-run badge in all three states', async () => {
    api.get.mockImplementation((path: string) => {
      if (path === '/reports/scheduled-exports')
        return Promise.resolve({ items: SCHEDULED_EXPORTS });
      if (path === '/reports/groups') return Promise.resolve(GROUPS);
      if (path === '/agents') return Promise.resolve(AGENTS);
      if (path.startsWith('/reports/scheduled-exports/se-1/runs'))
        return Promise.resolve({ items: [DELIVERED_RUN] });
      if (path.startsWith('/reports/scheduled-exports/se-2/runs'))
        return Promise.resolve({ items: [FAILED_RUN] });
      if (path.startsWith('/reports/scheduled-exports/se-3/runs'))
        return Promise.resolve({ items: [] });
      throw new Error(`unexpected GET ${path}`);
    });

    renderComponent(<ScheduledExports canEdit />);

    expect(await screen.findByText('Delivered')).toBeInTheDocument();
    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(await screen.findByText('Never run')).toBeInTheDocument();
  });

  it('cancels a scheduled export by DELETEing its id, only after a confirming click', async () => {
    let deleted = false;
    api.get.mockImplementation((path: string) => {
      if (path === '/reports/scheduled-exports') {
        return Promise.resolve({ items: deleted ? [] : [SCHEDULED_EXPORTS[0]] });
      }
      if (path === '/reports/groups') return Promise.resolve(GROUPS);
      if (path === '/agents') return Promise.resolve(AGENTS);
      if (path.startsWith('/reports/scheduled-exports/se-1/runs'))
        return Promise.resolve({ items: [] });
      throw new Error(`unexpected GET ${path}`);
    });
    api.delete.mockImplementation(async () => {
      deleted = true;
      return undefined;
    });

    renderComponent(<ScheduledExports canEdit />);
    await screen.findByText('Overview', { selector: 'p' });

    await userEvent.click(screen.getByRole('button', { name: 'Cancel Overview export' }));
    expect(api.delete).not.toHaveBeenCalled(); // first click only asks for confirmation

    await userEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/reports/scheduled-exports/se-1'));
    await waitFor(() =>
      expect(screen.queryByText('Overview', { selector: 'p' })).not.toBeInTheDocument(),
    );
  });

  it('offers no create form or cancel controls to a read-only viewer', async () => {
    api.get.mockImplementation((path: string) => {
      if (path === '/reports/scheduled-exports')
        return Promise.resolve({ items: [SCHEDULED_EXPORTS[0]] });
      if (path === '/reports/groups') return Promise.resolve(GROUPS);
      if (path.startsWith('/reports/scheduled-exports/se-1/runs'))
        return Promise.resolve({ items: [] });
      throw new Error(`unexpected GET ${path}`);
    });

    renderComponent(<ScheduledExports canEdit={false} />);
    expect(await screen.findByText('Overview')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Schedule export' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel .* export/ })).not.toBeInTheDocument();
  });
});
