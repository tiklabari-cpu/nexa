/**
 * The regression report (tm 314.3 · SiyahTuş analysis AI-19 §5): a run's
 * results against the same scenarios in the previous published version's
 * last run.
 *
 *   - **What it compares with.** The agent's last `completed` run against the
 *     published configuration that was queued before this one — for a draft
 *     run, what is live now; for a published run, the one before it. Until
 *     configuration versions exist (tm 316) the published configuration is
 *     the live tables, so "the previous published version's last run" is the
 *     last published run. A run that failed (the test allowance, a server
 *     error) has only some of its results and is not a baseline.
 *   - **How results pair.** By `scenario_key`: a scenario's id, or a
 *     compliance-pack key (`compliance:G<n>:<lang>`) — a deleted scenario's
 *     results keep it, so they still pair.
 *   - **What it says** (`AI_TEST_REGRESSIONS`, most urgent first): passed and
 *     no longer passes (`newly_failing` — "geçiyordu → kalıyor"; an errored
 *     result no longer passes either); ended another way (`outcome_changed`);
 *     handed over to another team (`team_changed`); failed and passes now
 *     (`newly_passing`). An errored result's ending is where it stopped, not
 *     how it ended, so it is not compared for outcome or team.
 *   - **The order.** Newly failing first, then changed outcome or team, then
 *     the rest as before: failed, errored, passed — each in play order.
 *
 * Read when the results are, not stored: a result never changes once
 * written (only the judge's advice is added to it), so the report is the same
 * whenever it is read.
 */
import type { AiTestRegression, AiTestResultStatus } from '@siyahtus/types';
import type { TenantClient } from '../../../lib/tenant.js';

/** What a result is compared by. */
export interface ComparedResult {
  readonly scenarioKey: string;
  readonly status: string;
  readonly outcome: string | null;
  readonly handoffTeamId: bigint | number | null;
}

/** The run a run's results are compared with, or null — none. */
export async function comparedRunOf(
  tx: TenantClient,
  run: { id: string; aiAgentId: string; createdAt: Date },
): Promise<string | null> {
  const earlier = await tx.aiTestRun.findFirst({
    where: {
      aiAgentId: run.aiAgentId,
      configTarget: 'published',
      status: 'completed',
      id: { not: run.id },
      createdAt: { lte: run.createdAt },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  return earlier?.id ?? null;
}

function teamOf(result: ComparedResult): string | null {
  return result.handoffTeamId === null ? null : String(result.handoffTeamId);
}

const passes = (status: string) => status === ('passed' satisfies AiTestResultStatus);

/** How `current` compares with `previous`, the same scenario's earlier result; null — unchanged. */
export function regressionOf(
  current: ComparedResult,
  previous: ComparedResult | undefined,
): AiTestRegression | null {
  if (!previous) return null;
  if (passes(previous.status) && !passes(current.status)) return 'newly_failing';
  const ended = current.status !== 'errored' && previous.status !== 'errored';
  if (ended && current.outcome !== previous.outcome) return 'outcome_changed';
  if (ended && teamOf(current) !== teamOf(previous)) return 'team_changed';
  if (!passes(previous.status) && passes(current.status)) return 'newly_passing';
  return null;
}

/** Each result's regression against the earlier run's results, by scenario key. */
export function regressions<T extends ComparedResult>(
  results: readonly T[],
  earlier: readonly ComparedResult[],
): Map<T, AiTestRegression | null> {
  const byKey = new Map(earlier.map((result) => [result.scenarioKey, result]));
  return new Map(
    results.map((result) => [result, regressionOf(result, byKey.get(result.scenarioKey))]),
  );
}

/** Newly failing, changed outcome, changed team come first; then the rest. */
const REGRESSION_RANK: Readonly<Partial<Record<AiTestRegression, number>>> = {
  newly_failing: 0,
  outcome_changed: 1,
  team_changed: 1,
};

/** Failed and errored first — what a person opens the results for — then in play order. */
const STATUS_RANK: Readonly<Record<string, number>> = { failed: 0, errored: 1, passed: 2 };

/**
 * The results in the order the report lists them: by regression, then by
 * status, then in the run's play order (`scenarioIds`), then by key — a
 * compliance-pack key is not among the ids.
 */
export function orderResults<T extends ComparedResult>(
  results: readonly T[],
  regression: ReadonlyMap<T, AiTestRegression | null>,
  scenarioIds: readonly string[],
): T[] {
  const played = new Map(scenarioIds.map((id, index) => [id, index]));
  const rank = (result: T) => {
    const kind = regression.get(result) ?? null;
    return kind === null ? 2 : (REGRESSION_RANK[kind] ?? 2);
  };
  return [...results].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3) ||
      (played.get(a.scenarioKey) ?? played.size) - (played.get(b.scenarioKey) ?? played.size) ||
      a.scenarioKey.localeCompare(b.scenarioKey),
  );
}
