/**
 * Is the AI agent ready to be turned on? (FR-MOD-06.1, PRD KK4)
 *
 * PRD KK4: a warning is shown when knowledge is empty OR there is no active
 * skill — so readiness requires BOTH: at least one indexed knowledge source
 * to answer from, AND at least one *active* skill with steps to run. An
 * agent with only one of the two would turn on looking live while it can
 * only half-do its job — the hardest misconfiguration to notice, because
 * there is no error, just a gap in front of a customer.
 *
 * A pure function so the rule is unit-testable on its own and reads the same
 * everywhere it is quoted — the banner, the disabled toggle, its tooltip.
 */
import { skillStepCount } from './procedure-authoring.js';
import type { KnowledgeSource, Skill } from './types.js';

type RunnableSkill = Pick<Skill, 'steps' | 'active' | 'mode' | 'procedure'>;

export interface Readiness {
  /** Safe to turn the agent on — it can answer or act on a message. */
  ready: boolean;
  /** There is indexed knowledge to answer from. */
  hasKnowledge: boolean;
  /** There is at least one active skill with steps the engine could run. */
  hasSkill: boolean;
  /** Why it is not ready, or null when it is. Shown verbatim in the UI. */
  reason: string | null;
}

/** A source counts once it is actually indexed — an empty source answers nothing. */
function isIndexed(source: Pick<KnowledgeSource, 'chunk_count'>): boolean {
  return source.chunk_count > 0;
}

/**
 * A skill can do something once it has at least one step and is active — a
 * procedure's steps live in its definition, not in `steps` (AI-03).
 */
function isRunnable(skill: RunnableSkill): boolean {
  return skill.active && skillStepCount(skill) > 0;
}

export function evaluateReadiness(
  sources: readonly Pick<KnowledgeSource, 'chunk_count'>[],
  skills: readonly RunnableSkill[],
): Readiness {
  const hasKnowledge = sources.some(isIndexed);
  const hasSkill = skills.some(isRunnable);
  const ready = hasKnowledge && hasSkill;

  return {
    ready,
    hasKnowledge,
    hasSkill,
    reason: ready
      ? null
      : 'Add a knowledge source and an active skill with steps before turning the AI on — with either missing, it would leave part of the job undone.',
  };
}
