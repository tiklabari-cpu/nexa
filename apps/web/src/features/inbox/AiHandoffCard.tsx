/**
 * The AI's hand-over card (tm 304.2 · SiyahTuş analysis AI-10): what the AI
 * leaves the person who takes the conversation, so they start without asking
 * the player anything again.
 *
 * Short by default — the one-line summary, why it was handed over, how urgent,
 * who the player says they are — and the rest behind "Show details": what the
 * AI collected (each line with its status), what it decided on, what a person
 * must check, what it told the player, what the draft checks caught, the risk
 * flags and the mood, the files, and the step it suggests. "Copy" puts the
 * card's own text on the clipboard, for a ticket or a colleague.
 *
 * The same component wherever a card is shown: at the top of the Details
 * panel (the newest), on the card's line in the transcript, and in the
 * archive, which is the same two panes.
 *
 * What it never shows is the server's to keep off: a sensitive slot arrives
 * without its value (`sensitive: true`) and reads "shared, not shown on the
 * card"; an internal note is never on a card at all. The player's identity is
 * their own claim and says so.
 *
 * The verdict — enough to start, or not — is one click and optional
 * (AI-10-S2); the server keeps one per card, the last click's. Only someone
 * who may write in the conversation is offered the buttons (the route's own
 * gate); anyone else sees the verdict already given.
 */
import { useId, useState, type ReactElement, type ReactNode } from 'react';
import {
  AI_HANDOFF_FEEDBACK_REASON_MAX,
  hasAnyScope,
  type AiHandoffCardView,
  type AiHandoffFeedback,
} from '@siyahtus/types';
import { Banner, PanelSection } from '../../components/ui/index.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useAuth } from '../../lib/auth-store.js';
import { formatDateTime, formatTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  PRIORITY_TONE,
  SLOT_STATUS_MARK,
  isKnowledgeMissReason,
  playerParts,
} from './handoffCard.js';
import type { ChatEvent } from './types.js';
import {
  useAiHandoffFeedback,
  useChatAiHandoffs,
  useUnneededHandoffSuggestion,
} from './useAiHandoffs.js';

/** Who may give a verdict: whoever may write in the conversation (the route's gate). */
export const JUDGE_SCOPES = ['chats--all:rw', 'chats--access:rw'];

/** The Details panel's first section: the newest card of the chat. */
export function AiHandoffSection({
  card,
  chatId,
  canJudge,
}: {
  card: AiHandoffCardView;
  chatId: string;
  canJudge: boolean;
}): ReactElement {
  const t = useTranslate();
  return (
    <PanelSection title={t('inbox.handoffCard.section')}>
      <AiHandoffCard card={card} chatId={chatId} canJudge={canJudge} />
    </PanelSection>
  );
}

/**
 * The card's line in the transcript (AI-10 §5): the hand-over, where it
 * happened among the messages, with the card behind one click. The line is the
 * agents-only system event the hand-over wrote; the card is read from the
 * day's cards, so an earlier connection's opens as well as the newest. Until
 * that read answers — or if it cannot — the line opens the card's own text,
 * which the event carries.
 */
