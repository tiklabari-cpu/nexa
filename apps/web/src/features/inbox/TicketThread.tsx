/**
 * A ticket's conversation (tm 356.4 · HD-01): what the player wrote, what the
 * team answered, and the notes the team left for itself, oldest first.
 *
 * The one thing this component must never get wrong is which lines are for the
 * team. An internal note is drawn in amber, with its own label ("Internal note
 * · only your team sees this") and a left rule — three cues, none of them
 * colour alone (NFR-A11Y2) — so an agent scanning the thread can see at a glance
 * what the player has and has not been sent. A reply carries the state of its
 * e-mail instead: sent, on its way, not sent because this deployment keeps
 * ticket e-mail off (K23), or failed with "try again" beside it.
 *
 * The player's e-mail (tm 357 · HD-02) is drawn as text, `pre-wrap`: what they
 * wrote this time, with the quoted earlier mail and the signature cut — the
 * whole text one click away ("Show full message"), because the cut is a guess.
 * `body_html`, on mail that arrived as HTML, is never put in the console's own
 * origin: "Formatted view" shows it in an `<iframe>` with an empty `sandbox`
 * (no script, no form, no navigation, an opaque origin) whose own
 * Content-Security-Policy loads nothing — behind the allow-list sanitiser the
 * server ran at intake, each layer guarding the other's mistake.
 *
 * Files open through the ticket (`GET …/messages/{id}/attachments/{key}`), not
 * `/uploads`: a file the player e-mailed is served nowhere else. A sensitive one
 * (an ID card) waits behind a click, and opening it is audited; for a role that
 * may not open it at all the server marks it `locked`, and it is drawn as a
 * line with no way to fetch it.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { TicketMessageAttachment } from '@siyahtus/types';
import { ListSkeleton } from '../../components/Skeleton.js';
import { StatusDot } from '../../components/StatusDot.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { AttachmentView } from './Attachment.js';
import { QUEUED_POLL_MS, awaitsDelivery, canTryAgain, deliveryBadgeOf } from './ticketMessages.js';
import type { TicketMessage } from './types.js';
import { useResendTicketMessage, useTicketMessages } from './useTicketMessages.js';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Where a message's file is opened: through its ticket, never `/uploads` (tm 357). */
export function attachmentUrl(message: TicketMessage, key: string): string {
  const [ticket, id, file] = [message.ticket_id, message.id, key].map(encodeURIComponent);
  return `/api/v1/tickets/${ticket}/messages/${id}/attachments/${file}`;
}

/**
 * The frame "Formatted view" draws a player's HTML in. `sandbox` is empty on
 * purpose — every allowance off — and the document's own policy loads nothing
 * but inline images (`data:`); the sanitiser already parked remote ones in
 * `data-src`, so a tracking pixel has nothing to fetch even if it were missed.
 */
const FORMATTED_MAIL_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

export function formattedMailDocument(html: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${FORMATTED_MAIL_CSP}">` +
    `<style>body{font:14px/1.5 system-ui,sans-serif;margin:12px;color:#1f2328;background:#fff;` +
    `overflow-wrap:anywhere}img{max-width:100%}blockquote{margin:0 0 0 8px;padding-left:8px;` +
    `border-left:2px solid #d0d7de;color:#57606a}</style></head><body>${html}</body></html>`
  );
}

/**
 * The player's e-mail as text, with the whole of it and its formatting one
 * click away each.
 */
