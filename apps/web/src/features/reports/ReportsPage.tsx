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
import { useEffect, useState, type ReactElement } from 'react';
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
import { Banner, Dropdown, bannerDismissKey } from '../../components/ui/index.js';
import { useApiClient } from '../../lib/auth-store.js';
import { errorMessageKey, type ApiClient } from '../../lib/api-client.js';
import {
  formatCount,
  formatDuration,
  formatMoney,
  formatRate,
  formatWeekday,
  type Weekday,
} from '../../lib/format.js';
import { getLocale, useTranslate, type TFunction } from '../../lib/i18n.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import {
  SAVED_REPORT_VIEW_NAME_MAX,
  useSavedReportViews,
  type ReportBaseline,
  type SavedReportView,
} from './report-views.js';
import { SurveyPopover } from './SurveyPopover.js';

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
  { id: 'overview' },
  { id: 'ai-agent' },
  { id: 'reviews' },
  { id: 'breakdown' },
  { id: 'staffing' },
  { id: 'topics' },
  { id: 'cases' },
  { id: 'leads' },
  { id: 'sales' },
  { id: 'team-performance' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** `TabId` → its catalogue key. Module-level data, not JSX, so it carries no
 * English fallback text — the render site resolves it through `t()`. */
const TAB_LABEL_KEYS: Record<TabId, string> = {
  overview: 'reports.tabs.overview',
  'ai-agent': 'reports.tabs.aiAgent',
  reviews: 'reports.tabs.reviews',
  breakdown: 'reports.tabs.breakdown',
  staffing: 'reports.tabs.staffing',
  topics: 'reports.tabs.topics',
  cases: 'reports.tabs.cases',
  leads: 'reports.tabs.leads',
  sales: 'reports.tabs.sales',
  'team-performance': 'reports.tabs.teamPerformance',
};

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
 * Marks the offer used up — the same `localStorage` key Banner's own dismiss
 * button writes (`bannerDismissKey`), so opening Topics has the identical
 * effect to clicking "Remind me later" once and for all.
 */
function markTopicsSeen(): void {
  try {
    localStorage.setItem(bannerDismissKey(TOPICS_PROMO_BANNER_ID), '1');
  } catch {
    // Storage unavailable — the tab still switches, the banner just outlives
    // the session it would otherwise have been silenced in.
  }
}

/**
 * Overview-only promo for the Chat topics tab (FR-MOD-07.6, rapor-1-fonksiyonel.md:297).
 * Segment: shown only while Topics has never been opened (02.2.3's sibling KK
 * — "kalıcı dismiss + segment"). "See chat topics" switches the tab in place;
 * "Remind me later" is Banner's own persistent dismiss (`dismissLabel`) rather
 * than a second control — either path, or opening the Topics tab directly
 * (`ReportsPage`'s own effect), silences it for good.
 */
function TopicsPromoBanner({ onSeeTopics }: { onSeeTopics: () => void }): ReactElement {
  const t = useTranslate();
  return (
    <Banner
      tone="brand"
      id={TOPICS_PROMO_BANNER_ID}
      dismissible
      dismissLabel={t('reports.topicsPromo.dismiss')}
      cta={
        <button
          type="button"
          onClick={onSeeTopics}
          className="rounded-md bg-brand-500 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-600"
        >
          {t('reports.topicsPromo.cta')}
        </button>
      }
    >
      {t('reports.topicsPromo.text')}
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
  const t = useTranslate();
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

  // The topics promo's segment (FR-MOD-07.6): once Topics has been opened —
  // by this tab, its own CTA, or a restored saved view — the offer is used up
  // for good, the same as clicking the banner's own "Remind me later".
  useEffect(() => {
    if (tab === 'topics') markTopicsSeen();
  }, [tab]);

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
      title={t('reports.page.title')}
      description={t('reports.page.description')}
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
      <SurveyPopover />
      <div
        role="tablist"
        aria-label={t('reports.page.tabsAriaLabel')}
        className="flex gap-1 border-b border-border"
      >
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
              {t(TAB_LABEL_KEYS[tabDef.id])}
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
              title={t('reports.emptyRange.title')}
              description={t('reports.emptyRange.description')}
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
  const t = useTranslate();
  const api = useApiClient();
  const { data, isPending, error } = useReport<ReportsOverview>('overview', api, props);

  if (error) {
    return <ErrorNotice message={t('reports.overview.error')} />;
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
        title={t('reports.common.volume')}
        description={t('reports.overview.volume.description')}
      >
        <KpiGrid>
          <Kpi
            label={t('reports.overview.kpi.conversations')}
            value={formatCount(data.totals.chats)}
            delta={<CountDelta current={data.totals.chats} previous={prev.chats} />}
          />
          <Kpi
            label={t('reports.overview.kpi.totalCases')}
            value={formatCount(data.totals.total_cases)}
            delta={<CountDelta current={data.totals.total_cases} previous={prev.total_cases} />}
            hint={t('reports.overview.kpi.totalCasesHint', {
              chats: formatCount(data.totals.chats) ?? data.totals.chats,
              tickets: formatCount(data.totals.tickets) ?? data.totals.tickets,
            })}
          />
          <Kpi
            label={t('reports.common.closed')}
            value={formatCount(data.totals.closed)}
            delta={<CountDelta current={data.totals.closed} previous={prev.closed} />}
          />
          <Kpi
            label={t('reports.overview.kpi.queuedNow')}
            value={formatCount(data.totals.queued_now)}
            tone={data.totals.queued_now > 0 ? 'warn' : 'neutral'}
            hint={
              data.totals.queued_now > 0
                ? t('reports.overview.queue.waiting')
                : t('reports.overview.queue.empty')
            }
          />
          <Kpi
            label={t('reports.overview.kpi.achievedGoals')}
            value={formatCount(data.totals.achieved_goals)}
            delta={
              <CountDelta current={data.totals.achieved_goals} previous={prev.achieved_goals} />
            }
          />
        </KpiGrid>
      </Section>

      <Section
        title={t('reports.overview.resolution.title')}
        description={t('reports.overview.resolution.description')}
      >
        <KpiGrid>
          <Kpi
            label={t('reports.common.resolution.manual')}
            value={formatCount(data.totals.manual)}
            delta={<CountDelta current={data.totals.manual} previous={prev.manual} />}
            hint={closedShare(t, data.totals.manual_rate)}
          />
          <Kpi
            label={t('reports.common.resolution.assisted')}
            value={formatCount(data.totals.assisted)}
            delta={<CountDelta current={data.totals.assisted} previous={prev.assisted} />}
            hint={closedShare(t, data.totals.assisted_rate)}
            tone="good"
          />
          <Kpi
            label={t('reports.common.resolution.automated')}
            value={formatCount(data.totals.automated)}
            delta={<CountDelta current={data.totals.automated} previous={prev.automated} />}
            hint={closedShare(t, data.totals.automated_rate)}
            tone="good"
          />
        </KpiGrid>
      </Section>

      <Section
        title={t('reports.overview.chats.title')}
        description={t('reports.overview.chats.description')}
      >
        <KpiGrid>
          <Kpi
            label={t('reports.overview.kpi.automatedPerHour')}
            value={formatCount(data.chats.automated_per_hour)}
            hint={t('reports.overview.kpi.automatedPerHourHint')}
          />
          <Kpi
            label={t('reports.common.kpi.automatedChatDuration')}
            value={formatDuration(data.chats.automated_avg_duration_seconds)}
            hint={t('reports.common.hint.averageOpenToClose')}
          />
          <Kpi
            label={t('reports.overview.kpi.totalDuration')}
            value={formatDuration(data.chats.total_duration_seconds)}
            hint={t('reports.overview.kpi.totalDurationHint')}
          />
        </KpiGrid>
      </Section>

      <Section title={t('reports.overview.responsiveness.title')}>
        <KpiGrid>
          <Kpi
            label={t('reports.overview.kpi.firstResponse')}
            value={formatDuration(data.response_times.avg_first_response_seconds)}
            delta={
              <DurationDelta
                current={data.response_times.avg_first_response_seconds}
                previous={prev.avg_first_response_seconds}
              />
            }
            hint={t('reports.overview.kpi.firstResponseHint')}
          />
          <Kpi
            label={t('reports.overview.kpi.conversationLength')}
            value={formatDuration(data.response_times.avg_duration_seconds)}
            delta={
              <DurationDelta
                current={data.response_times.avg_duration_seconds}
                previous={prev.avg_duration_seconds}
              />
            }
            hint={t('reports.overview.kpi.conversationLengthHint')}
          />
          <Kpi
            label={t('reports.overview.kpi.satisfaction')}
            value={formatRate(data.satisfaction.score)}
            delta={
              <RateDelta current={data.satisfaction.score} previous={prev.satisfaction_score} />
            }
            hint={
              data.satisfaction.responses === 0
                ? t('reports.common.noRatingsYet')
                : t('reports.common.ratingCount', { count: data.satisfaction.responses })
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
            label={t('reports.overview.kpi.negativeRatings')}
            value={formatCount(data.satisfaction.bad)}
            tone={data.satisfaction.bad > 0 ? 'warn' : 'neutral'}
          />
          <Kpi
            label={t('reports.overview.kpi.slaBreaches')}
            value={data.sla.active ? formatCount(data.sla.breaches) : null}
            delta={
              data.sla.active ? (
                <CountDelta current={data.sla.breaches} previous={prev.sla_breaches} />
              ) : undefined
            }
            tone={data.sla.active && data.sla.breaches > 0 ? 'warn' : 'neutral'}
            hint={
              !data.sla.active
                ? t('reports.overview.sla.notConfigured')
                : data.sla.low_confidence
                  ? t('reports.overview.sla.lowConfidence')
                  : undefined
            }
          />
        </KpiGrid>
      </Section>

      <Section
        title={t('reports.common.byAgent')}
        description={t('reports.overview.byAgent.description')}
      >
        <Card>
          {data.by_agent.length === 0 ? (
            <EmptyState
              title={t('reports.common.noAssignedConversations')}
              description={t('reports.overview.byAgent.emptyDescription')}
            />
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">{t('reports.overview.byAgent.caption')}</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
                    {t('reports.common.agentColumn')}
                  </th>
                  <th
                    scope="col"
                    className="w-32 px-4 py-2 text-right text-xs font-medium text-content-secondary"
                  >
                    {t('reports.overview.kpi.conversations')}
                  </th>
                  <th
                    scope="col"
                    className="w-2/5 px-4 py-2 text-xs font-medium text-content-secondary"
                  >
                    {t('reports.overview.byAgent.shareColumn')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.by_agent.map((row) => (
                  <tr key={row.agent_id} className="border-b border-border last:border-0">
                    <td className="truncate px-4 py-2">
                      {row.name ?? t('reports.common.unknownAgent')}
                    </td>
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

      <Section
        title={t('reports.overview.topTags.title')}
        description={t('reports.overview.topTags.description')}
      >
        {data.top_tags.length === 0 ? (
          <Card>
            <EmptyState
              title={t('reports.overview.topTags.emptyTitle')}
              description={t('reports.overview.topTags.emptyDescription')}
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
  const t = useTranslate();
  const api = useApiClient();
  const { data, isPending, error } = useReport<ReportsAiAgent>('ai-agent', api, props);

  if (error) {
    return <ErrorNotice message={t('reports.aiAgent.error')} />;
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
        title={t('reports.aiAgent.resolution.title')}
        description={t('reports.aiAgent.resolution.description')}
      >
        <KpiGrid>
          <Kpi
            label={t('reports.aiAgent.kpi.resolutions')}
            value={formatCount(data.resolutions)}
            tone="good"
          />
          <Kpi
            label={t('reports.aiAgent.kpi.resolutionRate')}
            value={formatRate(data.resolution_rate)}
            hint={closedShare(t, data.resolution_rate)}
            tone="good"
          />
          <Kpi
            label={t('reports.common.kpi.automatedChatDuration')}
            value={formatDuration(data.avg_automated_duration_seconds)}
            hint={t('reports.common.hint.averageOpenToClose')}
          />
        </KpiGrid>
      </Section>

      <Section
        title={t('reports.aiAgent.deflection.title')}
        description={t('reports.aiAgent.deflection.description')}
      >
        <KpiGrid>
          <Kpi label={t('reports.aiAgent.kpi.transfers')} value={formatCount(data.transfers)} />
          <Kpi
            label={t('reports.aiAgent.kpi.transferRate')}
            value={formatRate(data.transfer_rate)}
            hint={
              data.transfer_rate === null
                ? t('reports.aiAgent.transferRate.empty')
                : t('reports.aiAgent.transferRate.hint')
            }
            tone={data.transfer_rate !== null && data.transfer_rate >= 0.5 ? 'warn' : 'neutral'}
          />
          <Kpi label={t('reports.aiAgent.kpi.skillsRun')} value={formatCount(data.skill_runs)} />
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
  const t = useTranslate();
  const api = useApiClient();
  const { data, isPending, error } = useReport<ReportsReviews>('reviews', api, props);

  if (error) {
    return <ErrorNotice message={t('reports.reviews.error')} />;
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
        title={t('reports.reviews.csat.title')}
        description={t('reports.reviews.csat.description')}
      >
        <Card>
          {csat.responses === 0 ? (
            <EmptyState
              title={t('reports.common.noRatingsYet')}
              description={t('reports.reviews.csat.emptyDescription')}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-8 p-2">
              <CsatDonut good={csat.good} bad={csat.bad} score={csat.score} />
              <div className="flex min-w-[11rem] flex-col gap-2 text-sm">
                <CsatLegend
                  swatch="bg-success"
                  label={t('reports.reviews.csat.good')}
                  value={csat.good}
                />
                <CsatLegend
                  swatch="bg-danger"
                  label={t('reports.reviews.csat.bad')}
                  value={csat.bad}
                />
                <p className="pt-1 text-content-secondary">
                  {t('reports.common.ratingCount', { count: csat.responses })}
                </p>
                <p className="text-2xs text-content-tertiary">
                  {prev.score === null
                    ? t('reports.reviews.csat.noPreviousRatings')
                    : t('reports.reviews.csat.vsPrevious', { rate: formatRate(prev.score) ?? '' })}
                </p>
              </div>
            </div>
          )}
        </Card>
      </Section>

      <Section
        title={t('reports.reviews.byDay.title')}
        description={t('reports.reviews.byDay.description')}
      >
        <Card>
          {data.by_day.length === 0 ? (
            <EmptyState
              title={t('reports.reviews.byDay.emptyTitle')}
              description={t('reports.reviews.byDay.emptyDescription')}
            />
          ) : (
            <DailyBar rows={data.by_day} />
          )}
        </Card>
      </Section>

      <Section
        title={t('reports.reviews.ecommerce.title')}
        description={t('reports.reviews.ecommerce.description')}
      >
        <Card>
          {data.ecommerce.configured ? (
            <KpiGrid>
              <Kpi
                label={t('reports.common.kpi.trackedSales')}
                value={formatCount(data.ecommerce.tracked_sales)}
              />
              <Kpi
                label={t('reports.common.kpi.attributedRevenue')}
                value={formatMoney(
                  data.ecommerce.attributed_revenue_cents,
                  data.ecommerce.currency,
                )}
                hint={data.ecommerce.currency}
              />
            </KpiGrid>
          ) : (
            <EmptyState
              title={t('reports.common.salesNotConfigured')}
              description={t('reports.reviews.ecommerce.emptyDescription')}
              action={
                <Link
                  to="/app/settings#section-sales-tracker"
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
                >
                  {t('reports.reviews.ecommerce.cta')}
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
  const t = useTranslate();
  const responses = good + bad;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const goodLength = responses > 0 ? (good / responses) * circumference : 0;
  const label = t('reports.reviews.csat.donutLabel', {
    rate: formatRate(score) ?? t('reports.reviews.csat.donutUnknown'),
    good,
    responses,
  });

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
  const t = useTranslate();
  const max = Math.max(1, ...rows.map((row) => row.responses));
  const numeric = 'w-20 px-4 py-2 text-right text-xs font-medium text-content-secondary';
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{t('reports.reviews.byDay.caption')}</caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
            {t('reports.common.dayColumn')}
          </th>
          <th scope="col" className="w-2/5 px-4 py-2 text-xs font-medium text-content-secondary">
            {t('reports.reviews.byDay.ratingsColumn')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.reviews.byDay.goodColumn')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.reviews.byDay.badColumn')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.common.csatColumn')}
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
  const t = useTranslate();
  const api = useApiClient();
  const { data, isPending, error } = useReport<ReportsBreakdown>('breakdown', api, props);

  if (error) {
    return <ErrorNotice message={t('reports.breakdown.error')} />;
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
        title={t('reports.common.byDay')}
        description={t('reports.breakdown.byDay.description')}
      >
        <Card>
          {data.by_day.length === 0 ? (
            <EmptyState
              title={t('reports.breakdown.byDay.emptyTitle')}
              description={t('reports.breakdown.byDay.emptyDescription')}
            />
          ) : (
            <SplitTable
              caption={t('reports.breakdown.byDay.caption')}
              firstColumn={t('reports.common.dayColumn')}
              rows={data.by_day.map((row) => ({ key: row.date, label: row.date, ...row }))}
            />
          )}
        </Card>
      </Section>

      <Section
        title={t('reports.common.byAgent')}
        description={t('reports.breakdown.byAgent.description')}
      >
        <Card>
          {data.by_agent.length === 0 ? (
            <EmptyState
              title={t('reports.common.noAssignedConversations')}
              description={t('reports.breakdown.byAgent.emptyDescription')}
            />
          ) : (
            <SplitTable
              caption={t('reports.breakdown.byAgent.caption')}
              firstColumn={t('reports.common.agentColumn')}
              rows={data.by_agent.map((row) => ({
                key: row.agent_id,
                label: row.name ?? t('reports.common.unknownAgent'),
                ...row,
              }))}
            />
          )}
        </Card>
      </Section>

      <Section
        title={t('reports.breakdown.byHour.title')}
        description={t('reports.breakdown.byHour.description')}
      >
        <Card>
          {(data.by_hour ?? []).length === 0 ? (
            <EmptyState
              title={t('reports.breakdown.byHour.emptyTitle')}
              description={t('reports.breakdown.byHour.emptyDescription')}
            />
          ) : (
            <SplitTable
              caption={t('reports.breakdown.byHour.caption')}
              firstColumn={t('reports.breakdown.byHour.column')}
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
        title={t('reports.breakdown.byTeam.title')}
        description={
          data.overlapping
            ? t('reports.breakdown.byTeam.descriptionOverlap')
            : t('reports.breakdown.byTeam.description')
        }
      >
        <Card>
          {(data.by_team ?? []).length === 0 ? (
            <EmptyState
              title={t('reports.breakdown.byTeam.emptyTitle')}
              description={t('reports.breakdown.byTeam.emptyDescription')}
            />
          ) : (
            <SplitTable
              caption={t('reports.breakdown.byTeam.caption')}
              firstColumn={t('reports.breakdown.byTeam.column')}
              rows={(data.by_team ?? []).map((row) => ({
                key: String(row.team_id ?? 'unassigned'),
                label: row.name ?? t('reports.breakdown.byTeam.unassigned'),
                ...row,
              }))}
            />
          )}
        </Card>
      </Section>

      <Section
        title={t('reports.breakdown.byChannel.title')}
        description={t('reports.breakdown.byChannel.description')}
      >
        <Card>
          {(data.by_channel ?? []).length === 0 ? (
            <EmptyState
              title={t('reports.breakdown.byChannel.emptyTitle')}
              description={t('reports.breakdown.byChannel.emptyDescription')}
            />
          ) : (
            <SplitTable
              caption={t('reports.breakdown.byChannel.caption')}
              firstColumn={t('reports.breakdown.byChannel.column')}
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
  const t = useTranslate();
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
            {t('reports.common.resolution.chats')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.common.resolution.manual')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.common.resolution.assisted')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.common.resolution.automated')}
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

/** `day_of_week` 0 (Sunday) … 6 (Saturday) → the `Weekday` `formatWeekday` understands. */
const STAFFING_DAY_OF_WEEK: readonly Weekday[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];
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
  const t = useTranslate();
  const api = useApiClient();
  const { data, isPending, error } = useReport<StaffingForecast>('staffing-forecast', api, props);

  if (error) {
    return <ErrorNotice message={t('reports.staffing.error')} />;
  }
  if (isPending) {
    return <CardSkeleton rows={7} />;
  }

  const totalObserved = data.cells.reduce((sum, cell) => sum + cell.observed_chats, 0);

  return (
    <Section title={t('reports.tabs.staffing')} description={t('reports.staffing.description')}>
      <Card>
        {totalObserved === 0 ? (
          <EmptyState
            title={t('reports.staffing.emptyTitle')}
            description={t('reports.staffing.emptyDescription')}
          />
        ) : (
          <>
            {!data.coverage_known && (
              <p className="border-b border-border px-4 py-2 text-2xs text-warning">
                {t('reports.staffing.noPresenceData')}
              </p>
            )}
            {!data.roster_known && (
              <p className="border-b border-border px-4 py-2 text-2xs text-content-secondary">
                {t('reports.staffing.noRoster')}
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
  const t = useTranslate();
  const locale = getLocale();
  const byKey = new Map<string, StaffingCell>();
  for (const cell of cells) {
    byKey.set(`${cell.day_of_week}-${cell.hour}`, cell);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">{t('reports.staffing.gridCaption')}</caption>
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className="px-2 py-1.5 text-2xs font-medium text-content-secondary">
              {t('reports.common.dayColumn')}
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
          {STAFFING_DAY_OF_WEEK.map((day, dayOfWeek) => (
            <tr key={day} className="border-b border-border last:border-0">
              <th
                scope="row"
                className="px-2 py-1.5 text-left text-2xs font-medium text-content-secondary"
              >
                {formatWeekday(day, locale, 'short')}
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
  const t = useTranslate();
  if (
    !cell ||
    cell.gap === null ||
    cell.required_agents === null ||
    cell.scheduled_agents === null
  ) {
    return (
      <td
        title={t('reports.staffing.cellUnknown')}
        className="tabular px-1 py-1.5 text-center text-content-tertiary"
      >
        —
      </td>
    );
  }

  const { gap, required_agents, scheduled_agents } = cell;
  const highlight = gap > 0;
  const title = t('reports.staffing.cellTitle', {
    required: required_agents,
    scheduled: formatScheduled(scheduled_agents),
    gap: formatGap(gap),
  });

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
  const t = useTranslate();
  const api = useApiClient();
  const { data, isPending, error } = useReport<ReportsTopics>('topics', api, props);

  if (error) {
    return <ErrorNotice message={t('reports.topics.error')} />;
  }
  if (isPending) {
    return <CardSkeleton rows={4} />;
  }

  return (
    <Section title={t('reports.tabs.topics')} description={t('reports.topics.description')}>
      <Card>
        {!data.sufficient_data || data.topics.length === 0 ? (
          <EmptyState
            title={t('reports.topics.emptyTitle')}
            description={t('reports.topics.emptyDescription', {
              min: data.min_conversations,
              analyzed: data.analyzed,
            })}
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
  const t = useTranslate();
  const numeric = 'w-28 px-4 py-2 text-right text-xs font-medium text-content-secondary';
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{t('reports.topics.caption')}</caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
            {t('reports.topics.topicColumn')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.common.volume')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.common.shareColumn')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.topics.trendColumn')}
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
  const t = useTranslate();
  if (trend === null) return <span className="text-content-tertiary">—</span>;
  if (trend === 0) {
    return <span className="text-content-tertiary">{t('reports.topics.noChange')}</span>;
  }
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
  const t = useTranslate();
  const api = useApiClient();
  const { data, isPending, error } = useReport<ReportsCases>('cases', api, props);

  if (error) {
    return <ErrorNotice message={t('reports.cases.error')} />;
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
      <Section
        title={t('reports.common.volume')}
        description={t('reports.cases.volume.description')}
      >
        <KpiGrid>
          <Kpi
            label={t('reports.cases.kpi.open')}
            value={formatCount(totals.open)}
            delta={<CountDelta current={totals.open} previous={prev.open} />}
          />
          <Kpi
            label={t('reports.common.closed')}
            value={formatCount(totals.closed)}
            delta={<CountDelta current={totals.closed} previous={prev.closed} />}
            tone="good"
          />
          <Kpi
            label={t('reports.cases.kpi.total')}
            value={formatCount(totals.total)}
            delta={<CountDelta current={totals.total} previous={prev.total} />}
          />
        </KpiGrid>
      </Section>

      <Section title={t('reports.common.byDay')} description={t('reports.cases.byDay.description')}>
        <Card>
          {data.by_day.length === 0 ? (
            <EmptyState
              title={t('reports.cases.byDay.emptyTitle')}
              description={t('reports.cases.byDay.emptyDescription')}
            />
          ) : (
            <CasesDailyTable rows={data.by_day} />
          )}
        </Card>
      </Section>

      <Section
        title={t('reports.cases.byStatus.title')}
        description={t('reports.cases.byStatus.description')}
      >
        <Card>
          {data.by_status.length === 0 ? (
            <EmptyState
              title={t('reports.cases.byStatus.emptyTitle')}
              description={t('reports.cases.byStatus.emptyDescription')}
            />
          ) : (
            <CasesStatusTable rows={data.by_status} />
          )}
        </Card>
      </Section>

      <Section
        title={t('reports.cases.byPriority.title')}
        description={t('reports.cases.byPriority.description')}
      >
        <Card>
          {data.by_priority.length === 0 ? (
            <EmptyState
              title={t('reports.cases.byPriority.emptyTitle')}
              description={t('reports.cases.byPriority.emptyDescription')}
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
  const t = useTranslate();
  const numeric = 'w-24 px-4 py-2 text-right text-xs font-medium text-content-secondary';
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{t('reports.cases.byDay.caption')}</caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
            {t('reports.common.dayColumn')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.cases.kpi.open')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.common.closed')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.cases.kpi.total')}
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
  const t = useTranslate();
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{t('reports.cases.byStatus.caption')}</caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
            {t('reports.cases.byStatus.column')}
          </th>
          <th
            scope="col"
            className="w-24 px-4 py-2 text-right text-xs font-medium text-content-secondary"
          >
            {t('reports.common.ticketsColumn')}
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
  const t = useTranslate();
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{t('reports.cases.byPriority.caption')}</caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
            {t('reports.cases.byPriority.column')}
          </th>
          <th
            scope="col"
            className="w-24 px-4 py-2 text-right text-xs font-medium text-content-secondary"
          >
            {t('reports.common.ticketsColumn')}
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
  const t = useTranslate();
  const api = useApiClient();
  const { data, isPending, error } = useReport<ReportsLeads>('leads', api, props);

  if (error) {
    return <ErrorNotice message={t('reports.leads.error')} />;
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
        title={t('reports.common.volume')}
        description={t('reports.leads.volume.description')}
      >
        <KpiGrid>
          <Kpi
            label={t('reports.leads.kpi.newLeads')}
            value={formatCount(data.totals.leads)}
            delta={<CountDelta current={data.totals.leads} previous={prev.leads} />}
          />
        </KpiGrid>
      </Section>

      <Section title={t('reports.common.byDay')} description={t('reports.leads.byDay.description')}>
        <Card>
          {data.by_day.length === 0 ? (
            <EmptyState
              title={t('reports.leads.byDay.emptyTitle')}
              description={t('reports.leads.byDay.emptyDescription')}
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
  const t = useTranslate();
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{t('reports.leads.byDay.caption')}</caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
            {t('reports.common.dayColumn')}
          </th>
          <th
            scope="col"
            className="w-24 px-4 py-2 text-right text-xs font-medium text-content-secondary"
          >
            {t('reports.leads.kpi.newLeads')}
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
  const t = useTranslate();
  const api = useApiClient();
  const { data, isPending, error } = useReport<ReportsSales>('sales', api, props);

  if (error) {
    return <ErrorNotice message={t('reports.sales.error')} />;
  }
  if (isPending) {
    return <CardSkeleton rows={3} />;
  }

  return (
    <Section title={t('reports.tabs.sales')} description={t('reports.sales.description')}>
      <Card>
        {data.configured ? (
          <KpiGrid>
            <Kpi
              label={t('reports.common.kpi.trackedSales')}
              value={formatCount(data.tracked_sales)}
            />
            <Kpi
              label={t('reports.common.kpi.attributedRevenue')}
              value={formatMoney(data.attributed_revenue_cents, data.currency ?? undefined) ?? '—'}
            />
            <Kpi label={t('reports.sales.kpi.conversions')} value={formatCount(data.conversions)} />
          </KpiGrid>
        ) : (
          <EmptyState
            title={t('reports.common.salesNotConfigured')}
            description={t('reports.sales.emptyDescription')}
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
  const t = useTranslate();
  const api = useApiClient();
  const { data, isPending, error } = useReport<ReportsTeamPerformance>(
    'team-performance',
    api,
    props,
  );

  if (error) {
    return <ErrorNotice message={t('reports.teamPerformance.error')} />;
  }
  if (isPending) {
    return <CardSkeleton rows={4} />;
  }

  return (
    <Section
      title={t('reports.tabs.teamPerformance')}
      description={t('reports.teamPerformance.description')}
    >
      <Card>
        {data.agents.length === 0 ? (
          <EmptyState
            title={t('reports.teamPerformance.emptyTitle')}
            description={t('reports.teamPerformance.emptyDescription')}
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
  const t = useTranslate();
  const numeric = 'w-24 px-4 py-2 text-right text-xs font-medium text-content-secondary';
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{t('reports.teamPerformance.caption')}</caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
            {t('reports.common.agentColumn')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.common.resolution.chats')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.common.closed')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.common.resolution.automated')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.common.resolution.assisted')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.common.resolution.manual')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.teamPerformance.avgFirstResponseColumn')}
          </th>
          <th scope="col" className={numeric}>
            {t('reports.common.csatColumn')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.agent_id} className="border-b border-border last:border-0">
            <td className="truncate px-4 py-2">{row.name ?? t('reports.common.unknownAgent')}</td>
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
  const t = useTranslate();
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
      setError(t(errorMessageKey(cause)));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <label className="sr-only" htmlFor="export-format">
          {t('reports.export.formatLabel')}
        </label>
        <select
          id="export-format"
          value={format}
          onChange={(event) => setFormat(event.target.value as 'csv' | 'pdf')}
          className="rounded-md border border-border bg-inset px-2 py-1.5 text-xs text-content"
        >
          <option value="csv">{t('reports.export.csv')}</option>
          <option value="pdf">{t('reports.export.pdf')}</option>
        </select>
        <button
          type="button"
          disabled={!range || pending}
          onClick={() => void download()}
          className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {pending ? t('reports.export.pending') : t('reports.export.cta')}
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
  const t = useTranslate();
  return (
    <Dropdown
      label={t('reports.savedViews.ariaLabel')}
      trigger={t('reports.savedViews.trigger')}
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
                    aria-label={t('reports.savedViews.remove', { name: view.name })}
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
  const t = useTranslate();
  const form = useForm({
    initial: { name: '' },
    validators: { name: required(t('reports.savedViews.nameError')) },
    onSubmit: (values, { reset, setSubmitError }) => {
      if (!onAdd(values.name)) {
        setSubmitError(t('reports.savedViews.nameError'));
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
        {t('reports.savedViews.saveLabel')}
      </label>
      <input
        id="save-report-view-name"
        value={form.values.name}
        onChange={(event) => form.setValue('name', event.target.value)}
        onBlur={() => form.blur('name')}
        maxLength={SAVED_REPORT_VIEW_NAME_MAX}
        placeholder={t('reports.savedViews.namePlaceholder')}
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
        {form.isSubmitting ? t('reports.savedViews.submitPending') : t('reports.savedViews.submit')}
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
  const t = useTranslate();
  const chip = (active: boolean): string =>
    `rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
      active
        ? 'border-brand-500 bg-brand-500/10 text-content'
        : 'border-border bg-inset text-content-secondary hover:text-content'
    }`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="flex items-center gap-1"
        role="group"
        aria-label={t('reports.range.groupAriaLabel')}
      >
        {PRESETS.map((days) => (
          <button
            key={days}
            type="button"
            aria-pressed={mode === days}
            onClick={() => onMode(days)}
            className={chip(mode === days)}
          >
            {t('reports.range.presetDays', { days })}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={mode === 'custom'}
          onClick={() => onMode('custom')}
          className={chip(mode === 'custom')}
        >
          {t('reports.range.custom')}
        </button>
      </div>
      {mode === 'custom' && (
        <div className="flex items-center gap-1 text-xs text-content-secondary">
          <label className="flex items-center gap-1">
            <span className="sr-only">{t('reports.range.startDate')}</span>
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
            <span className="sr-only">{t('reports.range.endDate')}</span>
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
  const t = useTranslate();
  if (current == null || previous == null) return null;
  const diff = Math.round((current - previous) * 1000) / 1000;
  if (diff === 0) {
    return (
      <span className="text-2xs text-content-tertiary">{t('reports.common.delta.noChange')}</span>
    );
  }
  return (
    <span className="text-2xs text-content-tertiary" title={t('reports.common.delta.tooltip')}>
      {diff > 0 ? '↑' : '↓'}{' '}
      {t('reports.common.delta.suffix', { value: format(Math.abs(diff)) ?? '' })}
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
function closedShare(t: TFunction, rate: number | null): string {
  return rate === null
    ? t('reports.common.closedShare.none')
    : t('reports.common.closedShare.value', { rate: formatRate(rate) ?? '' });
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
