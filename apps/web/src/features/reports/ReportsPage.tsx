/**
 * Reports.
 *
 * Three tabs share one range control (FR-MOD-07.1): Overview, AI Agent and
 * Breakdown. Every KPI on Overview carries a vs-previous delta — the API returns
 * the equal-length window before the selected one, and the card shows the change
 * next to the baseline (FR-MOD-07.3.1).
 *
 * The "Automated" figure here is the same query that drives the invoice
 * (ADR-09): a thread that closed with no agent-authored event. Anything that
 * looks like a second definition of it belongs in the API, not here — two
 * counters meant to agree will drift, and the first person to notice is a
 * customer disputing a bill.
 */
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import {
  Card,
  CardSkeleton,
  ErrorNotice,
  Kpi,
  KpiGrid,
  Page,
  Section,
} from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { useApiClient } from '../../lib/auth-store.js';
import type { ApiClient } from '../../lib/api-client.js';
import { formatCount, formatDuration, formatRate } from '../../lib/format.js';

interface Period {
  range: { from: string; to: string };
  chats: number;
  tickets: number;
  total_cases: number;
  closed: number;
  manual: number;
  assisted: number;
  automated: number;
  avg_first_response_seconds: number | null;
  avg_duration_seconds: number | null;
  satisfaction_score: number | null;
}

interface ReportsOverview {
  range: { from: string; to: string };
  previous_period: Period;
  totals: {
    chats: number;
    tickets: number;
    total_cases: number;
    closed: number;
    manual: number;
    assisted: number;
    automated: number;
    manual_rate: number | null;
    assisted_rate: number | null;
    automated_rate: number | null;
    queued_now: number;
  };
  chats: {
    automated_per_hour: number;
    automated_avg_duration_seconds: number | null;
    total_duration_seconds: number;
  };
  response_times: {
    avg_first_response_seconds: number | null;
    avg_duration_seconds: number | null;
  };
  satisfaction: { good: number; bad: number; score: number | null; responses: number };
  by_agent: Array<{ agent_id: string; name: string | null; chats: number }>;
  top_tags: Array<{ name: string; count: number }>;
}

interface SplitRow {
  chats: number;
  closed: number;
  manual: number;
  assisted: number;
  automated: number;
}

interface ReportsBreakdown {
  range: { from: string; to: string };
  by_day: Array<SplitRow & { date: string }>;
  by_agent: Array<SplitRow & { agent_id: string; name: string | null }>;
}

