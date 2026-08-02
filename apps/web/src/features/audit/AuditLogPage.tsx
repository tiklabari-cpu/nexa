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
 * Filters, "load more" and CSV export are 08.9.7-j/Enterprise — this screen is
 * the first page of the last 30 days, newest first, exactly as the API returns
 * it.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
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

const ACTOR_LABEL: Record<AuditLogEntry['actor_type'], string> = {
  agent: 'Agent',
  bot: 'Bot',
  customer: 'Customer',
  system: 'System',
};

export function AuditLogPage(): ReactElement {
  const api = useApiClient();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canView = scopes.includes('audit_log--all:ro');

  const query = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => api.get<{ items: AuditLogEntry[] }>('/audit-log'),
    enabled: canView,
  });

  const items = query.data?.items ?? [];

  return (
    <Page
      title="Audit log"
      description="Sign-ins, role changes, deletions and webhook changes — the last 30 days."
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
          )}
        </Card>
      )}
    </Page>
  );
}

function Th({ children }: { children: string }): ReactElement {
  return (
    <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
      {children}
    </th>
  );
}
