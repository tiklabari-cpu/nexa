/**
 * The 3-pane inbox: views, conversation list, transcript, details.
 *
 * Layout follows design-brief §4 — a fixed icon rail and sidebar, a resizable
 * list, and a transcript that takes the remaining width. Every colour and size
 * comes from a token; no component hard-codes a hex value.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth-store.js';
import { useRealtimeStatus } from '../../lib/realtime-status.js';
import { useTranslate } from '../../lib/i18n.js';
import { StatusDot } from '../../components/StatusDot.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { Composer } from './Composer.js';
import { DetailsPanel } from './DetailsPanel.js';
import { CopilotPanel } from './CopilotPanel.js';
import { Transcript } from './Transcript.js';
import { TypingIndicator } from './TypingIndicator.js';
import { ConflictBanner } from './ConflictBanner.js';
import { TakeTourBanner } from './TakeTourBanner.js';
import {
  useChat,
  useChatList,
  useConnectedChannels,
  useMarkSeen,
  useTranscript,
  useViewCounts,
} from './useInbox.js';
import { useRightPanel } from './rightPanel.js';
import { usePanelTab } from './panelTab.js';
import {
  canReadChannels,
  connectedChannelViews,
  showChannelPromo,
  useSavedViews,
  SAVED_VIEW_NAME_MAX,
  type ConnectedChannelLike,
  type SavedView,
} from './views.js';
import { TicketDetailPane } from './TicketPane.js';
import { TicketGrid } from './TicketGrid.js';
import { useTicketList } from './useTickets.js';
import { CreateTicketButton } from './CreateTicketButton.js';
import { TRAFFIC_TABS, filterByTrafficTab, trafficTabCounts } from './traffic.js';
import {
  clearTicketSort,
  clearTicketView,
  hasTicketSortParams,
  hasTicketViewParam,
  parseTicketSort,
  parseTicketView,
  toggleTicketSort,
  writeTicketSort,
  writeTicketView,
  type TicketSortKey,
} from './ticket-grid.js';
import { parseChatSort, writeChatSort, type ChatSort } from './chat-sort.js';
import type { InboxView, TicketView, TrafficTab } from './types.js';

/**
 * The Chats group, in the PRD's own order (02.1.1): All · My chats · Queued ·
 * Unassigned · Supervised · Archive. `supervised` is the conversations this
 * agent is watching without owning — the Traffic board's Supervise action is
 * what puts one here.
 */
const VIEWS: Array<{ id: InboxView; icon: string }> = [
  { id: 'all', icon: '▤' },
  { id: 'my', icon: '◍' },
  { id: 'queued', icon: '◔' },
  { id: 'unassigned', icon: '◌' },
  { id: 'supervised', icon: '◉' },
  { id: 'archived', icon: '▣' },
];

/**
 * The AI Agents group (PRD 02.1.2): conversations the AI agent is handling, kept
 * out of the human queue, and the ones it resolved on its own. "Solved" is the
 * AI-resolution set ADR-09 bills for — the same conversations Reports counts as
 * "Automated".
 */
const AI_VIEWS: Array<{ id: InboxView; icon: string }> = [
  { id: 'ai', icon: '✦' },
  { id: 'ai_solved', icon: '✓' },
];

/** Display word per chat-list view — shared by `VIEWS` and `AI_VIEWS`, one `InboxView`. */
const VIEW_LABEL_KEY: Record<InboxView, string> = {
  all: 'inbox.rail.view.all',
  my: 'inbox.rail.view.my',
  queued: 'inbox.rail.view.queued',
  unassigned: 'inbox.rail.view.unassigned',
  supervised: 'inbox.rail.view.supervised',
  archived: 'inbox.rail.view.archived',
  ai: 'inbox.rail.view.ai',
  ai_solved: 'inbox.rail.view.aiSolved',
};

/**
 * The PRD keeps chats and tickets in one inbox under two groups, so the
 * selection is one value with two shapes rather than two independent states —
 * two states drift, and the pane ends up rendering a chat under a ticket
 * heading. The ticket view filter itself is not carried here — it is the
 * URL's job (`ticket-grid.ts`), same as the sort, so a filtered link is
 * shareable and the browser's back/forward buttons walk through it.
 */
type Selection = { kind: 'chat'; view: InboxView } | { kind: 'ticket' };

const TICKET_VIEWS: Array<{ id: TicketView; icon: string }> = [
  { id: 'all', icon: '▦' },
  { id: 'unassigned', icon: '◇' },
  { id: 'my_open', icon: '◈' },
  { id: 'solved', icon: '✓' },
];

