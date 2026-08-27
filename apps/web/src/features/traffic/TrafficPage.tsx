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
 * larger, separate slice (FR-EK-C.1); until then a short interval keeps it
 * live enough to act on, and every row action invalidates it immediately.
 *
 * Paginated and live at once, the same shape 153.2 gave the inbox chat list —
 * a simpler one, since there is no RTM push to reconcile against a loaded
 * page here, just the poll. `usePagedQuery` chains pages as the table scrolls
 * (NFR-P5: the board no longer ends at one fixed `limit=100` request); the
 * periodic refresh re-reads only the first page and folds it into the cache
 * via `mergeTrafficHead`, rather than `refetchInterval`, which would re-ask
 * for every page already loaded on each tick.
 */
import { hasAnyScope } from '@nexa/types';
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, ErrorNotice, Page } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { VirtualTable } from '../../components/VirtualList.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatCount } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { usePagedQuery, type PagedResponse } from '../../lib/paged-query.js';
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
/** Rows per request. The board chains pages from here, so it is a page, not a cap. */
const TRAFFIC_PAGE_SIZE = 100;
/** How often the first page is re-read to keep the board feeling live. */
const TRAFFIC_REFRESH_MS = 8_000;

function trafficKey(tab: TrafficTab, conditions: readonly TrafficCondition[]): unknown[] {
  return ['traffic', tab, conditions];
}

function trafficUrl(
  tab: TrafficTab,
  conditions: readonly TrafficCondition[],
  pageId: string | undefined,
): string {
  // The selected tab fills 13.2-f's `activity` filter — the server is the one
  // and only place that decides who is on the board, so a tab switch is a new
  // request rather than a client-side re-slice of the last one. The filter
  // panel's own conditions AND with it: its own `activity` condition (if any)
  // takes over from the tab (see `resolveActivity`), and every other field it
  // sets joins as one more `AND`ed parameter.
  const params = new URLSearchParams({ limit: String(TRAFFIC_PAGE_SIZE) });
  const activities = resolveActivity(tabToActivity(tab), conditions);
  for (const activity of activities ?? []) params.append('activity', activity);
  const filterParams = buildTrafficParams(conditions.filter((c) => c.field !== 'activity'));
  for (const [key, value] of filterParams) params.append(key, value);
  if (pageId) params.set('page_id', pageId);
  return `/traffic?${params.toString()}`;
}

/** What `usePagedQuery` keeps in the cache for the board. */
type TrafficCache = InfiniteData<PagedResponse<TrafficVisitor>, string | undefined>;

/**
 * The server's final sort, as one predicate: `last_activity_at` descending,
 * `customer_id` descending as the tie-break (`TrafficService#listLive`'s
 * `rows.sort`, and the two facts its keyset cursor is built from).
 */
function isOlderVisitor(a: TrafficVisitor, b: TrafficVisitor): boolean {
  const at = a.last_activity_at ?? '';
  const bt = b.last_activity_at ?? '';
  return at === bt ? a.customer_id < b.customer_id : at < bt;
}

/**
 * Folds a freshly read first page into a paged board without disturbing the
 * pages below it — `mergeChatHead`'s trick (`useInbox.ts`), applied to a
 * board whose own sort key can move a row *up* as well as down. A visitor's
 * `last_activity_at` changes with new activity, so a row already scrolled
 * past can, unlike a chat's immutable `created_at`, become the newest thing
 * on the board without this merge ever seeing it — accepted here for the
 * poll's sake (see the file header), the same trade-off 153.3 left for a
 * multi-page transcript reload.
 *
 * A fresh page that comes back empty is the one case where the pages below
 * are discarded: read from the top, "no rows" is a statement about the whole
 * board.
 */
export function mergeTrafficHead(
  cache: TrafficCache | undefined,
  fresh: PagedResponse<TrafficVisitor>,
): TrafficCache | undefined {
  if (!cache || cache.pages.length === 0) return cache;

  const head = cache.pages[0]!;
  const rest = cache.pages.slice(1);

  const oldest = fresh.items.at(-1);
  if (!oldest) {
    return { pages: [fresh], pageParams: cache.pageParams.slice(0, 1) };
  }

  const returned = new Set(fresh.items.map((v) => v.customer_id));
  const displaced = head.items.filter(
    (v) => !returned.has(v.customer_id) && isOlderVisitor(v, oldest),
  );

  const nextPageId = rest.length > 0 ? head.next_page_id : fresh.next_page_id;
  const merged: PagedResponse<TrafficVisitor> = {
    items: [...fresh.items, ...displaced],
    ...(fresh.total !== undefined ? { total: fresh.total } : {}),
    ...(nextPageId !== undefined ? { next_page_id: nextPageId } : {}),
  };

  return { ...cache, pages: [merged, ...rest] };
}

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

  const buildUrl = useCallback(
    (pageId: string | undefined) => trafficUrl(tab, conditions, pageId),
    [tab, conditions],
  );
  const list = usePagedQuery<TrafficVisitor>({ queryKey: trafficKey(tab, conditions), buildUrl });

  // The poll's target moves with the currently loaded chain, but the refresh
  // itself never touches it directly — see `refreshHead` below.
  const fetchingNextRef = useRef(false);
  fetchingNextRef.current = list.isFetchingNext;

  // Re-reads only the board's first page on a fixed interval and folds it in
  // via `mergeTrafficHead`, rather than `usePagedQuery`'s own `refetchInterval`
  // — an infinite query refetches every page currently loaded on each tick,
  // which turns a deep scroll into a request per loaded page every 8s. One
  // read stays live enough to act on (arrivals and state changes surface
  // within a poll) at a flat cost regardless of how far the agent has scrolled.
  const refreshHead = useCallback(async (): Promise<void> => {
    if (fetchingNextRef.current) return;
    const key = trafficKey(tab, conditions);
    // Nothing loaded yet: the query's own first fetch is the refresh.
    if (!queryClient.getQueryData(key)) return;
    try {
      const fresh = await api.get<PagedResponse<TrafficVisitor>>(
        trafficUrl(tab, conditions, undefined),
      );
      queryClient.setQueryData<TrafficCache>(key, (cache) => mergeTrafficHead(cache, fresh));
    } catch {
      // Best-effort, like the interval it replaces: a dropped refresh leaves
      // the board one beat stale until the next tick.
    }
  }, [api, queryClient, tab, conditions]);

  useEffect(() => {
    const timer = setInterval(() => void refreshHead(), TRAFFIC_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshHead]);

  // De-duplicated on the way out, the same as `useChatList`'s: a visitor who
  // leaves the board lets the freshly re-read first page reach one row
  // further down than it used to, which can briefly put that row on two
  // pages at once (`mergeTrafficHead`'s own boundary is per-page, not
  // board-wide).
  const items = useMemo(() => {
    const seen = new Set<string>();
    return list.items.filter((visitor) =>
      seen.has(visitor.customer_id) ? false : (seen.add(visitor.customer_id), true),
    );
  }, [list.items]);
  // Trustworthy only for the tabs the currently loaded rows actually cover:
  // the active tab itself (every loaded row is exactly what came back for
  // it) and, when that response is the unfiltered board, every tab at once.
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
        list.pages.length > 0
          ? t('traffic.page.count', {
              count: items.length,
              formatted: formatCount(items.length) ?? '0',
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

      {list.isError ? (
        <ErrorNotice message={t('traffic.page.loadError')} />
      ) : (
        <Card>
          {list.isPending ? (
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
              onEndReached={list.fetchNext}
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
