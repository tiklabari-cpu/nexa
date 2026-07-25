/**
 * The tab split is a partition: every skill lands in exactly one of AI /
 * Workspace / Drafts, and All is their union. These tests pin both the
 * per-skill rule and that invariant, because a wrong split would silently hide
 * a skill from every tab at once.
 */
import { describe, expect, it } from 'vitest';
import type { Skill } from './types.js';
import { classifySkill, countSkillsByTab, filterSkillsByTab, type SkillTab } from './skill-tabs.js';

function makeSkill(overrides: Partial<Skill>): Skill {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    ai_agent_id: null,
    name: 'Skill',
    kind: 'ai_agent',
    instruction: null,
    steps: [],
    active: false,
    runs_count: 0,
    updated_at: '2026-07-26T00:00:00.000Z',
    ...overrides,
  };
}

const activeAi = makeSkill({ id: 'ai-1', kind: 'ai_agent', active: true });
const activeAi2 = makeSkill({ id: 'ai-2', kind: 'ai_agent', active: true });
const activeWorkspace = makeSkill({ id: 'ws-1', kind: 'workflow', active: true });
const draftAi = makeSkill({ id: 'draft-1', kind: 'ai_agent', active: false });
const draftWorkspace = makeSkill({ id: 'draft-2', kind: 'workflow', active: false });

const all = [activeAi, activeAi2, activeWorkspace, draftAi, draftWorkspace];

describe('classifySkill', () => {
  it('puts an active AI-kind skill in the AI bucket', () => {
    expect(classifySkill(activeAi)).toBe('ai');
  });

  it('puts an active non-AI-kind skill in the Workspace bucket', () => {
    expect(classifySkill(activeWorkspace)).toBe('workspace');
  });

  it('puts any inactive skill in Drafts, whatever its kind', () => {
    expect(classifySkill(draftAi)).toBe('drafts');
    expect(classifySkill(draftWorkspace)).toBe('drafts');
  });
});

describe('filterSkillsByTab', () => {
  it('returns every skill under the All tab', () => {
    expect(filterSkillsByTab(all, 'all')).toEqual(all);
  });

  it('returns only active AI skills under the AI tab', () => {
    expect(filterSkillsByTab(all, 'ai')).toEqual([activeAi, activeAi2]);
  });

  it('returns only active workspace skills under the Workspace tab', () => {
    expect(filterSkillsByTab(all, 'workspace')).toEqual([activeWorkspace]);
  });

  it('returns only inactive skills under the Drafts tab', () => {
    expect(filterSkillsByTab(all, 'drafts')).toEqual([draftAi, draftWorkspace]);
  });

  it('preserves the source order within a tab', () => {
    const reordered = [draftWorkspace, activeAi2, draftAi, activeAi];
    expect(filterSkillsByTab(reordered, 'drafts')).toEqual([draftWorkspace, draftAi]);
  });

  it('does not mutate the input array', () => {
    const input = [...all];
    filterSkillsByTab(input, 'ai');
    expect(input).toEqual(all);
  });
});

describe('the tabs form a partition', () => {
  it('AI ∪ Workspace ∪ Drafts equals All, with no overlaps', () => {
    const buckets: Exclude<SkillTab, 'all'>[] = ['ai', 'workspace', 'drafts'];
    const seen = new Set<string>();
    let total = 0;
    for (const tab of buckets) {
      for (const skill of filterSkillsByTab(all, tab)) {
        expect(seen.has(skill.id)).toBe(false); // no skill in two tabs
        seen.add(skill.id);
        total += 1;
      }
    }
    expect(total).toBe(all.length); // nothing lost
    expect(seen).toEqual(new Set(all.map((s) => s.id)));
  });
});

describe('countSkillsByTab', () => {
  it('counts each bucket and totals All', () => {
    expect(countSkillsByTab(all)).toEqual({ all: 5, ai: 2, workspace: 1, drafts: 2 });
  });

  it('is all zeros for an empty list', () => {
    expect(countSkillsByTab([])).toEqual({ all: 0, ai: 0, workspace: 0, drafts: 0 });
  });
});
