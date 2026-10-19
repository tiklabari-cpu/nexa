/**
 * The Details panel's "Risk" section (AI-27 · tm 302.3): every active flag on
 * the conversation and on the player behind it, what each one does, and the
 * two actions — flag the conversation, clear a flag.
 *
 * What it shows follows the server, not the panel's own idea of who may know
 * what: the type and the severity are everyone's, the note is shown only when
 * the flag arrives with `details_visible` (the Responsible Gaming team and a
 * Team Lead and up). A flag raised in an earlier conversation of the same
 * player says so — it is why the AI hands this one over before the player has
 * said a word — and a player's own claim is marked as a claim: until an
 * identity check exists a flag's `basis` is `declared` (AI-27-S3), and an
 * agent must not read it as proof.
 *
 * A flag cannot be deleted, only cleared with a reason, and not by everyone
 * (`mayClear`): below the type's clearer the button is replaced by who may.
 */
import { useState, type ReactElement } from 'react';
import { PanelSection } from '../../components/ui/index.js';
import { useAuth } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { RiskChip } from './RiskChips.js';
import { AddFlagDialog, ClearFlagDialog } from './RiskDialogs.js';
import {
  clearerRole,
  flaggableTypes,
  isFromEarlierChat,
  mayClear,
  policyKeys,
  staysOnPlayer,
  type RiskFlagItem,
} from './riskFlags.js';
import { useActiveRiskFlags } from './useRiskFlags.js';

export function RiskSection({
  chatId,
  customerId,
  canFlag,
}: {
  chatId: string;
  customerId: string | null;
  /** The caller may write in the conversation — the route's own gate for a raise. */
  canFlag: boolean;
}): ReactElement {
  const t = useTranslate();
  const role = useAuth((s) => s.agent?.role ?? null);
  const { flags, pending, failed } = useActiveRiskFlags(chatId, customerId);
  const [adding, setAdding] = useState(false);
  const [clearing, setClearing] = useState<RiskFlagItem | null>(null);
  const free = flaggableTypes(flags, chatId);

  return (
    <PanelSection title={t('inbox.risk.section')}>
      {pending ? (
        <p className="text-xs text-content-tertiary">{t('inbox.risk.loading')}</p>
      ) : failed ? (
        <p role="alert" className="text-xs text-danger">
          {t('inbox.risk.loadError')}
        </p>
      ) : flags.length === 0 ? (
        <p className="text-xs text-content-tertiary">{t('inbox.risk.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {flags.map((flag) => (
            <FlagCard
              key={flag.id}
              flag={flag}
              earlier={isFromEarlierChat(flag, chatId)}
              clearable={mayClear(flag, role)}
              onClear={() => setClearing(flag)}
            />
          ))}
        </ul>
      )}
      {canFlag && !pending && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-3 rounded-sm border border-border px-2 py-1 text-xs hover:bg-surface-2"
        >
          {t('inbox.risk.add.cta')}
        </button>
      )}
      {adding && <AddFlagDialog chatId={chatId} types={free} onClose={() => setAdding(false)} />}
      {clearing && <ClearFlagDialog flag={clearing} onClose={() => setClearing(null)} />}
    </PanelSection>
  );
}

function FlagCard({
  flag,
  earlier,
  clearable,
  onClear,
}: {
  flag: RiskFlagItem;
  earlier: boolean;
  clearable: boolean;
  onClear: () => void;
}): ReactElement {
  const t = useTranslate();
  const policy = policyKeys(flag.type);
  return (
    <li data-risk-flag={flag.type} className="flex flex-col gap-1 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <RiskChip flag={flag} />
        <span className="text-2xs text-content-tertiary">
          {t(`inbox.risk.severity.${flag.severity}`)} · {t(`inbox.risk.source.${flag.source}`)} ·{' '}
          {formatDateTime(flag.raised_at)}
        </span>
      </div>
      {earlier && <p className="text-2xs text-content-secondary">{t('inbox.risk.earlierChat')}</p>}
      {staysOnPlayer(flag.type) && !earlier && (
        <p className="text-2xs text-content-secondary">{t('inbox.risk.staysOnPlayer')}</p>
      )}
      {flag.basis === 'declared' && (
        <p className="text-2xs text-content-secondary">{t('inbox.risk.declared')}</p>
      )}
      {policy.length > 0 && (
        <ul className="list-disc pl-4 text-2xs text-content-secondary">
          {policy.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      )}
      {flag.details_visible && flag.note && (
        <p className="rounded-sm bg-inset px-2 py-1 text-2xs">
          <span className="font-medium">{t('inbox.risk.noteLabel')}: </span>
          {flag.note}
        </p>
      )}
      {clearable ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={t('inbox.risk.clear.ctaFor', { type: t(`inbox.risk.type.${flag.type}`) })}
          className="self-start rounded-sm border border-border px-2 py-0.5 text-2xs hover:bg-surface-2"
        >
          {t('inbox.risk.clear.cta')}
        </button>
      ) : (
        <p className="text-2xs text-content-tertiary">
          {t('inbox.risk.clear.restricted', { role: t(`team.role.${clearerRole(flag.type)}`) })}
        </p>
      )}
    </li>
  );
}
