import type { Messages } from '../merge.js';

/**
 * The support desk's lookup (tm 389.9). "Thread ID" and "Chat ID" are the panel's names for the
 * two conversation numbers and stay English in every locale (ID-01-S1).
 */
export const support: Messages = {
  'support.lookup.label': 'Find the workspace for an identifier',
  'support.lookup.hint':
    'Paste a Thread ID, a Chat ID, a ticket number or a customer’s email. Only the workspace is shown — never what was written.',
  'support.lookup.submit': 'Look up',
  'support.lookup.searching': 'Looking…',
  'support.lookup.none': 'Nothing matches that. Check for a typo — or it is not an identifier.',
  'support.lookup.failed': 'The lookup failed',
  'support.lookup.idle': 'Results appear here.',
  'support.lookup.results': 'Matching workspaces',
  'support.lookup.matched': 'Matched',
  'support.lookup.organization': 'Workspace',
  'support.lookup.licence': 'Licence',
  'support.kind.thread_id': 'Thread ID',
  'support.kind.chat_id': 'Chat ID',
  'support.kind.ticket': 'Ticket',
  'support.kind.customer_email': 'Customer email',
  // "Enter as the customer" (tm 389.15).
  'support.impersonate.open': 'Enter as customer',
  'support.impersonate.title': 'Enter {workspace} as a member',
  'support.impersonate.description':
    'Opens the workspace console as the member you pick, for 30 minutes, with their role and nothing more. The workspace’s owner is emailed, and everything done is recorded as yours.',
  'support.impersonate.confirm': 'Create the link',
  'support.impersonate.member': 'Member',
  'support.impersonate.chooseMember': 'Choose a member…',
  'support.impersonate.membersFailed': 'The members could not be loaded.',
  'support.impersonate.mode': 'Access',
  'support.impersonate.modes.read_only': 'Read-only',
  'support.impersonate.modes.read_only.hint': 'Look, change nothing. The usual choice.',
  'support.impersonate.modes.full': 'Full',
  'support.impersonate.modes.full.hint':
    'Act as the member. Passwords, security, billing and credentials stay closed. Needs a fresh authenticator code.',
  'support.impersonate.modes.full.superadminOnly': 'Superadmins only.',
  'support.impersonate.errors.accountSuspended':
    'This person is suspended by SiyahTuş — lift the suspension first.',
  'support.impersonate.errors.workspaceClosed':
    'This workspace is suspended or cancelled — nobody can be signed in to it.',
  'support.impersonate.errors.notAMember': 'That person is no longer an active member here.',
  'support.impersonate.ready.title': 'The session is ready',
  'support.impersonate.ready.readOnly': 'Read-only session as {email}.',
  'support.impersonate.ready.full': 'Full session as {email}.',
  'support.impersonate.ready.once':
    'The link works once, until {time}. The session ends at {ends}.',
  'support.impersonate.ready.mail.sent': 'The workspace’s owner has been emailed.',
  'support.impersonate.ready.mail.failed': 'The email to the workspace’s owner could not be sent.',
  'support.impersonate.ready.mail.none': 'The workspace has no owner to email.',
  'support.impersonate.ready.open': 'Open the workspace',
  'support.impersonate.ready.close': 'Close',
  'support.impersonations.title': 'Open support sessions',
  'support.impersonations.loading': 'Loading sessions…',
  'support.impersonations.failed': 'The sessions could not be loaded',
  'support.impersonations.none': 'No operator is inside a workspace right now.',
  'support.impersonations.workspace': 'Workspace',
  'support.impersonations.member': 'Member',
  'support.impersonations.operator': 'Operator',
  'support.impersonations.mode': 'Access',
  'support.impersonations.ends': 'Ends',
  'support.impersonations.actions': 'Actions',
  'support.impersonations.end': 'End session',
  'support.impersonations.endTitle': 'End the session as {email}',
  'support.impersonations.endDescription':
    'The console tab it was opened in stops working at once.',
};
