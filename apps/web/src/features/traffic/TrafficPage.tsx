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
import { hasAnyScope } from '@nexa/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, ErrorNotice, Page } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { VirtualTable } from '../../components/VirtualList.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatCount } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
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
import {
  countByTab,
  isTrafficTab,
  tabToActivity,
  TRAFFIC_TABS,
  type TrafficTab,
} from './traffic-tabs.js';
import type { TrafficActivity, TrafficVisitor } from './types.js';

const TAB_PARAM = 'tab';

/** `TRAFFIC_TABS[].label` and `ACTIVITY[].label` are English-only (see those files). */
const TAB_LABEL_KEY: Record<TrafficTab, string> = {
  all: 'traffic.tab.all',
  chatting: 'traffic.tab.chatting',
  supervised: 'traffic.tab.supervised',
  queued: 'traffic.tab.queued',
  waiting: 'traffic.tab.waiting',
  invited: 'traffic.tab.invited',
  browsing: 'traffic.tab.browsing',
};

const EMPTY_STATE_KEY: Record<TrafficTab, { title: string; description: string }> = {
  all: { title: 'traffic.empty.all.title', description: 'traffic.empty.all.description' },
  chatting: {
    title: 'traffic.empty.chatting.title',
    description: 'traffic.empty.chatting.description',
  },
  supervised: {
    title: 'traffic.empty.supervised.title',
    description: 'traffic.empty.supervised.description',
  },
  queued: { title: 'traffic.empty.queued.title', description: 'traffic.empty.queued.description' },
  waiting: {
    title: 'traffic.empty.waiting.title',
    description: 'traffic.empty.waiting.description',
  },
  invited: {
    title: 'traffic.empty.invited.title',
    description: 'traffic.empty.invited.description',
  },
  browsing: {
    title: 'traffic.empty.browsing.title',
    description: 'traffic.empty.browsing.description',
  },
};

export const ACTIVITY: Record<TrafficActivity, { tone: StatusTone; label: string }> = {
  browsing: { tone: 'info', label: 'traffic.activity.browsing' },
  queued: { tone: 'warning', label: 'traffic.activity.queued' },
  waiting: { tone: 'warning', label: 'traffic.activity.waiting' },
  chatting: { tone: 'success', label: 'traffic.activity.chatting' },
  supervised: { tone: 'info', label: 'traffic.activity.supervised' },
  invited: { tone: 'warning', label: 'traffic.activity.invited' },
};

const ROW_ACTION_LABEL_KEY: Record<RowActionId, string> = {
  start_chat: 'traffic.action.startChat',
  supervise: 'traffic.action.superviseChat',
  assign_to_me: 'traffic.action.assignToMe',
  edit: 'traffic.action.editContact',
};

/**
 * Scope check via `@nexa/types`, not `Array.includes` (13.2-k).
 *
 * A raw `includes` misses every implication the server applies: `chats--all:rw`
 * expands to `chats--all:ro` there, so a plain membership test asked whether the
 * caller holds a *literal* read scope. Owners and admins hold none — their set
 * is `chats--all:rw` — which left **Supervise chat** disabled for precisely the
 * people who supervise, on a call the API would have accepted. One shared
 * expander is what keeps the button's answer and the route's answer the same.
 */
function hasAny(scopes: string[], ...wanted: string[]): boolean {
  return hasAnyScope(scopes, wanted);
}

