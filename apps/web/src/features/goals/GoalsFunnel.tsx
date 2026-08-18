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
import { useTranslate } from '../../lib/i18n.js';
import { funnelStages } from './goals.js';
import type { GoalFunnel } from '@nexa/types';

interface GoalsReport {
  range: { from: string; to: string };
  funnel: GoalFunnel;
  by_goal: Array<{ goal_id: string; name: string; conversions: number }>;
}

/**
 * `funnelStages()['label']` (`goals.ts`) is English-only, kept as a stable id
 * a unit test pins down — this maps it to a translation key, and separately
 * to the fixed `data-testid` the e2e suite reads (13.3-i), so translating the
 * visible label can never rename the id an automated test looks for.
 */
const STAGE_KEY: Record<string, { labelKey: string; testId: string }> = {
  Visitors: { labelKey: 'goals.funnel.visitors', testId: 'visitors' },
  Chats: { labelKey: 'goals.funnel.chats', testId: 'chats' },
  Conversions: { labelKey: 'goals.funnel.conversions', testId: 'conversions' },
};

export function GoalsFunnel(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const query = useQuery({
    queryKey: ['reports', 'goals-funnel'],
    queryFn: () => api.get<GoalsReport>('/reports/goals'),
  });

  return (
    <Section title={t('goals.funnel.title')} description={t('goals.funnel.description')}>
      {query.error ? (
        <ErrorNotice message={t('goals.funnel.loadError')} />
      ) : query.isPending ? (
        <Card>
          <ListSkeleton rows={1} />
        </Card>
      ) : query.data.by_goal.length === 0 ? (
        <Card>
          <EmptyState
            title={t('goals.funnel.emptyTitle')}
            description={t('goals.funnel.emptyDescription')}
          />
        </Card>
      ) : (
        <Card>
          <dl className="grid grid-cols-3 gap-2 p-4">
            {funnelStages(query.data.funnel).map((stage, i) => (
              <Stat
                key={stage.label}
                label={t(STAGE_KEY[stage.label]!.labelKey)}
                testId={STAGE_KEY[stage.label]!.testId}
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

function Stat({
  label,
  testId,
  value,
  hint,
}: {
  label: string;
  testId: string;
  value: string;
  hint?: string;
}): ReactElement {
  return (
    <div>
      <dt className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        {label}
      </dt>
      <dd className="tabular text-lg font-semibold">
        {/* The count is its own element so a browser-level test can read it apart
            from the rate sharing the cell: `dd`'s text content runs the two
            together ("1" + "12.5%" = "112.5%") and no selector can split that
            back. jsdom is not affected — RTL matches on direct text nodes — so
            this exists for the e2e (13.3-i), which is where it is read. */}
        <span data-testid={`goal-funnel-${testId}`}>{value}</span>
        {hint && <span className="ml-1 text-2xs font-normal text-content-tertiary">{hint}</span>}
      </dd>
    </div>
  );
}
