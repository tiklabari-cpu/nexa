/**
 * "Promotions blocked" (EN-01 · tm 350): the badge the inbox's Risk section
 * and the customer profile show while a risk flag keeps the player from
 * campaigns, and the profile's Risk card — the player's active flags, each
 * with the same Clear dialog the inbox uses (a reason, the type's clearer and
 * up; the server is the boundary).
 *
 * Whether the player is blocked is the server's answer
 * (`promo_suppressed` on `GET /customers/{id}/risk-flags`): it reads every
 * flag of theirs and of the records linked to them as the same person, under
 * the workspace's policy — flags this panel may not see among them.
 */
import { useState, type ReactElement } from 'react';
import { Card } from '../../components/Page.js';
import { useAuth } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { RiskChip } from './RiskChips.js';
import { ClearFlagDialog } from './RiskDialogs.js';
import { activeFlagsOf, clearerRole, mayClear, type RiskFlagItem } from './riskFlags.js';
import { useCustomerRiskFlags } from './useRiskFlags.js';

export function PromoBlockedBadge(): ReactElement {
  const t = useTranslate();
  return (
    <span
      data-testid="promo-blocked"
      title={t('inbox.risk.promoBlockedHint')}
      className="inline-flex items-center rounded-sm border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-2xs font-medium text-danger"
    >
      {t('inbox.risk.promoBlocked')}
    </span>
  );
}

/**
 * The profile's Risk card. Nothing at all for a player with no active flag
 * and no block, or when the list cannot be read (the caller may lack the chat
 * read scope) — the profile then says nothing it could not check.
 */
export function CustomerRiskCard({ customerId }: { customerId: string }): ReactElement | null {
  const t = useTranslate();
  const role = useAuth((s) => s.agent?.role ?? null);
  const list = useCustomerRiskFlags(customerId);
  const [clearing, setClearing] = useState<RiskFlagItem | null>(null);

  // Every scope: a fraud flag raised in last week's chat keeps campaigns away too.
  const flags = activeFlagsOf(list.data?.items ?? [], []);
  const blocked = list.data?.promo_suppressed === true;
  if (flags.length === 0 && !blocked) return null;

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-content-tertiary">
          {t('customers.detail.risk.heading')}
        </h3>
        {blocked && <PromoBlockedBadge />}
      </div>
      {blocked && (
        <p className="px-4 pt-2.5 text-2xs text-content-tertiary">
          {t('inbox.risk.promoBlockedHint')}
        </p>
      )}
      {flags.length > 0 && (
        <ul className="flex flex-col gap-2 p-4">
          {flags.map((flag) => (
            <li
              key={flag.id}
              data-risk-flag={flag.type}
              className="flex flex-wrap items-center gap-1.5 text-xs"
            >
              <RiskChip flag={flag} />
              <span className="text-2xs text-content-tertiary">
                {formatDateTime(flag.raised_at)}
              </span>
              {mayClear(flag, role) ? (
                <button
                  type="button"
                  onClick={() => setClearing(flag)}
                  aria-label={t('inbox.risk.clear.ctaFor', {
                    type: t(`inbox.risk.type.${flag.type}`),
                  })}
                  className="ml-auto rounded-sm border border-border px-2 py-0.5 text-2xs hover:bg-surface-2"
                >
                  {t('inbox.risk.clear.cta')}
                </button>
              ) : (
                <span className="ml-auto text-2xs text-content-tertiary">
                  {t('inbox.risk.clear.restricted', {
                    role: t(`team.role.${clearerRole(flag.type)}`),
                  })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {clearing && <ClearFlagDialog flag={clearing} onClose={() => setClearing(null)} />}
    </Card>
  );
}
