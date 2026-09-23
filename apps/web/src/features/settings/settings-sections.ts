import { hasAnyScope } from '@nexa/types';
import { FOOTER } from '../../components/navigation.js';

/**
 * The Settings navigation catalogue (FR-MOD-08.1 · tm 255.10).
 *
 * Every Settings section used to render on one scrolling page. PRD 08.1 asks for
 * the source product's shell instead: a side navigation grouped as
 * Notifications / Company details / Desktop app · Channels · Routing · Inbox ·
 * Integrations · Security · Billing, each section on its own address, and a
 * group or section a person cannot use left out of the navigation altogether.
 *
 * The groups follow the PRD's own numbering, which is where each section's
 * requirement lives: 08.2–08.4 the ungrouped head (`general`), 08.5 Channels,
 * 08.6 Routing, 08.7 Inbox tools, 08.8 Integrations, 08.9 Security, 08.10
 * Billing. Sections with no 08.x number of their own sit with the group whose
 * work they extend — SLA beside ticket rules (both decide what happens to a
 * ticket), scheduled exports and the sandbox beside the API (both are for
 * people building on the workspace), the SIEM stream beside the audit log it
 * streams.
 *
 * Two PRD entries have no section here, on purpose: **Desktop app** (08.4,
 * Could/v1) has no screen in this product, and inventing a placeholder page for
 * it would put a door on the navigation that opens onto nothing. **Billing**
 * (08.10) is a link to the existing `/app/billing` page — moving that page is
 * not this task's (tm 255.10 scope).
 *
 * `scope` mirrors the `config.scopes` of the endpoint the section *reads*
 * (`apps/api/src/routes/…`), any-of, the way `navigation.ts` gates a module:
 * a courtesy hide so a teammate is not shown a section that only answers 403.
 * The route keeps the real gate. Omitted means everyone — the section reads
 * nothing the caller does not already hold (their own profile, a static door).
 */
export type SettingsGroupKey =
  'general' | 'channels' | 'routing' | 'inbox' | 'integrations' | 'security' | 'billing';

export interface SettingsSectionEntry {
  /** URL segment: `/app/settings/<slug>`. */
  slug: string;
  group: SettingsGroupKey;
  /** i18n key for the navigation label. */
  labelKey: string;
  /** Any-of scope list required to see the section; omitted means everyone. */
  scope?: readonly string[];
  /**
   * The file under `features/settings/` whose component the section renders —
   * what the completeness test holds against the directory, so a section file
   * added without a navigation entry fails instead of quietly never rendering.
   * Absent on the two entries that link to a page of their own (`to`).
   */
  file?: string;
  /**
   * Where the entry links when it is not `/app/settings/<slug>`. The audit log
   * already had a page of its own at `/app/settings/audit-log`, and the
   * section that used to stand for it on the single page (`AuditLog.tsx`, an
   * "Open audit log" button under the same scope) was only ever the door to
   * it — so the navigation entry *is* that door now, and the button went with
   * the page it sat on. The audit log page keeps its address.
   * Billing links to `/app/billing`.
   */
  to?: string;
}

const ACCESS_RULES = ['access_rules:ro', 'access_rules:rw'] as const;

export const SETTINGS_GROUPS: readonly { key: SettingsGroupKey; labelKey: string }[] = [
  { key: 'general', labelKey: 'settings.nav.group.general' },
  { key: 'channels', labelKey: 'settings.nav.group.channels' },
  { key: 'routing', labelKey: 'settings.nav.group.routing' },
  { key: 'inbox', labelKey: 'settings.nav.group.inbox' },
  { key: 'integrations', labelKey: 'settings.nav.group.integrations' },
  { key: 'security', labelKey: 'settings.nav.group.security' },
  { key: 'billing', labelKey: 'settings.nav.group.billing' },
];

const BILLING_DESTINATION = FOOTER.find((d) => d.to === '/app/billing');

