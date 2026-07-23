import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useSendMessage } from './useInbox.js';
import {
  activeShortcutQuery,
  applyShortcut,
  useCannedResponses,
  useMatchingResponses,
} from './useCannedResponses.js';

/**
 * Message composer.
 *
 * Reply and internal note are one control with two modes rather than two
 * inputs. Note mode is visually distinct (amber, FR-MOD-02.3.4) because sending
 * an internal note to the customer by mistake is the expensive error here, and
 * the interface should make the current mode impossible to miss.
 */
export function Composer({
  chatId,
  disabled,
}: {
  chatId: string;
  disabled: boolean;
}): ReactElement {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'all' | 'agents'>('all');
  const [shortcut, setShortcut] = useState<{ query: string; from: number } | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const send = useSendMessage(chatId);

  const canned = useCannedResponses();
  const matches = useMatchingResponses(canned.data?.items, shortcut?.query ?? null);
  const pickerOpen = shortcut !== null && matches.length > 0;

  const isNote = mode === 'agents';
  const canSend = text.trim().length > 0 && !disabled && !send.isPending;

  const submit = (): void => {
    if (!canSend) return;
    send.mutate({ text: text.trim(), recipients: mode });
    setText('');
    setShortcut(null);
  };

  const syncShortcut = (value: string, caret: number): void => {
    const next = activeShortcutQuery(value, caret);
    setShortcut(next);
    setHighlighted(0);
  };

  const insert = (replacement: string): void => {
    const input = inputRef.current;
    if (!input || !shortcut) return;

    const result = applyShortcut(text, input.selectionStart, shortcut.from, replacement);
    setText(result.text);
    setShortcut(null);

    // The caret has to land after the inserted text, which React will not do on
    // its own — a controlled textarea puts it at the end of the whole value.
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(result.caret, result.caret);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (pickerOpen) {
      // While the picker is open these keys belong to it. Enter in particular:
      // sending the raw `#shipping` the agent was still choosing would be worse
      // than any keyboard inconsistency.
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlighted((i) => (i + 1) % matches.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlighted((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const chosen = matches[highlighted];
        if (chosen) insert(chosen.text);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setShortcut(null);
        return;
      }
    }

    // Enter sends, Shift+Enter breaks the line — the convention every chat tool
    // shares, and breaking it costs a message on the very first use.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  if (disabled) {
    return (
      <div className="shrink-0 border-t border-border bg-surface px-4 py-4 text-center text-sm text-content-secondary">
        This conversation is archived. Reopen it to reply.
      </div>
    );
  }

  return (
    <div
      className={`shrink-0 border-t border-border px-4 py-3 transition-colors ${
        isNote ? 'bg-[var(--bubble-note-bg)]' : 'bg-surface'
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <div role="radiogroup" aria-label="Message type" className="flex gap-1">
          {(
            [
              { id: 'all', label: 'Reply' },
              { id: 'agents', label: 'Internal note' },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={mode === option.id}
              onClick={() => setMode(option.id)}
              className={`rounded-sm px-2 py-1 text-2xs font-medium transition-colors ${
                mode === option.id
                  ? option.id === 'agents'
                    ? 'bg-note text-white'
                    : 'bg-brand-500 text-white'
                  : 'text-content-secondary hover:bg-surface-2'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {isNote && <span className="text-2xs text-note">Only your team will see this.</span>}
      </div>

      <label className="sr-only" htmlFor="composer-input">
        {isNote ? 'Internal note' : 'Reply to the customer'}
      </label>

      <div className="relative">
        {pickerOpen && (
          <ul
            role="listbox"
            aria-label="Saved replies"
            // Above the input: the composer sits at the bottom of the window, so
            // a list opening downwards would fall off screen.
            className="absolute bottom-full left-0 z-10 mb-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-md"
          >
            {matches.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  onMouseEnter={() => setHighlighted(index)}
                  // `onMouseDown` rather than `onClick`: a click would blur the
                  // textarea first, losing the caret the insertion depends on.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insert(item.text);
                  }}
                  className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    index === highlighted ? 'bg-brand-100 dark:bg-brand-950' : 'hover:bg-surface-2'
                  }`}
                >
                  <code className="shrink-0 rounded-sm bg-inset px-1.5 py-0.5 font-mono text-2xs">
                    #{item.shortcut}
                  </code>
                  <span className="truncate text-content-secondary">{item.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <textarea
          ref={inputRef}
          id="composer-input"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            syncShortcut(event.target.value, event.target.selectionStart);
          }}
          onKeyUp={(event) => {
            // Arrow keys and clicks move the caret without changing the value,
            // and the picker has to follow it.
            if (!pickerOpen) return;
            syncShortcut(event.currentTarget.value, event.currentTarget.selectionStart);
          }}
          onBlur={() => setShortcut(null)}
          onKeyDown={onKeyDown}
          rows={3}
          maxLength={10_000}
          placeholder={isNote ? 'Add a note for your team…' : 'Type your reply…'}
          className="w-full resize-none rounded-md border border-border bg-inset px-3 py-2 text-sm outline-none placeholder:text-content-tertiary"
        />
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-2xs text-content-tertiary">
          Enter to send · Shift+Enter for a new line
        </span>
        <div className="flex items-center gap-2">
          {send.isError && (
            <span role="alert" className="text-2xs text-danger">
              Not sent — try again.
            </span>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            className="rounded-md bg-brand-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
          >
            {send.isPending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
