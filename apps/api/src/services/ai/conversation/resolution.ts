/**
 * The "resolved" decision (tm 303.4 · SiyahTuş analysis AI-09, owner decision
 * K9 — the vocabulary is `@siyahtus/types` `resolution.ts`).
 *
 * Whose criteria apply: the procedure's own `resolution_criteria`, else the
 * workspace's default (`ai_handoff_settings.resolution_criteria`, read into
 * the turn's `handoff` configuration), else the platform's — the player's
 * explicit yes, `player_confirmed()`.
 *
 * The decision, at a `resolve` step:
 *
 *   1. the criteria hold → `resolved`;
 *   2. they do not, it was not asked yet, and the player's yes would make them
 *      hold → `asked`: the AI asks "is it solved?" and waits on the step;
 *   3. otherwise → `unresolved`: a person takes over — the player said no, or
 *      what is missing is not the player's yes (a slot, an `ai` question the
 *      conversation answered no).
 *
 * Asked, and answered neither yes nor no (`not_confirmed`): the player went on
 * to something else. The engine lets the procedure go before it runs —
 * nothing claimed, nobody sent — and the message takes the decision order
 * (`conversation-engine.ts` `unconfirmedResolution`); the executor, reached
 * with it anyway, hands over rather than say nothing.
 *
 * "Would make them hold" is the same criteria evaluated once more with the
 * player's answer taken as yes — nothing else changes, so a criterion that
 * also needs a slot still empty is `unresolved` straight away, not asked.
 *
 * An answer that is not a `resolve` step — the knowledge path's — claims
 * nothing ({@link knowledgeResolution}): the AI did not ask, so there is no yes
 * to read.
 *
 * Pure: the criteria, the condition context and whether it was asked go in;
 * the record and its log lines come out — names, never values (ID-08).
 */
import {
  DEFAULT_RESOLUTION_CRITERIA,
  RESOLUTION_AI_KEY,
  type Cond,
  type Procedure,
  type ResolutionBasis,
  type ResolutionRecord,
} from '@siyahtus/types';
import { evaluateCondition, type ProcedureEvalContext } from './procedure/conditions.js';
import type { SkillRunLogEntry } from './turn.js';

/** The criteria a turn holds a `resolve` step to, and whose they are. */
export interface ResolutionCriteria {
  readonly criteria: Cond;
  readonly basis: ResolutionBasis;
}

/** The platform's: the player said yes to "is it solved?". */
export const PLATFORM_RESOLUTION: ResolutionCriteria = Object.freeze({
  criteria: DEFAULT_RESOLUTION_CRITERIA,
  basis: 'platform',
});

/** The procedure's own criteria, else the workspace's default, else the platform's. */
export function resolutionCriteriaFor(
  procedure: Pick<Procedure, 'resolution_criteria'> | null,
  workspace: Cond | null | undefined,
): ResolutionCriteria {
  if (procedure?.resolution_criteria) {
    return { criteria: procedure.resolution_criteria, basis: 'procedure' };
  }
  if (workspace) return { criteria: workspace, basis: 'workspace' };
  return PLATFORM_RESOLUTION;
}

/**
 * The procedure as the understanding call asks about it: with the criteria
 * that apply in its `resolution_criteria`, so an `ai` question in the
 * workspace's default is asked under {@link RESOLUTION_AI_KEY} as the
 * procedure's own would be.
 */
export function withResolutionCriteria(
  procedure: Procedure,
  resolution: ResolutionCriteria,
): Procedure {
  return procedure.resolution_criteria === resolution.criteria
    ? procedure
    : { ...procedure, resolution_criteria: resolution.criteria };
}

export interface ResolutionVerdict {
  readonly record: Omit<ResolutionRecord, 'outcome' | 'step_id'>;
  readonly log: SkillRunLogEntry[];
}

/**
 * Decide at a `resolve` step (see the file header). `asked`: the AI asked "is
 * it solved?" at this step on the turn before — only then is the player's
 * yes or no (`ctx.confirmation`) an answer to it.
 */
export function decideResolution(input: {
  resolution: ResolutionCriteria;
  ctx: ProcedureEvalContext;
  asked: boolean;
  /** The log lines' step. */
  at: string;
}): ResolutionVerdict {
  const { resolution, asked, at } = input;
  const confirmation = asked ? (input.ctx.confirmation ?? null) : null;
  const ctx: ProcedureEvalContext = { ...input.ctx, confirmation };
  const evaluation = evaluateCondition(resolution.criteria, ctx, RESOLUTION_AI_KEY);
  const log: SkillRunLogEntry[] = [...evaluation.log];
  const base = {
    basis: resolution.basis,
    result: evaluation.result,
    unknown: evaluation.unknown,
    confirmation,
  };
  const say = (detail: string) => log.push({ step: at, detail, ok: true });

  if (evaluation.holds) {
    say(`resolved — the ${resolution.basis} criteria hold`);
    return { record: { ...base, decision: 'resolved', reason: 'criteria_met' }, log };
  }
  if (!asked) {
    const withYes = evaluateCondition(
      resolution.criteria,
      { ...ctx, confirmation: 'yes' },
      RESOLUTION_AI_KEY,
    );
    if (withYes.holds) {
      say(`not resolved yet — the ${resolution.basis} criteria wait on the player's yes`);
      return { record: { ...base, decision: 'asked', reason: 'awaiting_confirmation' }, log };
    }
    say(`not resolved — the ${resolution.basis} criteria do not hold; a person takes over`);
    return { record: { ...base, decision: 'unresolved', reason: 'criteria_unmet' }, log };
  }
  const reason =
    confirmation === 'no'
      ? 'player_said_no'
      : confirmation === null
        ? 'not_confirmed'
        : 'criteria_unmet';
  say(
    reason === 'player_said_no'
      ? 'not resolved — the player said it is not solved; a person takes over'
      : reason === 'not_confirmed'
        ? 'not resolved — the player did not say it is solved; a person takes over'
        : `not resolved — the ${resolution.basis} criteria do not hold; a person takes over`,
  );
  return { record: { ...base, decision: 'unresolved', reason }, log };
}

/**
 * A knowledge answer's decision: the AI did not ask "is it solved?", so it
 * claims nothing unless the criteria hold without the player's word —
 * `not_claimed`, with what they wait on.
 */
export function knowledgeResolution(
  resolution: ResolutionCriteria,
  ctx: ProcedureEvalContext,
): ResolutionRecord {
  const { record } = decideResolution({ resolution, ctx, asked: false, at: 'knowledge' });
  if (record.decision === 'resolved') return record;
  return {
    ...record,
    decision: 'not_claimed',
    reason: record.decision === 'asked' ? 'awaiting_confirmation' : 'criteria_unmet',
  };
}
