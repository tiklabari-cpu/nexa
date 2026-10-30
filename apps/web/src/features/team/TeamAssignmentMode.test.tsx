/**
 * Team → Teams, the assignment mode (WG-07 · tm 346).
 *
 * What is pinned: the editor shows the team's mode, sends `assignment_mode`
 * only when it moved, and never offers manual to the Responsible Gambling
 * team — the option is off, and a topic switched to it while manual is
 * stopped on screen rather than sent for a 400.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Group } from './Teams.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
}));

const { Teams } = await import('./Teams.js');

function team(over: Partial<Group>): Group {
  return {
    id: 1,
    name: 'Support',
    language_code: 'en',
    topic_role: null,
    after_hours_mode: 'queue',
    assignment_mode: 'auto',
    required_expertise_ids: [],
    agents: [],
    ...over,
  };
}

const SUPPORT = team({});
const BONUS = team({ id: 2, name: 'Bonus desk', topic_role: 'bonus', assignment_mode: 'manual' });
const RG = team({
  id: 3,
  name: 'Safer play',
  topic_role: 'responsible_gambling',
  required_expertise_ids: [9],
});
const SKILLS = [{ id: 9, name: 'Responsible gambling training', slug: 'rg-training' }];

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (path: string) => {
    if (path === '/groups') return { items: [SUPPORT, BONUS, RG] };
    if (path === '/settings/expertise') return { items: SKILLS };
    if (path === '/routing/queues') return { items: [] };
    throw new Error(`unexpected GET ${path}`);
  });
});

function renderTeams(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Teams agents={[]} canManage />
    </QueryClientProvider>,
  );
}

async function openEditor(name: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: `Edit team — ${name}` }));
  const dialog = screen.getByRole('dialog', { name: `Edit team — ${name}` });
  await within(dialog).findByLabelText('Responsible gambling training');
  return dialog;
}

describe('TeamEditor — assignment mode', () => {
  it('shows the team’s mode and sends it only when it moved', async () => {
    api.patch.mockResolvedValue({ ...SUPPORT, assignment_mode: 'manual' });
    renderTeams();
    const bonus = await openEditor('Bonus desk');
    expect(within(bonus).getByLabelText('Assignment')).toHaveValue('manual');
    fireEvent.click(within(bonus).getByRole('button', { name: 'Cancel' }));

    const dialog = await openEditor('Support');
    const mode = within(dialog).getByLabelText('Assignment');
    expect(mode).toHaveValue('auto');
    fireEvent.change(mode, { target: { value: 'manual' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/groups/1', {
        name: 'Support',
        language_code: 'en',
        assignment_mode: 'manual',
      }),
    );
  });

  it('never offers manual to the Responsible Gambling team', async () => {
    renderTeams();
    const dialog = await openEditor('Safer play');
    const mode = within(dialog).getByLabelText('Assignment');
    expect(within(mode).getByRole('option', { name: /^Manual/ })).toBeDisabled();
    expect(
      within(dialog).getByText(/Responsible gambling chats are always assigned automatically/),
    ).toBeInTheDocument();
  });

  it('stops a team switched to Responsible Gambling while manual', async () => {
    renderTeams();
    const dialog = await openEditor('Bonus desk');
    fireEvent.change(within(dialog).getByLabelText('Topic queue'), {
      target: { value: 'responsible_gambling' },
    });
    fireEvent.click(within(dialog).getByLabelText('Responsible gambling training'));

    expect(within(dialog).getByRole('alert')).toHaveTextContent(/can't use manual assignment/);
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(api.patch).not.toHaveBeenCalled();
  });
});
