/**
 * Raporlar › AI Agent — the AI quality panel (tm 320.3 · SiyahTuş analysis
 * AI-25; owner decisions K9, K10).
 *
 * Containment alone misleads (the analysis' example: 72.6% contained, 35.2%
 * really solved), so this panel shows what the player confirmed, what was
 * assumed and settled 72 hours later, what came back, how the hand-overs went
 * and whether every mandatory hand-over happened — each figure named and
 * explained by `AI_METRIC_DEFINITIONS`, never computed here.
 *
 * One read drives the KPIs and the comparison table:
 * `GET /reports/ai-agent/breakdown` returns the window's whole `quality` block
 * as `total` under the same filters, and the groups beside it. It is also the
 * one a Team Lead may call (their own teams, RL-02), so the panel reads the
 * same for both. The list under a figure is
 * `GET /reports/ai-agent/conversations`, the count's own predicate.
 *
 * The billed AI resolution (ADR-09a) is not here: the tab shows it above this
 * panel, in a box labelled as the invoice's figure (AI-25-S1).
 */
import {
  AI_METRICS_BREAKDOWN_DIMENSIONS,
  AI_METRICS_CONVERSATION_LISTS,
  type AiMetricKey,
  type AiMetricsBreakdownDimension,
  type AiMetricsConversationList,
  type AiWaitSummary,
} from '@siyahtus/types';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useId, useState, type ReactElement, type ReactNode } from 'react';
import { Card, CardSkeleton, ErrorNotice, KpiGrid, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { useApiClient } from '../../lib/auth-store.js';
import { enumLabel } from '../../lib/enum-label.js';
import {
  formatCount,
  formatDateTime,
  formatDecimal,
  formatDuration,
  formatLanguage,
  formatRate,
} from '../../lib/format.js';
import { useLocale, useTranslate, type TFunction } from '../../lib/i18n.js';
import {
  aiMetricsKeys,
  aiMetricsQuery,
  filterKeyOf,
  filtersOf,
  METRIC_LIST,
  metricHint,
  metricLabel,
  missesTarget,
  reasonShares,
  type AiMetricConversationsWire,
  type AiMetricsFilterChip,
  type AiQualityBreakdownWire,
  type AiQualityRatesWire,
  type AiQualityWire,
} from './ai-metrics.js';

/** The comparison the panel opens on: AI versions side by side (v12 beside v13). */
const DEFAULT_DIMENSION: AiMetricsBreakdownDimension = 'version';

export function AiMetricsPanel({
  range,
  rangeKey,
}: {
  range: { from: string; to: string } | null;
  rangeKey: string;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [by, setBy] = useState<AiMetricsBreakdownDimension>(DEFAULT_DIMENSION);
  const [chips, setChips] = useState<AiMetricsFilterChip[]>([]);
  const [list, setList] = useState<AiMetricsConversationList>('confirmed_resolved');
  const filters = filtersOf(chips);

  const breakdown = useQuery({
    queryKey: aiMetricsKeys.breakdown(rangeKey, by, filters),
    enabled: range !== null,
    // Switching the grouping keeps the figures on screen; only the table waits.
    placeholderData: keepPreviousData,
    queryFn: () =>
      api.get<AiQualityBreakdownWire>(
        `/reports/ai-agent/breakdown?${aiMetricsQuery(range as { from: string; to: string }, filters, { by })}`,
      ),
  });

  const addChip = (chip: AiMetricsFilterChip): void =>
    setChips((current) => [...current.filter((other) => other.key !== chip.key), chip]);
  const removeChip = (key: AiMetricsFilterChip['key']): void =>
    setChips((current) => current.filter((chip) => chip.key !== key));
  const openList = (metric: AiMetricsConversationList): void => {
    setList(metric);
    document.getElementById('ai-metrics-conversations')?.scrollIntoView?.({ block: 'start' });
  };

  if (breakdown.error) {
    return <ErrorNotice message={t('reports.aiMetrics.error')} />;
  }
  if (breakdown.isPending) {
    return (
      <>
        <CardSkeleton rows={2} />
        <CardSkeleton rows={3} />
      </>
    );
  }

  const quality = breakdown.data.total;

  return (
    <>
      <Section
        id="ai-metrics-quality"
        title={t('reports.aiMetrics.title')}
        description={t('reports.aiMetrics.description')}
      >
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xs text-content-secondary">
              {t('reports.aiMetrics.filters.active')}
            </span>
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => removeChip(chip.key)}
                aria-label={t('reports.aiMetrics.filters.remove', { label: chip.label })}
                className="flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs"
              >
                <span>{chip.label}</span>
                <span aria-hidden="true">×</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setChips([])}
              className="text-xs text-content-brand underline-offset-2 hover:underline"
            >
              {t('reports.aiMetrics.filters.clear')}
            </button>
          </div>
        )}
        <p className="text-xs text-content-secondary">
          {t('reports.aiMetrics.base', { count: quality.conversations })}
        </p>
        {quality.low_sample && quality.conversations > 0 && (
          <p
            role="status"
            className="rounded-md border border-border bg-inset px-3 py-2 text-2xs text-content-secondary"
          >
            {t('reports.aiMetrics.lowSample', { count: quality.conversations })}
          </p>
        )}
      </Section>

      <ResolutionSection quality={quality} onOpen={openList} />
      <HandoffSection quality={quality} onOpen={openList} />
      <SafetySection quality={quality} onOpen={openList} />

      <Section
        id="ai-metrics-breakdown"
        title={t('reports.aiMetrics.breakdown.title')}
        description={t('reports.aiMetrics.breakdown.description')}
      >
        <BreakdownTable data={breakdown.data} by={by} onBy={setBy} onFilter={addChip} />
      </Section>

      <Section
        id="ai-metrics-conversations"
        title={t('reports.aiMetrics.conversations.title')}
        description={t('reports.aiMetrics.conversations.description')}
      >
        <ConversationList
          range={range}
          rangeKey={rangeKey}
          filters={filters}
          metric={list}
          onMetric={setList}
        />
      </Section>
    </>
  );
}

