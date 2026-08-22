/**
 * Settings — the composition root for every section on the page.
 *
 * Every section now lives in its own file (`TrustedDomains.tsx`,
 * `CannedResponses.tsx`, `BannedCustomerIps.tsx`, `Skills.tsx`, …) rather than
 * here, so each could be claimed translated by the i18n coverage sentinel on
 * its own (`NotificationSettings.tsx`'s precedent, I18N-e, tm 133.5) without
 * waiting for the whole page. This file re-exports the sections whose tests
 * still import them from here (`./SettingsPage.js`, unchanged on purpose —
 * CONVENTIONS §5 kapsam disiplini, not this task's to touch) and owns only the
 * `<Page>` shell itself, which I18N-j (tm 133.10) finally translates too.
 */
import type { ReactElement } from 'react';
import { Page } from '../../components/Page.js';
import { useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { Brands } from './Brands.js';
import { McpConnection } from './McpConnection.js';
import { WebsiteWidgets } from './WebsiteWidgets.js';
import { WidgetCustomization } from './WidgetCustomization.js';
import { SalesTracker } from './SalesTracker.js';
import { ChannelsGrid } from './Channels.js';
import { IpAllowlist } from './IpAllowlist.js';
import { SsoConnection } from './SsoConnection.js';
import { Compliance } from './Compliance.js';
import { SiemExport } from './SiemExport.js';
import { SlaPolicy } from './SlaPolicy.js';
import { Sandbox } from './Sandbox.js';
import { ScheduledExports } from './ScheduledExports.js';
import { NotificationSettings } from './NotificationSettings.js';
import { Integrations } from './Integrations.js';
import { TrustedDomains } from './TrustedDomains.js';
import { CannedResponses } from './CannedResponses.js';
import { ChatTimeout } from './ChatTimeout.js';
import { Tags } from './Tags.js';
import { TicketEmailTemplates } from './TicketEmailTemplates.js';
import { CustomFieldsSettings } from './CustomFieldsSettings.js';
import { ChatFormsSettings } from './ChatFormsSettings.js';
import { BannedCustomerIps } from './BannedCustomerIps.js';
import { AuditLog } from './AuditLog.js';
import { FileSharing } from './FileSharing.js';
import { Skills } from './Skills.js';
import { RoutingRules } from './RoutingRules.js';
import { TicketRules } from './TicketRules.js';

export { NotificationSettings } from './NotificationSettings.js';
export { Integrations } from './Integrations.js';
export { TrustedDomains } from './TrustedDomains.js';
export { CannedResponses } from './CannedResponses.js';
export { Tags } from './Tags.js';
export { TicketEmailTemplates } from './TicketEmailTemplates.js';
export { CustomFieldsSettings } from './CustomFieldsSettings.js';
export { ChatFormsSettings } from './ChatFormsSettings.js';
export { BannedCustomerIps } from './BannedCustomerIps.js';
export { AuditLog } from './AuditLog.js';
export { Skills } from './Skills.js';
export { RoutingRules } from './RoutingRules.js';
export { TicketRules } from './TicketRules.js';

export function SettingsPage(): ReactElement {
  const t = useTranslate();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canManageAccess = scopes.includes('access_rules:rw');
  const canManageReplies = scopes.includes('canned_responses--all:rw');
  const canManageTags = scopes.includes('tags--all:rw');
  const canManageTicketRules = scopes.includes('tickets--all:rw');
  const canManageBrands = scopes.includes('brands--all:rw');
  const canManageScheduledExports = scopes.includes('reports_manage');

  return (
    <Page title={t('settings.pageTitle')} description={t('settings.pageDescription')}>
      <ChannelsGrid />
      <Integrations />
      <McpConnection />
      <NotificationSettings />
      <Brands canEdit={canManageBrands} />
      <WebsiteWidgets canEdit={canManageAccess} />
      <WidgetCustomization canEdit={canManageAccess} />
      <SalesTracker canEdit={canManageAccess} />
      <TrustedDomains canEdit={canManageAccess} />
      <BannedCustomerIps canEdit={canManageAccess} />
      <IpAllowlist canEdit={canManageAccess} />
      <SsoConnection canEdit={canManageAccess} />
      <Compliance canEdit={canManageAccess} />
      <SiemExport canEdit={canManageAccess} />
      <SlaPolicy canEdit={canManageAccess} />
      <Sandbox canEdit={canManageAccess} />
      <AuditLog />
      <FileSharing canEdit={canManageAccess} />
      <CannedResponses canEdit={canManageReplies} />
      <Tags canEdit={canManageTags} />
      <ChatTimeout canEdit={canManageAccess} />
      <Skills canEdit={canManageAccess} />
      <RoutingRules canEdit={canManageAccess} />
      <TicketRules canEdit={canManageTicketRules} />
      <TicketEmailTemplates canEdit={canManageTicketRules} />
      <CustomFieldsSettings canEdit={canManageAccess} />
      <ChatFormsSettings canEdit={canManageAccess} />
      <ScheduledExports canEdit={canManageScheduledExports} />
    </Page>
  );
}
