/**
 * Customers — the CRM screen.
 *
 * Two panes rather than a table plus a modal: an agent looking someone up is
 * usually comparing them against the list they came from, and a modal takes
 * that away every time they open a record.
 *
 * Counts shown here are computed by the API from actual conversations. The
 * stored `chats_count` column has never been maintained and would read 0 for
 * everyone — see the note in the customer service.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, ErrorNotice, Page } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { VirtualTable } from '../../components/VirtualList.js';
import { StatusDot } from '../../components/StatusDot.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatCount, formatDate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { usePagedQuery } from '../../lib/paged-query.js';
import { CustomerDetailPanel } from './CustomerDetailPanel.js';
import { CustomersFilters } from './CustomersFilters.js';
import {
  buildCustomerParams,
  conditionsFromSearchParams,
  CUSTOMER_FIELD_DEFS,
  type CustomerCondition,
} from './customers-filters.js';
import { CustomersTabs } from './CustomersTabs.js';
import type { CustomerSummary, Segment } from './types.js';

const SEGMENTS: Array<{ id: Segment; labelKey: string }> = [
  { id: 'all', labelKey: 'customers.page.segment.all' },
  { id: 'leads', labelKey: 'customers.page.segment.leads' },
  { id: 'recent', labelKey: 'customers.page.segment.recent' },
  { id: 'banned', labelKey: 'customers.page.segment.banned' },
];

/** Rows per request. The table chains pages from here, so it is a page, not a cap. */
const CUSTOMERS_PAGE_SIZE = 50;

function customersUrl(
  segment: Segment,
  query: string,
  conditions: readonly CustomerCondition[],
  pageId: string | undefined,
): string {
  const params = new URLSearchParams({ segment, limit: String(CUSTOMERS_PAGE_SIZE) });
  if (query) params.set('query', query);
  for (const [key, value] of buildCustomerParams(conditions)) params.append(key, value);
  if (pageId) params.set('page_id', pageId);
  return `/customers?${params.toString()}`;
}

