/**
 * Skill-list views and controls (FR-MOD-05.3 / 05.4).
 *
 * The list has to answer two different questions at once: "show me my AI skills
 * vs. my drafts" (the tabs) and "find the one called X, owned by Y, that is off"
 * (search + filters). Keeping the whole selection as one pure function means the
 * order it applies in is fixed and testable, and the on-screen list is only ever
 * a render of `selectSkills` — there is no second, drifting copy of the rules in
 * the component.
 *
 * Drafts are derived, not stored: a skill is a draft while it is not yet live
 * (`active === false`). That is the only "not published" signal the model
 * carries, and it is the one the tab and the status filter both read.
 */
import type { Skill } from './types.js';

export type SkillTab = 'all' | 'ai' | 'workspace' | 'drafts';
export type SkillTypeFilter = 'any' | 'ai_agent' | 'workspace';
export type SkillStatusFilter = 'any' | 'live' | 'draft';
export type SkillSort = 'recent' | 'name' | 'runs';

/** The owner value standing in for a skill with no AI agent attached. */
export const UNASSIGNED_OWNER = 'unassigned';

export interface SkillQuery {
  tab: SkillTab;
  /** Name search — the caller passes the already-debounced value. */
  search: string;
  type: SkillTypeFilter;
  status: SkillStatusFilter;
  /** `'any'`, an `ai_agent_id`, or `UNASSIGNED_OWNER`. */
  owner: string;
  sort: SkillSort;
}

export const DEFAULT_SKILL_QUERY: SkillQuery = {
  tab: 'all',
  search: '',
  type: 'any',
  status: 'any',
  owner: 'any',
  sort: 'recent',
};

export const SKILL_TABS: { id: SkillTab; label: string; icon?: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ai', label: 'AI', icon: '✦' },
  { id: 'workspace', label: 'Workspace', icon: '⚡' },
  { id: 'drafts', label: 'Drafts' },
];

/** True when the skill belongs on the given tab. */
export function matchesTab(skill: Skill, tab: SkillTab): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'ai':
      return skill.kind === 'ai_agent';
    case 'workspace':
      return skill.kind === 'workspace';
    case 'drafts':
      return !skill.active;
  }
}

/** How many skills each tab holds — for the count badges, ignoring search/filters. */
export function tabCounts(skills: Skill[]): Record<SkillTab, number> {
  const counts: Record<SkillTab, number> = { all: 0, ai: 0, workspace: 0, drafts: 0 };
  for (const skill of skills) {
    for (const tab of ['all', 'ai', 'workspace', 'drafts'] as const) {
      if (matchesTab(skill, tab)) counts[tab] += 1;
    }
  }
  return counts;
}

/** The owner key for a skill: its AI agent id, or the unassigned sentinel. */
export function ownerOf(skill: Skill): string {
  return skill.ai_agent_id ?? UNASSIGNED_OWNER;
}

function matchesType(skill: Skill, type: SkillTypeFilter): boolean {
  return type === 'any' || skill.kind === type;
}

function matchesStatus(skill: Skill, status: SkillStatusFilter): boolean {
  if (status === 'any') return true;
  return status === 'live' ? skill.active : !skill.active;
}

function matchesOwner(skill: Skill, owner: string): boolean {
  return owner === 'any' || ownerOf(skill) === owner;
}

function matchesSearch(skill: Skill, search: string): boolean {
  const needle = search.trim().toLowerCase();
  return needle === '' || skill.name.toLowerCase().includes(needle);
}

function compare(a: Skill, b: Skill, sort: SkillSort): number {
  switch (sort) {
    case 'name':
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    case 'runs':
      return b.runs_count - a.runs_count;
    case 'recent':
      // ISO-8601 strings sort lexicographically by instant; newest first.
      return b.updated_at.localeCompare(a.updated_at);
  }
}

/**
 * The one selection: tab, then each filter, then the search, then the sort.
 * Returns a new array; the input is never mutated.
 */
export function selectSkills(skills: Skill[], query: SkillQuery): Skill[] {
  return skills
    .filter(
      (skill) =>
        matchesTab(skill, query.tab) &&
        matchesType(skill, query.type) &&
        matchesStatus(skill, query.status) &&
        matchesOwner(skill, query.owner) &&
        matchesSearch(skill, query.search),
    )
    .sort((a, b) => compare(a, b, query.sort));
}

/** True when any filter or search is narrowing the list (tab aside). */
export function isFiltering(query: SkillQuery): boolean {
  return (
    query.search.trim() !== '' ||
    query.type !== 'any' ||
    query.status !== 'any' ||
    query.owner !== 'any'
  );
}
