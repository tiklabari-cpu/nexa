import type { Messages } from '../merge.js';

/** Chrome that surrounds every screen: the shell header, the rail, the palette. */
export const shell: Messages = {
  // Shell chrome
  'shell.modules': 'Modules',
  'shell.subscribe': 'Subscribe',
  'shell.trial.ended': 'Your trial has ended — subscribe to start new conversations.',
  // Plural forms, selected by `Intl.PluralRules` from the `count` param. English
  // needs both; see the Turkish file for why it still carries two.
  'shell.trial.remaining.one': '{count} day left in your trial.',
  'shell.trial.remaining.other': '{count} days left in your trial.',
  'shell.account': 'Account',
  'shell.account.agentFallback': 'Agent',
  'shell.account.signOut': 'Sign out',
  'shell.account.language': 'Language',
  'shell.account.theme': 'Theme',
  'shell.account.theme.dark': 'Dark',
  'shell.account.theme.light': 'Light',
  'shell.brand': 'Brand',
  'shell.sandbox.notice':
    'Sandbox workspace — nothing here is billed, and nothing here is production data.',
  'shell.nav.expand': 'Expand navigation',
  'shell.nav.collapse': 'Collapse navigation',

  // Rail badges (FR-MOD-01.2). Just the count's spoken form — `RailButton`
  // prefixes it with the module's own label to build the accessible name.
  'shell.nav.badge.inbox.one': '{count} unread',
  'shell.nav.badge.inbox.other': '{count} unread',
  'shell.nav.badge.team.one': '{count} pending invite',
  'shell.nav.badge.team.other': '{count} pending invites',

  // Invite (FR-MOD-01.1.5). "+N" is free seats — not yet known (or none to
  // report) falls back to the plain label.
  'shell.invite.label': 'Invite',
  'shell.invite.labelWithCount': 'Invite +{count}',

  // Leads pill (FR-MOD-01.1.2). Hidden at 0 — see LeadsPill in AppShell.tsx.
  'shell.leads.label.one': '{count} Lead qualified',
  'shell.leads.label.other': '{count} Leads qualified',

  // Presence (FR-MOD-01.1.4). The status word is part of each avatar's
  // accessible name because the ring colour alone would not carry it (A11Y2).
  'shell.presence.label': 'Teammates online',
  'shell.presence.accepting': 'accepting chats',
  'shell.presence.away': 'online, not accepting chats',
  'shell.presence.member': '{name} — {status}',
  'shell.presence.more.one': '{count} more online: {names}',
  'shell.presence.more.other': '{count} more online: {names}',

  // Navigation (rail + command palette)
  'nav.home': 'Home',
  'nav.inbox': 'Inbox',
  'nav.customers': 'Customers',
  'nav.team': 'Team',
  'nav.playbook': 'Playbook',
  'nav.reports': 'Reports',
  'nav.billing': 'Billing',
  'nav.settings': 'Settings',
  'nav.developers': 'Developers',

  // Command palette
  'palette.label': 'Command palette',
  'palette.search': 'Search or jump to',
  // FR-MOD-01.1.3's acceptance criterion quotes this string verbatim. The
  // longer, more descriptive line it replaced said the same thing in more
  // words; the criterion is checkable and the prose was not, so the prose
  // lost. What the palette can find is spelled out by the group headings a
  // keystroke later anyway.
  'palette.placeholder': 'Search Text or go to…',
  'palette.searching': 'Searching…',
  'palette.noMatches': 'No matches.',
  'palette.group.goTo': 'Go to',
  'palette.group.actions': 'Actions',
  'palette.group.customers': 'Customers',
  'palette.group.conversations': 'Conversations',
  'palette.group.tickets': 'Tickets',
  'palette.unnamedVisitor': 'Unnamed visitor',
  'palette.visitor': 'Visitor',
  'palette.action.failed': 'That action did not go through.',
  'palette.action.failedFallback': 'Nothing was changed — try again.',
  'palette.action.failedDismiss': 'Dismiss',
  'palette.group.ai': 'Ask AI',
  'palette.ai.ask': 'Ask AI: "{query}"',
  'palette.ai.source': 'Source: {source}',
  'palette.ai.noData.title': 'No data yet',
  'palette.ai.notUnderstood.title': 'Not sure what you mean',
  'palette.ai.error': 'Could not get an answer — try again.',
};
