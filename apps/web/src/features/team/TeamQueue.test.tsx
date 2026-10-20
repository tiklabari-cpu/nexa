/**
 * Team → Teams, queue settings and the iGaming queue template (tm 305.4 ·
 * AU-01 · K14).
 *
 * What is pinned: the editor offers the topics with the ones another team
 * serves named and disabled, sends only the queue fields that changed, and
 * holds the Responsible Gambling team to its rules on screen — topic locked,
 * no delete, never saved without its training skill. The template previews
 * what is served and what it would make, writes nothing until confirmed, and
 * then makes the missing teams.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import type { Group } from './Teams.js';
import type { RoutingQueue } from './teamQueue.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
}));

const { Teams } = await import('./Teams.js');

const ROLES = ['finance', 'kyc_risk', 'bonus', 'responsible_gambling', 'technical', 'complaint'];

function team(over: Partial<Group>): Group {
  return {
    id: 1,
    name: 'Support',
    language_code: 'en',
    topic_role: null,
    after_hours_mode: 'queue',
    required_expertise_ids: [],
    agents: [],
    ...over,
  };
}

const SUPPORT = team({});
const FINANCE = team({ id: 2, name: 'Money', topic_role: 'finance' });
const RG = team({
  id: 3,
  name: 'Safer play',
  topic_role: 'responsible_gambling',
  required_expertise_ids: [9],
});
const SKILLS = [
  { id: 4, name: 'VIP', slug: 'vip' },
  { id: 9, name: 'Responsible gambling training', slug: 'responsible-gambling-training' },
];

function queuesFor(groups: Group[]): RoutingQueue[] {
  return ROLES.map((role) => {
    const holder = groups.find((g) => g.topic_role === role);
    return {
      topic_role: role as RoutingQueue['topic_role'],
      group_id: holder?.id ?? null,
      group_name: holder?.name ?? null,
      after_hours_mode: holder ? 'queue' : null,
    };
  });
}

let groups: Group[];

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  groups = [SUPPORT, FINANCE, RG];
  api.get.mockImplementation(async (path: string) => {
    if (path === '/groups') return { items: groups };
    if (path === '/settings/expertise') return { items: SKILLS };
    if (path === '/routing/queues') return { items: queuesFor(groups) };
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
  await within(dialog).findByLabelText('VIP');
  return dialog;
}

describe('Teams — the card names the topic queue', () => {
  it('badges a team by its topic, whatever it is called (FR-MOD-08.6.1)', async () => {
    renderTeams();
    expect(await screen.findByText('Topic: Finance')).toBeInTheDocument();
    expect(screen.getByText('Topic: Responsible gambling')).toBeInTheDocument();
    expect(screen.getAllByText(/^Topic:/)).toHaveLength(2);
  });
});

describe('TeamEditor — queue settings', () => {
  it('names the team serving each other topic and will not offer it (FR-MOD-08.6.1)', async () => {
    renderTeams();
    const dialog = await openEditor('Support');
    const topic = within(dialog).getByLabelText('Topic queue');

    const finance = within(topic).getByRole('option', { name: 'Finance (handled by Money)' });
    expect(finance).toBeDisabled();
    expect(within(topic).getByRole('option', { name: 'Bonus' })).toBeEnabled();
    expect(topic).toHaveValue('');
  });

  it('sends only the queue fields that changed', async () => {
    api.patch.mockResolvedValue({ ...SUPPORT, topic_role: 'bonus' });
    renderTeams();
    const dialog = await openEditor('Support');

    fireEvent.change(within(dialog).getByLabelText('Topic queue'), { target: { value: 'bonus' } });
    fireEvent.change(within(dialog).getByLabelText('Out of hours'), {
      target: { value: 'ticket' },
    });
    fireEvent.click(within(dialog).getByLabelText('VIP'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/groups/1', {
        name: 'Support',
        language_code: 'en',
        topic_role: 'bonus',
        after_hours_mode: 'ticket',
        required_expertise_ids: [4],
      }),
    );
  });

  it('clears a topic with null and keeps the rest of the body as it was', async () => {
    api.patch.mockResolvedValue({ ...FINANCE, topic_role: null });
    renderTeams();
    const dialog = await openEditor('Money');

    fireEvent.change(within(dialog).getByLabelText('Topic queue'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/groups/2', {
        name: 'Money',
        language_code: 'en',
        topic_role: null,
      }),
    );
  });

  it('locks the Responsible Gambling topic, offers no delete, and never saves it without its training (FR-MOD-04.5 · FR-MOD-08.6.3)', async () => {
    renderTeams();
    const dialog = await openEditor('Safer play');

    expect(within(dialog).getByLabelText('Topic queue')).toBeDisabled();
    expect(
      within(dialog).getByText(
        'The responsible gambling team keeps its topic — it can only be renamed.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Delete team' })).not.toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "The responsible gambling team can't be deleted — rename it instead.",
      ),
    ).toBeInTheDocument();

    // Untick its only skill: the requirement would be empty.
    fireEvent.click(within(dialog).getByLabelText('Responsible gambling training'));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'The responsible gambling team needs at least one required skill — its training.',
    );
    const save = within(dialog).getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();
    fireEvent.submit(save.closest('form')!);
    expect(api.patch).not.toHaveBeenCalled();

    // A rename is what it may have.
    fireEvent.click(within(dialog).getByLabelText('Responsible gambling training'));
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Sorumlu Oyun' } });
    api.patch.mockResolvedValue({ ...RG, name: 'Sorumlu Oyun' });
    // The refused submit above settles on the next tick.
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/groups/3', {
        name: 'Sorumlu Oyun',
        language_code: 'en',
      }),
    );
  });

  it('creates a Responsible Gambling team only with a training skill ticked', async () => {
    groups = [SUPPORT];
    api.post.mockResolvedValue(RG);
    renderTeams();
    fireEvent.click(await screen.findByRole('button', { name: 'New team' }));
    const dialog = screen.getByRole('dialog', { name: 'New team' });
    await within(dialog).findByLabelText('VIP');

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Safer play' } });
    fireEvent.change(within(dialog).getByLabelText('Topic queue'), {
      target: { value: 'responsible_gambling' },
    });
    expect(within(dialog).getByRole('button', { name: 'Create team' })).toBeDisabled();

    fireEvent.click(within(dialog).getByLabelText('Responsible gambling training'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create team' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/groups', {
        name: 'Safer play',
        topic_role: 'responsible_gambling',
        required_expertise_ids: [9],
      }),
    );
  });
});

describe('Teams — iGaming queue template', () => {
  afterEach(() => {
    resetLocale();
  });

  it('previews what is served and what it would make, and writes nothing until confirmed (FR-MOD-08.6.1)', async () => {
    renderTeams();
    fireEvent.click(await screen.findByRole('button', { name: 'Set up iGaming queues' }));
    const dialog = screen.getByRole('dialog', { name: 'Set up the iGaming queue template' });

    expect(await within(dialog).findByText('Served by “Money”')).toBeInTheDocument();
    expect(within(dialog).getByText('Served by “Safer play”')).toBeInTheDocument();
    expect(within(dialog).getByText('Creates “KYC / Risk”')).toBeInTheDocument();
    expect(within(dialog).getAllByText(/^Creates “/)).toHaveLength(4);
    expect(api.post).not.toHaveBeenCalled();

    api.post.mockImplementation(async (_path: string, body: unknown) => body);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 4 teams' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.post.mock.calls.map(([path, body]) => [path, (body as Group).topic_role])).toEqual([
      ['/groups', 'kyc_risk'],
      ['/groups', 'bonus'],
      ['/groups', 'technical'],
      ['/groups', 'complaint'],
    ]);
  });

  it('has nothing to make once every topic is served', async () => {
    groups = ROLES.map((role, i) =>
      team({ id: i + 10, name: `Team ${role}`, topic_role: role as Group['topic_role'] }),
    );
    renderTeams();
    fireEvent.click(await screen.findByRole('button', { name: 'Set up iGaming queues' }));
    const dialog = screen.getByRole('dialog', { name: 'Set up the iGaming queue template' });

    expect(await within(dialog).findByText('Every topic already has a team.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create 0 teams' })).toBeDisabled();
  });

  it('makes the training skill with the Responsible Gambling team, named in Turkish on a Turkish console', async () => {
    groups = [SUPPORT];
    api.get.mockImplementation(async (path: string) => {
      if (path === '/groups') return { items: groups };
      if (path === '/settings/expertise') return { items: [] };
      return { items: queuesFor(groups) };
    });
    api.post.mockImplementation(async (path: string, body: unknown) =>
      path === '/settings/expertise' ? { id: 77, slug: 's', ...(body as object) } : body,
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <Teams agents={[]} canManage />
      </QueryClientProvider>,
      'tr',
    );

    fireEvent.click(await screen.findByRole('button', { name: 'iGaming kuyruk şablonunu kur' }));
    const dialog = screen.getByRole('dialog', { name: 'iGaming kuyruk şablonunu kur' });
    expect(
      await within(dialog).findByText(/yalnızca “Sorumlu oyun eğitimi” yeteneği olan/),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '6 ekip oluştur' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/groups', {
        name: 'Sorumlu Oyun',
        topic_role: 'responsible_gambling',
        required_expertise_ids: [77],
      }),
    );
    expect(api.post).toHaveBeenCalledWith('/settings/expertise', { name: 'Sorumlu oyun eğitimi' });
    expect(api.post).toHaveBeenCalledWith('/groups', { name: 'Şikâyet', topic_role: 'complaint' });
  });
});