export const SETTINGS_SECTIONS: readonly SettingsSectionEntry[] = [
  // 08.2–08.4 — the ungrouped head
  // Reads the caller's own preferences off their profile (`/auth/me`).
  {
    slug: 'notifications',
    group: 'general',
    labelKey: 'settings.nav.section.notifications',
    file: 'NotificationSettings',
  },
  {
    slug: 'company',
    group: 'general',
    labelKey: 'settings.nav.section.company',
    scope: ['organization--my:rw'],
    file: 'CompanyDetails',
  },
  {
    slug: 'brands',
    group: 'general',
    labelKey: 'settings.nav.section.brands',
    scope: ['brands--all:ro', 'brands--all:rw'],
    file: 'Brands',
  },

  // 08.5 — Channels
  {
    slug: 'channels',
    group: 'channels',
    labelKey: 'settings.nav.section.channels',
    scope: ['channels--all:ro', 'channels--all:rw'],
    file: 'Channels',
  },
  {
    slug: 'website-widgets',
    group: 'channels',
    labelKey: 'settings.nav.section.websiteWidgets',
    scope: ACCESS_RULES,
    file: 'WebsiteWidgets',
  },
  {
    slug: 'widget',
    group: 'channels',
    labelKey: 'settings.nav.section.widget',
    scope: ACCESS_RULES,
    file: 'WidgetCustomization',
  },
  {
    slug: 'sales-tracker',
    group: 'channels',
    labelKey: 'settings.nav.section.salesTracker',
    scope: ACCESS_RULES,
    file: 'SalesTracker',
  },

  // 08.6 — Routing
  {
    slug: 'routing-rules',
    group: 'routing',
    labelKey: 'settings.nav.section.routingRules',
    scope: ACCESS_RULES,
    file: 'RoutingRules',
  },
  {
    slug: 'skills',
    group: 'routing',
    labelKey: 'settings.nav.section.skills',
    scope: ACCESS_RULES,
    file: 'Skills',
  },
  {
    slug: 'ticket-rules',
    group: 'routing',
    labelKey: 'settings.nav.section.ticketRules',
    scope: ['tickets--all:ro', 'tickets--all:rw'],
    file: 'TicketRules',
  },
  {
    slug: 'sla',
    group: 'routing',
    labelKey: 'settings.nav.section.sla',
    scope: ACCESS_RULES,
    file: 'SlaPolicy',
  },

  // 08.7 — Inbox tools
  {
    slug: 'canned-responses',
    group: 'inbox',
    labelKey: 'settings.nav.section.cannedResponses',
    scope: ['canned_responses--all:ro', 'canned_responses--groups:ro'],
    file: 'CannedResponses',
  },
  {
    slug: 'tags',
    group: 'inbox',
    labelKey: 'settings.nav.section.tags',
    scope: ['tags--all:ro', 'tags--groups:ro'],
    file: 'Tags',
  },
  {
    slug: 'chat-timeout',
    group: 'inbox',
    labelKey: 'settings.nav.section.chatTimeout',
    scope: ACCESS_RULES,
    file: 'ChatTimeout',
  },
  {
    slug: 'ticket-email-templates',
    group: 'inbox',
    labelKey: 'settings.nav.section.ticketEmailTemplates',
    scope: ['tickets--all:ro', 'tickets--access:ro', 'tickets--all:rw'],
    file: 'TicketEmailTemplates',
  },
  {
    slug: 'custom-fields',
    group: 'inbox',
    labelKey: 'settings.nav.section.customFields',
    scope: ACCESS_RULES,
    file: 'CustomFieldsSettings',
  },
  {
    slug: 'chat-forms',
    group: 'inbox',
    labelKey: 'settings.nav.section.chatForms',
    scope: ACCESS_RULES,
    file: 'ChatFormsSettings',
  },

  // 08.8 — Integrations
  // A door to the marketplace; reads nothing.
  {
    slug: 'integrations',
    group: 'integrations',
    labelKey: 'settings.nav.section.integrations',
    file: 'Integrations',
  },
  // `GET /mcp/manifest` is public — the manifest is documentation.
  {
    slug: 'mcp',
    group: 'integrations',
    labelKey: 'settings.nav.section.mcp',
    file: 'McpConnection',
  },
  {
    slug: 'personal-access-tokens',
    group: 'integrations',
    labelKey: 'settings.nav.section.personalAccessTokens',
    scope: ['accounts--my:ro'],
    file: 'PersonalAccessTokens',
  },
  {
    slug: 'scheduled-exports',
    group: 'integrations',
    labelKey: 'settings.nav.section.scheduledExports',
    scope: ['reports_manage'],
    file: 'ScheduledExports',
  },
  {
    slug: 'sandbox',
    group: 'integrations',
    labelKey: 'settings.nav.section.sandbox',
    scope: ACCESS_RULES,
    file: 'Sandbox',
  },

  // 08.9 — Security
  {
    slug: 'trusted-domains',
    group: 'security',
    labelKey: 'settings.nav.section.trustedDomains',
    scope: ACCESS_RULES,
    file: 'TrustedDomains',
  },
  {
    slug: 'banned-customers',
    group: 'security',
    labelKey: 'settings.nav.section.bannedCustomers',
    scope: ACCESS_RULES,
    file: 'BannedCustomerIps',
  },
  {
    slug: 'file-sharing',
    group: 'security',
    labelKey: 'settings.nav.section.fileSharing',
    scope: ACCESS_RULES,
    file: 'FileSharing',
  },
  {
    slug: 'ip-allowlist',
    group: 'security',
    labelKey: 'settings.nav.section.ipAllowlist',
    scope: ACCESS_RULES,
    file: 'IpAllowlist',
  },
  {
    slug: 'sso',
    group: 'security',
    labelKey: 'settings.nav.section.sso',
    scope: ACCESS_RULES,
    file: 'SsoConnection',
  },
  // The caller's own second factor (`/auth/me`).
  {
    slug: 'two-factor',
    group: 'security',
    labelKey: 'settings.nav.section.twoFactor',
    file: 'TwoFactor',
  },
  {
    slug: 'compliance',
    group: 'security',
    labelKey: 'settings.nav.section.compliance',
    scope: ACCESS_RULES,
    file: 'Compliance',
  },
  {
    slug: 'data-retention',
    group: 'security',
    labelKey: 'settings.nav.section.dataRetention',
    scope: ACCESS_RULES,
    file: 'DataRetention',
  },
  {
    slug: 'audit-log',
    group: 'security',
    labelKey: 'settings.nav.section.auditLog',
    scope: ['audit_log--all:ro'],
    to: '/app/settings/audit-log',
  },
  {
    slug: 'siem',
    group: 'security',
    labelKey: 'settings.nav.section.siem',
    scope: ACCESS_RULES,
    file: 'SiemExport',
  },

  // 08.10 — Billing: the existing page, gated as the rail gates it.
  {
    slug: 'billing',
    group: 'billing',
    labelKey: 'settings.nav.section.billing',
    scope: BILLING_DESTINATION?.scope ?? ['billing_manage'],
    to: '/app/billing',
  },
];