function PlayerMailBody({ message, t }: { message: TicketMessage; t: TFunction }): ReactElement {
  const [full, setFull] = useState(false);
  const [formatted, setFormatted] = useState(false);
  const fullId = `ticket-message-${message.id}-full`;
  const formattedId = `ticket-message-${message.id}-formatted`;

  return (
    <>
      <p className="whitespace-pre-wrap break-words text-sm text-content">{message.body_text}</p>
      {(message.body_text_full || message.body_html) && (
        <div className="mt-2 flex flex-wrap gap-3">
          {message.body_text_full && (
            <button
              type="button"
              aria-expanded={full}
              aria-controls={fullId}
              onClick={() => setFull((open) => !open)}
              className="text-2xs font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700"
            >
              {full ? t('inbox.ticket.thread.hideFull') : t('inbox.ticket.thread.showFull')}
            </button>
          )}
          {message.body_html && (
            <button
              type="button"
              aria-expanded={formatted}
              aria-controls={formattedId}
              onClick={() => setFormatted((open) => !open)}
              className="text-2xs font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700"
            >
              {formatted
                ? t('inbox.ticket.thread.hideFormatted')
                : t('inbox.ticket.thread.showFormatted')}
            </button>
          )}
        </div>
      )}
      {full && message.body_text_full && (
        <div id={fullId} className="mt-2 rounded-md border border-border bg-inset px-3 py-2">
          <p className="mb-1 text-2xs text-content-tertiary">
            {t('inbox.ticket.thread.fullLabel')}
          </p>
          <p className="whitespace-pre-wrap break-words text-xs text-content-secondary">
            {message.body_text_full}
          </p>
        </div>
      )}
      {formatted && message.body_html && (
        <iframe
          id={formattedId}
          title={t('inbox.ticket.thread.formattedTitle')}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={formattedMailDocument(message.body_html)}
          className="mt-2 h-80 w-full rounded-md border border-border bg-white"
        />
      )}
    </>
  );
}

/**
 * One file on a message. Only a scanned-clean file is fetched, and a file the
 * sender marked sensitive (an ID document, a bank statement) waits behind a
 * click — the same rule the chat transcript keeps. A file the caller's role
 * may not open is a line with nothing to click; a file the retention window
 * removed says so.
 */
function AttachmentLine({
  attachment,
  url,
  t,
}: {
  attachment: TicketMessageAttachment;
  url: string;
  t: TFunction;
}): ReactElement {
  const [revealed, setRevealed] = useState(false);

  if (attachment.purged) {
    return (
      <li className="text-2xs text-content-tertiary">
        {t('inbox.ticket.thread.attachment.purged', { name: attachment.name })}
      </li>
    );
  }
  if (attachment.sensitive && attachment.locked) {
    return (
      <li className="flex items-center gap-1.5 text-2xs text-content-tertiary">
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        {t('inbox.ticket.thread.attachment.locked', { name: attachment.name })}
      </li>
    );
  }
  if (attachment.scan_status === 'infected') {
    return (
      <li className="text-2xs text-danger">
        {t('inbox.ticket.thread.attachment.infected', { name: attachment.name })}
      </li>
    );
  }
  if (attachment.scan_status === 'pending') {
    return (
      <li className="text-2xs text-content-tertiary">
        {t('inbox.ticket.thread.attachment.pending', { name: attachment.name })}
      </li>
    );
  }
  if (attachment.sensitive && !revealed) {
    return (
      <li className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="self-start rounded-md border border-border bg-inset px-2 py-1 text-2xs text-content-secondary hover:bg-surface-2"
        >
          {t('inbox.ticket.thread.attachment.reveal', { name: attachment.name })}
        </button>
        <span className="text-2xs text-content-tertiary">
          {t('inbox.ticket.thread.attachment.revealHint')}
        </span>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-1">
      <span className="text-2xs text-content-tertiary">
        {attachment.name} · {formatSize(attachment.size)}
      </span>
      <AttachmentView url={url} filename={attachment.name} />
    </li>
  );
}

function MessageItem({
  message,
  viewedTicketId,
  onTryAgain,
  retrying,
  t,
}: {
  message: TicketMessage;
  viewedTicketId: string;
  onTryAgain: (messageId: string) => void;
  retrying: boolean;
  t: TFunction;
}): ReactElement {
  if (message.kind === 'system') {
    return (
      <li className="py-1 text-center text-2xs text-content-tertiary" data-kind="system">
        {message.body_text}
        <span className="ml-2">{formatDateTime(message.created_at)}</span>
      </li>
    );
  }

  const isNote = message.kind === 'internal_note';
  const fromPlayer = message.kind === 'customer_message';
  const badge = deliveryBadgeOf(message);
  const author =
    message.author_name ??
    (fromPlayer
      ? t('inbox.ticket.thread.author.player')
      : message.author_type === 'bot'
        ? t('inbox.ticket.thread.author.bot')
        : t('inbox.ticket.thread.author.agent'));

  return (
    <li
      data-kind={message.kind}
      className={`rounded-md border px-3 py-2.5 ${
        isNote
          ? 'border-warning border-l-4 bg-inset'
          : fromPlayer
            ? 'border-border bg-surface'
            : 'border-border bg-brand-100 dark:bg-brand-950'
      }`}
    >
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs">
        <span className="font-semibold text-content">{author}</span>
        {isNote && (
          <span className="font-medium text-warning">{t('inbox.ticket.thread.note.label')}</span>
        )}
        <span className="text-content-tertiary">{formatDateTime(message.created_at)}</span>
        {message.ticket_id !== viewedTicketId && (
          <span className="font-mono text-content-tertiary">
            {t('inbox.ticket.thread.fromMerged', { id: message.ticket_id })}
          </span>
        )}
      </div>

      {fromPlayer ? (
        <PlayerMailBody message={message} t={t} />
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm text-content">{message.body_text}</p>
      )}

      {message.attachments.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {message.attachments.map((attachment) => (
            <AttachmentLine
              key={attachment.key}
              attachment={attachment}
              url={attachmentUrl(message, attachment.key)}
              t={t}
            />
          ))}
        </ul>
      )}

      {badge && (
        <div className="mt-2">
          <div className="flex items-center gap-3">
            <StatusDot tone={badge.tone} label={t(badge.labelKey)} />
            {canTryAgain(message) && (
              <button
                type="button"
                onClick={() => onTryAgain(message.id)}
                disabled={retrying}
                className="text-2xs font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700 disabled:opacity-40"
              >
                {t('inbox.ticket.thread.tryAgain')}
              </button>
            )}
          </div>
          {badge.hintKey && (
            <p className="mt-1 text-2xs text-content-tertiary">{t(badge.hintKey)}</p>
          )}
        </div>
      )}
    </li>
  );
}

