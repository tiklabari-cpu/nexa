/**
 * The one list of navigable modules.
 *
 * Both the icon rail (which renders them) and the command palette (which jumps
 * to them) read from here, so a module added to the product appears in both
 * without either drifting from the other.
 */
export interface NavDestination {
  to: string;
  label: string;
  icon: string;
  /**
   * Extra words the palette should match besides the label — an agent reaching
   * for "subscription" should land on Billing without having to know we call it
   * that.
   */
  keywords?: string[];
}

export const MODULES: NavDestination[] = [
  { to: '/app/inbox', label: 'Inbox', icon: '▤', keywords: ['conversations', 'chats', 'tickets'] },
  { to: '/app/customers', label: 'Customers', icon: '◫', keywords: ['people', 'crm', 'leads'] },
  { to: '/app/team', label: 'Team', icon: '◑', keywords: ['agents', 'groups'] },
  { to: '/app/playbook', label: 'Playbook', icon: '✦', keywords: ['skills', 'canned', 'ai'] },
  { to: '/app/reports', label: 'Reports', icon: '◆', keywords: ['analytics', 'metrics', 'kpi'] },
];

export const FOOTER: NavDestination[] = [
  {
    to: '/app/billing',
    label: 'Billing',
    icon: '◈',
    keywords: ['subscription', 'plan', 'invoice', 'payment'],
  },
  {
    to: '/app/settings',
    label: 'Settings',
    icon: '⚙',
    keywords: ['channels', 'tags', 'notifications', 'preferences'],
  },
];

export const NAV_DESTINATIONS: NavDestination[] = [...MODULES, ...FOOTER];
