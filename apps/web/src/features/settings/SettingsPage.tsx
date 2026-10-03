/**
 * Settings — the shell (FR-MOD-08.1 · tm 255.10) and the composition root for
 * every section.
 *
 * Until tm 255.10 every section rendered here, one under the other, on a single
 * page. They now live one per address, `/app/settings/<section>`, behind the
 * grouped side navigation in `SettingsNav.tsx`; which group a section belongs to
 * and who may see it is `settings-sections.ts`'s. This file keeps the part that
 * was always its own: which props each section is rendered with.
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
import type { ReactElement, ReactNode } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { hasAnyScope } from '@siyahtus/types';
import { Page } from '../../components/Page.js';
import { useAuth } from '../../lib/auth-store.js';
import { useDeployment } from '../../lib/deployment.js';
import { useTranslate } from '../../lib/i18n.js';
import { Brands } from './Brands.js';
import { CompanyDetails } from './CompanyDetails.js';
import { McpConnection } from './McpConnection.js';
import { WebsiteWidgets } from './WebsiteWidgets.js';
import { WidgetCustomization } from './WidgetCustomization.js';
import { SalesTracker } from './SalesTracker.js';
import { ChannelsGrid } from './Channels.js';
import { IpAllowlist } from './IpAllowlist.js';
import { SsoConnection } from './SsoConnection.js';
import { Compliance } from './Compliance.js';
import { DataRetention } from './DataRetention.js';
import { SiemExport } from './SiemExport.js';
import { SlaPolicy } from './SlaPolicy.js';
import { Sandbox } from './Sandbox.js';
import { ScheduledExports } from './ScheduledExports.js';
import { NotificationSettings } from './NotificationSettings.js';
import { Integrations } from './Integrations.js';
import { TrustedDomains } from './TrustedDomains.js';
import { CannedResponses } from './CannedResponses.js';
import { ChatTimeout } from './ChatTimeout.js';
import { TwoFactor } from './TwoFactor.js';
import { PersonalAccessTokens } from './PersonalAccessTokens.js';
import { Tags } from './Tags.js';
import { TicketEmailTemplates } from './TicketEmailTemplates.js';
import { CustomFieldsSettings } from './CustomFieldsSettings.js';
import { ChatFormsSettings } from './ChatFormsSettings.js';
import { BannedCustomerIps } from './BannedCustomerIps.js';
import { FileSharing } from './FileSharing.js';
import { Skills } from './Skills.js';
import { RoutingRules } from './RoutingRules.js';
import { TicketRules } from './TicketRules.js';
import { SettingsNav } from './SettingsNav.js';
import { defaultSectionSlug, findSection } from './settings-sections.js';

export { NotificationSettings } from './NotificationSettings.js';
export { Integrations } from './Integrations.js';
export { TrustedDomains } from './TrustedDomains.js';
export { CannedResponses } from './CannedResponses.js';
export { PersonalAccessTokens } from './PersonalAccessTokens.js';
export { Tags } from './Tags.js';
export { TicketEmailTemplates } from './TicketEmailTemplates.js';
export { CustomFieldsSettings } from './CustomFieldsSettings.js';
export { ChatFormsSettings } from './ChatFormsSettings.js';
export { BannedCustomerIps } from './BannedCustomerIps.js';
export { Skills } from './Skills.js';
export { RoutingRules } from './RoutingRules.js';
export { TicketRules } from './TicketRules.js';

/** What the caller may change, resolved once per render from their scopes. */
interface SectionPermissions {
  canManageAccess: boolean;
  canManageReplies: boolean;
  canManageTags: boolean;
  canManageTicketRules: boolean;
  canManageBrands: boolean;
  canManageScheduledExports: boolean;
  canManageCompany: boolean;
}

function permissionsFrom(scopes: readonly string[]): SectionPermissions {
  return {
    canManageAccess: scopes.includes('access_rules:rw'),
    canManageReplies: scopes.includes('canned_responses--all:rw'),
    canManageTags: scopes.includes('tags--all:rw'),
    canManageTicketRules: scopes.includes('tickets--all:rw'),
    canManageBrands: scopes.includes('brands--all:rw'),
    canManageScheduledExports: scopes.includes('reports_manage'),
    // Read and write are the same scope on `/settings/company` — see
    // `CompanyDetails.tsx` for why there is no read-only viewer of this section.
    canManageCompany: scopes.includes('organization--my:rw'),
  };
}

