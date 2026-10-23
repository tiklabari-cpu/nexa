import type { Messages } from '../merge.js';

/**
 * Archive: the list of past connections, the read-only transcript and the player
 * panel (AR-01 · tm 335.2). The player's words — the first message in a row, the
 * transcript, a rating's comment — are conversation content and stay as written.
 */
export const archive: Messages = {
  'archive.title': 'Archive',

  // Below the desktop breakpoint the three panes are tabs (GV-04)
  'archive.panes.ariaLabel': 'Archive panes',
  'archive.panes.list': 'List',
  'archive.panes.transcript': 'Conversation',
  'archive.panes.player': 'Player',

  // The list
  'archive.list.region': 'Archived conversations',
  'archive.list.ariaLabel': 'Conversations',
  'archive.list.total.one': '{count} conversation',
  'archive.list.total.other': '{count} conversations',
  'archive.list.totalCapped': 'More than {total} conversations',
  'archive.list.loading': 'Loading…',
  'archive.list.loadMore': 'Load more',
  'archive.list.error.title': "The archive couldn't be loaded",
  'archive.list.error.more': "The next conversations couldn't be loaded. Scroll to try again.",
  'archive.empty.title': 'No archive yet',
  'archive.empty.description': 'Conversations that have ended will appear here.',
  'archive.filter.includeOpen': 'Also show conversations still in progress',
  'archive.filter.groupByDay': 'Group the same day together',
  'archive.group.connections.one': '{count} conversation that day',
  'archive.group.connections.other': '{count} conversations that day',

  // One row
  'archive.row.open': 'In progress',
  'archive.row.unassigned': 'Unassigned',
  'archive.row.noMessage': 'No message from the player',
  'archive.row.messages.one': '{count} message',
  'archive.row.messages.other': '{count} messages',
  'archive.row.riskFlags.one': '{count} risk flag',
  'archive.row.riskFlags.other': '{count} risk flags',
  'archive.rating.good': 'Rated good',
  'archive.rating.bad': 'Rated bad',
  'archive.handledBy.ai': 'Handled by the AI',
  'archive.handledBy.human': 'Handled by a person',
  'archive.handledBy.mixed': 'AI and a person',
  'archive.handledBy.unknown': 'Not recorded',

  // The conversation pane
  'archive.detail.none.title': 'Pick a conversation',
  'archive.detail.none.hint':
    'Choose one from the list to read it here. The address of this page opens the same one for anybody who may see it.',
  'archive.detail.loading': 'Loading the conversation…',
  'archive.detail.status.open': 'In progress',
  'archive.detail.status.closed': 'Ended',
  'archive.detail.retention.title': 'This conversation was deleted',
  'archive.detail.retention.description':
    'It was deleted because its retention period ended. The record of it no longer exists.',
  'archive.detail.notFound.title': 'Conversation not found',
  'archive.detail.notFound.description':
    "There is no conversation with this number that you can see. It may belong to a team you aren't part of.",
  'archive.detail.error.title': "The conversation couldn't be loaded",
  'archive.detail.transcriptError.title': "The messages couldn't be loaded",

  // Actions — the archive itself is read-only; these leave it
  'archive.action.openInbox': 'Open in Inbox',
  'archive.action.reopen': 'Reopen',
  'archive.action.reopening': 'Reopening…',

  // The player pane
  'archive.player.ariaLabel': 'Player and conversation details',
  'archive.player.title': 'Player',
  'archive.player.none': 'Pick a conversation to see who wrote it.',
  'archive.player.unavailable': "The details couldn't be loaded.",
  'archive.facts.section': 'This conversation',
  'archive.facts.assignee': 'Handled by',
  'archive.facts.team': 'Team',
  'archive.facts.handledBy': 'Answered by',
  'archive.facts.rating': 'Rating',
  'archive.facts.tags': 'Tags',
  'archive.facts.risk': 'Risk flags',
  'archive.facts.messages': 'Messages',
};
