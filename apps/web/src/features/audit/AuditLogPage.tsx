/**
 * Audit log — the security trail's read-only screen (NFR-S12).
 *
 * The server already draws every real boundary: `audit_log--all:ro` +
 * `minimumRole: admin` gate the route (08.9.7-a), and RLS scopes every entry to
 * this workspace. The `audit_log--all:ro` check here is a courtesy, not the
 * security boundary — it saves a caller who cannot read the trail from firing a
 * request that would only come back 403, and keeps the Settings door (see
 * `SettingsPage.tsx`) from advertising a screen they cannot open.
 *
 * Filters (action, date range) and "load more" narrow the same base list the
 * API already supports (08.9.7-a/b) — this screen wires the controls to the
 * query string, additively, and keeps the selection in the URL so a filtered
 * view is a link an admin can share (FR-EK-B.1). Free-text search, CSV export
 * and a virtualized "load more" list stay out of scope (Enterprise / page size
 * too small to need it).
 */
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { ChangeEvent, ReactElement } from 'react';
import { Card, ErrorNotice, Page } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { VirtualTable } from '../../components/VirtualList.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';

interface AuditLogEntry {
  id: string;
  action: string;
  actor_id: string | null;
  actor_type: 'agent' | 'bot' | 'customer' | 'system';
  target: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  created_at: string;
}

interface AuditLogPageResponse {
  items: AuditLogEntry[];
  next_page_id?: string;
}

const ACTOR_LABEL: Record<AuditLogEntry['actor_type'], string> = {
  agent: 'Agent',
  bot: 'Bot',
  customer: 'Customer',
  system: 'System',
};

/**
 * Mirrors `AUDIT_ACTIONS` (apps/api/src/services/audit/audit-log.ts), grouped
 * into the same families its comments name — there is no shared package to
 * import the vocabulary from, so this list is kept in step by hand. An action
 * added server-side and forgotten here is still filterable via a hand-built
 * link; it is only missing from the dropdown.
 */
const ACTION_GROUPS: ReadonlyArray<{ label: string; actions: readonly string[] }> = [
  {
    label: 'Authentication',
    actions: ['auth.login', 'auth.login_failed', 'auth.password_reset', 'auth.ip_denied'],
  },
  {
    label: 'Team',
    actions: [
      'member.invited',
      'member.invitation_revoked',
      'member.suspended',
      'member.unsuspended',
      'member.role_changed',
    ],
  },
  {
    label: 'Settings',
    actions: [
      'settings.security_updated',
      'settings.routing_rule_updated',
      'settings.chat_timeout_updated',
      'settings.widget_updated',
      'settings.trusted_domain_added',
      'settings.trusted_domain_removed',
      'settings.ip_allowlist_added',
      'settings.ip_allowlist_removed',
    ],
  },
  { label: 'Billing', actions: ['billing.subscription_updated', 'billing.payment_method_updated'] },
  { label: 'Webhooks', actions: ['webhook.created', 'webhook.deleted'] },
  {
    label: 'Tickets',
    actions: [
      'ticket.status_changed',
      'ticket.priority_changed',
      'ticket.merged',
      'ticket.unmerged',
      'ticket.follower_added',
      'ticket.follower_removed',
    ],
  },
  {
    label: 'Credentials',
    actions: [
      'pat.created',
      'pat.revoked',
      'partner_app.created',
      'partner_app.updated',
      'partner_app.deleted',
      'partner_app.secret_rotated',
    ],
  },
  { label: 'Data', actions: ['data.retention_pruned', 'data.deleted'] },
];

const ACTION_PARAM = 'action';
const DATE_FROM_PARAM = 'date_from';
const DATE_TO_PARAM = 'date_to';

/** A date input's `YYYY-MM-DD` value to the start/end instant of that UTC day. */
function startOfDay(value: string): string {
  return `${value}T00:00:00.000Z`;
}
function endOfDay(value: string): string {
  return `${value}T23:59:59.999Z`;
}

/**
 * Builds the request path from the current filters plus an optional page
 * cursor. Omitting every param entirely (rather than sending them empty)
 * keeps the default request identical to the pre-filter screen's — the server
 * default (last 30 days) only ever comes from the caller sending nothing.
 */
function buildQuery(
  action: string,
  dateFrom: string,
  dateTo: string,
  pageId: string | undefined,
): string {
  const params = new URLSearchParams();
  if (action) params.set('action', action);
  if (dateFrom) params.set('date_from', startOfDay(dateFrom));
  if (dateTo) params.set('date_to', endOfDay(dateTo));
  if (pageId) params.set('page_id', pageId);
  const query = params.toString();
  return query ? `/audit-log?${query}` : '/audit-log';
}

