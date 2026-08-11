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
import { AiPerformance } from '../playbook/AiPerformance.js';
import type { AiAgent } from '../playbook/types.js';

export function TeamAiPerformance(): ReactElement {
  const api = useApiClient();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canViewReports = scopes.includes('reports_read');

  const agents = useQuery({
    queryKey: ['team', 'ai-agents'],
    queryFn: () => api.get<{ items: AiAgent[] }>('/ai-agents'),
  });

  // Only the customer-facing agents. Copilot rides on a row of its own to anchor
  // its assist runs (FR-MOD-12) but it is not something you "open" here — its
  // knowledge is managed through the Copilot section below, not the Playbook.
  const items = (agents.data?.items ?? []).filter((agent) => agent.kind === 'ai_agent');
  const anyActive = items.some((agent) => agent.active);

  return (
    <Section
      title="AI agent performance"
      description="How the AI is handling conversations, and the agents on this workspace. Open one to manage its skills, knowledge and profile."
    >
      <div className="flex flex-col gap-3">
        {/* Combined performance — the same cards, honesties and permission gate as
            the Playbook's Performance tab, reused rather than reimplemented. */}
        <AiPerformance agentActive={anyActive} canRead={canViewReports} />

        <Card>
          {agents.error ? (
            <ErrorNotice message="Could not load the AI agents. Check that the API is reachable." />
          ) : agents.isPending ? (
            <ListSkeleton rows={2} />
          ) : items.length === 0 ? (
            <EmptyState
              title="No AI agents yet"
              description="Create an AI agent in the Playbook to answer common questions automatically."
            />
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">AI agents on this licence</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <Th>Name</Th>
                  <Th>Availability</Th>
                  <Th align="right">Skills</Th>
                  <Th align="right">Manage</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((agent) => (
                  <tr key={agent.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-medium">{agent.name}</td>
                    <td className="px-4 py-2.5">
                      <StatusDot
                        tone={agent.active ? 'success' : 'neutral'}
                        label={agent.active ? 'On' : 'Off'}
                      />
                    </td>
                    <td className="tabular px-4 py-2.5 text-right text-content-secondary">
                      {formatCount(agent.skills_count)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link to="/app/playbook" className="text-xs text-content-brand underline">
                        Open performance
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
