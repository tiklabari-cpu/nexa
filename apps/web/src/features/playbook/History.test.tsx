/**
 * Playbook › History (tm 315 · AI-21): the timeline names the change, the
 * entity, the actor and their role, and the fields; opened, a change shows
 * its difference side by side, a procedure step as "Step 3"; the filters
 * become the request; the export is drawn for the whole history only; an
 * editor's drawer asks for one entity; `?change=` opens a linked change.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import type { AiConfigChange, AiConfigChangeDetail, AiConfigChangeList } from './ai-changes.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), getFile: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { History } = await import('./History.js');

const SKILL = 'a1111111-1111-4111-8111-111111111111';

const TONE: AiConfigChange = {
  id: 'c1111111-1111-4111-8111-111111111111',
  ai_agent_id: 'b1111111-1111-4111-8111-111111111111',
  entity_type: 'persona',
  entity_id: 'b1111111-1111-4111-8111-111111111111',
  entity_name: 'Ada',
  action: 'updated',
  actor: { id: 'u1', type: 'agent', role: 'owner', name: 'Selin' },
  at: '2026-10-27T09:00:00.000Z',
  version_id: null,
  draft_revision: null,
  note: null,
  fields: ['tone'],
  diff: [{ path: 'tone', kind: 'changed', before: 'friendly', after: 'formal' }],
};

const STEP: AiConfigChange = {
  ...TONE,
  id: 'c2222222-2222-4222-8222-222222222222',
  entity_type: 'procedure',
  entity_id: SKILL,
  entity_name: 'Çekim gecikti',
  fields: ['procedure'],
  diff: [
    {
      path: 'procedure.steps[2].target',
      kind: 'changed',
      before: 'Finans',
      after: 'KYC',
    },
  ],
};

function page(
  items: AiConfigChange[],
  extra: Partial<AiConfigChangeList> = {},
): AiConfigChangeList {
  return { items, next_cursor: null, visibility: 'all', ...extra };
}

function detailOf(change: AiConfigChange): AiConfigChangeDetail {
  return { ...change, before: {}, after: {}, request_id: null };
}

function renderHistory(props: Parameters<typeof History>[0] = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <History {...props} />
    </QueryClientProvider>,
  );
}

describe('History (AI-21 · tm 315)', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.getFile.mockReset();
    api.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/ai/changes/c2222222')) return detailOf(STEP);
      if (path.startsWith('/ai/changes/c1111111')) return detailOf(TONE);
      return page([STEP, TONE]);
    });
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('lists who changed what, in which role, and which fields', async () => {
    renderHistory();
    const rows = await screen.findAllByTestId('ai-history-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]!).getByText(/Profile · Ada/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/Selin · Owner · fields: tone/)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/ai/changes');
  });

  it('opens a change side by side, a procedure step as its 1-based step', async () => {
    renderHistory();
    const rows = await screen.findAllByTestId('ai-history-row');
    await userEvent.click(within(rows[0]!).getByRole('button', { name: 'Show the change' }));
    const diff = await screen.findByTestId('change-diff');
    expect(within(diff).getByRole('rowheader', { name: 'Step 3 · target' })).toBeInTheDocument();
    expect(within(diff).getByText('Finans')).toBeInTheDocument();
    expect(within(diff).getByText('KYC')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(`/ai/changes/${STEP.id}`);
  });

  it('turns the filters into the request', async () => {
    renderHistory();
    await screen.findAllByTestId('ai-history-row');
    await userEvent.selectOptions(screen.getByLabelText('What changed'), 'procedure');
    await userEvent.selectOptions(screen.getByLabelText('Change'), 'deleted');
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/ai/changes?entity_type=procedure&action=deleted'),
    );
  });

  it('offers the export for the whole history and not for a Team Lead’s own', async () => {
    renderHistory();
    expect(await screen.findByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    api.getFile.mockResolvedValue({ blob: new Blob(['a']), filename: 'x.csv' });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(api.getFile).toHaveBeenCalledWith('/ai/changes/export');
  });

  it('a Team Lead reads their own and sees no export', async () => {
    api.get.mockResolvedValue(page([TONE], { visibility: 'own' }));
    renderHistory();
    await screen.findAllByTestId('ai-history-row');
    expect(screen.getByText(/Your own changes/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
  });

  it('an editor’s drawer asks for its one entity, without filters', async () => {
    renderHistory({ entityId: SKILL, compact: true });
    await screen.findAllByTestId('ai-history-row');
    expect(api.get).toHaveBeenCalledWith(`/ai/changes?entity_id=${SKILL}`);
    expect(screen.queryByLabelText('What changed')).not.toBeInTheDocument();
  });

  it('opens the change a link names (the audit log’s deep link)', async () => {
    window.history.replaceState(null, '', `/app/playbook?view=history&change=${TONE.id}`);
    renderHistory();
    // Opened in its row once the list is in.
    const rows = await screen.findAllByTestId('ai-history-row');
    const diff = await within(rows[1]!).findByTestId('change-diff');
    expect(within(diff).getByText('friendly')).toBeInTheDocument();
    expect(within(diff).getByText('formal')).toBeInTheDocument();
    expect(within(rows[1]!).getByRole('button', { name: 'Hide the change' })).toBeInTheDocument();
  });

  it('says there is nothing yet', async () => {
    api.get.mockResolvedValue(page([]));
    renderHistory();
    expect(await screen.findByText('No changes yet')).toBeInTheDocument();
  });
});
