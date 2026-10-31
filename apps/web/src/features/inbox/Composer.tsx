import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  eventsKey,
  flattenTranscript,
  newIdempotencyKey,
  useChat,
  useChatAction,
  useSendMessage,
  type TranscriptCache,
} from './useInbox.js';
import { useTypingStore } from './typing.js';
import { useCopilotDraftStore } from './copilotDraft.js';
import {
  DRAFT_WRITE_DELAY_MS,
  discardDraft,
  draftStorageKey,
  loadDraft,
  saveDraft,
  useRetiredDraftStore,
  type DraftMode,
  type DraftScope,
} from './composerDrafts.js';
import { AI_DAILY_CAP_MESSAGE_KEY } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import {
  uploadAttachment,
  uploadFailureMessage,
  type UploadedAttachment,
} from './uploadAttachment.js';
import {
  replySuggestionIds,
  withCopilotDraft,
  type ReplyChip,
  type ReplySuggestionId,
  type SuggestionTurn,
} from './replySuggestions.js';
import { useCopilotReply } from './useCopilot.js';
import {
  activeShortcutQuery,
  insertCannedReply,
  useCannedResponses,
  useMatchingResponses,
  type CannedResponse,
} from './useCannedResponses.js';
import { CannedPicker, PICKER_KEYS } from './CannedPicker.js';
import { cannedValuesOf } from './cannedValues.js';
import { useCustomerContext } from './useCustomerContext.js';
import { EMOJI_CATEGORIES, insertAtCaret } from './emoji.js';
import { applyBulletPrefix, wrapSelection } from './richText.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import { useTranslate } from '../../lib/i18n.js';

/**
 * How long Reply Suggestions waits for Copilot before settling for the template
 * chips (FR-MOD-02.3.2).
 *
 * A budget, not a network timeout: the request is left to finish on its own —
 * it may still be recorded as an assist server-side — but past this point its
 * answer is no longer allowed to rearrange a row the agent has been reading.
 * Three seconds is roughly a glance; longer and the chips would move under the
 * cursor, which is worse than not having the extra one.
 */
const COPILOT_SUGGESTION_TIMEOUT_MS = 3_000;

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
 * here. The one thing worth pre-empting is the button itself: when the licence
 * has attachments switched off entirely, showing it only to refuse the pick a
 * moment later is a worse conversation than not offering it — so it is hidden
 * rather than disabled (FR-MOD-08.9.4).
 */
