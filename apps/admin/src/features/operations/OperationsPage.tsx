/**
 * The Operations page (tm 389.14 · FR-ADMIN-20): what the background machinery is doing and the
 * few things an operator may do to it — run a scheduler job now, open an events partition,
 * purge expired unverified sign-ups.
 *
 * Seven independent sections, each with its own read, so a slow or failing one never blanks the
 * rest. Counts and states only; a tenant's content is never on this page (requirements §2).
 */
import type { ReactElement } from 'react';
import { Page } from '../../components/Page.js';
import { useTranslate } from '../../lib/i18n.js';
import { PartitionsSection, UnverifiedSection } from './MaintenanceSections.js';
import { SchedulerSection } from './SchedulerSection.js';
import {
  ComponentRecordSection,
  QueuesSection,
  SiemSection,
  WebhooksSection,
} from './StatusSections.js';

export function OperationsPage(): ReactElement {
  const t = useTranslate();
  return (
    <Page title={t('nav.operations')} description={t('shell.pages.operations.description')}>
      <SchedulerSection />
      <QueuesSection />
      <WebhooksSection />
      <SiemSection />
      <PartitionsSection />
      <UnverifiedSection />
      <ComponentRecordSection />
    </Page>
  );
}
