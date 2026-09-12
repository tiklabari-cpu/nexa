/**
 * List controls for the Playbook skill list — search by name, plus type /
 * status / agent / owner filters and a sort order (FR-MOD-05.4).
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
 * it.
 *
 * Two axes exist because the PRD's "owner" filter and the code's original one
 * were never the same thing (FR-MOD-05.4, this file's tracked gap until now):
 * "Agent" is the AI agent a skill runs under (`ai_agent_id`) — a skill with
 * none reads as Unassigned; "Owner" is the *human* account that created the
 * skill (`created_by_id`, resolved for display as `created_by_name` per
 * FR-MOD-05.5) — a skill with none was created by the system/seed, not a
 * person. Filtering by `created_by_name` instead of `created_by_id` would be
 * wrong: two accounts can share a name, and an account can be renamed. Both
 * axes narrow independently and compose (an AND, like every other control
 * here).
 */
import type { Skill } from './types.js';

export type SkillTypeFilter = 'all' | 'ai' | 'workspace';
export type SkillStatusFilter = 'all' | 'on' | 'off';
export type SkillSort = 'name-asc' | 'name-desc' | 'recent' | 'runs';

/** `all` = every agent, `none` = no agent (ai_agent_id null), otherwise an id. */
export type SkillAgentFilter = string;

/** `all` = every owner, `none` = no owner (created_by_id null), otherwise an id. */
export type SkillOwnerFilter = string;

export interface SkillControls {
  /** Free text, matched case-insensitively as a substring of the skill name. */
  query: string;
  type: SkillTypeFilter;
  status: SkillStatusFilter;
  agent: SkillAgentFilter;
  owner: SkillOwnerFilter;
  sort: SkillSort;
}

export const DEFAULT_SKILL_CONTROLS: SkillControls = {
  query: '',
  type: 'all',
  status: 'all',
  agent: 'all',
  owner: 'all',
  sort: 'name-asc',
};

/** The skill fields the controls read — every list item satisfies this. */
type SkillFacet = Pick<
  Skill,
  'name' | 'kind' | 'active' | 'ai_agent_id' | 'runs_count' | 'updated_at' | 'created_by_id'
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

  if (controls.agent !== 'all') {
    if (
      controls.agent === 'none' ? skill.ai_agent_id !== null : skill.ai_agent_id !== controls.agent
    )
      return false;
  }

  if (controls.owner !== 'all') {
    if (
      controls.owner === 'none'
        ? skill.created_by_id !== null
        : skill.created_by_id !== controls.owner
    )
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
  return skills
    .filter((skill) => skillMatchesControls(skill, controls))
    .sort(SORTERS[controls.sort]);
}

/** True when any narrowing filter is set (sort is an ordering, not a filter). */
export function hasActiveSkillFilters(controls: SkillControls): boolean {
  return (
    controls.query.trim() !== '' ||
    controls.type !== 'all' ||
    controls.status !== 'all' ||
    controls.agent !== 'all' ||
    controls.owner !== 'all'
  );
}

export interface SkillAgentOption {
  value: SkillAgentFilter;
  label: string;
}

/**
 * The agent-filter options actually present in a list: "All agents", then each
 * distinct owning agent in first-seen order, then "Unassigned" if any skill has
 * no agent. Building these from the list (not the agent roster) means the filter
 * only ever offers agents you can reach.
 */
export function skillAgentOptions(
  skills: readonly Pick<Skill, 'ai_agent_id'>[],
  nameFor: (agentId: string) => string | undefined,
): SkillAgentOption[] {
  const options: SkillAgentOption[] = [{ value: 'all', label: 'All agents' }];
  const seen = new Set<string>();
  let hasUnassigned = false;

  for (const skill of skills) {
    if (skill.ai_agent_id === null) {
      hasUnassigned = true;
      continue;
    }
    if (seen.has(skill.ai_agent_id)) continue;
    seen.add(skill.ai_agent_id);
    options.push({
      value: skill.ai_agent_id,
      label: nameFor(skill.ai_agent_id) ?? 'Unknown agent',
    });
  }

  if (hasUnassigned) options.push({ value: 'none', label: 'Unassigned' });
  return options;
}

export interface SkillOwnerOption {
  value: SkillOwnerFilter;
  label: string;
}

/**
 * The owner-filter options actually present in a list: "All owners", then each
 * distinct creator in first-seen order, then "System" if any skill has no
 * creator (seed data, or created before authorship was tracked). Unlike agent
 * names, the label comes straight off each skill row (`created_by_name` is
 * already server-resolved) rather than a separate roster lookup — but a row
 * can still carry an id with no name if the authoring account was deleted
 * after the skill was created, so that case falls back the same way.
 */
export function skillOwnerOptions(
  skills: readonly Pick<Skill, 'created_by_id' | 'created_by_name'>[],
): SkillOwnerOption[] {
  const options: SkillOwnerOption[] = [{ value: 'all', label: 'All owners' }];
  const seen = new Map<string, string>();
  let hasNone = false;

  for (const skill of skills) {
    if (skill.created_by_id === null) {
      hasNone = true;
      continue;
    }
    if (!seen.has(skill.created_by_id)) {
      seen.set(skill.created_by_id, skill.created_by_name ?? 'Unknown owner');
    }
  }

  for (const [value, label] of seen) options.push({ value, label });
  if (hasNone) options.push({ value: 'none', label: 'System' });
  return options;
}
