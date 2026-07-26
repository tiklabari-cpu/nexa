/**
 * The step editor's reorder + required-parameter behaviour (FR-MOD-06.2.4).
 *
 * The negatives lead, because they are the point: a hand-over with no team named
 * must block the save and say so, not be stored and skipped in silence. Then the
 * keyboard reorder — the accessible alternative to drag (NFR-A11Y4) — must
 * actually change the order and announce it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import type { Skill, SkillStep } from './types.js';

const { api } = vi.hoisted(() => ({ api: { post: vi.fn(), patch: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { SkillEditor } = await import('./SkillEditor.js');

function makeSkill(steps: SkillStep[]): Skill {
  return {
    id: 'skill-1',
    ai_agent_id: 'agent-1',
    name: 'Order help',
    kind: 'ai_agent',
    instruction: 'Help with orders.',
    steps,
    active: false,
    runs_count: 0,
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function renderEditor(skill: Skill, canEdit = true): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SkillEditor skill={skill} canEdit={canEdit} onSaved={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.post.mockReset();
  api.patch.mockReset();
  api.patch.mockResolvedValue(makeSkill([]));
});

describe('SkillEditor — required transfer target', () => {
  it('blocks the save and shows an error when the hand-over team is cleared', async () => {
    const user = userEvent.setup();
    renderEditor(makeSkill([{ type: 'transfer_to_team', group: 'Support' }]));

    const team = screen.getByLabelText('Team');
    await user.clear(team);

    // Empty required parameter → named error + a save that refuses.
    expect(screen.getByText(/Choose a team to hand the conversation over to/)).toBeInTheDocument();
    expect(screen.getByText(/Fix 1 step before saving/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('re-enables the save once a team is named again', async () => {
    const user = userEvent.setup();
    renderEditor(makeSkill([{ type: 'transfer_to_team', group: 'Support' }]));

    const team = screen.getByLabelText('Team');
    await user.clear(team);
    await user.type(team, 'Billing');

    expect(screen.queryByText(/Fix 1 step before saving/)).not.toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeEnabled();

    await user.click(save);
    expect(api.patch).toHaveBeenCalledWith(
      '/skills/skill-1',
      expect.objectContaining({
        steps: [{ type: 'transfer_to_team', group: 'Billing' }],
      }),
    );
  });
});

describe('SkillEditor — keyboard reorder', () => {
  const steps: SkillStep[] = [
    { type: 'tag', tag: 'shipping' },
    { type: 'send_message', source: 'text', text: 'On it.' },
  ];

  it('moves a step up from the keyboard and announces it', async () => {
    const user = userEvent.setup();
    renderEditor(makeSkill(steps));

    const rowsBefore = screen.getAllByRole('listitem');
    expect(within(rowsBefore[0]!).getByText(/Tag the conversation/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Move step 2 up' }));

    // Order actually changed: the reply is now first.
    const rowsAfter = screen.getAllByRole('listitem');
    expect(within(rowsAfter[0]!).getByText(/Reply/)).toBeInTheDocument();

    // And the move was announced for a screen-reader user.
    expect(screen.getByText(/Moved .* to position 1 of 2/)).toBeInTheDocument();

    // Reordering is a change worth saving.
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('disables the up control on the first step and down on the last', () => {
    renderEditor(makeSkill(steps));
    expect(screen.getByRole('button', { name: 'Move step 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move step 2 down' })).toBeDisabled();
  });

  it('offers no reorder controls without edit permission', () => {
    renderEditor(makeSkill(steps), false);
    expect(screen.queryByRole('button', { name: 'Move step 1 down' })).not.toBeInTheDocument();
  });
});
