/**
 * The knowledge row's action menu (FR-MOD-06.3.3).
 *
 * The row used to carry one bare button that deleted on the click — no menu, no
 * question asked, and a source takes every chunk indexed from it when it goes.
 * So the assertions that matter here are about the *gap* the dialog opens:
 * cancelling must send nothing, and confirming must send exactly the delete.
 * A `window.confirm` would satisfy neither claim, because a test cannot cancel
 * one — which is half the reason it is not used, asserted here rather than left
 * as a convention.
 *
 * Driven through `PlaybookPage` rather than the component alone, because the
 * menu is only reachable with the write scope and only rendered inside the row
 * — the two conditions a unit test of the component in isolation would assume
 * instead of check.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import type { KnowledgeSource } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { PlaybookPage } = await import('./PlaybookPage.js');
const { useAuth } = await import('../../lib/auth-store.js');

function source(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id: 'src-1',
    ai_agent_id: 'agent-1',
    name: 'Return policy',
    type: 'faq',
    status: 'ready',
    source_url: null,
    chunk_count: 3,
    updated_at: '2026-01-15T10:00:00.000Z',
    added_by_name: 'Ada Lovelace',
    refresh_after_days: null,
    next_refresh_at: null,
    last_refresh_error: null,
    ...overrides,
  };
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.delete.mockReset();
  // A real, stable `agent` object: the page's scopes selector mints a fresh
  // `[]` on every call when `agent` is nullish, which never satisfies zustand's
  // snapshot equality and spins into "Maximum update depth exceeded".
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'owner',
      organization_id: 'o-1',
      license_id: '1000003',
      // The actions live behind the write scope.
      scopes: ['agents-bot--all:rw'],
      routing_status: 'accepting_chats',
    },
  });
});

/** Renders the Knowledge tab with `items` in the list. */
async function openKnowledge(
  user: ReturnType<typeof userEvent.setup>,
  items: KnowledgeSource[],
): Promise<void> {
  api.get.mockImplementation((path: string) => {
    if (path === '/skills') return Promise.resolve({ items: [] });
    if (path === '/ai-agents') return Promise.resolve({ items: [] });
    if (path === '/knowledge-sources') return Promise.resolve({ items });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlaybookPage />
    </QueryClientProvider>,
  );
  await user.click(await screen.findByRole('tab', { name: 'Knowledge' }));
}

async function openMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'Actions for Return policy' }));
}

