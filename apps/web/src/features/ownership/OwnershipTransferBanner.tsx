/**
 * The pending ownership offer, on every signed-in page (RL-05 · tm 328.2).
 *
 * A workspace changing hands is something the owner, the admins and the member
 * it is offered to should not discover only by opening Settings. The server
 * shows the pending transfer to exactly those three and answers `null` to
 * everyone else, so this reads it and draws nothing when there is none — no
 * role check of its own, the read is the check.
 *
 *  - the **owner** sees who it is offered to, until when, and a way to the
 *    Danger zone where it is taken back;
 *  - the **member offered it** sees who is offering, and a way to the accept
 *    page (the token itself is only in their mail);
 *  - an **admin** is told, with nothing to do.
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Banner } from '../../components/ui/index.js';
import { useAuth } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { partyLabel, useCurrentOwnershipTransfer } from './ownership-transfer.js';

const LINK_CLASS = 'text-sm font-medium text-content-brand underline';

export function OwnershipTransferBanner(): ReactElement | null {
  const t = useTranslate();
  const selfId = useAuth((s) => s.agent?.account_id ?? null);
  const { data: transfer } = useCurrentOwnershipTransfer();

  if (!transfer || transfer.state !== 'pending') return null;

  const params = {
    from: partyLabel(transfer.from_agent),
    to: partyLabel(transfer.to_agent),
    expires: formatDateTime(transfer.expires_at) ?? '',
  };

  let message: string;
  let cta: ReactElement | undefined;
  if (transfer.to_agent.id === selfId) {
    message = t('settings.ownership.banner.offeredToYou', params);
    cta = (
      <Link to={`/app/ownership-transfer?transfer=${transfer.id}`} className={LINK_CLASS}>
        {t('settings.ownership.banner.review')}
      </Link>
    );
  } else if (transfer.from_agent.id === selfId) {
    message = t('settings.ownership.banner.offeredByYou', params);
    cta = (
      <Link to="/app/settings/company" className={LINK_CLASS}>
        {t('settings.ownership.banner.manage')}
      </Link>
    );
  } else {
    message = t('settings.ownership.banner.pending', params);
  }

  return (
    <div data-testid="ownership-transfer-banner" className="border-b border-border px-4 py-1.5">
      <Banner tone="warning" cta={cta}>
        {message}
      </Banner>
    </div>
  );
}
