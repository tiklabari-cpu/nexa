/**
 * Availability and agent activity (RP-03 · tm 370): the two Reports tabs over
 * `GET /reports/availability` and `GET /reports/agent-activity`, and the team
 * profile's "Today's activity".
 *
 * Who appears is the server's decision (05 RP-03 decision 2): a Team Member
 * reads only themselves, a Team Lead the members of the teams they lead,
 * Yönetici/Kurucu everyone. The page sends only the agent and team filter
 * keys these reports take; tag and topic are conversation keys and are
 * named as not applying rather than silently dropped.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Card, CardSkeleton, ErrorNotice, Kpi, KpiGrid, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { useApiClient } from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { formatDecimal, formatDuration, formatRate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  ACTIVITY_STATE_LABEL_KEYS,
  ActivityLegend,
  ActivityStrip,
  StateSwatch,
  type ActivitySegmentView,
  type ActivityState,
} from './ActivityStrip.js';
import type { ReportFilterState } from './report-filters.js';

/** Mirrors `AVAILABILITY_MAX_DAYS` (`@siyahtus/types`). */
export const AVAILABILITY_MAX_DAYS = 31;

type StateSeconds = Record<`${ActivityState}_seconds`, number>;

interface ReportsAvailability {
  range: { from: string; to: string };
  timezone: string;
  agents: number;
  totals: StateSeconds;
  by_hour: Array<
    { hour: number; mean_accepting_agents: number } & Record<`${ActivityState}_minutes`, number>
  >;
  by_agent: Array<
    StateSeconds & {
      agent_id: string;
      name: string | null;
      disconnects: number;
      unresponsive_pauses: number;
      planned_seconds: number | null;
      planned_accepting_seconds: number | null;
    }
  >;
}

interface AgentActivityRow extends StateSeconds {
  agent_id: string;
  name: string | null;
  segments: ActivitySegmentView[];
  planned: Array<{ from: string; to: string }> | null;
}

interface ReportsAgentActivity {
  date: string;
  timezone: string;
  range: { from: string; to: string };
  as_of: string;
  agents: AgentActivityRow[];
  next_cursor: string | null;
}

/** The agent and team keys of the report filter, as query parameters. */
/**
 * How long a report window is, in ms. A calendar-day end (`2026-11-05`, what
 * a custom range sends) counts its whole day, as the API reads it — so a
 * 31-day pick is 31 days here too, not 30.
 */
function rangeSpanMs(range: { from: string; to: string }): number {
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/;
  const to = Date.parse(range.to) + (dayOnly.test(range.to) ? 86_400_000 : 0);
  return to - Date.parse(range.from);
}

function personParams(filter: ReportFilterState): URLSearchParams {
  const params = new URLSearchParams();
  for (const id of filter.agent_id) params.append('agent_id', id);
  for (const id of filter.group_id) params.append('group_id', id);
  return params;
}

function hours(seconds: number | null | undefined): string {
  return formatDuration(seconds ?? null, undefined, 'hour') ?? '—';
}

function ConversationKeysNote({ filter }: { filter: ReportFilterState }): ReactElement | null {
  const t = useTranslate();
  if (filter.tag.length === 0 && filter.topic.length === 0) return null;
  return (
    <p role="note" className="text-xs text-content-secondary">
      {t('reports.activity.filterNote')}
    </p>
  );
}

const STATE_COLUMNS: ReadonlyArray<Exclude<ActivityState, 'unknown'>> = [
  'accepting',
  'not_accepting',
  'offline',
  'disconnected',
];

