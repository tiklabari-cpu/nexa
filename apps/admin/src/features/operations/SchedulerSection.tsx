/**
 * The scheduler's jobs and "Run now" (tm 389.14 · FR-ADMIN-20).
 *
 * The table is the tenant API's own view of its jobs, published by whichever process holds the
 * health leader lock; "Run now" asks a scheduler process, over Redis, to run one job once. The
 * platform cannot wait for a sweep, so the answer to the request says only what could be known
 * at once — heard, already running, switched off, nobody listening — and the outcome arrives in
 * the table's "Last Run now" column a moment later (the table refreshes every five seconds).
 *
 * Three states of the publication, as on the dashboard: fresh, stale (the jobs under a yellow
 * notice) and absent (a red notice and no rows — nothing publishing is itself the finding).
 */
import { useState, type ReactElement } from 'react';
import { ReasonDialog } from '../../components/ReasonDialog.js';
import { Banner } from '../../components/ui/index.js';
import { hasPermission, useAuth } from '../../lib/auth-store.js';
import { formatCount, formatDateTime, formatDuration } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import type {
  PlatformOperationsJob,
  PlatformOperationsRunResult,
} from '../../lib/platform-types.js';
import { StateBadge } from '../dashboard/HealthSection.js';
import { Cell, DataTable, EmptyLine, SECONDARY_BUTTON_CLASS } from '../workspaces/ui.js';
import { useRunJob, useScheduler } from './queries.js';
import { QuerySection } from './ui.js';

type Notice = { tone: 'success' | 'warning'; text: string };