describe('knowledge source row actions (FR-MOD-06.3.3)', () => {
  it('gathers edit, reindex and delete into one menu instead of a bare button', async () => {
    const user = userEvent.setup();
    await openKnowledge(user, [source()]);
    await openMenu(user);

    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reindex' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('asks before deleting, and sends nothing when the answer is no', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const user = userEvent.setup();
    await openKnowledge(user, [source()]);
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    // The dialog is the app's own, so it can be cancelled — and asserted on.
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Return policy');
    expect(api.delete).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.delete).not.toHaveBeenCalled();
    // Never the browser's dialog: it cannot be cancelled from a test, cannot
    // say what is about to be lost, and is outside the design system.
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('deletes only once the dialog is confirmed', async () => {
    api.delete.mockResolvedValue(undefined);
    const user = userEvent.setup();
    await openKnowledge(user, [source()]);
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete source' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/knowledge-sources/src-1'));
  });

  it('sends only the fields that changed, so an untouched body is not re-indexed', async () => {
    api.patch.mockResolvedValue(source({ name: 'Returns and refunds' }));
    const user = userEvent.setup();
    await openKnowledge(user, [source()]);
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    const title = within(dialog).getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Returns and refunds');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/knowledge-sources/src-1', {
        name: 'Returns and refunds',
      }),
    );
  });

  it('replaces the text when content is entered', async () => {
    api.patch.mockResolvedValue(source());
    const user = userEvent.setup();
    await openKnowledge(user, [source()]);
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    // A pasted source is edited through its content; it has no crawl, so it
    // offers no URL to change.
    expect(within(dialog).queryByLabelText('Website URL')).toBeNull();
    await user.type(within(dialog).getByLabelText('Content'), 'Refunds go to store credit.');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/knowledge-sources/src-1', {
        content: 'Refunds go to store credit.',
      }),
    );
  });

  it('edits a website through its URL, never through a pasted body', async () => {
    api.patch.mockResolvedValue(source());
    const user = userEvent.setup();
    await openKnowledge(user, [
      source({ type: 'website', source_url: 'https://help.example.com/old' }),
    ]);
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Content')).toBeNull();
    const url = within(dialog).getByLabelText('Website URL');
    await user.clear(url);
    await user.type(url, 'https://help.example.com/new');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/knowledge-sources/src-1', {
        source_url: 'https://help.example.com/new',
      }),
    );
  });

  it('schedules automatic refresh for a website source (FR-MOD-06.3.3, tm 198.4)', async () => {
    api.patch.mockResolvedValue(source({ type: 'website' }));
    const user = userEvent.setup();
    await openKnowledge(user, [
      source({ type: 'website', source_url: 'https://help.example.com/old' }),
    ]);
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Automatic refresh'), '30');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/knowledge-sources/src-1', {
        refresh_after_days: 30,
      }),
    );
  });

  it('turns automatic refresh back off with an explicit null', async () => {
    api.patch.mockResolvedValue(source({ type: 'website' }));
    const user = userEvent.setup();
    await openKnowledge(user, [
      source({
        type: 'website',
        source_url: 'https://help.example.com/old',
        refresh_after_days: 30,
      }),
    ]);
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Automatic refresh'), '');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/knowledge-sources/src-1', {
        refresh_after_days: null,
      }),
    );
  });

  it('offers no freshness schedule for a type with nothing to re-crawl', async () => {
    const user = userEvent.setup();
    await openKnowledge(user, [source({ type: 'faq' })]);
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Automatic refresh')).toBeNull();
  });

  it('shows why the last automatic refresh failed', async () => {
    const user = userEvent.setup();
    await openKnowledge(user, [
      source({
        type: 'website',
        source_url: 'https://help.example.com/old',
        last_refresh_error: 'That address points at a private or internal host.',
      }),
    ]);
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    const alert = within(dialog).getByRole('alert');
    expect(alert.textContent).toContain('That address points at a private or internal host.');
  });

  it('flags a row whose last automatic refresh failed, without opening the dialog', async () => {
    const user = userEvent.setup();
    await openKnowledge(user, [
      source({ type: 'website', last_refresh_error: 'That address points at a private host.' }),
    ]);

    expect(await screen.findByText('Could not refresh automatically')).toBeTruthy();
  });

  it('leaves a file source with a title and an explanation, not an editable body', async () => {
    const user = userEvent.setup();
    await openKnowledge(user, [source({ type: 'file' })]);
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Title')).toBeTruthy();
    expect(within(dialog).queryByLabelText('Content')).toBeNull();
    expect(within(dialog).queryByLabelText('Website URL')).toBeNull();
    expect(dialog.textContent).toContain('file you uploaded');
  });

  it('reindexes straight from the menu, with no dialog in the way', async () => {
    api.post.mockResolvedValue(source());
    const user = userEvent.setup();
    await openKnowledge(user, [source()]);
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Reindex' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/knowledge-sources/src-1/reindex', {}),
    );
    // Refreshing a source is not destructive and needs no permission — the
    // confirmation exists for the one action that cannot be undone.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reports a failed reindex on the row rather than losing it', async () => {
    api.post.mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    await openKnowledge(user, [source()]);
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Reindex' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBeTruthy();
  });

  it('shows no action menu without the write scope', async () => {
    useAuth.setState({ agent: { ...useAuth.getState().agent!, scopes: [] } });
    const user = userEvent.setup();
    await openKnowledge(user, [source()]);

    expect(await screen.findByText('Return policy')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Actions for Return policy' })).toBeNull();
  });
});
