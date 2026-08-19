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
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Card, Section } from '../../components/Page.js';
import { useTranslate } from '../../lib/i18n.js';

export function Integrations(): ReactElement {
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
