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
import { Card, ErrorNotice, Kpi, KpiGrid } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatCount, formatRate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { performanceKpis, type AiAgentReport, type SatisfactionSummary } from './performance.js';

interface OverviewResponse {
  satisfaction: SatisfactionSummary;
}

/** `performanceKpis` (performance.ts) still returns its own English `label` —
 * left untouched (data-shaped, feeds an untranslated module) — this maps the
 * stable `key` each card carries to what is actually shown. */
const KPI_LABEL_KEYS: Record<string, string> = {
  resolution_rate: 'playbook.performance.kpiResolutionRate',
  ai_resolutions: 'playbook.performance.kpiAiResolutions',
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
    </div>
  );
}
