/**
 * Admins (tm 389.20): the operator's own alert preferences. The operator directory — invitations,
 * roles, disabling — is a later page; it joins this one here.
 */
import type { ReactElement } from 'react';
import { Page } from '../../components/Page.js';
import { useTranslate } from '../../lib/i18n.js';
import { AlertPrefsSection } from './AlertPrefsSection.js';

export function AdminsPage(): ReactElement {
  const t = useTranslate();
  return (
    <Page title={t('nav.admins')} description={t('shell.pages.admins.description')}>
      <AlertPrefsSection />
    </Page>
  );
}
