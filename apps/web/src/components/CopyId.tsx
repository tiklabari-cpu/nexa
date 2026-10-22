/**
 * One identifier, shown the way a person says it aloud and copied in one click
 * (ID-05 · tm 329).
 *
 * "C2 numaralı sohbete bak" only works if the number is on the screen and goes
 * onto the clipboard exactly as it is: the 10 characters, nothing around them —
 * no label, no link, no space. So the button copies `value` alone (the link to
 * the conversation is its own button in the thread header), and `value` is what
 * the API sent: a number is never derived in the browser.
 *
 * Reading it: monospace, single-spaced and selectable, so it can be read off the
 * screen and found with Ctrl+F. A screen reader gets the same number one
 * character at a time (a spaced copy in an `sr-only` span; the visible one is
 * `aria-hidden`) — "TJ1H8CFKRV" read as a word is not a number anybody can
 * write down.
 *
 * Feedback is "Copied" for 1.5 s, in a live region. When the browser refuses
 * the clipboard (no permission, an insecure origin), the number is selected
 * instead, so Ctrl+C is one keystroke away rather than a dead button.
 *
 * A number that is also a way in (`href`: the ticket's source conversation) is drawn
 * as a link — its name to a screen reader is then the number itself, as it was
 * before it could be copied.
 *
 * The name of the number is the ids catalogue's
 * (ID-01, K1 = A); `kind` picks which — `thread` is the code's `chat_id` (the
 * member's day), `chat` the code's `thread_id` (one connection).
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslate } from '../lib/i18n.js';

export type CopyIdKind = 'thread' | 'chat';

/** How long "Copied" stays up. */
const FEEDBACK_MS = 1_500;

export function CopyId({
  kind,
  value,
  showLabel = true,
  href,
  className = '',
}: {
  kind: CopyIdKind;
  /** The number as the API sent it. */
  value: string;
  /** Draw the number's name beside it; false where a heading already says it. */
  showLabel?: boolean;
  /** Draw the number as a link to this in-app address. */
  href?: string;
  className?: string;
}): ReactElement {
  const t = useTranslate();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  const text = useRef<HTMLElement | null>(null);
  const label = t(`ids.${kind}.label`);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const selectNumber = (): void => {
    const node = text.current;
    const selection = window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const copy = (): void => {
    const done = (): void => {
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), FEEDBACK_MS);
    };
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard?.writeText) {
      selectNumber();
      return;
    }
    clipboard.writeText(value).then(done, selectNumber);
  };

  return (
    <span
      title={`${label} — ${t(`ids.${kind}.hint`)}`}
      className={`inline-flex items-center gap-1 ${className}`}
    >
      {showLabel && <span className="text-content-tertiary">{label}</span>}
      {href ? (
        <Link
          to={href}
          ref={(node) => {
            text.current = node;
          }}
          className="select-all font-mono tracking-normal text-content-brand underline underline-offset-2"
        >
          {value}
        </Link>
      ) : (
        <>
          <span className="sr-only">{value.split('').join(' ')}</span>
          <code
            ref={text}
            aria-hidden="true"
            className="select-all font-mono tracking-normal text-content"
          >
            {value}
          </code>
        </>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label={t('common.copyId.copy', { label })}
        className="inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-content-tertiary hover:bg-surface-2 hover:text-content"
      >
        <span aria-hidden="true">{copied ? '✓' : '⧉'}</span>
      </button>
      <span role="status" className={copied ? 'text-success' : 'sr-only'}>
        {copied ? t('common.copyId.copied') : ''}
      </span>
    </span>
  );
}