export function SchedulerSection(): ReactElement {
  const t = useTranslate();
  const query = useScheduler();
  const me = useAuth((s) => s.me);
  const canRun = hasPermission(me, 'operations.trigger');
  const run = useRunJob();
  const [target, setTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  return (
    <QuerySection id="operations-scheduler" title={t('operations.scheduler.heading')} query={query}>
      {(table) => (
        <div className="flex flex-col">
          {notice && (
            <div className="p-4 pb-0">
              <Banner tone={notice.tone} dismissible>
                {notice.text}
              </Banner>
            </div>
          )}
          {table.generated_at === null && (
            <div className="p-4 pb-0">
              <Banner tone="danger" title={t('operations.scheduler.notReporting.title')}>
                {t('operations.scheduler.notReporting.body')}
              </Banner>
            </div>
          )}
          {table.generated_at !== null && table.stale && (
            <div className="p-4 pb-0">
              <Banner tone="warning" title={t('operations.scheduler.stale.title')}>
                {t('operations.scheduler.stale.body', {
                  time: formatDateTime(table.generated_at) ?? '–',
                })}
              </Banner>
            </div>
          )}
          {table.enabled === false && (
            <div className="p-4 pb-0">
              <Banner tone="info" title={t('operations.scheduler.off.title')}>
                {t('operations.scheduler.off.body')}
              </Banner>
            </div>
          )}

          {table.generated_at === null ? null : table.jobs.length === 0 ? (
            <EmptyLine>{t('operations.scheduler.empty')}</EmptyLine>
          ) : (
            <DataTable
              caption={t('operations.scheduler.caption')}
              headers={[
                t('operations.scheduler.col.job'),
                t('operations.scheduler.col.interval'),
                t('operations.scheduler.col.lastRun'),
                t('operations.scheduler.col.duration'),
                t('operations.scheduler.col.result'),
                t('operations.scheduler.col.nextRun'),
                t('operations.scheduler.col.manual'),
                t('operations.scheduler.col.actions'),
              ]}
            >
              {table.jobs.map((job) => (
                <JobRow
                  key={job.name}
                  job={job}
                  canRun={canRun}
                  onRun={() => setTarget(job.name)}
                  t={t}
                />
              ))}
            </DataTable>
          )}
          {table.generated_at !== null && (
            <p className="p-4 pt-2 text-xs text-content-secondary">
              {t('operations.scheduler.updated', {
                time: formatDateTime(table.generated_at) ?? '–',
              })}
            </p>
          )}

          {target !== null && (
            <ReasonDialog
              title={t('operations.run.title', { name: target })}
              description={t('operations.run.description')}
              confirmLabel={t('operations.run.confirm')}
              onConfirm={async ({ reason }) => {
                const answer: PlatformOperationsRunResult = await run.mutateAsync({
                  name: target,
                  reason,
                });
                setNotice({
                  tone: answer.result === 'queued' ? 'success' : 'warning',
                  text: t(`operations.run.result.${answer.result}`, { name: target }),
                });
              }}
              onDone={() => setTarget(null)}
              onCancel={() => setTarget(null)}
            />
          )}
        </div>
      )}
    </QuerySection>
  );
}

function JobRow({
  job,
  canRun,
  onRun,
  t,
}: {
  job: PlatformOperationsJob;
  canRun: boolean;
  onRun: () => void;
  t: TFunction;
}): ReactElement {
  return (
    <tr>
      <Cell>
        <div className="flex flex-wrap items-center gap-2">
          <code className="text-xs">{job.name}</code>
          {job.running && (
            <StateBadge state="degraded" label={t('operations.scheduler.badge.running')} />
          )}
          {!job.enabled && (
            <StateBadge state="not_installed" label={t('operations.scheduler.badge.off')} />
          )}
        </div>
      </Cell>
      <Cell>{formatDuration(job.interval_ms / 1000)}</Cell>
      <Cell>{formatDateTime(job.last_run_at) ?? t('operations.never')}</Cell>
      <Cell>
        {job.last_duration_ms === null
          ? '—'
          : t('operations.scheduler.duration', { ms: formatCount(job.last_duration_ms) ?? '' })}
      </Cell>
      <Cell>
        <ResultBadge job={job} t={t} />
      </Cell>
      <Cell>{formatDateTime(job.next_run_at) ?? '—'}</Cell>
      <Cell>{manualText(job, t)}</Cell>
      <Cell>
        {canRun && job.enabled ? (
          <button
            type="button"
            onClick={onRun}
            disabled={job.running}
            aria-label={t('operations.scheduler.runJob', { name: job.name })}
            className={SECONDARY_BUTTON_CLASS}
          >
            {t('operations.scheduler.run')}
          </button>
        ) : (
          '—'
        )}
      </Cell>
    </tr>
  );
}

function ResultBadge({ job, t }: { job: PlatformOperationsJob; t: TFunction }): ReactElement {
  const status = job.last_status;
  if (status === 'ok') {
    return <StateBadge state="ok" label={t('operations.scheduler.status.ok')} />;
  }
  if (status === 'error') {
    return (
      <div className="flex flex-col items-start gap-1">
        <StateBadge state="down" label={t('operations.scheduler.status.error')} />
        {job.last_error_class && (
          <span className="text-xs text-content-secondary">
            {t('operations.scheduler.errorClass', { class: job.last_error_class })}
          </span>
        )}
      </div>
    );
  }
  if (status === 'skipped') {
    return <StateBadge state="unknown" label={t('operations.scheduler.status.skipped')} />;
  }
  if (status === 'disabled') {
    return <StateBadge state="not_installed" label={t('operations.scheduler.status.disabled')} />;
  }
  return <StateBadge state="unknown" label={t('operations.scheduler.status.none')} />;
}

/** One sentence for the outcome of the last "Run now": what ran, or why it was refused. */
function manualText(job: PlatformOperationsJob, t: TFunction): string {
  const manual = job.last_manual;
  if (!manual) return t('operations.scheduler.manual.none');
  const time = formatDateTime(manual.at) ?? '–';
  if (manual.result === 'finished') {
    return manual.status === 'error'
      ? t('operations.scheduler.manual.error', { time, class: manual.error_class ?? '—' })
      : t('operations.scheduler.manual.ok', {
          time,
          duration: t('operations.scheduler.duration', {
            ms: formatCount(manual.duration_ms) ?? '–',
          }),
        });
  }
  return t(`operations.scheduler.manual.${manual.result}`, { time });
}