export function Composer({
  chatId,
  disabled,
  disabledNotice,
  tags = [],
}: {
  chatId: string;
  disabled: boolean;
  /**
   * Why the composer is off, when it is not because the chat is archived — the
   * default sentence says "reopen it", which is wrong advice for a thread that
   * simply failed to load (tm 259.5).
   */
  disabledNotice?: string;
  /**
   * The chat's current tags (FR-MOD-02.3.5's fifth composer tool) — the same
   * array `DetailsPanel` reads off `chat.thread.tags`, so a tag added here
   * shows there without a second fetch or a second tag vocabulary.
   */
  tags?: string[];
}): ReactElement {
  // Whose drafts these are (tm 277.2). Primitives, so the scope object is as
  // stable as the signed-in account.
  const licenseId = useAuth((s) => s.agent?.license_id ?? null);
  const accountId = useAuth((s) => s.agent?.account_id ?? null);
  const scope = useMemo<DraftScope | null>(
    () => (licenseId && accountId ? { licenseId, accountId } : null),
    [licenseId, accountId],
  );
  // The draft this chat was left with, read once at mount — the composer is
  // keyed on the chat (tm 277.1), so every chat switch is a fresh mount. A chat
  // that cannot be answered gets none, and an attachment is never restored
  // (see `composerDrafts.ts`).
  const [restored] = useState(() => (scope && !disabled ? loadDraft(scope, chatId) : null));
  const [text, setText] = useState(restored?.text ?? '');
  const [mode, setMode] = useState<DraftMode>(restored?.mode ?? 'all');
  // A Copilot draft waiting for the agent to say whether it may replace what
  // they have already written.
  const [pendingCopilot, setPendingCopilot] = useState<string | null>(null);
  const [shortcut, setShortcut] = useState<{ query: string; from: number } | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const [attachment, setAttachment] = useState<UploadedAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Reply Suggestions (FR-MOD-02.3.2): `null` closed, an array of chips open.
  const [suggestions, setSuggestions] = useState<ReplyChip[] | null>(null);
  // Whether Copilot's own draft is still on its way. The template chips are
  // already on screen while this is true — it is a row that may still grow, not
  // a spinner standing in for an empty one.
  const [copilotPending, setCopilotPending] = useState(false);
  // Copilot answered with no draft because today's AI allowance is used up
  // (tm 257.20) — said in the row, so the agent does not read the missing chip
  // as "nothing in the knowledge base".
  const [copilotCapped, setCopilotCapped] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const send = useSendMessage(chatId);
  // The same Copilot draft endpoint the Copilot panel calls (FR-MOD-12.3) —
  // Reply Suggestions is a faster door onto it, not a second AI path.
  const copilotReply = useCopilotReply(chatId);
  const api = useApiClient();
  const queryClient = useQueryClient();
  const t = useTranslate();

  const canned = useCannedResponses();
  const matches = useMatchingResponses(canned.data?.items, shortcut?.query ?? null);
  const pickerOpen = shortcut !== null && matches.length > 0;

  // What a saved reply's `{{variables}}` are filled with when it is inserted
  // (IN-06): the player card (IN-02, the same cache the Details panel reads),
  // the chat and its connection, the signed-in agent and the workspace name.
  const chatQuery = useChat(chatId);
  const customerContext = useCustomerContext(chatId);
  const agent = useAuth((s) => s.agent);
  const cannedValues = useMemo(
    () =>
      cannedValuesOf({
        customer: customerContext.context?.customer ?? null,
        agent,
        chatId,
        threadId: chatQuery.data?.thread?.id ?? null,
        companyName: canned.data?.company_name ?? null,
      }),
    [customerContext.context, agent, chatId, chatQuery.data, canned.data],
  );
  const cannedFallback = canned.data?.fallback_text || t('inbox.composer.picker.fallbackDefault');

  // File sharing (FR-MOD-08.9.4): `GET /settings/security` carries the full
  // rule set but is admin-only (`access_rules:ro`); this is the one bit every
  // agent role can read, so the attach button can be hidden before a pick
  // rather than only refused after one. Defaults to shown while loading and
  // on a fetch error — the same fail-open default the endpoint itself falls
  // back to — so a slow or failed read never hides a button most licences
  // actually have on.
  const fileSharing = useQuery({
    queryKey: ['settings', 'file-sharing'],
    queryFn: () => api.get<{ file_sharing_enabled: boolean }>('/uploads-policy'),
  });
  const fileSharingEnabled = fileSharing.data?.file_sharing_enabled ?? true;

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
  //
  // Into an empty field it simply fills. Over words the agent has already
  // written it asks first (tm 277.2): those words may be a half-written note,
  // and Copilot's arrival is not something the agent typed.
  const copilotDraft = useCopilotDraftStore((state) => state.byChat[chatId]);
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  }, [text]);

  const applyCopilotDraft = (draft: string): void => {
    setText(draft);
    setMode('all');
    setPendingCopilot(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  useEffect(() => {
    if (copilotDraft === undefined) return;
    useCopilotDraftStore.getState().clear(chatId);
    if (textRef.current.trim() === '' || textRef.current === copilotDraft) {
      setText(copilotDraft);
      setMode('all');
      setPendingCopilot(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setPendingCopilot(copilotDraft);
    }
  }, [copilotDraft, chatId]);

  // Draft persistence (tm 277.2). Written ~300 ms after the last keystroke and
  // flushed at once when the composer goes away, so a quick switch to another
  // chat never loses the tail of a sentence. `savedRef` is what storage holds,
  // so merely opening a chat does not renew its 24 hours.
  const savedRef = useRef<{ text: string; mode: DraftMode }>({
    text: restored?.text ?? '',
    mode: restored?.mode ?? 'all',
  });
  const pendingSave = useRef<{ text: string; mode: DraftMode } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelSave = useCallback((): void => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pendingSave.current = null;
  }, []);

  const flushSave = useCallback((): void => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pending = pendingSave.current;
    pendingSave.current = null;
    if (!pending || !scope) return;
    saveDraft(scope, chatId, pending);
    savedRef.current = pending;
  }, [scope, chatId]);

  useEffect(() => {
    if (!scope || disabled) return;
    const saved = savedRef.current;
    const bothEmpty = text.trim() === '' && saved.text.trim() === '';
    if (bothEmpty || (text === saved.text && mode === saved.mode)) {
      cancelSave();
      return;
    }
    pendingSave.current = { text, mode };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, DRAFT_WRITE_DELAY_MS);
  }, [text, mode, scope, disabled, cancelSave, flushSave]);

  useEffect(() => flushSave, [flushSave]);

  // An archived chat keeps no draft. (A chat that merely failed to load passes
  // a notice and keeps its draft: the words are still wanted.)
  useEffect(() => {
    if (scope && disabled && !disabledNotice) discardDraft(scope, chatId);
  }, [scope, disabled, disabledNotice, chatId]);

  // The server took the conversation away from this agent (closed, handed on,
  // taken over): empty the box and stop saving what was in it.
  const retired = useRetiredDraftStore((state) => state.byChat[chatId]);
  const seenRetired = useRef(retired);
  useEffect(() => {
    if (retired === seenRetired.current) return;
    seenRetired.current = retired;
    cancelSave();
    savedRef.current = { text: '', mode: 'all' };
    setText('');
    setMode('all');
    setPendingCopilot(null);
  }, [retired, cancelSave]);

  // The same chat's draft written from another tab fills an empty box here; a
  // box with words in it is never overwritten from outside.
  useEffect(() => {
    if (!scope || disabled) return;
    const key = draftStorageKey(scope);
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== key || textRef.current.trim() !== '') return;
      const incoming = loadDraft(scope, chatId);
      if (!incoming) return;
      savedRef.current = { text: incoming.text, mode: incoming.mode };
      setText(incoming.text);
      setMode(incoming.mode);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [scope, disabled, chatId]);

  /**
   * Send, and clear.
   *
   * **When the field clears, and where a refused message goes.** It clears on
   * submit, without waiting for the server — the fluid path, and the one the
   * agent's next keystroke assumes. What that used to cost was the message
   * itself: a refusal rolled the transcript back to before the optimistic
   * bubble, and the text here was already gone, so the words disappeared from
   * both places with no notice and nothing to press.
   *
   * They are *not* written back into this field. A refused send leaves the
   * composer and becomes a row in the transcript (`failedSends.ts`) carrying
   * the text, the reason, and — when another attempt can plausibly succeed —
   * Retry. One message, one place: putting it back here while that row is on
   * screen would show it twice and make "which copy actually goes" a guess.
   *
   * That is also the answer to the conflict a restore would create. By the time
   * a send fails the agent is often mid-way through the next message, and text
   * they are still typing must never be overwritten by something the server
   * refused a moment ago — which is guaranteed here structurally rather than by
   * a check, because nothing on the failure path writes to `text` at all.
   */
  const submit = (): void => {
    if (!canSend) return;
    stopTyping();
    // Sent: the draft goes now, not after the debounce — a refresh in the next
    // 300 ms must not bring the message back.
    cancelSave();
    if (scope) discardDraft(scope, chatId);
    savedRef.current = { text: '', mode };
    send.mutate({
      text: text.trim(),
      recipients: mode,
      // Minted per message, so every attempt at *this* message — including the
      // one behind the Retry control — replays it instead of duplicating it.
      idempotencyKey: newIdempotencyKey(),
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
      // The server's refusal names its limits in `details`; the sentence is built
      // here, in the console's language, rather than printing its English.
      setUploadError(uploadFailureMessage(t, error, file));
    } finally {
      setUploading(false);
    }
  };

  const syncShortcut = (value: string, caret: number): void => {
    const next = activeShortcutQuery(value, caret);
    setShortcut(next);
    setHighlighted(0);
  };

  const insert = (reply: CannedResponse): void => {
    const input = inputRef.current;
    if (!input || !shortcut) return;

    const result = insertCannedReply(
      text,
      input.selectionStart,
      shortcut.from,
      reply.text,
      cannedValues,
      cannedFallback,
    );
    setText(result.text);
    setShortcut(null);

    // The caret has to land after the inserted text — or the selection on the
    // first fallback phrase, for the agent to overtype — which React will not
    // do on its own: a controlled textarea puts it at the end of the value.
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };

  // Rich text (FR-MOD-02.3.5): a small markdown subset — bold/italic wrap the
  // selection (or seed an empty pair at the caret), list prefixes every line
  // the selection touches with `- `. `richText.tsx#renderRichText` is what
  // turns this back into formatting, in the transcript rather than here — a
  // `<textarea>` cannot show a live bold preview, so the toolbar edits the raw
  // markdown the same way a GitHub comment box does.
  const applyMarker = (marker: string): void => {
    const input = inputRef.current;
    if (!input) return;
    const result = wrapSelection(
      text,
      { start: input.selectionStart, end: input.selectionEnd },
      marker,
    );
    setText(result.text);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };

  const applyList = (): void => {
    const input = inputRef.current;
    if (!input) return;
    const result = applyBulletPrefix(text, {
      start: input.selectionStart,
      end: input.selectionEnd,
    });
    setText(result.text);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };

  // Emoji (FR-MOD-02.3.5): inserted at the caret, same as a canned response —
  // but through `insertAtCaret` rather than `insert()`/`applyShortcut`, which
  // always adds a trailing space and has no `shortcut` range to replace here.
  const insertEmoji = (emoji: string): void => {
    const input = inputRef.current;
    const caret = input ? input.selectionStart : text.length;
    const result = insertAtCaret(text, caret, emoji);
    setText(result.text);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(result.caret, result.caret);
    });
  };

  const emojiCategoryLabel = (id: string): string => {
    if (id === 'gestures') return t('inbox.composer.emoji.category.gestures');
    if (id === 'symbols') return t('inbox.composer.emoji.category.symbols');
    return t('inbox.composer.emoji.category.smileys');
  };

  // Reply Suggestions (FR-MOD-02.3.2). The agent asks for them by pressing Space
  // in an empty reply field. The chips the keystroke puts on screen are drawn
  // from the transcript already in cache and said in the agent's own language —
  // no fetch and no round-trip stand between the keystroke and the row.
  const suggestionText = (id: ReplySuggestionId): string =>
    t(`inbox.composer.suggestions.chip.${id}`);

  /**
   * Which request the chips on screen belong to. Bumped by everything that
   * closes or replaces the row, so a Copilot draft that arrives after the agent
   * has moved on is dropped rather than reopening a row they dismissed.
   */
  const suggestionRequest = useRef(0);
  const copilotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeSuggestions = useCallback((): void => {
    suggestionRequest.current += 1;
    if (copilotTimer.current) {
      clearTimeout(copilotTimer.current);
      copilotTimer.current = null;
    }
    setSuggestions(null);
    setCopilotPending(false);
    setCopilotCapped(false);
  }, []);

  // Nothing may land on an unmounted composer.
  useEffect(
    () => () => {
      if (copilotTimer.current) clearTimeout(copilotTimer.current);
    },
    [],
  );

  /**
   * Ask Copilot for a draft grounded in the workspace's knowledge base, and add
   * it to the row if it answers in time.
   *
   * Deliberately fire-and-forget: the template chips are already up, so this can
   * only improve the row, never delay it. Three ways it comes to nothing — an
   * empty draft (the knowledge base had no match, which the endpoint reports
   * rather than inventing one), a refusal (an unentitled plan, an expired
   * session, a provider that is down) and a timeout — and all three leave the
   * agent exactly what they already had. That is the requirement: the chips are
   * never worse for having asked.
   */
  const requestCopilotDraft = (request: number): void => {
    setCopilotPending(true);
    copilotTimer.current = setTimeout(() => {
      copilotTimer.current = null;
      if (suggestionRequest.current !== request) return;
      // Too slow to be part of an "instant" row. Stop waiting, and disown the
      // reply so a late arrival cannot rearrange chips under the agent's cursor.
      suggestionRequest.current += 1;
      setCopilotPending(false);
    }, COPILOT_SUGGESTION_TIMEOUT_MS);

    copilotReply
      .mutateAsync()
      .then((result) => {
        if (suggestionRequest.current !== request) return;
        const draft = (result.draft ?? '').trim();
        if (draft.length === 0) {
          if (result.reason === 'ai_daily_cap') setCopilotCapped(true);
          return;
        }
        setSuggestions((current) =>
          current === null ? current : withCopilotDraft(current, draft),
        );
      })
      .catch(() => {
        // The template chips stand. Reply Suggestions is a convenience; a failed
        // assist must not put an error in front of an agent mid-conversation.
      })
      .finally(() => {
        if (copilotTimer.current) {
          clearTimeout(copilotTimer.current);
          copilotTimer.current = null;
        }
        if (suggestionRequest.current === request) setCopilotPending(false);
      });
  };

  const openSuggestions = (): void => {
    const cached = queryClient.getQueryData<TranscriptCache>(eventsKey(chatId));
    const turns: SuggestionTurn[] = flattenTranscript(cached)
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

    const request = (suggestionRequest.current += 1);
    setSuggestions(
      replySuggestionIds(turns).map((id) => ({ text: suggestionText(id), source: 'template' })),
    );
    requestCopilotDraft(request);
  };

  // A chip fills the reply field with editable text — never a note — and the
  // agent edits and sends it, exactly like a Copilot draft. The caret lands at
  // the end so the agent can keep typing.
  const applySuggestion = (suggestion: string): void => {
    setText(suggestion);
    setMode('all');
    closeSuggestions();
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
      closeSuggestions();
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
        if (chosen) insert(chosen);
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
        {disabledNotice ?? t('inbox.composer.disabledNotice')}
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
                  closeSuggestions();
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

      {pendingCopilot !== null && (
        <div
          role="alert"
          data-testid="composer-copilot-confirm"
          className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-brand-500 bg-brand-100 px-3 py-2 text-2xs text-content dark:bg-brand-950"
        >
          <span className="min-w-0 flex-1">{t('inbox.composer.copilotOverwrite.message')}</span>
          <button
            type="button"
            onClick={() => applyCopilotDraft(pendingCopilot)}
            className="rounded-sm bg-brand-500 px-2 py-1 font-medium text-white hover:bg-brand-600"
          >
            {t('inbox.composer.copilotOverwrite.replace')}
          </button>
          <button
            type="button"
            onClick={() => {
              setPendingCopilot(null);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            className="rounded-sm border border-border px-2 py-1 hover:bg-surface-2"
          >
            {t('inbox.composer.copilotOverwrite.keep')}
          </button>
        </div>
      )}

      {suggestions !== null && !isNote && (
        <div
          role="group"
          aria-label={t('inbox.composer.suggestions.ariaLabel')}
          className="mb-2 flex flex-wrap items-start gap-1.5"
        >
          {suggestions.map((chip) => (
            <button
              key={chip.text}
              type="button"
              onClick={() => applySuggestion(chip.text)}
              // The Copilot chip says where it came from on hover rather than in
              // its accessible name: the name has to stay the text the agent is
              // about to insert, which is what they are choosing between.
              title={
                chip.source === 'copilot' ? t('inbox.composer.suggestions.fromCopilot') : undefined
              }
              // The Copilot chip wears the row's own hover state as its resting
              // one — `brand-100` / `brand-950` on `text-content`, the exact
              // pairing every chip here already lands on under the cursor, so
              // it needs no colour the design system has not already cleared.
              className={`max-w-full truncate rounded-full border px-3 py-1 text-left text-2xs transition-colors hover:bg-brand-100 hover:text-content dark:hover:bg-brand-950 ${
                chip.source === 'copilot'
                  ? 'border-brand-500 bg-brand-100 text-content dark:bg-brand-950'
                  : 'border-border bg-inset text-content-secondary'
              }`}
            >
              {chip.text}
            </button>
          ))}
          {copilotPending && (
            // A row that may still grow, announced politely. It is never the
            // only thing here — the template chips are already usable.
            <span
              role="status"
              className="rounded-full border border-dashed border-border px-3 py-1 text-2xs text-content-tertiary"
            >
              {t('inbox.composer.suggestions.copilotPending')}
            </span>
          )}
          {copilotCapped && (
            // In place of the Copilot chip, never instead of the template ones.
            <span
              role="status"
              className="rounded-full border border-dashed border-border px-3 py-1 text-2xs text-content-tertiary"
            >
              {t(AI_DAILY_CAP_MESSAGE_KEY)}
            </span>
          )}
          <button
            type="button"
            aria-label={t('inbox.composer.suggestions.dismiss')}
            onClick={() => {
              closeSuggestions();
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
          <CannedPicker
            matches={matches}
            highlighted={highlighted}
            onHighlight={setHighlighted}
            onPick={insert}
            label={t('inbox.composer.picker.ariaLabel')}
          />
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
            if (value.length > 0 && suggestions !== null) closeSuggestions();
            // A reply is shown to the visitor; an internal note is not, so only a
            // reply-in-progress broadcasts "the agent is typing".
            if (value.trim() && mode === 'all') signalTyping();
            else stopTyping();
          }}
          onKeyUp={(event) => {
            // Arrow keys and clicks move the caret without changing the value,
            // and the picker has to follow it. Not the keys the picker itself
            // answers to: re-reading the token resets the highlight, which undid
            // every ArrowDown on its own key-up (IN-06).
            if (!pickerOpen || PICKER_KEYS.has(event.key)) return;
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

      {fileSharingEnabled && (
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept="image/*,application/pdf"
          onChange={(event) => void onPickFile(event)}
        />
      )}

      {/* Wraps: the column is 284 px at 1280 with both side panels open, and a
          toolbar that cannot wrap ran on under the Details panel (tm 259.12). */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label={t('inbox.composer.richText.bold')}
            onClick={() => applyMarker('**')}
            className="rounded-md p-1.5 text-content-secondary transition-colors hover:bg-surface-2 hover:text-content"
          >
            <BoldIcon />
          </button>
          <button
            type="button"
            aria-label={t('inbox.composer.richText.italic')}
            onClick={() => applyMarker('*')}
            className="rounded-md p-1.5 text-content-secondary transition-colors hover:bg-surface-2 hover:text-content"
          >
            <ItalicIcon />
          </button>
          <button
            type="button"
            aria-label={t('inbox.composer.richText.list')}
            onClick={applyList}
            className="rounded-md p-1.5 text-content-secondary transition-colors hover:bg-surface-2 hover:text-content"
          >
            <ListIcon />
          </button>
          <Dropdown
            label={t('inbox.composer.tags.trigger')}
            trigger={<TagIcon />}
            triggerClassName="flex items-center justify-center rounded-md p-1.5 text-content-secondary transition-colors hover:bg-surface-2 hover:text-content"
            // Same reasoning as the emoji panel below: anchored above the
            // trigger so it does not open off the bottom of the window.
            panelClassName="bottom-10 left-0 w-64 p-2"
          >
            {() => <TagPicker chatId={chatId} tags={tags} />}
          </Dropdown>
          <Dropdown
            label={t('inbox.composer.emoji.trigger')}
            trigger={<EmojiIcon />}
            triggerClassName="flex items-center justify-center rounded-md p-1.5 text-content-secondary transition-colors hover:bg-surface-2 hover:text-content"
            // Anchored above the trigger: the composer sits at the bottom of
            // the window, so a downward panel would open off-screen — the
            // same reason the canned-response picker opens upward.
            panelClassName="bottom-10 left-0 w-64 p-2"
          >
            {({ close }) => (
              <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                {EMOJI_CATEGORIES.map((category) => (
                  <div key={category.id}>
                    <p
                      id={`composer-emoji-${category.id}`}
                      className="mb-1 px-1 text-2xs font-medium uppercase tracking-wide text-content-tertiary"
                    >
                      {emojiCategoryLabel(category.id)}
                    </p>
                    <div
                      role="group"
                      aria-labelledby={`composer-emoji-${category.id}`}
                      className="flex flex-wrap gap-1"
                    >
                      {category.items.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => {
                            insertEmoji(emoji);
                            close();
                          }}
                          className="rounded-md p-1 text-lg leading-none hover:bg-surface-2"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Dropdown>
          {fileSharingEnabled && (
            <button
              type="button"
              aria-label={t('inbox.composer.attachFile')}
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="rounded-md p-1.5 text-content-secondary transition-colors hover:bg-surface-2 hover:text-content disabled:opacity-50"
            >
              <PaperclipIcon />
            </button>
          )}
          <span className="text-2xs text-content-tertiary">
            {uploading ? t('inbox.composer.uploading') : t('inbox.composer.hint')}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {uploadError && (
            <span role="alert" className="text-2xs text-danger">
              {uploadError}
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

/**
 * The composer's tag tool (FR-MOD-02.3.5's fifth tool).
 *
 * A dedicated trigger rather than a second meaning for `#`: that key already
 * opens the canned-reply picker (F5, shipped), and the two vocabularies —
 * saved-reply shortcuts and tag names — cannot share one typed prefix without
 * one of them guessing wrong. Same query key (`['tag-library']`) and the same
 * `useChatAction` mutation pair the Details panel's tag section uses, so a tag
 * added here is the one already-tested surface, not a second implementation —
 * and `onSuccess` there invalidates `['chat', chatId]`, which is exactly the
 * query that feeds this component's own `tags` prop back down.
 *
 * Curated suggestions only, deliberately: like the emoji tool above, this
 * offers what already exists (the library `Tags.tsx` manages) rather than a
 * second free-form tag editor duplicating the Details panel's chips-with-
 * remove control — carrying its "Remove tag …" label into a second,
 * simultaneously-mounted control would collide on `getByRole`. Typing and
 * pressing Enter still reaches any tag, including a brand new one.
 */
function TagPicker({ chatId, tags }: { chatId: string; tags: string[] }): ReactElement {
  const [draft, setDraft] = useState('');
  const api = useApiClient();
  const actions = useChatAction(chatId);
  const t = useTranslate();

  const library = useQuery({
    queryKey: ['tag-library'],
    queryFn: () => api.get<{ items: Array<{ name: string }> }>('/settings/tags'),
    staleTime: 60_000,
  });
  const suggestions = (library.data?.items ?? [])
    .map((item) => item.name)
    .filter((name) => !tags.includes(name));

  const addDraft = (): void => {
    const value = draft.trim();
    if (!value) return;
    actions.tag.mutate(value);
    setDraft('');
  };

  return (
    <div className="flex max-h-72 flex-col gap-2">
      {suggestions.length > 0 ? (
        <ul className="flex flex-col overflow-y-auto">
          {suggestions.map((name) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => actions.tag.mutate(name)}
                className="w-full rounded-sm px-2 py-1.5 text-left text-xs hover:bg-surface-2"
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-1 text-2xs text-content-tertiary">{t('inbox.composer.tags.empty')}</p>
      )}

      <div>
        <label className="sr-only" htmlFor="composer-tag-input">
          {t('inbox.composer.tags.newTagLabel')}
        </label>
        <input
          id="composer-tag-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addDraft();
            }
          }}
          placeholder={t('inbox.composer.tags.newTagPlaceholder')}
          maxLength={64}
          className="w-full rounded-sm border border-border bg-inset px-2 py-1 text-xs"
        />
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

// The glyph carries the icon's whole meaning, so it — not a path trace of the
// letterform — is what sits in the (aria-hidden) svg; the button around it
// supplies the real accessible name, same as `PaperclipIcon` above.
function BoldIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <text x="12" y="17" textAnchor="middle" fontSize="14" fontWeight="700" fill="currentColor">
        B
      </text>
    </svg>
  );
}

function ItalicIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <text x="12" y="17" textAnchor="middle" fontSize="14" fontStyle="italic" fill="currentColor">
        I
      </text>
    </svg>
  );
}

function ListIcon(): ReactElement {
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
      <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
    </svg>
  );
}

function TagIcon(): ReactElement {
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
      <path d="M12.59 2.59 2 13.17V22h8.83L21.4 11.41a2 2 0 0 0 0-2.83l-6-6a2 2 0 0 0-2.81.01Z" />
      <circle cx="7.5" cy="17.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function EmojiIcon(): ReactElement {
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
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  );
}
