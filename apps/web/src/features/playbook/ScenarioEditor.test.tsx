/**
 * Writing and editing a test scenario (tm 314.5 · AI-19): the synthetic-data
 * warning is always on screen, the form is held to the API's own validator
 * before Save, a hand-over's team and topic appear only with a hand-over, and
 * a refusal's `details.problems` lands under the field it names.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import type { TestScenario } from './ai-testing.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { ScenarioEditor } = await import('./ScenarioEditor.js');

const AGENT_ID = '22222222-2222-4222-8222-222222222222';
const SKILL_ID = '44444444-4444-4444-8444-444444444444';

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
  turns: ['Yatırımım geçmedi', 'Papara'],
  facts: {},
  tool_outputs: {},
  expectations: { outcome: 'handoff', max_turns: 6, team_id: 4 },
  active: true,
  origin: 'manual',
  origin_ref: null,
  created_by: null,
  created_at: '2026-10-18T10:00:00.000Z',
  updated_at: '2026-10-18T10:00:00.000Z',
};

function renderEditor(scenarioId: string | null, canEdit = true) {
  const onSaved = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ScenarioEditor
        agentId={AGENT_ID}
        scenarioId={scenarioId}
        skills={[{ id: SKILL_ID, name: 'Yatırım geçmedi' }]}
        canEdit={canEdit}
        onClose={() => {}}
        onSaved={onSaved}
      />
    </QueryClientProvider>,
  );
  return { onSaved };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation((path: string) => {
    if (path === '/groups') return Promise.resolve({ items: [{ id: 4, name: 'Finans' }] });
    if (path === `/ai/test-scenarios/${SCENARIO.id}`) return Promise.resolve(SCENARIO);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

describe('ScenarioEditor', () => {
  it('writes a new scripted scenario with its expectations', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue(SCENARIO);
    const { onSaved } = renderEditor(null);

    expect(screen.getByRole('note')).toHaveTextContent('Use made-up data only.');
    await user.type(screen.getByLabelText('Name'), 'Papara yatırım geçmedi');
    await user.type(screen.getByLabelText('Player message 1'), 'Yatırımım geçmedi');
    await user.click(screen.getByRole('button', { name: 'Add a message' }));
    await user.type(screen.getByLabelText('Player message 2'), 'Papara');
    expect(screen.queryByLabelText('Hand over to')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Must end'), 'handoff');
    await user.selectOptions(await screen.findByLabelText('Hand over to'), '4');
    await user.selectOptions(screen.getByLabelText('Hand-over topic'), 'finance');
    await user.selectOptions(screen.getByLabelText('Procedure the AI must pick'), SKILL_ID);
    await user.type(screen.getByLabelText('Information it must collect'), 'yontem{Enter}dekont');
    await user.click(
      within(screen.getByRole('group', { name: 'Flags it must raise' })).getByRole('checkbox', {
        name: 'Self-exclusion request',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Save scenario' }));

    expect(api.post).toHaveBeenCalledWith('/ai/test-scenarios', {
      ai_agent_id: AGENT_ID,
      name: 'Papara yatırım geçmedi',
      mode: 'scripted',
      persona: 'normal',
      language: 'en',
      simulated_now: null,
      goal: null,
      turns: ['Yatırımım geçmedi', 'Papara'],
      facts: {},
      tool_outputs: {},
      expectations: {
        outcome: 'handoff',
        max_turns: 12,
        team_id: 4,
        topic: 'finance',
        procedure_id: SKILL_ID,
        required_slots: ['yontem', 'dekont'],
        must_flags: ['self_exclusion_request'],
      },
      active: true,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SCENARIO));
  });

  it('refuses what the API would refuse without asking it', async () => {
    const user = userEvent.setup();
    renderEditor(null);

    await user.click(screen.getByRole('button', { name: 'Save scenario' }));

    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Fix the marked fields (2).');
    expect(screen.getAllByText('Required.')).toHaveLength(2);
  });

  it('opens a stored scenario, saves the change and shows a refusal under its field', async () => {
    const user = userEvent.setup();
    api.patch.mockRejectedValueOnce(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'refused',
        requestId: 'r',
        details: { problems: [{ field: 'turns[1]', code: 'too_long' }] },
      }),
    );
    renderEditor(SCENARIO.id);

    const name = await screen.findByLabelText('Name');
    expect(name).toHaveValue('Papara yatırım geçmedi');
    await user.clear(name);
    await user.type(name, 'Papara (düzeltildi)');
    await user.click(screen.getByRole('button', { name: 'Save scenario' }));

    expect(api.patch).toHaveBeenCalledWith(
      `/ai/test-scenarios/${SCENARIO.id}`,
      expect.objectContaining({ name: 'Papara (düzeltildi)', turns: SCENARIO.turns }),
    );
    expect(await screen.findByText('Too long.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Fix the marked fields (1).');
  });

  it('shows a reader the scenario with every field locked and no Save', async () => {
    renderEditor(SCENARIO.id, false);

    expect(await screen.findByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('Player message 1')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save scenario' })).not.toBeInTheDocument();
  });
});
