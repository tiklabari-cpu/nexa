/**
 * The queue reports (RP-04 · tm 371): Reports › Queue and Reports › Queue
 * abandonment, over `GET /reports/queue` and `GET /reports/queue-abandonment`.
 *
 * Every figure is the server's — a stay in the routing queue is one row of the
 * `queue_entries` record, and the wait, the two shares and the abandonment
 * bands are computed there once for the screen and the CSV alike. The page only
 * lays them out. The weekday × hour heat map and the day rows are in the
 * workspace's time zone, which the response names (`timezone`, ID-04).
 *
 * "Abandoned" is the player closing the chat (or it closing for inactivity)
 * while they waited; closing the widget window is not an event.
 */
import type { ReactElement } from 'react';
import { Card, CardSkeleton, ErrorNotice, Kpi, KpiGrid, Section } from '../../components/Page.js';
import { CardTable } from '../../components/CardTable.js';
import { EmptyState } from '../../components/EmptyState.js';
import { formatCount, formatDay, formatDuration, formatRate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { HourGrid, MONDAY_FIRST_WEEKDAYS } from './HourGrid.js';
import { CountDelta, DurationDelta, RateDelta } from './ReportDeltas.js';

/** The figures of a set of stays — mirrors `QueueCounts` in the contract. */
interface QueueCounts {
  entries: number;
  assigned: number;
  abandoned: number;
  closed_by_agent: number;
  transferred: number;
  timeout: number;
  waiting: number;
  avg_wait_seconds: number | null;
  p80_wait_seconds: number | null;
  max_wait_seconds: number | null;
  abandon_avg_wait_seconds: number | null;
}

interface QueueTeamRow extends QueueCounts {
  team_id: number | null;
  name: string | null;
  assigned_rate: number | null;
  abandonment_rate: number | null;
}

interface QueueReportBody {
  timezone: string;
  totals: QueueCounts & { assigned_rate: number | null; abandonment_rate: number | null };
  by_day: Array<QueueCounts & { date: string }>;
  heatmap: Array<QueueCounts & { weekday: number; hour: number }>;
  by_team: QueueTeamRow[];
  previous_period: {
    entries: number;
    assigned: number;
    abandoned: number;
    avg_wait_seconds: number | null;
    p80_wait_seconds: number | null;
    assigned_rate: number | null;
    abandonment_rate: number | null;
  };
}

export type ReportsQueue = QueueReportBody;

export interface ReportsQueueAbandonment extends QueueReportBody {
  by_wait: Array<{
    key: 'under_30s' | '30s_to_1m' | '1m_to_2m' | '2m_to_5m' | '5m_to_10m' | 'over_10m';
    from_seconds: number;
    to_seconds: number | null;
    abandoned: number;
  }>;
}

interface ViewProps<T> {
  data: T | undefined;
  isPending: boolean;
  error: unknown;
}

const NUMERIC = 'px-4 py-2 text-right text-xs font-medium text-content-secondary';
const CELL = 'tabular px-4 py-2 text-right';

/** Five steps, written out so the class names are visible to Tailwind. */
function shadeClass(count: number, max: number, tone: 'brand' | 'danger'): string {
  if (count <= 0 || max <= 0) return 'text-content-tertiary';
  const ratio = count / max;
  if (tone === 'danger') {
    if (ratio > 0.75) return 'bg-danger/60 font-semibold text-content';
    if (ratio > 0.5) return 'bg-danger/40 font-semibold text-content';
    if (ratio > 0.25) return 'bg-danger/25 text-content';
    return 'bg-danger/10 text-content';
  }
  if (ratio > 0.75) return 'bg-brand-500/60 font-semibold text-content';
  if (ratio > 0.5) return 'bg-brand-500/40 font-semibold text-content';
  if (ratio > 0.25) return 'bg-brand-500/25 text-content';
  return 'bg-brand-500/10 text-content';
}

/**
 * The hour × weekday grid of when stays began. Shade is relative to the busiest
 * cell and carries no meaning of its own: every cell prints its count, so the
 * grid reads without colour.
 */
function QueueHeatmap({
  cells,
  timezone,
  metric,
}: {
  cells: QueueReportBody['heatmap'];
  timezone: string;
  metric: 'entries' | 'abandoned';
}): ReactElement {
  const t = useTranslate();
  const byKey = new Map<string, number>();
  let max = 0;
  for (const cell of cells) {
    byKey.set(`${cell.weekday}-${cell.hour}`, cell[metric]);
    if (cell[metric] > max) max = cell[metric];
  }
  const tone = metric === 'abandoned' ? 'danger' : 'brand';
  return (
    <HourGrid
      caption={t(`reports.queue.heatmap.caption.${metric}`, { timezone })}
      weekdays={MONDAY_FIRST_WEEKDAYS}
      renderCell={(row, hour) => {
        const count = byKey.get(`${row + 1}-${hour}`) ?? 0;
        return (
          <td
            title={t(`reports.queue.heatmap.cellTitle.${metric}`, {
              count: formatCount(count) ?? '0',
            })}
            className={`tabular px-1 py-1.5 text-center ${shadeClass(count, max, tone)}`}
          >
            {formatCount(count)}
          </td>
        );
      }}
    />
  );
}

function Loading(): ReactElement {
  return (
    <>
      <CardSkeleton rows={2} />
      <CardSkeleton rows={6} />
    </>
  );
}

/** Seconds as the report's duration, or a dash when there is nothing to average. */
const wait = (seconds: number | null): string => formatDuration(seconds) ?? '—';

/** The queue (RP-04): how many entered, how long they waited, how many were assigned. */
export function QueueTab({ data, isPending, error }: ViewProps<ReportsQueue>): ReactElement {
  const t = useTranslate();
  if (error) return <ErrorNotice message={t('reports.queue.error')} />;
  if (isPending || !data) return <Loading />;

  const { totals } = data;
  const prev = data.previous_period;
  return (
    <>
      <Section
        title={t('reports.queue.summary.title')}
        description={t('reports.queue.summary.description')}
      >
        <KpiGrid>
          <Kpi
            label={t('reports.queue.kpi.entries')}
            value={formatCount(totals.entries)}
            delta={<CountDelta current={totals.entries} previous={prev.entries} />}
            hint={
              totals.waiting > 0
                ? t('reports.queue.kpi.entriesHint', {
                    waiting: formatCount(totals.waiting) ?? '0',
                  })
                : undefined
            }
          />
          <Kpi
            label={t('reports.queue.kpi.assignedRate')}
            value={formatRate(totals.assigned_rate)}
            delta={<RateDelta current={totals.assigned_rate} previous={prev.assigned_rate} />}
            hint={t('reports.queue.kpi.assignedRateHint', {
              count: formatCount(totals.assigned) ?? '0',
            })}
          />
          <Kpi
            label={t('reports.queue.kpi.avgWait')}
            value={wait(totals.avg_wait_seconds)}
            delta={
              <DurationDelta current={totals.avg_wait_seconds} previous={prev.avg_wait_seconds} />
            }
            hint={t('reports.queue.kpi.waitHint')}
          />
          <Kpi
            label={t('reports.queue.kpi.p80Wait')}
            value={wait(totals.p80_wait_seconds)}
            delta={
              <DurationDelta current={totals.p80_wait_seconds} previous={prev.p80_wait_seconds} />
            }
            hint={t('reports.queue.kpi.p80Hint')}
          />
          <Kpi label={t('reports.queue.kpi.maxWait')} value={wait(totals.max_wait_seconds)} />
          <Kpi
            label={t('reports.queue.kpi.abandoned')}
            value={formatCount(totals.abandoned)}
            delta={<CountDelta current={totals.abandoned} previous={prev.abandoned} />}
            hint={
              totals.abandonment_rate === null
                ? undefined
                : t('reports.queue.kpi.abandonedHint', {
                    rate: formatRate(totals.abandonment_rate) ?? '',
                  })
            }
            tone={totals.abandoned > 0 ? 'warn' : 'neutral'}
          />
        </KpiGrid>
      </Section>

      {totals.entries === 0 ? (
        <Card>
          <EmptyState
            title={t('reports.queue.emptyTitle')}
            description={t('reports.queue.emptyDescription')}
          />
        </Card>
      ) : (
        <>
          <Section
            title={t('reports.queue.heatmap.title')}
            description={t('reports.queue.heatmap.description', { timezone: data.timezone })}
          >
            <Card>
              <QueueHeatmap cells={data.heatmap} timezone={data.timezone} metric="entries" />
            </Card>
          </Section>

          <Section
            title={t('reports.common.byDay')}
            description={t('reports.queue.byDay.description', { timezone: data.timezone })}
          >
            <Card>
              <CardTable className="w-full text-sm">
                <caption className="sr-only">{t('reports.queue.byDay.caption')}</caption>
                <thead>
                  <tr className="border-b border-border text-left">
                    <th
                      scope="col"
                      className="px-4 py-2 text-xs font-medium text-content-secondary"
                    >
                      {t('reports.common.dayColumn')}
                    </th>
                    <th scope="col" className={NUMERIC}>
                      {t('reports.queue.column.entries')}
                    </th>
                    <th scope="col" className={NUMERIC}>
                      {t('reports.queue.column.assigned')}
                    </th>
                    <th scope="col" className={NUMERIC}>
                      {t('reports.queue.column.abandoned')}
                    </th>
                    <th scope="col" className={NUMERIC}>
                      {t('reports.queue.column.avgWait')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_day.map((row) => (
                    <tr key={row.date} className="border-b border-border last:border-0">
                      <td className="px-4 py-2">{formatDay(row.date) ?? row.date}</td>
                      <td className={`${CELL} font-medium`}>{formatCount(row.entries)}</td>
                      <td className={CELL}>{formatCount(row.assigned)}</td>
                      <td className={CELL}>{formatCount(row.abandoned)}</td>
                      <td className={CELL}>{wait(row.avg_wait_seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </CardTable>
            </Card>
          </Section>

          <Section
            title={t('reports.queue.byTeam.title')}
            description={t('reports.queue.byTeam.description')}
          >
            <Card>
              <CardTable className="w-full text-sm">
                <caption className="sr-only">{t('reports.queue.byTeam.caption')}</caption>
                <thead>
                  <tr className="border-b border-border text-left">
                    <th
                      scope="col"
                      className="px-4 py-2 text-xs font-medium text-content-secondary"
                    >
                      {t('reports.breakdown.byTeam.column')}
                    </th>
                    <th scope="col" className={NUMERIC}>
                      {t('reports.queue.column.entries')}
                    </th>
                    <th scope="col" className={NUMERIC}>
                      {t('reports.queue.column.assignedRate')}
                    </th>
                    <th scope="col" className={NUMERIC}>
                      {t('reports.queue.column.abandoned')}
                    </th>
                    <th scope="col" className={NUMERIC}>
                      {t('reports.queue.column.avgWait')}
                    </th>
                    <th scope="col" className={NUMERIC}>
                      {t('reports.queue.column.p80Wait')}
                    </th>
                    <th scope="col" className={NUMERIC}>
                      {t('reports.queue.column.maxWait')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_team.map((row) => (
                    <tr
                      key={String(row.team_id ?? 'unassigned')}
                      className="border-b border-border last:border-0"
                    >
                      <td className="truncate px-4 py-2">
                        {row.name ?? t('reports.breakdown.byTeam.unassigned')}
                      </td>
                      <td className={`${CELL} font-medium`}>{formatCount(row.entries)}</td>
                      <td className={CELL}>{formatRate(row.assigned_rate) ?? '—'}</td>
                      <td className={CELL}>{formatCount(row.abandoned)}</td>
                      <td className={CELL}>{wait(row.avg_wait_seconds)}</td>
                      <td className={CELL}>{wait(row.p80_wait_seconds)}</td>
                      <td className={CELL}>{wait(row.max_wait_seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </CardTable>
            </Card>
          </Section>
        </>
      )}
    </>
  );
}

/** Queue abandonment (RP-04): who gave up, after how long, when and for which team. */
export function QueueAbandonmentTab({
  data,
  isPending,
  error,
}: ViewProps<ReportsQueueAbandonment>): ReactElement {
  const t = useTranslate();
  if (error) return <ErrorNotice message={t('reports.queueAbandonment.error')} />;
  if (isPending || !data) return <Loading />;

  const { totals } = data;
  const prev = data.previous_period;
  const mostInABand = Math.max(1, ...data.by_wait.map((band) => band.abandoned));
  return (
    <>
      <Section
        title={t('reports.queueAbandonment.summary.title')}
        description={t('reports.queueAbandonment.summary.description')}
      >
        <KpiGrid>
          <Kpi
            label={t('reports.queueAbandonment.kpi.abandoned')}
            value={formatCount(totals.abandoned)}
            delta={<CountDelta current={totals.abandoned} previous={prev.abandoned} />}
            tone={totals.abandoned > 0 ? 'warn' : 'neutral'}
          />
          <Kpi
            label={t('reports.queueAbandonment.kpi.rate')}
            value={formatRate(totals.abandonment_rate)}
            delta={<RateDelta current={totals.abandonment_rate} previous={prev.abandonment_rate} />}
            hint={
              totals.abandonment_rate === null
                ? t('reports.queueAbandonment.kpi.rateNone')
                : t('reports.queueAbandonment.kpi.rateHint', {
                    entries: formatCount(totals.entries) ?? '0',
                  })
            }
          />
          <Kpi
            label={t('reports.queueAbandonment.kpi.avgWait')}
            value={wait(totals.abandon_avg_wait_seconds)}
            hint={t('reports.queueAbandonment.kpi.avgWaitHint')}
          />
          <Kpi
            label={t('reports.queueAbandonment.kpi.entries')}
            value={formatCount(totals.entries)}
            delta={<CountDelta current={totals.entries} previous={prev.entries} />}
          />
        </KpiGrid>
      </Section>

      {totals.abandoned === 0 ? (
        <Card>
          <EmptyState
            title={t('reports.queueAbandonment.emptyTitle')}
            description={t('reports.queueAbandonment.emptyDescription')}
          />
        </Card>
      ) : (
        <>
          <Section
            title={t('reports.queueAbandonment.byWait.title')}
            description={t('reports.queueAbandonment.byWait.description')}
          >
            <Card>
              <CardTable className="w-full text-sm">
                <caption className="sr-only">
                  {t('reports.queueAbandonment.byWait.caption')}
                </caption>
                <thead>
                  <tr className="border-b border-border text-left">
                    <th
                      scope="col"
                      className="px-4 py-2 text-xs font-medium text-content-secondary"
                    >
                      {t('reports.queueAbandonment.byWait.column')}
                    </th>
                    <th scope="col" className={NUMERIC}>
                      {t('reports.queue.column.abandoned')}
                    </th>
                    <th scope="col" className="w-1/2 px-4 py-2">
                      <span className="sr-only">{t('reports.queueAbandonment.byWait.bar')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_wait.map((band) => (
                    <tr key={band.key} className="border-b border-border last:border-0">
                      <td className="px-4 py-2">
                        {t(`reports.queueAbandonment.band.${band.key}`)}
                      </td>
                      <td className={`${CELL} font-medium`}>{formatCount(band.abandoned)}</td>
                      <td className="px-4 py-2" aria-hidden="true">
                        <div
                          className="h-2 rounded-sm bg-danger/50"
                          style={{ width: `${Math.round((band.abandoned / mostInABand) * 100)}%` }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </CardTable>
            </Card>
          </Section>

          <Section
            title={t('reports.queueAbandonment.heatmap.title')}
            description={t('reports.queueAbandonment.heatmap.description', {
              timezone: data.timezone,
            })}
          >
            <Card>
              <QueueHeatmap cells={data.heatmap} timezone={data.timezone} metric="abandoned" />
            </Card>
          </Section>

          <Section
            title={t('reports.common.byDay')}
            description={t('reports.queueAbandonment.byDay.description', {
              timezone: data.timezone,
            })}
          >
            <Card>
              <AbandonmentTable
                caption={t('reports.queueAbandonment.byDay.caption')}
                firstColumn={t('reports.common.dayColumn')}
                rows={data.by_day.map((row) => ({
                  key: row.date,
                  label: formatDay(row.date) ?? row.date,
                  entries: row.entries,
                  abandoned: row.abandoned,
                  rate: null,
                  avgWait: row.abandon_avg_wait_seconds,
                }))}
              />
            </Card>
          </Section>

          <Section
            title={t('reports.queue.byTeam.title')}
            description={t('reports.queueAbandonment.byTeam.description')}
          >
            <Card>
              <AbandonmentTable
                caption={t('reports.queueAbandonment.byTeam.caption')}
                firstColumn={t('reports.breakdown.byTeam.column')}
                rows={data.by_team.map((row) => ({
                  key: String(row.team_id ?? 'unassigned'),
                  label: row.name ?? t('reports.breakdown.byTeam.unassigned'),
                  entries: row.entries,
                  abandoned: row.abandoned,
                  rate: row.abandonment_rate,
                  avgWait: row.abandon_avg_wait_seconds,
                }))}
              />
            </Card>
          </Section>
        </>
      )}
    </>
  );
}

/** A label column plus entries, abandoned, the share (teams) and the mean wait before leaving. */
function AbandonmentTable({
  caption,
  firstColumn,
  rows,
}: {
  caption: string;
  firstColumn: string;
  rows: Array<{
    key: string;
    label: string;
    entries: number;
    abandoned: number;
    rate: number | null;
    avgWait: number | null;
  }>;
}): ReactElement {
  const t = useTranslate();
  const showRate = rows.some((row) => row.rate !== null);
  return (
    <CardTable className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
            {firstColumn}
          </th>
          <th scope="col" className={NUMERIC}>
            {t('reports.queue.column.entries')}
          </th>
          <th scope="col" className={NUMERIC}>
            {t('reports.queue.column.abandoned')}
          </th>
          {showRate && (
            <th scope="col" className={NUMERIC}>
              {t('reports.queueAbandonment.column.rate')}
            </th>
          )}
          <th scope="col" className={NUMERIC}>
            {t('reports.queueAbandonment.column.avgWait')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-border last:border-0">
            <td className="truncate px-4 py-2">{row.label}</td>
            <td className={CELL}>{formatCount(row.entries)}</td>
            <td className={`${CELL} font-medium`}>{formatCount(row.abandoned)}</td>
            {showRate && <td className={CELL}>{formatRate(row.rate) ?? '—'}</td>}
            <td className={CELL}>{wait(row.avgWait)}</td>
          </tr>
        ))}
      </tbody>
    </CardTable>
  );
}
