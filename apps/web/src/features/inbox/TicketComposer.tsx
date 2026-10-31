/**
 * Where an agent answers a ticket (tm 356.4 · HD-01): a reply that is e-mailed
 * to the player, or an internal note that stays with the team.
 *
 * The two modes share one textarea, which is exactly why the mode has to be
 * impossible to miss: the button says "Send reply" or "Add note", the hint under
 * the box says who will read it, and a note turns the box amber like its line in
 * the thread. A reply the player has no address for is not offered — the server
 * would refuse it (`ticket_no_recipient`), and a control that can only bounce is
 * noise — so the pane says why and leaves the note.
 *
 * One message, one idempotency key: the key is bound to the text it was minted
 * for and kept across a failed attempt, so a retry after a dropped connection is
 * the same message, while an edited text is a new one.
 */
import { useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { TICKET_MESSAGE_TEXT_MAX, type TicketComposerKind } from '@siyahtus/types';
import { errorMessageKey } from '../../lib/api-client.js';
import { useTranslate } from '../../lib/i18n.js';
import { newAttemptKey } from '../billing/attempt-key.js';
import { useAuth } from '../../lib/auth-store.js';
import { CannedPicker, PICKER_KEYS } from './CannedPicker.js';
import { cannedValuesOf } from './cannedValues.js';
import {
  activeShortcutQuery,
  insertCannedReply,
  useMatchingResponses,
  type CannedResponse,
} from './useCannedResponses.js';
import type { TicketDetail } from './types.js';
import { useSendTicketMessage, useTicketCannedResponses } from './useTicketMessages.js';

export function TicketComposer({ ticket }: { ticket: TicketDetail }): ReactElement {
  const t = useTranslate();
  const send = useSendTicketMessage(ticket.id);
  const canned = useTicketCannedResponses();

  // Somebody to write to: an address shown, or one the caller's role may not see
  // (`customers.contact.view` off, tm 325.6) — the server still mails it.
  const reachable = ticket.customer_email !== null || ticket.customer_has_email === true;
  const [chosenMode, setChosenMode] = useState<TicketComposerKind>('reply');
  const mode: TicketComposerKind = reachable ? chosenMode : 'note';
  const [text, setText] = useState('');
  const [shortcut, setShortcut] = useState<{ query: string; from: number } | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attempt = useRef<{ signature: string; key: string } | null>(null);

  const matches = useMatchingResponses(canned.data?.items, shortcut?.query ?? null);
  const pickerOpen = shortcut !== null && matches.length > 0;

  // The ticket's own player and, when it began as a chat, that chat's id
  // (IN-06). A ticket has no connection of its own, so `{{thread.id}}` is the
  // fallback phrase here.
  const agent = useAuth((s) => s.agent);
  const cannedValues = useMemo(
    () =>
      cannedValuesOf({
        customer: { name: ticket.customer_name, email: ticket.customer_email },
        agent,
        chatId: ticket.source_chat?.id ?? null,
        companyName: canned.data?.company_name ?? null,
      }),
    [ticket.customer_name, ticket.customer_email, ticket.source_chat, agent, canned.data],
  );
  const cannedFallback = canned.data?.fallback_text || t('inbox.composer.picker.fallbackDefault');

  const isNote = mode === 'note';
  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && !send.isPending;

  const submit = (setStatus?: 'solved'): void => {
    if (!canSend) return;
    // The key follows the content: the same text, mode and status is the same
    // message however many times the button is pressed; any change is a new one.
    const signature = `${mode}|${setStatus ?? ''}|${trimmed}`;
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, key: newAttemptKey() };
    }
    send.mutate(
      {
        kind: mode,
        text: trimmed,
        ...(setStatus ? { setStatus } : {}),
        idempotencyKey: attempt.current.key,
      },
      {
        onSuccess: () => {
          attempt.current = null;
          setText('');
          setShortcut(null);
        },
      },
    );
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
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (pickerOpen) {
      // While the picker is open these keys belong to it: sending the raw
      // `#thanks` the agent was still choosing would be worse than any keyboard
      // inconsistency.
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
    // Enter breaks the line — a ticket answer is a letter, not a chat line —
    // and Ctrl/Cmd+Enter sends it.
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  };

  // A merged ticket's conversation continues on its primary; the server refuses
  // a write here (`ticket_merged`), so the controls follow that rule.
  if (ticket.merged_into_id !== null) {
    return (
      <div className="shrink-0 border-t border-border bg-surface px-4 py-4 text-center text-sm text-content-secondary">
        {t('inbox.ticket.composer.merged', { id: ticket.merged_into_id })}
      </div>
    );
  }

  const modes: { id: TicketComposerKind; label: string; disabled: boolean }[] = [
    { id: 'reply', label: t('inbox.ticket.composer.mode.reply'), disabled: !reachable },
    { id: 'note', label: t('inbox.ticket.composer.mode.note'), disabled: false },
  ];

  return (
    <div
      className="shrink-0 border-t border-border bg-surface px-4 py-3"
      data-composer-kind={isNote ? 'internal_note' : 'agent_reply'}
    >
      <div
        role="tablist"
        aria-label={t('inbox.ticket.composer.modeAriaLabel')}
        className="mb-2 flex gap-1"
      >
        {modes.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={mode === entry.id}
            disabled={entry.disabled}
            onClick={() => setChosenMode(entry.id)}
            className={`rounded-md px-3 py-1 text-xs font-medium disabled:opacity-40 ${
              mode === entry.id
                ? entry.id === 'note'
                  ? 'bg-inset text-warning ring-1 ring-warning'
                  : 'bg-brand-100 text-content dark:bg-brand-950'
                : 'text-content-secondary hover:bg-surface-2'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {!reachable && (
        <p className="mb-2 text-xs text-content-secondary">
          {t('inbox.ticket.composer.noRecipient')}
        </p>
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

        <label htmlFor="ticket-composer-input" className="sr-only">
          {isNote
            ? t('inbox.ticket.composer.inputLabel.note')
            : t('inbox.ticket.composer.inputLabel.reply')}
        </label>
        <textarea
          ref={inputRef}
          id="ticket-composer-input"
          value={text}
          rows={4}
          maxLength={TICKET_MESSAGE_TEXT_MAX}
          disabled={send.isPending}
          placeholder={
            isNote
              ? t('inbox.ticket.composer.placeholder.note')
              : t('inbox.ticket.composer.placeholder.reply')
          }
          onChange={(event) => {
            setText(event.target.value);
            setShortcut(activeShortcutQuery(event.target.value, event.target.selectionStart));
            setHighlighted(0);
          }}
          onKeyUp={(event) => {
            // Arrow keys and clicks move the caret without changing the value,
            // and the picker has to follow it. Not the keys the picker itself
            // answers to: re-reading the token resets the highlight, which undid
            // every ArrowDown on its own key-up (IN-06).
            if (!pickerOpen || PICKER_KEYS.has(event.key)) return;
            setShortcut(
              activeShortcutQuery(event.currentTarget.value, event.currentTarget.selectionStart),
            );
          }}
          onBlur={() => setShortcut(null)}
          onKeyDown={onKeyDown}
          className={`w-full resize-y rounded-md border px-2.5 py-2 text-sm disabled:opacity-60 ${
            isNote ? 'border-warning bg-inset' : 'border-border bg-inset'
          }`}
        />
      </div>

      <p className="mt-1.5 text-xs text-content-tertiary">
        {isNote
          ? t('inbox.ticket.composer.hint.note')
          : ticket.customer_email
            ? t('inbox.ticket.composer.hint.reply', { email: ticket.customer_email })
            : t('inbox.ticket.composer.hint.replyHidden')}
      </p>

      {send.isError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {t(errorMessageKey(send.error))}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {!isNote && (
          <button
            type="button"
            disabled={!canSend}
            onClick={() => submit('solved')}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          >
            {t('inbox.ticket.composer.sendAndSolve')}
          </button>
        )}
        <button
          type="button"
          disabled={!canSend}
          onClick={() => submit()}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {isNote ? t('inbox.ticket.composer.addNote') : t('inbox.ticket.composer.sendReply')}
        </button>
      </div>
    </div>
  );
}
