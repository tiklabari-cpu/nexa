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
   * Scope required to see this destination; omitted means everyone. A
   * courtesy hide — the same one `CommandPalette` already applies to actions
   * — so a teammate without the scope is not shown a door that only 403s. The
   * route itself carries the real gate.
   */
  scope?: string;
}

/** Whether `dest` should be offered to a caller holding `scopes`. */
export function isNavVisible(dest: NavDestination, scopes: readonly string[]): boolean {
  return !dest.scope || scopes.includes(dest.scope);
}

export const MODULES: NavDestination[] = [
  {
    to: '/app/home',
    labelKey: 'nav.home',
    icon: '⌂',
    keywords: ['dashboard', 'overview', 'start'],
  },
  {
    to: '/app/inbox',
    labelKey: 'nav.inbox',
    icon: '▤',
    keywords: ['conversations', 'chats', 'tickets'],
  },
  {
    to: '/app/customers',
    labelKey: 'nav.customers',
    icon: '◫',
    keywords: ['people', 'crm', 'leads', 'campaigns', 'traffic'],
  },
  { to: '/app/team', labelKey: 'nav.team', icon: '◑', keywords: ['agents', 'groups'] },
  {
    to: '/app/playbook',
    labelKey: 'nav.playbook',
    icon: '✦',
    keywords: ['skills', 'canned', 'ai'],
  },
  {
    to: '/app/reports',
    labelKey: 'nav.reports',
    icon: '◆',
    keywords: ['analytics', 'metrics', 'kpi'],
  },
];

export const FOOTER: NavDestination[] = [
  {
    to: '/app/billing',
    labelKey: 'nav.billing',
    icon: '◈',
    keywords: ['subscription', 'plan', 'invoice', 'payment'],
  },
  {
    to: '/app/settings',
    labelKey: 'nav.settings',
    icon: '⚙',
    keywords: ['channels', 'tags', 'notifications', 'preferences'],
  },
  {
    to: '/app/developers',
    labelKey: 'nav.developers',
    icon: '{}',
    keywords: ['api', 'oauth', 'partner', 'apps', 'zapier', 'make', 'build your own app'],
    scope: 'access_rules:rw',
  },
];

export const NAV_DESTINATIONS: NavDestination[] = [...MODULES, ...FOOTER];
