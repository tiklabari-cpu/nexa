/**
 * A one-message skill's `transfer_to_team` steps, named by id (tm 307.1 ·
 * SiyahTuş analysis AI-12).
 *
 * The step held the team's name, so renaming a team silently broke every
 * skill that handed over to it. Every write of a skill's steps now passes
 * through here: a step naming a team by `group_id` must name one of this
 * workspace's teams (400 `transfer_to_team_unknown_team`) and gets the team's
 * current name beside it — the previous release, mid-rollout, still reads
 * the name; a step naming one by name only (the console's editor today, a
 * template, the instruction compiler) gets the id of the lowest-id team of
 * that name. A name no team has is kept as it is: the hand-over leaves such a
 * conversation where it is (`handoff-service.ts`), as it always has.
 *
 * Steps already stored were given their ids by
 * 20261020180100_skill_steps_group_id_backfill, by the same rule.
 */
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';

/** `steps` (already through `validateSteps`) with every team named by id and by its current name. */
export async function withStepTeamIds(tx: TenantClient, steps: unknown[]): Promise<unknown[]> {
  const transfers = steps.some((step) => isTransfer(step));
  if (!transfers) return steps;

  // A workspace has a handful of teams: read them once rather than per step.
  // Under RLS, so another workspace's team id is one this workspace lacks.
  const teams = await tx.group.findMany({
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });
  const byId = new Map(teams.map((team) => [team.id, team.name]));
  const byName = new Map<string, bigint>();
  for (const team of teams) if (!byName.has(team.name)) byName.set(team.name, team.id);

  return steps.map((step, index) => {
    if (!isTransfer(step)) return step;
    if (typeof step['group_id'] === 'number') {
      const name = byId.get(BigInt(step['group_id']));
      if (name === undefined) {
        throw ApiError.validation(
          `Step ${index + 1}: transfer_to_team names a team this workspace does not have.`,
          { reason: 'transfer_to_team_unknown_team', step: index + 1 },
        );
      }
      return { ...step, group: name };
    }
    const id = typeof step['group'] === 'string' ? byName.get(step['group']) : undefined;
    return id === undefined ? step : { ...step, group_id: Number(id) };
  });
}

function isTransfer(step: unknown): step is Record<string, unknown> {
  return (
    typeof step === 'object' &&
    step !== null &&
    (step as Record<string, unknown>)['type'] === 'transfer_to_team'
  );
}
