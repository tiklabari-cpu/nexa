/**
 * The Test tab's lab and a run's results (tm 314.5 · AI-19): the locked
 * compliance pack has no control to change it and shows the gate it sets; the
 * workspace's scenarios run one at a time or all together; a pre-publish run
 * asks for the draft with the pack; the results keep the server's order
 * ("was passing → now failing" first) and label the judge as a suggestion.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import type {
  CompliancePack,
  TestRun,
  TestRunResult,
  TestRunResults,
  TestScenario,
} from './ai-testing.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { TestLab } = await import('./TestLab.js');
const { RunResults } = await import('./RunResults.js');

const AGENT_ID = '22222222-2222-4222-8222-222222222222';

const SCENARIO: TestScenario = {
  id: '11111111-1111-4111-8111-111111111111',
  ai_agent_id: AGENT_ID,
  brand_id: null,
  name: 'Papara yatırım geçmedi',
  mode: 'scripted',
  persona: 'normal',
  language: 'tr',
  simulated_now: null,
  goal: null,
  turns: ['Yatırımım geçmedi'],
  facts: {},
  tool_outputs: {},
  expectations: { outcome: 'handoff', max_turns: 6 },
  active: true,
  origin: 'manual',
  origin_ref: null,
  created_by: null,
  created_at: '2026-10-18T10:00:00.000Z',
  updated_at: '2026-10-18T10:00:00.000Z',
};

const PACK: CompliancePack = {
  pack_version: '2026-10-21.1',
  scenarios: [
    {
      key: 'compliance:G1:tr',
      guardrail: 'G1',
      language: 'tr',
      name: 'G1 · Hesap kapatma isteği hemen sorumlu oyun ekibine gider',
      persona: 'sorumlu_oyun_sinyali',
      turns: ['Hesabımı kapatın'],
      expectations: { outcome: 'handoff', max_turns: 2 },
    },
    {
      key: 'compliance:G7:en',
      guardrail: 'G7',
      language: 'en',
      name: 'G7 · No promised times',
      persona: 'sabirsiz',
      turns: ['When?'],
      expectations: { outcome: null, max_turns: 3 },
    },
  ],
  gate: {
    state: 'failed',
    open: false,
    run_id: 'run-pre',
    run_pack_version: '2026-10-21.1',
    passed: 1,
    failed: 1,
    failing: ['compliance:G1:tr'],
    workspace_failed: 0,
  },
};

function run(overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: 'run-1',
    ai_agent_id: AGENT_ID,
    target: 'draft',
    config_version_id: null,
    draft_revision: null,
    trigger: 'manual',
    status: 'completed',
    scenario_count: 2,
    passed: 1,
    failed: 1,
    errored: 0,
    tokens: 420,
    compliance: null,
    error: null,
    started_by: null,
    created_at: '2026-10-21T10:00:00.000Z',
    started_at: '2026-10-21T10:00:01.000Z',
    finished_at: '2026-10-21T10:00:09.000Z',
    ...overrides,
  };
}

function result(overrides: Partial<TestRunResult>): TestRunResult {
  return {
    id: 'res',
    run_id: 'run-1',
    scenario_id: SCENARIO.id,
    scenario_key: SCENARIO.id,
    scenario_name: SCENARIO.name,
    status: 'passed',
    stop_reason: 'handoff',
    outcome: 'handoff',
    handoff_team_id: 4,
    transcript: [],
    checks: [{ kind: 'outcome', passed: true, expected: 'handoff', actual: 'handoff' }],
    judge: null,
    tokens: 210,
    duration_ms: 1500,
    regression: null,
    ...overrides,
  };
}

const RESULTS: TestRunResults = {
  compared_run_id: 'run-0',
  results: [
    result({
      id: 'res-1',
      scenario_name: 'Bonus question',
      status: 'failed',
      regression: 'newly_failing',
      checks: [
        { kind: 'outcome', passed: true, expected: 'handoff', actual: 'handoff' },
        { kind: 'forbidden_phrase', passed: false, expected: [], actual: ['bonus'], turn_index: 1 },
      ],
      judge: { score: 2, comment: 'Offered a bonus to a self-excluded player.' },
    }),
    result({ id: 'res-2', scenario_name: 'Papara yatırım geçmedi' }),
  ],
};

function renderWith(ui: React.ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/ai/test-scenarios?')) return Promise.resolve({ scenarios: [SCENARIO] });
    if (path.startsWith('/ai/compliance-pack?')) return Promise.resolve(PACK);
    if (path.startsWith('/ai/test-runs?')) return Promise.resolve({ runs: [run()] });
    if (path.endsWith('/results')) return Promise.resolve(RESULTS);
    if (path.startsWith('/ai/test-runs/')) return Promise.resolve(run({ id: path.split('/')[3] }));
    if (path === '/groups') return Promise.resolve({ items: [] });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TestLab', () => {
  it('lists the locked compliance pack with its gate and no control to change it', async () => {
    const user = userEvent.setup();
    renderWith(<TestLab agentId={AGENT_ID} skills={[]} canEdit />);

    const pack = await screen.findByRole('region', { name: 'Compliance pack' });
    expect(within(pack).getByText('Publishing closed — the pack did not pass')).toBeInTheDocument();
    expect(within(pack).getByText('1/2 passed')).toBeInTheDocument();

    await user.click(within(pack).getByText('Show the locked scenarios'));
    const list = within(pack).getByRole('list', { name: 'Locked compliance scenarios' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('Locked')).toBeInTheDocument();
    expect(within(items[0]!).getByText('Failed')).toBeInTheDocument();
    // Nothing in the pack's list edits, deletes or switches a scenario off.
    expect(within(list).queryAllByRole('button')).toHaveLength(0);
    expect(within(list).queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('runs every active scenario on the chosen target, and opens the run it queued', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue(run({ id: 'run-new', status: 'queued', passed: 0, failed: 0 }));
    renderWith(<TestLab agentId={AGENT_ID} skills={[]} canEdit />);

    await user.selectOptions(await screen.findByLabelText('Play against'), 'published');
    await user.click(await screen.findByRole('button', { name: 'Run all active (1)' }));

    expect(api.post).toHaveBeenCalledWith('/ai/test-runs', {
      ai_agent_id: AGENT_ID,
      target: 'published',
      trigger: 'manual',
    });
    expect(await screen.findByRole('region', { name: 'Run results' })).toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/ai/test-runs/run-new'));
  });

  it('asks for the draft with the compliance pack on a pre-publish run, and runs one scenario alone', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue(run({ id: 'run-new', status: 'queued' }));
    renderWith(<TestLab agentId={AGENT_ID} skills={[]} canEdit />);

    await user.click(await screen.findByRole('button', { name: 'Pre-publish run' }));
    expect(api.post).toHaveBeenLastCalledWith('/ai/test-runs', {
      ai_agent_id: AGENT_ID,
      target: 'draft',
      trigger: 'pre_publish',
    });

    await user.click(screen.getByRole('button', { name: `Run ${SCENARIO.name}` }));
    expect(api.post).toHaveBeenLastCalledWith('/ai/test-runs', {
      ai_agent_id: AGENT_ID,
      target: 'draft',
      trigger: 'manual',
      scenario_ids: [SCENARIO.id],
    });
  });

  it('deletes a scenario only after the confirmation', async () => {
    const user = userEvent.setup();
    api.delete.mockResolvedValue(undefined);
    renderWith(<TestLab agentId={AGENT_ID} skills={[]} canEdit />);

    await user.click(await screen.findByRole('button', { name: `Delete ${SCENARIO.name}` }));
    expect(api.delete).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Delete this scenario?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(api.delete).toHaveBeenCalledWith(`/ai/test-scenarios/${SCENARIO.id}`);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('offers a reader no run, edit, delete or sandbox — only a view', async () => {
    renderWith(<TestLab agentId={AGENT_ID} skills={[]} canEdit={false} />);

    expect(
      await screen.findByRole('button', { name: `View ${SCENARIO.name}` }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Run all active/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pre-publish run' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: `Delete ${SCENARIO.name}` }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Talk like a player' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New scenario' })).not.toBeInTheDocument();
  });

  it('says so when the scenarios cannot be read, instead of claiming there are none', async () => {
    api.get.mockImplementation((path: string) =>
      path.startsWith('/ai/test-scenarios?')
        ? Promise.reject(new Error('boom'))
        : path.startsWith('/ai/compliance-pack?')
          ? Promise.resolve(PACK)
          : Promise.resolve({ runs: [] }),
    );
    renderWith(<TestLab agentId={AGENT_ID} skills={[]} canEdit />);

    expect(await screen.findByText('Scenarios couldn’t be loaded')).toBeInTheDocument();
    expect(screen.queryByText('No scenarios yet')).not.toBeInTheDocument();
  });
});

describe('RunResults', () => {
  it('keeps the server’s order — "was passing → now failing" on top — and labels the judge as advice', async () => {
    const user = userEvent.setup();
    renderWith(<RunResults runId="run-1" onFinished={() => {}} onClose={() => {}} />);

    const list = await screen.findByRole('list', { name: 'Scenario results' });
    const rows = within(list).getAllByTestId('run-result');
    expect(rows.map((row) => row.querySelector('summary span')?.textContent)).toEqual([
      'Bonus question',
      'Papara yatırım geçmedi',
    ]);
    expect(within(rows[0]!).getByText('Was passing → now failing')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Compared with the previous published version’s last run — changes are listed first.',
      ),
    ).toBeInTheDocument();

    await user.click(within(rows[0]!).getByText('Bonus question'));
    expect(within(rows[0]!).getByText('Hard checks — 1 of 2 failed')).toBeInTheDocument();
    expect(
      within(rows[0]!).getByText(/expected \[\], got \["bonus"\] · turn 2/),
    ).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Judge’s suggestion')).toBeInTheDocument();
    expect(
      within(rows[0]!).getByText('Advice only — it never changes the result; the hard checks do.'),
    ).toBeInTheDocument();
    expect(
      within(rows[0]!).getByText('Score 2/5 — Offered a bonus to a self-excluded player.'),
    ).toBeInTheDocument();
    // Advice only: a failed scenario stays failed whatever the judge said.
    expect(within(rows[0]!.querySelector('summary')!).getByText('Failed')).toBeInTheDocument();

    await user.click(within(rows[1]!).getByText('Papara yatırım geçmedi'));
    expect(within(rows[1]!).getByText('Not assessed.')).toBeInTheDocument();
  });

  it('reads an open run again until it ends, then tells the lab once', async () => {
    let reads = 0;
    api.get.mockImplementation((path: string) => {
      if (path.endsWith('/results')) return Promise.resolve({ results: [], compared_run_id: null });
      reads += 1;
      return Promise.resolve(reads < 2 ? run({ status: 'running' }) : run());
    });
    const onFinished = vi.fn();
    renderWith(<RunResults runId="run-1" onFinished={onFinished} onClose={() => {}} />);

    expect(await screen.findByText('Running')).toBeInTheDocument();
    expect(await screen.findByText('Completed', {}, { timeout: 5_000 })).toBeInTheDocument();
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(screen.getByText('No earlier published run to compare with.')).toBeInTheDocument();
  });
});