/** Availability: time per state, the hour-of-day picture, and each agent against their plan. */
export function AvailabilityTab({
  range,
  rangeKey,
  filter,
}: {
  range: { from: string; to: string };
  rangeKey: string;
  filter: ReportFilterState;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const tooLong = rangeSpanMs(range) > AVAILABILITY_MAX_DAYS * 86_400_000;
  const params = personParams(filter);
  params.set('from', range.from);
  params.set('to', range.to);
  const query = useQuery({
    queryKey: ['reports', 'availability', rangeKey, personParams(filter).toString()],
    enabled: !tooLong,
    queryFn: () => api.get<ReportsAvailability>(`/reports/availability?${params.toString()}`),
  });

  if (tooLong) {
    return (
      <Card>
        <EmptyState
          title={t('reports.availability.tooLong.title')}
          description={t('reports.availability.tooLong.description', {
            days: AVAILABILITY_MAX_DAYS,
          })}
        />
      </Card>
    );
  }
  if (query.error) return <ErrorNotice message={t('reports.availability.error')} />;
  if (query.isPending) {
    return (
      <>
        <CardSkeleton rows={2} />
        <CardSkeleton rows={6} />
      </>
    );
  }
  const data = query.data;
  const numeric = 'px-3 py-2 text-right text-xs font-medium text-content-secondary';

  return (
    <>
      <ConversationKeysNote filter={filter} />
      <Section
        title={t('reports.availability.summary.title')}
        description={t('reports.availability.summary.description', {
          count: data.agents,
        })}
      >
        <KpiGrid>
          {STATE_COLUMNS.map((state) => (
            <Kpi
              key={state}
              label={t(ACTIVITY_STATE_LABEL_KEYS[state])}
              value={hours(data.totals[`${state}_seconds`])}
              tone={
                state === 'disconnected' && data.totals.disconnected_seconds > 0
                  ? 'warn'
                  : 'neutral'
              }
            />
          ))}
        </KpiGrid>
      </Section>

      {data.agents === 0 ? (
        <Card>
          <EmptyState
            title={t('reports.availability.emptyTitle')}
            description={t('reports.availability.emptyDescription')}
          />
        </Card>
      ) : (
        <>
          <Section
            title={t('reports.common.byAgent')}
            description={t('reports.availability.byAgent.description')}
          >
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t('reports.availability.byAgent.caption')}</caption>
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th
                        scope="col"
                        className="px-3 py-2 text-xs font-medium text-content-secondary"
                      >
                        {t('reports.common.agentColumn')}
                      </th>
                      {STATE_COLUMNS.map((state) => (
                        <th key={state} scope="col" className={numeric}>
                          {t(ACTIVITY_STATE_LABEL_KEYS[state])}
                        </th>
                      ))}
                      <th scope="col" className={numeric}>
                        {t('reports.activity.planned')}
                      </th>
                      <th scope="col" className={numeric}>
                        {t('reports.availability.column.acceptingInPlan')}
                      </th>
                      <th scope="col" className={numeric}>
                        {t('reports.availability.column.disconnects')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_agent.map((row) => (
                      <tr key={row.agent_id} className="border-b border-border last:border-0">
                        <td className="truncate px-3 py-2">
                          {row.name ?? t('reports.common.unknownAgent')}
                        </td>
                        {STATE_COLUMNS.map((state) => (
                          <td key={state} className="tabular px-3 py-2 text-right">
                            {hours(row[`${state}_seconds`])}
                          </td>
                        ))}
                        <td className="tabular px-3 py-2 text-right">
                          {row.planned_seconds === null
                            ? t('reports.availability.noPlan')
                            : hours(row.planned_seconds)}
                        </td>
                        <td className="tabular px-3 py-2 text-right">
                          {row.planned_seconds
                            ? (formatRate(
                                (row.planned_accepting_seconds ?? 0) / row.planned_seconds,
                              ) ?? '—')
                            : '—'}
                        </td>
                        <td className="tabular px-3 py-2 text-right">{row.disconnects}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </Section>

          <Section
            title={t('reports.availability.byHour.title')}
            description={t('reports.availability.byHour.description', {
              timezone: data.timezone,
            })}
          >
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    {t('reports.availability.byHour.caption', { timezone: data.timezone })}
                  </caption>
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th
                        scope="col"
                        className="px-3 py-2 text-xs font-medium text-content-secondary"
                      >
                        {t('reports.availability.column.hour')}
                      </th>
                      <th scope="col" className={numeric}>
                        {t('reports.availability.column.meanAccepting')}
                      </th>
                      {STATE_COLUMNS.map((state) => (
                        <th key={state} scope="col" className={numeric}>
                          <span className="inline-flex items-center gap-1.5">
                            <StateSwatch state={state} />
                            {t(ACTIVITY_STATE_LABEL_KEYS[state])}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_hour.map((row) => (
                      <tr key={row.hour} className="border-b border-border last:border-0">
                        <th scope="row" className="tabular px-3 py-1.5 text-left font-normal">
                          {`${String(row.hour).padStart(2, '0')}:00`}
                        </th>
                        <td className="tabular px-3 py-1.5 text-right font-medium">
                          {formatDecimal(row.mean_accepting_agents)}
                        </td>
                        {STATE_COLUMNS.map((state) => (
                          <td key={state} className="tabular px-3 py-1.5 text-right">
                            {hours(row[`${state}_minutes`] * 60)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </Section>
        </>
      )}
    </>
  );
}

function useAgentActivity(date: string, filter: ReportFilterState, agentId?: string) {
  const api = useApiClient();
  const base = agentId ? new URLSearchParams({ agent_id: agentId }) : personParams(filter);
  if (date) base.set('date', date);
  const key = base.toString();
  return useInfiniteQuery({
    queryKey: ['reports', 'agent-activity', key],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(key);
      if (pageParam) params.set('cursor', pageParam);
      return api.get<ReportsAgentActivity>(`/reports/agent-activity?${params.toString()}`);
    },
    getNextPageParam: (last) => last.next_cursor,
    retry: (count, error) =>
      !(error instanceof ApiClientError && error.status === 403) && count < 2,
  });
}

function AgentDayRow({
  row,
  page,
}: {
  row: AgentActivityRow;
  page: ReportsAgentActivity;
}): ReactElement {
  const t = useTranslate();
  const name = row.name ?? t('reports.common.unknownAgent');
  return (
    <li className="grid grid-cols-[minmax(8rem,12rem)_1fr] items-start gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-xs text-content-secondary">
          {t('reports.activity.acceptingTotal', { duration: hours(row.accepting_seconds) })}
        </p>
      </div>
      <ActivityStrip
        label={name}
        segments={row.segments}
        planned={row.planned}
        range={page.range}
        timezone={page.timezone}
      />
    </li>
  );
}

/** Agent activity: one workspace day, an agent × hour strip each, the plan underneath. */
export function AgentActivityTab({ filter }: { filter: ReportFilterState }): ReactElement {
  const t = useTranslate();
  const [date, setDate] = useState('');
  const query = useAgentActivity(date, filter);
  const first = query.data?.pages[0];
  const rows = query.data?.pages.flatMap((page) => page.agents) ?? [];
  const showPlan = rows.some((row) => row.planned !== null);

  return (
    <>
      <ConversationKeysNote filter={filter} />
      <Section
        title={t('reports.activity.title')}
        description={
          first
            ? t('reports.activity.description', { timezone: first.timezone })
            : t('reports.activity.descriptionLoading')
        }
      >
        <Card>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <label className="flex flex-col gap-1 text-xs text-content-secondary">
              {t('reports.activity.day')}
              <input
                type="date"
                value={date || first?.date || ''}
                onChange={(event) => setDate(event.target.value)}
                className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content"
              />
            </label>
            <ActivityLegend showPlan={showPlan} />
          </div>
          {query.error ? (
            <ErrorNotice
              message={
                query.error instanceof ApiClientError && query.error.status === 400
                  ? t('reports.activity.futureDay')
                  : t('reports.activity.error')
              }
            />
          ) : query.isPending ? (
            <CardSkeleton rows={4} />
          ) : rows.length === 0 ? (
            <EmptyState
              title={t('reports.availability.emptyTitle')}
              description={t('reports.availability.emptyDescription')}
            />
          ) : (
            <>
              <ul className="divide-y divide-border">
                {query.data.pages.map((page) =>
                  page.agents.map((row) => (
                    <AgentDayRow key={row.agent_id} row={row} page={page} />
                  )),
                )}
              </ul>
              {query.hasNextPage && (
                <button
                  type="button"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                  className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  {t('reports.activity.more')}
                </button>
              )}
            </>
          )}
        </Card>
      </Section>
    </>
  );
}

/**
 * "Today's activity" on a teammate's profile. Renders nothing when the caller
 * may not read this person (403) — the panel simply has no such section for
 * them, rather than an error about a report they never asked for.
 */
export function AgentDayActivity({ agentId }: { agentId: string }): ReactElement | null {
  const t = useTranslate();
  const query = useAgentActivity('', { agent_id: [], group_id: [], tag: [], topic: [] }, agentId);
  if (query.error instanceof ApiClientError && query.error.status === 403) return null;
  const page = query.data?.pages[0];
  const row = page?.agents[0];
  return (
    <section aria-labelledby={`today-${agentId}`} className="mt-4 border-t border-border pt-3">
      <h3 id={`today-${agentId}`} className="text-xs text-content-secondary">
        {t('reports.activity.today')}
      </h3>
      {query.error ? (
        <p className="mt-1 text-sm text-danger">{t('reports.activity.error')}</p>
      ) : !page || !row ? (
        <CardSkeleton rows={1} />
      ) : (
        <div className="mt-2 space-y-2">
          <ActivityStrip
            label={row.name ?? t('reports.common.unknownAgent')}
            segments={row.segments}
            planned={row.planned}
            range={page.range}
            timezone={page.timezone}
          />
          <p className="text-xs text-content-secondary">
            {t('reports.activity.acceptingTotal', { duration: hours(row.accepting_seconds) })}
          </p>
          <ActivityLegend showPlan={row.planned !== null} />
        </div>
      )}
    </section>
  );
}
