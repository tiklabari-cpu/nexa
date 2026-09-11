/**
 * Settings → Data retention (NFR-C8).
 *
 * Everything this screen appears to decide is the server's
 * (`GET|PATCH /settings/retention`). What these tests pin is the three things
 * a screen over that endpoint can get wrong on its own:
 *
 *   1. It shows the **effective** window, not just the choice. They differ
 *      exactly when a HIPAA ceiling cut the choice back, which is the one
 *      moment somebody is asking the question.
 *   2. It offers only what the server will accept. The ceiling comes from
 *      `max_*_days`, so a screen that derived it from `hipaa_scope` would be a
 *      second copy of the rule, free to disagree.
 *   3. It saves a *tier*, never a day count — and "keep indefinitely" is never
 *      sent as `0`, the value the sweep's own guard exists to refuse.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), patch: vi.fn() },
}));

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

const { DataRetention } = await import('./DataRetention.js');

const INHERITING = {
  thread_window: null,
  visit_window: null,
  default_thread_days: 365,
  default_visit_days: 90,
  effective_thread_days: 365,
  effective_visit_days: 90,
  max_thread_days: null,
  max_visit_days: null,
  hipaa_scope: false,
};

/** Chose "keep indefinitely", then signed a BAA — so the choice and the effect differ. */
const CAPPED = {
  thread_window: 'unlimited',
  visit_window: null,
  default_thread_days: 365,
  default_visit_days: 90,
  effective_thread_days: 365,
  effective_visit_days: 90,
  max_thread_days: 365,
  max_visit_days: 90,
  hipaa_scope: true,
};

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  currentRole = 'owner';
  api.get.mockReset();
  api.patch.mockReset();
});

describe('DataRetention (NFR-C8)', () => {
  it('says what the deployment default is, rather than showing an empty field', async () => {
    api.get.mockResolvedValue(INHERITING);

    renderComponent(<DataRetention canEdit />);

    expect(await screen.findByText('Use the default (365 days)')).toBeInTheDocument();
    expect(screen.getByText('Use the default (90 days)')).toBeInTheDocument();
    expect(screen.getAllByText('Deleted after 365 days.')).toHaveLength(1);
  });

  it('offers all four tiers when nothing caps the workspace', async () => {
    api.get.mockResolvedValue(INHERITING);

    renderComponent(<DataRetention canEdit />);

    const select = await screen.findByLabelText('Closed conversations');
    for (const label of ['30 days', '60 days', '365 days', 'Keep indefinitely']) {
      expect(within(select).getByText(label)).toBeInTheDocument();
    }
  });

  it('saves the chosen tier, never a number of days', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue(INHERITING);
    api.patch.mockResolvedValue({ ...INHERITING, thread_window: '30d', effective_thread_days: 30 });

    renderComponent(<DataRetention canEdit />);

    await user.selectOptions(await screen.findByLabelText('Closed conversations'), '30d');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/retention', {
        thread_window: '30d',
        visit_window: null,
      }),
    );
  });

  it('sends "unlimited" as itself — not as 0, and not as a very large number', async () => {
    // The whole design turns on this. `0` is the value `cutoffFor` refuses
    // because it puts the cutoff at "now" and matches every row, so a screen
    // that spelled "off" as zero would delete everything the setting was
    // chosen to protect.
    const user = userEvent.setup();
    api.get.mockResolvedValue(INHERITING);
    api.patch.mockResolvedValue({
      ...INHERITING,
      thread_window: 'unlimited',
      effective_thread_days: null,
    });

    renderComponent(<DataRetention canEdit />);

    await user.selectOptions(await screen.findByLabelText('Closed conversations'), 'unlimited');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const body = api.patch.mock.calls[0]?.[1] as { thread_window: unknown };
    expect(body.thread_window).toBe('unlimited');
    expect(body.thread_window).not.toBe(0);
  });

  it('under a ceiling, shows the window that will actually apply — not the one that was chosen', async () => {
    // The workspace picked "keep indefinitely" and the sweep will delete at
    // 365 days. A screen that showed only the choice would be stating a
    // retention period the workspace does not have.
    api.get.mockResolvedValue(CAPPED);

    renderComponent(<DataRetention canEdit />);

    expect(await screen.findByText('Deleted after 365 days.')).toBeInTheDocument();
    expect(screen.queryByText('Never deleted automatically.')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'This workspace has a signed HIPAA agreement, so data cannot be kept longer than 365 days and cannot be kept indefinitely.',
      ),
    ).toBeInTheDocument();
  });

  it('drops the options the server would refuse, per field', async () => {
    api.get.mockResolvedValue(CAPPED);

    renderComponent(<DataRetention canEdit />);

    const threadSelect = await screen.findByLabelText('Closed conversations');
    // 365 is at the ceiling and stays; "indefinitely" is off the menu at any
    // ceiling, because it is not a value that can be made shorter.
    expect(within(threadSelect).getByText('365 days')).toBeInTheDocument();
    expect(within(threadSelect).queryByText('Keep indefinitely')).not.toBeInTheDocument();

    // The telemetry ceiling is 90, so 365 goes too — the ceiling is per field,
    // not one number for the row.
    const visitSelect = screen.getByLabelText('Visitor data');
    expect(within(visitSelect).getByText('60 days')).toBeInTheDocument();
    expect(within(visitSelect).queryByText('365 days')).not.toBeInTheDocument();
  });

  it('hides itself from a role below admin, mirroring the route’s own gate', async () => {
    currentRole = 'agent';
    api.get.mockResolvedValue(INHERITING);

    renderComponent(<DataRetention canEdit />);

    expect(screen.queryByText('Data retention')).not.toBeInTheDocument();
    // And asks for nothing: a hidden section that still fetches would put a
    // guaranteed 403 in every agent's console.
    expect(api.get).not.toHaveBeenCalled();
  });

  it('shows no save button without the write scope', async () => {
    api.get.mockResolvedValue(INHERITING);

    renderComponent(<DataRetention canEdit={false} />);

    expect(await screen.findByLabelText('Closed conversations')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});
