import type { Messages } from '../merge.js';

/** Admins: the operator's own alert preferences (tm 389.20). */
export const admins: Messages = {
  'admins.alerts.title': 'Alert e-mails',
  'admins.alerts.loading': 'Loading…',
  'admins.alerts.loadError': 'Your alert preferences could not be loaded',
  'admins.alerts.hint':
    'The platform checks every five minutes and e-mails you the alerts ticked below, at most once a day for each — the health and audit chain alerts once an hour.',
  'admins.alerts.hint.default':
    'You have not chosen yet: superadmins get every alert, other roles none. Save to make your choice final.',
  'admins.alerts.locale': 'Language of the e-mails',

  'admins.alerts.kind.trial_ending': 'A trial ends within 3 days',
  'admins.alerts.kind.trial_ending.hint': 'A workspace whose trial is about to end.',
  'admins.alerts.kind.payment_request_waiting': 'A payment request waits over 24 hours',
  'admins.alerts.kind.payment_request_waiting.hint':
    'A crypto payment request nobody has handled for a day.',
  'admins.alerts.kind.ai_cap_reached': 'A workspace reaches its daily AI allowance',
  'admins.alerts.kind.ai_cap_reached.hint':
    'The AI stops answering in that workspace until midnight UTC.',
  'admins.alerts.kind.health_red': 'The health check turns red',
  'admins.alerts.kind.health_red.hint':
    'The health snapshot is missing, stale or degraded — the tenant API may be down.',
  'admins.alerts.kind.audit_chain_broken': 'The audit chain no longer verifies',
  'admins.alerts.kind.audit_chain_broken.hint':
    'The daily check of the platform audit chain found a break.',
  'admins.alerts.kind.purge_tomorrow': 'A workspace is deleted tomorrow',
  'admins.alerts.kind.purge_tomorrow.hint':
    'Its data goes for good unless the deletion is cancelled.',
};
