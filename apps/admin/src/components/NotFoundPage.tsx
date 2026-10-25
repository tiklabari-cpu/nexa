/**
 * An address inside the panel that leads nowhere. It says so, inside the shell so the menu
 * stays to navigate from, instead of silently landing on the dashboard — which reads as the
 * link having worked (apps/web, UX audit D11).
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
            to="/dashboard"
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary hover:bg-surface-2"
          >
            {t('shell.notFound.back')}
          </Link>
        </div>
      </Card>
    </Page>
  );
}
