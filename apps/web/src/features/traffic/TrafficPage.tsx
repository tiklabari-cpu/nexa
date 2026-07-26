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
import { useMemo, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, ErrorNotice, Page } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { VirtualTable } from '../../components/VirtualList.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatCount } from '../../lib/format.js';
import { CustomersTabs } from '../customers/CustomersTabs.js';
import { visitorRowActions, type RowActionId } from './rowActions.js';
import type { TrafficActivity, TrafficVisitor } from './types.js';

const ACTIVITY: Record<TrafficActivity, { tone: StatusTone; label: string }> = {
  browsing: { tone: 'info', label: 'Browsing' },
  queued: { tone: 'warning', label: 'Queued' },
  waiting: { tone: 'warning', label: 'Waiting for reply' },
  chatting: { tone: 'success', label: 'Chatting' },
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

  const live = useQuery({
    queryKey: ['traffic'],
    queryFn: () => api.get<{ items: TrafficVisitor[]; total: number }>('/traffic?limit=100'),
    // Poll: the board must feel live without an RTM socket of its own yet.
    refetchInterval: 8_000,
  });

  const items = useMemo(() => live.data?.items ?? [], [live.data]);

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

  const busy = startChat.isPending || assignToMe.isPending;

  const run = (id: RowActionId, visitor: TrafficVisitor): void => {
    switch (id) {
      case 'start_chat':
        startChat.mutate(visitor.customer_id);
        break;
      case 'assign_to_me':
        if (visitor.chat_id) assignToMe.mutate(visitor.chat_id);
        break;
      case 'supervise':
        // Watching is just opening the conversation in the inbox.
        if (visitor.chat_id) navigate(`/app/inbox?chat=${visitor.chat_id}`);
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
      {live.error ? (
        <ErrorNotice message="Could not load live traffic. Check that the API is reachable and try again." />
      ) : (
        <Card>
          {live.isPending ? (
            <ListSkeleton />
          ) : items.length === 0 ? (
            <EmptyState
              title="No live visitors right now"
              description="People browsing your site or in a live conversation appear here. Install the widget to start seeing traffic."
            />
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
