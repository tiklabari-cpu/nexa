/**
 * The Reports filter bar (RP-01 · tm 368.2): one chip per filter — agent, team,
 * tag, topic — each opening a checklist, several values allowed per chip
 * (any-of within a chip, all-of across chips — the server's reading).
 *
 * The filter lives in the address (`report-filters.ts`, identifiers only), so
 * this bar holds no state of its own besides a checklist's search box: it reads
 * the filter, reports a change, and the page writes it back to the address.
 * That is what makes `/app/reports?group_id=5&agent_id=<uuid>` open filtered,
 * and what a saved view stores.
 *
 * A Team Lead holds `reports_read--groups`, not `reports_read`: the server
 * counts only the teams they lead, whatever the address asks for (the
 * intersection is the server's, never the browser's). The bar tells the truth
 * about that rather than enforcing it — the team chip is locked to those teams,
 * names them, and says so when the address names a team outside them.
 *
 * Filters never leave the four conversation reports: on any other tab the bar
 * is absent, and while a filter is set it says that tab is unfiltered rather
 * than leaving the person to wonder why the figures did not move.
 */
import { useQuery } from '@tanstack/react-query';
import { REPORT_FILTER_MAX_VALUES } from '@siyahtus/types';
import type { ReactElement } from 'react';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { CheckList, Chip, summarise, type Option } from '../archive/ArchiveFilters.js';
import { useAgentRoster, useTagLibrary } from '../archive/useArchive.js';
import { isReportFilterEmpty, type ReportFilterState } from './report-filters.js';

interface TeamRow {
  id: number;
  name: string;
  agents?: Array<{ agent_id: string; lead?: boolean }>;
}

/** The workspace's teams, with who leads each — the same cache the Team page reads. */
function useReportTeams() {
  const api = useApiClient();
  return useQuery({
    queryKey: ['team', 'groups'],
    queryFn: () => api.get<{ items: TeamRow[] }>('/groups'),
    staleTime: 60_000,
  });
}

interface AiBreakdownRows {
  rows: Array<{ key: string | null; label: string | null }>;
}

/**
 * The topics the AI recorded in the window (AI-05) — read from its own
 * breakdown by topic, so every option is a value the filter can match. Fetched
 * when the chip is opened, not on every visit to the page.
 */
