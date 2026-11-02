import type { Messages } from '../merge.js';

/**
 * The shell around every root-panel page: the PLATFORM strip, the side menu (`nav.*`), the
 * account menu, the empty page skeletons and the reason dialog (tm 389.6).
 */
export const shell: Messages = {
  'shell.strip.label': 'PLATFORM · {region}',
  'shell.strip.labelUnknown': 'PLATFORM',
  'shell.narrow.notice':
    'This panel is built for screens at least 1280 px wide. Some pages may not fit.',
  'shell.skipToContent': 'Skip to content',
  'shell.nav.label': 'Main menu',
  'shell.account.label': 'Account',
  'shell.account.signedInAs': 'Signed in as {email}',
  'shell.account.signOut': 'Sign out',
  'shell.account.menu': 'My account',
  'shell.account.recovery.label': 'Renew recovery codes',
  'shell.account.recovery.title': 'Renew recovery codes',
  'shell.account.recovery.body':
    'Ten new single-use codes replace the ones you have; the old ones stop working. The new sheet is shown once, right after this.',
  'shell.account.recovery.remaining': 'Unused recovery codes left: {count}',
  'shell.account.recovery.confirm': 'Renew codes',
  'shell.account.sessions.label': 'My sessions',
  'shell.account.sessions.title': 'My sessions',
  'shell.account.sessions.body': 'Everywhere you are signed in to this panel right now.',
  'shell.account.sessions.loading': 'Loading…',
  'shell.account.sessions.loadError': 'Your sessions could not be loaded',
  'shell.account.sessions.empty': 'No open session.',
  'shell.account.sessions.col.started': 'Started',
  'shell.account.sessions.col.lastSeen': 'Last used',
  'shell.account.sessions.col.ip': 'Address',
  'shell.account.sessions.col.browser': 'Browser',
  'shell.account.sessions.current': 'This session',
  'shell.account.sessions.endOthers': 'Sign out all other sessions',
  'shell.account.sessions.ended': 'Other sessions ended: {count}.',
  'shell.account.sessions.close': 'Close',
  'shell.account.language': 'Language',
  'shell.account.theme': 'Theme',
  'shell.account.theme.light': 'Light',
  'shell.account.theme.dark': 'Dark',
  'shell.role.superadmin': 'Superadmin',
  'shell.role.support': 'Support',
  'shell.role.billing': 'Billing',
  'shell.role.readonly': 'Read-only',

  'nav.dashboard': 'Dashboard',
  'nav.workspaces': 'Workspaces',
  'nav.accounts': 'Accounts',
  'nav.billing': 'Billing',
  'nav.usage': 'Usage',
  'nav.settings': 'Settings',
  'nav.ai': 'AI',
  'nav.operations': 'Operations',
  'nav.audit': 'Audit',
  'nav.security': 'Security',
  'nav.admins': 'Admins',
  'nav.support': 'Support',

  'shell.pages.empty.title': 'Nothing here yet',
  'shell.pages.empty.description':
    'This page is a placeholder. The tasks that build it add its content here.',
  'shell.pages.dashboard.description': 'Platform health, sign-ups and key figures.',
  'shell.pages.workspaces.description': 'Every workspace on this deployment.',
  'shell.pages.accounts.description': 'People, their sign-in state and their sessions.',
  'shell.pages.billing.description': 'Plans, subscriptions, invoices and payment queues.',
  'shell.pages.usage.description': 'Consumption across the platform and per workspace.',
  'shell.pages.settings.description': 'Sign-up, trial, announcements and maintenance.',
  'shell.pages.ai.description': 'Providers, models, keys, caps and catalogues.',
  'shell.pages.operations.description': 'Scheduler, webhooks, partitions and background jobs.',
  'shell.pages.audit.description': 'The signed record of every operator action.',
  'shell.pages.security.description': 'Blocklist, failed sign-ins and abuse counters.',
  'shell.pages.admins.description': 'Operators, their roles and their invitations.',
  'shell.pages.support.description': 'Look a workspace up and enter it as its owner.',

  'shell.forbidden.title': 'You do not have access to this page',
  'shell.forbidden.description':
    'Your role ({role}) does not include it. Ask a superadmin if you need access.',
  'shell.forbidden.serverDescription':
    'The server refused this request for your role. Ask a superadmin if you need access.',
  'shell.forbidden.back': 'Back to the dashboard',

  'shell.notFound.title': 'Page not found',
  'shell.notFound.description': 'There is no page at this address.',
  'shell.notFound.back': 'Back to the dashboard',

  'shell.reason.label': 'Reason',
  'shell.reason.hint': 'Required, 3 to 500 characters. It is written to the platform audit log.',
  'shell.reason.totpLabel': 'Authenticator code',
  'shell.reason.totpHint': 'This action asks for a fresh six-digit code.',
  'shell.reason.confirm': 'Confirm',
  'shell.reason.totpInvalid': 'That code did not work. Check the code and your device clock.',
};
