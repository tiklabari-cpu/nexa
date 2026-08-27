import type { Messages } from '../merge.js';

/**
 * Customers, traffic, campaigns and goals (I18N-d, tm 133.4).
 *
 * One file for four screens — Contacts (`CustomersPage`), the live Real-time
 * board (`TrafficPage`), Campaigns and Goals — plus the `custom-fields`
 * control they share, because the task that translates them is one task (see
 * `locales/merge.ts`'s `NAMESPACE_PREFIXES` exception for `customers`). Each
 * area keeps its own key prefix (`customers.*`, `traffic.*`, `campaigns.*`,
 * `goals.*`, `customFields.*`) so the split reads like four small catalogues,
 * not one that happens to share a file.
 */
export const customers: Messages = {
  // Shared chrome — CustomersTabs.tsx, and the page title all four screens set
  'customers.tabs.ariaLabel': 'Customer views',
  'customers.tabs.contacts': 'Contacts',
  'customers.tabs.realTime': 'Real-time',
  'customers.tabs.campaigns': 'Campaigns',
  'customers.tabs.goals': 'Goals',
  'customers.page.title': 'Customers',

  // Contacts — CustomersPage.tsx
  'customers.page.subtitle': 'People who have contacted this workspace.',
  'customers.page.count.one': '{formatted} person',
  'customers.page.count.other': '{formatted} people',
  'customers.page.shown': '{shown} / {total} shown',
  'customers.page.searchLabel': 'Search customers',
  'customers.page.searchPlaceholder': 'Name, email or phone…',
  'customers.page.segmentsAriaLabel': 'Customer segments',
  'customers.page.segment.all': 'All',
  'customers.page.segment.leads': 'Leads',
  'customers.page.segment.recent': 'Last 30 days',
  'customers.page.segment.banned': 'Banned',
  'customers.page.loadError':
    'Could not load customers. Check that the API is reachable and try again.',
  'customers.page.empty.searchTitle': 'Nobody matches that search',
  'customers.page.empty.searchDescription': 'Try a shorter search, or a different segment.',
  'customers.page.empty.title': 'No customers yet',
  'customers.page.empty.description':
    'People who message from the widget appear here automatically.',
  'customers.page.table.caption': 'Customers',
  'customers.page.table.name': 'Name',
  'customers.page.table.country': 'Country',
  'customers.page.table.chats': 'Chats',
  'customers.page.table.lastActive': 'Last active',
  'customers.page.unnamedVisitor': 'Unnamed visitor',
  'customers.page.lead': 'lead',
  'customers.page.banned': 'Banned',
  'customers.page.noContactDetails': 'No contact details',
  'customers.page.never': 'Never',

  // Customer detail panel — CustomerDetailPanel.tsx
  'customers.detail.emptySelection': 'Select someone to see their history.',
  'customers.detail.loadError': 'Could not load this customer.',
  'customers.detail.unnamedVisitor': 'Unnamed visitor',
  'customers.detail.firstSeen': 'First seen {date}',
  'customers.detail.bannedAt': 'Banned {date}',
  'customers.detail.conversations': 'Conversations',
  'customers.detail.tickets': 'Tickets',
  'customers.detail.visits': 'Visits',
  'customers.detail.returningVisitor': 'Returning visitor',
  'customers.detail.country': 'Country',
  'customers.detail.lastActive': 'Last active',
  'customers.detail.never': 'Never',
  'customers.detail.liftBan': 'Lift ban',
  'customers.detail.banCustomer': 'Ban customer',
  'customers.detail.bannedHint': 'They will be able to start conversations again.',
  'customers.detail.notBannedHint': 'Blocks new conversations. History is kept.',
  'customers.detail.customFieldsHeading': 'Custom fields',
  'customers.detail.visitedPages': 'Visited pages',
  'customers.detail.noVisits':
    'No visits recorded. Pages are captured when someone messages from the widget.',
  'customers.detail.cameFrom': 'Came from {source}',
  'customers.detail.unknownPage': 'Unknown page',
  'customers.detail.noConversations': 'No conversations yet.',
  'customers.detail.chatOpen': 'Open',
  'customers.detail.chatClosed': 'Closed',
  'customers.detail.groups': 'Groups',
  'customers.detail.noGroups':
    'Not routed to a team yet. Groups appear here once one of their conversations is assigned.',
  'customers.detail.field.name': 'Name',
  'customers.detail.field.email': 'Email',
  'customers.detail.field.phone': 'Phone',
  'customers.detail.saving': 'Saving…',
  'customers.detail.saveChanges': 'Save changes',

  // Shared custom-fields control — CustomFields.tsx (also used by Inbox and Settings)
  'customFields.booleanYes': 'Yes',
  'customFields.booleanNo': 'No',
  'customFields.saving': 'Saving…',
  'customFields.save': 'Save fields',

  // Real-time board — TrafficPage.tsx
  'traffic.page.subtitle': 'People on your site right now.',
  'traffic.page.count.one': '{formatted} visitor on your site now',
  'traffic.page.count.other': '{formatted} visitors on your site now',
  'traffic.page.loadError':
    'Could not load live traffic. Check that the API is reachable and try again.',
  'traffic.page.statusTablistAriaLabel': 'Traffic status',
  'traffic.page.table.caption': 'Live visitors',
  'traffic.page.table.visitor': 'Visitor',
  'traffic.page.table.activity': 'Activity',
  'traffic.page.table.chattingWith': 'Chatting with',
  'traffic.page.table.actions': 'Actions',
  'traffic.page.unnamedVisitor': 'Unnamed visitor',
  'traffic.page.noContactDetails': 'No contact details',
  'traffic.page.respondentAi': 'AI',
  'traffic.page.respondentAgent': 'Agent',

  'traffic.tab.all': 'All',
  'traffic.tab.chatting': 'Chatting',
  'traffic.tab.supervised': 'Supervised',
  'traffic.tab.queued': 'Queued',
  'traffic.tab.waiting': 'Waiting for reply',
  'traffic.tab.invited': 'Invited',
  'traffic.tab.browsing': 'Browsing',

  'traffic.activity.browsing': 'Browsing',
  'traffic.activity.queued': 'Queued',
  'traffic.activity.waiting': 'Waiting for reply',
  'traffic.activity.chatting': 'Chatting',
  'traffic.activity.supervised': 'Supervised',
  'traffic.activity.invited': 'Invited',

  'traffic.empty.all.title': 'No live visitors right now',
  'traffic.empty.all.description':
    'People browsing your site or in a live conversation appear here. Install the widget to start seeing traffic.',
  'traffic.empty.chatting.title': 'No one is chatting right now',
  'traffic.empty.chatting.description':
    'Visitors currently answered by an agent or the AI appear here.',
  'traffic.empty.supervised.title': 'No supervised conversations',
  'traffic.empty.supervised.description':
    'Conversations an agent is watching without answering yet appear here.',
  'traffic.empty.queued.title': 'The queue is empty',
  'traffic.empty.queued.description':
    'Visitors waiting for an agent to pick up their conversation appear here.',
  'traffic.empty.waiting.title': 'Nobody is waiting for a reply',
  'traffic.empty.waiting.description':
    "Conversations where the visitor's last message has not been answered yet appear here.",
  'traffic.empty.invited.title': 'No pending invitations',
  'traffic.empty.invited.description':
    'Visitors proactively invited to chat who have not replied yet appear here.',
  'traffic.empty.browsing.title': 'No one is just browsing',
  'traffic.empty.browsing.description':
    'Visitors on your site with no conversation yet appear here.',

  'traffic.action.startChat': 'Start chat',
  'traffic.action.superviseChat': 'Supervise chat',
  'traffic.action.assignToMe': 'Assign chat to me',
  'traffic.action.editContact': 'Edit contact',

  // Traffic filter panel — TrafficFilters.tsx (field labels/options/errors stay
  // in traffic-filters.ts, English-only — see the file's own note)
  'traffic.filters.heading': 'Match all filters',
  'traffic.filters.clear': 'Clear',
  'traffic.filters.addFilter': 'Add filter',
  'traffic.filters.addFilterTrigger': '+ Add filter',
  'traffic.filters.allApplied': 'Every filter is already applied.',
  'traffic.filters.empty': 'No filters applied — every visitor is shown.',
  'traffic.filters.removeField': 'Remove {label} filter',

  // Campaigns — CampaignsPage.tsx
  'campaigns.page.description': 'Reach visitors with proactive, targeted messages.',
  'campaigns.page.statusAriaLabel': 'Campaign status',
  'campaigns.page.new': 'New campaign',
  'campaigns.page.loadError':
    'Could not load campaigns. Check that the API is reachable and try again.',
  'campaigns.page.empty.allTitle': 'No campaigns yet',
  'campaigns.page.empty.filteredTitle': 'No {status} campaigns',
  'campaigns.page.empty.writeDescription':
    'Create a campaign to greet visitors on a matching page with a targeted message.',
  'campaigns.page.empty.readDescription':
    'Campaigns greet visitors on a matching page with a targeted message.',
  'campaigns.page.notice.reached.one': '“{name}” reached {formatted} on-site visitor.',
  'campaigns.page.notice.reached.other': '“{name}” reached {formatted} on-site visitors.',
  'campaigns.page.whenUrlContains': 'When URL contains',
  'campaigns.page.fromDate': 'From {date}',
  'campaigns.page.fromNow': 'From now',
  'campaigns.page.untilDate': ' until {date}',
  'campaigns.page.edit': 'Edit',
  'campaigns.page.turnOff': 'Turn off',
  'campaigns.page.turnOn': 'Turn on',
  'campaigns.page.stat.displayed': 'Displayed',
  'campaigns.page.stat.chats': 'Chats',
  'campaigns.page.stat.conversion': 'Conversion',

  'campaigns.status.ongoing': 'Ongoing',
  'campaigns.status.scheduled': 'Scheduled',
  'campaigns.status.inactive': 'Inactive',
  'campaigns.tab.all': 'All',
  'campaigns.tab.ongoing': 'Ongoing',
  'campaigns.tab.scheduled': 'Scheduled',
  'campaigns.tab.inactive': 'Inactive',

  // Campaign builder — CampaignBuilder.tsx
  'campaigns.builder.editTitle': 'Edit campaign',
  'campaigns.builder.newTitle': 'New campaign',
  'campaigns.builder.description':
    'Reach the visitors on a matching page with a proactive message.',
  'campaigns.builder.nameLabel': 'Name',
  'campaigns.builder.nameRequired': 'Give the campaign a name.',
  'campaigns.builder.triggerLabel': 'Trigger — page URL contains',
  'campaigns.builder.triggerHint':
    'e.g. /pricing — the message fires for visitors on a matching page.',
  'campaigns.builder.triggerRequired': 'A campaign needs a trigger to know who to reach.',
  'campaigns.builder.messageLabel': 'Message',
  'campaigns.builder.messagePlaceholder': 'Hi there — can I help you find the right plan?',
  'campaigns.builder.messageRequired': 'A campaign needs a message to send.',
  'campaigns.builder.startsLabel': 'Starts (optional)',
  'campaigns.builder.endsLabel': 'Ends (optional)',
  'campaigns.builder.endsError': 'The end must be after the start.',
  'campaigns.builder.discardConfirm': 'Discard this campaign?',
  'campaigns.builder.cancel': 'Cancel',
  'campaigns.builder.saving': 'Saving…',
  'campaigns.builder.saveChanges': 'Save changes',
  'campaigns.builder.create': 'Create campaign',

  // Goals — GoalsPage.tsx
  'goals.page.description': 'Define the pages a visitor reaching them counts as a conversion.',
  'goals.page.statusAriaLabel': 'Goal status',
  'goals.page.new': 'New goal',
  'goals.page.loadError': 'Could not load goals. Check that the API is reachable and try again.',
  'goals.page.empty.allTitle': 'No goals yet',
  'goals.page.empty.filteredTitle': 'No {status} goals',
  'goals.page.empty.writeDescription':
    'Create a goal to track when a visitor reaches a page that counts as a conversion.',
  'goals.page.empty.readDescription':
    'Goals track when a visitor reaches a page that counts as a conversion.',
  'goals.page.whenUrlContains': 'When URL contains',
  'goals.page.created': 'Created {date}',
  'goals.page.turnOff': 'Turn off',
  'goals.page.turnOn': 'Turn on',
  'goals.page.active': 'Active',
  'goals.page.inactive': 'Inactive',

  'goals.tab.all': 'All',
  'goals.tab.active': 'Active',
  'goals.tab.inactive': 'Inactive',

  // Goal builder — GoalBuilder.tsx
  'goals.builder.title': 'New goal',
  'goals.builder.description': 'Define a page a visitor reaching it counts as a conversion.',
  'goals.builder.nameLabel': 'Name',
  'goals.builder.nameRequired': 'Give the goal a name.',
  'goals.builder.triggerLabel': 'Trigger — page URL contains',
  'goals.builder.triggerHint':
    'e.g. /thank-you — a visitor reaching a matching page has converted.',
  'goals.builder.triggerRequired': 'A goal needs a trigger to know what counts as a conversion.',
  'goals.builder.discardConfirm': 'Discard this goal?',
  'goals.builder.cancel': 'Cancel',
  'goals.builder.saving': 'Saving…',
  'goals.builder.create': 'Create goal',

  // Goal funnel — GoalsFunnel.tsx
  'goals.funnel.title': 'Goal funnel',
  'goals.funnel.description': 'Visitors who reached a chat, and of those, a tracked goal.',
  'goals.funnel.loadError':
    'Could not load the goal funnel. Check that the API is reachable and try again.',
  'goals.funnel.emptyTitle': 'No conversions yet',
  'goals.funnel.emptyDescription': 'Define a goal to see visitors, chats and conversions here.',
  'goals.funnel.visitors': 'Visitors',
  'goals.funnel.chats': 'Chats',
  'goals.funnel.conversions': 'Conversions',
};