export function CustomersPage(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);

  const [searchParams, setSearchParams] = useSearchParams();

  const [segment, setSegment] = useState<Segment>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The filter panel (FR-MOD-03.2.1) is uncontrolled once mounted (see
  // `ConditionFilters`); this only seeds it from a reload/shared link and
  // holds the last list it reported — always a fully valid one, see
  // `handleFiltersChange`. Mirrors `TrafficPage`'s own `conditions` state.
  const [conditions, setConditions] = useState<CustomerCondition[]>(() =>
    conditionsFromSearchParams(searchParams),
  );

  // Two deep links land here: `?customer=` (command palette, a bookmark, a
  // colleague) names one person — switch to the segment that contains
  // everyone so the row is present, then select it. `?segment=` (the rail's
  // Leads pill, FR-MOD-01.1.2) names a tab to land on directly. Either way the
  // parameter is stripped once read, so a later segment change or reload does
  // not re-apply it.
  useEffect(() => {
    const linkedCustomer = searchParams.get('customer');
    const linkedSegment = searchParams.get('segment');
    if (!linkedCustomer && !linkedSegment) return;

    if (linkedCustomer) {
      setSegment('all');
      setSelectedId(linkedCustomer);
    } else if (SEGMENTS.some((item) => item.id === linkedSegment)) {
      setSegment(linkedSegment as Segment);
    }

    const next = new URLSearchParams(searchParams);
    next.delete('customer');
    next.delete('segment');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Debounced so typing a name does not fire a request per keystroke, each one
  // counting against the caller's rate limit.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  function handleFiltersChange(next: CustomerCondition[]): void {
    setConditions(next);
    const params = new URLSearchParams(searchParams);
    for (const def of CUSTOMER_FIELD_DEFS) params.delete(def.field);
    for (const condition of next) params.set(condition.field, condition.value);
    setSearchParams(params, { replace: true });
  }

  const list = usePagedQuery<CustomerSummary>({
    queryKey: ['customers', segment, debounced, conditions],
    buildUrl: (pageId) => customersUrl(segment, debounced, conditions, pageId),
  });

  const items = list.items;
  // "The first page has landed" — not `!list.isPending`, which is also false
  // once the list has *failed*; a load error must not read as an empty list.
  const pagesLoaded = list.pages.length > 0;

  // Keep the selection valid as filters change under it — but only once the
  // list has actually loaded, so a deep-linked selection is not cleared against
  // the empty array that precedes the first response. Gated on `!list.hasNext`
  // too: a customer that is real but sits on a page nobody has scrolled to yet
  // would otherwise look "gone" while more pages are still coming — the exact
  // case a `?customer=` deep link onto someone's second page hits.
  useEffect(() => {
    if (pagesLoaded && selectedId && !list.hasNext && !items.some((c) => c.id === selectedId)) {
      setSelectedId(null);
    }
  }, [items, selectedId, pagesLoaded, list.hasNext]);

  const canEdit = scopes.includes('customers:rw');
  const canBan = scopes.includes('customers.ban:rw');

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['customers'] });
  };

  const banMutation = useMutation({
    mutationFn: ({ id, banned }: { id: string; banned: boolean }) =>
      banned ? api.post(`/customers/${id}/ban`) : api.delete(`/customers/${id}/ban`),
    onSuccess: invalidate,
  });

  return (
    <Page
      title={t('customers.page.title')}
      description={
        list.total !== undefined
          ? t('customers.page.count', {
              count: list.total,
              formatted: formatCount(list.total) ?? '0',
            })
          : t('customers.page.subtitle')
      }
      actions={
        <div className="flex items-center gap-3">
          <CustomersTabs />
          <label className="flex items-center gap-2">
            <span className="sr-only">{t('customers.page.searchLabel')}</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('customers.page.searchPlaceholder')}
              className="w-64 rounded-md border border-border bg-inset px-3 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
            />
          </label>
        </div>
      }
    >
      <div
        role="tablist"
        aria-label={t('customers.page.segmentsAriaLabel')}
        className="flex gap-1 border-b border-border pb-2"
      >
        {SEGMENTS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={segment === item.id}
            onClick={() => setSegment(item.id)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              segment === item.id
                ? 'bg-brand-100 font-medium text-brand-700 dark:bg-brand-950 dark:text-content'
                : 'text-content-secondary hover:bg-surface-2'
            }`}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      <CustomersFilters initialConditions={conditions} onChange={handleFiltersChange} />

      {list.error ? (
        <ErrorNotice message={t('customers.page.loadError')} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
          <Card>
            {!list.isPending && items.length > 0 && (
              <div className="flex items-center justify-between border-b border-border px-4 py-2 text-2xs text-content-tertiary">
                <span>
                  {t('customers.page.shown', {
                    shown: formatCount(items.length) ?? String(items.length),
                    total: formatCount(list.total ?? items.length) ?? String(items.length),
                  })}
                </span>
              </div>
            )}
            {list.isPending ? (
              <ListSkeleton />
            ) : items.length === 0 ? (
              <EmptyState
                title={t(
                  debounced || conditions.length > 0
                    ? 'customers.page.empty.searchTitle'
                    : 'customers.page.empty.title',
                )}
                description={t(
                  debounced || conditions.length > 0
                    ? 'customers.page.empty.searchDescription'
                    : 'customers.page.empty.description',
                )}
              />
            ) : (
              <VirtualTable
                items={items}
                rowHeight={56}
                caption={t('customers.page.table.caption')}
                colSpan={4}
                onEndReached={list.fetchNext}
                head={
                  <thead>
                    <tr className="border-b border-border text-left">
                      <Th>{t('customers.page.table.name')}</Th>
                      <Th>{t('customers.page.table.country')}</Th>
                      <Th align="right">{t('customers.page.table.chats')}</Th>
                      <Th>{t('customers.page.table.lastActive')}</Th>
                    </tr>
                  </thead>
                }
                renderRow={(customer) => (
                  <tr
                    key={customer.id}
                    aria-selected={selectedId === customer.id}
                    className={`cursor-pointer border-b border-border last:border-0 transition-colors ${
                      selectedId === customer.id
                        ? 'bg-brand-100 dark:bg-brand-950'
                        : 'hover:bg-surface-2'
                    }`}
                    onClick={() => setSelectedId(customer.id)}
                  >
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        // The row is clickable for the mouse; this keeps it
                        // reachable by keyboard without an interactive <tr>.
                        onClick={() => setSelectedId(customer.id)}
                        className="text-left"
                      >
                        <span className="flex items-center gap-2 font-medium">
                          {customer.name ?? (
                            <span className="italic text-content-tertiary">
                              {t('customers.page.unnamedVisitor')}
                            </span>
                          )}
                          {customer.is_lead && (
                            <span className="rounded-sm bg-inset px-1.5 py-0.5 text-2xs font-normal text-content-secondary">
                              {t('customers.page.lead')}
                            </span>
                          )}
                          {customer.banned && (
                            <StatusDot tone="danger" label={t('customers.page.banned')} />
                          )}
                        </span>
                        <span className="block truncate text-2xs text-content-tertiary">
                          {customer.email ?? customer.phone ?? t('customers.page.noContactDetails')}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-content-secondary">
                      {customer.country ?? customer.country_code ?? '—'}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right">{customer.chats_count}</td>
                    <td className="px-4 py-2.5 text-content-secondary">
                      {formatDate(customer.last_activity_at) ?? t('customers.page.never')}
                    </td>
                  </tr>
                )}
              />
            )}
          </Card>

          <CustomerDetailPanel
            customerId={selectedId}
            canEdit={canEdit}
            canBan={canBan}
            onChanged={invalidate}
            onBanToggle={(id, banned) => banMutation.mutate({ id, banned })}
            banPending={banMutation.isPending}
          />
        </div>
      )}
    </Page>
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
