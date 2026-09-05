/**
 * Settings → Saved replies: the team-scope picker (FR-MOD-08.7.2).
 *
 * `canned_responses.group_id` and `.visibility` were a pair of columns nothing
 * read or wrote. The server half now honours them; what this pins is the client
 * half, and specifically that the two fields are always sent **together** —
 * either alone is a 400, so a control that could produce half a pairing would
 * be a screen that refuses its own submissions.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
}));

const { CannedResponses } = await import('./CannedResponses.js');

const SUPPORT_TEAM = { id: 1, name: 'Support' };
const BILLING_TEAM = { id: 2, name: 'Billing' };

const REPLY = {
  id: 'canned-1',
  shortcut: 'shipping',
  text: 'Standard delivery takes 3-5 working days.',
  scope: 'chat' as const,
  group_id: null,
  visibility: 'all' as const,
};

function mockGets(overrides: { replies?: unknown; groups?: unknown } = {}): void {
  const replies = overrides.replies ?? { items: [REPLY] };
  const groups = overrides.groups ?? { items: [SUPPORT_TEAM, BILLING_TEAM] };
  api.get.mockImplementation((path: string) =>
    Promise.resolve(path === '/groups' ? groups : replies),
  );
}

function renderReplies(canEdit = true): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CannedResponses canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.delete.mockReset();
  mockGets();
});

describe('Saved replies — saving one with a team', () => {
  async function fillTheForm(): Promise<void> {
    fireEvent.change(screen.getByLabelText(/Shortcut/), { target: { value: 'discount' } });
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: '10% this week.' } });
  }

  it('sends the pair as `group` plus the chosen team', async () => {
    renderReplies();
    await screen.findByText(REPLY.text);
    api.post.mockResolvedValue({ ...REPLY, id: 'canned-2', shortcut: 'discount' });

    await fillTheForm();
    fireEvent.change(screen.getByLabelText('Team'), { target: { value: String(BILLING_TEAM.id) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reply' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/settings/canned-responses', {
      shortcut: 'discount',
      text: '10% this week.',
      visibility: 'group',
      group_id: BILLING_TEAM.id,
    });
  });

  it('sends `all` with a null team when the picker is left alone', async () => {
    renderReplies();
    await screen.findByText(REPLY.text);
    api.post.mockResolvedValue({ ...REPLY, id: 'canned-2', shortcut: 'discount' });

    await fillTheForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save reply' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/settings/canned-responses', {
      shortcut: 'discount',
      text: '10% this week.',
      visibility: 'all',
      group_id: null,
    });
  });

  it('resets the picker after a save, so the next reply is not silently scoped', async () => {
    renderReplies();
    await screen.findByText(REPLY.text);
    api.post.mockResolvedValue({ ...REPLY, id: 'canned-2', shortcut: 'discount' });

    await fillTheForm();
    fireEvent.change(screen.getByLabelText('Team'), { target: { value: String(SUPPORT_TEAM.id) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reply' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText('Team')).toHaveValue(''));
  });
});

describe('Saved replies — re-scoping an existing one', () => {
  it('narrows a workspace-wide reply to a team', async () => {
    renderReplies();
    await screen.findByText(REPLY.text);

    fireEvent.click(screen.getByRole('button', { name: 'Edit team for #shipping' }));
    api.patch.mockResolvedValue({
      ...REPLY,
      group_id: SUPPORT_TEAM.id,
      visibility: 'group',
    });
    fireEvent.change(screen.getByLabelText('Team for #shipping'), {
      target: { value: String(SUPPORT_TEAM.id) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith('/settings/canned-responses/canned-1', {
      visibility: 'group',
      group_id: SUPPORT_TEAM.id,
    });
  });

  it('widens a team reply back with `all`, which clears the team on its own', async () => {
    mockGets({
      replies: { items: [{ ...REPLY, group_id: SUPPORT_TEAM.id, visibility: 'group' }] },
    });
    renderReplies();
    await screen.findByText(REPLY.text);
    // The row says which team owns it, not just that it is scoped.
    expect(screen.getByText('Support only')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit team for #shipping' }));
    // The editor opens on the team the reply already has.
    expect(screen.getByLabelText('Team for #shipping')).toHaveValue(String(SUPPORT_TEAM.id));

    api.patch.mockResolvedValue({ ...REPLY });
    fireEvent.change(screen.getByLabelText('Team for #shipping'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith('/settings/canned-responses/canned-1', {
      visibility: 'all',
      group_id: null,
    });
  });

  it('sends nothing when the editor is cancelled', async () => {
    renderReplies();
    await screen.findByText(REPLY.text);

    fireEvent.click(screen.getByRole('button', { name: 'Edit team for #shipping' }));
    fireEvent.change(screen.getByLabelText('Team for #shipping'), {
      target: { value: String(BILLING_TEAM.id) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Team for #shipping')).not.toBeInTheDocument();
  });
});

describe('Saved replies — when there is nothing to scope to, or nobody to scope', () => {
  it('shows no picker at all in a workspace with no teams', async () => {
    mockGets({ groups: { items: [] } });
    renderReplies();
    await screen.findByText(REPLY.text);

    expect(screen.queryByLabelText('Team')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit team for #shipping' }),
    ).not.toBeInTheDocument();
    // The reply is still listed — the picker is what is missing, not the row.
    expect(screen.getByText('All teams')).toBeInTheDocument();
  });

  it('shows a read-only viewer no write control', async () => {
    renderReplies(false);
    await screen.findByText(REPLY.text);

    expect(screen.queryByLabelText('Team')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save reply' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit team for #shipping' }),
    ).not.toBeInTheDocument();
  });
});
