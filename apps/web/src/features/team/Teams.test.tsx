/**
 * Team → Teams: create/edit/delete + membership (FR-MOD-04.5).
 *
 * `Teams`/`TeamEditor`/`TeamMembers` share this file the way the components
 * share the `['team', 'groups']` cache — they are one feature, not three. What
 * is worth pinning: a read-only viewer never sees a write control, the three
 * writes (`POST`/`PATCH`/`DELETE /groups`) reach the endpoint with the body the
 * form built, a `409 group_in_use` refusal is shown rather than swallowed
 * (the acceptance criterion this task exists to satisfy), and membership's two
 * calls — `PUT`/`DELETE /groups/{id}/agents/{agentId}` — cover both adding a
 * new member and re-tiering one already there through the priority dropdown.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/api-client.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import type { Group } from './Teams.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
}));

const { Teams } = await import('./Teams.js');

const AGENTS = [
  { id: 'agent-1', name: 'Sam Rivera' },
  { id: 'agent-2', name: 'Mira Haddad' },
];

const SUPPORT: Group = {
  id: 1,
  name: 'Support',
  language_code: 'en',
  agents: [{ agent_id: 'agent-1', priority: 'primary' }],
};

function renderTeams(
  options: { agents?: typeof AGENTS; canManage?: boolean } = {},
): ReturnType<typeof render> {
  const { agents = AGENTS, canManage = true } = options;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Teams agents={agents} canManage={canManage} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.put.mockReset();
  api.delete.mockReset();
  api.get.mockResolvedValue({ items: [SUPPORT] });
});

describe('Teams — read-only viewer', () => {
  it('shows the roster and its priorities with no write controls', async () => {
    renderTeams({ canManage: false });

    expect(await screen.findByText('Support')).toBeInTheDocument();
    expect(screen.getByText('Sam Rivera')).toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'New team' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit team/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Manage members/ })).not.toBeInTheDocument();
  });
});

describe('Teams — create', () => {
  it('sends the name (and omits a blank language) to POST /groups', async () => {
    renderTeams();
    await screen.findByText('Support');
    api.post.mockResolvedValue({ id: 2, name: 'Billing', language_code: 'en', agents: [] });

    fireEvent.click(screen.getByRole('button', { name: 'New team' }));
    const dialog = screen.getByRole('dialog', { name: 'New team' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Billing' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create team' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/groups', { name: 'Billing' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('rejects an out-of-shape language code before it ever reaches the server', async () => {
    renderTeams();
    await screen.findByText('Support');

    fireEvent.click(screen.getByRole('button', { name: 'New team' }));
    const dialog = screen.getByRole('dialog', { name: 'New team' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Billing' } });
    fireEvent.change(within(dialog).getByLabelText('Language'), { target: { value: 'en_GB' } });
    fireEvent.blur(within(dialog).getByLabelText('Language'));

    expect(
      await within(dialog).findByText(
        'Enter a two-letter language code, optionally with a region, like en or en-GB.',
      ),
    ).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('Teams — edit', () => {
  it('opens pre-filled and PATCHes the fields it holds', async () => {
    renderTeams();
    await screen.findByText('Support');
    api.patch.mockResolvedValue({ ...SUPPORT, name: 'Tier 1' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit team — Support' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit team — Support' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Support');
    expect(within(dialog).getByLabelText('Language')).toHaveValue('en');

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Tier 1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/groups/1', {
        name: 'Tier 1',
        language_code: 'en',
      }),
    );
  });
});

describe('Teams — delete', () => {
  it('deletes a team nothing is blocking', async () => {
    renderTeams();
    await screen.findByText('Support');
    api.delete.mockResolvedValue(undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Edit team — Support' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete team' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/groups/1'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows a 409 group_in_use refusal instead of swallowing it, and keeps the dialog open', async () => {
    renderTeams();
    await screen.findByText('Support');
    api.delete.mockRejectedValue(
      new ApiClientError({
        type: 'group_in_use',
        status: 409,
        message: 'A routing rule still sends conversations to this team.',
        requestId: 'req-1',
        details: { rule_id: 'r-1', kind: 'skill', is_fallback: false },
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit team — Support' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete team' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This team is still in use — a routing rule points at it, or conversations are open with it.',
    );
    expect(screen.getByRole('dialog', { name: 'Edit team — Support' })).toBeInTheDocument();
  });
});

describe('Teams — membership', () => {
  it('adds an available teammate at the chosen priority', async () => {
    renderTeams();
    await screen.findByText('Support');
    api.put.mockResolvedValue({
      ...SUPPORT,
      agents: [...SUPPORT.agents, { agent_id: 'agent-2', priority: 'first' }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Manage members — Support' }));
    const dialog = screen.getByRole('dialog', { name: 'Members — Support' });

    fireEvent.change(within(dialog).getByLabelText('Teammate to add'), {
      target: { value: 'agent-2' },
    });
    fireEvent.change(within(dialog).getByLabelText('Priority for the new member'), {
      target: { value: 'first' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/groups/1/agents/agent-2', { priority: 'first' }),
    );
  });

  it('changes an existing member’s priority the moment the dropdown changes', async () => {
    renderTeams();
    await screen.findByText('Support');
    api.put.mockResolvedValue({
      ...SUPPORT,
      agents: [{ agent_id: 'agent-1', priority: 'last' }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Manage members — Support' }));
    const dialog = screen.getByRole('dialog', { name: 'Members — Support' });

    fireEvent.change(within(dialog).getByLabelText('Priority — Sam Rivera'), {
      target: { value: 'last' },
    });

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/groups/1/agents/agent-1', { priority: 'last' }),
    );
  });

  it('removes a member', async () => {
    renderTeams();
    await screen.findByText('Support');
    api.delete.mockResolvedValue(undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Manage members — Support' }));
    const dialog = screen.getByRole('dialog', { name: 'Members — Support' });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remove Sam Rivera from this team' }),
    );

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/groups/1/agents/agent-1'));
  });
});

describe('Teams localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('opens "New team" and "Members" in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <Teams agents={AGENTS} canManage />
      </QueryClientProvider>,
      'tr',
    );

    await screen.findByText('Support');
    fireEvent.click(screen.getByRole('button', { name: 'Yeni ekip' }));
    expect(screen.getByRole('dialog', { name: 'Yeni ekip' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'İptal' }));

    fireEvent.click(screen.getByRole('button', { name: 'Üyeleri yönet — Support' }));
    expect(screen.getByRole('dialog', { name: 'Üyeler — Support' })).toBeInTheDocument();
  });
});
