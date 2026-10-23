/**
 * The player card (IN-02 · tm 331.2): who the agent is talking to, what they
 * said before the chat started, what happened earlier today and on the days
 * before — at the top of the Details panel, so nobody has to leave the inbox
 * for the Customers page to find out.
 *
 * Read in one call (`useCustomerContext`), behind the chat's visibility: the
 * server leaves the email and the username null for a caller without
 * `customers.contact.view` and says so (`contact_visible`), so the card reads
 * "Hidden" there rather than "—"; a field the player never gave reads "—".
 *
 * Another team's day in the history is a restricted row — its date and its
 * queue topic, nothing to open (IN-02-S2); the server sends nothing else. Any
 * other row opens its connection's transcript read-only, in a dialog, so the
 * conversation being answered and its composer stay where they are.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { ConversationRef, CustomerContext } from '@siyahtus/types';
import { CopyId } from '../../components/CopyId.js';
import { Modal, PanelSection } from '../../components/ui/index.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDate, formatDuration, formatTime } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { RiskChips } from '../risk/RiskChips.js';
import type { ChatEvent } from './types.js';
import { contactField, conversationSeconds, useCustomerContext } from './useCustomerContext.js';

/** The connection a read-only transcript is open for. */
interface OpenConnection {
  chatId: string;
  threadId: string;
  startedAt: string;
}

