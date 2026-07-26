import type { ReactElement } from 'react';
import { useTypingStore } from './typing.js';

/**
 * "The visitor is typing…", with a preview of their in-progress message when a
 * sneak-peek carried one (FR-MOD-02.9 / 11.8).
 *
 * Sits unconditionally above the composer and renders nothing when nobody is
 * typing, so the layout does not jump as it appears and disappears. Announced
 * politely (`aria-live`) rather than assertively — a screen-reader user should
 * hear it, but not have their current reading interrupted by every keystroke.
 */
export function TypingIndicator({
  chatId,
  customerName,
}: {
  chatId: string;
  customerName: string | null;
}): ReactElement | null {
  const typing = useTypingStore((state) => state.byChat[chatId]);
  if (!typing?.isTyping) return null;

  const who = customerName ?? 'Visitor';
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="typing-indicator"
      className="flex shrink-0 items-center gap-2 border-t border-border bg-surface px-4 py-1.5 text-xs text-content-secondary"
    >
      <TypingDots />
      {typing.text ? (
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 font-medium">{who}</span>
          <span className="truncate italic text-content-tertiary">“{typing.text}”</span>
        </span>
      ) : (
        <span>
          <span className="font-medium">{who}</span> is typing…
        </span>
      )}
    </div>
  );
}

/** Three dots that pulse in sequence; static under reduced-motion (design-brief §7). */
function TypingDots(): ReactElement {
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center gap-0.5">
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
