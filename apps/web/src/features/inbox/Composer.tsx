import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { eventsKey, useSendMessage } from './useInbox.js';
import { useTypingStore } from './typing.js';
import { useCopilotDraftStore } from './copilotDraft.js';
import { useApiClient } from '../../lib/auth-store.js';
import { uploadAttachment, type UploadedAttachment } from './uploadAttachment.js';
import { replySuggestions, type SuggestionTurn } from './replySuggestions.js';
import type { ChatEvent } from './types.js';
import {
  activeShortcutQuery,
  applyShortcut,
  useCannedResponses,
  useMatchingResponses,
} from './useCannedResponses.js';
import { useTranslate } from '../../lib/i18n.js';

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
  // Reply Suggestions (FR-MOD-02.3.2): `null` closed, an array of chips open.
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const send = useSendMessage(chatId);
  const api = useApiClient();
  const queryClient = useQueryClient();
  const t = useTranslate();

  const canned = useCannedResponses();
  const matches = useMatchingResponses(canned.data?.items, shortcut?.query ?? null);
  const pickerOpen = shortcut !== null && matches.length > 0;

  const isNote = mode === 'agents';
  const canSend =
    (text.trim().length > 0 || attachment !== null) && !disabled && !send.isPending && !uploading;

  // Live typing preview (FR-MOD-02.9). One "start" per burst, then a trailing
  // "stop" a few seconds after the last keystroke — both edges matter so the
  // visitor's "…is typing" turns on promptly and clears on its own if the agent
  // walks away mid-sentence. Refs, not state: this must never re-render the
  // composer on every keystroke.
  const typingActive = useRef(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTyping = useCallback(() => {
    if (stopTimer.current) {
      clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }
    if (typingActive.current) {
      typingActive.current = false;
      useTypingStore.getState().emit(chatId, false);
    }
  }, [chatId]);

  const signalTyping = (): void => {
    if (!typingActive.current) {
      typingActive.current = true;
      useTypingStore.getState().emit(chatId, true);
    }
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(stopTyping, 3_000);
  };

  // Emit a final "stop" when the open chat changes or the composer unmounts —
  // otherwise the previous visitor is left with a frozen "…is typing".
  useEffect(() => stopTyping, [stopTyping]);

  // A suggestion handed over from Copilot (FR-MOD-12.3). It fills the reply —
  // always a customer-facing reply, never a note — and the agent edits and
  // sends it. Consumed on arrival so the same draft is not re-applied on the
  // next render.
  const copilotDraft = useCopilotDraftStore((state) => state.byChat[chatId]);
  useEffect(() => {
    if (copilotDraft === undefined) return;
    setText(copilotDraft);
    setMode('all');
    useCopilotDraftStore.getState().clear(chatId);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [copilotDraft, chatId]);

  const submit = (): void => {
    if (!canSend) return;
    stopTyping();
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
      // i18n-ignore: dynamic server validation text, shown as-is by design (see above).
      setUploadError(error instanceof Error ? error.message : t('inbox.composer.attachError'));
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

  // Reply Suggestions (FR-MOD-02.3.2). The agent asks for them by pressing Space
  // in an empty reply field; they are drawn from the transcript already in cache,
  // so no fetch and no round-trip stand between the keystroke and the chips.
  const openSuggestions = (): void => {
    const cached = queryClient.getQueryData<{ items: ChatEvent[] }>(eventsKey(chatId));
    const turns: SuggestionTurn[] = (cached?.items ?? [])
      .filter(
        (event) =>
          event.type === 'message' &&
          event.recipients === 'all' &&
          (event.text ?? '').trim().length > 0,
      )
      .map((event) => ({
        role: event.author_type === 'customer' ? 'customer' : 'agent',
        text: event.text ?? '',
      }));
    setSuggestions(replySuggestions(turns));
  };

  // A chip fills the reply field with editable text — never a note — and the
  // agent edits and sends it, exactly like a Copilot draft. The caret lands at
  // the end so the agent can keep typing.
  const applySuggestion = (suggestion: string): void => {
    setText(suggestion);
    setMode('all');
    setSuggestions(null);
    setShortcut(null);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(suggestion.length, suggestion.length);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Space in an *empty* reply field opens Reply Suggestions rather than typing a
    // space — and only when empty, so it never fires mid-sentence (v2-01 §307).
    // Escape closes them again, so the shortcut is always reversible (v2-01 §276).
    if (event.key === ' ' && text.length === 0 && mode === 'all' && !pickerOpen) {
      event.preventDefault();
      if (suggestions === null) openSuggestions();
      return;
    }
    if (event.key === 'Escape' && suggestions !== null && !pickerOpen) {
      event.preventDefault();
      setSuggestions(null);
      return;
    }

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
        {t('inbox.composer.disabledNotice')}
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
        <div
          role="radiogroup"
          aria-label={t('inbox.composer.modeAriaLabel')}
          className="flex gap-1"
        >
          {(
            [
              { id: 'all', label: t('inbox.composer.mode.reply') },
              { id: 'agents', label: t('inbox.composer.mode.note') },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={mode === option.id}
              onClick={() => {
                setMode(option.id);
                // Switching to a note is not customer-visible — retract any
                // "agent is typing" the reply draft was broadcasting, and close
                // Reply Suggestions (they only make sense for a customer reply).
                if (option.id === 'agents') {
                  stopTyping();
                  setSuggestions(null);
                }
              }}
              // The selected note tab is the one place `--note` is a *fill*;
              // everywhere else it is a foreground (`text-note`, `border-note`),
              // so it inverts with the theme — dark olive on light, pale amber on
              // dark. Literal white can only sit on one of those: it measured
              // 1.47:1 against the dark `#ffce73`, where this 12px label needs
              // 4.5:1. `text-content-inverse` is the ink that flips with the
              // surface, clearing AA in both themes (5.60:1 light, 12.92:1 dark —
              // `tokens.test.ts` re-derives both from `tokens.css`). The brand
              // fill beside it keeps literal white: `--brand-500` is one colour in
              // both themes and the ramp is chosen to carry white.
              className={`rounded-sm px-2 py-1 text-2xs font-medium transition-colors ${
                mode === option.id
                  ? option.id === 'agents'
                    ? 'bg-note text-content-inverse'
                    : 'bg-brand-500 text-white'
                  : 'text-content-secondary hover:bg-surface-2'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {isNote && <span className="text-2xs text-note">{t('inbox.composer.noteHint')}</span>}
      </div>

      <label className="sr-only" htmlFor="composer-input">
        {isNote ? t('inbox.composer.mode.note') : t('inbox.composer.replyLabel')}
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
            aria-label={t('inbox.composer.attachment.remove')}
            onClick={() => setAttachment(null)}
            className="ml-auto rounded-sm px-1 text-content-tertiary hover:bg-surface-2 hover:text-content"
          >
            ×
          </button>
        </div>
      )}

      {suggestions !== null && !isNote && (
        <div
          role="group"
          aria-label={t('inbox.composer.suggestions.ariaLabel')}
          className="mb-2 flex flex-wrap items-start gap-1.5"
        >
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => applySuggestion(suggestion)}
              className="max-w-full truncate rounded-full border border-border bg-inset px-3 py-1 text-left text-2xs text-content-secondary transition-colors hover:bg-brand-100 hover:text-content dark:hover:bg-brand-950"
            >
              {suggestion}
            </button>
          ))}
          <button
            type="button"
            aria-label={t('inbox.composer.suggestions.dismiss')}
            onClick={() => {
              setSuggestions(null);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            className="rounded-full px-2 py-1 text-2xs text-content-tertiary hover:text-content"
          >
            ×
          </button>
        </div>
      )}

      <div className="relative">
        {pickerOpen && (
          <ul
            role="listbox"
            aria-label={t('inbox.composer.picker.ariaLabel')}
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
            const value = event.target.value;
            setText(value);
            syncShortcut(value, event.target.selectionStart);
            // The suggestion chips are for the empty field; once the agent types,
            // they no longer fit — retract them.
            if (value.length > 0 && suggestions !== null) setSuggestions(null);
            // A reply is shown to the visitor; an internal note is not, so only a
            // reply-in-progress broadcasts "the agent is typing".
            if (value.trim() && mode === 'all') signalTyping();
            else stopTyping();
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
          placeholder={
            isNote ? t('inbox.composer.placeholder.note') : t('inbox.composer.placeholder.reply')
          }
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
            aria-label={t('inbox.composer.attachFile')}
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="rounded-md p-1.5 text-content-secondary transition-colors hover:bg-surface-2 hover:text-content disabled:opacity-50"
          >
            <PaperclipIcon />
          </button>
          <span className="text-2xs text-content-tertiary">
            {uploading ? t('inbox.composer.uploading') : t('inbox.composer.hint')}
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
              {t('inbox.composer.sendError')}
            </span>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            className="rounded-md bg-brand-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
          >
            {send.isPending ? t('inbox.composer.send.pending') : t('inbox.composer.send.cta')}
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
