/**
 * Real-time traffic — the live-visitor board (FR-MOD-03.1.3).
 *
 * The headline is the **Chatting with** column: for anyone mid-conversation it
 * names the human agent or the AI persona answering them, which is what lets a
 * supervisor decide at a glance whether to step in. Each row offers proactive
 * contact — Start chat / Supervise / Assign to me / Edit — gated by the visitor's
 * state and the caller's scopes (see `visitorRowActions`).
 *
 * The board polls rather than holding a socket. A true RTM traffic feed is a
 * larger, separate slice (FR-EK-C.1); until then a short refetch interval keeps
 * it live enough to act on, and every row action invalidates it immediately.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, ErrorNotice, Page } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { VirtualTable } from '../../components/VirtualList.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatCount } from '../../lib/format.js';
import { CustomersTabs } from '../customers/CustomersTabs.js';
import { visitorRowActions, type RowActionId } from './rowActions.js';
import { TrafficFilters } from './TrafficFilters.js';
import {
  buildTrafficParams,
  conditionsFromSearchParams,
  resolveActivity,
  TRAFFIC_FIELD_DEFS,
  type TrafficCondition,
} from './traffic-filters.js';
import { countByTab, isTrafficTab, tabToActivity, TRAFFIC_TABS, type TrafficTab } from './traffic-tabs.js';
import type { TrafficActivity, TrafficVisitor } from './types.js';

const TAB_PARAM = 'tab';

const EMPTY_STATE: Record<TrafficTab, { title: string; description: string }> = {
  all: {
    title: 'No live visitors right now',
    description:
      'People browsing your site or in a live conversation appear here. Install the widget to start seeing traffic.',
  },
  chatting: {
    title: 'No one is chatting right now',
    description: 'Visitors currently answered by an agent or the AI appear here.',
  },
  supervised: {
    title: 'No supervised conversations',
    description: 'Conversations an agent is watching without answering yet appear here.',
  },
  queued: {
    title: 'The queue is empty',
    description: 'Visitors waiting for an agent to pick up their conversation appear here.',
  },
  waiting: {
    title: 'Nobody is waiting for a reply',
    description: "Conversations where the visitor's last message has not been answered yet appear here.",
  },
  invited: {
    title: 'No pending invitations',
    description: 'Visitors proactively invited to chat who have not replied yet appear here.',
  },
  browsing: {
    title: 'No one is just browsing',
    description: 'Visitors on your site with no conversation yet appear here.',
  },
};

export const ACTIVITY: Record<TrafficActivity, { tone: StatusTone; label: string }> = {
  browsing: { tone: 'info', label: 'Browsing' },
  queued: { tone: 'warning', label: 'Queued' },
  waiting: { tone: 'warning', label: 'Waiting for reply' },
  chatting: { tone: 'success', label: 'Chatting' },
  supervised: { tone: 'info', label: 'Supervised' },
  invited: { tone: 'warning', label: 'Invited' },
};

function hasAny(scopes: string[], ...wanted: string[]): boolean {
  return wanted.some((scope) => scopes.includes(scope));
}

export function TrafficPage(): ReactElement {
  const api = useApiClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const agent = useAuth((s) => s.agent);
  const scopes = agent?.scopes ?? [];

  const ctx = {
    canChatWrite: hasAny(scopes, 'chats--all:rw', 'chats--access:rw'),
    canChatRead: hasAny(scopes, 'chats--all:ro', 'chats--access:ro'),
    canEditCustomer: scopes.includes('customers:rw'),
  };

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get(TAB_PARAM);
  const tab: TrafficTab = isTrafficTab(tabParam) ? tabParam : 'all';

  // The filter panel (13.2-h) is uncontrolled once mounted (see
  // `TrafficFilters`); this only seeds it from a reload/shared link and holds
  // the last list it reported — always a fully valid one, see `onChange`.
  const [conditions, setConditions] = useState<TrafficCondition[]>(() =>
    conditionsFromSearchParams(searchParams),
  );

  function selectTab(next: TrafficTab): void {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete(TAB_PARAM);
    else params.set(TAB_PARAM, next);
    setSearchParams(params, { replace: true });
  }

  function handleFiltersChange(next: TrafficCondition[]): void {
    setConditions(next);
    const params = new URLSearchParams(searchParams);
    for (const def of TRAFFIC_FIELD_DEFS) params.delete(def.field);
    for (const condition of next) params.set(condition.field, condition.value);
    setSearchParams(params, { replace: true });
  }

  const live = useQuery({
    queryKey: ['traffic', tab, conditions],
    queryFn: () => {
      // The selected tab fills 13.2-f's `activity` filter — the server is the
      // one and only place that decides who is on the board, so a tab switch
      // is a new request rather than a client-side re-slice of the last one.
      // The filter panel's own conditions AND with it: its own `activity`
      // condition (if any) takes over from the tab (see `resolveActivity`),
      // and every other field it sets joins as one more `AND`ed parameter.
      const params = new URLSearchParams({ limit: '100' });
      const activities = resolveActivity(tabToActivity(tab), conditions);
      for (const activity of activities ?? []) params.append('activity', activity);
      const filterParams = buildTrafficParams(conditions.filter((c) => c.field !== 'activity'));
      for (const [key, value] of filterParams) params.append(key, value);
      return api.get<{ items: TrafficVisitor[]; total: number }>(`/traffic?${params.toString()}`);
    },
    // Poll: the board must feel live without an RTM socket of its own yet.
    refetchInterval: 8_000,
  });

  const items = useMemo(() => live.data?.items ?? [], [live.data]);
  // Trustworthy only for the tabs the current response actually covers: the
  // active tab itself (it is exactly what came back) and, when that response
  // is the unfiltered board, every tab at once.
  const counts = useMemo(() => countByTab(items), [items]);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['traffic'] });
  };

  // Proactive start: open a conversation assigned to me, then jump into it.
  const startChat = useMutation({
    mutationFn: (customerId: string) =>
      api.post<{ id: string }>('/chats', { customer_id: customerId, assign_to_me: true }),
    onSuccess: (chat) => {
      invalidate();
      navigate(`/app/inbox?chat=${chat.id}`);
    },
  });

  // Take an existing conversation over by transferring it to myself.
  const assignToMe = useMutation({
    mutationFn: (chatId: string) =>
      api.post(`/chats/${chatId}/transfer`, { agent_id: agent?.account_id }),
    onSuccess: (_result, chatId) => {
      invalidate();
      navigate(`/app/inbox?chat=${chatId}`);
    },
  });

  // Registers the caller as a watcher (13.2-d) so the board can show
  // `supervised` for this chat; opening the transcript is what actually lets
  // them watch, so it navigates regardless of how the registration lands.
  const registerSupervision = useMutation({
    mutationFn: (chatId: string) => api.post(`/chats/${chatId}/supervise`),
    onSuccess: invalidate,
  });

  const busy = startChat.isPending || assignToMe.isPending || registerSupervision.isPending;

  const run = (id: RowActionId, visitor: TrafficVisitor): void => {
    switch (id) {
      case 'start_chat':
        startChat.mutate(visitor.customer_id);
        break;
      case 'assign_to_me':
        if (visitor.chat_id) assignToMe.mutate(visitor.chat_id);
        break;
      case 'supervise':
        if (visitor.chat_id) {
          registerSupervision.mutate(visitor.chat_id);
          navigate(`/app/inbox?chat=${visitor.chat_id}`);
        }
        break;
      case 'edit':
        navigate(`/app/customers?customer=${visitor.customer_id}`);
        break;
    }
  };

  return (
    <Page
      title="Customers"
      description={
        live.data
          ? `${formatCount(live.data.total)} ${live.data.total === 1 ? 'visitor' : 'visitors'} on your site now`
          : 'People on your site right now.'
      }
      actions={<CustomersTabs />}
    >
      <div role="tablist" aria-label="Traffic status" className="flex flex-wrap gap-1 border-b border-border pb-2">
        {TRAFFIC_TABS.map((t) => {
          const active = t.id === tab;
          // Only ever shown for a bucket the current response actually
          // covers — the active tab, or every tab while viewing the
          // unfiltered board — so a badge never states a count the client
          // does not truly know.
          const count = active || tab === 'all' ? counts[t.id] : undefined;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(t.id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                active
                  ? 'bg-brand-100 font-medium text-brand-700 dark:bg-brand-950 dark:text-content'
                  : 'text-content-secondary hover:bg-surface-2'
              }`}
            >
              <span>{t.label}</span>
              {count !== undefined && <span className="text-2xs text-content-tertiary">{count}</span>}
            </button>
          );
        })}
      </div>

      <TrafficFilters initialConditions={conditions} onChange={handleFiltersChange} />

      {live.error ? (
        <ErrorNotice message="Could not load live traffic. Check that the API is reachable and try again." />
      ) : (
        <Card>
          {live.isPending ? (
            <ListSkeleton />
          ) : items.length === 0 ? (
            <EmptyState title={EMPTY_STATE[tab].title} description={EMPTY_STATE[tab].description} />
          ) : (
            <VirtualTable
              items={items}
              rowHeight={60}
              caption="Live visitors"
              colSpan={4}
              head={
                <thead>
                  <tr className="border-b border-border text-left">
                    <Th>Visitor</Th>
                    <Th>Activity</Th>
                    <Th>Chatting with</Th>
                    <Th align="right">Actions</Th>
                  </tr>
                </thead>
              }
              renderRow={(visitor) => (
                <tr key={visitor.customer_id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="block font-medium">
                      {visitor.name ?? (
                        <span className="italic text-content-tertiary">Unnamed visitor</span>
                      )}
                    </span>
                    <span className="block truncate text-2xs text-content-tertiary">
                      {visitor.email ?? 'No contact details'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusDot
                      tone={ACTIVITY[visitor.activity].tone}
                      label={ACTIVITY[visitor.activity].label}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <ChattingWith visitor={visitor} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      {visitorRowActions(visitor, ctx).map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          disabled={!action.enabled || busy}
                          onClick={() => run(action.id, visitor)}
                          className="rounded-md border border-border px-2 py-1 text-2xs font-medium text-content-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
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

/** The "Chatting with" cell — a name plus a human/AI tag, or a dash. */
function ChattingWith({ visitor }: { visitor: TrafficVisitor }): ReactElement {
  const respondent = visitor.chatting_with;
  if (!respondent) return <span className="text-content-tertiary">—</span>;

  const isAi = respondent.kind === 'ai';
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-medium">{respondent.name}</span>
      <span
        className={`rounded-sm px-1.5 py-0.5 text-2xs font-medium ${
          isAi
            ? 'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-content'
            : 'bg-inset text-content-secondary'
        }`}
      >
        {isAi ? 'AI' : 'Agent'}
      </span>
    </span>
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
