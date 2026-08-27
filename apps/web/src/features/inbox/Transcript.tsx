import { useLayoutEffect, useRef, type ReactElement } from 'react';
import type { ChatEvent } from './types.js';
import { AttachmentView } from './Attachment.js';
import { getLocale, useTranslate } from '../../lib/i18n.js';

/**
 * How close to the top the reader has to get before the previous page is
 * requested — about a screenful, so the history is usually already there when
 * they arrive at the seam.
 */
const OLDER_THRESHOLD_PX = 240;

/**
 * The conversation.
 *
 * Announced as a polite live region so a screen reader user hears replies
 * without losing their place (design-brief §7). Auto-scroll only follows when
 * the reader is already at the bottom — yanking the view while someone reads
 * back through history is worse than a missed scroll.
 *
 * It also grows *upward*: `onLoadOlder` fetches the page before the oldest
 * event loaded (NFR-P5), which arrives as a prepend. A prepend is the one thing
 * a scroll container handles badly on its own — the browser keeps `scrollTop`,
 * so inserting a screenful above the reader throws them a screenful further
 * down the conversation than where they were reading. So the geometry from
 * before the insert is what the new `scrollTop` is computed from, and the
 * correction is applied in a layout effect, before the browser paints, so the
 * jump is never visible.
 */
export function Transcript({
  chatId,
  events,
  loading,
  currentAgentId,
  hasOlder = false,
  isLoadingOlder = false,
  onLoadOlder,
}: {
  /** Which conversation this is — the one thing that means "start over". */
  chatId: string;
  events: ChatEvent[];
  loading: boolean;
  currentAgentId: string | null;
  /** More history exists above the oldest event loaded. */
  hasOlder?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlder?: () => void;
}): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  const t = useTranslate();

  /**
   * The scroll geometry to measure the next prepend against.
   *
   * Frozen while a page is in flight, deliberately: the loading skeleton is
   * itself in the scroll flow, so a measurement taken while it is on screen
   * would be inflated by exactly the height that disappears again in the same
   * commit the events arrive in — and the correction would be off by it.
   */
  const anchor = useRef({ scrollTop: 0, scrollHeight: 0 });
  /** The head of the last rendered list, which is how a prepend is recognised. */
  const firstEventId = useRef<string | null>(null);
  const shownChatId = useRef<string | null>(null);

  /** Takes the reading that the next prepend will be measured against. */
  const remember = (node: HTMLDivElement): void => {
    if (isLoadingOlder) return;
    anchor.current = { scrollTop: node.scrollTop, scrollHeight: node.scrollHeight };
  };

  useLayoutEffect(() => {
    const previousChatId = shownChatId.current;
    shownChatId.current = chatId;
    const previousFirst = firstEventId.current;
    firstEventId.current = events[0]?.id ?? null;

    // Opening another conversation starts at its newest message, whatever the
    // reader had scrolled to in the one before it. Asked of `chatId` rather
    // than inferred from the events, because within one conversation the head
    // can change without any of it being new: a refetch re-cuts the chain from
    // the current tail, and guessing "different head, different chat" would
    // throw a reader who is deep in the history down to the bottom.
    const switched = chatId !== previousChatId;
    if (switched) pinnedToBottom.current = true;

    const node = containerRef.current;
    if (!node) return;

    if (!switched && previousFirst !== null && previousFirst !== firstEventId.current) {
      // The list grew (or moved) at the top. Whatever the difference in height
      // is, it is above the reader, so adding it to `scrollTop` leaves the line
      // they were on exactly where it was.
      node.scrollTop = anchor.current.scrollTop + (node.scrollHeight - anchor.current.scrollHeight);
      anchor.current = { scrollTop: node.scrollTop, scrollHeight: node.scrollHeight };
      return;
    }

    if (pinnedToBottom.current) node.scrollTop = node.scrollHeight;
    remember(node);
    // `isLoadingOlder` belongs in the dependencies as well as in `remember`:
    // the commit that raises the skeleton is precisely the one this has to see,
    // because it is the reading it must decline to take.
  }, [chatId, events, isLoadingOlder]);

  const handleScroll = (): void => {
    const node = containerRef.current;
    if (!node) return;
    // 32px of slack: exact equality never holds with fractional scroll heights.
    pinnedToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 32;
    remember(node);

    // Asking twice costs nothing: `usePagedQuery.fetchNext` is single-flight and
    // a no-op once the thread has no more history behind it.
    if (hasOlder && !isLoadingOlder && node.scrollTop < OLDER_THRESHOLD_PX) onLoadOlder?.();
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
      aria-label={t('inbox.transcript.ariaLabel')}
      className="flex flex-1 flex-col gap-3 overflow-y-auto p-5"
    >
      {isLoadingOlder && (
        <div className="flex shrink-0 flex-col gap-3" data-testid="transcript-older-loading">
          {/* Announced through the log's own live region rather than silently:
            the reader asked for history by scrolling, and a blank pause is
            indistinguishable from having reached the start of the thread. */}
          <span className="sr-only">{t('inbox.transcript.loadingOlder')}</span>
          <div aria-hidden="true" className="h-10 w-2/3 animate-pulse rounded-lg bg-inset" />
          <div
            aria-hidden="true"
            className="h-10 w-1/2 animate-pulse self-end rounded-lg bg-inset"
          />
        </div>
      )}
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
  const t = useTranslate();

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
              {t('inbox.transcript.noteLabel')}
            </span>
          )}
          <div
            className={`rounded-lg px-3 py-2 text-sm ${bubbleClasses({ isNote, isMine, event })} ${
              pending ? 'opacity-60' : ''
            }`}
          >
            {/* React escapes this; there is no dangerouslySetInnerHTML anywhere. */}
            {event.text && <span className="whitespace-pre-wrap break-words">{event.text}</span>}
            {event.attachment_url && (
              <div className={event.text ? 'mt-2' : ''}>
                <AttachmentView url={event.attachment_url} />
              </div>
            )}
          </div>
          <span className="tabular text-2xs text-content-tertiary">
            {pending ? t('inbox.transcript.sending') : formatTime(event.created_at)}
            {event.author_type === 'bot' && ` · ${t('inbox.transcript.aiSuffix')}`}
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

/**
 * Explicit locale, not `undefined` (the browser's own) — the agent's chosen
 * language, not the machine's, is what should decide how a timestamp reads
 * (NFR-I18N2; the same runtime-locale leak `format.ts` binds against).
 */
function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(getLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
}