interface ReportsAiAgent {
  range: { from: string; to: string };
  resolutions: number;
  resolution_rate: number | null;
  transfers: number;
  transfer_rate: number | null;
  skill_runs: number;
  avg_automated_duration_seconds: number | null;
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'ai-agent', label: 'AI Agent' },
  { id: 'breakdown', label: 'Breakdown' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const PRESETS = [7, 30, 90, 365] as const;
type RangeMode = (typeof PRESETS)[number] | 'custom';

/**
 * The selected window as ISO strings, or null when a custom range is incomplete
 * or backwards. Preset modes resolve against "now" at call time, so the query
 * key stays the stable mode rather than a timestamp that changes every render.
 */
function resolveRange(
  mode: RangeMode,
  customFrom: string,
  customTo: string,
): { from: string; to: string } | null {
  if (mode === 'custom') {
    if (!customFrom || !customTo) return null;
    const from = new Date(`${customFrom}T00:00:00.000Z`);
    const to = new Date(`${customTo}T23:59:59.999Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return null;
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const to = new Date();
  const from = new Date(to.getTime() - mode * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function rangeQuery(range: { from: string; to: string }): string {
  return `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
}

export function ReportsPage(): ReactElement {
  const [tab, setTab] = useState<TabId>('overview');
  const [mode, setMode] = useState<RangeMode>(30);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const range = resolveRange(mode, customFrom, customTo);
  // Stable across renders (unlike `range`, which re-derives "now"), so it is the
  // right thing to key a query on.
  const rangeKey = mode === 'custom' ? `custom:${customFrom}:${customTo}` : String(mode);

  return (
    <Page
      title="Reports"
      description="Conversation volume, responsiveness and satisfaction."
      actions={
        <RangeControls
          mode={mode}
          onMode={setMode}
          customFrom={customFrom}
          customTo={customTo}
          onCustomFrom={setCustomFrom}
          onCustomTo={setCustomTo}
        />
      }
    >
      <div role="tablist" aria-label="Report" className="flex gap-1 border-b border-border">
        {TABS.map((tabDef) => {
          const selected = tab === tabDef.id;
          return (
            <button
              key={tabDef.id}
              type="button"
              role="tab"
              id={`reports-tab-${tabDef.id}`}
              aria-selected={selected}
              aria-controls={`reports-panel-${tabDef.id}`}
              onClick={() => setTab(tabDef.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                selected
                  ? 'border-brand-500 text-content'
                  : 'border-transparent text-content-secondary hover:text-content'
              }`}
            >
              {tabDef.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`reports-panel-${tab}`}
        aria-labelledby={`reports-tab-${tab}`}
        className="flex flex-col gap-6"
      >
        {mode === 'custom' && range === null ? (
          <Card>
            <EmptyState
              title="Pick a date range"
              description="Choose a start and end date. The end date cannot be before the start."
            />
          </Card>
        ) : tab === 'overview' ? (
          <OverviewTab rangeKey={rangeKey} range={range} />
        ) : tab === 'ai-agent' ? (
          <AiAgentTab rangeKey={rangeKey} range={range} />
        ) : (
          <BreakdownTab rangeKey={rangeKey} range={range} />
        )}
      </div>
    </Page>
  );
}

interface TabProps {
  rangeKey: string;
  range: { from: string; to: string } | null;
}

function useReport<T>(kind: string, api: ApiClient, { rangeKey, range }: TabProps) {
  return useQuery({
    queryKey: ['reports', kind, rangeKey],
    enabled: range !== null,
    queryFn: () => api.get<T>(`/reports/${kind}?${rangeQuery(range as { from: string; to: string })}`),
  });
}

function OverviewTab(props: TabProps): ReactElement {
  const api = useApiClient();
  const { data, isPending, error } = useReport<ReportsOverview>('overview', api, props);

  if (error) {
    return (
      <ErrorNotice message="Could not load reports. Check that the API is reachable and try again." />
    );
  }
  if (isPending) {
    return (
      <>
        <CardSkeleton rows={2} />
        <CardSkeleton rows={4} />
      </>
    );
  }

  const prev = data.previous_period;

  return (
    <>
      <Section title="Volume" description="Conversations and tickets in the selected window.">
        <KpiGrid>
          <Kpi
            label="Conversations"
            value={formatCount(data.totals.chats)}
            delta={<CountDelta current={data.totals.chats} previous={prev.chats} />}
          />
          <Kpi
            label="Total cases"
            value={formatCount(data.totals.total_cases)}
            delta={<CountDelta current={data.totals.total_cases} previous={prev.total_cases} />}
            hint={`${formatCount(data.totals.chats)} chats + ${formatCount(
              data.totals.tickets,
            )} tickets`}
          />
          <Kpi
            label="Closed"
            value={formatCount(data.totals.closed)}
            delta={<CountDelta current={data.totals.closed} previous={prev.closed} />}
          />
          <Kpi
            label="In queue now"
            value={formatCount(data.totals.queued_now)}
            tone={data.totals.queued_now > 0 ? 'warn' : 'neutral'}
            hint={data.totals.queued_now > 0 ? 'Waiting for an agent' : 'Nobody waiting'}
          />
        </KpiGrid>
      </Section>

      <Section
        title="Resolution"
        description="How closed conversations were handled (PRD §7.3.2). Manual, assisted and automated add up to every closed case."
      >
        <KpiGrid>
          <Kpi
            label="Manual"
            value={formatCount(data.totals.manual)}
            delta={<CountDelta current={data.totals.manual} previous={prev.manual} />}
            hint={closedShare(data.totals.manual_rate)}
          />
          <Kpi
            label="Assisted"
            value={formatCount(data.totals.assisted)}
            delta={<CountDelta current={data.totals.assisted} previous={prev.assisted} />}
            hint={closedShare(data.totals.assisted_rate)}
            tone="good"
          />
          <Kpi
            label="Automated"
            value={formatCount(data.totals.automated)}
            delta={<CountDelta current={data.totals.automated} previous={prev.automated} />}
            hint={closedShare(data.totals.automated_rate)}
            tone="good"
          />
        </KpiGrid>
      </Section>

      <Section
        title="Chats"
        description="How fast the AI clears conversations and how long they run (PRD §7.3.3)."
      >
        <KpiGrid>
          <Kpi
            label="Automated chats / hour"
            value={formatCount(data.chats.automated_per_hour)}
            hint="AI resolutions per hour across the window"
          />
          <Kpi
            label="Automated chat duration"
            value={formatDuration(data.chats.automated_avg_duration_seconds)}
            hint="Average, open to close"
          />
          <Kpi
            label="Total chat duration"
            value={formatDuration(data.chats.total_duration_seconds)}
            hint="Every closed conversation, summed"
          />
        </KpiGrid>
      </Section>

      <Section title="Responsiveness">
        <KpiGrid>
          <Kpi
            label="First response"
            value={formatDuration(data.response_times.avg_first_response_seconds)}
            delta={
              <DurationDelta
                current={data.response_times.avg_first_response_seconds}
                previous={prev.avg_first_response_seconds}
              />
            }
            hint="Average time to the first agent reply"
          />
          <Kpi
            label="Conversation length"
            value={formatDuration(data.response_times.avg_duration_seconds)}
            delta={
              <DurationDelta
                current={data.response_times.avg_duration_seconds}
                previous={prev.avg_duration_seconds}
              />
            }
            hint="Average from open to close"
          />
          <Kpi
            label="Satisfaction"
            value={formatRate(data.satisfaction.score)}
            delta={<RateDelta current={data.satisfaction.score} previous={prev.satisfaction_score} />}
            hint={
              data.satisfaction.responses === 0
                ? 'No ratings yet'
                : `${formatCount(data.satisfaction.responses)} rating${
                    data.satisfaction.responses === 1 ? '' : 's'
                  }`
            }
            tone={
              data.satisfaction.score === null
                ? 'neutral'
                : data.satisfaction.score >= 0.8
                  ? 'good'
                  : 'warn'
            }
          />
          <Kpi
            label="Negative ratings"
            value={formatCount(data.satisfaction.bad)}
            tone={data.satisfaction.bad > 0 ? 'warn' : 'neutral'}
          />
        </KpiGrid>
      </Section>

      <Section title="By agent" description="Conversations handled in the selected window.">
        <Card>
          {data.by_agent.length === 0 ? (
            <EmptyState
              title="No assigned conversations"
              description="Once conversations are routed to agents, their volume shows up here."
            />
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Conversations handled per agent</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
                    Agent
                  </th>
                  <th
                    scope="col"
                    className="w-32 px-4 py-2 text-right text-xs font-medium text-content-secondary"
                  >
                    Conversations
                  </th>
                  <th
                    scope="col"
                    className="w-2/5 px-4 py-2 text-xs font-medium text-content-secondary"
                  >
                    Share
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.by_agent.map((row) => (
                  <tr key={row.agent_id} className="border-b border-border last:border-0">
                    <td className="truncate px-4 py-2">{row.name ?? 'Unknown agent'}</td>
                    <td className="tabular px-4 py-2 text-right">{formatCount(row.chats)}</td>
                    <td className="px-4 py-2">
                      <ShareBar value={row.chats} total={data.by_agent[0]?.chats ?? 1} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </Section>

      <Section title="Top tags" description="What conversations were about.">
        {data.top_tags.length === 0 ? (
          <Card>
            <EmptyState
              title="No tags applied"
              description="Tag conversations from the details panel to see what drives contact volume."
            />
          </Card>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {data.top_tags.map((tag) => (
              <li
                key={tag.name}
                className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-sm"
              >
                <span>{tag.name}</span>
                <span className="tabular text-2xs text-content-tertiary">{tag.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function AiAgentTab(props: TabProps): ReactElement {
  const api = useApiClient();
  const { data, isPending, error } = useReport<ReportsAiAgent>('ai-agent', api, props);

  if (error) {
    return (
      <ErrorNotice message="Could not load the AI Agent report. Check that the API is reachable and try again." />
    );
  }
  if (isPending) {
    return (
      <>
        <CardSkeleton rows={2} />
        <CardSkeleton rows={2} />
      </>
    );
  }

  return (
    <>
      <Section
        title="AI resolution"
        description="What the AI Agent handled without a human (ADR-09) — the same figure the invoice bills."
      >
        <KpiGrid>
          <Kpi label="AI resolutions" value={formatCount(data.resolutions)} tone="good" />
          <Kpi
            label="Resolution rate"
            value={formatRate(data.resolution_rate)}
            hint={closedShare(data.resolution_rate)}
            tone="good"
          />
          <Kpi
            label="Automated chat duration"
            value={formatDuration(data.avg_automated_duration_seconds)}
            hint="Average, open to close"
          />
        </KpiGrid>
      </Section>

      <Section
        title="Deflection"
        description="How often the AI handed a conversation to a human, and how many skills ran."
      >
        <KpiGrid>
          <Kpi label="Transfers to a human" value={formatCount(data.transfers)} />
          <Kpi
            label="Transfer rate"
            value={formatRate(data.transfer_rate)}
            hint={
              data.transfer_rate === null
                ? 'The AI finished nothing in this window'
                : 'Share of AI-finished chats handed off'
            }
            tone={data.transfer_rate !== null && data.transfer_rate >= 0.5 ? 'warn' : 'neutral'}
          />
          <Kpi label="Skills run" value={formatCount(data.skill_runs)} />
        </KpiGrid>
      </Section>
    </>
  );
}

function BreakdownTab(props: TabProps): ReactElement {
  const api = useApiClient();
  const { data, isPending, error } = useReport<ReportsBreakdown>('breakdown', api, props);

  if (error) {
    return (
      <ErrorNotice message="Could not load the breakdown. Check that the API is reachable and try again." />
    );
  }
  if (isPending) {
    return (
      <>
        <CardSkeleton rows={4} />
        <CardSkeleton rows={4} />
      </>
    );
  }

  return (
    <>
      <Section
        title="By day"
        description="The resolution split (PRD §7.3.2) resolved over each UTC day in the window."
      >
        <Card>
          {data.by_day.length === 0 ? (
            <EmptyState
              title="No conversations yet"
              description="Once conversations happen in this window, their daily split shows up here."
            />
          ) : (
            <SplitTable
              caption="Resolution split per day"
              firstColumn="Day"
              rows={data.by_day.map((row) => ({ key: row.date, label: row.date, ...row }))}
            />
          )}
        </Card>
      </Section>

      <Section title="By agent" description="The same split resolved over each assigned agent.">
        <Card>
          {data.by_agent.length === 0 ? (
            <EmptyState
              title="No assigned conversations"
              description="Once conversations are routed to agents, their split shows up here."
            />
          ) : (
            <SplitTable
              caption="Resolution split per agent"
              firstColumn="Agent"
              rows={data.by_agent.map((row) => ({
                key: row.agent_id,
                label: row.name ?? 'Unknown agent',
                ...row,
              }))}
            />
          )}
        </Card>
      </Section>
    </>
  );
}

/** A breakdown table: a label column plus the manual / assisted / automated split. */
function SplitTable({
  caption,
  firstColumn,
  rows,
}: {
  caption: string;
  firstColumn: string;
  rows: Array<SplitRow & { key: string; label: string }>;
}): ReactElement {
  const numeric = 'w-24 px-4 py-2 text-right text-xs font-medium text-content-secondary';
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
            {firstColumn}
          </th>
          <th scope="col" className={numeric}>
            Chats
          </th>
          <th scope="col" className={numeric}>
            Manual
          </th>
          <th scope="col" className={numeric}>
            Assisted
          </th>
          <th scope="col" className={numeric}>
            Automated
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-border last:border-0">
            <td className="truncate px-4 py-2">{row.label}</td>
            <td className="tabular px-4 py-2 text-right">{formatCount(row.chats)}</td>
            <td className="tabular px-4 py-2 text-right">{formatCount(row.manual)}</td>
            <td className="tabular px-4 py-2 text-right text-success">
              {formatCount(row.assisted)}
            </td>
            <td className="tabular px-4 py-2 text-right text-success">
              {formatCount(row.automated)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The header range control: preset spans plus a custom start/end (FR-MOD-07.3.1). */
function RangeControls({
  mode,
  onMode,
  customFrom,
  customTo,
  onCustomFrom,
  onCustomTo,
}: {
  mode: RangeMode;
  onMode: (mode: RangeMode) => void;
  customFrom: string;
  customTo: string;
  onCustomFrom: (value: string) => void;
  onCustomTo: (value: string) => void;
}): ReactElement {
  const chip = (active: boolean): string =>
    `rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
      active
        ? 'border-brand-500 bg-brand-500/10 text-content'
        : 'border-border bg-inset text-content-secondary hover:text-content'
    }`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1" role="group" aria-label="Range">
        {PRESETS.map((days) => (
          <button
            key={days}
            type="button"
            aria-pressed={mode === days}
            onClick={() => onMode(days)}
            className={chip(mode === days)}
          >
            {days} days
          </button>
        ))}
        <button
          type="button"
          aria-pressed={mode === 'custom'}
          onClick={() => onMode('custom')}
          className={chip(mode === 'custom')}
        >
          Custom
        </button>
      </div>
      {mode === 'custom' && (
        <div className="flex items-center gap-1 text-xs text-content-secondary">
          <label className="flex items-center gap-1">
            <span className="sr-only">Start date</span>
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(event) => onCustomFrom(event.target.value)}
              className="rounded-md border border-border bg-inset px-2 py-1 text-content"
            />
          </label>
          <span aria-hidden="true">→</span>
          <label className="flex items-center gap-1">
            <span className="sr-only">End date</span>
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(event) => onCustomTo(event.target.value)}
              className="rounded-md border border-border bg-inset px-2 py-1 text-content"
            />
          </label>
        </div>
      )}
    </div>
  );
}

/**
 * The change from the previous equal-length window (FR-MOD-07.3.1). Neutral by
 * design: an arrow and the magnitude, with no green/red judgement — "up" is good
 * for resolutions and bad for negative ratings, so colour here would mislead. The
 * baseline itself stays on the card, this only annotates the movement. Renders
 * nothing when either side is unknown, so an empty window shows no phantom delta.
 */
function Delta({
  current,
  previous,
  format,
}: {
  current: number | null | undefined;
  previous: number | null | undefined;
  format: (value: number | null | undefined) => string | null;
}): ReactElement | null {
  if (current == null || previous == null) return null;
  const diff = Math.round((current - previous) * 1000) / 1000;
  if (diff === 0) {
    return <span className="text-2xs text-content-tertiary">No change vs previous</span>;
  }
  return (
    <span className="text-2xs text-content-tertiary" title="Compared with the previous period">
      {diff > 0 ? '↑' : '↓'} {format(Math.abs(diff))} vs previous
    </span>
  );
}

function CountDelta(props: { current: number | null; previous: number | null }): ReactElement | null {
  return <Delta {...props} format={formatCount} />;
}

function DurationDelta(props: {
  current: number | null;
  previous: number | null;
}): ReactElement | null {
  return <Delta {...props} format={formatDuration} />;
}

function RateDelta(props: { current: number | null; previous: number | null }): ReactElement | null {
  return <Delta {...props} format={formatRate} />;
}

/**
 * Hint under a resolution KPI: its share of *closed* conversations, or a plain
 * note when nothing closed. A rate is null (not 0%) for an empty window, and
 * "0% of closed" would read as a failure rather than as an absence of data.
 */
function closedShare(rate: number | null): string {
  return rate === null ? 'Nothing closed in this window' : `${formatRate(rate)} of closed`;
}

/**
 * Relative bar, scaled to the busiest agent rather than the total.
 *
 * Scaling to the total makes every bar a sliver as soon as a team grows past a
 * handful of people, which is exactly when the comparison starts to matter.
 * The number beside it carries the absolute value, so the bar only has to
 * communicate rank.
 */
function ShareBar({ value, total }: { value: number; total: number }): ReactElement {
  const fraction = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-inset" aria-hidden="true">
      <div
        className="h-full rounded-full bg-brand-500"
        style={{ width: `${Math.max(2, fraction * 100)}%` }}
      />
    </div>
  );
}
