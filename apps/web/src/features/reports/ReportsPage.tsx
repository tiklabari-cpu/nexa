/**
 * Reports overview.
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
import { formatCount, formatDuration, formatRate } from '../../lib/format.js';

interface ReportsOverview {
  range: { from: string; to: string };
  totals: {
    chats: number;
    closed: number;
    automated: number;
    automated_rate: number | null;
    queued_now: number;
  };
  response_times: {
    avg_first_response_seconds: number | null;
    avg_duration_seconds: number | null;
  };
  satisfaction: { good: number; bad: number; score: number | null; responses: number };
  by_agent: Array<{ agent_id: string; name: string | null; chats: number }>;
  top_tags: Array<{ name: string; count: number }>;
}

const RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
] as const;

export function ReportsPage(): ReactElement {
  const [days, setDays] = useState<number>(30);
  const api = useApiClient();

  const { data, isPending, error } = useQuery({
    queryKey: ['reports', 'overview', days],
    queryFn: () => {
      const to = new Date();
      const from = new Date(to.getTime() - days * 86_400_000);
      return api.get<ReportsOverview>(
        `/reports/overview?from=${from.toISOString()}&to=${to.toISOString()}`,
      );
    },
  });

  return (
    <Page
      title="Reports"
      description="Conversation volume, responsiveness and satisfaction."
      actions={
        <label className="flex items-center gap-2 text-xs text-content-secondary">
          <span>Range</span>
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content"
          >
            {RANGES.map((range) => (
              <option key={range.days} value={range.days}>
                {range.label}
              </option>
            ))}
          </select>
        </label>
      }
    >
      {error ? (
        <ErrorNotice message="Could not load reports. Check that the API is reachable and try again." />
      ) : isPending ? (
        <>
          <CardSkeleton rows={2} />
          <CardSkeleton rows={4} />
        </>
      ) : (
        <>
          <Section
            title="Volume"
            description="Automated is the share of closed conversations an AI resolved without a human."
          >
            <KpiGrid>
              <Kpi label="Conversations" value={formatCount(data.totals.chats)} />
              <Kpi label="Closed" value={formatCount(data.totals.closed)} />
              <Kpi
                label="Automated"
                value={formatCount(data.totals.automated)}
                hint={
                  data.totals.automated_rate === null
                    ? 'Nothing closed in this window'
                    : `${formatRate(data.totals.automated_rate)} of closed`
                }
                tone="good"
              />
              <Kpi
                label="In queue now"
                value={formatCount(data.totals.queued_now)}
                tone={data.totals.queued_now > 0 ? 'warn' : 'neutral'}
                hint={data.totals.queued_now > 0 ? 'Waiting for an agent' : 'Nobody waiting'}
              />
            </KpiGrid>
          </Section>

          <Section title="Responsiveness">
            <KpiGrid>
              <Kpi
                label="First response"
                value={formatDuration(data.response_times.avg_first_response_seconds)}
                hint="Average time to the first agent reply"
              />
              <Kpi
                label="Conversation length"
                value={formatDuration(data.response_times.avg_duration_seconds)}
                hint="Average from open to close"
              />
              <Kpi
                label="Satisfaction"
                value={formatRate(data.satisfaction.score)}
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
                      <th
                        scope="col"
                        className="px-4 py-2 text-xs font-medium text-content-secondary"
                      >
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
      )}
    </Page>
  );
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
