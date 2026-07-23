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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Page } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatCount, formatDate } from '../../lib/format.js';
import { CustomerDetailPanel } from './CustomerDetailPanel.js';
import type { CustomerSummary, Segment } from './types.js';

const SEGMENTS: Array<{ id: Segment; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'leads', label: 'Leads' },
  { id: 'recent', label: 'Last 30 days' },
  { id: 'banned', label: 'Banned' },
];

export function CustomersPage(): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);

  const [segment, setSegment] = useState<Segment>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Debounced so typing a name does not fire a request per keystroke, each one
  // counting against the caller's rate limit.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const list = useQuery({
    queryKey: ['customers', segment, debounced],
    queryFn: () => {
      const params = new URLSearchParams({ segment, limit: '50' });
      if (debounced) params.set('query', debounced);
      return api.get<{ items: CustomerSummary[]; total: number; next_page_id?: string }>(
        `/customers?${params.toString()}`,
      );
    },
  });

  const items = useMemo(() => list.data?.items ?? [], [list.data]);

  // Keep the selection valid as filters change under it.
  useEffect(() => {
    if (selectedId && !items.some((c) => c.id === selectedId)) setSelectedId(null);
  }, [items, selectedId]);

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
      title="Customers"
      description={
        list.data
          ? `${formatCount(list.data.total)} ${list.data.total === 1 ? 'person' : 'people'}`
          : 'People who have contacted this workspace.'
      }
      actions={
        <label className="flex items-center gap-2">
          <span className="sr-only">Search customers</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, email or phone…"
            className="w-64 rounded-md border border-border bg-inset px-3 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
          />
        </label>
      }
    >
      <div
        role="tablist"
        aria-label="Customer segments"
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
            {item.label}
          </button>
        ))}
      </div>

      {list.error ? (
        <ErrorNotice message="Could not load customers. Check that the API is reachable and try again." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
          <Card>
            {list.isPending ? (
              <TableSkeleton />
            ) : items.length === 0 ? (
              <EmptyState
                title={debounced ? 'Nobody matches that search' : 'No customers yet'}
                description={
                  debounced
                    ? 'Try a shorter search, or a different segment.'
                    : 'People who message from the widget appear here automatically.'
                }
              />
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">Customers</caption>
                <thead>
                  <tr className="border-b border-border text-left">
                    <Th>Name</Th>
                    <Th>Country</Th>
                    <Th align="right">Chats</Th>
                    <Th>Last active</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((customer) => (
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
                              <span className="italic text-content-tertiary">Unnamed visitor</span>
                            )}
                            {customer.is_lead && (
                              <span className="rounded-sm bg-inset px-1.5 py-0.5 text-2xs font-normal text-content-secondary">
                                lead
                              </span>
                            )}
                            {customer.banned && <StatusDot tone="danger" label="Banned" />}
                          </span>
                          <span className="block truncate text-2xs text-content-tertiary">
                            {customer.email ?? customer.phone ?? 'No contact details'}
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-content-secondary">
                        {customer.country ?? customer.country_code ?? '—'}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right">{customer.chats_count}</td>
                      <td className="px-4 py-2.5 text-content-secondary">
                        {formatDate(customer.last_activity_at) ?? 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

function TableSkeleton(): ReactElement {
  return (
    <ul aria-hidden="true" className="animate-pulse">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="border-b border-border px-4 py-3 last:border-0">
          <div className="mb-2 h-3 w-1/3 rounded-sm bg-inset" />
          <div className="h-2.5 w-1/2 rounded-sm bg-inset" />
        </li>
      ))}
    </ul>
  );
}