export function AuditLogPage(): ReactElement {
  const api = useApiClient();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canView = scopes.includes('audit_log--all:ro');

  const [searchParams, setSearchParams] = useSearchParams();
  const action = searchParams.get(ACTION_PARAM) ?? '';
  const dateFrom = searchParams.get(DATE_FROM_PARAM) ?? '';
  const dateTo = searchParams.get(DATE_TO_PARAM) ?? '';

  // The URL is the single source of truth for filters (no mirrored local
  // state) — the same shape the Tickets grid's sort deep-link uses (02.7-a) —
  // so a shared link and a reload both land on the exact same query.
  function setFilter(param: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(param, value);
    else next.delete(param);
    setSearchParams(next, { replace: true });
  }

  const query = useInfiniteQuery({
    queryKey: ['audit-log', action, dateFrom, dateTo],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.get<AuditLogPageResponse>(buildQuery(action, dateFrom, dateTo, pageParam)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_page_id,
    enabled: canView,
  });

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Page
      title="Audit log"
      description="Sign-ins, role changes, deletions and webhook changes — the last 30 days by default."
      actions={
        canView ? (
          <AuditFilters
            action={action}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onAction={(value) => setFilter(ACTION_PARAM, value)}
            onDateFrom={(value) => setFilter(DATE_FROM_PARAM, value)}
            onDateTo={(value) => setFilter(DATE_TO_PARAM, value)}
          />
        ) : undefined
      }
    >
      {!canView ? (
        <EmptyState
          title="Audit log not available"
          description="Viewing the security trail is limited to owners and admins with read access to this workspace's audit log."
        />
      ) : query.isError ? (
        <ErrorNotice message="Could not load the audit log. Check that the API is reachable and try again." />
      ) : (
        <Card>
          {query.isPending ? (
            <ListSkeleton />
          ) : items.length === 0 ? (
            <EmptyState
              title="No activity yet"
              description="Sign-ins, role changes, deletions and webhook changes will appear here as they happen."
            />
          ) : (
            <>
              <VirtualTable
                items={items}
                rowHeight={52}
                caption="Audit log"
                colSpan={5}
                head={
                  <thead>
                    <tr className="border-b border-border text-left">
                      <Th>Time</Th>
                      <Th>Action</Th>
                      <Th>Actor</Th>
                      <Th>Target</Th>
                      <Th>IP</Th>
                    </tr>
                  </thead>
                }
                renderRow={(entry) => (
                  <tr key={entry.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-content-secondary">
                      {formatDateTime(entry.created_at) ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-2xs">{entry.action}</td>
                    <td className="px-4 py-2.5">
                      <span className="block">{ACTOR_LABEL[entry.actor_type]}</span>
                      {entry.actor_id && (
                        <span className="block truncate font-mono text-2xs text-content-tertiary">
                          {entry.actor_id}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-2xs text-content-secondary">
                      {entry.target ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-2xs text-content-secondary">
                      {entry.ip ?? '—'}
                    </td>
                  </tr>
                )}
              />
              {query.hasNextPage && (
                <div className="flex justify-center border-t border-border p-3">
                  <button
                    type="button"
                    onClick={() => {
                      void query.fetchNextPage();
                    }}
                    disabled={query.isFetchingNextPage}
                    className="rounded-md border border-border bg-inset px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:text-content disabled:opacity-60"
                  >
                    {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </Page>
  );
}

/** Action + date range controls, in the page header (the `ReportsPage` range-control shape). */
function AuditFilters({
  action,
  dateFrom,
  dateTo,
  onAction,
  onDateFrom,
  onDateTo,
}: {
  action: string;
  dateFrom: string;
  dateTo: string;
  onAction: (value: string) => void;
  onDateFrom: (value: string) => void;
  onDateTo: (value: string) => void;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-xs text-content-secondary">
        <span className="sr-only">Filter by action</span>
        <select
          value={action}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => onAction(event.target.value)}
          className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none"
        >
          <option value="">All actions</option>
          {ACTION_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.actions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-1 text-xs text-content-secondary">
        <label className="flex items-center gap-1">
          <span className="sr-only">From date</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onDateFrom(event.target.value)}
            className="rounded-md border border-border bg-inset px-2 py-1 text-content"
          />
        </label>
        <span aria-hidden="true">→</span>
        <label className="flex items-center gap-1">
          <span className="sr-only">To date</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onDateTo(event.target.value)}
            className="rounded-md border border-border bg-inset px-2 py-1 text-content"
          />
        </label>
      </div>
    </div>
  );
}

function Th({ children }: { children: string }): ReactElement {
  return (
    <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
      {children}
    </th>
  );
}
