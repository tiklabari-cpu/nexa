import type { Messages } from '../merge.js';

/**
 * The conversation timeline (ID-09 · tm 334.2): every event of one day or one
 * connection in one list. Message text, tag names and ticket subjects are
 * conversation content and stay as written. The two numbers are named by the
 * ids catalogue (`ids.thread.label`, `ids.chat.label`), never here.
 */
export const timeline: Messages = {
  'timeline.title': 'Timeline',
  'timeline.zone': 'Times are shown in {zone}. Hover a time for the UTC moment.',
  'timeline.back': 'Back to the conversation',
  'timeline.loading': 'Loading…',
  'timeline.noChat.title': 'No conversation chosen',
  'timeline.noChat.description': 'Open a timeline from a conversation in the Inbox or the Archive.',
  'timeline.notFound.title': 'Conversation not found',
  'timeline.notFound.description': 'It does not exist, or it is not one you can see.',
  'timeline.error.title': "The timeline couldn't be loaded",
  'timeline.empty.title': 'Nothing recorded yet',
  'timeline.empty.description': 'No rows match the chosen kinds.',
  'timeline.empty.filteredTitle': 'No loaded row matches',
  'timeline.empty.filteredAll': 'Try other words.',
  'timeline.empty.filteredMore': 'Try other words, or load more rows to search further.',

  'timeline.scope.day': 'Show the whole day',
  'timeline.divider': 'Connection starts',
  'timeline.list.ariaLabel': 'Timeline rows',

  'timeline.search.label': 'Filter the loaded rows',
  'timeline.search.placeholder': 'Filter loaded rows…',
  'timeline.search.count': 'Showing {shown} of {loaded} loaded rows',
  'timeline.search.loadedOnly':
    'The filter covers the rows loaded so far. Load more rows to search further back.',
  'timeline.loaded.one': '{count} row loaded',
  'timeline.loaded.other': '{count} rows loaded',

  'timeline.kinds.label': 'Kinds shown',
  'timeline.kind.message': 'Message',
  'timeline.kind.note': 'Internal note',
  'timeline.kind.ai_decision': 'AI decision',
  'timeline.kind.system': 'System',
  'timeline.kind.assignment': 'Assignment',
  'timeline.kind.transfer': 'Transfer',
  'timeline.kind.tag': 'Tag',
  'timeline.kind.rating': 'Rating',
  'timeline.kind.sla_breach': 'SLA',
  'timeline.kind.ticket': 'Ticket',
  'timeline.kind.audit': 'Audit',

  'timeline.actor.agent': 'Agent',
  'timeline.actor.customer': 'Visitor',
  'timeline.actor.bot': 'Bot',
  'timeline.actor.system': 'System',
  'timeline.actor.ai': 'AI Agent',

  'timeline.row.copy': 'Copy this row',
  'timeline.row.copied': 'Copied',
  'timeline.row.details': 'Details',
  'timeline.attachment': 'Attachment',
  'timeline.ai.run': 'Procedure run: {name} · {status}',
  'timeline.ai.procedure': 'Procedure: {name}',
  'timeline.ai.step': 'Step: {step}',
  'timeline.ai.sources.one': '{count} knowledge source read',
  'timeline.ai.sources.other': '{count} knowledge sources read',
  'timeline.ai.handoff': 'Handoff reason: {reason}',
  'timeline.assignment.assigned': 'Assigned',
  'timeline.assignment.queued': 'Entered the queue',
  'timeline.assignment.leftQueue': 'Left the queue: {outcome}',
  'timeline.assignment.unknownOutcome': 'unknown',
  'timeline.sla': 'SLA target missed ({target}): {elapsed} of {limit} min',

  'timeline.loadMore': 'Load more',
  'timeline.loadMore.loading': 'Loading…',
  'timeline.loadMore.error': "The next rows couldn't be loaded. Try again.",
  'timeline.end': 'That is everything.',

  'timeline.audit.notPermitted': "Audit entries are not listed: you can't read the audit log.",
  'timeline.audit.expired':
    "Record retention has expired: this conversation's audit entries are past their retention period and are not listed.",

  'timeline.export.button': 'Export',
  'timeline.export.title': 'Export the timeline',
  'timeline.export.description':
    'The file holds every row of this {scope}, not only what is filtered here — at most {max} rows.',
  'timeline.export.scopeDay': 'day',
  'timeline.export.scopeThread': 'connection',
  'timeline.export.format': 'Format',
  'timeline.export.format.csv': 'CSV (spreadsheet)',
  'timeline.export.format.ndjson': 'NDJSON (one JSON object per line)',
  'timeline.export.format.txt': 'Text (easy to read)',
  'timeline.export.mask': 'Mask email and username',
  'timeline.export.maskHint': 'Untick to download the file without masking.',
  'timeline.export.maskLocked': 'Only the Founder can download without masking.',
  'timeline.export.audited': 'Every download is recorded in the audit log.',
  'timeline.export.cancel': 'Cancel',
  'timeline.export.submit': 'Download',
  'timeline.export.preparing': 'Preparing…',
};
