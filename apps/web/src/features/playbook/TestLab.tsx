/**
 * Playbook › AI Agent › Test (tm 314.5 · AI-19): the simulation lab.
 *
 *   - **The compliance pack** (AI-19-S1, tm 314.4) — the platform's locked
 *     scenarios, read from `GET /ai/compliance-pack`: a lock and no control to
 *     change them, and the publish gate their latest pre-publish run set.
 *   - **The workspace's scenarios** — written in `ScenarioEditor`, run one at a
 *     time or all together against the draft or the published configuration.
 *     "Pre-publish run" plays the pack first, then every active scenario: the
 *     run the gate reads.
 *   - **The runs** — newest first; one opens in `RunResults`, regressions on top.
 *   - **"Talk like a player"** — `SandboxChat`, the same engine turn with its
 *     decision trace beside every reply.
 *
 * Who: the tab is drawn only for whoever may read the AI's configuration
 * (`agents-bot--all:ro`/`:rw`, PlaybookPage) — a team member has neither in the
 * default matrix. Writing (scenarios, runs, a sandbox) needs `:rw`.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { AI_TEST_RUN_SCENARIOS_MAX, type AiComplianceGateState } from '@siyahtus/types';
import { Card, CardSkeleton, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadError } from '../../components/LoadError.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  isOpenRun,
  testingKeys,
  type CompliancePack,
  type TestRun,
  type TestScenario,
} from './ai-testing.js';
import { RunResults, runStatusTone } from './RunResults.js';
import { SandboxChat } from './SandboxChat.js';
import { ScenarioEditor } from './ScenarioEditor.js';
import type { Skill } from './types.js';

const button =
  'rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const primaryButton =
  'rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50';
const rowButton =
  'rounded-md border border-border px-2 py-1 text-2xs text-content-secondary hover:bg-surface-2 disabled:opacity-50';

const GATE_TONE: Record<AiComplianceGateState, StatusTone> = {
  passed: 'success',
  failed: 'danger',
  pending: 'info',
  stale: 'warning',
  missing: 'neutral',
};

type Pane = { kind: 'list' } | { kind: 'edit'; scenarioId: string | null } | { kind: 'sandbox' };
type RunTarget = 'draft' | 'published';

export function TestLab({
  agentId,
  skills,
  canEdit,
}: {
  agentId: string;
  skills: readonly Pick<Skill, 'id' | 'name'>[];
  canEdit: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [pane, setPane] = useState<Pane>({ kind: 'list' });
  const [target, setTarget] = useState<RunTarget>('draft');
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TestScenario | null>(null);

  const scenarios = useQuery({
    queryKey: testingKeys.scenarios(agentId),
    queryFn: () =>
      api.get<{ scenarios: TestScenario[] }>(
        `/ai/test-scenarios?ai_agent_id=${encodeURIComponent(agentId)}`,
      ),
  });
  const pack = useQuery({
    queryKey: testingKeys.pack(agentId),
    queryFn: () =>
      api.get<CompliancePack>(`/ai/compliance-pack?ai_agent_id=${encodeURIComponent(agentId)}`),
  });
  const runs = useQuery({
    queryKey: testingKeys.runs(agentId),
    queryFn: () =>
      api.get<{ runs: TestRun[] }>(
        `/ai/test-runs?ai_agent_id=${encodeURIComponent(agentId)}&limit=20`,
      ),
    // A run under way moves the history and the gate; read them until it ends.
    refetchInterval: (query) => (query.state.data?.runs.some(isOpenRun) ? 4_000 : false),
  });

  const refreshAll = () =>
    void queryClient.invalidateQueries({ queryKey: testingKeys.all(agentId) });

  const startRun = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<TestRun>('/ai/test-runs', { ai_agent_id: agentId, ...body }),
    onSuccess: (run) => {
      setOpenRunId(run.id);
      refreshAll();
    },
  });

  const remove = useMutation({
    mutationFn: (scenario: TestScenario) => api.delete(`/ai/test-scenarios/${scenario.id}`),
    onSuccess: () => {
      setDeleting(null);
      refreshAll();
    },
  });

  const items = scenarios.data?.scenarios ?? [];
  const activeCount = items.filter((s) => s.active).length;
  const runList = runs.data?.runs ?? [];

  if (pane.kind === 'edit') {
    return (
      <ScenarioEditor
        agentId={agentId}
        scenarioId={pane.scenarioId}
        skills={skills}
        canEdit={canEdit}
        onClose={() => setPane({ kind: 'list' })}
        onSaved={() => {
          refreshAll();
          setPane({ kind: 'list' });
        }}
      />
    );
  }

  if (pane.kind === 'sandbox') {
    return (
      <SandboxChat
        agentId={agentId}
        canEdit={canEdit}
        onClose={() => setPane({ kind: 'list' })}
        onSavedScenario={refreshAll}
      />
    );
  }

  return (
    <section
      aria-label={t('playbook.test.title')}
      data-testid="ai-test-lab"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{t('playbook.test.title')}</h2>
          <p className="mt-0.5 text-2xs text-content-tertiary">{t('playbook.test.description')}</p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={button} onClick={() => setPane({ kind: 'sandbox' })}>
              {t('playbook.test.actions.sandbox')}
            </button>
            <button
              type="button"
              className={primaryButton}
              onClick={() => setPane({ kind: 'edit', scenarioId: null })}
            >
              {t('playbook.test.actions.newScenario')}
            </button>
          </div>
        )}
      </div>

      {canEdit && (
        <Card>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <label className="flex items-center gap-2 text-xs text-content-secondary">
              {t('playbook.test.run.target')}
              <select
                value={target}
                onChange={(event) => setTarget(event.target.value as RunTarget)}
                className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
              >
                <option value="draft">{t('playbook.test.target.draft')}</option>
                <option value="published">{t('playbook.test.target.published')}</option>
              </select>
            </label>
            <button
              type="button"
              className={button}
              disabled={startRun.isPending || activeCount === 0}
              title={activeCount === 0 ? t('playbook.test.run.noActive') : undefined}
              onClick={() => startRun.mutate({ target, trigger: 'manual' })}
            >
              {t('playbook.test.actions.runAll', {
                count: Math.min(activeCount, AI_TEST_RUN_SCENARIOS_MAX),
              })}
            </button>
            <button
              type="button"
              className={button}
              disabled={startRun.isPending}
              onClick={() => startRun.mutate({ target: 'draft', trigger: 'pre_publish' })}
            >
              {t('playbook.test.actions.prePublish')}
            </button>
            <p className="text-2xs text-content-tertiary">{t('playbook.test.run.budgetNote')}</p>
          </div>
          {startRun.isError && (
            <p role="alert" className="border-t border-border px-4 py-2 text-2xs text-danger">
              {t(errorMessageKey(startRun.error))}
            </p>
          )}
        </Card>
      )}

      <CompliancePackCard pack={pack} onOpenRun={(runId) => setOpenRunId(runId)} />

      <Section title={t('playbook.test.scenarios.title')}>
        <Card>
          {scenarios.isPending ? (
            <CardSkeleton rows={3} />
          ) : scenarios.isError ? (
            <LoadError
              compact
              title={t('playbook.test.scenarios.loadFailed')}
              error={scenarios.error}
              onRetry={() => void scenarios.refetch()}
            />
          ) : items.length === 0 ? (
            <EmptyState
              title={t('playbook.test.scenarios.emptyTitle')}
              description={t('playbook.test.scenarios.emptyDescription')}
            />
          ) : (
            <ul aria-label={t('playbook.test.scenarios.title')} className="divide-y divide-border">
              {items.map((scenario) => (
                <li key={scenario.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{scenario.name}</p>
                    <p className="text-2xs text-content-tertiary">
                      {[
                        t(`playbook.test.mode.${scenario.mode}`),
                        t(`playbook.test.persona.${scenario.persona}`),
                        scenario.language.toUpperCase(),
                        t(`playbook.test.outcome.${scenario.expectations.outcome}`),
                        t(`playbook.test.origin.${scenario.origin}`),
                      ].join(' · ')}
                    </p>
                  </div>
                  {!scenario.active && (
                    <StatusDot tone="neutral" label={t('playbook.test.scenarios.inactive')} />
                  )}
                  {canEdit ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className={rowButton}
                        disabled={startRun.isPending}
                        aria-label={t('playbook.test.scenarios.runOne', { name: scenario.name })}
                        onClick={() =>
                          startRun.mutate({
                            target,
                            trigger: 'manual',
                            scenario_ids: [scenario.id],
                          })
                        }
                      >
                        {t('playbook.test.actions.run')}
                      </button>
                      <button
                        type="button"
                        className={rowButton}
                        aria-label={t('playbook.test.scenarios.edit', { name: scenario.name })}
                        onClick={() => setPane({ kind: 'edit', scenarioId: scenario.id })}
                      >
                        {t('playbook.test.actions.edit')}
                      </button>
                      <button
                        type="button"
                        className={rowButton}
                        aria-label={t('playbook.test.scenarios.delete', { name: scenario.name })}
                        onClick={() => {
                          remove.reset();
                          setDeleting(scenario);
                        }}
                      >
                        {t('playbook.test.actions.delete')}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={rowButton}
                      aria-label={t('playbook.test.scenarios.view', { name: scenario.name })}
                      onClick={() => setPane({ kind: 'edit', scenarioId: scenario.id })}
                    >
                      {t('playbook.test.actions.view')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      <Section title={t('playbook.test.runs.title')}>
        <Card>
          {runs.isPending ? (
            <CardSkeleton rows={2} />
          ) : runs.isError ? (
            <LoadError
              compact
              title={t('playbook.test.runs.loadFailed')}
              error={runs.error}
              onRetry={() => void runs.refetch()}
            />
          ) : runList.length === 0 ? (
            <EmptyState
              title={t('playbook.test.runs.emptyTitle')}
              description={t('playbook.test.runs.emptyDescription')}
            />
          ) : (
            <ul aria-label={t('playbook.test.runs.title')} className="divide-y divide-border">
              {runList.map((run) => (
                <li key={run.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">
                      {t(`playbook.test.trigger.${run.trigger}`)} ·{' '}
                      {t(`playbook.test.target.${run.target}`)}
                    </p>
                    <p className="text-2xs text-content-tertiary">
                      {formatDateTime(run.created_at)} ·{' '}
                      {t('playbook.test.runs.counts', {
                        passed: run.passed,
                        failed: run.failed,
                        errored: run.errored,
                        total: run.scenario_count,
                      })}
                    </p>
                  </div>
                  <StatusDot
                    tone={runStatusTone(run.status)}
                    label={t(`playbook.test.runStatus.${run.status}`)}
                  />
                  <button
                    type="button"
                    className={rowButton}
                    aria-pressed={openRunId === run.id}
                    onClick={() => setOpenRunId(openRunId === run.id ? null : run.id)}
                  >
                    {openRunId === run.id
                      ? t('playbook.test.runs.close')
                      : t('playbook.test.runs.open')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      {openRunId && (
        <RunResults
          key={openRunId}
          runId={openRunId}
          onFinished={refreshAll}
          onClose={() => setOpenRunId(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('playbook.test.delete.title')}
          description={t('playbook.test.delete.description', { name: deleting.name })}
          confirmLabel={t('playbook.test.actions.delete')}
          pending={remove.isPending}
          failure={remove.isError ? t(errorMessageKey(remove.error)) : null}
          onConfirm={() => remove.mutate(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}

/** The locked pack and the gate it sets (AI-19-S1). Nothing here can be changed. */
function CompliancePackCard({
  pack,
  onOpenRun,
}: {
  pack: UseQueryResult<CompliancePack>;
  onOpenRun: (runId: string) => void;
}): ReactElement {
  const t = useTranslate();
  if (pack.isPending) return <CardSkeleton rows={2} />;
  if (pack.isError) {
    return (
      <Card>
        <LoadError
          compact
          title={t('playbook.test.pack.loadFailed')}
          error={pack.error}
          onRetry={() => void pack.refetch()}
        />
      </Card>
    );
  }
  const { gate, scenarios, pack_version: version } = pack.data;
  return (
    <section aria-label={t('playbook.test.pack.title')} data-testid="compliance-pack">
      <Card>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">
              <span aria-hidden="true">🔒 </span>
              {t('playbook.test.pack.title')}
            </h3>
            <p className="mt-0.5 text-2xs text-content-tertiary">
              {t('playbook.test.pack.description', { version, count: scenarios.length })}
            </p>
          </div>
          <StatusDot tone={GATE_TONE[gate.state]} label={t(`playbook.test.gate.${gate.state}`)} />
          {gate.run_id && (
            <span className="text-2xs text-content-secondary">
              {t('playbook.test.pack.score', { passed: gate.passed, total: scenarios.length })}
            </span>
          )}
          {gate.run_id && (
            <button type="button" className={rowButton} onClick={() => onOpenRun(gate.run_id!)}>
              {t('playbook.test.runs.open')}
            </button>
          )}
        </div>
        {gate.workspace_failed > 0 && (
          <p className="border-t border-border px-4 py-2 text-2xs text-warning">
            {t('playbook.test.pack.workspaceFailed', { count: gate.workspace_failed })}
          </p>
        )}
        <details className="border-t border-border">
          <summary className="cursor-pointer px-4 py-2 text-2xs text-content-secondary">
            {t('playbook.test.pack.show')}
          </summary>
          <ul aria-label={t('playbook.test.pack.listLabel')} className="divide-y divide-border">
            {scenarios.map((scenario) => {
              const failing = gate.failing.includes(scenario.key);
              return (
                <li key={scenario.key} className="flex flex-wrap items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1 text-xs">{scenario.name}</span>
                  <span className="text-2xs text-content-tertiary">
                    {scenario.language.toUpperCase()}
                  </span>
                  {failing && (
                    <StatusDot tone="danger" label={t('playbook.test.resultStatus.failed')} />
                  )}
                  <span className="text-2xs text-content-tertiary">
                    {t('playbook.test.pack.locked')}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      </Card>
    </section>
  );
}
