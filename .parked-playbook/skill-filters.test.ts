/**
 * The list contract, proven on the pure selection: each tab shows the right
 * subset (05.3), and search / type / status / owner each narrow it, while sort
 * orders it (05.4).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SKILL_QUERY,
  isFiltering,
  matchesTab,
  ownerOf,
  selectSkills,
  tabCounts,
  UNASSIGNED_OWNER,
  type SkillQuery,
} from './skill-filters.js';
import type { Skill } from './types.js';

function skill(overrides: Partial<Skill>): Skill {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    ai_agent_id: 'agent-a',
    name: 'Skill',
    kind: 'ai_agent',
    instruction: null,
    steps: [],
    active: true,
    runs_count: 0,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const fixtures: Skill[] = [
  skill({ id: 'live-ai', name: 'Where is my order', kind: 'ai_agent', active: true, runs_count: 12, updated_at: '2026-07-01T00:00:00.000Z', ai_agent_id: 'agent-a' }),
  skill({ id: 'draft-ai', name: 'Returns policy', kind: 'ai_agent', active: false, runs_count: 3, updated_at: '2026-07-10T00:00:00.000Z', ai_agent_id: 'agent-a' }),
  skill({ id: 'workspace', name: 'Escalation flow', kind: 'workspace', active: true, runs_count: 5, updated_at: '2026-06-01T00:00:00.000Z', ai_agent_id: null }),
  skill({ id: 'draft-unowned', name: 'Feedback ask', kind: 'ai_agent', active: false, runs_count: 0, updated_at: '2026-07-20T00:00:00.000Z', ai_agent_id: null }),
];

const query = (over: Partial<SkillQuery>): SkillQuery => ({ ...DEFAULT_SKILL_QUERY, ...over });
const ids = (skills: Skill[]): string[] => skills.map((s) => s.id);

describe('tabs (05.3)', () => {
  it('All shows everything', () => {
    expect(selectSkills(fixtures, query({ tab: 'all' }))).toHaveLength(4);
  });

  it('AI shows only ai_agent skills', () => {
    const result = selectSkills(fixtures, query({ tab: 'ai' }));
    expect(result.every((s) => s.kind === 'ai_agent')).toBe(true);
    expect(ids(result).sort()).toEqual(['draft-ai', 'draft-unowned', 'live-ai']);
  });

  it('Workspace shows only workspace skills', () => {
    expect(ids(selectSkills(fixtures, query({ tab: 'workspace' })))).toEqual(['workspace']);
  });

  it('Drafts shows only skills that are not live, of any kind', () => {
    const result = selectSkills(fixtures, query({ tab: 'drafts' }));
    expect(result.every((s) => !s.active)).toBe(true);
    expect(ids(result).sort()).toEqual(['draft-ai', 'draft-unowned']);
  });

  it('counts each tab from the full set', () => {
    expect(tabCounts(fixtures)).toEqual({ all: 4, ai: 3, workspace: 1, drafts: 2 });
  });

  it('matchesTab agrees with the drafts derivation', () => {
    expect(matchesTab(skill({ active: false }), 'drafts')).toBe(true);
    expect(matchesTab(skill({ active: true }), 'drafts')).toBe(false);
  });
});

describe('search + filters narrow (05.4)', () => {
  it('name search is case-insensitive and narrows', () => {
    expect(ids(selectSkills(fixtures, query({ search: 'RETURNS' })))).toEqual(['draft-ai']);
    expect(selectSkills(fixtures, query({ search: 'nonsense' }))).toHaveLength(0);
  });

  it('type filter narrows to a kind', () => {
    expect(ids(selectSkills(fixtures, query({ type: 'workspace' })))).toEqual(['workspace']);
  });

  it('status filter separates live from draft', () => {
    expect(selectSkills(fixtures, query({ status: 'live' })).every((s) => s.active)).toBe(true);
    expect(selectSkills(fixtures, query({ status: 'draft' })).every((s) => !s.active)).toBe(true);
  });

  it('owner filter narrows to one agent, and to the unassigned sentinel', () => {
    expect(ids(selectSkills(fixtures, query({ owner: 'agent-a' })).sort())).toEqual([
      'draft-ai',
      'live-ai',
    ]);
    expect(ids(selectSkills(fixtures, query({ owner: UNASSIGNED_OWNER })).sort())).toEqual([
      'draft-unowned',
      'workspace',
    ]);
  });

  it('filters compose — draft AI skills owned by agent-a', () => {
    const result = selectSkills(fixtures, query({ type: 'ai_agent', status: 'draft', owner: 'agent-a' }));
    expect(ids(result)).toEqual(['draft-ai']);
  });

  it('ownerOf falls back to the unassigned sentinel', () => {
    expect(ownerOf(skill({ ai_agent_id: null }))).toBe(UNASSIGNED_OWNER);
    expect(ownerOf(skill({ ai_agent_id: 'agent-x' }))).toBe('agent-x');
  });
});

describe('sort orders (05.4)', () => {
  it('recent puts the newest updated_at first', () => {
    expect(ids(selectSkills(fixtures, query({ sort: 'recent' })))[0]).toBe('draft-unowned');
  });

  it('name sorts A→Z', () => {
    expect(ids(selectSkills(fixtures, query({ sort: 'name' })))).toEqual([
      'workspace', // Escalation flow
      'draft-unowned', // Feedback ask
      'draft-ai', // Returns policy
      'live-ai', // Where is my order
    ]);
  });

  it('runs sorts by most runs first', () => {
    expect(ids(selectSkills(fixtures, query({ sort: 'runs' })))).toEqual([
      'live-ai', // 12
      'workspace', // 5
      'draft-ai', // 3
      'draft-unowned', // 0
    ]);
  });
});

describe('isFiltering', () => {
  it('is false for the default query and true once a control is set', () => {
    expect(isFiltering(DEFAULT_SKILL_QUERY)).toBe(false);
    expect(isFiltering(query({ search: 'x' }))).toBe(true);
    expect(isFiltering(query({ status: 'draft' }))).toBe(true);
    // The tab alone is not "filtering" — it is the view, with its own empty copy.
    expect(isFiltering(query({ tab: 'drafts' }))).toBe(false);
  });
});
