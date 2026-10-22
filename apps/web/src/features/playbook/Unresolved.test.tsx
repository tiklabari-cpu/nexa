/**
 * The unresolved questions report (tm 317.3 · AI-22): the list shows the open
 * clusters by the last seven days with their rates, the "new" badge and the
 * reason; the filters become the request; an ignored cluster is out of the
 * default view and back with its filter; a cluster opens with its masked
 * examples and their ids always on the page; ignore, fix, merge, add
 * knowledge and add example sentences call the API and say what they did;
 * a reader sees none of the buttons; the surge threshold is set here.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import type {
  UnresolvedCluster,
  UnresolvedClusterDetail,
  UnresolvedClusterList,
  UnresolvedSettings,
} from './ai-unresolved.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { Unresolved } = await import('./Unresolved.js');

const AGENT_ID = '22222222-2222-4222-8222-222222222222';
const PAPARA = 'c1111111-1111-4111-8111-111111111111';
const BONUS = 'c2222222-2222-4222-8222-222222222222';
const SKILL_ID = 's1111111-1111-4111-8111-111111111111';

function cluster(overrides: Partial<UnresolvedCluster>): UnresolvedCluster {
  return {
    id: PAPARA,
    ai_agent_id: AGENT_ID,
    label: 'Papara ile yatırma görünmüyor',
    label_source: 'llm',
    suggested_action: 'add_knowledge',
    status: 'open',
    ignore_reason: null,
    item_count: 20,
    count_7d: 12,
    handoff_count: 5,
    abandon_count: 2,
    handoff_rate: 0.25,
    abandon_rate: 0.1,
    post_fix_count: 0,
    is_new: false,
    first_seen: '2026-10-10T08:00:00.000Z',
    last_seen: '2026-10-22T08:00:00.000Z',
    resolved_at: null,
    linked_change_id: null,
    reasons: [{ reason: 'no_procedure_match', count: 15 }],
    matching_count: null,
    ...overrides,
  };
}

const PAPARA_CLUSTER = cluster({});
const BONUS_CLUSTER = cluster({
  id: BONUS,
  label: 'Bonus çevrim şartı',
  is_new: true,
  count_7d: 3,
  item_count: 3,
  handoff_rate: 0,
  abandon_rate: 0,
  reasons: [{ reason: 'no_knowledge', count: 3 }],
  suggested_action: null,
});

const LIST: UnresolvedClusterList = {
  clusters: [PAPARA_CLUSTER, BONUS_CLUSTER],
  total: 2,
  unclustered_count: 4,
  spike_threshold: 20,
};

const DETAIL: UnresolvedClusterDetail = {
  ...PAPARA_CLUSTER,
  examples: [
    {
      id: 'e1',
      text: 'Papara ile yatırdım gözükmüyor',
      context: 'Merhaba, yardım eder misiniz',
      reason: 'no_procedure_match',
      language: 'tr',
      brand_id: null,
      chat_id: 'CHATDAY0001',
      thread_id: 'THREAD00001',
      created_at: '2026-10-22T07:00:00.000Z',
    },
    {
      id: 'e2',
      text: 'param Papara ile gelmedi',
      context: null,
      reason: 'said_dont_know',
      language: 'tr',
      brand_id: null,
      chat_id: 'CHATDAY0002',
      thread_id: 'THREAD00002',
      created_at: '2026-10-21T07:00:00.000Z',
    },
  ],
  trend: Array.from({ length: 14 }, (_, i) => ({
    date: `2026-10-${String(9 + i).padStart(2, '0')}`,
    count: i % 3,
  })),
  languages: [{ language: 'tr', count: 20 }],
};

const SETTINGS: UnresolvedSettings = {
  spike_threshold: 20,
  default_threshold: 20,
  window_minutes: 60,
  min_threshold: 5,
  max_threshold: 1000,
};

const SKILLS = [
  {
    id: SKILL_ID,
    name: 'Yatırım geçmedi',
    mode: 'procedure' as const,
    locked: false,
    ai_agent_id: AGENT_ID,
  },
  { id: 's2', name: 'Kilitli', mode: 'procedure' as const, locked: true, ai_agent_id: AGENT_ID },
  { id: 's3', name: 'Tek adım', mode: 'single' as const, locked: false, ai_agent_id: AGENT_ID },
];

function renderScreen(canEdit = true): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Unresolved agentId={AGENT_ID} skills={SKILLS} canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/ai/unresolved/clusters?')) return Promise.resolve(LIST);
    if (path === `/ai/unresolved/clusters/${PAPARA}`) return Promise.resolve(DETAIL);
    if (path === '/ai/unresolved/settings') return Promise.resolve(SETTINGS);
    if (path === '/brands') return Promise.resolve({ items: [{ id: 'b1', name: 'Marka A' }] });
    return Promise.resolve({ items: [] });
  });
});

const listCalls = () =>
  api.get.mock.calls
    .map(([path]) => path as string)
    .filter((p) => p.startsWith('/ai/unresolved/clusters?'));

describe('the list (AI-22 §6)', () => {
  it('shows the open clusters with the numbers, the new badge and the reason', async () => {
    renderScreen();

    const table = await screen.findByRole('table', { name: 'Unresolved questions' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(
      within(rows[0]!).getByRole('button', { name: 'Papara ile yatırma görünmüyor' }),
    ).toBeInTheDocument();
    expect(within(rows[0]!).getByText('No procedure matched')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('12')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('25%')).toBeInTheDocument();
    expect(within(rows[0]!).queryByText('New')).toBeNull();
    expect(within(rows[1]!).getByText('New')).toBeInTheDocument();
    expect(screen.getByText('Messages not in a cluster yet: 4.')).toBeInTheDocument();
    expect(listCalls()[0]).toBe(
      `/ai/unresolved/clusters?ai_agent_id=${AGENT_ID}&status=open&sort=count_7d`,
    );
  });

  it('asks for what the filters say, and clears them', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole('table');

    await user.selectOptions(screen.getByLabelText('Show'), 'ignored');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'handoff_rate');
    await user.selectOptions(screen.getByLabelText('Reason'), 'no_knowledge');
    await user.type(screen.getByLabelText('Language'), 'EN');
    await user.type(screen.getByLabelText('From'), '2026-10-01');

    await waitFor(() =>
      expect(listCalls().at(-1)).toBe(
        `/ai/unresolved/clusters?ai_agent_id=${AGENT_ID}&status=ignored&sort=handoff_rate&reason=no_knowledge&language=en&from=${encodeURIComponent('2026-10-01T00:00:00.000Z')}`,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() =>
      expect(listCalls().at(-1)).toBe(
        `/ai/unresolved/clusters?ai_agent_id=${AGENT_ID}&status=open&sort=count_7d`,
      ),
    );
  });

  it('says so when nothing matches, differently with a filter on', async () => {
    const user = userEvent.setup();
    api.get.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/ai/unresolved/clusters?')
          ? { ...LIST, clusters: [], total: 0, unclustered_count: 0 }
          : path === '/ai/unresolved/settings'
            ? SETTINGS
            : { items: [] },
      ),
    );
    renderScreen();

    expect(await screen.findByText('Nothing unresolved')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Show'), 'all');
    expect(await screen.findByText('No clusters match')).toBeInTheDocument();
  });

  it('counts the messages that match a filter beside the cluster', async () => {
    api.get.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/ai/unresolved/clusters?')
          ? { ...LIST, clusters: [{ ...PAPARA_CLUSTER, matching_count: 7 }] }
          : path === '/ai/unresolved/settings'
            ? SETTINGS
            : { items: [] },
      ),
    );
    renderScreen();
    expect(await screen.findByText('7 matching')).toBeInTheDocument();
  });
});

describe('one cluster', () => {
  it('opens with the masked examples and their ids always on the page', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Papara ile yatırma görünmüyor' }));

    const detail = await screen.findByTestId('unresolved-cluster-detail');
    const examples = within(detail).getByRole('list', { name: 'What players wrote' });
    expect(within(examples).getAllByRole('listitem')).toHaveLength(2);
    expect(within(examples).getByText('Papara ile yatırdım gözükmüyor')).toBeInTheDocument();
    expect(
      within(examples).getByText('Before it: Merhaba, yardım eder misiniz'),
    ).toBeInTheDocument();
    expect(within(examples).getByText('CHATDAY0001')).toBeInTheDocument();
    expect(within(examples).getByText('THREAD00001')).toBeInTheDocument();
    expect(within(detail).getByText(/The title is a summary and can be wrong/)).toBeInTheDocument();
    expect(within(detail).getByText('Suggested: add knowledge')).toBeInTheDocument();
    expect(
      within(detail).getByRole('img', { name: /Messages per day, last 14 days: 0, 1, 2/ }),
    ).toBeInTheDocument();

    await user.click(within(detail).getByRole('button', { name: 'Back to the list' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('ignores with a reason, marks fixed and reopens — each one a call', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({ ...PAPARA_CLUSTER, status: 'ignored' });
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Papara ile yatırma görünmüyor' }));
    await screen.findByTestId('unresolved-cluster-detail');

    await user.click(screen.getByRole('button', { name: 'Ignore' }));
    await user.type(screen.getByLabelText('Why (optional)'), 'Bilinen sorun');
    await user.click(screen.getByRole('button', { name: 'Ignore this cluster' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/ai/unresolved/clusters/${PAPARA}/ignore`, {
        reason: 'Bilinen sorun',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Mark fixed' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/ai/unresolved/clusters/${PAPARA}/resolve`, {}),
    );
    // An open cluster has nothing to reopen.
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
  });

  it('shows what an ignored and a fixed cluster say, and offers to reopen it', async () => {
    const user = userEvent.setup();
    api.get.mockImplementation((path: string) => {
      if (path.startsWith('/ai/unresolved/clusters?')) return Promise.resolve(LIST);
      if (path === `/ai/unresolved/clusters/${PAPARA}`) {
        return Promise.resolve({
          ...DETAIL,
          status: 'resolved',
          resolved_at: '2026-10-20T10:00:00.000Z',
          post_fix_count: 3,
        });
      }
      return Promise.resolve(path === '/ai/unresolved/settings' ? SETTINGS : { items: [] });
    });
    api.post.mockResolvedValue({ ...PAPARA_CLUSTER });
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Papara ile yatırma görünmüyor' }));

    expect(
      await screen.findByText(/Messages since: 3\. Five more bring it back\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark fixed' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/ai/unresolved/clusters/${PAPARA}/reopen`, {}),
    );
  });

  it('opens the knowledge editor with the questions and adds the source', async () => {
    const user = userEvent.setup();
    api.post.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith('/suggest-knowledge')
          ? {
              cluster_id: PAPARA,
              ai_agent_id: AGENT_ID,
              target: 'knowledge_snippet',
              title: 'Papara ile yatırma görünmüyor',
              questions: ['Papara ile yatırdım gözükmüyor', 'param Papara ile gelmedi'],
              body: '',
            }
          : { id: 'src-1' },
      ),
    );
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Papara ile yatırma görünmüyor' }));
    await screen.findByTestId('unresolved-cluster-detail');

    await user.click(screen.getByRole('button', { name: 'Add knowledge' }));
    const content = (await screen.findByLabelText('Content')) as HTMLTextAreaElement;
    expect(content.value).toContain('Questions players asked:');
    expect(content.value).toContain('- param Papara ile gelmedi');
    expect(screen.getByLabelText('Name')).toHaveValue('Papara ile yatırma görünmüyor');

    await user.type(content, 'Papara yatırımları 15 dakikada görünür.');
    await user.click(screen.getByRole('button', { name: 'Add to knowledge' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/knowledge-sources',
        expect.objectContaining({
          ai_agent_id: AGENT_ID,
          type: 'article',
          name: 'Papara ile yatırma görünmüyor',
          content: expect.stringContaining('Papara yatırımları 15 dakikada görünür.'),
        }),
      ),
    );
    expect(await screen.findByText(/Added to the knowledge base/)).toBeInTheDocument();
  });

  it('adds chosen messages to a procedure’s examples — never to a locked or single-step one', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({
      skill_id: SKILL_ID,
      added: ['param Papara ile gelmedi'],
      skipped: 0,
      examples_count: 3,
    });
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Papara ile yatırma görünmüyor' }));
    await screen.findByTestId('unresolved-cluster-detail');

    await user.click(screen.getByRole('button', { name: 'Add example sentences' }));
    const procedure = await screen.findByLabelText('Procedure');
    expect(
      within(procedure)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Yatırım geçmedi']);
    const submit = screen.getByRole('button', { name: 'Add selected (0)' });
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'param Papara ile gelmedi' }));
    await user.click(screen.getByRole('button', { name: 'Add selected (1)' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/ai/unresolved/clusters/${PAPARA}/add-examples`, {
        skill_id: SKILL_ID,
        sentences: ['param Papara ile gelmedi'],
      }),
    );
    expect(await screen.findByText(/Added: 1\. Already there: 0\./)).toBeInTheDocument();
  });

  it('merges other clusters only after a confirmation', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({ cluster: PAPARA_CLUSTER, absorbed: 1 });
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Papara ile yatırma görünmüyor' }));
    await screen.findByTestId('unresolved-cluster-detail');

    await user.click(screen.getByRole('button', { name: 'Merge clusters' }));
    await user.click(screen.getByRole('checkbox', { name: /Bonus çevrim şartı/ }));
    await user.click(screen.getByRole('button', { name: 'Merge selected (1)' }));
    expect(api.post).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Merge clusters' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/ai/unresolved/clusters/${PAPARA}/merge`, {
        source_ids: [BONUS],
      }),
    );
    expect(await screen.findByText('Merged. Clusters folded in: 1.')).toBeInTheDocument();
  });

  it('shows a refusal in place', async () => {
    const user = userEvent.setup();
    const { ApiClientError } = await import('../../lib/api-client.js');
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'authorization',
        status: 403,
        message: 'no',
        requestId: 'req-1',
      }),
    );
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Papara ile yatırma görünmüyor' }));
    await screen.findByTestId('unresolved-cluster-detail');

    await user.click(screen.getByRole('button', { name: 'Mark fixed' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('offers a reader no move at all, only the examples', async () => {
    const user = userEvent.setup();
    renderScreen(false);
    await user.click(await screen.findByRole('button', { name: 'Papara ile yatırma görünmüyor' }));
    const detail = await screen.findByTestId('unresolved-cluster-detail');

    for (const name of [
      'Add knowledge',
      'Add example sentences',
      'Merge clusters',
      'Ignore',
      'Mark fixed',
      'Reopen',
    ]) {
      expect(within(detail).queryByRole('button', { name })).toBeNull();
    }
    expect(within(detail).getByRole('list', { name: 'What players wrote' })).toBeInTheDocument();
  });
});

describe('the surge alarm (AI-22-S2)', () => {
  it('saves a whole number in range and refuses the rest', async () => {
    const user = userEvent.setup();
    api.put.mockResolvedValue({ ...SETTINGS, spike_threshold: 35 });
    renderScreen();

    const box = await screen.findByLabelText('Messages in an hour');
    expect(box).toHaveValue('20');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.clear(box);
    await user.type(box, '3');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.clear(box);
    await user.type(box, '35');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/ai/unresolved/settings', { spike_threshold: 35 }),
    );
  });

  it('is read-only for a reader', async () => {
    renderScreen(false);
    const box = await screen.findByLabelText('Messages in an hour');
    expect(box).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
