import { useState, type KeyboardEvent, type ReactElement } from 'react';
import { useSendMessage } from './useInbox.js';

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
  const send = useSendMessage(chatId);

  const isNote = mode === 'agents';
  const canSend = text.trim().length > 0 && !disabled && !send.isPending;

  const submit = (): void => {
    if (!canSend) return;
    send.mutate({ text: text.trim(), recipients: mode });
    setText('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
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
      <textarea
        id="composer-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        maxLength={10_000}
        placeholder={isNote ? 'Add a note for your team…' : 'Type your reply…'}
        className="w-full resize-none rounded-md border border-border bg-inset px-3 py-2 text-sm outline-none placeholder:text-content-tertiary"
      />

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
