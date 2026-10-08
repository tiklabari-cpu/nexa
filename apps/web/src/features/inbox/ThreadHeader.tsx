/**
 * The open conversation's header (FR-MOD-02.6, 12.1).
 *
 * The visitor's name is what an agent reads it for, so it is the one thing that
 * gives way last: everything else either shrinks to an icon or leaves. Its room
 * is whatever is left after the rail, the list and the Details panel — 284 px
 * at 1280 — so the layout switches on the header's own width (`useNarrow`), not
 * the viewport's: collapsing the panel gives the full layout back. Narrow, the
 * actions keep their accessible names (`aria-label`) and a tooltip, the status
 * keeps its word for a screen reader, and the chat id — already in the Details
 * panel — is dropped (tm 259.12 · UX audit O3 + O4).
 */
import { useState, type ReactElement } from 'react';
import { useTranslate } from '../../lib/i18n.js';
import { StatusDot } from '../../components/StatusDot.js';
import { CreateTicketButton } from './CreateTicketButton.js';
import { actionClass } from './headerAction.js';
import { useNarrow } from './useNarrow.js';

/** Below this header width the actions drop their words (the longest Turkish row needs ~620). */
const NARROW_BELOW = 680;

export function ThreadHeader({
  chatId,
  customerName,
  active,
  onOpenTicket,
  onOpenCopilot,
  onShowDetails,
}: {
  chatId: string;
  customerName: string | null;
  active: boolean;
  onOpenTicket: (ticketId: string) => void;
  onOpenCopilot: () => void;
  /** Present only while the Details panel is collapsed: the way back to it. */
  onShowDetails: (() => void) | null;
}): ReactElement {
  const t = useTranslate();
  const [ref, narrow] = useNarrow<HTMLElement>(NARROW_BELOW);
  const name = customerName ?? t('inbox.thread.visitorFallback');

  return (
    <header
      ref={ref}
      className={`relative flex h-topbar shrink-0 items-center border-b border-border bg-surface ${
        narrow ? 'gap-2 px-3' : 'gap-3 px-4'
      }`}
    >
      <h2 title={name} className="min-w-0 flex-1 truncate text-sm font-semibold">
        {name}
      </h2>
      {!narrow && (
        <span className="shrink-0 font-mono text-2xs text-content-tertiary">{chatId}</span>
      )}
      <StatusDot
        compact={narrow}
        tone={active ? 'success' : 'neutral'}
        label={active ? t('inbox.thread.statusActive') : t('inbox.thread.statusArchived')}
      />
      <CopyLinkButton chatId={chatId} compact={narrow} />
      <CreateTicketButton
        chatId={chatId}
        customerName={customerName}
        onOpenTicket={onOpenTicket}
        compact={narrow}
      />
      <CopilotButton onOpen={onOpenCopilot} compact={narrow} />
      {onShowDetails && <ShowDetailsButton onShow={onShowDetails} compact={narrow} />}
    </header>
  );
}

/**
 * Brings the Details panel back after it has been collapsed (FR-MOD-01.3).
 * Collapsing happens from the panel's own header, which stays reachable while
 * the transcript here is narrow.
 */
function ShowDetailsButton({
  onShow,
  compact,
}: {
  onShow: () => void;
  compact: boolean;
}): ReactElement {
  const t = useTranslate();
  return (
    <button
      type="button"
      onClick={onShow}
      aria-label={t('inbox.thread.showDetails')}
      title={t('inbox.thread.showDetails')}
      className={actionClass(compact)}
    >
      <span aria-hidden="true">◧</span>
      {!compact && t('inbox.thread.detailsLabel')}
    </button>
  );
}

/**
 * Opens the Copilot assist panel for the open conversation (FR-MOD-12.1), so
 * agent-assist is one click from any chat.
 */
function CopilotButton({
  onOpen,
  compact,
}: {
  onOpen: () => void;
  compact: boolean;
}): ReactElement {
  const t = useTranslate();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('inbox.thread.copilotLabel')}
      title={t('inbox.thread.copilotLabel')}
      className={actionClass(compact)}
    >
      <span aria-hidden="true">✧</span>
      {!compact && t('inbox.thread.copilotLabel')}
    </button>
  );
}

/**
 * Copies a deep link to this conversation (FR-MOD-02.6). It reuses the `?chat=`
 * parameter the inbox already consumes on load, made absolute, so a pasted link
 * reopens the exact conversation from a ticket, a chat message, or another
 * machine.
 */
function CopyLinkButton({ chatId, compact }: { chatId: string; compact: boolean }): ReactElement {
  const [copied, setCopied] = useState(false);
  const t = useTranslate();
  const copy = (): void => {
    const url = `${window.location.origin}/app/inbox?chat=${chatId}`;
    void navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      },
      () => setCopied(false),
    );
  };
  const label = copied ? t('inbox.thread.copied') : t('inbox.thread.copyLink');
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      title={label}
      className={actionClass(compact)}
    >
      {compact ? <span aria-hidden="true">{copied ? '✓' : '⧉'}</span> : label}
    </button>
  );
}
