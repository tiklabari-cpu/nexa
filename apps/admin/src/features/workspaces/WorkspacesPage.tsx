/**
 * The workspace list (tm 389.9 · FR-ADMIN-08): a filter bar — free text, status, plan, region,
 * trial end, order — over a keyset-paged table. "Load more" asks for the next cursor; changing
 * a filter starts again from the first page, because a cursor belongs to the list it came from.
 *
 * The text box is applied on submit, not per keystroke: each search is a query across every
 * workspace, and a half-typed address is not worth one.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { SUBSCRIPTION_STATUSES } from '@siyahtus/types';
import { Link } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { Card, Page } from '../../components/Page.js';
import { formatCount, formatDate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  EMPTY_FILTERS,
  useWorkspaceList,
  WORKSPACE_SORTS,
  type WorkspaceFilters,
} from './queries.js';
import { PurgeQueueCard } from './WorkspaceActions.js';
import {
  Cell,
  DataTable,
  EmptyLine,
  FIELD_CLASS,
  LINK_CLASS,
  Loading,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from './ui.js';

const PLANS = ['growth', 'enterprise'] as const;
const REGIONS = ['eu', 'us'] as const;

export function WorkspacesPage(): ReactElement {
  const t = useTranslate();
  const [filters, setFilters] = useState<WorkspaceFilters>(EMPTY_FILTERS);
  const [text, setText] = useState('');
  const query = useWorkspaceList(filters);
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];

  const set = <K extends keyof WorkspaceFilters>(key: K, value: WorkspaceFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  function search(event: FormEvent): void {
    event.preventDefault();
    set('q', text.trim());
  }

  return (
    <Page title={t('nav.workspaces')} description={t('shell.pages.workspaces.description')}>
      <PurgeQueueCard />
      <Card>
        <form
          role="search"
          aria-label={t('workspaces.filters.label')}
          onSubmit={search}
          className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="sm:col-span-2">
            <label htmlFor="workspaces-q" className="text-xs font-medium">
              {t('workspaces.filters.q')}
            </label>
            <div className="flex gap-2">
              <input
                id="workspaces-q"
                type="search"
                value={text}
                maxLength={200}
                onChange={(event) => setText(event.target.value)}
                className={FIELD_CLASS}
                aria-describedby="workspaces-q-hint"
              />
              <button type="submit" className={`mt-1 ${PRIMARY_BUTTON_CLASS}`}>
                {t('workspaces.filters.search')}
              </button>
            </div>
            <p id="workspaces-q-hint" className="mt-1 text-xs text-content-secondary">
              {t('workspaces.filters.qHint')}
            </p>
          </div>
          <Select
            id="workspaces-status"
            label={t('workspaces.filters.status')}
            value={filters.status}
            onChange={(value) => set('status', value)}
            options={SUBSCRIPTION_STATUSES.map((status) => ({
              value: status,
              label: t(`workspaces.status.${status}`),
            }))}
            anyLabel={t('workspaces.filters.any')}
          />
          <Select
            id="workspaces-plan"
            label={t('workspaces.filters.plan')}
            value={filters.plan}
            onChange={(value) => set('plan', value)}
            options={PLANS.map((plan) => ({ value: plan, label: t(`workspaces.plan.${plan}`) }))}
            anyLabel={t('workspaces.filters.any')}
          />
          <Select
            id="workspaces-region"
            label={t('workspaces.filters.region')}
            value={filters.region}
            onChange={(value) => set('region', value)}
            options={REGIONS.map((region) => ({ value: region, label: region.toUpperCase() }))}
            anyLabel={t('workspaces.filters.any')}
          />
          <div>
            <label htmlFor="workspaces-trial" className="text-xs font-medium">
              {t('workspaces.filters.trialEndsBefore')}
            </label>
            <input
              id="workspaces-trial"
              type="date"
              value={filters.trialEndsBefore}
              onChange={(event) => set('trialEndsBefore', event.target.value)}
              className={FIELD_CLASS}
            />
          </div>
          <Select
            id="workspaces-sort"
            label={t('workspaces.filters.sort')}
            value={filters.sort}
            onChange={(value) => set('sort', value as WorkspaceFilters['sort'])}
            options={WORKSPACE_SORTS.map((sort) => ({
              value: sort,
              label: t(`workspaces.sort.${sort}`),
            }))}
          />
        </form>
      </Card>

      <Card>
        {query.isError ? (
          <LoadError
            title={t('workspaces.list.loadError')}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        ) : query.isPending ? (
          <Loading label={t('workspaces.loading')} />
        ) : rows.length === 0 ? (
          <EmptyLine>{t('workspaces.list.empty')}</EmptyLine>
        ) : (
          <>
            <DataTable
              caption={t('workspaces.list.caption')}
              headers={[
                t('workspaces.list.organization'),
                t('workspaces.list.licence'),
                t('workspaces.list.status'),
                t('workspaces.list.plan'),
                t('workspaces.list.region'),
                t('workspaces.list.owner'),
                t('workspaces.list.members'),
                t('workspaces.list.trialEnds'),
                t('workspaces.list.created'),
              ]}
            >
              {rows.map((row) => (
                <tr key={row.license_id}>
                  <Cell>
                    <Link to={row.license_id} className={LINK_CLASS}>
                      {row.organization_name}
                    </Link>
                  </Cell>
                  <Cell>
                    <span className="tabular-nums">{row.license_id}</span>
                  </Cell>
                  <Cell>{t(`workspaces.status.${row.status}`)}</Cell>
                  <Cell>{t(`workspaces.plan.${row.plan}`)}</Cell>
                  <Cell>{row.region.toUpperCase()}</Cell>
                  <Cell>{row.owner_email}</Cell>
                  <Cell>{formatCount(row.member_count)}</Cell>
                  <Cell>{formatDate(row.trial_ends_at)}</Cell>
                  <Cell>{formatDate(row.created_at)}</Cell>
                </tr>
              ))}
            </DataTable>
            {query.hasNextPage && (
              <div className="border-t border-border p-3 text-center">
                <button
                  type="button"
                  className={SECONDARY_BUTTON_CLASS}
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {t('workspaces.list.more')}
                </button>
              </div>
            )}
          </>
        )}
      </Card>
    </Page>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  options,
  anyLabel,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  anyLabel?: string;
}): ReactElement {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={FIELD_CLASS}
      >
        {anyLabel !== undefined && <option value="">{anyLabel}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
