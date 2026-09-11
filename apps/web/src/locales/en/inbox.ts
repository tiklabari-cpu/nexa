import type { Messages } from '../merge.js';

/**
 * Inbox: views rail, conversation list, transcript, composer, details,
 * Copilot, and the ticket half of the surface (I18N-c, tm 133.3).
 *
 * The BI example questions in `CopilotPanel.tsx` stay out of this catalogue on
 * purpose: they are text matched against the AI mocks, not chrome, and PRD §9
 * excludes conversation content from translation.
 *
 * Reply Suggestions (`replySuggestions.ts`) used to be exempted on the same
 * grounds and no longer is (tm 219). PRD §9 keeps *conversation* content out of
 * translation — what the customer wrote, what the agent typed — and a chip is
 * neither: it is a phrase the product authored and is offering, so a Turkish
 * agent being offered it in English is the same defect as an English rail
 * label in a Turkish console. The generator now yields intent ids and the
 * `inbox.composer.suggestions.chip.*` keys below say them.
 */
export const inbox: Messages = {
  // Views rail
  'inbox.rail.ariaLabel': 'Inbox views',
  'inbox.rail.title': 'Inbox',
  'inbox.rail.view.all': 'All',
  'inbox.rail.view.my': 'My chats',
  'inbox.rail.view.queued': 'Queued',
  'inbox.rail.view.unassigned': 'Unassigned',
  'inbox.rail.view.supervised': 'Supervised',
  'inbox.rail.view.archived': 'Archive',
  'inbox.rail.aiHeading': 'AI Agents',
  'inbox.rail.view.ai': 'AI agent',
  'inbox.rail.view.aiSolved': 'Solved',
  'inbox.rail.ticketsHeading': 'Tickets',
  'inbox.rail.ticketView.all': 'All tickets',
  'inbox.rail.ticketView.unassigned': 'Unassigned',
  'inbox.rail.ticketView.myOpen': 'My open',
  'inbox.rail.ticketView.solved': 'Solved',
  'inbox.rail.ticketView.more': 'More',
  'inbox.rail.viewsHeading': 'Views',
  'inbox.rail.channelPromo.text':
    'Connect Messenger, WhatsApp or SMS to see their conversations here.',
  'inbox.rail.channelPromo.cta': 'Connect a channel →',
  'inbox.rail.channelConnected': 'Connected',
  'inbox.rail.savedView.remove': 'Remove saved view {name}',
  'inbox.rail.savedView.saveCurrent': 'Save current view',
  'inbox.rail.savedView.namePlaceholder': 'Name this view',
  'inbox.rail.savedView.nameAriaLabel': 'Saved view name',
  'inbox.rail.savedView.submit': 'Save',
  'inbox.rail.savedView.cancel': 'Cancel',
  'inbox.rail.availability': 'Availability',
  'inbox.rail.routing.accepting': 'Accepting chats',
  'inbox.rail.routing.notAccepting': 'Not accepting',
  'inbox.rail.routing.offline': 'Offline',
  'inbox.rail.connection.live': 'Live',
  'inbox.rail.connection.offline': 'Offline',
  'inbox.rail.connection.reconnecting': 'Reconnecting',

  // Take tour banner (FR-MOD-01.4, 02.2.3) — TakeTourBanner.tsx
  'inbox.takeTour.text': 'New here? Take a quick tour of the inbox.',
  'inbox.takeTour.cta': 'Take tour',
  'inbox.takeTour.step1.title': 'Your queues',
  'inbox.takeTour.step1.body':
    'All, My chats, Queued, Unassigned and Archive — each view on the left filters the conversations you see.',
  'inbox.takeTour.step2.title': 'The conversation',
  'inbox.takeTour.step2.body':
    'Pick a chat from the list to read the transcript, then reply from the composer underneath it.',
  'inbox.takeTour.step3.title': 'Details and Copilot',
  'inbox.takeTour.step3.body':
    "The right panel shows the customer's details, or switch it to Copilot for AI-drafted replies.",
  'inbox.takeTour.step4.title': 'Your availability',
  'inbox.takeTour.step4.body':
    'Set your status at the bottom of the rail to control whether new chats route to you.',

  // Conversation list
  'inbox.list.ariaLabel': 'Conversations',
  'inbox.list.trafficAriaLabel': 'Real-time tabs',
  'inbox.list.traffic.all': 'All',
  'inbox.list.traffic.chatting': 'Chatting',
  'inbox.list.traffic.queued': 'Queued',
  'inbox.list.traffic.waiting': 'Waiting',
  'inbox.list.empty.tabTitle': 'Nothing in this tab',
  'inbox.list.empty.tabDescription': 'No conversations match this tab right now.',
  'inbox.list.empty.title': 'Nothing here yet',
  'inbox.list.empty.archived': 'Closed conversations will appear here.',
  'inbox.list.empty.supervised':
    'Supervising nothing right now. Watch a conversation from Traffic and it lands here.',
  'inbox.list.empty.ai': 'Conversations the AI agent is handling appear here.',
  'inbox.list.empty.aiSolved': 'Conversations the AI resolved on its own appear here.',
  'inbox.list.empty.channel': 'No conversations have arrived on this channel yet.',
  'inbox.list.empty.description': 'New conversations land here as they arrive.',
  'inbox.list.item.visitorFallback': 'Visitor',
  'inbox.list.item.queuePosition': '#{position} in queue',
  'inbox.list.item.unreadAria': '{count} unread',
  'inbox.list.item.noMessages': 'No messages yet',
  'inbox.list.loadMore': 'Load more',
  'inbox.list.loading': 'Loading…',
  'inbox.list.sort.ariaLabel': 'Sort conversations',
  'inbox.list.sort.newest': 'Newest',
  'inbox.list.sort.oldest': 'Oldest',

  // Transcript header + empty state (InboxPage's own chrome around Transcript.tsx)
  'inbox.thread.visitorFallback': 'Visitor',
  'inbox.thread.statusActive': 'Active',
  'inbox.thread.statusArchived': 'Archived',
  'inbox.thread.copyLink': 'Copy link',
  'inbox.thread.copied': 'Copied',
  'inbox.thread.showDetails': 'Show details panel',
  'inbox.thread.detailsLabel': 'Details',
  'inbox.thread.copilotLabel': 'Copilot',
  'inbox.thread.empty.title': 'No conversation selected',
  'inbox.thread.empty.description': 'Pick a conversation from the list to see it here.',

  // Composer
  'inbox.composer.disabledNotice': 'This conversation is archived. Reopen it to reply.',
  'inbox.composer.modeAriaLabel': 'Message type',
  'inbox.composer.mode.reply': 'Reply',
  'inbox.composer.mode.note': 'Internal note',
  'inbox.composer.noteHint': 'Only your team will see this.',
  'inbox.composer.replyLabel': 'Reply to the customer',
  'inbox.composer.attachment.remove': 'Remove attachment',
  'inbox.composer.suggestions.ariaLabel': 'Reply suggestions',
  'inbox.composer.suggestions.dismiss': 'Dismiss reply suggestions',
  'inbox.composer.suggestions.copilotPending': 'Copilot is drafting…',
  'inbox.composer.suggestions.fromCopilot': 'Drafted from your Copilot knowledge base',
  // One per `ReplySuggestionId` — the chips Space offers. Editable drafts, so
  // they are written to be sent as they stand and improved in a keystroke.
  'inbox.composer.suggestions.chip.opener':
    'Hi there! Thanks for reaching out — how can I help you today?',
  'inbox.composer.suggestions.chip.greeting': 'Hi there! How can I help you today?',
  'inbox.composer.suggestions.chip.thanks':
    'You’re very welcome! Is there anything else I can help you with?',
  'inbox.composer.suggestions.chip.order':
    'Happy to help with that — let me pull up the details and take a look.',
  'inbox.composer.suggestions.chip.question':
    'Great question — let me look into that and get right back to you.',
  'inbox.composer.suggestions.chip.questionWait':
    'Thanks for asking! One moment while I find the answer for you.',
  'inbox.composer.suggestions.chip.details':
    'Thanks for the details — let me take a look and get back to you.',
  'inbox.composer.suggestions.chip.holdingBear':
    'I’m still on it — please bear with me for a moment.',
  'inbox.composer.suggestions.chip.holdingMoment': 'Give me a moment, I’ll check that for you.',
  'inbox.composer.picker.ariaLabel': 'Saved replies',
  'inbox.composer.placeholder.note': 'Add a note for your team…',
  'inbox.composer.placeholder.reply': 'Type your reply, or press Space for suggestions…',
  'inbox.composer.attachFile': 'Attach a file',
  'inbox.composer.richText.bold': 'Bold',
  'inbox.composer.richText.italic': 'Italic',
  'inbox.composer.richText.list': 'Bulleted list',
  'inbox.composer.emoji.trigger': 'Insert emoji',
  'inbox.composer.emoji.category.smileys': 'Smileys',
  'inbox.composer.emoji.category.gestures': 'Gestures',
  'inbox.composer.emoji.category.symbols': 'Symbols',
  'inbox.composer.tags.trigger': 'Chat tags',
  'inbox.composer.tags.empty': 'No tags to suggest yet.',
  'inbox.composer.tags.newTagLabel': 'Add a new tag',
  'inbox.composer.tags.newTagPlaceholder': 'Type a tag and press Enter…',
  'inbox.composer.uploading': 'Uploading…',
  'inbox.composer.hint': 'Enter to send · Shift+Enter for a new line',
  'inbox.composer.attachError': 'Could not attach that file.',
  'inbox.composer.send.pending': 'Sending…',
  'inbox.composer.send.cta': 'Send',

  // Transcript bubbles
  'inbox.transcript.ariaLabel': 'Conversation transcript',
  'inbox.transcript.noteLabel': 'Internal note — not sent to the customer',
  'inbox.transcript.loadingOlder': 'Loading earlier messages…',
  'inbox.transcript.sending': 'Sending…',
  'inbox.transcript.notSent': 'Not sent',
  'inbox.transcript.retry': 'Retry',
  'inbox.transcript.aiSuffix': 'AI',
  'inbox.transcript.edit': 'Edit',
  'inbox.transcript.editAriaLabel': 'Edit this message',
  'inbox.transcript.editFieldLabel': 'Corrected message',
  'inbox.transcript.editSave': 'Save',
  'inbox.transcript.editCancel': 'Cancel',
  'inbox.transcript.editSaving': 'Saving…',
  'inbox.transcript.edited': 'edited',
  'inbox.transcript.editFailed': 'The correction was not saved.',

  // "Visitor is typing…"
  'inbox.typing.visitorFallback': 'Visitor',
  'inbox.typing.suffix': 'is typing…',

  // Multi-agent conflict banner — `count` is always 2+ (the store never notes a
  // single composer), but both plural forms are still written out per the
  // project's convention (see `shell.trial.remaining`).
  'inbox.conflict.warning.one': '{count} agent is typing in this chat:',
  'inbox.conflict.warning.other': '{count} agents are typing in this chat:',

  // Attachments
  'inbox.attachment.unavailable': 'Attachment unavailable',
  'inbox.attachment.loading': 'Loading attachment',
  'inbox.attachment.loadingText': 'Loading…',

  // Details panel
  'inbox.details.panelLabel': 'Conversation details',
  'inbox.details.title': 'Details',
  'inbox.details.collapseLabel': 'Collapse details panel',
  'inbox.details.section.conversation': 'Conversation',
  'inbox.details.row.status': 'Status',
  'inbox.details.status.active': 'Active',
  'inbox.details.status.archived': 'Archived',
  'inbox.details.row.chatId': 'Chat ID',
  'inbox.details.row.assignee': 'Assignee',
  'inbox.details.assignee.assigned': 'Assigned',
  'inbox.details.assignee.unassigned': 'Unassigned',
  'inbox.details.assign.label': 'Change assignee',
  'inbox.details.assign.empty': 'No teammates to assign to.',
  'inbox.details.assign.unavailable': 'Teammate list unavailable.',
  'inbox.details.assign.offline': 'That teammate is offline.',
  'inbox.details.row.queue': 'Queue',
  'inbox.details.row.started': 'Started',
  'inbox.details.section.tags': 'Tags',
  'inbox.details.tags.empty': 'No tags yet.',
  'inbox.details.tags.remove': 'Remove tag {tag}',
  'inbox.details.tags.addLabel': 'Add a tag',
  'inbox.details.tags.addPlaceholder': 'Add a tag…',
  'inbox.details.tags.addButton': 'Add',
  'inbox.details.section.teams': 'Teams',
  'inbox.details.teams.empty': 'Not routed to a team.',
  'inbox.details.section.apps': 'Apps',
  'inbox.details.apps.empty': 'No connected apps.',
  'inbox.details.section.visitedPages': 'Visited pages',
  'inbox.details.visitedPages.empty': 'No pages recorded for this visitor.',
  'inbox.details.section.visitInfo': 'Visit info',
  'inbox.details.visitInfo.empty': 'No visit information yet.',
  'inbox.details.row.device': 'Device',
  'inbox.details.row.referring': 'Referring',
  'inbox.details.visitInfo.direct': 'Direct',
  'inbox.details.row.duration': 'Duration',
  'inbox.details.row.ip': 'IP',
  'inbox.details.archive.cta': 'Archive conversation',
  'inbox.details.archive.pending': 'Archiving…',
  'inbox.details.reopen.cta': 'Reopen conversation',
  'inbox.details.reopen.pending': 'Reopening…',
  'inbox.details.takeover.cta': 'Take over',
  'inbox.details.takeover.title': 'Take over this chat?',
  'inbox.details.takeover.bodyAssigned': 'This reassigns the chat to you, taking it from {name}.',
  'inbox.details.takeover.bodyUnassigned':
    'This chat is unassigned — it will be reassigned to you.',
  'inbox.details.takeover.fallbackName': 'the current agent',
  'inbox.details.takeover.errorGeneric': 'Could not take over this chat.',
  'inbox.details.takeover.cancel': 'Cancel',
  'inbox.details.takeover.pending': 'Taking over…',

  // Copilot panel
  'inbox.copilot.panelLabel': 'Copilot',
  'inbox.copilot.title': 'Copilot',
  'inbox.copilot.collapseLabel': 'Collapse Copilot panel',
  'inbox.copilot.detailsButton': 'Details',
  'inbox.copilot.disabledNotice': 'Reopen the conversation to draft or send a reply.',
  'inbox.copilot.section.summary': 'Summary',
  'inbox.copilot.summary.description':
    'Summarise this conversation and post it as an internal note for your team.',
  'inbox.copilot.summary.cta': 'Summarise conversation',
  'inbox.copilot.summary.pending': 'Summarising…',
  'inbox.copilot.summary.error': 'Could not summarise — try again.',
  'inbox.copilot.summary.noteAdded': 'Added as an internal note.',
  'inbox.copilot.summary.notSaved': 'Not saved as a note — the archive is read-only.',
  'inbox.copilot.section.reply': 'Suggested reply',
  'inbox.copilot.reply.description': 'Draft a reply from the copilot knowledge base.',
  'inbox.copilot.reply.cta': 'Draft a reply',
  'inbox.copilot.reply.pending': 'Drafting…',
  'inbox.copilot.reply.error': 'Could not draft a reply — try again.',
  'inbox.copilot.insert': 'Insert into reply',
  'inbox.copilot.reply.sources': 'From: {names}',
  'inbox.copilot.reply.empty': 'No suggestion found in the copilot knowledge base.',
  'inbox.copilot.section.enhance': 'Improve a draft',
  'inbox.copilot.enhance.label': 'Draft to improve',
  'inbox.copilot.enhance.placeholder': 'Paste or write a draft, then pick a tone…',
  'inbox.copilot.enhance.mode.rephrase': 'Rephrase',
  'inbox.copilot.enhance.mode.friendly': 'Friendlier',
  'inbox.copilot.enhance.mode.formal': 'More formal',
  'inbox.copilot.enhance.mode.grammar': 'Fix grammar',
  'inbox.copilot.enhance.error': 'Could not rewrite that — try again.',
  'inbox.copilot.section.bi': 'Ask about your reports',
  'inbox.copilot.bi.description':
    'Ask a report question about this workspace, e.g. how many chats closed this week.',
  'inbox.copilot.bi.placeholder': 'How many chats closed this week?',
  'inbox.copilot.bi.cta': 'Ask',
  'inbox.copilot.bi.pending': 'Asking…',
  'inbox.copilot.bi.notUnderstood.title': 'Not sure what you mean',
  'inbox.copilot.bi.noData.title': 'No data for this window',
  'inbox.copilot.bi.error': 'Could not get an answer — try again.',
  'inbox.copilot.bi.source': 'Source: Reports → Overview',

  // "Create ticket" on an open conversation
  'inbox.createTicket.subjectTemplate': 'Follow-up for {customer}',
  'inbox.createTicket.visitorFallback': 'visitor',
  'inbox.createTicket.cta': 'Create ticket',
  'inbox.createTicket.subjectLabel': 'Ticket subject',
  'inbox.createTicket.create': 'Create',
  'inbox.createTicket.cancel': 'Cancel',
  'inbox.createTicket.alreadyExists': 'Already has one.',
  'inbox.createTicket.openExisting': 'Open it',
  'inbox.createTicket.error': 'Could not create that ticket.',

  // Ticket pane (list + detail record + HelpDesk sections)
  'inbox.ticket.visitorFallback': 'Visitor',
  'inbox.ticket.list.ariaLabel': 'Tickets',
  'inbox.ticket.list.empty.title': 'No tickets here',
  'inbox.ticket.list.empty.description':
    'Follow-up work created from a conversation shows up in this list.',
  'inbox.ticket.merged.banner':
    'Merged into {id}. It is folded under that ticket and hidden from lists until you unmerge it.',
  'inbox.ticket.unmerge': 'Unmerge',
  'inbox.ticket.section.customFields': 'Custom fields',
  'inbox.ticket.followers.heading': 'Followers',
  'inbox.ticket.followers.empty': 'No one is following this ticket yet.',
  'inbox.ticket.followers.removeLabel': 'Remove',
  'inbox.ticket.followers.remove': 'Remove {name}',
  'inbox.ticket.followers.addSrLabel': 'Add a follower',
  'inbox.ticket.followers.allFollowing': 'Everyone is already following',
  'inbox.ticket.followers.addPlaceholder': 'Add a follower…',
  'inbox.ticket.followers.addButton': 'Add',
  'inbox.ticket.followers.error': 'Could not update followers.',
  'inbox.ticket.merge.heading': 'Merge',
  'inbox.ticket.merge.foldedCount.one': '{count} ticket folded into this one.',
  'inbox.ticket.merge.foldedCount.other': '{count} tickets folded into this one.',
  'inbox.ticket.merge.noTargets': 'No other ticket to merge into.',
  'inbox.ticket.merge.selectLabel': 'Merge into another ticket',
  'inbox.ticket.merge.selectPlaceholder': 'Merge into…',
  'inbox.ticket.merge.cta': 'Merge',
  'inbox.ticket.backToTickets': 'Tickets',
  'inbox.ticket.detail.empty.title': 'No ticket selected',
  'inbox.ticket.detail.empty.description': 'Pick a ticket from the grid to see it here.',
  'inbox.ticket.row.customer': 'Customer',
  'inbox.ticket.row.assignee': 'Assignee',
  'inbox.ticket.assigneeUnassigned': 'Unassigned',
  'inbox.ticket.row.created': 'Created',
  'inbox.ticket.row.fromChat': 'From chat',
  'inbox.ticket.createdDirectly': 'Created directly',
  'inbox.ticket.subjectLabel': 'Subject',
  'inbox.ticket.saveButton': 'Save',
  'inbox.ticket.statusLabel': 'Status',
  'inbox.ticket.priorityLabel': 'Priority',
  'inbox.ticket.notice.label': 'Notify the customer',
  'inbox.ticket.notice.none': 'Do not send an e-mail',
  'inbox.ticket.notice.hint': 'Pick a template to e-mail the customer when you change the status.',
  'inbox.ticket.notice.hintSelected': 'The next status change e-mails {email}.',
  'inbox.ticket.updateError': 'Could not save that change.',

  // Tickets grid
  'inbox.ticketGrid.caption': 'Tickets',
  'inbox.ticketGrid.column.subject': 'Subject',
  'inbox.ticketGrid.column.customer': 'Customer',
  'inbox.ticketGrid.column.status': 'Status',
  'inbox.ticketGrid.column.priority': 'Priority',
  'inbox.ticketGrid.column.assignee': 'Assignee',
  'inbox.ticketGrid.column.lastMessage': 'Last message',
  'inbox.ticketGrid.empty.title': 'No tickets here',
  'inbox.ticketGrid.empty.description':
    'Follow-up work created from a conversation shows up in this grid.',
  'inbox.ticketGrid.error.title': 'Ticket views unavailable',
  'inbox.ticketGrid.visitorFallback': 'Visitor',
  'inbox.ticketGrid.assigneeUnassigned': 'Unassigned',
  'inbox.ticketGrid.selectAll': 'Select every loaded ticket (up to {max})',
  'inbox.ticketGrid.selectRow': 'Select ticket: {subject}',

  // Bulk actions over the grid's selection (FR-13-EK.3 · FR-MOD-02.7.1). The
  // result line prints both numbers because the endpoint answers 200 for a
  // partial outcome too — "done" over a selection that half failed is the one
  // sentence this bar must never say.
  'inbox.ticketBulk.ariaLabel': 'Bulk actions',
  'inbox.ticketBulk.selected.one': '{count} ticket selected',
  'inbox.ticketBulk.selected.other': '{count} tickets selected',
  'inbox.ticketBulk.actionLabel': 'Action',
  'inbox.ticketBulk.choose': 'Choose an action…',
  'inbox.ticketBulk.apply': 'Apply',
  'inbox.ticketBulk.clear': 'Clear',
  'inbox.ticketBulk.ceiling': 'One action covers at most {max} tickets.',
  'inbox.ticketBulk.group.status': 'Set status',
  'inbox.ticketBulk.group.priority': 'Set priority',
  'inbox.ticketBulk.group.assignee': 'Assign',
  'inbox.ticketBulk.unassign': 'Nobody',
  'inbox.ticketBulk.assignTo': '{name}',
  'inbox.ticketBulk.result': '{updated} updated, {failed} skipped',
  // No plural forms: the reason is about the count, not about a counted noun,
  // so both languages read the same at one and at many.
  'inbox.ticketBulk.reason.notFound': '{count} no longer in this view',
  'inbox.ticketBulk.reason.merged': '{count} merged into another ticket',

  // Ticket status + priority — shared display words for the two raw enums
  // (TicketPane.tsx and TicketGrid.tsx both render them).
  'inbox.ticketStatus.open': 'Open',
  'inbox.ticketStatus.pending': 'Pending',
  'inbox.ticketStatus.solved': 'Solved',
  'inbox.ticketStatus.closed': 'Closed',
  'inbox.ticketStatus.spam': 'Spam',
  'inbox.priority.urgent': 'Urgent',
  'inbox.priority.high': 'High',
  'inbox.priority.normal': 'Normal',
  'inbox.priority.low': 'Low',
};
