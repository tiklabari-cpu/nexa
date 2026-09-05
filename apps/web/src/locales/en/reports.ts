import type { Messages } from '../merge.js';

/**
 * Reports: every tab, KPI card, export and saved views (I18N-f, tm 133.6).
 *
 * Shared words that mean the same thing everywhere they appear — "Volume",
 * "By day", "Manual"/"Assisted"/"Automated", "Unknown agent" — carry one key
 * under `reports.common.*` rather than one copy per tab; everything else is
 * scoped to the tab it renders in, even where two tabs happen to use the same
 * English word for a different figure (Overview's combined "Total cases" is
 * not the Cases tab's ticket-only report, so the two stay separate keys).
 *
 * Ticket `status`/`priority` values in the Cases tab render the server's raw
 * enum, not a catalogue lookup — the DOM text is asserted lowercase
 * (`ReportsPage.test.tsx`'s "By status" table) the same way channel names and
 * agent names are, so it is data, not chrome.
 */
export const reports: Messages = {
  // Page chrome
  'reports.page.title': 'Reports',
  'reports.page.description': 'Conversation volume, responsiveness and satisfaction.',
  'reports.page.tabsAriaLabel': 'Report',

  // Tabs
  'reports.tabs.overview': 'Overview',
  'reports.tabs.aiAgent': 'AI Agent',
  'reports.tabs.reviews': 'Reviews',
  'reports.tabs.breakdown': 'Breakdown',
  'reports.tabs.staffing': 'Staffing',
  'reports.tabs.topics': 'Chat topics',
  'reports.tabs.cases': 'Cases',
  'reports.tabs.leads': 'Leads',
  'reports.tabs.sales': 'Sales',
  'reports.tabs.teamPerformance': 'Team performance',

  // Custom range not yet chosen, or invalid
  'reports.emptyRange.title': 'Pick a date range',
  'reports.emptyRange.description':
    'Choose a start and end date. The end date cannot be before the start.',

  // Overview-only "Chat topics" promo banner (FR-MOD-07.6-f)
  'reports.topicsPromo.text': 'Top chat topics in one place',
  'reports.topicsPromo.cta': 'See chat topics',
  'reports.topicsPromo.dismiss': 'Remind me later',

  // Onboarding survey popover — "What are you tracking?" (FR-MOD-07.2)
  'reports.survey.title': 'What are you tracking?',
  'reports.survey.description': "Pick what matters most to you — it's quick, and you can skip it.",
  'reports.survey.option.agent_performance': 'Tracking agent performance',
  'reports.survey.option.team_sharing': 'Sharing results with my team or manager',
  'reports.survey.option.spotting_problems': 'Spotting problems',
  'reports.survey.option.revenue_impact': 'Measuring revenue impact',
  'reports.survey.option.other': 'Other',
  'reports.survey.skip': 'Skip',

  // Header range control
  'reports.range.groupAriaLabel': 'Range',
  'reports.range.presetDays': '{days} days',
  'reports.range.custom': 'Custom',
  'reports.range.startDate': 'Start date',
  'reports.range.endDate': 'End date',

  // Saved views
  'reports.savedViews.ariaLabel': 'Saved views',
  'reports.savedViews.trigger': 'Views',
  'reports.savedViews.remove': 'Remove saved view {name}',
  'reports.savedViews.saveLabel': 'Save this view',
  'reports.savedViews.namePlaceholder': 'Name this view',
  'reports.savedViews.nameError': 'Enter a name for this view.',
  'reports.savedViews.submit': 'Save',
  'reports.savedViews.submitPending': 'Saving…',

  // CSV/PDF export
  'reports.export.formatLabel': 'Export format',
  'reports.export.csv': 'CSV',
  'reports.export.pdf': 'PDF',
  'reports.export.cta': 'Export',
  'reports.export.pending': 'Exporting…',

  // Shared across two or more tabs — same word, same meaning every time
  'reports.common.volume': 'Volume',
  'reports.common.byDay': 'By day',
  'reports.common.byAgent': 'By agent',
  'reports.common.dayColumn': 'Day',
  'reports.common.agentColumn': 'Agent',
  'reports.common.shareColumn': 'Share',
  'reports.common.csatColumn': 'CSAT',
  'reports.common.ticketsColumn': 'Tickets',
  'reports.common.closed': 'Closed',
  'reports.common.unknownAgent': 'Unknown agent',
  'reports.common.noRatingsYet': 'No ratings yet',
  'reports.common.noAssignedConversations': 'No assigned conversations',
  'reports.common.hint.averageOpenToClose': 'Average, open to close',
  'reports.common.ratingCount.one': '{count} rating',
  'reports.common.ratingCount.other': '{count} ratings',
  'reports.common.closedShare.none': 'Nothing closed in this window',
  'reports.common.closedShare.value': '{rate} of closed',
  'reports.common.delta.noChange': 'No change vs previous',
  'reports.common.delta.suffix': '{value} vs previous',
  'reports.common.delta.tooltip': 'Compared with the previous period',
  'reports.common.kpi.trackedSales': 'Tracked sales',
  'reports.common.kpi.attributedRevenue': 'Attributed revenue',
  'reports.common.kpi.automatedChatDuration': 'Automated chat duration',
  'reports.common.salesNotConfigured': 'Sales tracking not set up',
  'reports.common.resolution.chats': 'Chats',
  'reports.common.resolution.manual': 'Manual',
  'reports.common.resolution.assisted': 'Assisted',
  'reports.common.resolution.automated': 'Automated',

  // Overview (FR-MOD-07.1/07.3)
  'reports.overview.error':
    'Could not load reports. Check that the API is reachable and try again.',
  'reports.overview.volume.description': 'Conversations and tickets in the selected window.',
  'reports.overview.kpi.conversations': 'Conversations',
  'reports.overview.kpi.totalCases': 'Total cases',
  'reports.overview.kpi.totalCasesHint': '{chats} chats + {tickets} tickets',
  'reports.overview.kpi.totalCasesLowConfidence.one':
    'Only {count} case in this range — not enough to read much into this',
  'reports.overview.kpi.totalCasesLowConfidence.other':
    'Only {count} cases in this range — not enough to read much into this',
  'reports.overview.kpi.queuedNow': 'In queue now',
  'reports.overview.queue.waiting': 'Waiting for an agent',
  'reports.overview.queue.empty': 'Nobody waiting',
  'reports.overview.kpi.achievedGoals': 'Achieved goals',
  'reports.overview.resolution.title': 'Resolution',
  'reports.overview.resolution.description':
    'How closed conversations were handled (PRD §7.3.2). Manual, assisted and automated add up to every closed case.',
  'reports.overview.resolution.lowConfidence.one':
    'Only {count} closed case in this range — shares may not be reliable',
  'reports.overview.resolution.lowConfidence.other':
    'Only {count} closed cases in this range — shares may not be reliable',
  'reports.overview.chats.title': 'Chats',
  'reports.overview.chats.description':
    'How fast the AI clears conversations and how long they run (PRD §7.3.3).',
  'reports.overview.kpi.automatedPerHour': 'Automated chats / hour',
  'reports.overview.kpi.automatedPerHourHint': 'AI resolutions per hour across the window',
  'reports.overview.kpi.totalDuration': 'Total chat duration',
  'reports.overview.kpi.totalDurationHint': 'Every closed conversation, summed',
  'reports.overview.responsiveness.title': 'Responsiveness',
  'reports.overview.kpi.firstResponse': 'First response',
  'reports.overview.kpi.firstResponseHint': 'Average time to the first agent reply',
  'reports.overview.kpi.conversationLength': 'Conversation length',
  'reports.overview.kpi.conversationLengthHint': 'Average from open to close',
  'reports.overview.kpi.satisfaction': 'Satisfaction',
  'reports.overview.kpi.negativeRatings': 'Negative ratings',
  'reports.overview.kpi.slaBreaches': 'SLA breaches',
  'reports.overview.sla.notConfigured': 'Set targets in Settings → SLA to track this',
  'reports.overview.sla.lowConfidence': 'Not enough cases yet to read much into this',
  'reports.overview.byAgent.description': 'Conversations handled in the selected window.',
  'reports.overview.byAgent.emptyDescription':
    'Once conversations are routed to agents, their volume shows up here.',
  'reports.overview.byAgent.caption': 'Conversations handled per agent',
  'reports.overview.byAgent.shareColumn': 'Share',
  'reports.overview.topTags.title': 'Top tags',
  'reports.overview.topTags.description': 'What conversations were about.',
  'reports.overview.topTags.emptyTitle': 'No tags applied',
  'reports.overview.topTags.emptyDescription':
    'Tag conversations from the details panel to see what drives contact volume.',

  // AI Agent (FR-MOD-07.4, ADR-09)
  'reports.aiAgent.error':
    'Could not load the AI Agent report. Check that the API is reachable and try again.',
  'reports.aiAgent.resolution.title': 'AI resolution',
  'reports.aiAgent.resolution.description':
    'What the AI Agent handled without a human (ADR-09) — the same figure the invoice bills.',
  'reports.aiAgent.kpi.resolutions': 'AI resolutions',
  'reports.aiAgent.kpi.resolutionRate': 'Resolution rate',
  'reports.aiAgent.deflection.title': 'Deflection',
  'reports.aiAgent.deflection.description':
    'How often the AI handed a conversation to a human, and how many skills ran.',
  'reports.aiAgent.kpi.transfers': 'Transfers to a human',
  'reports.aiAgent.kpi.transferRate': 'Transfer rate',
  'reports.aiAgent.transferRate.empty': 'The AI finished nothing in this window',
  'reports.aiAgent.transferRate.hint': 'Share of AI-finished chats handed off',
  'reports.aiAgent.kpi.skillsRun': 'Skills run',

  // Reviews (FR-MOD-07.8)
  'reports.reviews.error':
    'Could not load the Reviews report. Check that the API is reachable and try again.',
  'reports.reviews.csat.title': 'Satisfaction (CSAT)',
  'reports.reviews.csat.description':
    'Rated good as a share of all ratings (PRD §7.8). Null, never 0%, when nobody rated.',
  'reports.reviews.csat.emptyDescription':
    'Once customers rate their conversations, the good / bad split shows up here.',
  'reports.reviews.csat.good': 'Rated good',
  'reports.reviews.csat.bad': 'Rated bad',
  'reports.reviews.csat.noPreviousRatings': 'No ratings in the previous period',
  'reports.reviews.csat.vsPrevious': 'vs {rate} previous period',
  'reports.reviews.csat.donutLabel': 'CSAT {rate}: {good} of {responses} rated good.',
  'reports.reviews.csat.donutUnknown': 'unknown',
  'reports.reviews.byDay.title': 'Ratings by day',
  'reports.reviews.byDay.description':
    'Daily rating volume, good vs bad, over each UTC day in the window.',
  'reports.reviews.byDay.emptyTitle': 'No ratings in this window',
  'reports.reviews.byDay.emptyDescription':
    'Once customers rate conversations, each day’s ratings show up here.',
  'reports.reviews.byDay.caption': 'Ratings per day, split good and bad',
  'reports.reviews.byDay.ratingsColumn': 'Ratings',
  'reports.reviews.byDay.goodColumn': 'Good',
  'reports.reviews.byDay.badColumn': 'Bad',
  'reports.reviews.ecommerce.title': 'Ecommerce',
  'reports.reviews.ecommerce.description':
    'Sales attributed to supported conversations (PRD §7.8, tracked sales §13.5).',
  'reports.reviews.ecommerce.emptyDescription':
    'Connect a sales source to attribute revenue to supported conversations.',
  'reports.reviews.ecommerce.cta': 'Configure sales platforms',

  // Breakdown (FR-MOD-07.5)
  'reports.breakdown.error':
    'Could not load the breakdown. Check that the API is reachable and try again.',
  'reports.breakdown.byDay.description':
    'The resolution split (PRD §7.3.2) resolved over each UTC day in the window.',
  'reports.breakdown.byDay.emptyTitle': 'No conversations yet',
  'reports.breakdown.byDay.emptyDescription':
    'Once conversations happen in this window, their daily split shows up here.',
  'reports.breakdown.byDay.caption': 'Resolution split per day',
  'reports.breakdown.byAgent.description': 'The same split resolved over each assigned agent.',
  'reports.breakdown.byAgent.emptyDescription':
    'Once conversations are routed to agents, their split shows up here.',
  'reports.breakdown.byAgent.caption': 'Resolution split per agent',
  'reports.breakdown.byHour.title': 'By hour',
  'reports.breakdown.byHour.description':
    'The same split resolved over each UTC hour, summed across the window.',
  'reports.breakdown.byHour.emptyTitle': 'No hourly data yet',
  'reports.breakdown.byHour.emptyDescription':
    'Once conversations happen in this window, their hourly split shows up here.',
  'reports.breakdown.byHour.caption': 'Resolution split per hour',
  'reports.breakdown.byHour.column': 'Hour',
  'reports.breakdown.byTeam.title': 'By team',
  'reports.breakdown.byTeam.description':
    'The same split resolved over each team a conversation is visible to.',
  'reports.breakdown.byTeam.descriptionOverlap':
    "The same split resolved over each team a conversation is visible to. A conversation open to more than one team is counted in every one of them, so row totals can exceed the window's total chats.",
  'reports.breakdown.byTeam.emptyTitle': 'No team data yet',
  'reports.breakdown.byTeam.emptyDescription':
    'Once conversations are visible to a team, their split shows up here.',
  'reports.breakdown.byTeam.caption': 'Resolution split per team',
  'reports.breakdown.byTeam.column': 'Team',
  'reports.breakdown.byTeam.unassigned': 'Unassigned',
  'reports.breakdown.byChannel.title': 'By channel',
  'reports.breakdown.byChannel.description':
    'The same split resolved over each channel the conversation started on.',
  'reports.breakdown.byChannel.emptyTitle': 'No channel data yet',
  'reports.breakdown.byChannel.emptyDescription':
    'Once conversations happen in this window, their channel split shows up here.',
  'reports.breakdown.byChannel.caption': 'Resolution split per channel',
  'reports.breakdown.byChannel.column': 'Channel',

  // Staffing (WORKSCHED-i, PRD §5.3)
  'reports.staffing.error':
    'Could not load the staffing forecast. Check that the API is reachable and try again.',
  'reports.staffing.description':
    "Required vs scheduled agents per UTC weekday and hour, from observed volume and the presence log (PRD §5.3). Gaps are the shortfall to close; a cell with too little history shows '—', never a guessed number.",
  'reports.staffing.emptyTitle': 'No staffing data in this window',
  'reports.staffing.emptyDescription':
    'Once conversations happen in this window, the required-vs-scheduled forecast shows up here.',
  'reports.staffing.noPresenceData':
    'No presence data in this window — scheduled coverage and every gap are unknown.',
  'reports.staffing.noRoster':
    'No agent has a saved work schedule yet — rostered coverage is unknown.',
  'reports.staffing.gridCaption': 'Required vs scheduled agents per UTC weekday and hour',
  'reports.staffing.cellUnknown': 'Not enough data',
  'reports.staffing.cellTitle': 'Required {required} · Scheduled {scheduled} · Gap {gap}',

  // Chat topics (FR-MOD-07.6)
  'reports.topics.error':
    'Could not load chat topics. Check that the API is reachable and try again.',
  'reports.topics.description':
    'Conversations in this window, grouped into topics by AI clustering.',
  'reports.topics.emptyTitle': 'Not enough conversations yet',
  'reports.topics.emptyDescription':
    'Chat topics needs at least {min} conversations in this window — {analyzed} so far.',
  'reports.topics.caption': 'Chat topics, most voluminous first',
  'reports.topics.topicColumn': 'Topic',
  'reports.topics.trendColumn': 'Trend',
  'reports.topics.noChange': 'No change',

  // Cases (FR-MOD-07.7, v2 — tickets)
  'reports.cases.error':
    'Could not load the Cases report. Check that the API is reachable and try again.',
  'reports.cases.volume.description': 'Tickets in the selected window, by current status.',
  'reports.cases.kpi.open': 'Open',
  'reports.cases.kpi.total': 'Total',
  'reports.cases.byDay.description': 'Tickets created per UTC day, split open and closed.',
  'reports.cases.byDay.emptyTitle': 'No cases in this window',
  'reports.cases.byDay.emptyDescription':
    'Once a ticket is created in this window, its daily split shows up here.',
  'reports.cases.byDay.caption': 'Tickets per day, split open and closed',
  'reports.cases.byStatus.title': 'By status',
  'reports.cases.byStatus.description': 'Tickets in the window, grouped by their current status.',
  'reports.cases.byStatus.emptyTitle': 'No status data yet',
  'reports.cases.byStatus.emptyDescription':
    'Once a ticket is created in this window, its status breakdown shows up here.',
  'reports.cases.byStatus.caption': 'Tickets by current status',
  'reports.cases.byStatus.column': 'Status',
  'reports.cases.byPriority.title': 'By priority',
  'reports.cases.byPriority.description':
    'Tickets in the window, grouped by their stored queue priority (highest first).',
  'reports.cases.byPriority.emptyTitle': 'No priority data yet',
  'reports.cases.byPriority.emptyDescription':
    'Once a ticket is created in this window, its priority breakdown shows up here.',
  'reports.cases.byPriority.caption': 'Tickets by stored queue priority',
  'reports.cases.byPriority.column': 'Priority',

  // Leads (FR-MOD-07.7, v2)
  'reports.leads.error':
    'Could not load the Leads report. Check that the API is reachable and try again.',
  'reports.leads.volume.description':
    'Customers flagged as leads, counted by the UTC day they first touched this license.',
  'reports.leads.kpi.newLeads': 'New leads',
  'reports.leads.byDay.description': 'New leads per UTC day in the window.',
  'reports.leads.byDay.emptyTitle': 'No new leads in this window',
  'reports.leads.byDay.emptyDescription':
    "Once a customer's first chat or ticket with this license lands, they show up here.",
  'reports.leads.byDay.caption': 'New leads per day',

  // Sales (FR-MOD-07.7, v2; FR-MOD-13.5)
  'reports.sales.error':
    'Could not load the Sales report. Check that the API is reachable and try again.',
  'reports.sales.description': 'Sales attributed to supported conversations.',
  'reports.sales.kpi.conversions': 'Conversions',
  'reports.sales.emptyDescription':
    'Connect a sales source to attribute revenue to supported conversations. The Sales tracker (FR-MOD-13.5) is not available yet.',

  // Team performance (FR-MOD-07.7, v2)
  'reports.teamPerformance.error':
    'Could not load the Team performance report. Check that the API is reachable and try again.',
  'reports.teamPerformance.description':
    'Per-agent chats, resolution split, first-response time and CSAT for the window.',
  'reports.teamPerformance.emptyTitle': 'No agent activity in this window',
  'reports.teamPerformance.emptyDescription':
    'Once conversations are assigned to agents, their per-agent performance shows up here.',
  'reports.teamPerformance.caption': 'Per-agent chats, resolution split, response time and CSAT',
  'reports.teamPerformance.avgFirstResponseColumn': 'Avg first response',
};
