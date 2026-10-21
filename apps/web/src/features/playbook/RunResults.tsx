/**
 * One test run's results (tm 314.5 · AI-19 §5): the counts while it plays and
 * once it has ended, then every scenario's verdict in the server's order —
 * "was passing → now failing" first, then a changed outcome or team, then the
 * rest (`GET /ai/test-runs/{id}/results`, ordered by `regression.ts`). The list
 * is not re-sorted here: the order is the report.
 *
 * Each result opens to its hard checks (they alone decide pass or fail), the
 * judge's advice — labelled as a suggestion, since it never changes the
 * verdict (AI-19-S3) — and the transcript with every AI turn's decision trace.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, type ReactElement } from 'react';
import type {
  AiTestCheck,
  AiTestJudgeVerdict,
  AiTestRegression,
  AiTestResultStatus,
  AiTestRunStatus,
} from '@siyahtus/types';
import { Card, CardSkeleton } from '../../components/Page.js';
import { LoadError } from '../../components/LoadError.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  OPEN_RUN_POLL_MS,
  isOpenRun,
  testingKeys,
  type TestRun,
  type TestRunResult,
  type TestRunResults,
} from './ai-testing.js';
import { Transcript } from './SandboxChat.js';

export function runStatusTone(status: AiTestRunStatus): StatusTone {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'cancelled') return 'neutral';
  return 'info';
}

const RESULT_TONE: Record<AiTestResultStatus, StatusTone> = {
  passed: 'success',
  failed: 'danger',
  errored: 'warning',
};

const REGRESSION_CLASS: Record<AiTestRegression, string> = {
  newly_failing: 'border-danger text-danger',
  outcome_changed: 'border-warning text-warning',
  team_changed: 'border-warning text-warning',
  newly_passing: 'border-success text-success',
};

/** A check's expected/actual value, short enough for a line. */
function shown(value: unknown): string {
  if (value === undefined || value === null) return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function RunResults({
  runId,
  onFinished,
  onClose,
}: {
  runId: string;
  /** Called once when an open run ends, so the history and the gate are read again. */
  onFinished: () => void;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const run = useQuery({
    queryKey: testingKeys.run(runId),
    queryFn: () => api.get<TestRun>(`/ai/test-runs/${runId}`),
    refetchInterval: (query) =>
      query.state.data && isOpenRun(query.state.data) ? OPEN_RUN_POLL_MS : false,
  });
  const open = run.data ? isOpenRun(run.data) : true;
  const results = useQuery({
    queryKey: testingKeys.results(runId),
    queryFn: () => api.get<TestRunResults>(`/ai/test-runs/${runId}/results`),
    enabled: run.isSuccess,
    refetchInterval: open ? OPEN_RUN_POLL_MS : false,
  });

  // The run ended while this was open: read the results once more, and tell the lab.
  const wasOpen = useRef<boolean | null>(null);
  useEffect(() => {
    if (!run.data) return;
    const nowOpen = isOpenRun(run.data);
    if (wasOpen.current === true && !nowOpen) {
      void results.refetch();
      onFinished();
    }
    wasOpen.current = nowOpen;
  }, [run.data, results, onFinished]);

  return (
    <section
      aria-label={t('playbook.test.results.title')}
      data-testid="run-results"
      className="flex flex-col gap-3"
    >
      <div className="flex items-center gap-3">
        <h3 className="min-w-0 flex-1 text-sm font-semibold">{t('playbook.test.results.title')}</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary hover:bg-surface-2"
        >
          {t('playbook.test.runs.close')}
        </button>
      </div>

      {run.isPending ? (
        <CardSkeleton rows={2} />
      ) : run.isError ? (
        <Card>
          <LoadError
            compact
            title={t('playbook.test.results.loadFailed')}
            error={run.error}
            onRetry={() => void run.refetch()}
          />
        </Card>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <StatusDot
              tone={runStatusTone(run.data.status)}
              label={t(`playbook.test.runStatus.${run.data.status}`)}
            />
            <span className="text-xs">
              {t('playbook.test.runs.counts', {
                passed: run.data.passed,
                failed: run.data.failed,
                errored: run.data.errored,
                total: run.data.scenario_count,
              })}
            </span>
            {run.data.compliance && (
              <span className="text-2xs text-content-secondary">
                {t('playbook.test.results.compliance', {
                  passed: run.data.compliance.passed,
                  failed: run.data.compliance.failed,
                })}
              </span>
            )}
            <span className="text-2xs text-content-tertiary">
              {t('playbook.test.results.tokens', { count: run.data.tokens })}
            </span>
          </div>
          {run.data.error && (
            <p role="alert" className="border-t border-border px-4 py-2 text-2xs text-danger">
              {t('playbook.test.results.runError', { error: run.data.error })}
            </p>
          )}
          {results.data && (
            <p className="border-t border-border px-4 py-2 text-2xs text-content-tertiary">
              {results.data.compared_run_id
                ? t('playbook.test.results.compared')
                : t('playbook.test.results.notCompared')}
            </p>
          )}
        </Card>
      )}

      {run.isSuccess &&
        (results.isPending ? (
          <CardSkeleton rows={3} />
        ) : results.isError ? (
          <Card>
            <LoadError
              compact
              title={t('playbook.test.results.loadFailed')}
              error={results.error}
              onRetry={() => void results.refetch()}
            />
          </Card>
        ) : results.data.results.length === 0 ? (
          <p className="text-2xs text-content-tertiary">
            {open ? t('playbook.test.results.playing') : t('playbook.test.results.none')}
          </p>
        ) : (
          <ul aria-label={t('playbook.test.results.listLabel')} className="flex flex-col gap-2">
            {results.data.results.map((result) => (
              <ResultRow key={result.id} result={result} />
            ))}
          </ul>
        ))}
    </section>
  );
}

function ResultRow({ result }: { result: TestRunResult }): ReactElement {
  const t = useTranslate();
  const failedChecks = result.checks.filter((check) => !check.passed);
  return (
    <li data-testid="run-result">
      <Card>
        <details>
          <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1 text-sm font-medium">{result.scenario_name}</span>
            {result.regression && (
              <span
                className={`rounded-full border px-2 py-0.5 text-2xs font-medium ${REGRESSION_CLASS[result.regression]}`}
              >
                {t(`playbook.test.regression.${result.regression}`)}
              </span>
            )}
            <StatusDot
              tone={RESULT_TONE[result.status]}
              label={t(`playbook.test.resultStatus.${result.status}`)}
            />
            <span className="text-2xs text-content-tertiary">
              {t(`playbook.test.stop.${result.stop_reason}`)}
            </span>
          </summary>
          <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
            <p className="text-2xs text-content-secondary">
              {[
                result.outcome
                  ? t(`playbook.test.outcome.${result.outcome}`)
                  : t('playbook.test.results.noOutcome'),
                result.handoff_team_id !== null
                  ? t('playbook.test.results.team', { id: result.handoff_team_id })
                  : null,
                t('playbook.test.results.tokens', { count: result.tokens }),
                t('playbook.test.results.duration', {
                  seconds: (result.duration_ms / 1000).toFixed(1),
                }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <Checks checks={result.checks} failed={failedChecks.length} />
            <Judge judge={result.judge} />
            {result.transcript.length > 0 && <Transcript entries={result.transcript} />}
          </div>
        </details>
      </Card>
    </li>
  );
}

function Checks({ checks, failed }: { checks: AiTestCheck[]; failed: number }): ReactElement {
  const t = useTranslate();
  return (
    <div>
      <h4 className="text-xs font-semibold">
        {t('playbook.test.checks.title', { failed, total: checks.length })}
      </h4>
      <ul aria-label={t('playbook.test.checks.title', { failed, total: checks.length })}>
        {checks.map((check, index) => (
          <li key={`${check.kind}-${index}`} className="flex flex-wrap gap-2 py-0.5 text-2xs">
            <StatusDot
              tone={check.passed ? 'success' : 'danger'}
              label={
                check.passed ? t('playbook.test.checks.passed') : t('playbook.test.checks.failed')
              }
              compact
            />
            <span className="font-medium">{t(`playbook.test.check.${check.kind}`)}</span>
            {!check.passed && (
              <span className="text-content-secondary">
                {t('playbook.test.checks.expectedActual', {
                  expected: shown(check.expected),
                  actual: shown(check.actual),
                })}
                {check.turn_index !== undefined &&
                  ` · ${t('playbook.test.checks.turn', { turn: check.turn_index + 1 })}`}
                {check.detail ? ` · ${check.detail}` : ''}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The judge's advice — a suggestion, never the verdict (AI-19-S3). */
function Judge({ judge }: { judge: AiTestJudgeVerdict | null }): ReactElement {
  const t = useTranslate();
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-2">
      <h4 className="text-xs font-semibold">{t('playbook.test.judge.title')}</h4>
      <p className="text-2xs text-content-tertiary">{t('playbook.test.judge.advisory')}</p>
      {judge ? (
        <>
          <p className="mt-1 text-xs">
            {t('playbook.test.judge.score', { score: judge.score })} — {judge.comment}
          </p>
          {judge.criteria && Object.keys(judge.criteria).length > 0 && (
            <p className="text-2xs text-content-secondary">
              {Object.entries(judge.criteria)
                .map(
                  ([criterion, score]) =>
                    `${t(`playbook.test.judge.criterion.${criterion}`)} ${score}`,
                )
                .join(' · ')}
            </p>
          )}
        </>
      ) : (
        <p className="mt-1 text-2xs text-content-secondary">{t('playbook.test.judge.none')}</p>
      )}
    </div>
  );
}
