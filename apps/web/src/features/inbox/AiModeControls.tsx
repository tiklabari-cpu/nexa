/**
 * The transcript header's AI badge and its actions (AI-11 · tm 293.5): who
 * answers the open conversation — "AI answering", "With a person", "AI
 * paused" — and, for whoever may, "Pause AI" and "Return to AI". A supervisor
 * takes the chat off the AI with the takeover they already have, in the
 * Details panel; an agent by writing to the visitor. Which badge and which
 * actions is `aiMode.ts`; the badge follows the
 * `chat_ai_mode_changed` push (`useInbox.ts`), so it moves the moment the mode
 * does, whoever moved it.
 *
 * Every action confirms in a dialog, and the dialog is where a refusal is
 * worded — a header has no room for a sentence. Narrow, the badge keeps its
 * glyph and the actions their accessible names, as the header's others do.
 */
import { useState, type ReactElement } from 'react';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { Banner, Modal } from '../../components/ui/index.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import type { AiReturnResume } from '@siyahtus/types';
import { aiModeActions, aiModeBadge } from './aiMode.js';
import { actionClass } from './headerAction.js';
import { SUPERVISOR_ROLES } from './roles.js';
import { useChatAction } from './useInbox.js';
import type { AiMode, ChatDetail } from './types.js';

const TONE: Record<AiMode, StatusTone> = { ai: 'info', human: 'neutral', paused: 'warning' };
const LABEL = {
  ai: 'inbox.thread.aiMode.ai',
  human: 'inbox.thread.aiMode.human',
  paused: 'inbox.thread.aiMode.paused',
} as const satisfies Record<AiMode, string>;
const HINT = {
  ai: 'inbox.thread.aiMode.aiHint',
  human: 'inbox.thread.aiMode.humanHint',
  paused: 'inbox.thread.aiMode.pausedHint',
} as const satisfies Record<AiMode, string>;

type Dialog = 'pause' | 'giveBack' | null;

export function AiModeControls({
  chat,
  chatId,
  compact,
}: {
  chat: ChatDetail;
  chatId: string;
  compact: boolean;
}): ReactElement | null {
  const t = useTranslate();
  const me = useAuth((s) => s.agent?.account_id ?? null);
  const role = useAuth((s) => s.agent?.role ?? null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const badge = aiModeBadge(chat);
  if (badge === null) return null;

  const assigneeId = chat.thread?.assignee_id ?? null;
  const actions = aiModeActions(badge, {
    isAssignee: me !== null && assigneeId === me,
    isSupervisor: role !== null && SUPERVISOR_ROLES.has(role),
  });
  const label = t(LABEL[badge]);
  const close = (): void => setDialog(null);

  return (
    <>
      <span title={t(HINT[badge])} data-ai-mode={badge}>
        <StatusDot compact={compact} tone={TONE[badge]} label={label} />
      </span>
      {actions.pause && (
        <HeaderAction
          glyph="⏸"
          label={t('inbox.thread.aiMode.pause')}
          compact={compact}
          onClick={() => setDialog('pause')}
        />
      )}
      {actions.giveBack && (
        <HeaderAction
          glyph="↩"
          label={t('inbox.thread.aiMode.giveBack')}
          compact={compact}
          onClick={() => setDialog('giveBack')}
        />
      )}
      {dialog === 'pause' && <PauseDialog chatId={chatId} onClose={close} />}
      {dialog === 'giveBack' && <ReturnDialog chatId={chatId} onClose={close} />}
    </>
  );
}

function HeaderAction({
  glyph,
  label,
  compact,
  onClick,
}: {
  glyph: string;
  label: string;
  compact: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={actionClass(compact)}
    >
      {compact ? <span aria-hidden="true">{glyph}</span> : label}
    </button>
  );
}

/** "Pause AI": the AI stops answering; the assignment stays as it was. */
function PauseDialog({ chatId, onClose }: { chatId: string; onClose: () => void }): ReactElement {
  const t = useTranslate();
  const actions = useChatAction(chatId);
  const [note, setNote] = useState('');
  const pause = actions.pauseAi;

  return (
    <Modal onClose={onClose} title={t('inbox.thread.aiMode.pauseDialog.title')}>
      <p className="text-sm text-content-secondary">{t('inbox.thread.aiMode.pauseDialog.body')}</p>
      <NoteField
        id="ai-pause-note"
        label={t('inbox.thread.aiMode.pauseDialog.noteLabel')}
        value={note}
        onChange={setNote}
      />
      {pause.isError && (
        <Banner tone="danger" className="mt-3">
          {t(errorMessageKey(pause.error))}
        </Banner>
      )}
      <DialogButtons
        onCancel={onClose}
        onConfirm={() => pause.mutate(note.trim() || undefined, { onSuccess: onClose })}
        pending={pause.isPending}
        confirm={t('inbox.thread.aiMode.pauseDialog.confirm')}
        pendingLabel={t('inbox.thread.aiMode.pauseDialog.pending')}
      />
    </Modal>
  );
}

/** "Return to AI": the AI answers again from the visitor's next message. */
function ReturnDialog({ chatId, onClose }: { chatId: string; onClose: () => void }): ReactElement {
  const t = useTranslate();
  const actions = useChatAction(chatId);
  const [note, setNote] = useState('');
  const [resume, setResume] = useState<AiReturnResume>('continue');
  const giveBack = actions.returnToAi;

  return (
    <Modal onClose={onClose} title={t('inbox.thread.aiMode.return.title')}>
      <p className="text-sm text-content-secondary">{t('inbox.thread.aiMode.return.body')}</p>
      <NoteField
        id="ai-return-note"
        label={t('inbox.thread.aiMode.return.noteLabel')}
        value={note}
        onChange={setNote}
      />
      <label htmlFor="ai-return-resume" className="mt-3 block text-xs font-medium">
        {t('inbox.thread.aiMode.return.resumeLabel')}
      </label>
      <select
        id="ai-return-resume"
        value={resume}
        onChange={(event) => setResume(event.target.value as AiReturnResume)}
        className="mt-1 w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm"
      >
        <option value="continue">{t('inbox.thread.aiMode.return.resumeContinue')}</option>
        <option value="fresh">{t('inbox.thread.aiMode.return.resumeFresh')}</option>
      </select>
      {giveBack.isError && (
        // `ai_return_blocked` (a risk flag) and a 403 read differently, from
        // the error type — the catalogue words both.
        <Banner tone="danger" className="mt-3">
          {t(errorMessageKey(giveBack.error))}
        </Banner>
      )}
      <DialogButtons
        onCancel={onClose}
        onConfirm={() =>
          giveBack.mutate(
            { resume, ...(note.trim() ? { note: note.trim() } : {}) },
            { onSuccess: onClose },
          )
        }
        pending={giveBack.isPending}
        confirm={t('inbox.thread.aiMode.return.confirm')}
        pendingLabel={t('inbox.thread.aiMode.return.pending')}
      />
    </Modal>
  );
}

function NoteField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <>
      <label htmlFor={id} className="mt-3 block text-xs font-medium">
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        maxLength={500}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm"
      />
    </>
  );
}

function DialogButtons({
  onCancel,
  onConfirm,
  pending,
  confirm,
  pendingLabel,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
  confirm: string;
  pendingLabel: string;
}): ReactElement {
  const t = useTranslate();
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md border border-border px-3 py-1.5 text-sm"
      >
        {t('inbox.thread.aiMode.cancel')}
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending}
        className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
      >
        {pending ? pendingLabel : confirm}
      </button>
    </div>
  );
}
