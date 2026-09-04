/**
 * Settings → Tags: the team-scope selector (FR-MOD-08.7.1).
 *
 * `routes/settings.ts` has accepted and validated `group_ids` on both create
 * and update from the start — this pins the client half that was missing: the
 * create form sends the checked teams, editing an existing tag's scope PATCHes
 * it, a read-only viewer sees neither control, and a workspace with no teams
 * shows no picker at all (there is nothing to scope to).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
}));

const { Tags } = await import('./Tags.js');

const SUPPORT_TEAM = { id: 1, name: 'Support' };
const BILLING_TEAM = { id: 2, name: 'Billing' };

const TAG = {
  id: 'tag-1',
  name: 'vip',
  group_ids: [SUPPORT_TEAM.id],
  author_id: null,
  usage_count: 3,
  created_at: '2026-07-26T12:00:00.000Z',
};

function mockGets(overrides: { tags?: unknown; groups?: unknown } = {}): void {
  const tags = overrides.tags ?? { items: [TAG] };
  const groups = overrides.groups ?? { items: [SUPPORT_TEAM, BILLING_TEAM] };
  api.get.mockImplementation((path: string) => Promise.resolve(path === '/groups' ? groups : tags));
}

function renderTags(canEdit = true): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Tags canEdit={canEdit} />
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

describe('Tags — create with a team scope', () => {
  it('sends the checked team in group_ids, leaving unchecked ones out', async () => {
    renderTags();
    await screen.findByText('vip');
    api.post.mockResolvedValue({
      ...TAG,
      id: 'tag-2',
      name: 'billing-only',
      group_ids: [BILLING_TEAM.id],
    });

    fireEvent.change(screen.getByLabelText('Tag', { exact: true }), {
      target: { value: 'billing-only' },
    });
    fireEvent.click(screen.getByLabelText('Billing', { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/settings/tags', {
        name: 'billing-only',
        group_ids: [BILLING_TEAM.id],
      }),
    );
  });

  it('sends an empty group_ids — workspace-wide — when no team is checked', async () => {
    renderTags();
    await screen.findByText('vip');
    api.post.mockResolvedValue({ ...TAG, id: 'tag-3', name: 'workspace-wide', group_ids: [] });

    fireEvent.change(screen.getByLabelText('Tag', { exact: true }), {
      target: { value: 'workspace-wide' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/settings/tags', {
        name: 'workspace-wide',
        group_ids: [],
      }),
    );
  });
});

describe("Tags — editing an existing tag's team scope", () => {
  it("opens pre-checked to the tag's current teams and PATCHes the new selection", async () => {
    renderTags();
    await screen.findByText('vip');

    fireEvent.click(screen.getByRole('button', { name: 'Edit teams for tag vip' }));
    const group = screen.getByRole('group', { name: 'Edit teams for tag vip' });
    expect(within(group).getByLabelText('Support', { exact: true })).toBeChecked();
    expect(within(group).getByLabelText('Billing', { exact: true })).not.toBeChecked();

    fireEvent.click(within(group).getByLabelText('Billing', { exact: true }));
    api.patch.mockResolvedValue({ ...TAG, group_ids: [SUPPORT_TEAM.id, BILLING_TEAM.id] });
    fireEvent.click(within(group).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/tags/tag-1', {
        group_ids: [SUPPORT_TEAM.id, BILLING_TEAM.id],
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Edit teams for tag vip' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('closes without saving on Cancel', async () => {
    renderTags();
    await screen.findByText('vip');

    fireEvent.click(screen.getByRole('button', { name: 'Edit teams for tag vip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('group', { name: 'Edit teams for tag vip' })).not.toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });
});

describe('Tags — read-only viewer', () => {
  it('shows no team checkboxes and no edit-teams control', async () => {
    renderTags(false);
    await screen.findByText('vip');

    expect(screen.queryByLabelText('Support', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit teams/ })).not.toBeInTheDocument();
  });
});

describe('Tags — no teams in the workspace', () => {
  it('renders no team picker at all — there is nothing to scope to', async () => {
    mockGets({ groups: { items: [] } });
    renderTags();
    await screen.findByText('vip');

    expect(screen.queryByRole('group', { name: 'Teams' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit teams/ })).not.toBeInTheDocument();
  });
});
