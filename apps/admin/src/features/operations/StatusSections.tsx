/**
 * The read-only half of the Operations page (tm 389.14 · FR-ADMIN-20): the job queues, the
 * webhook backlog, the SIEM export and the component record.
 *
 * Counts, ages and states only — a workspace is never named here (requirements §2). A queue
 * whose table does not exist in this deployment reads "Not installed", quietly: a module a
 * deployment does not run is not a fault, and the page asks the database nothing about it.
 */
import type { ReactElement } from 'react';
import { formatCount, formatDateTime, formatDuration, formatRate } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import type { PlatformComponentStatus } from '../../lib/platform-types.js';
import { StateBadge, Tile } from '../dashboard/HealthSection.js';
import { Cell, DataTable } from '../workspaces/ui.js';
import { useComponentRecord, useQueues, useSiem, useWebhooks } from './queries.js';
import { Figures, QuerySection } from './ui.js';

export function QueuesSection(): ReactElement {
  const t = useTranslate();
  const query = useQueues();
  return (
    <QuerySection id="operations-queues" title={t('operations.queues.heading')} query={query}>
      {(data) => (
        <DataTable
          caption={t('operations.queues.caption')}
          headers={[
            t('operations.queues.col.queue'),
            t('operations.queues.col.state'),
            t('operations.queues.col.counts'),
            t('operations.queues.col.oldest'),
          ]}
        >
          {data.queues.map((queue) => (
            <tr key={queue.key}>
              <Cell>{t(`operations.queues.name.${queue.key}`)}</Cell>
              <Cell>
                <StateBadge
                  state={
                    queue.state === 'ok'
                      ? 'ok'
                      : queue.state === 'unreadable'
                        ? 'degraded'
                        : 'not_installed'
                  }
                  label={t(`operations.queues.state.${queue.state}`)}
                />
              </Cell>
              <Cell>{countsText(queue.counts, t)}</Cell>
              <Cell>{formatDuration(queue.oldest_unfinished_age_s) ?? '—'}</Cell>
            </tr>
          ))}
        </DataTable>
      )}
    </QuerySection>
  );
}

/** `pending: 2 · done: 1` — the state names are the queue's own identifiers, not prose. */
function countsText(counts: Record<string, number> | null, t: TFunction): string {
  if (counts === null) return '—';
  const parts = Object.entries(counts).map(([state, count]) => `${state}: ${formatCount(count)}`);
  return parts.length === 0 ? t('operations.queues.empty') : parts.join(' · ');
}

export function WebhooksSection(): ReactElement {
  const t = useTranslate();
  const query = useWebhooks();
  return (
    <QuerySection id="operations-webhooks" title={t('operations.webhooks.heading')} query={query}>
      {(data) => {
        const hours = data.window_hours;
        const window = data.last_window;
        return (
          <Figures
            items={[
              { label: t('operations.webhooks.pending'), value: formatCount(data.pending) },
              { label: t('operations.webhooks.overdue'), value: formatCount(data.overdue) },
              {
                label: t('operations.webhooks.oldest'),
                value: formatDuration(data.oldest_pending_age_s) ?? '—',
              },
              {
                label: t('operations.webhooks.delivered', { hours }),
                value: formatCount(window.delivered),
              },
              {
                label: t('operations.webhooks.failed', { hours }),
                value: formatCount(window.failed),
              },
              {
                label: t('operations.webhooks.exhausted', { hours }),
                value: formatCount(window.exhausted),
              },
              {
                label: t('operations.webhooks.failureRate', { hours }),
                value:
                  window.failure_rate === null
                    ? t('operations.webhooks.noRate')
                    : formatRate(window.failure_rate),
              },
              {
                label: t('operations.webhooks.failing'),
                value: formatCount(window.workspaces_failing),
              },
            ]}
          />
        );
      }}
    </QuerySection>
  );
}

export function SiemSection(): ReactElement {
  const t = useTranslate();
  const query = useSiem();
  return (
    <QuerySection id="operations-siem" title={t('operations.siem.heading')} query={query}>
      {(data) => (
        <Figures
          items={[
            { label: t('operations.siem.provider'), value: data.provider },
            { label: t('operations.siem.enabled'), value: formatCount(data.workspaces_enabled) },
            { label: t('operations.siem.stalled'), value: formatCount(data.workspaces_stalled) },
            {
              label: t('operations.siem.lastRun'),
              value: formatDateTime(data.last_run_at) ?? t('operations.never'),
            },
            {
              label: t('operations.siem.lastShipped'),
              value: formatDateTime(data.last_exported_at) ?? t('operations.never'),
            },
            { label: t('operations.siem.total'), value: formatCount(data.exported_total) },
          ]}
        />
      )}
    </QuerySection>
  );
}

export function ComponentRecordSection(): ReactElement {
  const t = useTranslate();
  const query = useComponentRecord();
  return (
    <QuerySection
      id="operations-components"
      title={t('operations.components.heading')}
      query={query}
    >
      {(data) => (
        <ul
          aria-labelledby="operations-components"
          className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          {data.components.map((component) => (
            <li key={component.key}>
              <ComponentTile component={component} t={t} />
            </li>
          ))}
        </ul>
      )}
    </QuerySection>
  );
}

function ComponentTile({
  component,
  t,
}: {
  component: PlatformComponentStatus;
  t: TFunction;
}): ReactElement {
  return (
    <Tile
      label={t(`dashboard.components.name.${component.key}`)}
      badge={
        <StateBadge
          state={component.state}
          label={t(`dashboard.components.state.${component.state}`)}
        />
      }
      lines={[
        component.detail,
        component.updated_at
          ? t('dashboard.components.updated', { time: formatDateTime(component.updated_at) ?? '–' })
          : t('dashboard.components.neverReported'),
      ]}
    />
  );
}