export function PlayerCard({
  chatId,
  customerId,
  recognizedDevice,
}: {
  chatId: string;
  customerId: string | null;
  /** The hand-over card saw a valid member token on this device (AI-10). */
  recognizedDevice: boolean;
}): ReactElement {
  const t = useTranslate();
  const card = useCustomerContext(chatId);
  const [open, setOpen] = useState<OpenConnection | null>(null);
  const context = card.context;

  if (!context) {
    return (
      <PanelSection title={t('inbox.playerCard.section')}>
        <p className="text-xs text-content-tertiary" role={card.isError ? 'alert' : undefined}>
          {card.isPending ? t('inbox.playerCard.loading') : t('inbox.playerCard.unavailable')}
        </p>
      </PanelSection>
    );
  }

  const { customer } = context;
  const onRead = (ref: ConversationRef): void => {
    if (ref.chat_id && ref.thread_id) {
      setOpen({ chatId: ref.chat_id, threadId: ref.thread_id, startedAt: ref.started_at });
    }
  };

  return (
    <>
      <PanelSection title={t('inbox.playerCard.section')}>
        <div data-testid="player-card" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium text-content">
              {customer.name ?? t('customers.detail.unnamedVisitor')}
            </span>
            {customer.banned && <Badge tone="danger">{t('inbox.playerCard.banned')}</Badge>}
            <Link
              to={`/app/customers?customer=${encodeURIComponent(customer.id)}`}
              className="ml-auto shrink-0 text-2xs text-content-brand underline underline-offset-2"
            >
              {t('inbox.playerCard.openProfile')}
            </Link>
          </div>
          <RiskChips chatId={chatId} customerId={customerId} compact={false} />

          <Field label={t('inbox.playerCard.username')}>
            <span className="flex flex-col items-end gap-1">
              <ContactValue field={contactField(customer.username, context.contact_visible)} />
              {customer.username && <Badge>{t('inbox.handoffCard.declared')}</Badge>}
              {recognizedDevice && (
                <Badge tone="success">{t('inbox.handoffCard.recognizedDevice')}</Badge>
              )}
            </span>
          </Field>
          <Field label={t('inbox.playerCard.email')}>
            <ContactValue field={contactField(customer.email, context.contact_visible)} />
          </Field>
          <Field label={t('inbox.playerCard.country')}>
            <span className="text-xs">{placeOf(customer)}</span>
          </Field>

          <h3 className="mt-1 text-2xs font-semibold text-content-secondary">
            {t('inbox.playerCard.preChat')}
          </h3>
          {context.pre_chat.length === 0 ? (
            <p className="text-xs text-content-tertiary">—</p>
          ) : (
            <dl className="flex flex-col gap-1">
              {context.pre_chat.map((answer, index) => (
                <div key={`${answer.label}-${index}`} className="flex justify-between gap-3">
                  <dt className="text-xs text-content-secondary">{answer.label}</dt>
                  <dd className="min-w-0 break-words text-right text-xs">{answer.value || '—'}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </PanelSection>

      <PanelSection title={t('inbox.playerCard.today')}>
        {context.today.length === 0 ? (
          <p className="text-xs text-content-tertiary">{t('inbox.playerCard.todayEmpty')}</p>
        ) : (
          <ol className="flex flex-col gap-3" data-testid="player-card-today">
            {context.today.map((ref) => (
              <ConversationRow
                key={ref.thread_id ?? ref.started_at}
                conversation={ref}
                day={false}
                onRead={onRead}
              />
            ))}
          </ol>
        )}
      </PanelSection>

      <PanelSection title={t('inbox.playerCard.history')}>
        {card.history.length === 0 ? (
          <p className="text-xs text-content-tertiary">{t('inbox.playerCard.historyEmpty')}</p>
        ) : (
          <ol className="flex flex-col gap-3" data-testid="player-card-history">
            {card.history.map((ref, index) => (
              <ConversationRow
                key={ref.chat_id ?? `restricted-${ref.started_at}-${index}`}
                conversation={ref}
                day
                onRead={onRead}
              />
            ))}
          </ol>
        )}
        {context.restricted_count > 0 && (
          <p className="text-2xs text-content-tertiary">
            {t('inbox.playerCard.restrictedCount', { count: context.restricted_count })}
          </p>
        )}
        {card.hasMore && (
          <button
            type="button"
            onClick={card.fetchMore}
            disabled={card.isFetchingMore}
            className="self-start rounded-sm border border-border px-2 py-0.5 text-2xs hover:bg-surface-2 disabled:opacity-50"
          >
            {card.isFetchingMore ? t('inbox.playerCard.loading') : t('inbox.playerCard.more')}
          </button>
        )}
      </PanelSection>

      {open && <ConnectionTranscript connection={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/**
 * One earlier connection of the day (`day: false`) or one earlier day: when,
 * how long, how it ended, and what the hand-over card — or the written
 * summary — says about it. A restricted row is the date and the topic.
 */
function ConversationRow({
  conversation: ref,
  day,
  onRead,
}: {
  conversation: ConversationRef;
  day: boolean;
  onRead: (ref: ConversationRef) => void;
}): ReactElement {
  const t = useTranslate();
  const when = day ? formatDate(ref.started_at) : formatTime(ref.started_at);

  if (!ref.accessible) {
    return (
      <li
        data-restricted=""
        title={t('inbox.playerCard.restrictedHint')}
        className="flex flex-col gap-0.5 text-xs text-content-tertiary"
      >
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true">🔒</span>
          <span className="tabular">{when}</span>
          <span>{t('inbox.playerCard.restricted')}</span>
        </span>
        {ref.topics.length > 0 && (
          <span className="text-2xs">
            {ref.topics.map((topic) => t(`team.queue.role.${topic}`)).join(' · ')}
          </span>
        )}
      </li>
    );
  }

  const seconds = conversationSeconds(ref);
  const facts = [
    day && ref.connections_count != null
      ? t('inbox.playerCard.connections', { count: ref.connections_count })
      : null,
    seconds === null ? t('inbox.playerCard.ongoing') : formatDuration(seconds),
    ref.outcome ? t(`playbook.procedure.stateOutcome.${ref.outcome}`) : null,
    ref.rating ? t(`inbox.playerCard.rating.${ref.rating}`) : null,
    ref.assignee?.name ?? null,
  ].filter((part): part is string => Boolean(part));
  const about = ref.ai_handoff?.summary ?? ref.summary;

  return (
    <li className="flex flex-col gap-1 text-xs">
      <span className="flex flex-wrap items-center gap-2">
        <span className="tabular font-medium">{when}</span>
        {day && ref.chat_id && (
          <CopyId kind="thread" value={ref.chat_id} showLabel={false} className="text-2xs" />
        )}
        {ref.thread_id && (
          <CopyId kind="chat" value={ref.thread_id} showLabel={false} className="text-2xs" />
        )}
      </span>
      {facts.length > 0 && (
        <span className="text-2xs text-content-tertiary">{facts.join(' · ')}</span>
      )}
      {ref.ai_handoff && (
        <span className="text-2xs text-content-secondary">
          {t('inbox.handoffCard.line', {
            reason: t(`playbook.handoff.reason.${ref.ai_handoff.primary_reason}`),
          })}
        </span>
      )}
      {about && <p className="line-clamp-3 break-words">{about}</p>}
      {ref.tags.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {ref.tags.map((tag) => (
            <span key={tag} className="rounded-sm bg-inset px-1.5 text-2xs">
              {tag}
            </span>
          ))}
        </span>
      )}
      <button
        type="button"
        onClick={() => onRead(ref)}
        className="self-start rounded-sm border border-border px-1.5 py-0.5 text-2xs hover:bg-surface-2"
      >
        {t('inbox.playerCard.read')}
      </button>
    </li>
  );
}

/**
 * One connection's transcript, read-only: the messages and nothing to do with
 * them. A dialog rather than the console's transcript so the conversation the
 * agent is answering — and the draft in its composer — does not move.
 */
function ConnectionTranscript({
  connection,
  onClose,
}: {
  connection: OpenConnection;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const events = useQuery({
    queryKey: ['connection-transcript', connection.chatId, connection.threadId],
    queryFn: () =>
      api.get<{ items: ChatEvent[]; next_page_id?: string }>(
        `/chats/${connection.chatId}/events?thread_id=${encodeURIComponent(connection.threadId)}&limit=100`,
      ),
    staleTime: 60_000,
  });
  const items = (events.data?.items ?? []).filter((event) => event.text);

  return (
    <Modal
      onClose={onClose}
      title={t('inbox.playerCard.transcript.title', {
        time: `${formatDate(connection.startedAt) ?? ''} ${formatTime(connection.startedAt) ?? ''}`.trim(),
      })}
      align="top"
      className="max-w-lg"
    >
      <div className="mb-3 flex items-center gap-2">
        <CopyId kind="thread" value={connection.chatId} className="text-2xs" />
        <CopyId kind="chat" value={connection.threadId} className="text-2xs" />
      </div>
      {events.isPending ? (
        <p className="text-sm text-content-tertiary">{t('inbox.playerCard.loading')}</p>
      ) : events.isError ? (
        <p role="alert" className="text-sm text-danger">
          {t('inbox.playerCard.transcript.error')}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-content-tertiary">{t('inbox.playerCard.transcript.empty')}</p>
      ) : (
        <ol
          data-testid="connection-transcript"
          className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto"
        >
          {items.map((event) => (
            <li key={event.id} className="flex flex-col gap-0.5 text-sm">
              <span className="text-2xs text-content-tertiary">
                {authorLabel(event, t)} · {formatTime(event.created_at)}
              </span>
              <p className="whitespace-pre-wrap break-words">{event.text}</p>
            </li>
          ))}
        </ol>
      )}
      {events.data?.next_page_id && (
        <p className="mt-2 text-2xs text-content-tertiary">
          {t('inbox.playerCard.transcript.truncated')}
        </p>
      )}
    </Modal>
  );
}

function authorLabel(event: ChatEvent, t: TFunction): string {
  const who = t(`inbox.playerCard.transcript.author.${event.author_type}`);
  return event.recipients === 'agents'
    ? `${who} · ${t('inbox.playerCard.transcript.internal')}`
    : who;
}

/** "Istanbul, Turkey", "Turkey", "TR", or "—". */
function placeOf(customer: CustomerContext['customer']): string {
  const country = customer.country ?? customer.country_code;
  const parts = [customer.city, country].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(', ') : '—';
}

function ContactValue({ field }: { field: ReturnType<typeof contactField> }): ReactElement {
  const t = useTranslate();
  if (field.kind === 'hidden') {
    return (
      <span className="text-xs text-content-tertiary" title={t('inbox.playerCard.hiddenHint')}>
        {t('inbox.playerCard.hidden')}
      </span>
    );
  }
  return (
    <span className="min-w-0 break-all text-right text-xs">
      {field.kind === 'value' ? field.value : '—'}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-xs text-content-secondary">{label}</span>
      {children}
    </div>
  );
}

function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'danger';
}): ReactElement {
  const tones = {
    neutral: 'bg-inset text-content-secondary',
    success: 'bg-success/10 text-success',
    danger: 'bg-danger/10 text-danger',
  };
  return <span className={`rounded-sm px-1.5 text-2xs ${tones[tone]}`}>{children}</span>;
}
