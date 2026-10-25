/**
 * The empty page every menu entry opens until its own task builds it (tm 389.6).
 *
 * The later subtasks (389.8–389.20) each replace one of these in `App.tsx` with a real feature
 * folder; the title, the description and the permission stay in `lib/navigation.ts`. It fetches
 * nothing — there is nothing yet to fetch, and no endpoint is touched by a page that has not
 * been built.
 */
import type { ReactElement } from 'react';
import { Card, Page } from '../../components/Page.js';
import { useTranslate } from '../../lib/i18n.js';
import type { NavItem } from '../../lib/navigation.js';

export function PlaceholderPage({ item }: { item: NavItem }): ReactElement {
  const t = useTranslate();
  return (
    <Page title={t(item.labelKey)} description={t(item.descriptionKey)}>
      <Card>
        <div className="p-6">
          <h2 className="text-sm font-semibold">{t('shell.pages.empty.title')}</h2>
          <p className="mt-1 text-sm text-content-secondary">
            {t('shell.pages.empty.description')}
          </p>
        </div>
      </Card>
    </Page>
  );
}