type OpenList = (metric: AiMetricsConversationList) => void;

/**
 * One figure: its name, a "?" whose tooltip is the definition (hover or
 * keyboard focus; also the button's accessible description), the value, an
 * optional note, and — where the figure counts connections one by one — a
 * link to the list behind it.
 */
function MetricKpi({
  metric,
  value,
  note,
  tone = 'neutral',
  onOpen,
}: {
  metric: AiMetricKey;
  value: string | null;
  note?: ReactNode;
  tone?: 'neutral' | 'good' | 'warn';
  onOpen?: OpenList;
}): ReactElement {
  const t = useTranslate();
  const { locale } = useLocale();
  const tipId = useId();
  const label = metricLabel(metric, locale);
  const list = METRIC_LIST[metric];
  const valueColour =
    tone === 'good' ? 'text-success' : tone === 'warn' ? 'text-warning' : 'text-content';

  return (
    <div
      data-metric={metric}
      className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 shadow-xs"
    >
      <span className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        <span>{label}</span>
        <span className="group relative inline-flex">
          <button
            type="button"
            aria-label={t('reports.aiMetrics.definitionOf', { metric: label })}
            aria-describedby={tipId}
            className="flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] normal-case leading-none text-content-secondary hover:bg-inset"
          >
            ?
          </button>
          <span
            role="tooltip"
            id={tipId}
            className="pointer-events-none invisible absolute left-0 top-5 z-10 w-64 rounded-md border border-border bg-surface p-2 text-2xs font-normal normal-case tracking-normal text-content shadow-md group-focus-within:visible group-hover:visible"
          >
            {metricHint(metric, locale)}
          </span>
        </span>
      </span>
      <span
        className={`tabular font-heading text-2xl [font-weight:var(--kpi-weight)] ${valueColour}`}
      >
        {value ?? <span className="text-content-tertiary">—</span>}
      </span>
      {note && <span className="text-2xs text-content-tertiary">{note}</span>}
      {list && onOpen && (
        <button
          type="button"
          onClick={() => onOpen(list)}
          aria-label={t('reports.aiMetrics.showList', { metric: label })}
          className="self-start text-2xs text-content-brand underline-offset-2 hover:underline"
        >
          {t('reports.aiMetrics.showListShort')}
        </button>
      )}
    </div>
  );
}

