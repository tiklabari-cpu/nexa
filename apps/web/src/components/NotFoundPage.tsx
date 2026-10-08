/**
 * An address inside the console that leads nowhere (UX audit D11).
 *
 * `/app/typo` used to be sent to the inbox without a word, which reads as the
 * link having worked. It now says the page does not exist, inside the shell so
 * the rail stays to navigate from. Addresses outside `/app` — the bare origin,
 * the OAuth callback path — still land in the inbox: nothing a person typed
 * there is expected to be a console page.
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Card, Page } from './Page.js';
import { useTranslate } from '../lib/i18n.js';

export function NotFoundPage(): ReactElement {
  const t = useTranslate();
  return (
    <Page title={t('shell.notFound.title')}>
      <Card>
        <div className="flex flex-col items-start gap-3 p-6">
          <p className="text-sm text-content-secondary">{t('shell.notFound.description')}</p>
          <Link
            to="/app/inbox"
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary hover:bg-surface-2"
          >
            {t('shell.notFound.back')}
          </Link>
        </div>
      </Card>
    </Page>
  );
}
