/**
 * The 3-pane inbox: views, conversation list, transcript, details.
 *
 * Layout follows design-brief §4 — a fixed icon rail and sidebar, a resizable
 * list, and a transcript that takes the remaining width. Every colour and size
 * comes from a token; no component hard-codes a hex value.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth-store.js';
import { StatusDot } from '../../components/StatusDot.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { Composer } from './Composer.js';
import { DetailsPanel } from './DetailsPanel.js';
import { CopilotPanel } from './CopilotPanel.js';
import { Transcript } from './Transcript.js';
import { TypingIndicator } from './TypingIndicator.js';
import { useChat, useChatList, useRealtime, useTranscript, useViewCounts } from './useInbox.js';
import { useRightPanel } from './rightPanel.js';
import { useNotifications } from '../notifications/useNotifications.js';
import { TicketDetailPane, TicketList } from './TicketPane.js';
import { useTicketList } from './useTickets.js';
import { CreateTicketButton } from './CreateTicketButton.js';
import { TRAFFIC_TABS, filterByTrafficTab, trafficTabCounts } from './traffic.js';
import type { InboxView, TicketView, TrafficTab } from './types.js';

const VIEWS: Array<{ id: InboxView; label: string; icon: string }> = [
  { id: 'all', label: 'All', icon: '▤' },
  { id: 'my', label: 'My chats', icon: '◍' },
  { id: 'queued', label: 'Queued', icon: '◔' },
  { id: 'unassigned', label: 'Unassigned', icon: '◌' },
  { id: 'archived', label: 'Archive', icon: '▣' },
];

/**
 * The AI Agents group (PRD 02.1.2): conversations the AI agent is handling, kept
 * out of the human queue, and the ones it resolved on its own. "Solved" is the
 * AI-resolution set ADR-09 bills for — the same conversations Reports counts as
 * "Automated".
 */
const AI_VIEWS: Array<{ id: InboxView; label: string; icon: string }> = [
  { id: 'ai', label: 'AI agent', icon: '✦' },
  { id: 'ai_solved', label: 'Solved', icon: '✓' },
];

/**
 * The PRD keeps chats and tickets in one inbox under two groups, so the
 * selection is one value with two shapes rather than two independent states —
 * two states drift, and the pane ends up rendering a chat under a ticket
 * heading.
 */
type Selection = { kind: 'chat'; view: InboxView } | { kind: 'ticket'; view: TicketView };

const TICKET_VIEWS: Array<{ id: TicketView; label: string; icon: string }> = [
  { id: 'all', label: 'All tickets', icon: '▦' },
  { id: 'unassigned', label: 'Unassigned', icon: '◇' },
  { id: 'my_open', label: 'My open', icon: '◈' },
  { id: 'solved', label: 'Solved', icon: '✓' },
];

