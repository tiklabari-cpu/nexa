/**
 * Team-side AI agents (FR-MOD-04.2).
 *
 * The Team page manages every "worker" on the licence — human and AI alike — so
 * the AI agents belong here, next to the teammates. This surface answers the two
 * questions a manager asks from the people screen: how is the AI doing, and
 * which agents are on. The figures are the same ones the Playbook's Performance
 * tab shows (FR-MOD-06.5) and the invoice bills (ADR-09) — one definition,
 * reused, never a second counter to drift from the bill. Each row opens the
 * Playbook, where an agent's skills, knowledge and profile are managed per agent.
 *
 * The KPI cards above are licence-wide (every chat, whoever handled it) — they
 * cannot answer "which teammates lean on AI the most". `teamPerformanceByAgent`
 * (`report-csv.ts`) already answers exactly that, split per human agent by
 * `GET /reports/team-performance`; Reports' own Team performance tab already
 * renders it (`ReportsPage.tsx#TeamPerformanceTable`), so this section reuses
 * that table rather than standing up a second query or a second markup for the
 * same numbers.
 */
import { useQuery } from '@tanstack/react-query';
import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { StatusDot } from '../../components/StatusDot.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatCount } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { AiPerformance } from '../playbook/AiPerformance.js';
import type { AiAgent } from '../playbook/types.js';
import { TeamPerformanceTable, type AgentPerformanceRow } from '../reports/ReportsPage.js';

interface TeamPerformanceResponse {
  agents: AgentPerformanceRow[];
}

export function TeamAiPerformance(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canViewReports = scopes.includes('reports_read');

  const agents = useQuery({
    queryKey: ['team', 'ai-agents'],
    queryFn: () => api.get<{ items: AiAgent[] }>('/ai-agents'),
  });

  const teamPerformance = useQuery({
    queryKey: ['team', 'ai-performance-by-agent'],
    queryFn: () => api.get<TeamPerformanceResponse>('/reports/team-performance'),
    enabled: canViewReports,
  });

  // Only the customer-facing agents. Copilot rides on a row of its own to anchor
  // its assist runs (FR-MOD-12) but it is not something you "open" here — its
  // knowledge is managed through the Copilot section below, not the Playbook.
  const items = (agents.data?.items ?? []).filter((agent) => agent.kind === 'ai_agent');
  const anyActive = items.some((agent) => agent.active);

  return (
    <Section title={t('team.ai.title')} description={t('team.ai.description')}>
      <div className="flex flex-col gap-3">
        {/* Combined performance — the same cards, honesties and permission gate as
            the Playbook's Performance tab, reused rather than reimplemented. */}
        <AiPerformance agentActive={anyActive} canRead={canViewReports} />

        {/* Per-agent split (this task): the KPI cards above are licence-wide and
            cannot show which teammates lean on AI most — reuses the Reports
            Team-performance table/query rather than a second definition. Hidden
            entirely (not a second "no access" card) when the caller cannot read
            reports; the endpoint enforces `reports_read` itself either way. */}
        {canViewReports && (
          <Card>
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-medium">{t('team.ai.byAgent.title')}</h3>
              <p className="text-xs text-content-secondary">{t('team.ai.byAgent.description')}</p>
            </div>
            {teamPerformance.error ? (
              <ErrorNotice message={t('reports.teamPerformance.error')} />
            ) : teamPerformance.isPending ? (
              <ListSkeleton rows={2} />
            ) : teamPerformance.data.agents.length === 0 ? (
              <EmptyState
                title={t('reports.teamPerformance.emptyTitle')}
                description={t('reports.teamPerformance.emptyDescription')}
              />
            ) : (
              <TeamPerformanceTable rows={teamPerformance.data.agents} />
            )}
          </Card>
        )}

        <Card>
          {agents.error ? (
            <ErrorNotice message={t('team.ai.loadError')} />
          ) : agents.isPending ? (
            <ListSkeleton rows={2} />
          ) : items.length === 0 ? (
            <EmptyState
              title={t('team.ai.empty.title')}
              description={t('team.ai.empty.description')}
            />
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">{t('team.ai.table.caption')}</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <Th>{t('team.page.table.name')}</Th>
                  <Th>{t('team.page.table.availability')}</Th>
                  <Th align="right">{t('team.page.table.skills')}</Th>
                  <Th align="right">{t('team.page.table.manage')}</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((agent) => (
                  <tr key={agent.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-medium">{agent.name}</td>
                    <td className="px-4 py-2.5">
                      <StatusDot
                        tone={agent.active ? 'success' : 'neutral'}
                        label={agent.active ? t('team.status.on') : t('team.status.off')}
                      />
                    </td>
                    <td className="tabular px-4 py-2.5 text-right text-content-secondary">
                      {formatCount(agent.skills_count)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link to="/app/playbook" className="text-xs text-content-brand underline">
                        {t('team.ai.openPerformance')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </Section>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children: string;
  align?: 'left' | 'right';
}): ReactElement {
  return (
    <th
      scope="col"
      className={`px-4 py-2 text-xs font-medium text-content-secondary ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}