function ResolutionSection({
  quality,
  onOpen,
}: {
  quality: AiQualityWire;
  onOpen: OpenList;
}): ReactElement {
  const t = useTranslate();
  const { locale } = useLocale();
  const claims = quality.claims;
  return (
    <Section
      id="ai-metrics-resolution"
      title={t('reports.aiMetrics.resolution.title')}
      description={t('reports.aiMetrics.resolution.description')}
    >
      <KpiGrid>
        <MetricKpi
          metric="confirmed_resolution"
          value={formatRate(quality.confirmed_resolution)}
          tone="good"
          onOpen={onOpen}
        />
        <MetricKpi
          metric="assumed_resolution"
          value={formatRate(quality.assumed_resolution)}
          note={t('reports.aiMetrics.unsettledNote', { count: quality.unsettled })}
          onOpen={onOpen}
        />
        <MetricKpi
          metric="unsettled"
          value={formatCount(quality.unsettled)}
          note={t('reports.aiMetrics.unsettledHint')}
          onOpen={onOpen}
        />
        <MetricKpi
          metric="false_resolution"
          value={formatRate(quality.false_resolution)}
          tone={
            quality.false_resolution !== null && quality.false_resolution > 0 ? 'warn' : 'neutral'
          }
          onOpen={onOpen}
        />
        <MetricKpi
          metric="containment"
          value={formatRate(quality.containment)}
          note={t('reports.aiMetrics.containmentCaution')}
        />
      </KpiGrid>

      {/* K9: what the AI said, beside what the player answered — two counts,
          never one figure. */}
      <Card>
        <h3 className="mb-2 text-xs font-semibold">{t('reports.aiMetrics.claims.title')}</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <ClaimFigure
            label={t('reports.aiMetrics.claims.aiClaimed')}
            value={claims.ai_claimed_resolved}
          />
          <ClaimFigure
            label={t('reports.aiMetrics.claims.playerConfirmed')}
            value={claims.player_confirmed}
          />
          <ClaimFigure
            label={t('reports.aiMetrics.claims.playerDenied')}
            value={claims.player_denied}
          />
          <ClaimFigure
            label={t('reports.aiMetrics.claims.unanswered')}
            value={claims.claimed_unanswered}
          />
        </dl>
        <p className="mt-2 text-2xs text-content-tertiary">
          {t('reports.aiMetrics.claims.note', {
            confirmed: metricLabel('confirmed_resolution', locale),
          })}
        </p>
      </Card>
    </Section>
  );
}

function ClaimFigure({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className="flex flex-col">
      <dt className="text-2xs text-content-secondary">{label}</dt>
      <dd className="tabular text-lg font-semibold">{formatCount(value)}</dd>
    </div>
  );
}

