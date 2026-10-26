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
};
