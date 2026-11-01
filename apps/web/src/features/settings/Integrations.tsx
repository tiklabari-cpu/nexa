/**
 * Settings → Integrations entry (FR-MOD-08.8.1).
 *
 * Its own file rather than a section inside `SettingsPage.tsx` (I18N-i, tm
 * 133.9) — `NotificationSettings.tsx`'s precedent (I18N-e, tm 133.5): the i18n
 * coverage sentinel (`i18n-coverage.test.ts`) claims a whole *file* as
 * translated, and `SettingsPage.tsx` still carries sections I18N-j (tm 133.10)
 * owns in English. Splitting this section out lets it register and pass the
 * sentinel on its own, without claiming — or blocking — the rest of that page.
 *
 * The way into the apps marketplace: a third-party integrations directory whose
 * detail lives in MOD-09. Settings is where an admin wires the workspace up to
 * the outside world — Channels sits right above — so this is where the door
 * belongs; the marketplace itself (09.1) is the room behind it, and the Apps
 * route is not on the module rail, so without this entry it can only be reached
 * by typing the URL.
 *
 * Below it, the "iGaming platforms" section (KN-06 F1, owner decision K15): a
 * catalogue record per platform (`IGAMING_PLATFORMS`) with a "Coming soon"
 * badge and a "Connect" button that cannot be pressed. There is no connection
 * flow behind it — no handler, no request — the real connector is F2 (tm 378).
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { IGAMING_PLATFORMS, type IgamingPlatform } from '@siyahtus/types';
import { Card, Section } from '../../components/Page.js';
import { useTranslate } from '../../lib/i18n.js';

/**
 * One placeholder card. The button is both `disabled` (it never fires `click`,
 * so nothing here can start a request) and `aria-disabled`; the reason sits in
 * visually hidden text it is `aria-describedby`, and in a `title` on the wrapper
 * so a pointer user gets a tooltip even though a disabled button swallows hover.
 */
function IgamingPlatformCard({ platform }: { platform: IgamingPlatform }): ReactElement {
  const t = useTranslate();
  const hintId = `igaming-${platform.vendor}-hint`;
  const hint = t('settings.integrations.igaming.connectDisabledHint', { name: platform.name });
  return (
    <li
      data-testid={`igaming-platform-${platform.vendor}`}
      className="flex flex-wrap items-center justify-between gap-3 p-4"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{platform.name}</h3>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-2xs font-medium text-content-secondary">
            {t('settings.integrations.igaming.soon')}
          </span>
        </div>
        <p className="text-xs text-content-secondary">
          {t(`settings.integrations.igaming.${platform.vendor}.description`)}
        </p>
      </div>
      <span title={hint} className="shrink-0">
        <button
          type="button"
          disabled
          aria-disabled="true"
          aria-describedby={hintId}
          className="cursor-not-allowed rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary opacity-60"
        >
          {t('settings.integrations.igaming.connect')}
        </button>
        <span id={hintId} className="sr-only">
          {hint}
        </span>
      </span>
    </li>
  );
}

export function Integrations(): ReactElement {
  const t = useTranslate();
  return (
    <>
      <MarketplaceEntry />
      <Section
        title={t('settings.integrations.igaming.title')}
        description={t('settings.integrations.igaming.description')}
      >
        <Card>
          <ul className="divide-y divide-border">
            {IGAMING_PLATFORMS.map((platform) => (
              <IgamingPlatformCard key={platform.vendor} platform={platform} />
            ))}
          </ul>
        </Card>
      </Section>
    </>
  );
}

function MarketplaceEntry(): ReactElement {
  const t = useTranslate();
  return (
    <Section
      title={t('settings.integrations.title')}
      description={t('settings.integrations.description')}
    >
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-content-secondary">{t('settings.integrations.hint')}</p>
          <Link
            to="/app/apps"
            className="shrink-0 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
          >
            {t('settings.integrations.openMarketplace')}
          </Link>
        </div>
      </Card>
    </Section>
  );
}
