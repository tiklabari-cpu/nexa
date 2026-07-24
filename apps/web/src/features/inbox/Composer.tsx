import {
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useSendMessage } from './useInbox.js';
import { useApiClient } from '../../lib/auth-store.js';
import { uploadAttachment, type UploadedAttachment } from './uploadAttachment.js';
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
 *
 * A file can ride along, or go on its own (FR-MOD-02.3.5): the send is enabled
 * once there is text *or* an attachment. Client-side type/size limits would only
 * be a courtesy — the licence's real file-sharing rules are enforced by
 * `/uploads`, so a refusal surfaces from there rather than being second-guessed
 * here.
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
  const [attachment, setAttachment] = useState<UploadedAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const send = useSendMessage(chatId);
  const api = useApiClient();

  const canned = useCannedResponses();
  const matches = useMatchingResponses(canned.data?.items, shortcut?.query ?? null);
  const pickerOpen = shortcut !== null && matches.length > 0;

  const isNote = mode === 'agents';
  const canSend =
    (text.trim().length > 0 || attachment !== null) && !disabled && !send.isPending && !uploading;

  const submit = (): void => {
    if (!canSend) return;
    send.mutate({
      text: text.trim(),
      recipients: mode,
      ...(attachment ? { attachmentUrl: attachment.fileUrl } : {}),
    });
    setText('');
    setShortcut(null);
    setAttachment(null);
    setUploadError(null);
  };

  const onPickFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    event.target.value = '';
    if (!file) return;

    setUploadError(null);
    setUploading(true);
    try {
      setAttachment(await uploadAttachment(api, file));
    } catch (error) {
      // The message from `/uploads` is already user-facing ("Files of type … are
      // not allowed."), so surface it rather than a generic line.
      setUploadError(error instanceof Error ? error.message : 'Could not attach that file.');
    } finally {
      setUploading(false);
    }
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

      {attachment && (
        <div
          data-testid="composer-attachment"
          className="mb-2 flex items-center gap-2 rounded-md border border-border bg-inset px-2 py-1.5 text-2xs"
        >
          <PaperclipIcon />
          <span className="truncate text-content-secondary">{attachment.name}</span>
          <button
            type="button"
            aria-label="Remove attachment"
            onClick={() => setAttachment(null)}
            className="ml-auto rounded-sm px-1 text-content-tertiary hover:bg-surface-2 hover:text-content"
          >
            ×
          </button>
        </div>
      )}

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

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept="image/*,application/pdf"
        onChange={(event) => void onPickFile(event)}
      />

      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Attach a file"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="rounded-md p-1.5 text-content-secondary transition-colors hover:bg-surface-2 hover:text-content disabled:opacity-50"
          >
            <PaperclipIcon />
          </button>
          <span className="text-2xs text-content-tertiary">
            {uploading ? 'Uploading…' : 'Enter to send · Shift+Enter for a new line'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {uploadError && (
            <span role="alert" className="text-2xs text-danger">
              {uploadError}
            </span>
          )}
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

function PaperclipIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