function TopicOptions({
  rangeKey,
  range,
  open,
  selected,
  onChange,
}: {
  open: boolean;
  rangeKey: string;
  range: { from: string; to: string } | null;
  selected: readonly string[];
  onChange: (next: string[]) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const topics = useQuery({
    queryKey: ['reports', 'filter-options', 'topics', rangeKey],
    enabled: range !== null && open,
    staleTime: 60_000,
    queryFn: () => {
      const { from, to } = range as { from: string; to: string };
      const query = new URLSearchParams({ from, to, by: 'intent' }).toString();
      return api.get<AiBreakdownRows>(`/reports/ai-agent/breakdown?${query}`);
    },
  });
  if (topics.isError) {
    return <p className="text-xs text-danger">{t('archive.filter.loadFailed')}</p>;
  }
  const known = new Map<string, string>();
  for (const row of topics.data?.rows ?? []) {
    if (row.key !== null) known.set(row.key, row.label ?? row.key);
  }
  // A topic the address names stays in the list so it can be unticked, even
  // when this window has no conversation under it.
  for (const value of selected) if (!known.has(value)) known.set(value, value);
  const options: Option<string>[] = [...known]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (options.length === 0 && !topics.isPending) {
    return <p className="text-xs text-content-secondary">{t('reports.filters.topic.none')}</p>;
  }
  return (
    <CheckList
      legend={t('reports.filters.topic.label')}
      options={options}
      selected={selected}
      onChange={onChange}
      max={REPORT_FILTER_MAX_VALUES}
      limitNote={t('archive.filter.limit', { max: REPORT_FILTER_MAX_VALUES })}
      search={{ label: t('archive.filter.search') }}
    />
  );
}

export function ReportFilterBar({
  filter,
  onChange,
  applies,
  scoped,
  rangeKey,
  range,
}: {
  filter: ReportFilterState;
  onChange: (next: ReportFilterState) => void;
  /** Whether the open tab's report takes a filter. */
  applies: boolean;
  /** The reader holds `reports_read--groups` only: the teams are the ones they lead. */
  scoped: boolean;
  rangeKey: string;
  range: { from: string; to: string } | null;
}): ReactElement | null {
  const t = useTranslate();
  const accountId = useAuth((s) => s.agent?.account_id ?? null);
  const roster = useAgentRoster(applies);
  const library = useTagLibrary();
  const teams = useReportTeams();
  const empty = isReportFilterEmpty(filter);

  const set = (patch: Partial<ReportFilterState>): void => onChange({ ...filter, ...patch });

  if (!applies) {
    if (empty) return null;
    return (
      <div
        role="note"
        className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-inset px-3 py-2 text-xs text-content-secondary"
      >
        <span>{t('reports.filters.notApplicable')}</span>
        <button
          type="button"
          onClick={() => onChange({ agent_id: [], group_id: [], tag: [], topic: [] })}
          className="font-medium text-brand-600 hover:underline"
        >
          {t('reports.filters.clearAll')}
        </button>
      </div>
    );
  }

  // --- Names for what the address names by identifier ---------------------------
  const agentNames = new Map(
    (roster.data?.items ?? []).map((member) => [
      member.id,
      member.name ?? t('archive.filter.agent.unnamed'),
    ]),
  );
  const tagNames = new Map((library.data?.items ?? []).map((tag) => [tag.id, tag.name]));
  const allTeams = teams.data?.items ?? [];
  // A Team Lead's list is the teams they lead; everyone else with the page sees all.
  const ledTeams = allTeams.filter((team) =>
    team.agents?.some((member) => member.agent_id === accountId && member.lead === true),
  );
  const teamRows = scoped ? ledTeams : allTeams;
  const teamNames = new Map(allTeams.map((team) => [String(team.id), team.name]));

  const sorted = <T extends string>(entries: Iterable<[T, string]>): Option<T>[] =>
    [...entries]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  const agentOptions = sorted(agentNames);
  const tagOptions = sorted(tagNames);
  const teamOptions = sorted(
    teamRows.map((team): [string, string] => [String(team.id), team.name]),
  );

  const ledIds = new Set(ledTeams.map((team) => String(team.id)));
  const outOfReach = scoped && teams.isSuccess && filter.group_id.some((id) => !ledIds.has(id));

  const summary = (names: (string | undefined)[], count: number): string | null =>
    count === 0 ? null : summarise(t, names, count);

  return (
    <div role="group" aria-label={t('reports.filters.region')} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          label={t('reports.filters.agent.label')}
          summary={summary(
            filter.agent_id.map((id) => agentNames.get(id)),
            filter.agent_id.length,
          )}
          onClear={() => set({ agent_id: [] })}
        >
          {roster.isError ? (
            <p className="text-xs text-danger">{t('archive.filter.loadFailed')}</p>
          ) : (
            <CheckList
              legend={t('reports.filters.agent.label')}
              options={agentOptions}
              selected={filter.agent_id}
              onChange={(agent_id) => set({ agent_id })}
              max={REPORT_FILTER_MAX_VALUES}
              limitNote={t('archive.filter.limit', { max: REPORT_FILTER_MAX_VALUES })}
              search={{ label: t('archive.filter.search') }}
            />
          )}
        </Chip>

        <Chip
          label={t('reports.filters.team.label')}
          summary={
            filter.group_id.length > 0
              ? summarise(
                  t,
                  filter.group_id.map((id) => teamNames.get(id)),
                  filter.group_id.length,
                )
              : scoped
                ? t('reports.filters.team.yours')
                : null
          }
          onClear={() => set({ group_id: [] })}
          hideClear={scoped && filter.group_id.length === 0}
        >
          {teams.isError ? (
            <p className="text-xs text-danger">{t('archive.filter.loadFailed')}</p>
          ) : (
            <>
              {scoped && (
                <p className="text-2xs text-content-tertiary">
                  {t('reports.filters.team.lockedHint')}
                </p>
              )}
              <CheckList
                legend={t('reports.filters.team.label')}
                options={teamOptions}
                selected={filter.group_id}
                onChange={(group_id) => set({ group_id })}
                max={REPORT_FILTER_MAX_VALUES}
                limitNote={t('archive.filter.limit', { max: REPORT_FILTER_MAX_VALUES })}
                search={{ label: t('archive.filter.search') }}
              />
            </>
          )}
        </Chip>

        <Chip
          label={t('reports.filters.tag.label')}
          summary={summary(
            filter.tag.map((id) => tagNames.get(id) ?? t('reports.filters.tag.unknown')),
            filter.tag.length,
          )}
          onClear={() => set({ tag: [] })}
        >
          {library.isError ? (
            <p className="text-xs text-danger">{t('archive.filter.loadFailed')}</p>
          ) : tagOptions.length === 0 && !library.isPending ? (
            <p className="text-xs text-content-secondary">{t('archive.filter.tags.none')}</p>
          ) : (
            <CheckList
              legend={t('reports.filters.tag.label')}
              options={tagOptions}
              selected={filter.tag}
              onChange={(tag) => set({ tag })}
              max={REPORT_FILTER_MAX_VALUES}
              limitNote={t('archive.filter.limit', { max: REPORT_FILTER_MAX_VALUES })}
              search={{ label: t('archive.filter.search') }}
            />
          )}
        </Chip>

        <Chip
          label={t('reports.filters.topic.label')}
          summary={summary(filter.topic, filter.topic.length)}
          onClear={() => set({ topic: [] })}
        >
          {({ open }) => (
            <TopicOptions
              open={open}
              rangeKey={rangeKey}
              range={range}
              selected={filter.topic}
              onChange={(topic) => set({ topic })}
            />
          )}
        </Chip>

        {!empty && (
          <button
            type="button"
            onClick={() => onChange({ agent_id: [], group_id: [], tag: [], topic: [] })}
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            {t('reports.filters.clearAll')}
          </button>
        )}
      </div>
      {outOfReach && (
        <p role="note" className="text-2xs text-warning">
          {t('reports.filters.team.outOfReach')}
        </p>
      )}
      {!empty && <p className="text-2xs text-content-tertiary">{t('reports.filters.note')}</p>}
    </div>
  );
}
