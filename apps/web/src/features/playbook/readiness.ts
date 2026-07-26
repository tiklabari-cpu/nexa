/**
 * Is the AI agent ready to be turned on? (FR-MOD-06.1)
 *
 * Turning an agent on with nothing to answer from and no skill to run makes it
 * look live while it does nothing — the hardest misconfiguration to notice,
 * because there is no error, just silence in front of a customer. So the page
 * refuses activation until the agent has *something* to do: at least one indexed
 * knowledge source to answer from, or at least one skill with steps to run.
 *
 * A pure function so the rule is unit-testable on its own and reads the same
 * everywhere it is quoted — the banner, the disabled toggle, its tooltip.
 */
import type { KnowledgeSource, Skill } from './types.js';

export interface Readiness {
  /** Safe to turn the agent on — it can answer or act on a message. */
  ready: boolean;
  /** There is indexed knowledge to answer from. */
  hasKnowledge: boolean;
  /** There is at least one skill with steps the engine could run. */
  hasSkill: boolean;
  /** Why it is not ready, or null when it is. Shown verbatim in the UI. */
  reason: string | null;
}

/** A source counts once it is actually indexed — an empty source answers nothing. */
function isIndexed(source: Pick<KnowledgeSource, 'chunk_count'>): boolean {
  return source.chunk_count > 0;
}

/** A skill can do something once it has at least one step, on or off. */
function hasSteps(skill: Pick<Skill, 'steps'>): boolean {
  return skill.steps.length > 0;
}

export function evaluateReadiness(
  sources: readonly Pick<KnowledgeSource, 'chunk_count'>[],
  skills: readonly Pick<Skill, 'steps'>[],
): Readiness {
  const hasKnowledge = sources.some(isIndexed);
  const hasSkill = skills.some(hasSteps);
  const ready = hasKnowledge || hasSkill;

  return {
    ready,
    hasKnowledge,
    hasSkill,
    reason: ready
      ? null
      : 'Add a knowledge source or a skill with steps before turning the AI on — with neither, it would answer nothing.',
  };
}