export function InboxPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();

  const [selection, setSelection] = useState<Selection>({ kind: 'chat', view: 'all' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [trafficTab, setTrafficTab] = useState<TrafficTab>('all');

  // A deep link opens a specific chat or ticket (from the command palette or a
  // shared URL). The record's own detail query loads it regardless of which
  // list view is showing, so all this has to do is point the selection at it
  // under the "All" view and then consume the parameter.
  useEffect(() => {
    const chatId = searchParams.get('chat');
    const ticketId = searchParams.get('ticket');
    if (!chatId && !ticketId) return;
    if (chatId) {
      setSelection({ kind: 'chat', view: 'all' });
      setSelectedId(chatId);
    } else if (ticketId) {
      setSelection({ kind: 'ticket', view: 'all' });
      setSelectedTicketId(ticketId);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('chat');
    next.delete('ticket');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const onTickets = selection.kind === 'ticket';
  const view = selection.kind === 'chat' ? selection.view : 'all';

  // Turn incoming messages into sound / desktop / tab-title alerts. The socket
  // is shared: the same push updates the cache and drives the notification.
  const notifier = useNotifications();
  const rtmStatus = useRealtime(notifier.handlePush);
  const counts = useViewCounts();
  const list = useChatList(view);
  const chat = useChat(selectedId);
  const transcript = useTranscript(selectedId);
  const tickets = useTicketList(selection.kind === 'ticket' ? selection.view : 'all', onTickets);

  const agent = useAuth((s) => s.agent);
  const setRoutingStatus = useAuth((s) => s.setRoutingStatus);

  // Whether the right-hand Details panel is shown or collapsed to give the
  // transcript the full width. The choice is remembered across reloads.
  const rightPanel = useRightPanel();

  // Which pane fills the right panel: the persisted Details context, or Copilot
  // (FR-MOD-12.1). Copilot is per-conversation, not a remembered layout
  // preference, so it resets to Details whenever the open chat changes.
  const [panelTab, setPanelTab] = useState<'details' | 'copilot'>('details');
  useEffect(() => {
    setPanelTab('details');
  }, [selectedId]);

  const chats = useMemo(() => list.data?.items ?? [], [list.data]);

  // The real-time tabs segment the loaded list, so the counts move with the
  // same data the rows render from. Selection stays validated against the full
  // list below — switching tabs filters what is shown without dropping the
  // open conversation, which would yank the transcript out from under the agent.
  const trafficCounts = useMemo(() => trafficTabCounts(chats), [chats]);
  const visibleChats = useMemo(
    () => filterByTrafficTab(chats, trafficTab),
    [chats, trafficTab],
  );

  // Keep a selection valid as the list changes underneath — a chat can be
  // transferred away while it is open. Gated on `list.data` so a deep-linked
  // chat is not reset against the empty array that precedes the first load.
  useEffect(() => {
    if (onTickets || !list.data) return;
    if (selectedId && !chats.some((c) => c.id === selectedId)) {
      setSelectedId(chats[0]?.id ?? null);
    } else if (!selectedId && chats.length > 0) {
      setSelectedId(chats[0]!.id);
    }
  }, [chats, selectedId, onTickets, list.data]);

  const ticketItems = useMemo(() => tickets.data?.items ?? [], [tickets.data]);

  useEffect(() => {
    if (!onTickets || !tickets.data) return;
    if (selectedTicketId && !ticketItems.some((t) => t.id === selectedTicketId)) {
      setSelectedTicketId(ticketItems[0]?.id ?? null);
    } else if (!selectedTicketId && ticketItems.length > 0) {
      setSelectedTicketId(ticketItems[0]!.id);
    }
  }, [ticketItems, selectedTicketId, onTickets, tickets.data]);

  return (
    <>
      {/* Views */}
      <nav
        aria-label="Inbox views"
        className="flex w-sidebar shrink-0 flex-col border-r border-border bg-surface"
      >
        <header className="flex h-topbar items-center justify-between px-4">
          <h1 className="text-lg font-semibold">Inbox</h1>
          <ConnectionBadge status={rtmStatus} />
        </header>

        <ul className="flex flex-col gap-0.5 px-2">
          {VIEWS.map((item) => (
            <li key={item.id}>
              <ViewButton
                label={item.label}
                icon={item.icon}
                active={selection.kind === 'chat' && selection.view === item.id}
                count={counts[item.id]}
                onClick={() => setSelection({ kind: 'chat', view: item.id })}
              />
            </li>
          ))}
        </ul>

        <h2 className="px-4 pb-1 pt-4 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
          AI Agents
        </h2>
        <ul className="flex flex-col gap-0.5 px-2">
          {AI_VIEWS.map((item) => (
            <li key={item.id}>
              <ViewButton
                label={item.label}
                icon={item.icon}
                active={selection.kind === 'chat' && selection.view === item.id}
                count={counts[item.id]}
                onClick={() => setSelection({ kind: 'chat', view: item.id })}
              />
            </li>
          ))}
        </ul>

        <h2 className="px-4 pb-1 pt-4 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
          Tickets
        </h2>
        <ul className="flex flex-col gap-0.5 px-2">
          {TICKET_VIEWS.map((item) => (
            <li key={item.id}>
              <ViewButton
                label={item.label}
                icon={item.icon}
                active={selection.kind === 'ticket' && selection.view === item.id}
                onClick={() => setSelection({ kind: 'ticket', view: item.id })}
              />
            </li>
          ))}
        </ul>

        <div className="mt-auto border-t border-border p-3">
          {/* `htmlFor` matters here: without it this is an unnamed combobox,
              and the control that decides whether an agent receives work is the
              last one that should be unlabelled (NFR-A11Y5). */}
          <label
            htmlFor="routing-status"
            className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            Availability
          </label>
          <select
            id="routing-status"
            value={agent?.routing_status ?? 'offline'}
            onChange={(event) => void setRoutingStatus(event.target.value as 'accepting_chats')}
            className="w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm"
          >
            <option value="accepting_chats">Accepting chats</option>
            <option value="not_accepting_chats">Not accepting</option>
            <option value="offline">Offline</option>
          </select>
        </div>
      </nav>

      {/* Conversation list */}
      <section
        aria-label={onTickets ? 'Tickets' : 'Conversations'}
        className="flex w-list shrink-0 flex-col border-r border-border bg-surface"
      >
        <header className="flex h-topbar items-center justify-between border-b border-border px-4">
          <h2 className="text-sm font-semibold">
            {onTickets
              ? TICKET_VIEWS.find((v) => v.id === selection.view)?.label
              : [...VIEWS, ...AI_VIEWS].find((v) => v.id === view)?.label}
          </h2>
          <span className="tabular text-2xs text-content-tertiary">
            {onTickets ? ticketItems.length : visibleChats.length}
          </span>
        </header>

        {/* Real-time tabs (FR-MOD-03.1.1): a live segmentation of the chat list.
            Chats only — tickets are asynchronous and have their own views. */}
        {!onTickets && (
          <div
            role="tablist"
            aria-label="Real-time tabs"
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
                  <span>{tab.label}</span>
                  <span
                    aria-hidden="true"
                    className={`tabular rounded-sm px-1 text-2xs ${
                      active ? 'bg-brand-200 dark:bg-brand-900' : 'bg-inset text-content-tertiary'
                    }`}
                  >
                    {trafficCounts[tab.id]}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex-1 overflow-y-auto" role={onTickets ? undefined : 'tabpanel'}>
          {onTickets ? (
            <TicketList
              tickets={ticketItems}
              loading={tickets.isPending}
              selectedId={selectedTicketId}
              onSelect={setSelectedTicketId}
            />
          ) : list.isPending ? (
            <ListSkeleton />
          ) : visibleChats.length === 0 ? (
            <EmptyState
              title={
                chats.length > 0 && trafficTab !== 'all' ? 'Nothing in this tab' : 'Nothing here yet'
              }
              description={
                chats.length > 0 && trafficTab !== 'all'
                  ? 'No conversations match this tab right now.'
                  : view === 'archived'
                    ? 'Closed conversations will appear here.'
                    : view === 'ai'
                      ? 'Conversations the AI agent is handling appear here.'
                      : view === 'ai_solved'
                        ? 'Conversations the AI resolved on its own appear here.'
                        : 'New conversations land here as they arrive.'
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
                        {item.customer_name ?? 'Visitor'}
                      </span>
                      {item.queue_position !== null && (
                        <span className="rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-warning">
                          #{item.queue_position} in queue
                        </span>
                      )}
                      {item.unread_count > 0 && (
                        <span
                          aria-label={`${item.unread_count} unread`}
                          className="h-2 w-2 rounded-full bg-brand-500"
                        />
                      )}
                    </span>
                    <span className="truncate text-xs text-content-secondary">
                      {item.last_event?.text ?? 'No messages yet'}
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
        </div>
      </section>

      {/* Transcript, or the ticket record */}
      {onTickets ? (
        <TicketDetailPane ticketId={selectedTicketId} candidates={ticketItems} />
      ) : (
        <main className="flex min-w-0 flex-1 flex-col bg-canvas">
          {selectedId && chat.data ? (
            <>
              <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
                <h2 className="flex-1 truncate text-sm font-semibold">
                  {chats.find((c) => c.id === selectedId)?.customer_name ?? 'Visitor'}
                </h2>
                <span className="font-mono text-2xs text-content-tertiary">{selectedId}</span>
                <StatusDot
                  tone={chat.data.active ? 'success' : 'neutral'}
                  label={chat.data.active ? 'Active' : 'Archived'}
                />
                <CopyLinkButton chatId={selectedId} />
                <CreateTicketButton
                  chatId={selectedId}
                  customerName={chats.find((c) => c.id === selectedId)?.customer_name ?? null}
                  onOpenTicket={(ticketId) => {
                    setSelection({ kind: 'ticket', view: 'all' });
                    setSelectedTicketId(ticketId);
                  }}
                />
                {/* Copilot (FR-MOD-12.1): opens the assist panel for this chat,
                    bringing the right panel back if it was collapsed. */}
                <CopilotButton
                  onOpen={() => {
                    setPanelTab('copilot');
                    rightPanel.setExpanded(false);
                  }}
                />
                {/* When the panel is open it is collapsed from its own header
                    (the transcript header is tight at this width); when it is
                    hidden, this is the way back to it. */}
                {rightPanel.expanded && <ShowDetailsButton onShow={() => rightPanel.setExpanded(false)} />}
              </header>

              <Transcript
                events={transcript.data?.items ?? []}
                loading={transcript.isPending}
                currentAgentId={agent?.account_id ?? null}
              />

              <TypingIndicator
                chatId={selectedId}
                customerName={chats.find((c) => c.id === selectedId)?.customer_name ?? null}
              />

              <Composer chatId={selectedId} disabled={!chat.data.active} />
            </>
          ) : (
            <EmptyState
              title="No conversation selected"
              description="Pick a conversation from the list to see it here."
            />
          )}
        </main>
      )}

      {/* Right panel — Details or Copilot. Hidden in Expand mode so the
          transcript takes the full width (FR-MOD-01.3 / 12.1). */}
      {!onTickets && selectedId && chat.data && !rightPanel.expanded && (
        panelTab === 'copilot' ? (
          <CopilotPanel
            chatId={selectedId}
            chatActive={chat.data.active}
            onShowDetails={() => setPanelTab('details')}
            onCollapse={() => rightPanel.setExpanded(true)}
          />
        ) : (
          <DetailsPanel
            chat={chat.data}
            chatId={selectedId}
            onCollapse={() => rightPanel.setExpanded(true)}
          />
        )
      )}
    </>
  );
}

/**
 * Brings the Details panel back after it has been collapsed (FR-MOD-01.3). It
 * only renders in Expand mode, where the transcript is wide and the header has
 * room; collapsing happens from the panel's own header, which stays reachable
 * while the transcript here is narrow.
 */
function ShowDetailsButton({ onShow }: { onShow: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onShow}
      aria-label="Show details panel"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-content-secondary hover:bg-surface-2"
    >
      <span aria-hidden="true">◧</span>
      Details
    </button>
  );
}

/**
 * Opens the Copilot assist panel for the open conversation (FR-MOD-12.1). Sits
 * in the transcript header next to Copy link and Create ticket, so agent-assist
 * is one click from any chat.
 */
function CopilotButton({ onOpen }: { onOpen: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-content-secondary hover:bg-surface-2"
    >
      <span aria-hidden="true">✧</span>
      Copilot
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
 * Connection state, shown as text and glyph as well as colour — an agent needs
 * to know their inbox has gone stale, and colour alone fails both colour-blind
 * users and anyone glancing at a bright screen (design-brief §7).
 */
function ConnectionBadge({ status }: { status: string }): ReactElement {
  const tone =
    status === 'live' ? 'success' : status === 'offline' ? 'danger' : ('warning' as const);
  const label = status === 'live' ? 'Live' : status === 'offline' ? 'Offline' : 'Reconnecting';
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
      {copied ? 'Copied' : 'Copy link'}
    </button>
  );
}
