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
import { Link } from 'react-router-dom';
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
import { Banner, Dropdown } from '../../components/ui/index.js';
import { useApiClient } from '../../lib/auth-store.js';
import { ApiClientError, type ApiClient } from '../../lib/api-client.js';
import { formatCount, formatDuration, formatMoney, formatRate } from '../../lib/format.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import {
  SAVED_REPORT_VIEW_NAME_MAX,
  useSavedReportViews,
  type ReportBaseline,
  type SavedReportView,
} from './report-views.js';

interface Period {
  range: { from: string; to: string };
  chats: number;
  tickets: number;
  total_cases: number;
  closed: number;
  manual: number;
  assisted: number;
  automated: number;
  achieved_goals: number;
  avg_first_response_seconds: number | null;
  avg_duration_seconds: number | null;
  satisfaction_score: number | null;
  sla_breaches: number;
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
    achieved_goals: number;
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
  sla: {
    /** Whether targets are being measured today — see `GET /settings/sla`'s `active`. */
    active: boolean;
    breaches: number;
    /** Too few cases in the window for the count to mean much (FR-MOD-07.3.2). */
    low_confidence: boolean;
  };
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
  by_hour?: Array<SplitRow & { hour: number }>;
  by_team?: Array<SplitRow & { team_id: number | null; name: string | null }>;
  overlapping?: boolean;
  by_channel?: Array<SplitRow & { channel: string }>;
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

interface CsatSummary {
  good: number;
  bad: number;
  responses: number;
  score: number | null;
}

interface ReportsReviews {
  range: { from: string; to: string };
  csat: CsatSummary;
  previous_period: CsatSummary & { range: { from: string; to: string } };
  by_day: Array<CsatSummary & { date: string }>;
  ecommerce:
    | {
        configured: true;
        tracked_sales: number;
        attributed_revenue_cents: number;
        currency: string;
      }
    | {
        configured: false;
        tracked_sales: null;
        attributed_revenue_cents: null;
        currency: null;
      };
}

interface TopicRow {
  id: string;
  label: string;
  keywords: string[];
  volume: number;
  share: number | null;
  previous_volume: number;
  trend: number | null;
}

interface ReportsTopics {
  range: { from: string; to: string };
  previous_period: { range: { from: string; to: string } };
  min_conversations: number;
  analyzed: number;
  sufficient_data: boolean;
  topics: TopicRow[];
}

/**
 * The Cases report (FR-MOD-07.7, v2): tickets (FR-MOD-02.6) split by UTC day
 * of creation, current status and stored queue priority (FR-MOD-13.6). A
 * merged ticket (`merged_into_id` set) is excluded from every bucket.
 */
interface ReportsCases {
  range: { from: string; to: string };
  previous_period: { open: number; closed: number; total: number };
  by_day: Array<{ date: string; open: number; closed: number; total: number }>;
  by_status: Array<{ status: string; count: number }>;
  by_priority: Array<{ priority: number; count: number }>;
}

/**
 * The Leads report (FR-MOD-07.7, v2): customers flagged as leads, counted by
 * the UTC day they first touched *this* license through a chat or ticket
 * (never by organization-wide creation date — see the API's isolation note).
 */
interface ReportsLeads {
  range: { from: string; to: string };
  previous_period: { leads: number };
  by_day: Array<{ date: string; count: number }>;
  totals: { leads: number };
}

/**
 * The Sales report (FR-MOD-07.7, v2; FR-MOD-13.5 dependency): the same
 * tracked-sales skeleton as the Reviews report's `ecommerce` block, as a
 * report of its own. No sales/order source exists yet, so `configured` is
 * always `false` and every figure `null` in v1 (see the API's `buildSalesReport`).
 */
interface ReportsSales {
  range: { from: string; to: string };
  configured: boolean;
  tracked_sales: number | null;
  attributed_revenue_cents: number | null;
  currency: string | null;
  conversions: number | null;
}

interface AgentPerformanceRow {
  agent_id: string;
  name: string | null;
  chats: number;
  closed: number;
  manual: number;
  assisted: number;
  automated: number;
  avg_first_response_seconds: number | null;
  avg_duration_seconds: number | null;
  csat: CsatSummary;
  transfers: number;
}

/**
 * Team performance (FR-MOD-07.7, v2): the Breakdown tab's by-agent chat split
 * extended per agent with response time, CSAT and AI→human transfers (see the
 * API's `teamPerformanceByAgent`). Same agent set, order and `LIMIT 20` as
 * `ReportsBreakdown.by_agent`.
 */
interface ReportsTeamPerformance {
  range: { from: string; to: string };
  agents: AgentPerformanceRow[];
}

interface StaffingCell {
  day_of_week: number;
  hour: number;
  observed_chats: number;
  required_agents: number | null;
  scheduled_agents: number | null;
  rostered_agents: number | null;
  gap: number | null;
  low_confidence: boolean;
}

interface StaffingForecast {
  range: { from: string; to: string };
  inputs: {
    concurrent_chats_limit: number | null;
    average_chat_minutes: number | null;
    minimum_sample_chats: number;
    agents: number;
  };
  coverage_known: boolean;
  roster_known: boolean;
  low_confidence: boolean;
  cells: StaffingCell[];
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'ai-agent', label: 'AI Agent' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'breakdown', label: 'Breakdown' },
  { id: 'staffing', label: 'Staffing' },
  { id: 'topics', label: 'Chat topics' },
  { id: 'cases', label: 'Cases' },
  { id: 'leads', label: 'Leads' },
  { id: 'sales', label: 'Sales' },
  { id: 'team-performance', label: 'Team performance' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/**
 * Tabs whose visibility follows `GET /reports/groups` (07.7-i) rather than
 * always rendering. The backend is the actual permission boundary — a caller
 * missing `reports_read` (or, in the future, a narrower per-group scope)
 * still gets a 403 straight from `/reports/cases`/`/reports/leads`/
 * `/reports/sales`/`/reports/team-performance` if they reach it some other
 * way — so hiding the tab is UX honesty ("here is what you can open"), not a
 * second enforcement layer. Cases, Leads, Sales and Team performance are
 * gated here; the other tabs predate this catalogue and stay unconditional.
 */
const GROUP_GATED_TABS = new Set<TabId>(['cases', 'leads', 'sales', 'team-performance']);

interface ReportGroupsResponse {
  groups: Array<{ id: string; label: string }>;
}

function useReportGroups(api: ApiClient) {
  return useQuery({
    queryKey: ['reports', 'groups'],
    queryFn: () => api.get<ReportGroupsResponse>('/reports/groups'),
  });
}

const PRESETS = [7, 30, 90, 365] as const;
type RangeMode = (typeof PRESETS)[number] | 'custom';

/** Stable id (FR-EK-C.2) so "Remind me later" persists across reloads. */
const TOPICS_PROMO_BANNER_ID = 'reports-topics-promo';

/**
 * Overview-only promo for the Chat topics tab (FR-MOD-07.6, rapor-1-fonksiyonel.md:297).
 * "See chat topics" switches the tab in place; "Remind me later" is Banner's
 * own persistent dismiss (`dismissLabel`) rather than a second control.
 */
function TopicsPromoBanner({ onSeeTopics }: { onSeeTopics: () => void }): ReactElement {
  return (
    <Banner
      tone="brand"
      id={TOPICS_PROMO_BANNER_ID}
      dismissible
      dismissLabel="Remind me later"
      cta={
        <button
          type="button"
          onClick={onSeeTopics}
          className="rounded-md bg-brand-500 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-600"
        >
          See chat topics
        </button>
      }
    >
      Top chat topics in one place
    </Banner>
  );
}

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

/**
 * `rangeQuery` plus the benchmark baseline (07.7-e), when one is set. Omitted
 * — not sent as an explicit default — when `baseline` is `null`, so a report
 * fetched with no baseline chosen hits the exact same URL it always has
 * (`?baseline=previous_period` is byte-identical in the response, but the
 * request itself stays unchanged for anything asserting on it, e.g. a test).
 */
function reportQuery(range: { from: string; to: string }, baseline: ReportBaseline | null): string {
  const query = rangeQuery(range);
  return baseline ? `${query}&baseline=${baseline}` : query;
}

export function ReportsPage(): ReactElement {
  const api = useApiClient();
  const { data: groupsData } = useReportGroups(api);
  const visibleGroupIds = new Set((groupsData?.groups ?? []).map((group) => group.id));
  // Hidden until the groups response confirms visibility (fail closed, not
  // open) — a transient loading state and a caller who truly lacks the scope
  // look the same for one beat, which is the safe default for a permission gate.
  const visibleTabs = TABS.filter(
    (tabDef) => !GROUP_GATED_TABS.has(tabDef.id) || visibleGroupIds.has(tabDef.id),
  );

  const [tab, setTab] = useState<TabId>('overview');
  const [mode, setMode] = useState<RangeMode>(30);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  // No selector sets this away from `null` yet (the comparison window a
  // benchmark badge would show is an open UI question, §5.2.4) — it exists so
  // a saved view round-trips a `baseline` it may carry without silently
  // dropping it, and so the wiring is already correct the day a control lands.
  const [baseline, setBaseline] = useState<ReportBaseline | null>(null);

  const range = resolveRange(mode, customFrom, customTo);
  // Stable across renders (unlike `range`, which re-derives "now"), so it is the
  // right thing to key a query on.
  const rangeKey = mode === 'custom' ? `custom:${customFrom}:${customTo}` : String(mode);

  const savedViews = useSavedReportViews();
  // Applying a saved view sets its whole filter — tab, range and baseline — in
  // one click (07.7-k KK, derived from 07.7-h): the same all-at-once binding
  // Inbox uses for its own saved views (`InboxPage.tsx`'s `applySavedView`).
  const applySavedView = (view: SavedReportView): void => {
    setTab(view.tab);
    setMode(view.mode);
    setCustomFrom(view.customFrom);
    setCustomTo(view.customTo);
    setBaseline(view.baseline);
  };

  return (
    <Page
      title="Reports"
      description="Conversation volume, responsiveness and satisfaction."
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SavedViewsControl
            views={savedViews.views}
            onSelect={applySavedView}
            onAdd={(name) => savedViews.add({ name, tab, mode, customFrom, customTo, baseline })}
            onRemove={savedViews.remove}
          />
          <RangeControls
            mode={mode}
            onMode={setMode}
            customFrom={customFrom}
            customTo={customTo}
            onCustomFrom={setCustomFrom}
            onCustomTo={setCustomTo}
          />
          <ExportControl group={tab} range={range} visible={visibleGroupIds.has(tab)} />
        </div>
      }
    >
      <div role="tablist" aria-label="Report" className="flex gap-1 border-b border-border">
        {visibleTabs.map((tabDef) => {
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
          <>
            <TopicsPromoBanner onSeeTopics={() => setTab('topics')} />
            <OverviewTab rangeKey={rangeKey} range={range} baseline={baseline} />
          </>
        ) : tab === 'ai-agent' ? (
          <AiAgentTab rangeKey={rangeKey} range={range} baseline={baseline} />
        ) : tab === 'reviews' ? (
          <ReviewsTab rangeKey={rangeKey} range={range} baseline={baseline} />
        ) : tab === 'breakdown' ? (
          <BreakdownTab rangeKey={rangeKey} range={range} baseline={baseline} />
        ) : tab === 'staffing' ? (
          <StaffingTab rangeKey={rangeKey} range={range} baseline={baseline} />
        ) : tab === 'topics' ? (
          <TopicsTab rangeKey={rangeKey} range={range} baseline={baseline} />
        ) : tab === 'cases' ? (
          <CasesTab rangeKey={rangeKey} range={range} baseline={baseline} />
        ) : tab === 'leads' ? (
          <LeadsTab rangeKey={rangeKey} range={range} baseline={baseline} />
        ) : tab === 'sales' ? (
          <SalesTab rangeKey={rangeKey} range={range} baseline={baseline} />
        ) : (
          <TeamPerformanceTab rangeKey={rangeKey} range={range} baseline={baseline} />
        )}
      </div>
    </Page>
  );
}

interface TabProps {
  rangeKey: string;
  range: { from: string; to: string } | null;
  baseline: ReportBaseline | null;
}

function useReport<T>(kind: string, api: ApiClient, { rangeKey, range, baseline }: TabProps) {
  // `/reports/staffing-forecast` takes no `baseline` parameter — it is a
  // projection over its own window, not a comparison against an earlier one
  // (see the route's own comment in `reports.ts`) — so this never sends one.
  const effectiveBaseline = kind === 'staffing-forecast' ? null : baseline;
  return useQuery({
    queryKey: ['reports', kind, rangeKey, effectiveBaseline],
    enabled: range !== null,
    queryFn: () =>
      api.get<T>(
        `/reports/${kind}?${reportQuery(range as { from: string; to: string }, effectiveBaseline)}`,
      ),
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
          <Kpi
            label="Achieved goals"
            value={formatCount(data.totals.achieved_goals)}
            delta={
              <CountDelta current={data.totals.achieved_goals} previous={prev.achieved_goals} />
            }
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
            delta={
              <RateDelta current={data.satisfaction.score} previous={prev.satisfaction_score} />
            }
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
          <Kpi
            label="SLA breaches"
            value={data.sla.active ? formatCount(data.sla.breaches) : null}
            delta={
              data.sla.active ? (
                <CountDelta current={data.sla.breaches} previous={prev.sla_breaches} />
              ) : undefined
            }
            tone={data.sla.active && data.sla.breaches > 0 ? 'warn' : 'neutral'}
            hint={
              !data.sla.active
                ? 'Set targets in Settings → SLA to track this'
                : data.sla.low_confidence
                  ? 'Not enough cases yet to read much into this'
                  : undefined
            }
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

/**
 * Reviews / Ratings (FR-MOD-07.8). CSAT read back from the ratings the widget
 * writes: a donut for the good/bad split, a daily bar for volume over time, and
 * the previous-window score beside the current one (the PRD's "67% vs 57%").
 *
 * A CSAT is null, never 0%, when nobody rated — an unrated span is unknown, not a
 * failure — so an empty window shows an empty state, not a red zero. Ecommerce is
 * the tracked-sales skeleton (§13.5, v2): honest "not set up" until a source is
 * wired, never a fabricated figure.
 */
function ReviewsTab(props: TabProps): ReactElement {
  const api = useApiClient();
  const { data, isPending, error } = useReport<ReportsReviews>('reviews', api, props);

  if (error) {
    return (
      <ErrorNotice message="Could not load the Reviews report. Check that the API is reachable and try again." />
    );
  }
  if (isPending) {
    return (
      <>
        <CardSkeleton rows={3} />
        <CardSkeleton rows={4} />
      </>
    );
  }

  const csat = data.csat;
  const prev = data.previous_period;

  return (
    <>
      <Section
        title="Satisfaction (CSAT)"
        description="Rated good as a share of all ratings (PRD §7.8). Null, never 0%, when nobody rated."
      >
        <Card>
          {csat.responses === 0 ? (
            <EmptyState
              title="No ratings yet"
              description="Once customers rate their conversations, the good / bad split shows up here."
            />
          ) : (
            <div className="flex flex-wrap items-center gap-8 p-2">
              <CsatDonut good={csat.good} bad={csat.bad} score={csat.score} />
              <div className="flex min-w-[11rem] flex-col gap-2 text-sm">
                <CsatLegend swatch="bg-success" label="Rated good" value={csat.good} />
                <CsatLegend swatch="bg-danger" label="Rated bad" value={csat.bad} />
                <p className="pt-1 text-content-secondary">
                  {formatCount(csat.responses)} rating{csat.responses === 1 ? '' : 's'}
                </p>
                <p className="text-2xs text-content-tertiary">
                  {prev.score === null
                    ? 'No ratings in the previous period'
                    : `vs ${formatRate(prev.score)} previous period`}
                </p>
              </div>
            </div>
          )}
        </Card>
      </Section>

      <Section
        title="Ratings by day"
        description="Daily rating volume, good vs bad, over each UTC day in the window."
      >
        <Card>
          {data.by_day.length === 0 ? (
            <EmptyState
              title="No ratings in this window"
              description="Once customers rate conversations, each day's ratings show up here."
            />
          ) : (
            <DailyBar rows={data.by_day} />
          )}
        </Card>
      </Section>

      <Section
        title="Ecommerce"
        description="Sales attributed to supported conversations (PRD §7.8, tracked sales §13.5)."
      >
        <Card>
          {data.ecommerce.configured ? (
            <KpiGrid>
              <Kpi label="Tracked sales" value={formatCount(data.ecommerce.tracked_sales)} />
              <Kpi
                label="Attributed revenue"
                value={formatMoney(
                  data.ecommerce.attributed_revenue_cents,
                  data.ecommerce.currency,
                )}
                hint={data.ecommerce.currency}
              />
            </KpiGrid>
          ) : (
            <EmptyState
              title="Sales tracking not set up"
              description="Connect a sales source to attribute revenue to supported conversations."
              action={
                <Link
                  to="/app/settings#section-sales-tracker"
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
                >
                  Configure sales platforms
                </Link>
              }
            />
          )}
        </Card>
      </Section>
    </>
  );
}

/**
 * The CSAT donut: the full ring in the "bad" colour with the good arc laid over
 * it from twelve o'clock, so the covered fraction *is* the good share. The score
 * sits in the middle; the descriptive `aria-label` carries the same for AT.
 */
function CsatDonut({
  good,
  bad,
  score,
}: {
  good: number;
  bad: number;
  score: number | null;
}): ReactElement {
  const responses = good + bad;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const goodLength = responses > 0 ? (good / responses) * circumference : 0;
  const label = `CSAT ${formatRate(score) ?? 'unknown'}: ${good} of ${responses} rated good.`;

  return (
    <svg viewBox="0 0 120 120" className="h-36 w-36 shrink-0" role="img" aria-label={label}>
      <circle cx="60" cy="60" r={radius} fill="none" className="stroke-danger" strokeWidth="14" />
      <circle
        cx="60"
        cy="60"
        r={radius}
        fill="none"
        className="stroke-success"
        strokeWidth="14"
        strokeDasharray={`${goodLength} ${circumference - goodLength}`}
        transform="rotate(-90 60 60)"
      />
      <text
        x="60"
        y="60"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-content text-xl font-semibold"
        aria-hidden="true"
      >
        {formatRate(score) ?? '—'}
      </text>
    </svg>
  );
}

/** One legend row: a colour swatch, its label, and the count aligned right. */
function CsatLegend({
  swatch,
  label,
  value,
}: {
  swatch: string;
  label: string;
  value: number;
}): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${swatch}`} aria-hidden="true" />
      <span className="text-content-secondary">{label}</span>
      <span className="tabular ml-auto font-medium text-content">{formatCount(value)}</span>
    </div>
  );
}

/**
 * The daily bar: one row per UTC day, a stacked good/bad bar whose length is the
 * day's rating volume against the busiest day, plus the counts and that day's
 * CSAT (— when the day somehow carries no rating). Scaling to the busiest day,
 * not the total, keeps a quiet day's bar legible next to a busy one.
 */
function DailyBar({ rows }: { rows: Array<CsatSummary & { date: string }> }): ReactElement {
  const max = Math.max(1, ...rows.map((row) => row.responses));
  const numeric = 'w-20 px-4 py-2 text-right text-xs font-medium text-content-secondary';
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Ratings per day, split good and bad</caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
            Day
          </th>
          <th scope="col" className="w-2/5 px-4 py-2 text-xs font-medium text-content-secondary">
            Ratings
          </th>
          <th scope="col" className={numeric}>
            Good
          </th>
          <th scope="col" className={numeric}>
            Bad
          </th>
          <th scope="col" className={numeric}>
            CSAT
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.date} className="border-b border-border last:border-0">
            <td className="tabular px-4 py-2">{row.date}</td>
            <td className="px-4 py-2">
              <DayBar good={row.good} bad={row.bad} max={max} />
            </td>
            <td className="tabular px-4 py-2 text-right text-success">{formatCount(row.good)}</td>
            <td className="tabular px-4 py-2 text-right text-danger">{formatCount(row.bad)}</td>
            <td className="tabular px-4 py-2 text-right">{formatRate(row.score) ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A single day's stacked bar: good (success) then bad (danger), scaled to `max`. */
function DayBar({ good, bad, max }: { good: number; bad: number; max: number }): ReactElement {
  const responses = good + bad;
  const width = max > 0 ? (responses / max) * 100 : 0;
  const goodShare = responses > 0 ? (good / responses) * 100 : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-inset" aria-hidden="true">
      <div className="flex h-full rounded-full" style={{ width: `${Math.max(2, width)}%` }}>
        <div className="h-full bg-success" style={{ width: `${goodShare}%` }} />
        <div className="h-full bg-danger" style={{ width: `${100 - goodShare}%` }} />
      </div>
    </div>
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

      <Section
        title="By hour"
        description="The same split resolved over each UTC hour, summed across the window."
      >
        <Card>
          {(data.by_hour ?? []).length === 0 ? (
            <EmptyState
              title="No hourly data yet"
              description="Once conversations happen in this window, their hourly split shows up here."
            />
          ) : (
            <SplitTable
              caption="Resolution split per hour"
              firstColumn="Hour"
              rows={(data.by_hour ?? []).map((row) => ({
                key: String(row.hour),
                label: `${String(row.hour).padStart(2, '0')}:00`,
                ...row,
              }))}
            />
          )}
        </Card>
      </Section>

      <Section
        title="By team"
        description={
          data.overlapping
            ? "The same split resolved over each team a conversation is visible to. A conversation open to more than one team is counted in every one of them, so row totals can exceed the window's total chats."
            : 'The same split resolved over each team a conversation is visible to.'
        }
      >
        <Card>
          {(data.by_team ?? []).length === 0 ? (
            <EmptyState
              title="No team data yet"
              description="Once conversations are visible to a team, their split shows up here."
            />
          ) : (
            <SplitTable
              caption="Resolution split per team"
              firstColumn="Team"
              rows={(data.by_team ?? []).map((row) => ({
                key: String(row.team_id ?? 'unassigned'),
                label: row.name ?? 'Unassigned',
                ...row,
              }))}
            />
          )}
        </Card>
      </Section>

      <Section
        title="By channel"
        description="The same split resolved over each channel the conversation started on."
      >
        <Card>
          {(data.by_channel ?? []).length === 0 ? (
            <EmptyState
              title="No channel data yet"
              description="Once conversations happen in this window, their channel split shows up here."
            />
          ) : (
            <SplitTable
              caption="Resolution split per channel"
              firstColumn="Channel"
              rows={(data.by_channel ?? []).map((row) => ({
                key: row.channel,
                label: row.channel,
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

const STAFFING_DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STAFFING_HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * Staffing (WORKSCHED-i, PRD §5.3-Vardiya). A read-only 7 × 24 UTC grid off
 * `GET /reports/staffing-forecast` (-g): every cell shows the gap between what
 * the observed load required and what was actually scheduled, highlighted
 * when positive (a shortfall). Recomputed per request server-side — nothing
 * here re-derives the arithmetic, only renders it.
 *
 * A cell that never cleared the sample floor, or whose required/scheduled
 * side is unknown, renders "—" rather than a fabricated 0 — a real all-clear
 * and "we don't know" are different facts, and only one of them is good news.
 */
function StaffingTab(props: TabProps): ReactElement {
  const api = useApiClient();
  const { data, isPending, error } = useReport<StaffingForecast>('staffing-forecast', api, props);

  if (error) {
    return (
      <ErrorNotice message="Could not load the staffing forecast. Check that the API is reachable and try again." />
    );
  }
  if (isPending) {
    return <CardSkeleton rows={7} />;
  }

  const totalObserved = data.cells.reduce((sum, cell) => sum + cell.observed_chats, 0);

  return (
    <Section
      title="Staffing"
      description="Required vs scheduled agents per UTC weekday and hour, from observed volume and the presence log (PRD §5.3). Gaps are the shortfall to close; a cell with too little history shows '—', never a guessed number."
    >
      <Card>
        {totalObserved === 0 ? (
          <EmptyState
            title="No staffing data in this window"
            description="Once conversations happen in this window, the required-vs-scheduled forecast shows up here."
          />
        ) : (
          <>
            {!data.coverage_known && (
              <p className="border-b border-border px-4 py-2 text-2xs text-warning">
                No presence data in this window — scheduled coverage and every gap are unknown.
              </p>
            )}
            {!data.roster_known && (
              <p className="border-b border-border px-4 py-2 text-2xs text-content-secondary">
                No agent has a saved work schedule yet — rostered coverage is unknown.
              </p>
            )}
            <StaffingGrid cells={data.cells} />
          </>
        )}
      </Card>
    </Section>
  );
}

/** The 7 × 24 grid itself: one row per UTC weekday (0 = Sunday), one column per UTC hour. */
function StaffingGrid({ cells }: { cells: StaffingCell[] }): ReactElement {
  const byKey = new Map<string, StaffingCell>();
  for (const cell of cells) {
    byKey.set(`${cell.day_of_week}-${cell.hour}`, cell);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">Required vs scheduled agents per UTC weekday and hour</caption>
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className="px-2 py-1.5 text-2xs font-medium text-content-secondary">
              Day
            </th>
            {STAFFING_HOURS.map((hour) => (
              <th
                key={hour}
                scope="col"
                className="w-8 px-1 py-1.5 text-center text-2xs font-medium text-content-secondary"
              >
                {String(hour).padStart(2, '0')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {STAFFING_DAY_LABELS.map((label, dayOfWeek) => (
            <tr key={label} className="border-b border-border last:border-0">
              <th
                scope="row"
                className="px-2 py-1.5 text-left text-2xs font-medium text-content-secondary"
              >
                {label}
              </th>
              {STAFFING_HOURS.map((hour) => (
                <StaffingCellView key={hour} cell={byKey.get(`${dayOfWeek}-${hour}`)} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One grid cell: the gap, or "—" when the cell (or an input it depends on) is unknown. */
function StaffingCellView({ cell }: { cell: StaffingCell | undefined }): ReactElement {
  if (
    !cell ||
    cell.gap === null ||
    cell.required_agents === null ||
    cell.scheduled_agents === null
  ) {
    return (
      <td title="Not enough data" className="tabular px-1 py-1.5 text-center text-content-tertiary">
        —
      </td>
    );
  }

  const { gap, required_agents, scheduled_agents } = cell;
  const highlight = gap > 0;
  const title = `Required ${required_agents} · Scheduled ${formatScheduled(scheduled_agents)} · Gap ${formatGap(gap)}`;

  return (
    <td
      title={title}
      className={`tabular px-1 py-1.5 text-center ${
        highlight ? 'bg-warning/10 font-semibold text-warning' : 'text-content-secondary'
      }`}
    >
      {formatGap(gap)}
    </td>
  );
}

/** `2.5` → `"2.5"`, `2` → `"2"` — whole numbers stay whole. */
function formatScheduled(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** The required-scheduled gap, signed: `1` → `"+1"`, `-1.5` → `"-1.5"`, `0` → `"0"`. */
function formatGap(gap: number): string {
  const rounded = Math.round(gap * 10) / 10;
  if (rounded === 0) return '0';
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

/**
 * Chat topics (FR-MOD-07.6): conversations in the window clustered into topics
 * by `@nexa/ai-mock`, no real LLM. Below `min_conversations` clusterable chats
 * the report is an honest "not enough conversations yet" state — never a single
 * fabricated topic, and never an empty rectangle (EK-B.1).
 */
function TopicsTab(props: TabProps): ReactElement {
  const api = useApiClient();
  const { data, isPending, error } = useReport<ReportsTopics>('topics', api, props);

  if (error) {
    return (
      <ErrorNotice message="Could not load chat topics. Check that the API is reachable and try again." />
    );
  }
  if (isPending) {
    return <CardSkeleton rows={4} />;
  }

  return (
    <Section
      title="Chat topics"
      description="Conversations in this window, grouped into topics by AI clustering."
    >
      <Card>
        {!data.sufficient_data || data.topics.length === 0 ? (
          <EmptyState
            title="Not enough conversations yet"
            description={`Chat topics needs at least ${data.min_conversations} conversations in this window — ${data.analyzed} so far.`}
          />
        ) : (
          <TopicsTable topics={data.topics} />
        )}
      </Card>
    </Section>
  );
}

/** The topics table: label, volume, share of analyzed conversations and trend. */
function TopicsTable({ topics }: { topics: TopicRow[] }): ReactElement {
  const numeric = 'w-28 px-4 py-2 text-right text-xs font-medium text-content-secondary';
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Chat topics, most voluminous first</caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
            Topic
          </th>
          <th scope="col" className={numeric}>
            Volume
          </th>
          <th scope="col" className={numeric}>
            Share
          </th>
          <th scope="col" className={numeric}>
            Trend
          </th>
        </tr>
      </thead>
      <tbody>
        {topics.map((topic) => (
          <tr key={topic.id} className="border-b border-border last:border-0">
            <td className="truncate px-4 py-2">{topic.label}</td>
            <td className="tabular px-4 py-2 text-right">{formatCount(topic.volume)}</td>
            <td className="tabular px-4 py-2 text-right">{formatRate(topic.share) ?? '—'}</td>
            <td className="tabular px-4 py-2 text-right">
              <TopicTrend trend={topic.trend} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A topic's volume change vs the previous equal-length window: an arrow plus
 * the magnitude, never colour alone (colour carries no meaning by itself — it
 * always rides with the arrow). Null — not a fabricated 0% — when the topic did
 * not appear in the previous window, so its trend is genuinely unknown.
 */
function TopicTrend({ trend }: { trend: number | null }): ReactElement {
  if (trend === null) return <span className="text-content-tertiary">—</span>;
  if (trend === 0) return <span className="text-content-tertiary">No change</span>;
  return (
    <span>
      {trend > 0 ? '↑' : '↓'} {formatRate(Math.abs(trend))}
    </span>
  );
}

/**
 * Cases (FR-MOD-07.7, v2): tickets (FR-MOD-02.6) in the window split
 * open/closed/total, by UTC day, current status and stored queue priority
 * (FR-MOD-13.6). Every card and table shares one series (`by_day`) with the
 * CSV/PDF export, so a download can never disagree with the tab beside it.
 */
function CasesTab(props: TabProps): ReactElement {
  const api = useApiClient();
  const { data, isPending, error } = useReport<ReportsCases>('cases', api, props);

  if (error) {
    return (
      <ErrorNotice message="Could not load the Cases report. Check that the API is reachable and try again." />
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

  // `by_day` already excludes merged tickets (`merged_into_id`) — the same
  // series the CSV export's benchmark sums — so the card totals below can
  // never drift from the table underneath them.
  const totals = sumCaseSplit(data.by_day);
  const prev = data.previous_period;

  return (
    <>
      <Section title="Volume" description="Tickets in the selected window, by current status.">
        <KpiGrid>
          <Kpi
            label="Open"
            value={formatCount(totals.open)}
            delta={<CountDelta current={totals.open} previous={prev.open} />}
          />
          <Kpi
            label="Closed"
            value={formatCount(totals.closed)}
            delta={<CountDelta current={totals.closed} previous={prev.closed} />}
            tone="good"
          />
          <Kpi
            label="Total"
            value={formatCount(totals.total)}
            delta={<CountDelta current={totals.total} previous={prev.total} />}
          />
        </KpiGrid>
      </Section>

      <Section title="By day" description="Tickets created per UTC day, split open and closed.">
        <Card>
          {data.by_day.length === 0 ? (
            <EmptyState
              title="No cases in this window"
              description="Once a ticket is created in this window, its daily split shows up here."
            />
          ) : (
            <CasesDailyTable rows={data.by_day} />
          )}
        </Card>
      </Section>

      <Section
        title="By status"
        description="Tickets in the window, grouped by their current status."
      >
        <Card>
          {data.by_status.length === 0 ? (
            <EmptyState
              title="No status data yet"
              description="Once a ticket is created in this window, its status breakdown shows up here."
            />
          ) : (
            <CasesStatusTable rows={data.by_status} />
          )}
        </Card>
      </Section>

      <Section
        title="By priority"
        description="Tickets in the window, grouped by their stored queue priority (highest first)."
      >
        <Card>
          {data.by_priority.length === 0 ? (
            <EmptyState
              title="No priority data yet"
              description="Once a ticket is created in this window, its priority breakdown shows up here."
            />
          ) : (
            <CasesPriorityTable rows={data.by_priority} />
          )}
        </Card>
      </Section>
    </>
  );
}

/** `by_day` summed into one open/closed/total figure — the window's own totals. */
function sumCaseSplit(rows: ReportsCases['by_day']): {
  open: number;
  closed: number;
  total: number;
} {
  return rows.reduce(
    (acc, row) => ({
      open: acc.open + row.open,
      closed: acc.closed + row.closed,
      total: acc.total + row.total,
    }),
    { open: 0, closed: 0, total: 0 },
  );
}

function CasesDailyTable({ rows }: { rows: ReportsCases['by_day'] }): ReactElement {
  const numeric = 'w-24 px-4 py-2 text-right text-xs font-medium text-content-secondary';
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Tickets per day, split open and closed</caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
            Day
          </th>
          <th scope="col" className={numeric}>
            Open
          </th>
          <th scope="col" className={numeric}>
            Closed
          </th>
          <th scope="col" className={numeric}>
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.date} className="border-b border-border last:border-0">
            <td className="tabular px-4 py-2">{row.date}</td>
            <td className="tabular px-4 py-2 text-right">{formatCount(row.open)}</td>
            <td className="tabular px-4 py-2 text-right">{formatCount(row.closed)}</td>
            <td className="tabular px-4 py-2 text-right">{formatCount(row.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CasesStatusTable({ rows }: { rows: ReportsCases['by_status'] }): ReactElement {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Tickets by current status</caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
            Status
          </th>
          <th
            scope="col"
            className="w-24 px-4 py-2 text-right text-xs font-medium text-content-secondary"
          >
            Tickets
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.status} className="border-b border-border last:border-0">
            <td className="truncate px-4 py-2 capitalize">{row.status}</td>
            <td className="tabular px-4 py-2 text-right">{formatCount(row.count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CasesPriorityTable({ rows }: { rows: ReportsCases['by_priority'] }): ReactElement {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Tickets by stored queue priority</caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
            Priority
          </th>
          <th
            scope="col"
            className="w-24 px-4 py-2 text-right text-xs font-medium text-content-secondary"
          >
            Tickets
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.priority} className="border-b border-border last:border-0">
            <td className="tabular px-4 py-2">{row.priority}</td>
            <td className="tabular px-4 py-2 text-right">{formatCount(row.count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Leads (FR-MOD-07.7, v2): customers flagged as leads, counted by the UTC day
 * they first touched *this* license through a chat or a ticket — never by an
 * organization-wide creation date, which could belong to a sibling license
 * (NFR-S4; see the API's isolation note on `ReportsLeads`).
 */
function LeadsTab(props: TabProps): ReactElement {
  const api = useApiClient();
  const { data, isPending, error } = useReport<ReportsLeads>('leads', api, props);

  if (error) {
    return (
      <ErrorNotice message="Could not load the Leads report. Check that the API is reachable and try again." />
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
      <Section
        title="Volume"
        description="Customers flagged as leads, counted by the UTC day they first touched this license."
      >
        <KpiGrid>
          <Kpi
            label="New leads"
            value={formatCount(data.totals.leads)}
            delta={<CountDelta current={data.totals.leads} previous={prev.leads} />}
          />
        </KpiGrid>
      </Section>

      <Section title="By day" description="New leads per UTC day in the window.">
        <Card>
          {data.by_day.length === 0 ? (
            <EmptyState
              title="No new leads in this window"
              description="Once a customer's first chat or ticket with this license lands, they show up here."
            />
          ) : (
            <LeadsDailyTable rows={data.by_day} />
          )}
        </Card>
      </Section>
    </>
  );
}

function LeadsDailyTable({ rows }: { rows: ReportsLeads['by_day'] }): ReactElement {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">New leads per day</caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
            Day
          </th>
          <th
            scope="col"
            className="w-24 px-4 py-2 text-right text-xs font-medium text-content-secondary"
          >
            New leads
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.date} className="border-b border-border last:border-0">
            <td className="tabular px-4 py-2">{row.date}</td>
            <td className="tabular px-4 py-2 text-right">{formatCount(row.count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Sales (FR-MOD-07.7, v2; FR-MOD-13.5 dependency): the honest "not configured"
 * skeleton until the Sales tracker wires a real source — same contract as the
 * Reviews tab's Ecommerce section, as a report of its own. `configured` is
 * always `false` in v1, so this always renders the empty state below; no
 * figure here is ever a fabricated 0 (FR-EK-B.1, null ≠ 0).
 */
function SalesTab(props: TabProps): ReactElement {
  const api = useApiClient();
  const { data, isPending, error } = useReport<ReportsSales>('sales', api, props);

  if (error) {
    return (
      <ErrorNotice message="Could not load the Sales report. Check that the API is reachable and try again." />
    );
  }
  if (isPending) {
    return <CardSkeleton rows={3} />;
  }

  return (
    <Section title="Sales" description="Sales attributed to supported conversations.">
      <Card>
        {data.configured ? (
          <KpiGrid>
            <Kpi label="Tracked sales" value={formatCount(data.tracked_sales)} />
            <Kpi
              label="Attributed revenue"
              value={formatMoney(data.attributed_revenue_cents, data.currency ?? undefined) ?? '—'}
            />
            <Kpi label="Conversions" value={formatCount(data.conversions)} />
          </KpiGrid>
        ) : (
          <EmptyState
            title="Sales tracking not set up"
            description="Connect a sales source to attribute revenue to supported conversations. The Sales tracker (FR-MOD-13.5) is not available yet."
          />
        )}
      </Card>
    </Section>
  );
}

/**
 * Team performance (FR-MOD-07.7, v2): the Breakdown tab's by-agent chat split
 * (chats/closed/automated/assisted/manual), extended per agent with average
 * first-response time and CSAT. Same agent set, order and `LIMIT 20` as
 * `ReportsBreakdown.by_agent` — an agent needs a thread *created* in the
 * window to appear here at all.
 */
function TeamPerformanceTab(props: TabProps): ReactElement {
  const api = useApiClient();
  const { data, isPending, error } = useReport<ReportsTeamPerformance>(
    'team-performance',
    api,
    props,
  );

  if (error) {
    return (
      <ErrorNotice message="Could not load the Team performance report. Check that the API is reachable and try again." />
    );
  }
  if (isPending) {
    return <CardSkeleton rows={4} />;
  }

  return (
    <Section
      title="Team performance"
      description="Per-agent chats, resolution split, first-response time and CSAT for the window."
    >
      <Card>
        {data.agents.length === 0 ? (
          <EmptyState
            title="No agent activity in this window"
            description="Once conversations are assigned to agents, their per-agent performance shows up here."
          />
        ) : (
          <TeamPerformanceTable rows={data.agents} />
        )}
      </Card>
    </Section>
  );
}

/**
 * The Team performance table: one row per agent, CSAT rendered as `—` (not
 * `0%`) when nobody rated that agent in the window — {@link CsatSummary}'s
 * `score` is already `null` for that case, so this only has to defer to it.
 */
function TeamPerformanceTable({ rows }: { rows: AgentPerformanceRow[] }): ReactElement {
  const numeric = 'w-24 px-4 py-2 text-right text-xs font-medium text-content-secondary';
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">
        Per-agent chats, resolution split, response time and CSAT
      </caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
            Agent
          </th>
          <th scope="col" className={numeric}>
            Chats
          </th>
          <th scope="col" className={numeric}>
            Closed
          </th>
          <th scope="col" className={numeric}>
            Automated
          </th>
          <th scope="col" className={numeric}>
            Assisted
          </th>
          <th scope="col" className={numeric}>
            Manual
          </th>
          <th scope="col" className={numeric}>
            Avg first response
          </th>
          <th scope="col" className={numeric}>
            CSAT
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.agent_id} className="border-b border-border last:border-0">
            <td className="truncate px-4 py-2">{row.name ?? 'Unknown agent'}</td>
            <td className="tabular px-4 py-2 text-right">{formatCount(row.chats)}</td>
            <td className="tabular px-4 py-2 text-right">{formatCount(row.closed)}</td>
            <td className="tabular px-4 py-2 text-right text-success">
              {formatCount(row.automated)}
            </td>
            <td className="tabular px-4 py-2 text-right text-success">
              {formatCount(row.assisted)}
            </td>
            <td className="tabular px-4 py-2 text-right">{formatCount(row.manual)}</td>
            <td className="tabular px-4 py-2 text-right">
              {formatDuration(row.avg_first_response_seconds) ?? '—'}
            </td>
            <td className="tabular px-4 py-2 text-right">
              {row.csat.score === null ? '—' : formatRate(row.csat.score)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * CSV/PDF export (FR-MOD-07.7 "export"): the active tab's group, over the
 * selected window — `GET /reports/export?group=<tab>&from&to&format=csv|pdf`,
 * the same endpoint the backend already gates on `EXPORT_SCOPES` and a
 * per-group scope check (`reports.ts`). Hidden until `/reports/groups`
 * confirms this tab is one the caller may export ("İzin bazlı görünürlük"):
 * the same fail-closed default the gated tabs above use, and the same reason
 * — a transient loading state and "no export scope" look identical for one
 * beat, and that is the safe default for a permission-gated download.
 *
 * A failed download surfaces the server's own message rather than swallowing
 * it — an agent who cannot export a group needs to know why, not watch
 * nothing happen (no silent failure).
 */
function ExportControl({
  group,
  range,
  visible,
}: {
  group: TabId;
  range: { from: string; to: string } | null;
  visible: boolean;
}): ReactElement | null {
  const api = useApiClient();
  const [format, setFormat] = useState<'csv' | 'pdf'>('csv');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!visible) return null;

  const download = async (): Promise<void> => {
    if (!range) return;
    setPending(true);
    setError(null);
    try {
      const { blob, filename } = await api.getFile(
        `/reports/export?group=${group}&${rangeQuery(range)}&format=${format}`,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      // The server names the file after the group and window
      // (`exportFilename`, `reports-export.ts`); a caller only falls back to
      // its own name if `content-disposition` is somehow missing.
      link.download = filename ?? `nexa-${group}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : 'Could not export this report.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <label className="sr-only" htmlFor="export-format">
          Export format
        </label>
        <select
          id="export-format"
          value={format}
          onChange={(event) => setFormat(event.target.value as 'csv' | 'pdf')}
          className="rounded-md border border-border bg-inset px-2 py-1.5 text-xs text-content"
        >
          <option value="csv">CSV</option>
          <option value="pdf">PDF</option>
        </select>
        <button
          type="button"
          disabled={!range || pending}
          onClick={() => void download()}
          className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {pending ? 'Exporting…' : 'Export'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-2xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Saved views (FR-MOD-07.7, KK-derived from 07.7-h): the report-views store
 * wired to the page through the same `onSelectSaved`/`onAddSavedView`/
 * `onRemoveSavedView` shape Inbox binds its own saved filters with
 * (`InboxPage.tsx`'s `ViewsGroup`) — a click applies a saved view, a name and
 * Save stores the current one, and a saved row can be removed.
 */
function SavedViewsControl({
  views,
  onSelect,
  onAdd,
  onRemove,
}: {
  views: SavedReportView[];
  onSelect: (view: SavedReportView) => void;
  onAdd: (name: string) => SavedReportView | null;
  onRemove: (id: string) => void;
}): ReactElement {
  return (
    <Dropdown
      label="Saved views"
      trigger="Views"
      triggerClassName="rounded-md border border-border bg-inset px-2.5 py-1.5 text-xs font-medium text-content-secondary transition-colors hover:text-content"
      panelClassName="right-0 top-full mt-1 w-64 p-2"
    >
      {({ close }) => (
        <div className="flex flex-col gap-2">
          {views.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {views.map((view) => (
                <li key={view.id} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(view);
                      close();
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-content-secondary transition-colors hover:bg-surface-2"
                  >
                    <span aria-hidden="true" className="text-content-tertiary">
                      ★
                    </span>
                    <span className="flex-1 truncate">{view.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(view.id)}
                    aria-label={`Remove saved view ${view.name}`}
                    className="shrink-0 rounded-md px-1.5 py-1 text-2xs text-content-tertiary opacity-0 transition-opacity hover:text-danger focus:opacity-100 group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <SaveCurrentView onAdd={onAdd} />
        </div>
      )}
    </Dropdown>
  );
}

/**
 * "Save this view": the shared form primitive (FR-EK-A.1) rather than a bare
 * disabled-button check — an empty name shows a field-under error, same as
 * every other validated form, and Submit stays disabled until the name is
 * real.
 */
function SaveCurrentView({
  onAdd,
}: {
  onAdd: (name: string) => SavedReportView | null;
}): ReactElement {
  const form = useForm({
    initial: { name: '' },
    validators: { name: required('Enter a name for this view.') },
    onSubmit: (values, { reset, setSubmitError }) => {
      if (!onAdd(values.name)) {
        setSubmitError('Enter a name for this view.');
        return;
      }
      reset();
    },
  });
  const nameError = form.errorFor('name');

  return (
    <form
      onSubmit={form.handleSubmit}
      noValidate
      className="flex flex-col gap-1.5 border-t border-border pt-2"
    >
      <label
        htmlFor="save-report-view-name"
        className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
      >
        Save this view
      </label>
      <input
        id="save-report-view-name"
        value={form.values.name}
        onChange={(event) => form.setValue('name', event.target.value)}
        onBlur={() => form.blur('name')}
        maxLength={SAVED_REPORT_VIEW_NAME_MAX}
        placeholder="Name this view"
        aria-invalid={nameError ? true : undefined}
        aria-describedby={nameError ? 'save-report-view-name-error' : undefined}
        className="w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm"
      />
      <FieldError id="save-report-view-name-error" message={nameError} />
      <button
        type="submit"
        disabled={!form.canSubmit}
        className="self-start rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
      >
        {form.isSubmitting ? 'Saving…' : 'Save'}
      </button>
    </form>
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

function CountDelta(props: {
  current: number | null;
  previous: number | null;
}): ReactElement | null {
  return <Delta {...props} format={formatCount} />;
}

function DurationDelta(props: {
  current: number | null;
  previous: number | null;
}): ReactElement | null {
  return <Delta {...props} format={formatDuration} />;
}

function RateDelta(props: {
  current: number | null;
  previous: number | null;
}): ReactElement | null {
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
