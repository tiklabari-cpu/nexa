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
import { performanceKpis, type AiAgentReport, type SatisfactionSummary } from './performance.js';

interface OverviewResponse {
  satisfaction: SatisfactionSummary;
}

export function AiPerformance({
  agentActive,
  canRead,
}: {
  agentActive: boolean;
  canRead: boolean;
}): ReactElement {
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
          title="No access to performance"
          description="Viewing AI performance needs the reports permission. Ask an owner to grant it."
        />
      </Card>
    );
  }

  if (report.error || overview.error) {
    return (
      <ErrorNotice message="Could not load AI performance. Check that the API is reachable." />
    );
  }

  if (report.isPending || overview.isPending) {
    return (
      <Card>
        <p className="p-4 text-sm text-content-secondary">Loading…</p>
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
          The AI is off — these are historical figures. No new chats are being handled while it is
          paused.
        </p>
      )}

      <KpiGrid>
        {kpis.map((kpi) =>
          kpi.kind === 'rate' ? (
            <Kpi
              key={kpi.key}
              label={kpi.label}
              value={formatRate(kpi.rate)}
              tone={kpi.lowBase ? 'warn' : 'neutral'}
              hint={kpi.lowBase ? 'Based on few chats — treat as indicative.' : undefined}
            />
          ) : (
            <Kpi key={kpi.key} label={kpi.label} value={formatCount(kpi.count)} />
          ),
        )}
      </KpiGrid>

      {anyLowBase && (
        <p className="text-2xs text-content-tertiary">
          A percentage over a handful of chats swings on a single case. The warned cards will settle
          as more conversations close.
        </p>
      )}
    </div>
  );
}
