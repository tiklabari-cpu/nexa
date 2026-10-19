/**
 * The two dialogs of the Risk section (AI-27 · tm 302.3): flag a conversation,
 * and clear a flag.
 *
 * Both confirm in a dialog because both change what the AI and the campaign
 * engine are allowed to do for a player, and a refusal needs a sentence — the
 * server words one for a clear below the type's clearer, and a second clear.
 * Clearing asks for a reason (AI-27-S2): it is kept on the flag for those
 * entitled to read it and never leaves the workspace in a webhook.
 */
import { useState, type ReactElement } from 'react';
import {
  RISK_FLAG_CLEAR_REASON_MAX,
  RISK_FLAG_DEFAULTS,
  RISK_FLAG_NOTE_MAX,
  type RiskFlagType,
} from '@siyahtus/types';
import { Banner, Modal } from '../../components/ui/index.js';
import { useTranslate } from '../../lib/i18n.js';
import { isRiskFlagType, isSelfExclusion, policyKeys, riskFlagErrorKey } from './riskFlags.js';
import type { RiskFlagItem } from './riskFlags.js';
import { useClearRiskFlag, useRaiseRiskFlag } from './useRiskFlags.js';

const FIELD =
  'mt-1 w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none';

function Buttons({
  onCancel,
  onConfirm,
  disabled,
  pending,
  confirm,
  pendingLabel,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  disabled: boolean;
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
        {t('inbox.risk.cancel')}
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled || pending}
        className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
      >
        {pending ? pendingLabel : confirm}
      </button>
    </div>
  );
}

/** What a flag of `type` does the moment it is raised, so nobody flags blind. */
function Consequences({ type }: { type: RiskFlagType }): ReactElement {
  const t = useTranslate();
  const defaults = RISK_FLAG_DEFAULTS[type];
  const keys = policyKeys(type);
  return (
    <div className="mt-3 rounded-md border border-border bg-inset p-2 text-2xs text-content-secondary">
      <p>
        {t('inbox.risk.add.severityIs', {
          severity: t(`inbox.risk.severity.${defaults.severity}`),
        })}{' '}
        {defaults.scope === 'member' ? t('inbox.risk.add.staysOnPlayer') : null}
      </p>
      {keys.length > 0 ? (
        <ul className="mt-1 list-disc pl-4">
          {keys.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1">{t('inbox.risk.add.noPolicy')}</p>
      )}
    </div>
  );
}

/** "Flag this conversation": a type from those it does not already carry, and an optional note. */
export function AddFlagDialog({
  chatId,
  types,
  onClose,
}: {
  chatId: string;
  /** The types still free to raise. */
  types: readonly RiskFlagType[];
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const raise = useRaiseRiskFlag(chatId);
  const [type, setType] = useState<string>(types[0] ?? '');
  const [note, setNote] = useState('');
  const chosen = isRiskFlagType(type) ? type : null;

  return (
    <Modal onClose={onClose} title={t('inbox.risk.add.title')}>
      <p className="text-sm text-content-secondary">{t('inbox.risk.add.body')}</p>
      {types.length === 0 ? (
        <p className="mt-3 text-sm">{t('inbox.risk.add.allRaised')}</p>
      ) : (
        <>
          <label htmlFor="risk-add-type" className="mt-3 block text-xs font-medium">
            {t('inbox.risk.add.typeLabel')}
          </label>
          <select
            id="risk-add-type"
            value={type}
            onChange={(event) => setType(event.target.value)}
            className={FIELD}
          >
            {types.map((option) => (
              <option key={option} value={option}>
                {t(`inbox.risk.type.${option}`)}
              </option>
            ))}
          </select>
          {chosen && <Consequences type={chosen} />}
          <label htmlFor="risk-add-note" className="mt-3 block text-xs font-medium">
            {t('inbox.risk.add.noteLabel')}
          </label>
          <textarea
            id="risk-add-note"
            rows={3}
            maxLength={RISK_FLAG_NOTE_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-describedby="risk-add-note-hint"
            className={FIELD}
          />
          <p id="risk-add-note-hint" className="mt-1 text-2xs text-content-tertiary">
            {t('inbox.risk.add.noteHint')}
          </p>
        </>
      )}
      {raise.isError && (
        <Banner tone="danger" className="mt-3">
          {t(riskFlagErrorKey(raise.error))}
        </Banner>
      )}
      <Buttons
        onCancel={onClose}
        onConfirm={() => {
          if (!chosen) return;
          const text = note.trim();
          raise.mutate({ type: chosen, ...(text ? { note: text } : {}) }, { onSuccess: onClose });
        }}
        disabled={chosen === null}
        pending={raise.isPending}
        confirm={t('inbox.risk.add.confirm')}
        pendingLabel={t('inbox.risk.add.pending')}
      />
    </Modal>
  );
}

/** "Clear this flag": the reason is required, and a self-exclusion's clear is explained. */
export function ClearFlagDialog({
  flag,
  onClose,
}: {
  flag: RiskFlagItem;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const clear = useClearRiskFlag();
  const [reason, setReason] = useState('');
  const text = reason.trim();

  return (
    <Modal
      onClose={onClose}
      title={t('inbox.risk.clear.title', { type: t(`inbox.risk.type.${flag.type}`) })}
    >
      <p className="text-sm text-content-secondary">{t('inbox.risk.clear.body')}</p>
      {isSelfExclusion(flag.type) && (
        <Banner tone="warning" className="mt-3">
          {t('inbox.risk.clear.selfExclusionNote')}
        </Banner>
      )}
      <label htmlFor="risk-clear-reason" className="mt-3 block text-xs font-medium">
        {t('inbox.risk.clear.reasonLabel')}
      </label>
      <textarea
        id="risk-clear-reason"
        rows={3}
        required
        maxLength={RISK_FLAG_CLEAR_REASON_MAX}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        aria-describedby="risk-clear-reason-hint"
        className={FIELD}
      />
      <p id="risk-clear-reason-hint" className="mt-1 text-2xs text-content-tertiary">
        {t('inbox.risk.clear.reasonHint')}
      </p>
      {clear.isError && (
        <Banner tone="danger" className="mt-3">
          {t(riskFlagErrorKey(clear.error))}
        </Banner>
      )}
      <Buttons
        onCancel={onClose}
        onConfirm={() => clear.mutate({ flagId: flag.id, reason: text }, { onSuccess: onClose })}
        disabled={text === ''}
        pending={clear.isPending}
        confirm={t('inbox.risk.clear.confirm')}
        pendingLabel={t('inbox.risk.clear.pending')}
      />
    </Modal>
  );
}