export function TrafficPage(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const agent = useAuth((s) => s.agent);
  const scopes = agent?.scopes ?? [];

  const ctx = {
    canChatWrite: hasAny(scopes, 'chats--all:rw', 'chats--access:rw'),
    canChatRead: hasAny(scopes, 'chats--all:ro', 'chats--access:ro'),
    canEditCustomer: hasAny(scopes, 'customers:rw'),
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

  // Arrow-key navigation over the strip (WAI-ARIA tabs pattern, NFR-A11Y4/5).
  // Tab/Shift+Tab alone would walk all seven buttons one by one and make the
  // strip a keyboard trap in the middle of the page, so the strip is a single
  // stop (roving `tabIndex`) and the arrows move within it. Activation follows
  // focus, which is the right mode here: selecting a tab only re-runs the board
  // query, so nothing is lost by landing on one in passing.
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const last = TRAFFIC_TABS.length - 1;
    const current = TRAFFIC_TABS.findIndex((t) => t.id === tab);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = current === last ? 0 : current + 1;
        break;
      case 'ArrowLeft':
        next = current === 0 ? last : current - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    // Only now: an unhandled key (Tab out of the strip, typing a shortcut) must
    // keep its default behaviour.
    event.preventDefault();
    selectTab(TRAFFIC_TABS[next]!.id);
    tabRefs.current[next]?.focus();
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
      title={t('customers.page.title')}
      description={
        live.data
          ? t('traffic.page.count', {
              count: live.data.total,
              formatted: formatCount(live.data.total) ?? '0',
            })
          : t('traffic.page.subtitle')
      }
      actions={<CustomersTabs />}
    >
      <div
        role="tablist"
        aria-label={t('traffic.page.statusTablistAriaLabel')}
        onKeyDown={onTabKeyDown}
        className="flex flex-wrap gap-1 border-b border-border pb-2"
      >
        {TRAFFIC_TABS.map((tabDef, index) => {
          const active = tabDef.id === tab;
          // Only ever shown for a bucket the current response actually
          // covers — the active tab, or every tab while viewing the
          // unfiltered board — so a badge never states a count the client
          // does not truly know.
          const count = active || tab === 'all' ? counts[tabDef.id] : undefined;
          return (
            <button
              key={tabDef.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => selectTab(tabDef.id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                active
                  ? 'bg-brand-100 font-medium text-brand-700 dark:bg-brand-950 dark:text-content'
                  : 'text-content-secondary hover:bg-surface-2'
              }`}
            >
              <span>{t(TAB_LABEL_KEY[tabDef.id])}</span>
              {count !== undefined && (
                <span className="text-2xs text-content-tertiary">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <TrafficFilters initialConditions={conditions} onChange={handleFiltersChange} />

      {live.error ? (
        <ErrorNotice message={t('traffic.page.loadError')} />
      ) : (
        <Card>
          {live.isPending ? (
            <ListSkeleton />
          ) : items.length === 0 ? (
            <EmptyState
              title={t(EMPTY_STATE_KEY[tab].title)}
              description={t(EMPTY_STATE_KEY[tab].description)}
            />
          ) : (
            <VirtualTable
              items={items}
              rowHeight={60}
              caption={t('traffic.page.table.caption')}
              colSpan={4}
              head={
                <thead>
                  <tr className="border-b border-border text-left">
                    <Th>{t('traffic.page.table.visitor')}</Th>
                    <Th>{t('traffic.page.table.activity')}</Th>
                    <Th>{t('traffic.page.table.chattingWith')}</Th>
                    <Th align="right">{t('traffic.page.table.actions')}</Th>
                  </tr>
                </thead>
              }
              renderRow={(visitor) => (
                <tr key={visitor.customer_id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="block font-medium">
                      {visitor.name ?? (
                        <span className="italic text-content-tertiary">
                          {t('traffic.page.unnamedVisitor')}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-2xs text-content-tertiary">
                      {visitor.email ?? t('traffic.page.noContactDetails')}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusDot
                      tone={ACTIVITY[visitor.activity].tone}
                      label={t(ACTIVITY[visitor.activity].label)}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <ChattingWith visitor={visitor} t={t} />
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
                          {t(ROW_ACTION_LABEL_KEY[action.id])}
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
function ChattingWith({ visitor, t }: { visitor: TrafficVisitor; t: TFunction }): ReactElement {
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
        {isAi ? t('traffic.page.respondentAi') : t('traffic.page.respondentAgent')}
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
