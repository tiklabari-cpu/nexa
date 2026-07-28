/**
 * The list's on-screen behaviour: a real `tablist` whose tabs each narrow the
 * rows to the right subset (05.3), and a search box that narrows them further
 * once the debounce settles (05.4). Small fixtures keep every row in the DOM, so
 * a missing row is a real absence rather than a windowed-out one.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SkillBrowser } from './SkillBrowser.js';
import type { Skill } from './types.js';

function skill(over: Partial<Skill>): Skill {
  return {
    id: 'id',
    ai_agent_id: 'agent-a',
    name: 'Skill',
    kind: 'ai_agent',
    instruction: null,
    steps: [],
    active: true,
    runs_count: 0,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const skills: Skill[] = [
  skill({ id: 'order', name: 'Where is my order', kind: 'ai_agent', active: true, steps: [{ type: 'summarize' }] }),
  skill({ id: 'returns', name: 'Returns policy', kind: 'ai_agent', active: false }),
  skill({ id: 'flow', name: 'Escalation flow', kind: 'workspace', active: true, ai_agent_id: null }),
];

function renderBrowser(overrides: Partial<Parameters<typeof SkillBrowser>[0]> = {}) {
  const onSelect = vi.fn();
  render(
    <SkillBrowser
      skills={skills}
      agents={[{ id: 'agent-a', name: 'Ada' }]}
      selectedId={null}
      onSelect={onSelect}
      canEdit
      onToggleActive={() => {}}
      togglePending={false}
      isLoading={false}
      {...overrides}
    />,
  );
  return { onSelect };
}

describe('SkillBrowser tabs (05.3)', () => {
  it('exposes a tablist with the four views', () => {
    renderBrowser();
    const tablist = screen.getByRole('tablist', { name: 'Skill views' });
    expect(within(tablist).getAllByRole('tab')).toHaveLength(4);
  });

  it('shows every skill under All', () => {
    renderBrowser();
    expect(screen.getByText('Where is my order')).toBeInTheDocument();
    expect(screen.getByText('Returns policy')).toBeInTheDocument();
    expect(screen.getByText('Escalation flow')).toBeInTheDocument();
  });

  it('AI narrows to ai_agent skills and marks the tab selected', async () => {
    const user = userEvent.setup();
    renderBrowser();

    const aiTab = screen.getByRole('tab', { name: /AI/ });
    await user.click(aiTab);

    expect(aiTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Where is my order')).toBeInTheDocument();
    expect(screen.getByText('Returns policy')).toBeInTheDocument();
    expect(screen.queryByText('Escalation flow')).not.toBeInTheDocument();
  });

  it('Drafts narrows to skills that are not live', async () => {
    const user = userEvent.setup();
    renderBrowser();

    await user.click(screen.getByRole('tab', { name: /Drafts/ }));

    expect(screen.getByText('Returns policy')).toBeInTheDocument();
    expect(screen.queryByText('Where is my order')).not.toBeInTheDocument();
    expect(screen.queryByText('Escalation flow')).not.toBeInTheDocument();
  });
});

describe('SkillBrowser controls (05.4)', () => {
  it('narrows the list by name search', async () => {
    const user = userEvent.setup();
    renderBrowser();

    await user.type(screen.getByRole('searchbox', { name: 'Search skills by name' }), 'order');

    await waitFor(() => {
      expect(screen.queryByText('Returns policy')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Where is my order')).toBeInTheDocument();
    expect(screen.queryByText('Escalation flow')).not.toBeInTheDocument();
  });

  it('narrows the list by status filter', async () => {
    const user = userEvent.setup();
    renderBrowser();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'draft');

    expect(screen.getByText('Returns policy')).toBeInTheDocument();
    expect(screen.queryByText('Where is my order')).not.toBeInTheDocument();
  });

  it('selects a skill when its row is clicked', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderBrowser();

    await user.click(screen.getByText('Where is my order'));
    expect(onSelect).toHaveBeenCalledWith('order');
  });

  it('shows a distinct empty state when filters exclude everything', async () => {
    const user = userEvent.setup();
    renderBrowser();

    await user.type(screen.getByRole('searchbox', { name: 'Search skills by name' }), 'zzzz');
    await waitFor(() => expect(screen.getByText('No skills match')).toBeInTheDocument());
  });
});
