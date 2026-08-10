/**
 * The visitor → chat → conversion funnel behind the workspace's goals
 * (FR-MOD-13.3), drawn from `/reports/goals`. `by_goal` — one row per goal
 * the workspace has defined — decides the empty state, not the visitor
 * count: a window with zero visitors still has a funnel worth showing
 * (all-zero, conversion rate reads "—"); a workspace with no goals defined
 * yet has nothing to show a funnel about.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatCount, formatRate } from '../../lib/format.js';
import { funnelStages } from './goals.js';
import type { GoalFunnel } from '@nexa/types';

interface GoalsReport {
  range: { from: string; to: string };
  funnel: GoalFunnel;
  by_goal: Array<{ goal_id: string; name: string; conversions: number }>;
}

export function GoalsFunnel(): ReactElement {
  const api = useApiClient();
  const query = useQuery({
    queryKey: ['reports', 'goals-funnel'],
    queryFn: () => api.get<GoalsReport>('/reports/goals'),
  });

  return (
    <Section
      title="Goal funnel"
      description="Visitors who reached a chat, and of those, a tracked goal."
    >
      {query.error ? (
        <ErrorNotice message="Could not load the goal funnel. Check that the API is reachable and try again." />
      ) : query.isPending ? (
        <Card>
          <ListSkeleton rows={1} />
        </Card>
      ) : query.data.by_goal.length === 0 ? (
        <Card>
          <EmptyState
            title="No conversions yet"
            description="Define a goal to see visitors, chats and conversions here."
          />
        </Card>
      ) : (
        <Card>
          <dl className="grid grid-cols-3 gap-2 p-4">
            {funnelStages(query.data.funnel).map((stage, i) => (
              <Stat
                key={stage.label}
                label={stage.label}
                value={formatCount(stage.value) ?? '0'}
                hint={i === 2 ? (formatRate(stage.rate) ?? '—') : undefined}
              />
            ))}
          </dl>
        </Card>
      )}
    </Section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): ReactElement {
  return (
    <div>
      <dt className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">{label}</dt>
      <dd className="tabular text-lg font-semibold">
        {/* The count is its own element so a browser-level test can read it apart
            from the rate sharing the cell: `dd`'s text content runs the two
            together ("1" + "12.5%" = "112.5%") and no selector can split that
            back. jsdom is not affected — RTL matches on direct text nodes — so
            this exists for the e2e (13.3-i), which is where it is read. */}
        <span data-testid={`goal-funnel-${label.toLowerCase()}`}>{value}</span>
        {hint && <span className="ml-1 text-2xs font-normal text-content-tertiary">{hint}</span>}
      </dd>
    </div>
  );
}
