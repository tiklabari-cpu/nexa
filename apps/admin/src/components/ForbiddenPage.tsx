/**
 * A page this operator's role does not open (tm 389.6, FR-ADMIN-02).
 *
 * The menu hides what a role cannot use, but hiding is courtesy, not security: the server
 * checks every request against the role (`x-platform-permission`) and a route opened by hand
 * meets that gate. This is what the operator sees when either side — the permission list the
 * shell holds, or a 403 `authorization` a page's own request got back — says no. It renders in
 * place of the page, inside the shell, with no data fetched.
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Card, Page } from './Page.js';
import { useTranslate } from '../lib/i18n.js';

export function ForbiddenPage({ role }: { role?: string }): ReactElement {
  const t = useTranslate();
  return (
    <Page title={t('shell.forbidden.title')}>
      <Card>
        <div role="alert" className="flex flex-col items-start gap-3 p-6">
          <p className="text-sm text-content-secondary">
            {role
              ? t('shell.forbidden.description', { role: t(`shell.role.${role}`) })
              : t('shell.forbidden.serverDescription')}
          </p>
          <Link
            to="/dashboard"
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary hover:bg-surface-2"
          >
            {t('shell.forbidden.back')}
          </Link>
        </div>
      </Card>
    </Page>
  );
}
