/**
 * The open conversation's header (FR-MOD-02.6, 12.1).
 *
 * The visitor's name is what an agent reads it for, so it is the one thing that
 * gives way last: everything else either shrinks to an icon or leaves. Its room
 * is whatever is left after the rail, the list and the Details panel — 284 px
 * at 1280 — so the layout switches on the header's own width (`useNarrow`), not
 * the viewport's: collapsing the panel gives the full layout back. Narrow, the
 * actions keep their accessible names (`aria-label`) and a tooltip, the status
 * keeps its word for a screen reader, and the two numbers (the day's and the
 * newest connection's, `ids.thread` / `ids.chat`) — both also in the Details
 * panel — are dropped (tm 259.12 · UX audit O3 + O4 · tm 286.4).
 */
import { useState, type ReactElement } from 'react';
import { hasAnyScope } from '@siyahtus/types';
import { useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { StatusDot } from '../../components/StatusDot.js';
import { RiskChips } from '../risk/RiskChips.js';
import { AiModeControls } from './AiModeControls.js';
import { CreateTicketButton } from './CreateTicketButton.js';
import { actionClass } from './headerAction.js';
import { TransferDialog } from './TransferDialog.js';
import type { TransferNotice } from './transfer.js';
import { useNarrow } from './useNarrow.js';
import type { ChatDetail } from './types.js';

/** Below this header width the actions drop their words (the longest Turkish row needs ~690). */
const NARROW_BELOW = 750;

export function ThreadHeader({
  chatId,
  threadId = null,
  customerName,
  active,
  onOpenTicket,
  onOpenCopilot,
  onShowDetails,
  chat = null,
  onTransferred,
}: {
  chatId: string;
  /** The newest connection (`ids.chat`); null when the chat has none. */
  threadId?: string | null;
  customerName: string | null;
  active: boolean;
  onOpenTicket: (ticketId: string) => void;
  onOpenCopilot: () => void;
  /** Present only while the Details panel is collapsed: the way back to it. */
  onShowDetails: (() => void) | null;
  /** The open chat — who answers it (AI-11), and what the caller may do about that. */
  chat?: ChatDetail | null;
  /** After a hand-off from `Transfer…` (IN-04): its notice, and whether the chat left the caller's sight. */
  onTransferred?: (outcome: { notice: TransferNotice; left: boolean }) => void;
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
        // Both numbers (ID-02 · tm 286.4): the member's day, and the connection
        // the composer writes into. Stacked rather than side by side, so the
        // second number costs the name no width.
        <dl className="flex shrink-0 flex-col text-2xs leading-tight text-content-tertiary">
          <div title={`${t('ids.thread.label')} — ${t('ids.thread.hint')}`} className="flex gap-1">
            <dt>{t('ids.thread.label')}</dt>
            <dd className="font-mono">{chatId}</dd>
          </div>
          {threadId && (
            <div title={`${t('ids.chat.label')} — ${t('ids.chat.hint')}`} className="flex gap-1">
              <dt>{t('ids.chat.label')}</dt>
              <dd className="font-mono">{threadId}</dd>
            </div>
          )}
        </dl>
      )}
      <StatusDot
        compact={narrow}
        tone={active ? 'success' : 'neutral'}
        label={active ? t('inbox.thread.statusActive') : t('inbox.thread.statusArchived')}
      />
      {chat && <RiskChips chatId={chatId} customerId={chat.customer_id} compact={narrow} />}
      {chat && <AiModeControls chat={chat} chatId={chatId} compact={narrow} />}
      {chat && active && (
        <TransferButton
          chatId={chatId}
          assigneeId={chat.thread?.assignee_id ?? null}
          compact={narrow}
          onTransferred={onTransferred}
        />
      )}
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
 * `Transfer…` (IN-04): the hand-off dialog — a teammate or a team, with a
 * note. Offered to whoever may write to the chat, which is what
 * `POST /chats/{id}/transfer` asks for (the Details panel's assignee menu
 * asks the same).
 */
function TransferButton({
  chatId,
  assigneeId,
  compact,
  onTransferred,
}: {
  chatId: string;
  assigneeId: string | null;
  compact: boolean;
  onTransferred?: (outcome: { notice: TransferNotice; left: boolean }) => void;
}): ReactElement | null {
  const t = useTranslate();
  const scopes = useAuth((s) => s.agent?.scopes) ?? [];
  const [open, setOpen] = useState(false);
  if (!hasAnyScope(scopes, ['chats--all:rw', 'chats--access:rw'])) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('inbox.thread.transfer')}
        title={t('inbox.thread.transfer')}
        className={actionClass(compact)}
      >
        <span aria-hidden="true">⇄</span>
        {!compact && t('inbox.thread.transfer')}
      </button>
      {open && (
        <TransferDialog
          chatId={chatId}
          assigneeId={assigneeId}
          onClose={() => setOpen(false)}
          onTransferred={onTransferred}
        />
      )}
    </>
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
