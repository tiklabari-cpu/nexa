/**
 * The 3-pane inbox: views, conversation list, transcript, details.
 *
 * Layout follows design-brief §4 — a fixed icon rail and sidebar, a resizable
 * list, and a transcript that takes the remaining width. Every colour and size
 * comes from a token; no component hard-codes a hex value.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useAuth } from '../../lib/auth-store.js';
import { StatusDot } from '../../components/StatusDot.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Composer } from './Composer.js';
import { DetailsPanel } from './DetailsPanel.js';
import { Transcript } from './Transcript.js';
import { useChat, useChatList, useRealtime, useTranscript, useViewCounts } from './useInbox.js';
import type { InboxView } from './types.js';

const VIEWS: Array<{ id: InboxView; label: string; icon: string }> = [
  { id: 'all', label: 'All', icon: '▤' },
  { id: 'my', label: 'My chats', icon: '◍' },
  { id: 'queued', label: 'Queued', icon: '◔' },
  { id: 'unassigned', label: 'Unassigned', icon: '◌' },
  { id: 'archived', label: 'Archive', icon: '▣' },
];

export function InboxPage(): ReactElement {
  const [view, setView] = useState<InboxView>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rtmStatus = useRealtime();
  const counts = useViewCounts();
  const list = useChatList(view);
  const chat = useChat(selectedId);
  const transcript = useTranscript(selectedId);

  const agent = useAuth((s) => s.agent);
  const setRoutingStatus = useAuth((s) => s.setRoutingStatus);
  const signOut = useAuth((s) => s.signOut);

  const chats = useMemo(() => list.data?.items ?? [], [list.data]);

  // Keep a selection valid as the list changes underneath — a chat can be
  // transferred away while it is open.
  useEffect(() => {
    if (selectedId && !chats.some((c) => c.id === selectedId)) {
      setSelectedId(chats[0]?.id ?? null);
    } else if (!selectedId && chats.length > 0) {
      setSelectedId(chats[0]!.id);
    }
  }, [chats, selectedId]);

  return (
    <div className="flex h-full bg-canvas text-content">
      <IconRail />

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
              <button
                type="button"
                onClick={() => setView(item.id)}
                aria-current={view === item.id ? 'page' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                  view === item.id
                    ? 'bg-brand-100 font-medium text-brand-700 dark:bg-brand-950 dark:text-content'
                    : 'text-content-secondary hover:bg-surface-2'
                }`}
              >
                <span aria-hidden="true" className="text-content-tertiary">
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {counts[item.id] !== undefined && (
                  <span className="tabular text-2xs text-content-tertiary">{counts[item.id]}</span>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-auto border-t border-border p-3">
          <label className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            Availability
          </label>
          <select
            value={agent?.routing_status ?? 'offline'}
            onChange={(event) => void setRoutingStatus(event.target.value as 'accepting_chats')}
            className="w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm"
          >
            <option value="accepting_chats">Accepting chats</option>
            <option value="not_accepting_chats">Not accepting</option>
            <option value="offline">Offline</option>
          </select>

          <div className="mt-3 flex items-center justify-between text-2xs text-content-tertiary">
            <span className="truncate" title={agent?.email ?? ''}>
              {agent?.name ?? agent?.email}
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-sm px-1 underline hover:text-content"
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>

      {/* Conversation list */}
      <section
        aria-label="Conversations"
        className="flex w-list shrink-0 flex-col border-r border-border bg-surface"
      >
        <header className="flex h-topbar items-center justify-between border-b border-border px-4">
          <h2 className="text-sm font-semibold">{VIEWS.find((v) => v.id === view)?.label}</h2>
          <span className="tabular text-2xs text-content-tertiary">{chats.length}</span>
        </header>

        <div className="flex-1 overflow-y-auto">
          {list.isPending ? (
            <ListSkeleton />
          ) : chats.length === 0 ? (
            <EmptyState
              title="Nothing here yet"
              description={
                view === 'archived'
                  ? 'Closed conversations will appear here.'
                  : 'New conversations land here as they arrive.'
              }
            />
          ) : (
            <ul>
              {chats.map((item) => (
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

      {/* Transcript */}
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
            </header>

            <Transcript
              events={transcript.data?.items ?? []}
              loading={transcript.isPending}
              currentAgentId={agent?.account_id ?? null}
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

      {/* Details */}
      {selectedId && chat.data && <DetailsPanel chat={chat.data} chatId={selectedId} />}
    </div>
  );
}

function IconRail(): ReactElement {
  return (
    <nav
      aria-label="Modules"
      className="flex w-rail shrink-0 flex-col items-center gap-1 bg-rail py-3"
    >
      <span
        aria-hidden="true"
        className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-brand-500 text-sm font-bold text-white"
      >
        N
      </span>
      {[
        { icon: '▤', label: 'Inbox', active: true },
        { icon: '◫', label: 'Customers', active: false },
        { icon: '◑', label: 'Team', active: false },
        { icon: '◆', label: 'Reports', active: false },
      ].map((item) => (
        <button
          key={item.label}
          type="button"
          aria-label={item.label}
          aria-current={item.active ? 'page' : undefined}
          disabled={!item.active}
          className={`relative flex h-9 w-9 items-center justify-center rounded-md text-base ${
            item.active ? 'bg-white/10 text-white' : 'text-white/40 disabled:cursor-not-allowed'
          }`}
        >
          {item.active && (
            <span
              aria-hidden="true"
              className="absolute -left-3 h-5 w-0.5 rounded-full bg-brand-500"
            />
          )}
          <span aria-hidden="true">{item.icon}</span>
        </button>
      ))}
    </nav>
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

function ListSkeleton(): ReactElement {
  return (
    <ul aria-hidden="true" className="animate-pulse">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="border-b border-border px-4 py-3">
          <div className="mb-2 h-3 w-1/2 rounded-sm bg-inset" />
          <div className="h-3 w-3/4 rounded-sm bg-inset" />
        </li>
      ))}
    </ul>
  );
}

/** Kept for the scroll-into-view behaviour the transcript relies on. */
export function useScrollToBottom(dependency: unknown): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [dependency]);
  return ref;
}