/** The address a navigation entry links to. */
export function sectionHref(entry: SettingsSectionEntry): string {
  return entry.to ?? `/app/settings/${entry.slug}`;
}

/** Sections the caller may see, in navigation order. */
export function visibleSections(scopes: readonly string[]): SettingsSectionEntry[] {
  return SETTINGS_SECTIONS.filter((s) => hasAnyScope(scopes, s.scope ?? []));
}

/**
 * The navigation as the caller sees it: groups with at least one visible
 * section, each carrying only those sections. A group whose sections are all
 * hidden is dropped whole — its heading is not rendered over an empty list.
 */
export function visibleGroups(
  scopes: readonly string[],
): { key: SettingsGroupKey; labelKey: string; sections: SettingsSectionEntry[] }[] {
  const sections = visibleSections(scopes);
  return SETTINGS_GROUPS.map((g) => ({
    ...g,
    sections: sections.filter((s) => s.group === g.key),
  })).filter((g) => g.sections.length > 0);
}

/**
 * Where `/app/settings` lands: the first section the caller may open that
 * lives under `/app/settings/…`, in navigation order — Notifications for
 * everybody, since it reads only the caller's own profile.
 *
 * A legacy anchor (`/app/settings#section-channels`, from before the page was
 * split) still reaches its section: bookmarks and old links keep working.
 */
export function defaultSectionSlug(scopes: readonly string[], hash = ''): string | undefined {
  const visible = visibleSections(scopes).filter((s) => !s.to);
  const anchor = hash.replace(/^#/, '').replace(/^section-/, '');
  const legacy = LEGACY_ANCHORS[anchor] ?? anchor;
  return (visible.find((s) => s.slug === legacy) ?? visible[0])?.slug;
}

/** Anchors the single page used that do not equal the new slug. */
const LEGACY_ANCHORS: Record<string, string> = {
  'widget-customization': 'widget',
};

export function findSection(slug: string | undefined): SettingsSectionEntry | undefined {
  return SETTINGS_SECTIONS.find((s) => s.slug === slug && !s.to);
}