/**
 * Every section a `/app/settings/<slug>` address renders, with the props the
 * single page used to pass it. Keyed by the catalogue's slugs; the test holds
 * the two to each other, so a slug with no element or an element with no
 * navigation entry fails rather than 404ing or never being reachable.
 */
export const SECTION_ELEMENTS: Record<string, (p: SectionPermissions) => ReactElement> = {
  notifications: () => <NotificationSettings />,
  company: (p) => <CompanyDetails canManage={p.canManageCompany} />,
  brands: (p) => <Brands canEdit={p.canManageBrands} />,
  channels: () => <ChannelsGrid />,
  'website-widgets': (p) => <WebsiteWidgets canEdit={p.canManageAccess} />,
  widget: (p) => <WidgetCustomization canEdit={p.canManageAccess} />,
  'sales-tracker': (p) => <SalesTracker canEdit={p.canManageAccess} />,
  'routing-rules': (p) => <RoutingRules canEdit={p.canManageAccess} />,
  skills: (p) => <Skills canEdit={p.canManageAccess} />,
  'ticket-rules': (p) => <TicketRules canEdit={p.canManageTicketRules} />,
  sla: (p) => <SlaPolicy canEdit={p.canManageAccess} />,
  'canned-responses': (p) => <CannedResponses canEdit={p.canManageReplies} />,
  tags: (p) => <Tags canEdit={p.canManageTags} />,
  'chat-timeout': (p) => <ChatTimeout canEdit={p.canManageAccess} />,
  'ticket-email-templates': (p) => <TicketEmailTemplates canEdit={p.canManageTicketRules} />,
  'custom-fields': (p) => <CustomFieldsSettings canEdit={p.canManageAccess} />,
  'chat-forms': (p) => <ChatFormsSettings canEdit={p.canManageAccess} />,
  integrations: () => <Integrations />,
  mcp: () => <McpConnection />,
  'personal-access-tokens': () => <PersonalAccessTokens />,
  'scheduled-exports': (p) => <ScheduledExports canEdit={p.canManageScheduledExports} />,
  sandbox: (p) => <Sandbox canEdit={p.canManageAccess} />,
  'trusted-domains': (p) => <TrustedDomains canEdit={p.canManageAccess} />,
  'banned-customers': (p) => <BannedCustomerIps canEdit={p.canManageAccess} />,
  'file-sharing': (p) => <FileSharing canEdit={p.canManageAccess} />,
  'ip-allowlist': (p) => <IpAllowlist canEdit={p.canManageAccess} />,
  sso: (p) => <SsoConnection canEdit={p.canManageAccess} />,
  'two-factor': () => <TwoFactor />,
  compliance: (p) => <Compliance canEdit={p.canManageAccess} />,
  'data-retention': (p) => <DataRetention canEdit={p.canManageAccess} />,
  siem: (p) => <SiemExport canEdit={p.canManageAccess} />,
};

/** `/app/settings/*` — the navigation beside whichever section is open. */
export function SettingsLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-1">
      <SettingsNav />
      {children}
    </div>
  );
}

/**
 * `/app/settings` — lands on the caller's first section, or on the section an
 * old single-page anchor (`/app/settings#section-channels`) named.
 */
export function SettingsIndex(): ReactElement {
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const { hash } = useLocation();
  const slug = defaultSectionSlug(scopes, hash);
  return <Navigate to={slug ? `/app/settings/${slug}` : '/app/inbox'} replace />;
}

/**
 * `/app/settings/<slug>` — one section. An unknown slug, or one the caller's
 * scopes hide from the navigation, goes back to the index rather than showing
 * a section that would only answer 403.
 */
export function SettingsPage(): ReactElement {
  const t = useTranslate();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const { pilot_mode: pilotMode } = useDeployment();
  const { section } = useParams();
  const entry = findSection(section);
  const render = entry ? SECTION_ELEMENTS[entry.slug] : undefined;

  if (
    !entry ||
    !render ||
    !hasAnyScope(scopes, entry.scope ?? []) ||
    (pilotMode && entry.pilotHidden)
  ) {
    return <Navigate to="/app/settings" replace />;
  }

  return (
    <Page title={t('settings.pageTitle')} description={t('settings.pageDescription')}>
      {render(permissionsFrom(scopes))}
    </Page>
  );
}
