/**
 * AI performance (FR-MOD-06.5).
 *
 * The cards read from the same reports the invoice trusts (ADR-09), so the
 * resolution figure here is the number billed — not a second counter that could
 * disagree with the bill. Two honesties are built in: a rate resting on too few
 * chats is flagged, not shown bare (a 100% over three chats invites a decision
 * the sample cannot support); and when the AI is off, the figures are labelled
 * as history, because nothing new is being handled.
 */
import { useQuery } from '@tanstack/react-query';
import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Card, ErrorNotice, Kpi, KpiGrid } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatCount, formatRate, formatUsdEstimate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { canViewAiUsage, useAiUsage, type AiUsage } from '../settings/ai-usage.js';
import { performanceKpis, type AiAgentReport, type SatisfactionSummary } from './performance.js';

interface OverviewResponse {
  satisfaction: SatisfactionSummary;
}

/** `performanceKpis` (performance.ts) still returns its own English `label` —
 * left untouched (data-shaped, feeds an untranslated module) — this maps the
 * stable `key` each card carries to what is actually shown. */
const KPI_LABEL_KEYS: Record<string, string> = {
  resolution_rate: 'playbook.performance.kpiResolutionRate',
  ai_chats: 'playbook.performance.kpiAiChats',
  csat: 'playbook.performance.kpiCsat',
  transfer_rate: 'playbook.performance.kpiTransferRate',
};

export function AiPerformance({
  agentActive,
  canRead,
}: {
  agentActive: boolean;
  canRead: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const report = useQuery({
    queryKey: ['playbook', 'ai-performance'],
    queryFn: () => api.get<AiAgentReport>('/reports/ai-agent'),
    enabled: canRead,
  });
  const overview = useQuery({
    queryKey: ['playbook', 'ai-overview-satisfaction'],
    queryFn: () => api.get<OverviewResponse>('/reports/overview'),
    enabled: canRead,
  });
  // Tokens and cost are an owner/admin number (`GET /ai/usage` answers an agent
  // 403), so an agent who may read reports still never asks.
  const role = useAuth((s) => s.agent?.role ?? null);
  const usage = useAiUsage(canRead && canViewAiUsage(role));

  if (!canRead) {
    return (
      <Card>
        <EmptyState
          title={t('playbook.performance.noAccessTitle')}
          description={t('playbook.performance.noAccessDescription')}
        />
      </Card>
    );
  }

  if (report.error || overview.error) {
    return <ErrorNotice message={t('playbook.performance.loadError')} />;
  }

  if (report.isPending || overview.isPending) {
    return (
      <Card>
        <p className="p-4 text-sm text-content-secondary">{t('playbook.performance.loading')}</p>
      </Card>
    );
  }

  const kpis = performanceKpis(report.data, overview.data.satisfaction);
  const anyLowBase = kpis.some((k) => k.kind === 'rate' && k.lowBase);

  return (
    <div className="flex flex-col gap-3">
      {!agentActive && (
        <p
          role="status"
          className="rounded-md border border-border bg-inset px-4 py-2 text-2xs text-content-secondary"
        >
          {t('playbook.performance.offNotice')}
        </p>
      )}

      <KpiGrid>
        {kpis.map((kpi) =>
          kpi.kind === 'rate' ? (
            <Kpi
              key={kpi.key}
              label={t(KPI_LABEL_KEYS[kpi.key] ?? kpi.key)}
              value={formatRate(kpi.rate)}
              tone={kpi.lowBase ? 'warn' : 'neutral'}
              hint={kpi.lowBase ? t('playbook.performance.lowBaseHint') : undefined}
            />
          ) : (
            <Kpi
              key={kpi.key}
              label={t(KPI_LABEL_KEYS[kpi.key] ?? kpi.key)}
              value={formatCount(kpi.count)}
            />
          ),
        )}
      </KpiGrid>

      {anyLowBase && (
        <p className="text-2xs text-content-tertiary">{t('playbook.performance.lowBaseFooter')}</p>
      )}

      {usage.data && <UsageCard usage={usage.data} />}
    </div>
  );
}

/**
 * Today's tokens against the allowance, and the estimated cost when the
 * operator priced them (tm 283.4). A failed or still-loading usage query shows
 * nothing rather than failing the tab: the resolution figures above do not
 * depend on it. No price → no money card, never a zero.
 */
function UsageCard({ usage }: { usage: AiUsage }): ReactElement {
  const t = useTranslate();
  const llm = usage.meters.find((m) => m.meter === 'llm');
  const embedding = usage.meters.find((m) => m.meter === 'embedding');
  const priced = usage.meters.filter(
    (m) => (m.meter === 'llm' || m.meter === 'embedding') && m.cost_usd !== undefined,
  );
  const cost = priced.reduce((sum, m) => sum + (m.cost_usd ?? 0), 0);
  const share = (percent: number): string =>
    t('playbook.performance.usageShare', { percent: formatRate(percent / 100) ?? '0%' });

  return (
    <div className="flex flex-col gap-2">
      <KpiGrid>
        {llm && (
          <Kpi
            label={t('playbook.performance.kpiLlmTokens')}
            value={formatCount(llm.used)}
            tone={llm.percent >= 80 ? 'warn' : 'neutral'}
            hint={share(llm.percent)}
          />
        )}
        {embedding && (
          <Kpi
            label={t('playbook.performance.kpiEmbeddingTokens')}
            value={formatCount(embedding.used)}
            tone={embedding.percent >= 80 ? 'warn' : 'neutral'}
            hint={share(embedding.percent)}
          />
        )}
        {priced.length > 0 && (
          <Kpi
            label={t('playbook.performance.kpiEstimatedCost')}
            value={formatUsdEstimate(cost)}
            hint={t('playbook.performance.costEstimateHint')}
          />
        )}
      </KpiGrid>
      <p className="text-2xs text-content-tertiary">
        {t('playbook.performance.usageFooter')}{' '}
        <Link to="/app/settings/ai-usage" className="underline">
          {t('playbook.performance.usageLink')}
        </Link>
      </p>
    </div>
  );
}