function HandoffSection({
  quality,
  onOpen,
}: {
  quality: AiQualityWire;
  onOpen: OpenList;
}): ReactElement {
  const t = useTranslate();
  const { locale } = useLocale();
  const compliance = quality.mandatory_handoff_compliance;
  const reasons = reasonShares(quality.handoff_reasons);
  return (
    <Section
      id="ai-metrics-handoff"
      title={t('reports.aiMetrics.handoff.title')}
      description={t('reports.aiMetrics.handoff.description')}
    >
      <KpiGrid>
        <MetricKpi metric="handoff_rate" value={formatRate(quality.handoff_rate)} onOpen={onOpen} />
        <MetricKpi metric="handoff_quality" value={formatRate(quality.handoff_quality)} />
        <MetricKpi metric="reask_rate" value={formatRate(quality.reask_rate)} />
        <MetricKpi
          metric="mandatory_handoff_compliance"
          value={formatRate(compliance)}
          tone={
            missesTarget('mandatory_handoff_compliance', compliance)
              ? 'warn'
              : compliance === null
                ? 'neutral'
                : 'good'
          }
          note={t('reports.aiMetrics.complianceTarget')}
          onOpen={onOpen}
        />
      </KpiGrid>

      <Card>
        <h3 className="mb-2 text-xs font-semibold">{metricLabel('handoff_wait', locale)}</h3>
        <p className="mb-2 text-2xs text-content-tertiary">{metricHint('handoff_wait', locale)}</p>
        <table className="w-full text-sm">
          <caption className="sr-only">{metricLabel('handoff_wait', locale)}</caption>
          <thead>
            <tr className="border-b border-border text-left">
              <th scope="col" className="px-2 py-1.5 text-xs font-medium text-content-secondary">
                {t('reports.aiMetrics.wait.when')}
              </th>
              <th
                scope="col"
                className="px-2 py-1.5 text-right text-xs font-medium text-content-secondary"
              >
                {t('reports.aiMetrics.wait.count')}
              </th>
              <th
                scope="col"
                className="px-2 py-1.5 text-right text-xs font-medium text-content-secondary"
              >
                {t('reports.aiMetrics.wait.median')}
              </th>
              <th
                scope="col"
                className="px-2 py-1.5 text-right text-xs font-medium text-content-secondary"
              >
                {t('reports.aiMetrics.wait.p90')}
              </th>
            </tr>
          </thead>
          <tbody>
            <WaitRow label={t('reports.aiMetrics.wait.all')} wait={quality.handoff_wait.all} />
            <WaitRow
              label={t('reports.aiMetrics.wait.inHours')}
              wait={quality.handoff_wait.in_hours}
            />
            <WaitRow
              label={t('reports.aiMetrics.wait.outOfHours')}
              wait={quality.handoff_wait.out_of_hours}
            />
          </tbody>
        </table>
        {quality.handoff_wait.in_hours === null && (
          <p className="mt-2 text-2xs text-content-tertiary">
            {t('reports.aiMetrics.wait.noSchedule')}
          </p>
        )}
      </Card>

      <Card>
        <h3 className="mb-2 text-xs font-semibold">{t('reports.aiMetrics.reasons.title')}</h3>
        {reasons.length === 0 ? (
          <p className="text-sm text-content-secondary">{t('reports.aiMetrics.reasons.empty')}</p>
        ) : (
          <ul aria-label={t('reports.aiMetrics.reasons.title')} className="flex flex-col gap-2">
            {reasons.map((row) => (
              <li key={row.reason} className="grid grid-cols-[1fr_auto_6rem] items-center gap-3">
                <span className="truncate text-sm">
                  {enumLabel(t, 'playbook.handoff.reason', row.reason)}
                </span>
                <span className="tabular text-xs text-content-secondary">
                  {formatCount(row.count)} · {formatRate(row.share)}
                </span>
                <ShareBar fraction={row.share} />
              </li>
            ))}
          </ul>
        )}
        {reasons.some((row) => row.reason === 'no_knowledge') && (
          <p className="mt-2 text-2xs text-content-tertiary">
            {t('reports.aiMetrics.reasons.noKnowledge')}
          </p>
        )}
      </Card>

      <Card>
        <h3 className="mb-2 text-xs font-semibold">{t('reports.aiMetrics.violations.title')}</h3>
        {quality.mandatory_violations.length === 0 ? (
          <p className="text-sm text-content-secondary">
            {t('reports.aiMetrics.violations.empty')}
          </p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">{t('reports.aiMetrics.violations.title')}</caption>
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="px-2 py-1.5 text-xs font-medium text-content-secondary">
                  {t('ids.chat.label')}
                </th>
                <th scope="col" className="px-2 py-1.5 text-xs font-medium text-content-secondary">
                  {t('ids.thread.label')}
                </th>
                <th scope="col" className="px-2 py-1.5 text-xs font-medium text-content-secondary">
                  {t('reports.aiMetrics.violations.rule')}
                </th>
                <th scope="col" className="px-2 py-1.5 text-xs font-medium text-content-secondary">
                  {t('reports.aiMetrics.list.ended')}
                </th>
              </tr>
            </thead>
            <tbody>
              {quality.mandatory_violations.map((row) => (
                <tr key={row.thread_id} className="border-b border-border last:border-0">
                  <td className="px-2 py-1.5 font-mono text-xs">{row.thread_id}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{row.chat_id}</td>
                  <td className="px-2 py-1.5">
                    {row.handoff_mandatory_rule
                      ? enumLabel(t, 'playbook.handoff.reason', row.handoff_mandatory_rule)
                      : t('reports.aiMetrics.violations.qaFound')}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-content-secondary">
                    {formatDateTime(row.ended_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Section>
  );
}

function WaitRow({ label, wait }: { label: string; wait: AiWaitSummary | null }): ReactElement {
  return (
    <tr className="border-b border-border last:border-0">
      <th scope="row" className="px-2 py-1.5 text-left font-normal">
        {label}
      </th>
      <td className="tabular px-2 py-1.5 text-right">{wait ? formatCount(wait.count) : '—'}</td>
      <td className="tabular px-2 py-1.5 text-right">
        {formatDuration(wait?.median_seconds) ?? '—'}
      </td>
      <td className="tabular px-2 py-1.5 text-right">{formatDuration(wait?.p90_seconds) ?? '—'}</td>
    </tr>
  );
}

function SafetySection({
  quality,
  onOpen,
}: {
  quality: AiQualityWire;
  onOpen: OpenList;
}): ReactElement {
  const t = useTranslate();
  return (
    <Section
      id="ai-metrics-safety"
      title={t('reports.aiMetrics.safety.title')}
      description={t('reports.aiMetrics.safety.description')}
    >
      <KpiGrid>
        <MetricKpi
          metric="guardrail_violation"
          value={formatRate(quality.guardrail_violation)}
          tone={
            quality.guardrail_violation !== null && quality.guardrail_violation > 0
              ? 'warn'
              : 'neutral'
          }
          onOpen={onOpen}
        />
        <MetricKpi
          metric="guardrail_suspected"
          value={formatRate(quality.guardrail_suspected)}
          onOpen={onOpen}
        />
        <MetricKpi
          metric="bsat"
          value={formatRate(quality.bsat)}
          note={t('reports.aiMetrics.ratings', {
            count: quality.counts.bsat_good + quality.counts.bsat_bad,
          })}
        />
        <MetricKpi
          metric="csat_after_handoff"
          value={formatRate(quality.csat_after_handoff)}
          note={t('reports.aiMetrics.ratings', {
            count: quality.counts.csat_good + quality.counts.csat_bad,
          })}
        />
        <MetricKpi
          metric="clarification_efficiency"
          value={formatDecimal(quality.clarification_efficiency)}
        />
        <MetricKpi metric="consistency" value={formatRate(quality.consistency)} />
        <MetricKpi
          metric="repeat_unmeasured"
          value={formatCount(quality.repeat_unmeasured)}
          onOpen={onOpen}
        />
      </KpiGrid>
    </Section>
  );
}

function ShareBar({ fraction }: { fraction: number }): ReactElement {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-inset" aria-hidden="true">
      <div
        className="h-full rounded-full bg-brand-500"
        style={{ width: `${Math.max(2, Math.min(1, fraction) * 100)}%` }}
      />
    </div>
  );
}

/** A group's name: a hand-over reason in words, a language by name, the label otherwise. */
function groupLabel(
  t: TFunction,
  by: AiMetricsBreakdownDimension,
  row: { key: string | null; label: string | null },
): string {
  if (row.key === null) return t(`reports.aiMetrics.noGroup.${by}`);
  if (by === 'reason') return enumLabel(t, 'playbook.handoff.reason', row.key);
  if (by === 'language') return formatLanguage(row.key) ?? row.key;
  return row.label ?? row.key;
}

function BreakdownTable({
  data,
  by,
  onBy,
  onFilter,
}: {
  data: AiQualityBreakdownWire;
  by: AiMetricsBreakdownDimension;
  onBy: (by: AiMetricsBreakdownDimension) => void;
  onFilter: (chip: AiMetricsFilterChip) => void;
}): ReactElement {
  const t = useTranslate();
  const { locale } = useLocale();
  const selectId = useId();
  const filterKey = filterKeyOf(by);
  const columns: Array<{ metric: AiMetricKey; value: (q: AiQualityRatesWire) => string | null }> = [
    { metric: 'confirmed_resolution', value: (q) => formatRate(q.confirmed_resolution) },
    { metric: 'assumed_resolution', value: (q) => formatRate(q.assumed_resolution) },
    { metric: 'false_resolution', value: (q) => formatRate(q.false_resolution) },
    { metric: 'handoff_rate', value: (q) => formatRate(q.handoff_rate) },
    { metric: 'handoff_quality', value: (q) => formatRate(q.handoff_quality) },
    {
      metric: 'mandatory_handoff_compliance',
      value: (q) => formatRate(q.mandatory_handoff_compliance),
    },
    { metric: 'bsat', value: (q) => formatRate(q.bsat) },
  ];

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <label htmlFor={selectId} className="text-xs text-content-secondary">
          {t('reports.aiMetrics.breakdown.by')}
        </label>
        <select
          id={selectId}
          value={by}
          onChange={(event) => onBy(event.target.value as AiMetricsBreakdownDimension)}
          className="rounded-md border border-border bg-inset px-2 py-1.5 text-xs text-content"
        >
          {AI_METRICS_BREAKDOWN_DIMENSIONS.map((dimension) => (
            <option key={dimension} value={dimension}>
              {t(`reports.aiMetrics.dimension.${dimension}`)}
            </option>
          ))}
        </select>
      </div>
      {data.by !== by ? (
        <CardSkeleton rows={2} />
      ) : data.rows.length === 0 ? (
        <EmptyState
          title={t('reports.aiMetrics.breakdown.emptyTitle')}
          description={t('reports.aiMetrics.breakdown.emptyDescription')}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              {t('reports.aiMetrics.breakdown.caption', {
                dimension: t(`reports.aiMetrics.dimension.${by}`),
              })}
            </caption>
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="px-2 py-1.5 text-xs font-medium text-content-secondary">
                  {t(`reports.aiMetrics.dimension.${by}`)}
                </th>
                <th
                  scope="col"
                  className="px-2 py-1.5 text-right text-xs font-medium text-content-secondary"
                >
                  {t('reports.aiMetrics.breakdown.n')}
                </th>
                {columns.map((column) => (
                  <th
                    key={column.metric}
                    scope="col"
                    className="px-2 py-1.5 text-right text-xs font-medium text-content-secondary"
                  >
                    {metricLabel(column.metric, locale)}
                  </th>
                ))}
                {filterKey && (
                  <th scope="col" className="px-2 py-1.5">
                    <span className="sr-only">{t('reports.aiMetrics.breakdown.actions')}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const name = groupLabel(t, by, row);
                return (
                  <tr key={row.key ?? '∅'} className="border-b border-border last:border-0">
                    <th scope="row" className="px-2 py-1.5 text-left font-normal">
                      {name}
                      {row.quality.low_sample && (
                        <span className="ml-1.5 rounded bg-inset px-1.5 py-0.5 text-2xs text-content-secondary">
                          {t('reports.aiMetrics.fewSamples')}
                        </span>
                      )}
                    </th>
                    <td className="tabular px-2 py-1.5 text-right">
                      {formatCount(row.quality.conversations)}
                    </td>
                    {columns.map((column) => (
                      <td key={column.metric} className="tabular px-2 py-1.5 text-right">
                        {column.value(row.quality) ?? '—'}
                      </td>
                    ))}
                    {filterKey && (
                      <td className="px-2 py-1.5 text-right">
                        {row.key !== null && (
                          <button
                            type="button"
                            onClick={() =>
                              onFilter({ key: filterKey, value: row.key as string, label: name })
                            }
                            aria-label={t('reports.aiMetrics.breakdown.only', { group: name })}
                            className="text-2xs text-content-brand underline-offset-2 hover:underline"
                          >
                            {t('reports.aiMetrics.breakdown.onlyShort')}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ConversationList({
  range,
  rangeKey,
  filters,
  metric,
  onMetric,
}: {
  range: { from: string; to: string } | null;
  rangeKey: string;
  filters: ReturnType<typeof filtersOf>;
  metric: AiMetricsConversationList;
  onMetric: (metric: AiMetricsConversationList) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const selectId = useId();
  const pages = useInfiniteQuery({
    queryKey: aiMetricsKeys.conversations(rangeKey, metric, filters),
    enabled: range !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<AiMetricConversationsWire>(
        `/reports/ai-agent/conversations?${aiMetricsQuery(range as { from: string; to: string }, filters, { metric, cursor: pageParam })}`,
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const rows = pages.data?.pages.flatMap((page) => page.conversations) ?? [];

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <label htmlFor={selectId} className="text-xs text-content-secondary">
          {t('reports.aiMetrics.list.metric')}
        </label>
        <select
          id={selectId}
          value={metric}
          onChange={(event) => onMetric(event.target.value as AiMetricsConversationList)}
          className="rounded-md border border-border bg-inset px-2 py-1.5 text-xs text-content"
        >
          {AI_METRICS_CONVERSATION_LISTS.map((list) => (
            <option key={list} value={list}>
              {t(`reports.aiMetrics.list.${list}`)}
            </option>
          ))}
        </select>
      </div>
      {pages.error ? (
        <ErrorNotice message={t('reports.aiMetrics.list.error')} />
      ) : pages.isPending ? (
        <CardSkeleton rows={2} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('reports.aiMetrics.list.emptyTitle')}
          description={t('reports.aiMetrics.list.emptyDescription')}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t(`reports.aiMetrics.list.${metric}`)}</caption>
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="px-2 py-1.5 text-xs font-medium text-content-secondary">
                  {t('reports.aiMetrics.list.ended')}
                </th>
                <th scope="col" className="px-2 py-1.5 text-xs font-medium text-content-secondary">
                  {t('ids.chat.label')}
                </th>
                <th scope="col" className="px-2 py-1.5 text-xs font-medium text-content-secondary">
                  {t('ids.thread.label')}
                </th>
                <th scope="col" className="px-2 py-1.5 text-xs font-medium text-content-secondary">
                  {t('reports.aiMetrics.list.outcome')}
                </th>
                <th scope="col" className="px-2 py-1.5 text-xs font-medium text-content-secondary">
                  {t('reports.aiMetrics.list.topic')}
                </th>
                <th scope="col" className="px-2 py-1.5 text-xs font-medium text-content-secondary">
                  {t('reports.aiMetrics.list.reason')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-1.5 text-xs text-content-secondary">
                    {formatDateTime(row.ended_at)}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs">{row.thread_id}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{row.chat_id}</td>
                  <td className="px-2 py-1.5">
                    {row.outcome ? enumLabel(t, 'reports.aiMetrics.outcome', row.outcome) : '—'}
                  </td>
                  <td className="px-2 py-1.5">{row.intent ?? '—'}</td>
                  <td className="px-2 py-1.5">
                    {row.handoff_reason
                      ? enumLabel(t, 'playbook.handoff.reason', row.handoff_reason)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages.hasNextPage && (
        <button
          type="button"
          disabled={pages.isFetchingNextPage}
          onClick={() => void pages.fetchNextPage()}
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-content-secondary hover:bg-surface-2 disabled:opacity-50"
        >
          {pages.isFetchingNextPage
            ? t('reports.aiMetrics.list.loadingMore')
            : t('reports.aiMetrics.list.loadMore')}
        </button>
      )}
    </Card>
  );
}
