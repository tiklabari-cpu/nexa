/**
 * Team → Work schedule (WORKSCHED-h): a plain agent only ever sees their own
 * week, the field-under error blocks Submit until every enabled day has a
 * valid range, a dirty draft asks before it is discarded, and a save sends the
 * normalised body `normalizeWorkSchedule` (WORKSCHED-c's own gate) produces.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { DEFAULT_WORK_SCHEDULE } from '@nexa/types';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
}));

const { WorkSchedule } = await import('./WorkSchedule.js');

const AGENTS = [
  { id: 'agent-1', name: 'Ada Lovelace' },
  { id: 'agent-2', name: 'Grace Hopper' },
];

function renderWorkSchedule(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

async function openModal(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: 'Edit schedule' }));
  await screen.findByRole('dialog');
}

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  api.get.mockResolvedValue(structuredClone(DEFAULT_WORK_SCHEDULE));
  api.put.mockImplementation((_path: string, body: unknown) => Promise.resolve(body));
});

describe('WorkSchedule — roster scoping', () => {
  it('shows only the caller’s own row when they cannot manage the team', async () => {
    renderWorkSchedule(
      <WorkSchedule agents={AGENTS} currentAgentId="agent-1" canManage={false} loading={false} />,
    );

    expect(await screen.findByText('Your weekly hours')).toBeInTheDocument();
    expect(screen.queryByLabelText('Teammate')).not.toBeInTheDocument();
  });

  it('lets a manager pick any teammate', async () => {
    renderWorkSchedule(
      <WorkSchedule agents={AGENTS} currentAgentId="agent-1" canManage={true} loading={false} />,
    );

    const picker = await screen.findByLabelText('Teammate');
    expect(within(picker).getByRole('option', { name: 'Ada Lovelace (you)' })).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: 'Grace Hopper' })).toBeInTheDocument();
  });

  it('shows a meaningful empty state when nobody is on the roster', async () => {
    renderWorkSchedule(
      <WorkSchedule agents={[]} currentAgentId="agent-1" canManage={false} loading={false} />,
    );

    expect(await screen.findByText('No one to schedule yet')).toBeInTheDocument();
    expect(
      screen.getByText('Invite teammates before setting up a work schedule.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit schedule' })).not.toBeInTheDocument();
  });

  it('shows a skeleton rather than the empty state while the roster is loading', async () => {
    renderWorkSchedule(
      <WorkSchedule agents={[]} currentAgentId="agent-1" canManage={false} loading={true} />,
    );

    expect(screen.queryByText('No one to schedule yet')).not.toBeInTheDocument();
  });
});

describe('WorkSchedule — editor', () => {
  it('renders all seven days and the timezone, and disables hours on an off day', async () => {
    renderWorkSchedule(
      <WorkSchedule agents={AGENTS} currentAgentId="agent-1" canManage={false} loading={false} />,
    );
    await openModal();

    expect(api.get).toHaveBeenCalledWith('/agents/agent-1/work-schedule');
    for (const day of [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]) {
      expect(await screen.findByRole('checkbox', { name: day })).toBeInTheDocument();
    }
    expect(screen.getByRole('checkbox', { name: 'Monday' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Saturday' })).not.toBeChecked();
    expect(screen.getByLabelText('Saturday start time')).toBeDisabled();
    expect(screen.getByLabelText('Saturday end time')).toBeDisabled();
    expect(screen.getByLabelText('Monday start time')).toBeEnabled();

    expect(screen.getByLabelText('Timezone')).toHaveValue('UTC');
  });

  it('shows a field-under error and disables Save when start is not before end', async () => {
    renderWorkSchedule(
      <WorkSchedule agents={AGENTS} currentAgentId="agent-1" canManage={false} loading={false} />,
    );
    await openModal();
    await screen.findByRole('checkbox', { name: 'Monday' });

    const end = screen.getByLabelText('Monday end time');
    fireEvent.change(end, { target: { value: '08:00' } });

    expect(screen.getByRole('alert')).toHaveTextContent('End must be after start.');
    expect(screen.getByRole('button', { name: 'Save schedule' })).toBeDisabled();
  });

  it('shows a field-under error for a badly formatted time', async () => {
    renderWorkSchedule(
      <WorkSchedule agents={AGENTS} currentAgentId="agent-1" canManage={false} loading={false} />,
    );
    await openModal();
    await screen.findByRole('checkbox', { name: 'Monday' });

    const start = screen.getByLabelText('Monday start time');
    fireEvent.change(start, { target: { value: '9am' } });

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a 24-hour time, like 09:00.');
    expect(screen.getByRole('button', { name: 'Save schedule' })).toBeDisabled();
  });

  it('does not flag a day that is switched off, even with a nonsense stored range', async () => {
    api.get.mockResolvedValue({
      timezone: 'UTC',
      schedule: DEFAULT_WORK_SCHEDULE.schedule.map((slot) =>
        slot.day === 'saturday' ? { ...slot, start: '20:00', end: '08:00' } : slot,
      ),
    });
    renderWorkSchedule(
      <WorkSchedule agents={AGENTS} currentAgentId="agent-1" canManage={false} loading={false} />,
    );
    await openModal();
    await screen.findByRole('checkbox', { name: 'Saturday' });

    // Off days keep whatever hours they had; only an enabled day is validated.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sends the normalised schedule on save', async () => {
    renderWorkSchedule(
      <WorkSchedule agents={AGENTS} currentAgentId="agent-1" canManage={false} loading={false} />,
    );
    await openModal();
    await screen.findByRole('checkbox', { name: 'Saturday' });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Saturday' }));
    fireEvent.change(screen.getByLabelText('Saturday start time'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('Saturday end time'), { target: { value: '14:00' } });

    const save = screen.getByRole('button', { name: 'Save schedule' });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const [path, body] = api.put.mock.calls[0] as [
      string,
      { timezone: string; schedule: unknown[] },
    ];
    expect(path).toBe('/agents/agent-1/work-schedule');
    expect(body.timezone).toBe('UTC');
    expect(body.schedule).toContainEqual({
      day: 'saturday',
      start: '10:00',
      end: '14:00',
      enabled: true,
    });
    // Every other day rides along unchanged, in the same normalised shape.
    expect(body.schedule).toContainEqual({
      day: 'monday',
      start: '09:00',
      end: '18:00',
      enabled: true,
    });
    expect(body.schedule).toHaveLength(7);
  });

  it('asks before discarding an unsaved change on close, and only closes on confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWorkSchedule(
      <WorkSchedule agents={AGENTS} currentAgentId="agent-1" canManage={false} loading={false} />,
    );
    await openModal();
    await screen.findByRole('checkbox', { name: 'Saturday' });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Saturday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it('closes without asking when nothing changed', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderWorkSchedule(
      <WorkSchedule agents={AGENTS} currentAgentId="agent-1" canManage={false} loading={false} />,
    );
    await openModal();
    await screen.findByRole('checkbox', { name: 'Monday' });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });
});

describe('WorkSchedule localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the section and the editor in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <WorkSchedule agents={AGENTS} currentAgentId="agent-1" canManage={true} loading={false} />
      </QueryClientProvider>,
      'tr',
    );

    expect(await screen.findByRole('region', { name: 'Çalışma programı' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Programı düzenle' }));
    expect(
      await screen.findByRole('dialog', { name: `Çalışma programı — ${AGENTS[0]!.name}` }),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Pazartesi' })).toBeInTheDocument();
  });
});
