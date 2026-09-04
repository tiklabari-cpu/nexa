import type { Messages } from '../merge.js';

/**
 * The audit log screen (`features/audit/AuditLogPage.tsx`, I18N-j, tm 133.10).
 * Its own namespace rather than folded into `settings.ts`: the page lives
 * under its own route (`/app/settings/audit-log`), not inside the Settings
 * composition root — `SettingsPage.tsx`'s door to it is `settings.auditLog.*`.
 *
 * Action codes (`auth.login`, `member.invited`, …) stay untranslated on
 * purpose — see the module doc in `AuditLogPage.tsx`.
 */
export const audit: Messages = {
  'audit.title': 'Audit log',
  'audit.description':
    'Sign-ins, role changes, deletions and webhook changes — the last 30 days by default.',
  'audit.notAvailable.title': 'Audit log not available',
  'audit.notAvailable.description':
    "Viewing the security trail is limited to owners and admins with read access to this workspace's audit log.",
  'audit.loadError': 'Could not load the audit log. Check that the API is reachable and try again.',
  'audit.empty.title': 'No activity yet',
  'audit.empty.description':
    'Sign-ins, role changes, deletions and webhook changes will appear here as they happen.',
  'audit.actor.agent': 'Agent',
  'audit.actor.bot': 'Bot',
  'audit.actor.customer': 'Customer',
  'audit.actor.system': 'System',
  'audit.filterByActionAriaLabel': 'Filter by action',
  'audit.allActions': 'All actions',
  'audit.fromDateAriaLabel': 'From date',
  'audit.toDateAriaLabel': 'To date',
  'audit.loading': 'Loading…',
  'audit.loadMore': 'Load more',
  'audit.column.time': 'Time',
  'audit.column.action': 'Action',
  'audit.column.actor': 'Actor',
  'audit.column.target': 'Target',
  'audit.column.ip': 'IP',
  'audit.column.detail': 'Detail',
  'audit.detail.toggleAriaLabel': 'Detail for {action} at {time}',
  'audit.detail.entryId': 'Entry ID',
  'audit.detail.chainPosition': 'Chain position',
  'audit.detail.chainUnavailable':
    'Not chained — written before this workspace’s audit chain existed',
  'audit.detail.recordedDetail': 'Recorded detail',
  'audit.detail.noMetadata': 'This action records no further detail.',
  'audit.detail.minimalNote':
    'Audit entries deliberately record field names, counts and roles — never values, secrets or message content. Some actions omit the source address on purpose.',
  'audit.detail.linkedEntry': 'Linked entry — outside the current filter or page',
  'audit.detail.loadError':
    'Could not load this entry. It may have passed the workspace’s retention window.',
  'audit.group.authentication': 'Authentication',
  'audit.group.team': 'Team',
  'audit.group.settings': 'Settings',
  'audit.group.compliance': 'Compliance',
  'audit.group.salesTracking': 'Sales tracking',
  'audit.group.billing': 'Billing',
  'audit.group.webhooks': 'Webhooks',
  'audit.group.tickets': 'Tickets',
  'audit.group.credentials': 'Credentials',
  'audit.group.data': 'Data',
};