const TICKET_VIEW_LABEL_KEY: Record<TicketView, string> = {
  all: 'inbox.rail.ticketView.all',
  unassigned: 'inbox.rail.ticketView.unassigned',
  my_open: 'inbox.rail.ticketView.myOpen',
  solved: 'inbox.rail.ticketView.solved',
};

const TRAFFIC_TAB_LABEL_KEY: Record<TrafficTab, string> = {
  all: 'inbox.list.traffic.all',
  chatting: 'inbox.list.traffic.chatting',
  queued: 'inbox.list.traffic.queued',
  waiting: 'inbox.list.traffic.waiting',
};

/**
 * How close to the bottom of the loaded rows counts as "the end" — roughly
 * three list rows, so the next page is already on its way by the time the
 * reader gets there.
 */
const END_OF_LIST_PX = 240;

export function InboxPage(): ReactElement {
  const t = useTranslate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selection, setSelection] = useState<Selection>({ kind: 'chat', view: 'all' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [trafficTab, setTrafficTab] = useState<TrafficTab>('all');

  // A deep link opens a specific chat or ticket (from the command palette or a
  // shared URL). The record's own detail query loads it regardless of which
  // list view is showing, so all this has to do is point the selection at it
  // under the "All" view and then consume the parameter.
  //
  // A "sorted/filtered grid" link (`?ticket_sort=…`, `?ticket_view=…`,
  // FR-MOD-02.7) is different: those params are the grid's state, not a
  // one-shot target, so they open the tickets grid but stay in the URL rather
  // than being stripped like `?chat`/`?ticket`.
  useEffect(() => {
    const chatId = searchParams.get('chat');
    const ticketId = searchParams.get('ticket');
    if (chatId || ticketId) {
      if (chatId) {
        setSelection({ kind: 'chat', view: 'all' });
        setSelectedId(chatId);
      } else if (ticketId) {
        setSelection({ kind: 'ticket' });
        setSelectedTicketId(ticketId);
      }
      const next = new URLSearchParams(searchParams);
      next.delete('chat');
      next.delete('ticket');
      setSearchParams(next, { replace: true });
      return;
    }
    if (hasTicketSortParams(searchParams) || hasTicketViewParam(searchParams)) {
      setSelection((current) => (current.kind === 'ticket' ? current : { kind: 'ticket' }));
    }
  }, [searchParams, setSearchParams]);

  const onTickets = selection.kind === 'ticket';
  const view = selection.kind === 'chat' ? selection.view : 'all';

  // The Tickets grid sort is the URL's job (FR-MOD-02.7), so a sorted view is
  // shareable and survives a reload. Like the chat list below it asks the server
  // for a different page chain rather than re-ordering the loaded rows — see
  // `ticket-grid.ts`; passing `ticketSort` into `useTicketList`'s query key is
  // what restarts the chain, and nothing here resets it by hand.
  const ticketSort = useMemo(() => parseTicketSort(searchParams), [searchParams]);

  // The view filter is the URL's job too, same contract as the sort above —
  // shareable, survives a reload, and folded into `ticketsKey` (`useTickets.js`)
  // so switching it starts a fresh page chain.
  const ticketView = useMemo(() => parseTicketView(searchParams), [searchParams]);

  // Switching to a chat view drops the grid's sort + view params so a stale
  // `?ticket_sort`/`?ticket_view` does not linger in the URL (and re-open the
  // grid on reload).
  const selectChatView = (next: InboxView): void => {
    setSelection({ kind: 'chat', view: next });
    if (hasTicketSortParams(searchParams) || hasTicketViewParam(searchParams)) {
      setSearchParams(clearTicketView(clearTicketSort(searchParams)), { replace: true });
    }
  };

  // A ticket view always lands on the grid, not a stale open ticket. Unlike
  // the sort's header clicks (`replace: true`, below), this pushes a new
  // history entry — the PRD asks the browser's back/forward buttons to walk
  // through a filter switch rather than skip over it.
  const selectTicketView = (next: TicketView): void => {
    setSelection({ kind: 'ticket' });
    setSelectedTicketId(null);
    setSearchParams(writeTicketView(searchParams, next));
  };

  const changeTicketSort = (key: TicketSortKey): void => {
    setSearchParams(writeTicketSort(searchParams, toggleTicketSort(ticketSort, key)), {
      replace: true,
    });
  };

  // The chat list sort (FR-MOD-02.2.1) is the URL's job too, same reasoning and
  // now the same mechanism as the Tickets grid above: shareable, survives a
  // reload, and the server is the one that sorts — see `chat-sort.ts`.
  const chatSort = useMemo(() => parseChatSort(searchParams), [searchParams]);
  const changeChatSort = (sort: ChatSort): void => {
    setSearchParams(writeChatSort(searchParams, sort), { replace: true });
  };

  // The connection dot below reports the shell's socket (`AppShell` ·
  // `RealtimeOwner`), which this screen no longer opens: it outlives the route,
  // so the alerts it drives keep working after an agent navigates away.
  const rtmStatus = useRealtimeStatus();
  const counts = useViewCounts();
  const list = useChatList(view, chatSort);
  const chat = useChat(selectedId);
  const transcript = useTranscript(selectedId);
  const tickets = useTicketList(ticketView, ticketSort, onTickets);

  // Read receipt (FR-MOD-02.2.2): only while the transcript pane is actually on
  // screen — the Tickets tab leaves `selectedId`/`transcript` fetching in the
  // background, and that must not silently mark unseen messages as seen.
  const seenChatId = onTickets ? null : selectedId;
  // The *newest* loaded event, which walking back through history cannot move:
  // the pages arrive at the front of this list, so `at(-1)` stays the latest
  // message however far back the agent reads (FR-MOD-02.2.2).
  const lastVisibleEventAt = onTickets ? null : (transcript.events.at(-1)?.created_at ?? null);
  useMarkSeen(seenChatId, lastVisibleEventAt);

  const agent = useAuth((s) => s.agent);
  const setRoutingStatus = useAuth((s) => s.setRoutingStatus);

  // Whether the right-hand Details panel is shown or collapsed to give the
  // transcript the full width. The choice is remembered across reloads.
  const rightPanel = useRightPanel();

  // The "Views" group (FR-MOD-02.1.4): channel views and custom saved views.
  // Channel state is owner/admin-only, so an ordinary agent never fires the
  // request — their Views group is just their own saved views.
  const canChannels = canReadChannels(agent?.scopes ?? []);
  const channels = useConnectedChannels(canChannels);
  const channelItems = channels.data?.items ?? [];
  const savedViews = useSavedViews();

  // Applying a saved view sets its base view and real-time tab in one click.
  const applySavedView = (saved: SavedView): void => {
    selectChatView(saved.base);
    setTrafficTab(saved.traffic);
  };

  // Which pane fills the right panel: the persisted Details context, or
  // Copilot (FR-MOD-12.1). The choice persists like Expand does (`panelTab.ts`
  // mirrors `rightPanel.ts`), so the PRD's "geçiş persist" holds across a
  // reload *and* across switching between open chats. The one case that still
  // forces Details is losing the open chat entirely (closed/deselected, not
  // "hasn't loaded yet") — Copilot has nothing to assist with no conversation,
  // and without this a stale "copilot" would otherwise sit unreachable behind
  // the next chat that gets auto-selected.
  const panelTab = usePanelTab();
  const hadOpenChatRef = useRef(false);
  useEffect(() => {
    if (selectedId) {
      hadOpenChatRef.current = true;
    } else if (hadOpenChatRef.current) {
      hadOpenChatRef.current = false;
      panelTab.showDetails();
    }
  }, [selectedId]);

  const chats = list.items;
  // "The first page has landed" — the guard `list.data` used to be. Not
  // `isPending`, which is also false once the list has *failed*: a load error
  // must not read as an empty inbox and drop the open conversation.
  const chatsLoaded = list.pages.length > 0;

  // The real-time tabs segment the loaded list, so the counts move with the
  // same data the rows render from. Selection stays validated against the full
  // list below — switching tabs filters what is shown without dropping the
  // open conversation, which would yank the transcript out from under the agent.
  const trafficCounts = useMemo(() => trafficTabCounts(chats), [chats]);
  const visibleChats = useMemo(() => filterByTrafficTab(chats, trafficTab), [chats, trafficTab]);

  // Keep a selection valid as the list changes underneath — a chat can be
  // transferred away while it is open. Gated on the first page having landed so
  // a deep-linked chat is not reset against the empty array that precedes it.
  //
  // A chat that is real but sits on a page nobody has scrolled to yet would
  // look "gone" here, so the reset waits until the list has stopped growing:
  // while another page is still coming, absence proves nothing.
  useEffect(() => {
    if (onTickets || !chatsLoaded) return;
    if (!selectedId) {
      if (chats.length > 0) setSelectedId(chats[0]!.id);
    } else if (!list.hasNext && !chats.some((c) => c.id === selectedId)) {
      setSelectedId(chats[0]?.id ?? null);
    }
  }, [chats, selectedId, onTickets, chatsLoaded, list.hasNext]);

  const ticketItems = tickets.items;
  const ticketsLoaded = tickets.pages.length > 0;

  // Grid-first: nothing is auto-selected, so opening the Tickets group lands on
  // the grid rather than jumping into a record. A selection that drops out of
  // the loaded list (solved into another view, merged away) falls back to the
  // grid — gated on `!tickets.hasNext` the same way the chat list is above: a
  // ticket that is real but sits on a page nobody has scrolled to yet would
  // otherwise look gone while more pages are still coming.
  useEffect(() => {
    if (!onTickets || !ticketsLoaded) return;
    if (
      selectedTicketId &&
      !tickets.hasNext &&
      !ticketItems.some((t) => t.id === selectedTicketId)
    ) {
      setSelectedTicketId(null);
    }
  }, [ticketItems, selectedTicketId, onTickets, ticketsLoaded, tickets.hasNext]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Take tour (FR-MOD-01.4, 02.2.3): above both the ticket grid and the
          chat panes, since it is a whole-module offer, not a chat-view one. */}
      <TakeTourBanner />
      <div className="flex min-h-0 flex-1">
        {/* Views */}
        <nav
          aria-label={t('inbox.rail.ariaLabel')}
          className="flex w-sidebar shrink-0 flex-col overflow-y-auto border-r border-border bg-surface"
        >
          <header className="flex h-topbar items-center justify-between px-4">
            <h1 className="text-lg font-semibold">{t('inbox.rail.title')}</h1>
            <ConnectionBadge status={rtmStatus} />
          </header>

          <ul className="flex flex-col gap-0.5 px-2">
            {VIEWS.map((item) => (
              <li key={item.id}>
                <ViewButton
                  label={t(VIEW_LABEL_KEY[item.id])}
                  icon={item.icon}
                  active={selection.kind === 'chat' && selection.view === item.id}
                  count={counts[item.id]}
                  onClick={() => selectChatView(item.id)}
                />
              </li>
            ))}
          </ul>

          <h2 className="px-4 pb-1 pt-4 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('inbox.rail.aiHeading')}
          </h2>
          <ul className="flex flex-col gap-0.5 px-2">
            {AI_VIEWS.map((item) => (
              <li key={item.id}>
                <ViewButton
                  label={t(VIEW_LABEL_KEY[item.id])}
                  icon={item.icon}
                  active={selection.kind === 'chat' && selection.view === item.id}
                  count={counts[item.id]}
                  onClick={() => selectChatView(item.id)}
                />
              </li>
            ))}
          </ul>

          <h2 className="px-4 pb-1 pt-4 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('inbox.rail.ticketsHeading')}
          </h2>
          <ul className="flex flex-col gap-0.5 px-2">
            {TICKET_VIEWS.map((item) => (
              <li key={item.id}>
                <ViewButton
                  label={t(TICKET_VIEW_LABEL_KEY[item.id])}
                  icon={item.icon}
                  active={selection.kind === 'ticket' && ticketView === item.id}
                  onClick={() => selectTicketView(item.id)}
                />
              </li>
            ))}
            {/* "More" (FR-MOD-02.1.3): the PRD's fourth item — a doorway into the
              grid, not a fifth filter. Every button above already opens the same
              sortable grid directly (no separate compact preview to expand from),
              so this never carries `active`; it lands where rapor-1's own
              `grid/{all|unassigned|my-open}` route defaults to with no prior
              context — the `all` filter. `solved` stays: it is a working filter
              today, and taking it from agents costs more than this addition. */}
            <li>
              <ViewButton
                label={t('inbox.rail.ticketView.more')}
                icon="⋯"
                active={false}
                onClick={() => selectTicketView('all')}
              />
            </li>
          </ul>

          {/* Views (FR-MOD-02.1.4): channel views — or a promo when no channel is
            connected — plus the agent's own saved filters. */}
          <ViewsGroup
            canReadChannels={canChannels}
            channels={channelItems}
            channelsResolved={!channels.isPending}
            savedViews={savedViews.views}
            onSelectSaved={applySavedView}
            onAddSavedView={(name) => savedViews.add({ name, base: view, traffic: trafficTab })}
            onRemoveSavedView={savedViews.remove}
          />

          <div className="mt-auto border-t border-border p-3">
            {/* `htmlFor` matters here: without it this is an unnamed combobox,
              and the control that decides whether an agent receives work is the
              last one that should be unlabelled (NFR-A11Y5). */}
            <label
              htmlFor="routing-status"
              className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-content-tertiary"
            >
              {t('inbox.rail.availability')}
            </label>
            <select
              id="routing-status"
              value={agent?.routing_status ?? 'offline'}
              onChange={(event) => void setRoutingStatus(event.target.value as 'accepting_chats')}
              className="w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm"
            >
              <option value="accepting_chats">{t('inbox.rail.routing.accepting')}</option>
              <option value="not_accepting_chats">{t('inbox.rail.routing.notAccepting')}</option>
              <option value="offline">{t('inbox.rail.routing.offline')}</option>
            </select>
          </div>
        </nav>

        {onTickets ? (
          /* Tickets (FR-MOD-02.7): a full-width sortable grid, or the ticket
           record once a row is opened. The grid spans the list + transcript
           columns — tickets are compared across columns, not scanned in a
           narrow rail, and the row is the link to the conversation behind it. */
          selectedTicketId ? (
            <TicketDetailPane
              ticketId={selectedTicketId}
              candidates={ticketItems}
              onBack={() => setSelectedTicketId(null)}
            />
          ) : (
            <main className="flex min-w-0 flex-1 flex-col bg-canvas">
              <header className="flex h-topbar shrink-0 items-center justify-between border-b border-border bg-surface px-4">
                <h2 className="text-sm font-semibold">{t(TICKET_VIEW_LABEL_KEY[ticketView])}</h2>
                {/* The view's size, from the server's `total` — not the number of
                    rows this browser has chained so far (D3 · FR-MOD-02.1.2).
                    Falls back to the loaded count only before the first page
                    lands, when there is no server number to show yet. Hidden on
                    a load error (FR-MOD-02.1.3): a "0" beside "unavailable"
                    would read as a contradiction, not a size. */}
                {!tickets.isError && (
                  <span className="tabular text-2xs text-content-tertiary">
                    {tickets.total ?? ticketItems.length}
                  </span>
                )}
              </header>
              <div className="min-h-0 flex-1 overflow-hidden p-4">
                <TicketGrid
                  tickets={ticketItems}
                  loading={tickets.isPending}
                  error={tickets.isError}
                  sort={ticketSort}
                  onSort={changeTicketSort}
                  onOpen={setSelectedTicketId}
                  selectedId={selectedTicketId}
                  onEndReached={tickets.fetchNext}
                />
              </div>
            </main>
          )
        ) : (
          <>
            {/* Conversation list */}
            <section
              aria-label={t('inbox.list.ariaLabel')}
              className="flex w-list shrink-0 flex-col border-r border-border bg-surface"
            >
              <header className="flex h-topbar items-center justify-between gap-2 border-b border-border px-4">
                <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {t(VIEW_LABEL_KEY[view])}
                </h2>
                {/* Sort control (FR-MOD-02.2.1): the server's own `sort` param
                    (`chat-sort.ts`), not a client-side re-order — see there for
                    why that has to be true for a list that keeps paging. */}
                <select
                  aria-label={t('inbox.list.sort.ariaLabel')}
                  value={chatSort}
                  onChange={(event) => changeChatSort(event.target.value as ChatSort)}
                  className="shrink-0 rounded-md border border-border bg-inset px-1.5 py-1 text-2xs text-content-secondary"
                >
                  <option value="newest">{t('inbox.list.sort.newest')}</option>
                  <option value="oldest">{t('inbox.list.sort.oldest')}</option>
                </select>
                <span className="tabular shrink-0 text-2xs text-content-tertiary">
                  {visibleChats.length}
                </span>
              </header>

              {/* Real-time tabs (FR-MOD-03.1.1): a live segmentation of the chat list. */}
              <div
                role="tablist"
                aria-label={t('inbox.list.trafficAriaLabel')}
                className="flex gap-1 border-b border-border px-2 py-1.5"
              >
                {TRAFFIC_TABS.map((tab) => {
                  const active = trafficTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setTrafficTab(tab.id)}
                      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
                        active
                          ? 'bg-brand-100 font-medium text-brand-700 dark:bg-brand-950 dark:text-content'
                          : 'text-content-secondary hover:bg-surface-2'
                      }`}
                    >
                      <span>{t(TRAFFIC_TAB_LABEL_KEY[tab.id])}</span>
                      <span
                        aria-hidden="true"
                        className={`tabular rounded-sm px-1 text-2xs ${
                          active
                            ? 'bg-brand-200 dark:bg-brand-900'
                            : 'bg-inset text-content-tertiary'
                        }`}
                      >
                        {trafficCounts[tab.id]}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div
                className="flex-1 overflow-y-auto"
                role="tabpanel"
                // Reaching the end of what is loaded asks for the next page
                // (NFR-P5). `fetchNext` is a no-op once the list has ended, so
                // the last screenful can keep firing this harmlessly.
                onScroll={(event) => {
                  const el = event.currentTarget;
                  if (el.scrollHeight - el.scrollTop - el.clientHeight < END_OF_LIST_PX) {
                    list.fetchNext();
                  }
                }}
              >
                {list.isPending ? (
                  <ListSkeleton />
                ) : visibleChats.length === 0 ? (
                  <EmptyState
                    title={
                      chats.length > 0 && trafficTab !== 'all'
                        ? t('inbox.list.empty.tabTitle')
                        : t('inbox.list.empty.title')
                    }
                    description={
                      chats.length > 0 && trafficTab !== 'all'
                        ? t('inbox.list.empty.tabDescription')
                        : view === 'archived'
                          ? t('inbox.list.empty.archived')
                          : view === 'supervised'
                            ? t('inbox.list.empty.supervised')
                            : view === 'ai'
                              ? t('inbox.list.empty.ai')
                              : view === 'ai_solved'
                                ? t('inbox.list.empty.aiSolved')
                                : t('inbox.list.empty.description')
                    }
                  />
                ) : (
                  <ul>
                    {visibleChats.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(item.id)}
                          aria-current={selectedId === item.id ? 'true' : undefined}
                          className={`flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left transition-colors ${
                            selectedId === item.id
                              ? 'bg-brand-100 dark:bg-brand-950'
                              : 'hover:bg-surface-2'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <span className="flex-1 truncate text-sm font-medium">
                              {item.customer_name ?? t('inbox.list.item.visitorFallback')}
                            </span>
                            {item.queue_position !== null && (
                              <span className="rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-warning">
                                {t('inbox.list.item.queuePosition', {
                                  position: item.queue_position,
                                })}
                              </span>
                            )}
                            {item.unread_count > 0 && (
                              <span
                                aria-label={t('inbox.list.item.unreadAria', {
                                  count: item.unread_count,
                                })}
                                className="h-2 w-2 rounded-full bg-brand-500"
                              />
                            )}
                          </span>
                          <span className="truncate text-xs text-content-secondary">
                            {item.last_event?.text ?? t('inbox.list.item.noMessages')}
                          </span>
                          {item.tags.length > 0 && (
                            <span className="flex flex-wrap gap-1">
                              {item.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-content-tertiary"
                                >
                                  {tag}
                                </span>
                              ))}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {/* Scrolling is the normal way to reach the next page; this is
                    the same offer for a keyboard, and the only way out when a
                    real-time tab filters the loaded page down to nothing. */}
                {!list.isPending && list.hasNext && (
                  <div className="flex justify-center border-t border-border p-3">
                    <button
                      type="button"
                      onClick={list.fetchNext}
                      disabled={list.isFetchingNext}
                      className="rounded-md border border-border bg-inset px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:text-content disabled:opacity-60"
                    >
                      {list.isFetchingNext ? t('inbox.list.loading') : t('inbox.list.loadMore')}
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Transcript */}
            <main className="flex min-w-0 flex-1 flex-col bg-canvas">
              {selectedId && chat.data ? (
                <>
                  <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
                    <h2 className="flex-1 truncate text-sm font-semibold">
                      {chats.find((c) => c.id === selectedId)?.customer_name ??
                        t('inbox.thread.visitorFallback')}
                    </h2>
                    <span className="font-mono text-2xs text-content-tertiary">{selectedId}</span>
                    <StatusDot
                      tone={chat.data.active ? 'success' : 'neutral'}
                      label={
                        chat.data.active
                          ? t('inbox.thread.statusActive')
                          : t('inbox.thread.statusArchived')
                      }
                    />
                    <CopyLinkButton chatId={selectedId} />
                    <CreateTicketButton
                      chatId={selectedId}
                      customerName={chats.find((c) => c.id === selectedId)?.customer_name ?? null}
                      onOpenTicket={(ticketId) => {
                        setSelection({ kind: 'ticket' });
                        setSelectedTicketId(ticketId);
                        // A stale filter (e.g. `solved`) could hide the ticket
                        // just created once the agent backs out of its pane.
                        if (hasTicketViewParam(searchParams)) {
                          setSearchParams(clearTicketView(searchParams), { replace: true });
                        }
                      }}
                    />
                    {/* Copilot (FR-MOD-12.1): opens the assist panel for this chat,
                      bringing the right panel back if it was collapsed. */}
                    <CopilotButton
                      onOpen={() => {
                        panelTab.showCopilot();
                        rightPanel.setExpanded(false);
                      }}
                    />
                    {/* When the panel is open it is collapsed from its own header
                      (the transcript header is tight at this width); when it is
                      hidden, this is the way back to it. */}
                    {rightPanel.expanded && (
                      <ShowDetailsButton onShow={() => rightPanel.setExpanded(false)} />
                    )}
                  </header>

                  <Transcript
                    chatId={selectedId}
                    events={transcript.events}
                    loading={transcript.isPending}
                    currentAgentId={agent?.account_id ?? null}
                    hasOlder={transcript.hasOlder}
                    isLoadingOlder={transcript.isLoadingOlder}
                    onLoadOlder={transcript.loadOlder}
                  />

                  <TypingIndicator
                    chatId={selectedId}
                    customerName={chats.find((c) => c.id === selectedId)?.customer_name ?? null}
                  />
                  <ConflictBanner chatId={selectedId} />

                  <Composer chatId={selectedId} disabled={!chat.data.active} />
                </>
              ) : (
                <EmptyState
                  title={t('inbox.thread.empty.title')}
                  description={t('inbox.thread.empty.description')}
                />
              )}
            </main>

            {/* Right panel — Details or Copilot. Hidden in Expand mode so the
              transcript takes the full width (FR-MOD-01.3 / 12.1). */}
            {selectedId &&
              chat.data &&
              !rightPanel.expanded &&
              (panelTab.tab === 'copilot' ? (
                <CopilotPanel
                  chatId={selectedId}
                  chatActive={chat.data.active}
                  onShowDetails={panelTab.showDetails}
                  onCollapse={() => rightPanel.setExpanded(true)}
                />
              ) : (
                <DetailsPanel
                  chat={chat.data}
                  chatId={selectedId}
                  onCollapse={() => rightPanel.setExpanded(true)}
                />
              ))}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Brings the Details panel back after it has been collapsed (FR-MOD-01.3). It
 * only renders in Expand mode, where the transcript is wide and the header has
 * room; collapsing happens from the panel's own header, which stays reachable
 * while the transcript here is narrow.
 */
function ShowDetailsButton({ onShow }: { onShow: () => void }): ReactElement {
  const t = useTranslate();
  return (
    <button
      type="button"
      onClick={onShow}
      aria-label={t('inbox.thread.showDetails')}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-content-secondary hover:bg-surface-2"
    >
      <span aria-hidden="true">◧</span>
      {t('inbox.thread.detailsLabel')}
    </button>
  );
}

/**
 * Opens the Copilot assist panel for the open conversation (FR-MOD-12.1). Sits
 * in the transcript header next to Copy link and Create ticket, so agent-assist
 * is one click from any chat.
 */
function CopilotButton({ onOpen }: { onOpen: () => void }): ReactElement {
  const t = useTranslate();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-content-secondary hover:bg-surface-2"
    >
      <span aria-hidden="true">✧</span>
      {t('inbox.thread.copilotLabel')}
    </button>
  );
}

function ViewButton({
  label,
  icon,
  active,
  count,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  count?: number;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
        active
          ? 'bg-brand-100 font-medium text-brand-700 dark:bg-brand-950 dark:text-content'
          : 'text-content-secondary hover:bg-surface-2'
      }`}
    >
      <span aria-hidden="true" className="text-content-tertiary">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      {count !== undefined && (
        <span className="tabular text-2xs text-content-tertiary">{count}</span>
      )}
    </button>
  );
}

/**
 * The Views group (FR-MOD-02.1.4). Channel views sit up top — one per connected
 * channel, or a promo pointing at Settings when none is connected (the "no
 * channel → channel-promo" criterion) — and the agent's own saved views below.
 * The channel section only renders for owners/admins, who can read and connect
 * channels; an ordinary agent sees just their saved views.
 */
function ViewsGroup({
  canReadChannels,
  channels,
  channelsResolved,
  savedViews,
  onSelectSaved,
  onAddSavedView,
  onRemoveSavedView,
}: {
  canReadChannels: boolean;
  channels: ConnectedChannelLike[];
  channelsResolved: boolean;
  savedViews: SavedView[];
  onSelectSaved: (view: SavedView) => void;
  onAddSavedView: (name: string) => SavedView | null;
  onRemoveSavedView: (id: string) => void;
}): ReactElement {
  const t = useTranslate();
  return (
    <>
      <h2 className="px-4 pb-1 pt-4 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        {t('inbox.rail.viewsHeading')}
      </h2>

      {/* Channel views. Gated on `channelsResolved` so the promo does not flash
          before the first `/channels` response settles. */}
      {canReadChannels &&
        channelsResolved &&
        (showChannelPromo(channels) ? (
          <div
            data-testid="channel-promo"
            className="mx-2 rounded-md border border-dashed border-border p-3"
          >
            <p className="text-2xs text-content-secondary">{t('inbox.rail.channelPromo.text')}</p>
            <Link
              to="/app/settings"
              className="mt-1.5 inline-block text-2xs font-medium text-content-brand hover:underline"
            >
              {t('inbox.rail.channelPromo.cta')}
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5 px-2">
            {connectedChannelViews(channels).map((channel) => (
              <li key={channel.type}>
                <Link
                  to="/app/settings"
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-content-secondary transition-colors hover:bg-surface-2"
                >
                  <span aria-hidden="true">{channel.icon}</span>
                  <span className="flex-1">{channel.label}</span>
                  <StatusDot tone="success" label={t('inbox.rail.channelConnected')} />
                </Link>
              </li>
            ))}
          </ul>
        ))}

      {/* Custom saved views (FR-MOD-02.1.4): the agent's own named filters. */}
      {savedViews.length > 0 && (
        <ul className="flex flex-col gap-0.5 px-2 pt-0.5">
          {savedViews.map((saved) => (
            <li key={saved.id} className="group flex items-center">
              <button
                type="button"
                onClick={() => onSelectSaved(saved)}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-content-secondary transition-colors hover:bg-surface-2"
              >
                <span aria-hidden="true" className="text-content-tertiary">
                  ★
                </span>
                <span className="flex-1 truncate">{saved.name}</span>
              </button>
              <button
                type="button"
                onClick={() => onRemoveSavedView(saved.id)}
                aria-label={t('inbox.rail.savedView.remove', { name: saved.name })}
                className="shrink-0 rounded-md px-1.5 py-1 text-2xs text-content-tertiary opacity-0 transition-opacity hover:text-danger focus:opacity-100 group-hover:opacity-100"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <AddSavedView onAdd={onAddSavedView} />
    </>
  );
}

/**
 * The "Save current view" control: a plain button that reveals a name field.
 * Naming happens inline rather than in a modal — the saved filter is the
 * current one, so the only missing piece is what to call it. An empty name is
 * rejected by the store, so the input stays open until a real name is given.
 */
function AddSavedView({ onAdd }: { onAdd: (name: string) => SavedView | null }): ReactElement {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const t = useTranslate();

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (onAdd(name)) {
      setName('');
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <div className="px-2 pb-1 pt-0.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-2xs font-medium text-content-tertiary transition-colors hover:bg-surface-2"
        >
          <span aria-hidden="true">＋</span>
          {t('inbox.rail.savedView.saveCurrent')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5 px-2 pb-1 pt-0.5">
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={SAVED_VIEW_NAME_MAX}
        placeholder={t('inbox.rail.savedView.namePlaceholder')}
        aria-label={t('inbox.rail.savedView.nameAriaLabel')}
        className="w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm"
      />
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={name.trim().length === 0}
          className="rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {t('inbox.rail.savedView.submit')}
        </button>
        <button
          type="button"
          onClick={() => {
            setName('');
            setOpen(false);
          }}
          className="rounded-md border border-border px-2.5 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
        >
          {t('inbox.rail.savedView.cancel')}
        </button>
      </div>
    </form>
  );
}

/**
 * Connection state, shown as text and glyph as well as colour — an agent needs
 * to know their inbox has gone stale, and colour alone fails both colour-blind
 * users and anyone glancing at a bright screen (design-brief §7).
 */
function ConnectionBadge({ status }: { status: string }): ReactElement {
  const t = useTranslate();
  const tone =
    status === 'live' ? 'success' : status === 'offline' ? 'danger' : ('warning' as const);
  const label =
    status === 'live'
      ? t('inbox.rail.connection.live')
      : status === 'offline'
        ? t('inbox.rail.connection.offline')
        : t('inbox.rail.connection.reconnecting');
  return <StatusDot tone={tone} label={label} />;
}

/**
 * Copies a deep link to this conversation (FR-MOD-02.6). It reuses the `?chat=`
 * parameter the inbox already consumes on load, made absolute, so a pasted link
 * reopens the exact conversation from a ticket, a chat message, or another
 * machine.
 */
function CopyLinkButton({ chatId }: { chatId: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const t = useTranslate();
  const copy = (): void => {
    const url = `${window.location.origin}/app/inbox?chat=${chatId}`;
    void navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      },
      () => setCopied(false),
    );
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-content-secondary hover:bg-surface-2"
    >
      {copied ? t('inbox.thread.copied') : t('inbox.thread.copyLink')}
    </button>
  );
}
