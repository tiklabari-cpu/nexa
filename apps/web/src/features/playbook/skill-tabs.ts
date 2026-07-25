/**
 * Which tab a skill belongs to, and how to slice the list by tab.
 *
 * The rule is a clean partition — every skill lands in exactly one tab, so
 * `All = AI ∪ Workspace ∪ Drafts` with no overlaps and nothing lost. That
 * property is what the list can be trusted on: switching tabs never hides a
 * skill from every view at once.
 *
 * A skill that is not on is a Draft, whatever its kind. It was created inactive
 * (the backend never mints a live skill) and cannot answer a customer until it
 * is turned on, so it reads as unfinished — which is exactly what a draft is.
 * Once on, it is an AI skill (kind `ai_agent`, the only kind the engine runs)
 * or a Workspace automation (any other kind — the workflow paradigm kept in the
 * schema per ADR-14 but not authored in this UI).
 */
import type { Skill } from './types.js';

export type SkillTab = 'all' | 'ai' | 'workspace' | 'drafts';

/** The three concrete buckets a skill can fall into (everything but `all`). */
export type SkillBucket = Exclude<SkillTab, 'all'>;

type SkillFacet = Pick<Skill, 'active' | 'kind'>;

/** The single bucket a skill belongs to. Inactive wins: an off skill is a draft. */
export function classifySkill(skill: SkillFacet): SkillBucket {
  if (!skill.active) return 'drafts';
  return skill.kind === 'ai_agent' ? 'ai' : 'workspace';
}

/** The subset shown under a tab. `all` passes everything through unchanged. */
export function filterSkillsByTab<T extends SkillFacet>(skills: readonly T[], tab: SkillTab): T[] {
  if (tab === 'all') return [...skills];
  return skills.filter((skill) => classifySkill(skill) === tab);
}

/** How many skills sit under each tab, for the counts on the tab labels. */
export function countSkillsByTab(skills: readonly SkillFacet[]): Record<SkillTab, number> {
  const counts: Record<SkillTab, number> = { all: skills.length, ai: 0, workspace: 0, drafts: 0 };
  for (const skill of skills) counts[classifySkill(skill)] += 1;
  return counts;
}
