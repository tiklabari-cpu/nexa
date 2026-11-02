/**
 * Admins (tm 389.20, tm 391): the operator directory — operators, their invitations and the
 * actions on both — and the signed-in operator's own alert preferences.
 */
import type { ReactElement } from 'react';
import { Page } from '../../components/Page.js';
import { useTranslate } from '../../lib/i18n.js';
import { AlertPrefsSection } from './AlertPrefsSection.js';
import { OperatorDirectory } from './OperatorDirectory.js';

export function AdminsPage(): ReactElement {
  const t = useTranslate();
  return (
    <Page title={t('nav.admins')} description={t('shell.pages.admins.description')}>
      <OperatorDirectory />
      <AlertPrefsSection />
    </Page>
  );
}