export function TicketThread({ ticketId }: { ticketId: string }): ReactElement {
  const t = useTranslate();
  const [polling, setPolling] = useState(false);
  const thread = useTicketMessages(ticketId, polling ? QUEUED_POLL_MS : false);
  const resend = useResendTicketMessage(ticketId);
  const { hasNext, isFetchingNext, fetchNext } = thread;

  // While a reply's e-mail is still going out the thread re-reads, so the
  // replier sees "Sent" (or "Could not send") even when no push reaches them.
  const waiting = awaitsDelivery(thread.items, Date.now());
  useEffect(() => setPolling(waiting), [waiting]);

  // A conversation is read to its end — the newest line is the one that matters
  // — so the pages are chained rather than waiting on a "load more".
  useEffect(() => {
    if (hasNext && !isFetchingNext) fetchNext();
  }, [hasNext, isFetchingNext, fetchNext]);

  return (
    <section
      aria-label={t('inbox.ticket.thread.ariaLabel')}
      className="mt-8 max-w-xl border-t border-border pt-6"
    >
      <h3 className="mb-3 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        {t('inbox.ticket.thread.heading')}
      </h3>

      {thread.isPending ? (
        <ListSkeleton rows={2} />
      ) : thread.isError ? (
        <p role="alert" className="text-sm text-danger">
          {t('inbox.ticket.thread.loadError')}
        </p>
      ) : thread.items.length === 0 ? (
        <p className="text-sm text-content-tertiary">{t('inbox.ticket.thread.empty')}</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {thread.items.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              viewedTicketId={ticketId}
              onTryAgain={(id) => resend.mutate(id)}
              retrying={resend.isPending}
              t={t}
            />
          ))}
        </ol>
      )}

      {resend.isError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {t(errorMessageKey(resend.error))}
        </p>
      )}
    </section>
  );
}
