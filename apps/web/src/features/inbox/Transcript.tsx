import { useEffect, useRef, type ReactElement } from 'react';
import type { ChatEvent } from './types.js';

/**
 * The conversation.
 *
 * Announced as a polite live region so a screen reader user hears replies
 * without losing their place (design-brief §7). Auto-scroll only follows when
 * the reader is already at the bottom — yanking the view while someone reads
 * back through history is worse than a missed scroll.
 */
export function Transcript({
  events,
  loading,
  currentAgentId,
}: {
  events: ChatEvent[];
  loading: boolean;
  currentAgentId: string | null;
}): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  useEffect(() => {
    const node = containerRef.current;
    if (node && pinnedToBottom.current) node.scrollTop = node.scrollHeight;
  }, [events]);

  const handleScroll = (): void => {
    const node = containerRef.current;
    if (!node) return;
    // 32px of slack: exact equality never holds with fractional scroll heights.
    pinnedToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 32;
  };

  if (loading) {
    return (
      <div className="flex-1 space-y-3 overflow-y-auto p-5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 w-2/3 animate-pulse rounded-lg bg-inset" />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      role="log"
      aria-live="polite"
      aria-label="Conversation transcript"
      className="flex flex-1 flex-col gap-3 overflow-y-auto p-5"
    >
      {events.map((event, index) => (
        <Bubble
          key={event.id}
          event={event}
          isMine={event.author_id === currentAgentId}
          showDayDivider={needsDayDivider(events[index - 1], event)}
        />
      ))}
    </div>
  );
}

function Bubble({
  event,
  isMine,
  showDayDivider,
}: {
  event: ChatEvent;
  isMine: boolean;
  showDayDivider: boolean;
}): ReactElement {
  const isNote = event.recipients === 'agents';
  const isSystem = event.type === 'system_message' || event.author_type === 'system';
  const pending = event.properties?.['pending'] === true;

  return (
    <>
      {showDayDivider && (
        <div className="my-2 flex items-center gap-3" role="separator">
          <span className="h-px flex-1 bg-border" />
          <span className="text-2xs text-content-tertiary">{formatDay(event.created_at)}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )}

      {isSystem ? (
        <p className="self-center text-2xs text-content-tertiary">{event.text}</p>
      ) : (
        <div
          className={`flex max-w-[72%] flex-col gap-1 ${
            event.author_type === 'customer' ? 'self-start' : 'self-end items-end'
          }`}
        >
          {isNote && (
            <span className="text-2xs font-medium text-note">
              Internal note — not sent to the customer
            </span>
          )}
          <div
            className={`rounded-lg px-3 py-2 text-sm ${bubbleClasses({ isNote, isMine, event })} ${
              pending ? 'opacity-60' : ''
            }`}
          >
            {/* React escapes this; there is no dangerouslySetInnerHTML anywhere. */}
            <span className="whitespace-pre-wrap break-words">{event.text}</span>
          </div>
          <span className="tabular text-2xs text-content-tertiary">
            {pending ? 'Sending…' : formatTime(event.created_at)}
            {event.author_type === 'bot' && ' · AI'}
          </span>
        </div>
      )}
    </>
  );
}

function bubbleClasses({
  isNote,
  isMine,
  event,
}: {
  isNote: boolean;
  isMine: boolean;
  event: ChatEvent;
}): string {
  // An internal note gets its own amber treatment so it can never be mistaken
  // for something the customer saw (FR-MOD-02.3.4).
  if (isNote) return 'bg-[var(--bubble-note-bg)] text-content border border-note/30';
  if (event.author_type === 'bot') return 'bg-[var(--bubble-ai-bg)] text-content';
  if (event.author_type === 'customer') return 'bg-[var(--bubble-customer-bg)] text-content';
  return isMine ? 'bg-brand-500 text-white' : 'bg-[var(--bubble-customer-bg)] text-content';
}

function needsDayDivider(previous: ChatEvent | undefined, current: ChatEvent): boolean {
  if (!previous) return false;
  return (
    new Date(previous.created_at).toDateString() !== new Date(current.created_at).toDateString()
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
