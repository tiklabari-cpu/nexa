/**
 * Goals — tracked conversion targets (FR-MOD-13.3).
 *
 * The Customers area's fourth face, beside Contacts, Real-time and Campaigns:
 * define what counts as a conversion ("the visitor reached /thank-you"), see
 * which goals are tracking, and read the visitor → chat → conversion funnel
 * they feed ({@link GoalsFunnel}, 13.3-h) above the list — the definitions and
 * the result they produce belong on the same screen.
 *
 * Creating and toggling are `customers:rw`; an agent with only `customers:ro`
 * sees the list but not the controls that change it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Page } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { StatusDot } from '../../components/StatusDot.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatDate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { CustomersTabs } from '../customers/CustomersTabs.js';
import { GoalBuilder } from './GoalBuilder.js';
import { GoalsFunnel } from './GoalsFunnel.js';
import { GOAL_TABS, filterGoals, goalCounts } from './goals.js';
import type { Goal, GoalFilter } from '@nexa/types';

/** `GOAL_TABS[].label` is English-only (see goals.ts). */
const TAB_LABEL_KEY: Record<GoalFilter, string> = {
  all: 'goals.tab.all',
  active: 'goals.tab.active',
  inactive: 'goals.tab.inactive',
};

export function GoalsPage(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const scopes = useAuth((s) => s.agent?.scopes) ?? [];
  const canWrite = scopes.includes('customers:rw');

  const [filter, setFilter] = useState<GoalFilter>('all');
  const [creating, setCreating] = useState(false);

  const query = useQuery({
    queryKey: ['goals'],
    queryFn: () => api.get<{ items: Goal[]; total: number }>('/goals'),
  });
  const goals = query.data?.items ?? [];
  const counts = goalCounts(goals);
  const visible = filterGoals(goals, filter);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['goals'] });
    // The funnel is driven by `by_goal`, so defining the workspace's first goal
    // is what takes it out of its empty state — leave it stale and the screen
    // shows "No conversions yet" beside the goal that was just created.
    void queryClient.invalidateQueries({ queryKey: ['reports', 'goals-funnel'] });
  };

  const toggle = useMutation({
    mutationFn: (input: { id: string; active: boolean }) =>
      api.patch<Goal>(`/goals/${input.id}`, { active: input.active }),
    onSuccess: invalidate,
  });

  return (
    <Page
      title={t('customers.page.title')}
      description={t('goals.page.description')}
      actions={<CustomersTabs />}
    >
      <GoalsFunnel />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <nav aria-label={t('goals.page.statusAriaLabel')} className="flex flex-wrap gap-1">
          {GOAL_TABS.map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(tab.id)}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? 'bg-brand-100 font-medium text-brand-700 dark:bg-brand-950 dark:text-content'
                    : 'text-content-secondary hover:bg-surface-2'
                }`}
              >
                {t(TAB_LABEL_KEY[tab.id])}
                <span className="ml-1.5 text-2xs text-content-tertiary">{counts[tab.id]}</span>
              </button>
            );
          })}
        </nav>

        {canWrite && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white"
          >
            {t('goals.page.new')}
          </button>
        )}
      </div>

      {query.error ? (
        <ErrorNotice message={t('goals.page.loadError')} />
      ) : query.isPending ? (
        <Card>
          <ListSkeleton />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            title={
              filter === 'all'
                ? t('goals.page.empty.allTitle')
                : t('goals.page.empty.filteredTitle', { status: t(TAB_LABEL_KEY[filter]) })
            }
            description={t(
              canWrite ? 'goals.page.empty.writeDescription' : 'goals.page.empty.readDescription',
            )}
            action={
              canWrite && filter === 'all' ? (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white"
                >
                  {t('goals.page.new')}
                </button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-3">
          {visible.map((goal) => (
            <li key={goal.id}>
              <GoalCard
                goal={goal}
                canWrite={canWrite}
                busy={toggle.isPending}
                onToggle={() => toggle.mutate({ id: goal.id, active: !goal.active })}
              />
            </li>
          ))}
        </ul>
      )}

      {creating && canWrite && (
        <GoalBuilder
          api={api}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            invalidate();
          }}
        />
      )}
    </Page>
  );
}

function GoalCard({
  goal,
  canWrite,
  busy,
  onToggle,
}: {
  goal: Goal;
  canWrite: boolean;
  busy: boolean;
  onToggle: () => void;
}): ReactElement {
  const t = useTranslate();
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-xs">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium">{goal.name}</h3>
            <StatusDot
              tone={goal.active ? 'success' : 'neutral'}
              label={goal.active ? t('goals.page.active') : t('goals.page.inactive')}
            />
          </div>
          <p className="mt-1 truncate text-xs text-content-secondary">
            {t('goals.page.whenUrlContains')}{' '}
            <code className="rounded-sm bg-inset px-1 py-0.5 text-2xs">
              {goal.definition.url_contains ?? '—'}
            </code>
          </p>
          <p className="mt-0.5 text-2xs text-content-tertiary">
            {t('goals.page.created', { date: formatDate(goal.created_at) ?? '' })}
          </p>
        </div>

        {canWrite && (
          <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            aria-pressed={goal.active}
            className={`shrink-0 rounded-md border px-2 py-1 text-2xs font-medium transition-colors disabled:opacity-40 ${
              goal.active
                ? 'border-border text-content-secondary hover:bg-surface-2'
                : 'border-brand-500 text-content-brand hover:bg-brand-50 dark:hover:bg-brand-950'
            }`}
          >
            {goal.active ? t('goals.page.turnOff') : t('goals.page.turnOn')}
          </button>
        )}
      </div>
    </div>
  );
}
