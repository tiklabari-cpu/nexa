/**
 * The controls must *narrow* — every filter can only drop rows, never add or
 * reorder them into existence — and sorting must be a pure reordering that
 * leaves the input alone. These tests pin each filter axis on its own and in
 * combination, plus the owner-option derivation the select is built from.
 */
import { describe, expect, it } from 'vitest';
import type { Skill } from './types.js';
import {
  DEFAULT_SKILL_CONTROLS,
  applySkillControls,
  hasActiveSkillFilters,
  skillMatchesControls,
  skillOwnerOptions,
  type SkillControls,
} from './skill-filter.js';

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

function controls(overrides: Partial<SkillControls> = {}): SkillControls {
  return { ...DEFAULT_SKILL_CONTROLS, ...overrides };
}

const refunds = makeSkill({ id: 'a', name: 'Refunds', kind: 'ai_agent', active: true, ai_agent_id: 'ada', runs_count: 9, updated_at: '2026-07-20T00:00:00.000Z' }); // prettier-ignore
const shipping = makeSkill({ id: 'b', name: 'Where is my order', kind: 'ai_agent', active: false, ai_agent_id: 'ada', runs_count: 2, updated_at: '2026-07-25T00:00:00.000Z' }); // prettier-ignore
const escalate = makeSkill({ id: 'c', name: 'Escalate to billing', kind: 'workflow', active: true, ai_agent_id: null, runs_count: 40, updated_at: '2026-07-10T00:00:00.000Z' }); // prettier-ignore
const greeting = makeSkill({ id: 'd', name: 'Greeting', kind: 'workflow', active: false, ai_agent_id: 'nova', runs_count: 0, updated_at: '2026-07-24T00:00:00.000Z' }); // prettier-ignore

const all = [refunds, shipping, escalate, greeting];
const ids = (skills: Skill[]) => skills.map((s) => s.id);

// Results come back in the default name-asc order (applySkillControls always
// sorts), so expected ids below are alphabetical by name, not source order:
//   Escalate to billing (c) · Greeting (d) · Refunds (a) · Where is my order (b)
describe('search by name', () => {
  it('keeps only skills whose name contains the query, case-insensitively', () => {
    expect(ids(applySkillControls(all, controls({ query: 'ing' })))).toEqual(['c', 'd']); // billING / GreetING
    expect(ids(applySkillControls(all, controls({ query: 'REFUND' })))).toEqual(['a']);
  });

  it('ignores surrounding whitespace and an empty query matches everything', () => {
    expect(ids(applySkillControls(all, controls({ query: '   ' })))).toEqual(['c', 'd', 'a', 'b']);
    expect(ids(applySkillControls(all, controls({ query: '  refunds  ' })))).toEqual(['a']);
  });

  it('narrows to nothing when no name matches', () => {
    expect(applySkillControls(all, controls({ query: 'nope' }))).toEqual([]);
  });
});

describe('type / status / owner filters', () => {
  it('type filters by kind alone, regardless of on/off', () => {
    expect(ids(applySkillControls(all, controls({ type: 'ai' })))).toEqual(['a', 'b']);
    expect(ids(applySkillControls(all, controls({ type: 'workspace' })))).toEqual(['c', 'd']);
  });

  it('status filters by active flag', () => {
    expect(ids(applySkillControls(all, controls({ status: 'on' })))).toEqual(['c', 'a']);
    expect(ids(applySkillControls(all, controls({ status: 'off' })))).toEqual(['d', 'b']);
  });

  it('owner filters by owning agent, with "none" for unassigned', () => {
    expect(ids(applySkillControls(all, controls({ owner: 'ada' })))).toEqual(['a', 'b']);
    expect(ids(applySkillControls(all, controls({ owner: 'nova' })))).toEqual(['d']);
    expect(ids(applySkillControls(all, controls({ owner: 'none' })))).toEqual(['c']);
  });

  it('composes filters as an intersection', () => {
    // AI + Off + owned by Ada → only "Where is my order".
    expect(
      ids(applySkillControls(all, controls({ type: 'ai', status: 'off', owner: 'ada' }))),
    ).toEqual(['b']);
  });
});

describe('sort', () => {
  it('orders by name A→Z and Z→A', () => {
    expect(ids(applySkillControls(all, controls({ sort: 'name-asc' })))).toEqual(['c', 'd', 'a', 'b']);
    expect(ids(applySkillControls(all, controls({ sort: 'name-desc' })))).toEqual(['b', 'a', 'd', 'c']);
  });

  it('orders by most recently updated and by most runs', () => {
    expect(ids(applySkillControls(all, controls({ sort: 'recent' })))).toEqual(['b', 'd', 'a', 'c']);
    expect(ids(applySkillControls(all, controls({ sort: 'runs' })))).toEqual(['c', 'a', 'b', 'd']);
  });

  it('does not mutate the input array', () => {
    const input = [...all];
    applySkillControls(input, controls({ sort: 'runs' }));
    expect(input).toEqual(all);
  });
});

describe('skillMatchesControls', () => {
  it('is the per-skill predicate behind the list filter', () => {
    expect(skillMatchesControls(refunds, controls({ query: 'ref', status: 'on' }))).toBe(true);
    expect(skillMatchesControls(refunds, controls({ status: 'off' }))).toBe(false);
  });
});

describe('hasActiveSkillFilters', () => {
  it('is false for the defaults and for a sort-only change', () => {
    expect(hasActiveSkillFilters(DEFAULT_SKILL_CONTROLS)).toBe(false);
    expect(hasActiveSkillFilters(controls({ sort: 'runs' }))).toBe(false);
  });

  it('is true once any narrowing filter is set', () => {
    expect(hasActiveSkillFilters(controls({ query: 'x' }))).toBe(true);
    expect(hasActiveSkillFilters(controls({ type: 'ai' }))).toBe(true);
    expect(hasActiveSkillFilters(controls({ status: 'off' }))).toBe(true);
    expect(hasActiveSkillFilters(controls({ owner: 'ada' }))).toBe(true);
  });
});

describe('skillOwnerOptions', () => {
  const nameFor = (id: string) => ({ ada: 'Ada', nova: 'Nova' })[id];

  it('lists All, then each distinct owner in first-seen order, then Unassigned', () => {
    expect(skillOwnerOptions(all, nameFor)).toEqual([
      { value: 'all', label: 'All owners' },
      { value: 'ada', label: 'Ada' },
      { value: 'nova', label: 'Nova' },
      { value: 'none', label: 'Unassigned' },
    ]);
  });

  it('omits Unassigned when every skill has an owner', () => {
    expect(skillOwnerOptions([refunds, shipping], nameFor)).toEqual([
      { value: 'all', label: 'All owners' },
      { value: 'ada', label: 'Ada' },
    ]);
  });

  it('falls back to a placeholder when an owner id has no known name', () => {
    expect(skillOwnerOptions([makeSkill({ ai_agent_id: 'ghost' })], () => undefined)).toEqual([
      { value: 'all', label: 'All owners' },
      { value: 'ghost', label: 'Unknown agent' },
    ]);
  });
});
