/**
 * The Security page (tm 389.16 · FR-ADMIN-22): the sign-up blocklist and what it is for — failed
 * sign-ins, sign-ups by address, impersonation sessions and the abuse counters of the tenant
 * API's guards.
 *
 * Independent sections, each with its own read, so a slow or failing one never blanks the rest.
 * Addresses, licence numbers and counts only; a tenant's content is never on this page.
 */
import type { ReactElement } from 'react';
import { Page } from '../../components/Page.js';
import { useTranslate } from '../../lib/i18n.js';
import { BlocklistSection } from './BlocklistSection.js';
import {
  AbuseCountersSection,
  FailedLoginsSection,
  SignupsByIpSection,
} from './CounterSections.js';
import { ImpersonationsSection } from './ImpersonationsSection.js';

export function SecurityPage(): ReactElement {
  const t = useTranslate();
  return (
    <Page title={t('nav.security')} description={t('shell.pages.security.description')}>
      <BlocklistSection />
      <FailedLoginsSection />
      <SignupsByIpSection />
      <AbuseCountersSection />
      <ImpersonationsSection />
    </Page>
  );
}