export function AiHandoffCardLine({
  event,
  cardId,
}: {
  event: ChatEvent;
  cardId: string;
}): ReactElement {
  const t = useTranslate();
  const scopes = useAuth((s) => s.agent?.scopes) ?? [];
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const cards = useChatAiHandoffs(event.chat_id);
  const card = cards.data?.items.find((item) => item.id === cardId) ?? null;
  return (
    <div data-ai-handoff-line={cardId} className="flex flex-col items-center gap-1.5 self-stretch">
      <p className="flex flex-wrap items-center justify-center gap-2 text-2xs text-content-tertiary">
        <span>
          {card
            ? t('inbox.handoffCard.line', { reason: reasonText(t, card) })
            : t('inbox.handoffCard.lineGeneric')}
          {' · '}
          {formatTime(event.created_at)}
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
          className="rounded-sm border border-border px-1.5 py-0.5 font-medium text-content-secondary hover:bg-surface-2"
        >
          {open ? t('inbox.handoffCard.lineHide') : t('inbox.handoffCard.lineShow')}
        </button>
      </p>
      {open && (
        <div id={bodyId} className="w-full max-w-md rounded-lg border border-border bg-surface p-3">
          {card ? (
            <AiHandoffCard
              card={card}
              chatId={event.chat_id}
              canJudge={hasAnyScope(scopes, JUDGE_SCOPES)}
              defaultExpanded
            />
          ) : (
            <p className="whitespace-pre-wrap break-words text-xs">{event.text}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function AiHandoffCard({
  card,
  chatId,
  canJudge,
  defaultExpanded = false,
}: {
  card: AiHandoffCardView;
  chatId: string;
  /** The caller may write in the conversation — the feedback route's gate. */
  canJudge: boolean;
  defaultExpanded?: boolean;
}): ReactElement {
  const t = useTranslate();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const detailsId = useId();
  const player = playerParts(card);
  const otherReasons = card.reason_codes.filter((reason) => reason !== card.primary_reason);

  return (
    <article
      data-ai-handoff={card.id}
      aria-label={t('inbox.handoffCard.ariaLabel')}
      className="flex flex-col gap-2 text-xs"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          data-priority={card.priority}
          className={`rounded-sm px-1.5 py-0.5 text-2xs font-medium ${PRIORITY_TONE[card.priority]}`}
        >
          {t(`inbox.priority.${card.priority}`)}
        </span>
        <span className="text-2xs text-content-tertiary">{formatDateTime(card.created_at)}</span>
      </div>

      <p className="font-medium text-content" data-testid="ai-handoff-summary">
        {card.summary}
      </p>

      <Line label={t('inbox.handoffCard.reason')}>
        {reasonText(t, card)}
        {otherReasons.length > 0 && (
          <span className="text-content-tertiary">
            {' '}
            {t('inbox.handoffCard.moreReasons', { count: otherReasons.length })}
          </span>
        )}
      </Line>

      <Line label={t('inbox.handoffCard.player')}>
        <span className="flex flex-col gap-1">
          <span className="break-words">
            {player.length > 0 ? player.join(' · ') : t('inbox.handoffCard.playerUnknown')}
          </span>
          <span className="flex flex-wrap gap-1">
            <Badge>{t('inbox.handoffCard.declared')}</Badge>
            {card.player.recognized_device && (
              <Badge tone="success">{t('inbox.handoffCard.recognizedDevice')}</Badge>
            )}
          </span>
        </span>
      </Line>

      {card.accepted_at && (
        <p className="text-2xs text-content-tertiary">
          {t('inbox.handoffCard.accepted', { time: formatTime(card.accepted_at) ?? '' })}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((open) => !open)}
          className="rounded-sm border border-border px-2 py-0.5 text-2xs hover:bg-surface-2"
        >
          {expanded ? t('inbox.handoffCard.hideDetails') : t('inbox.handoffCard.showDetails')}
        </button>
        <CopyButton text={card.card_text} />
      </div>

      {expanded && <CardDetails id={detailsId} card={card} />}

      <Feedback card={card} chatId={chatId} canJudge={canJudge} />
    </article>
  );
}

/** The primary reason in words — the button's own when the player pressed it (tm 308 · AI-29). */
function reasonText(t: (key: string) => string, card: AiHandoffCardView): string {
  return card.requested_via === 'button'
    ? t('inbox.handoffCard.viaButton')
    : t(`playbook.handoff.reason.${card.primary_reason}`);
}

function CardDetails({ id, card }: { id: string; card: AiHandoffCardView }): ReactElement {
  const t = useTranslate();
  const facts = card.decision_facts.filter((fact) => fact.text !== null);
  return (
    <div id={id} className="flex flex-col gap-2 border-t border-border pt-2">
      {card.topic && <Line label={t('inbox.handoffCard.topic')}>{card.topic}</Line>}
      {card.question && (
        <Line label={t('inbox.handoffCard.question')}>
          <span className="whitespace-pre-wrap break-words">{card.question}</span>
        </Line>
      )}

      {card.slots.length > 0 && (
        <Block title={t('inbox.handoffCard.slots')}>
          <ul className="flex flex-col gap-1">
            {card.slots.map((slot) => (
              <li key={slot.slot} data-slot={slot.slot} className="flex gap-1.5">
                <span aria-hidden="true" className="w-3 shrink-0 text-center">
                  {SLOT_STATUS_MARK[slot.status]}
                </span>
                <span className="min-w-0 break-words">
                  <span className="font-medium">{slot.label}: </span>
                  {slot.sensitive ? (
                    <span className="text-content-secondary">
                      {t('inbox.handoffCard.sensitive')}
                    </span>
                  ) : (
                    (slot.text ?? '—')
                  )}
                  <span className="text-content-tertiary">
                    {' · '}
                    {t(`playbook.procedure.slotStatus.${slot.status}`)}
                    {slot.out_of_range &&
                      ` · ${t(`inbox.handoffCard.outOfRange.${slot.out_of_range}`)}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {facts.length > 0 && (
        <Block title={t('inbox.handoffCard.facts')}>
          <ul className="flex flex-col gap-1">
            {facts.map((fact) => (
              <li key={fact.field} className="break-words">
                {fact.field === 'knowledge' && isKnowledgeMissReason(fact.text) ? (
                  t(`inbox.handoffCard.knowledgeMiss.${fact.text}`)
                ) : (
                  <>
                    <span className="font-medium">{fact.field}: </span>
                    {fact.text}
                  </>
                )}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {card.checks.length > 0 && (
        <Block title={t('inbox.handoffCard.checks')}>
          <ul className="list-disc pl-4">
            {card.checks.map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ul>
        </Block>
      )}

      <Block title={t('inbox.handoffCard.statements')}>
        {card.ai_statements.length === 0 ? (
          <p className="text-content-tertiary">{t('inbox.handoffCard.statementsEmpty')}</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {card.ai_statements.map((statement) => (
              <li key={statement.event_id} className="break-words">
                <span className="tabular text-content-tertiary">
                  {formatTime(statement.created_at)}{' '}
                </span>
                {statement.text}
              </li>
            ))}
          </ol>
        )}
      </Block>

      <Line label={t('inbox.handoffCard.outputChecks')}>
        {card.output_check_flags.length === 0
          ? t('inbox.handoffCard.outputChecksNone')
          : card.output_check_flags
              .map((flag) => t(`inbox.handoffCard.outputFlag.${flag}`))
              .join(' · ')}
      </Line>

      <Line label={t('inbox.handoffCard.reasons')}>
        {card.reason_codes.map((reason) => t(`playbook.handoff.reason.${reason}`)).join(' · ')}
      </Line>

      <Line label={t('inbox.handoffCard.risk')}>
        {card.risk_flags.length === 0
          ? t('inbox.handoffCard.riskNone')
          : card.risk_flags.map((flag) => t(`inbox.risk.type.${flag}`)).join(' · ')}
      </Line>

      <Line label={t('inbox.handoffCard.sentiment')}>
        {card.sentiment
          ? t(`inbox.handoffCard.sentimentValue.${card.sentiment}`)
          : t('inbox.handoffCard.sentimentNone')}
      </Line>

      {card.attachments.length > 0 && (
        <Line label={t('inbox.handoffCard.attachments')}>
          {card.attachments
            .map((file) => file.name ?? t('inbox.handoffCard.attachmentUnnamed'))
            .join(' · ')}
        </Line>
      )}

      {card.suggested_next_step && (
        <Line label={t('inbox.handoffCard.nextStep')}>{card.suggested_next_step}</Line>
      )}
    </div>
  );
}

function Feedback({
  card,
  chatId,
  canJudge,
}: {
  card: AiHandoffCardView;
  chatId: string;
  canJudge: boolean;
}): ReactElement | null {
  const t = useTranslate();
  const judge = useAiHandoffFeedback(chatId);
  const unneeded = useUnneededHandoffSuggestion();
  const [reason, setReason] = useState(card.feedback_reason ?? '');
  const reasonId = useId();

  if (!canJudge) {
    return card.feedback ? (
      <p className="text-2xs text-content-tertiary">
        {t(`inbox.handoffCard.feedback.given.${card.feedback}`)}
      </p>
    ) : null;
  }

  const give = (value: AiHandoffFeedback, withReason?: string): void => {
    const trimmed = withReason?.trim();
    judge.mutate({
      handoffId: card.id,
      value,
      ...(trimmed ? { reason: trimmed } : {}),
    });
  };

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2">
      <div
        role="group"
        aria-label={t('inbox.handoffCard.feedback.question')}
        className="flex flex-wrap items-center gap-1.5"
      >
        <span className="text-2xs text-content-secondary">
          {t('inbox.handoffCard.feedback.question')}
        </span>
        {(['sufficient', 'insufficient'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={card.feedback === value}
            disabled={judge.isPending}
            onClick={() => {
              // A second click on the verdict already given changes nothing.
              if (card.feedback !== value) give(value);
            }}
            className={`rounded-sm border px-2 py-0.5 text-2xs disabled:opacity-50 ${
              card.feedback === value
                ? 'border-brand-500 bg-brand-500/10 font-medium text-content'
                : 'border-border hover:bg-surface-2'
            }`}
          >
            {t(`inbox.handoffCard.feedback.${value}`)}
          </button>
        ))}
      </div>
      {card.feedback === 'insufficient' && (
        <div className="flex flex-col gap-1">
          <label htmlFor={reasonId} className="text-2xs text-content-secondary">
            {t('inbox.handoffCard.feedback.reasonLabel')}
          </label>
          <div className="flex gap-1.5">
            <input
              id={reasonId}
              value={reason}
              maxLength={AI_HANDOFF_FEEDBACK_REASON_MAX}
              onChange={(event) => setReason(event.target.value)}
              className="min-w-0 flex-1 rounded-sm border border-border bg-inset px-2 py-1 text-xs"
            />
            <button
              type="button"
              disabled={
                judge.isPending || reason.trim().length === 0 || reason === card.feedback_reason
              }
              onClick={() => give('insufficient', reason)}
              className="rounded-sm border border-border px-2 py-1 text-xs disabled:opacity-50"
            >
              {t('inbox.handoffCard.feedback.reasonSave')}
            </button>
          </div>
        </div>
      )}
      {/* The one verdict that opens a suggestion (AI-23): the AI should have kept it. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={unneeded.isPending || unneeded.isSuccess}
          onClick={() => unneeded.mutate(card)}
          className="rounded-sm border border-border px-2 py-0.5 text-2xs hover:bg-surface-2 disabled:opacity-50"
        >
          {t('inbox.handoffCard.feedback.unneeded')}
        </button>
        {unneeded.isSuccess && (
          <span role="status" className="text-2xs text-content-tertiary">
            {t('inbox.handoffCard.feedback.unneededDone')}
          </span>
        )}
      </div>
      {judge.isError && <Banner tone="danger">{t(errorMessageKey(judge.error))}</Banner>}
      {unneeded.isError && <Banner tone="danger">{t(errorMessageKey(unneeded.error))}</Banner>}
    </div>
  );
}

function CopyButton({ text }: { text: string }): ReactElement {
  const t = useTranslate();
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      },
      () => setCopied(false),
    );
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-sm border border-border px-2 py-0.5 text-2xs hover:bg-surface-2"
    >
      {copied ? t('inbox.handoffCard.copied') : t('inbox.handoffCard.copy')}
    </button>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xs text-content-tertiary">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    // Not a heading: the panel's sections are disclosure summaries, and a
    // heading here would skip levels under the panel's own title.
    <div className="flex flex-col gap-1">
      <span className="text-2xs text-content-tertiary">{title}</span>
      {children}
    </div>
  );
}

function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success';
}): ReactElement {
  return (
    <span
      className={`rounded-sm px-1.5 text-2xs ${
        tone === 'success' ? 'bg-success/10 text-success' : 'bg-inset text-content-secondary'
      }`}
    >
      {children}
    </span>
  );
}
