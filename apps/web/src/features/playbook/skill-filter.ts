/**
 * List controls for the Playbook skill list — search by name, plus type /
 * status / owner filters and a sort order (FR-MOD-05.4).
 *
 * Kept as pure functions over a plain skill list so the narrowing is provable
 * without a DOM: the same input and controls always yield the same subset in
 * the same order, and the input is never mutated. The page layers these on top
 * of the tab split (see skill-tabs.ts) — the tab is the coarse cut, these are
 * the fine one.
 *
 * "Type" here is the skill's kind alone (AI vs Workspace), independent of
 * whether it is on. That is what separates it from the tabs, where an off skill
 * is a Draft whatever its kind: here you can ask for "Workspace + Off" and get
 * it. "Owner" is the AI agent a skill belongs to (its ai_agent_id); a skill
 * with none reads as Unassigned. (The skill row carries no human creator, so
 * the owning agent is the only ownership the list can honestly filter on.)
 */
import type { Skill } from './types.js';

export type SkillTypeFilter = 'all' | 'ai' | 'workspace';
export type SkillStatusFilter = 'all' | 'on' | 'off';
export type SkillSort = 'name-asc' | 'name-desc' | 'recent' | 'runs';

/** `all` = every owner, `none` = no owner (ai_agent_id null), otherwise an id. */
export type SkillOwnerFilter = string;

export interface SkillControls {
  /** Free text, matched case-insensitively as a substring of the skill name. */
  query: string;
  type: SkillTypeFilter;
  status: SkillStatusFilter;
  owner: SkillOwnerFilter;
  sort: SkillSort;
}

export const DEFAULT_SKILL_CONTROLS: SkillControls = {
  query: '',
  type: 'all',
  status: 'all',
  owner: 'all',
  sort: 'name-asc',
};

/** The skill fields the controls read — every list item satisfies this. */
type SkillFacet = Pick<
  Skill,
  'name' | 'kind' | 'active' | 'ai_agent_id' | 'runs_count' | 'updated_at'
>;

/** Whether one skill passes all of the active filters (sort plays no part). */
export function skillMatchesControls(skill: SkillFacet, controls: SkillControls): boolean {
  const query = controls.query.trim().toLowerCase();
  if (query && !skill.name.toLowerCase().includes(query)) return false;

  if (controls.type !== 'all') {
    const isAi = skill.kind === 'ai_agent';
    if (controls.type === 'ai' ? !isAi : isAi) return false;
  }

  if (controls.status !== 'all') {
    if (controls.status === 'on' ? !skill.active : skill.active) return false;
  }

  if (controls.owner !== 'all') {
    if (controls.owner === 'none' ? skill.ai_agent_id !== null : skill.ai_agent_id !== controls.owner)
      return false;
  }

  return true;
}

// updated_at is an ISO 8601 string, which sorts lexically the same as it sorts
// chronologically — so a plain string compare gives newest-first.
const SORTERS: Record<SkillSort, (a: SkillFacet, b: SkillFacet) => number> = {
  'name-asc': (a, b) => a.name.localeCompare(b.name),
  'name-desc': (a, b) => b.name.localeCompare(a.name),
  recent: (a, b) => b.updated_at.localeCompare(a.updated_at),
  runs: (a, b) => b.runs_count - a.runs_count,
};

/**
 * Filter then sort. Returns a new array (Array.prototype.sort is stable in
 * modern engines, so equal keys keep their incoming order), leaving the input
 * untouched.
 */
export function applySkillControls<T extends SkillFacet>(
  skills: readonly T[],
  controls: SkillControls,
): T[] {
  return skills.filter((skill) => skillMatchesControls(skill, controls)).sort(SORTERS[controls.sort]);
}

/** True when any narrowing filter is set (sort is an ordering, not a filter). */
export function hasActiveSkillFilters(controls: SkillControls): boolean {
  return (
    controls.query.trim() !== '' ||
    controls.type !== 'all' ||
    controls.status !== 'all' ||
    controls.owner !== 'all'
  );
}

export interface SkillOwnerOption {
  value: SkillOwnerFilter;
  label: string;
}

/**
 * The owner-filter options actually present in a list: "All owners", then each
 * distinct owning agent in first-seen order, then "Unassigned" if any skill has
 * no agent. Building these from the list (not the agent roster) means the filter
 * only ever offers owners you can reach.
 */
export function skillOwnerOptions(
  skills: readonly Pick<Skill, 'ai_agent_id'>[],
  nameFor: (agentId: string) => string | undefined,
): SkillOwnerOption[] {
  const options: SkillOwnerOption[] = [{ value: 'all', label: 'All owners' }];
  const seen = new Set<string>();
  let hasUnassigned = false;

  for (const skill of skills) {
    if (skill.ai_agent_id === null) {
      hasUnassigned = true;
      continue;
    }
    if (seen.has(skill.ai_agent_id)) continue;
    seen.add(skill.ai_agent_id);
    options.push({ value: skill.ai_agent_id, label: nameFor(skill.ai_agent_id) ?? 'Unknown agent' });
  }

  if (hasUnassigned) options.push({ value: 'none', label: 'Unassigned' });
  return options;
}
