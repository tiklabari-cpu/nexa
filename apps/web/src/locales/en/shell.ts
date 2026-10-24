import type { Messages } from '../merge.js';

/** Chrome that surrounds every screen: the shell header, the rail, the palette. */
export const shell: Messages = {
  // Shell chrome
  // Availability notices (WG-03 · tm 340.3) — PresenceNotices.tsx
  'shell.presence.title': 'Your availability changed',
  'shell.presence.unresponsive':
    'A chat assigned to you went without a reply for {duration}, so it was passed to a teammate and you were set to Not accepting chats.',
  'shell.presence.unresponsive.noDuration':
    'A chat assigned to you went without a reply for too long, so it was passed to a teammate and you were set to Not accepting chats.',
  'shell.presence.disconnected':
    'No console window of yours was connected for {duration}, so you were set to Offline and new chats went to others.',
  'shell.presence.disconnected.noDuration':
    'No console window of yours was connected for a while, so you were set to Offline and new chats went to others.',
  'shell.presence.changedWhileAway':
    'While your connection was down, your status changed to {status}.',
  'shell.presence.acceptAgain': 'Accept chats again',
  'shell.presence.acceptFailed': 'Your status could not be changed. Try again.',
  'shell.presence.dismiss': 'Dismiss this notice',
  'shell.presence.duration.minutes.one': '{count} minute',
  'shell.presence.duration.minutes.other': '{count} minutes',
  'shell.presence.duration.seconds.one': '{count} second',
  'shell.presence.duration.seconds.other': '{count} seconds',
  'shell.presence.alert.title': 'A chat is waiting unanswered',
  'shell.presence.alert.noAgent':
    '{agent} did not reply to a new chat in time and nobody else in the team was free. It is waiting at the front of the team’s queue.',
  'shell.presence.alert.transferLimit.one':
    'A new chat has gone unanswered by {count} agent. It is waiting at the front of the team’s queue for you to decide.',
  'shell.presence.alert.transferLimit.other':
    'A new chat has gone unanswered by {count} agents in a row. It is waiting at the front of the team’s queue for you to decide.',
  'shell.presence.alert.someone': 'An agent',
  'shell.presence.alert.open': 'Open chat',
  'shell.modules': 'Modules',
  'shell.skipToContent': 'Skip to content',
  // An address under /app that is not a page (UX audit D11).
  'shell.notFound.title': 'Page not found',
  'shell.notFound.description':
    'There is no page at this address. It may have moved, or the link may be mistyped.',
  'shell.notFound.back': 'Go to the inbox',
  // A window under 1024 px (tm 259.25): the console asks before it opens.
  'shell.narrow.title': 'The console is designed for desktop',
  'shell.narrow.body':
    'This screen is narrower than the console’s layout, so some columns will not fit and parts of a page may need sideways scrolling.',
  'shell.narrow.mobileApp':
    'On a phone, the SiyahTuş mobile app is the better way to answer chats.',
  'shell.narrow.continue': 'Continue anyway',
  'shell.subscribe': 'Subscribe',
  'shell.trial.ended': 'Your trial has ended — subscribe to start new conversations.',
  // The public pilot's strip (tm 257.15): nothing is on sale there, so the way on
  // is the contact address. `{email}` is made a mailto link by the strip itself.
  'shell.pilotTrial.remaining.one':
    'Your pilot trial ends in {count} day — to continue, contact {email}.',
  'shell.pilotTrial.remaining.other':
    'Your pilot trial ends in {count} days — to continue, contact {email}.',
  'shell.pilotTrial.ended': 'Your pilot trial has ended — to continue, contact {email}.',
  // A pilot deployment with no contact address configured (production refuses to
  // boot that way; a development build can): the same facts, without the address.
  'shell.pilotTrial.noContact.remaining.one': 'Your pilot trial ends in {count} day.',
  'shell.pilotTrial.noContact.remaining.other': 'Your pilot trial ends in {count} days.',
  'shell.pilotTrial.noContact.ended': 'Your pilot trial has ended.',
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
  // Panel font presets (owner, 2026-10-13). The names are the fonts' own and
  // stay in Latin script in every language.
  'shell.account.font': 'Font',
  'shell.account.font.workspaceDefault': 'Workspace default',
  'shell.account.font.source.builtin': 'Built-in: {font}',
  'shell.account.font.source.workspace': 'Workspace default: {font} · {date}',
  'shell.account.font.source.user': 'Your choice: {font} · {date}',
  'shell.account.font.saveError': 'The font could not be saved.',
  'shell.font.inter': 'Inter (default)',
  'shell.font.plus-jakarta': 'Plus Jakarta Sans',
  'shell.font.manrope-dm-sans': 'Manrope + DM Sans',
  'shell.font.nunito': 'Nunito',
  'shell.font.figtree': 'Figtree',
  'shell.font.inter.description': 'Crisp and neutral — the panel as it ships.',
  'shell.font.plus-jakarta.description': 'Geometric and friendly, a little more open.',
  'shell.font.manrope-dm-sans.description': 'Soft Manrope headings over easy-reading DM Sans.',
  'shell.font.nunito.description': 'Rounded and warm; the largest body text of the five.',
  'shell.font.figtree.description': 'Clean and modern, softer than Inter.',
  'shell.brand': 'Brand',
  // App menu (FR-MOD-01.1.1). The logo's trigger label, plus the one
  // destination in its panel that has no rail icon of its own.
  'shell.menu': 'App menu',
  'shell.menu.apps': 'Apps',
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

  // Quick create (FR-MOD-04.1). The rail's "+" menu — invite a teammate, or
  // start a new team.
  'shell.quickCreate.label': 'Quick create',

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

  // Desktop notification — features/notifications/useNotifications.ts (not a
  // component: it reads the active locale at the moment the push arrives)
  'shell.notification.title': 'New message',
  'shell.notification.fallbackBody': 'A visitor sent a new message.',

  // Navigation (rail + command palette)
  'nav.home': 'Home',
  'nav.inbox': 'Inbox',
  'nav.archive': 'Archive',
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
  // Archive mode (ID-07 · tm 333.4)
  'palette.archive.group': 'Archive',
  'palette.archive.enter': 'Search the archive',
  'palette.archive.enterFor': 'Search the archive: "{query}"',
  'palette.archive.placeholder': 'Search message text in the archive…',
  'palette.archive.leave': 'Leave archive search',
  'palette.archive.error': 'The archive search failed — try again.',
};
