import { hasAnyScope } from '@nexa/types';

/**
 * The one list of navigable modules.
 *
 * Both the icon rail (which renders them) and the command palette (which jumps
 * to them) read from here, so a module added to the product appears in both
 * without either drifting from the other.
 *
 * Labels are catalogue keys (`nav.inbox`), not literal text: the rail and the
 * palette resolve them through `t()` so a language switch moves both at once
 * (I18N1). Keywords stay literal — they are extra search aliases, not display
 * text, and translating them is a v1 concern.
 */
export interface NavDestination {
  to: string;
  /** i18n key resolved with `t()` for the display label + accessible name. */
  labelKey: string;
  icon: string;
  /**
   * Extra words the palette should match besides the label — an agent reaching
   * for "subscription" should land on Billing without having to know we call it
   * that.
   */
  keywords?: string[];
  /**
   * Any-of scope list required to see this destination; omitted means everyone.
   * A courtesy hide — the same one `CommandPalette`'s `ACTIONS` already applies
   * — so a teammate without the scope is not shown a door that only 403s. The
   * route itself carries the real gate. Mirrors that endpoint's own
   * `config.scopes` (server OR-list, `hasAnyScope`/`effectiveScopes` decide it
   * the same way on both sides), not a single hand-picked string: a route
   * commonly accepts a tenant-wide *or* a narrower scope (`chats--all:ro` /
   * `chats--access:ro`), and an ordinary agent only ever holds the narrower one.
   */
  scope?: readonly string[];
  /**
   * A live count overlaid on the icon — attached at render by `AppShell.tsx`
   * (`useNavBadges`), not part of this static catalogue, since a count comes
   * from a request and this list does not. `ariaLabel` is the count's spoken
   * form ("3 unread"); `RailButton` prefixes it with the module's own label so
   * the accessible name reads "Inbox, 3 unread" rather than a bare digit.
   */
  badge?: { count: number; ariaLabel: string };
}

/** Whether `dest` should be offered to a caller holding `scopes`. */
export function isNavVisible(dest: NavDestination, scopes: readonly string[]): boolean {
  return hasAnyScope(scopes, dest.scope ?? []);
}

export const MODULES: NavDestination[] = [
  {
    to: '/app/home',
    labelKey: 'nav.home',
    icon: '⌂',
    keywords: ['dashboard', 'overview', 'start'],
    // `routes/home.ts`: the dashboard rides report-flavoured data on purpose
    // ("a teammate who may not see Reports may not see the dashboard that
    // summarises it"), so it shares Reports' gate rather than staying open.
    scope: ['reports_read'],
  },
  {
    to: '/app/inbox',
    labelKey: 'nav.inbox',
    icon: '▤',
    keywords: ['conversations', 'chats', 'tickets'],
    // `GET /chats` (routes/chats.ts) — tenant-wide or the caller's own access;
    // `DEFAULT_AGENT_SCOPES` carries `chats--access:rw`, which implies the `:ro`
    // half here.
    scope: ['chats--all:ro', 'chats--access:ro'],
  },
  {
    to: '/app/customers',
    labelKey: 'nav.customers',
    icon: '◫',
    keywords: ['people', 'crm', 'leads', 'campaigns', 'traffic'],
    // `GET /customers` (routes/customers.ts) — `customers:ro` is in
    // `DEFAULT_AGENT_SCOPES` directly, so every role reaches this one.
    scope: ['customers:ro', 'customers:rw'],
  },
  {
    to: '/app/team',
    labelKey: 'nav.team',
    icon: '◑',
    keywords: ['agents', 'groups'],
    // `GET /agents` (routes/agents.ts) — the roster read.
    scope: ['agents--all:ro', 'agents--my:ro'],
  },
  {
    to: '/app/playbook',
    labelKey: 'nav.playbook',
    icon: '✦',
    keywords: ['skills', 'canned', 'ai'],
    // `routes/playbook.ts`'s `READ` constant, shared by every sub-resource
    // (skills, AI agents, knowledge). Not in `DEFAULT_AGENT_SCOPES` — owners and
    // admins configure the automation, ordinary agents work alongside it
    // (`role-scopes.ts` `ADMIN_SCOPES` comment).
    scope: ['agents-bot--all:ro', 'agents-bot--all:rw'],
  },
  {
    to: '/app/reports',
    labelKey: 'nav.reports',
    icon: '◆',
    keywords: ['analytics', 'metrics', 'kpi'],
    // `GET /reports/overview` (routes/reports.ts).
    scope: ['reports_read'],
  },
];

export const FOOTER: NavDestination[] = [
  {
    to: '/app/billing',
    labelKey: 'nav.billing',
    icon: '◈',
    keywords: ['subscription', 'plan', 'invoice', 'payment'],
    // `GET /billing/subscription`'s `BILLING_READ_SCOPES` (routes/reports.ts) —
    // none of the three are in `DEFAULT_AGENT_SCOPES`, so this is admin-only,
    // matching `TrialBanner`'s own "only owners and admins carry a billing
    // scope" note just above it in this file.
    scope: ['billing_manage', 'billing_admin', 'reports_read'],
  },
  {
    to: '/app/settings',
    labelKey: 'nav.settings',
    icon: '⚙',
    keywords: ['channels', 'tags', 'notifications', 'preferences'],
    // Settings has no one landing read — each section gates itself
    // (`SettingsPage.tsx`), and most sections are admin-only. `GET
    // /settings/tags` is the one every role reaches: `tags--groups:ro` is in
    // `DEFAULT_AGENT_SCOPES` ("the inbox reads this list to suggest tags as an
    // agent types", routes/settings.ts) — using it here means the door stays up
    // for every real session and only a PAT scoped narrower than the default
    // set loses it, which is the "sees nothing in the module" case this gate
    // exists for.
    scope: ['tags--all:ro', 'tags--groups:ro'],
  },
  {
    to: '/app/developers',
    labelKey: 'nav.developers',
    icon: '{}',
    keywords: ['api', 'oauth', 'partner', 'apps', 'zapier', 'make', 'build your own app'],
    scope: ['access_rules:rw'],
  },
];

export const NAV_DESTINATIONS: NavDestination[] = [...MODULES, ...FOOTER];
