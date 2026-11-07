import type { ReactElement } from 'react';
import { hasVisibleDraft, useTypingStore } from './typing.js';
import { useTranslate } from '../../lib/i18n.js';

/**
 * The visitor's unsent draft, between the transcript and the composer
 * (FR-MOD-02.9 / 11.8 · tm 417.6).
 *
 * Two elements, on purpose:
 * - a polite live region that is always in the DOM while a chat is open, so a
 *   screen reader has a region to watch before the first keystroke. It says
 *   "{name} is typing…" once per draft and empties when the draft ends — never
 *   the draft itself, and nothing on the 6 s idle or on typing again, so a
 *   screen-reader user is not read every letter;
 * - the visible strip, outside the live region: dots and "{name}: “draft”"
 *   while keys arrive, then — no dots, faded — "{name} has not sent this yet:
 *   “draft”" until the draft is cleared, sent, closed, taken away, or 30 s pass
 *   with no update.
 *
 * The draft is plain text: no links, no markdown, no HTML, no tooltip. With a
 * draft up the strip holds a fixed height (3 lines, 2 on a phone) and clamps to
 * it, so a draft growing a line does not push the transcript about.
 */
export function TypingIndicator({
  chatId,
  customerName,
  compact = false,
}: {
  chatId: string;
  customerName: string | null;
  /** The phone layout: two lines instead of three. */
  compact?: boolean;
}): ReactElement {
  const typing = useTypingStore((state) => state.byChat[chatId]);
  const t = useTranslate();
  const visible = hasVisibleDraft(typing);
  const who = customerName ?? t('inbox.typing.visitorFallback');

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        data-testid="typing-indicator-status"
        className="sr-only"
      >
        {visible ? t('inbox.typing.statusTyping', { name: who }) : ''}
      </div>
      {visible && (
        <div
          data-testid="typing-indicator"
          className="flex shrink-0 items-start gap-2 overflow-hidden border-t border-border bg-surface px-4 py-1.5 text-xs text-content-secondary"
        >
          {typing.isTyping && <TypingDots />}
          {typing.text !== null ? (
            <p
              className={`min-w-0 flex-1 overflow-hidden whitespace-pre-wrap break-words ${
                compact ? 'line-clamp-2 min-h-[2.25rem]' : 'line-clamp-3 min-h-[3.375rem]'
              } ${typing.isTyping ? '' : 'italic text-content-tertiary'}`}
            >
              {typing.isTyping ? (
                <span className="font-medium">{t('inbox.typing.typingLabel', { name: who })}</span>
              ) : (
                <span data-testid="typing-preview-draft">
                  {t('inbox.typing.visitorDraftLabel', { name: who })}:
                </span>
              )}{' '}
              <span
                data-testid="typing-preview-text"
                className={typing.isTyping ? 'italic text-content-tertiary' : ''}
              >
                “{typing.text}”
              </span>
            </p>
          ) : (
            <span className="min-w-0 truncate">
              <span className="font-medium">{who}</span> {t('inbox.typing.suffix')}
            </span>
          )}
        </div>
      )}
    </>
  );
}

/** Three dots that pulse in sequence; static under reduced-motion (design-brief §7). */
function TypingDots(): ReactElement {
  return (
    <span aria-hidden="true" className="flex h-[1.125rem] shrink-0 items-center gap-0.5">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 rounded-full bg-content-tertiary motion-safe:animate-pulse"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
