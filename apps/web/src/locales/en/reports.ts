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
  'reports.page.tabsAriaLabel': 'Report categories',

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

  // Sidebar categories (FR-MOD-07.1)
  'reports.categories.performance': 'Performance',
  'reports.categories.automation': 'AI & automation',
  'reports.categories.team': 'Team & staffing',
  'reports.categories.business': 'Business',

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
  'reports.export.sectionTitle': 'Export',
  'reports.export.formatLabel': 'Export format',
  'reports.export.csv': 'CSV',
  'reports.export.pdf': 'PDF',
  'reports.export.cta': 'Export',
  'reports.export.pending': 'Exporting…',

  // Share link (FR-MOD-07.3.1) — the "link" half of "Share export/link"
  'reports.share.trigger': 'Share',
  'reports.share.ariaLabel': 'Share this report',
  'reports.share.loadError.title': "Share links couldn't be loaded",
  'reports.share.description':
    'A link to this report, over the window you have selected. Anyone with the link can read it until it expires.',
  'reports.share.expiresLabel': 'Expires',
  'reports.share.expiresDays': '{count} days',
  'reports.share.create': 'Create link',
  'reports.share.creating': 'Creating…',
  'reports.share.rowGroup': '{group} · …{suffix}',
  'reports.share.rowExpires': 'Expires {when}',
  'reports.share.rowExpired': 'Expired {when}',
  'reports.share.revoke': 'Revoke the link ending {suffix}',
  'reports.share.revokeShort': 'Revoke',
  'reports.share.onceTitle': 'Share link created',
  'reports.share.onceDescription': 'Anyone with this link can read the report until {when}.',
  'reports.share.onceWarning':
    'Copy it now — it is shown once and cannot be retrieved. Revoke it any time from Share.',
  'reports.share.copy': 'Copy',
  'reports.share.copied': 'Copied',
  'reports.share.done': 'Done',

  // The page a share link opens
  'reports.shared.title': 'Shared report',
  'reports.shared.loading': 'Loading the report…',
  'reports.shared.unavailable': 'This link is no longer available.',
  'reports.shared.incomplete': 'This link is incomplete. Ask whoever sent it for a new one.',
  'reports.shared.range': '{range}',
  'reports.shared.caption': '{label}, {range}',
  'reports.shared.generated': 'Generated {when}',
  'reports.shared.expires': 'This link expires {when}',

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
    'How closed conversations were handled. Manual, assisted and automated add up to every closed case.',
  'reports.overview.resolution.lowConfidence.one':
    'Only {count} closed case in this range — shares may not be reliable',
  'reports.overview.resolution.lowConfidence.other':
    'Only {count} closed cases in this range — shares may not be reliable',
  'reports.overview.chats.title': 'Chats',
  'reports.overview.chats.description':
    'How fast the AI clears conversations and how long they run.',
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
  'reports.aiAgent.resolution.title': 'Billed AI resolution',
  'reports.aiAgent.resolution.description':
    'What the AI Agent handled without a human — the same figure the invoice bills.',
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

  // AI Agent › AI quality (AI-25 · tm 320.3). The metric names and their
  // tooltips are `AI_METRIC_DEFINITIONS` in @siyahtus/types, not keys here.
  'reports.aiMetrics.error':
    'Could not load the AI quality figures. Check that the API is reachable and try again.',
  'reports.aiMetrics.title': 'AI quality',
  'reports.aiMetrics.description':
    'What the AI really solved, how its hand-overs went and whether every mandatory hand-over happened. Not the billed figure.',
  'reports.aiMetrics.filters.active': 'Showing only:',
  'reports.aiMetrics.filters.remove': 'Remove the filter {label}',
  'reports.aiMetrics.filters.clear': 'Clear filters',
  'reports.aiMetrics.base.one': 'Over {count} ended conversation the AI wrote in',
  'reports.aiMetrics.base.other': 'Over {count} ended conversations the AI wrote in',
  'reports.aiMetrics.lowSample.one':
    'Few samples: {count} conversation is too few to read these rates as a trend.',
  'reports.aiMetrics.lowSample.other':
    'Few samples: {count} conversations are too few to read these rates as a trend.',
  'reports.aiMetrics.definitionOf': 'What {metric} counts',
  'reports.aiMetrics.showList': 'Show the conversations: {metric}',
  'reports.aiMetrics.showListShort': 'Show conversations',
  'reports.aiMetrics.resolution.title': 'Resolution',
  'reports.aiMetrics.resolution.description':
    'Confirmed by the player, assumed and settled after 72 hours, or back about the same topic.',
  'reports.aiMetrics.unsettledNote.one': '{count} more not settled yet',
  'reports.aiMetrics.unsettledNote.other': '{count} more not settled yet',
  'reports.aiMetrics.unsettledHint': 'Waiting for their 72 hours',
  'reports.aiMetrics.containmentCaution':
    'Not success on its own — read it beside the rates before it',
  'reports.aiMetrics.claims.title': 'What the AI said beside what the player answered',
  'reports.aiMetrics.claims.aiClaimed': 'AI said it is solved',
  'reports.aiMetrics.claims.playerConfirmed': 'Player said Yes',
  'reports.aiMetrics.claims.playerDenied': 'Player said No',
  'reports.aiMetrics.claims.unanswered': 'AI said solved, no answer',
  'reports.aiMetrics.claims.note':
    'Only the player’s Yes counts towards {confirmed}; the AI’s own word never does.',
  'reports.aiMetrics.handoff.title': 'Hand-over',
  'reports.aiMetrics.handoff.description':
    'How often the AI handed over, why, how good the hand-over card was and how long the player waited for a person.',
  'reports.aiMetrics.complianceTarget': 'Target 100%',
  'reports.aiMetrics.wait.when': 'When',
  'reports.aiMetrics.wait.count': 'Hand-overs',
  'reports.aiMetrics.wait.median': 'Median',
  'reports.aiMetrics.wait.p90': '90th percentile',
  'reports.aiMetrics.wait.all': 'All',
  'reports.aiMetrics.wait.inHours': 'Inside business hours',
  'reports.aiMetrics.wait.outOfHours': 'Outside business hours',
  'reports.aiMetrics.wait.noSchedule':
    'Save business hours in Settings to split the wait inside and outside them.',
  'reports.aiMetrics.reasons.title': 'Hand-over reasons',
  'reports.aiMetrics.reasons.empty': 'No hand-overs in this window.',
  'reports.aiMetrics.reasons.noKnowledge':
    '“No answer in the knowledge base” points at the unanswered questions list in the Playbook.',
  'reports.aiMetrics.violations.title': 'Mandatory hand-over violations',
  'reports.aiMetrics.violations.empty': 'None in this window.',
  'reports.aiMetrics.violations.rule': 'Rule',
  'reports.aiMetrics.violations.qaFound': 'Found by QA',
  'reports.aiMetrics.safety.title': 'Safety and satisfaction',
  'reports.aiMetrics.safety.description':
    'Guardrail violations confirmed by QA beside the automatic suspicions, ratings with and without a person, and how steadily the AI answers.',
  'reports.aiMetrics.ratings.one': '{count} rating',
  'reports.aiMetrics.ratings.other': '{count} ratings',
  'reports.aiMetrics.fewSamples': 'Few samples',
  'reports.aiMetrics.breakdown.title': 'Comparison',
  'reports.aiMetrics.breakdown.description':
    'The same figures per AI version, topic, hand-over reason, language, brand or team. Pick a row to show only that group.',
  'reports.aiMetrics.breakdown.by': 'Compare by',
  'reports.aiMetrics.breakdown.emptyTitle': 'Nothing to compare yet',
  'reports.aiMetrics.breakdown.emptyDescription':
    'No conversation the AI took part in ended in this window.',
  'reports.aiMetrics.breakdown.caption': 'AI quality by {dimension}',
  'reports.aiMetrics.breakdown.n': 'Conversations',
  'reports.aiMetrics.breakdown.actions': 'Filter',
  'reports.aiMetrics.breakdown.only': 'Show only {group}',
  'reports.aiMetrics.breakdown.onlyShort': 'Only this',
  'reports.aiMetrics.dimension.version': 'AI version',
  'reports.aiMetrics.dimension.intent': 'Topic',
  'reports.aiMetrics.dimension.reason': 'Hand-over reason',
  'reports.aiMetrics.dimension.language': 'Language',
  'reports.aiMetrics.dimension.brand': 'Brand',
  'reports.aiMetrics.dimension.team': 'Team',
  'reports.aiMetrics.noGroup.version': 'No version recorded',
  'reports.aiMetrics.noGroup.intent': 'No topic',
  'reports.aiMetrics.noGroup.reason': 'No hand-over',
  'reports.aiMetrics.noGroup.language': 'No language recorded',
  'reports.aiMetrics.noGroup.brand': 'No brand',
  'reports.aiMetrics.noGroup.team': 'No team',
  'reports.aiMetrics.conversations.title': 'Conversations behind a figure',
  'reports.aiMetrics.conversations.description':
    'The connections a figure counts, newest end first — the same rule as the count.',
  'reports.aiMetrics.list.metric': 'Figure',
  'reports.aiMetrics.list.confirmed_resolved': 'Confirmed resolutions',
  'reports.aiMetrics.list.assumed_resolved': 'Assumed resolutions',
  'reports.aiMetrics.list.unsettled': 'Not settled yet',
  'reports.aiMetrics.list.false_resolution': 'False resolutions',
  'reports.aiMetrics.list.handed_off': 'Handed over',
  'reports.aiMetrics.list.abandoned': 'Abandoned',
  'reports.aiMetrics.list.declined': 'Player said No, no hand-over',
  'reports.aiMetrics.list.mandatory_handoff_violation': 'Mandatory hand-over violations',
  'reports.aiMetrics.list.guardrail_violation': 'Guardrail violations (QA)',
  'reports.aiMetrics.list.guardrail_suspected': 'Guardrail suspicions',
  'reports.aiMetrics.list.repeat_unmeasured': 'Repeat contact not measurable',
  'reports.aiMetrics.list.error': 'Could not load these conversations. Try again.',
  'reports.aiMetrics.list.emptyTitle': 'No conversations',
  'reports.aiMetrics.list.emptyDescription': 'Nothing in this window counts towards this figure.',
  'reports.aiMetrics.list.ended': 'Ended',
  'reports.aiMetrics.list.outcome': 'Outcome',
  'reports.aiMetrics.list.topic': 'Topic',
  'reports.aiMetrics.list.reason': 'Hand-over reason',
  'reports.aiMetrics.list.loadMore': 'Load more',
  'reports.aiMetrics.list.loadingMore': 'Loading…',
  'reports.aiMetrics.outcome.confirmed_resolved': 'Confirmed resolution',
  'reports.aiMetrics.outcome.assumed_pending': 'Not settled yet',
  'reports.aiMetrics.outcome.assumed_resolved': 'Assumed resolution',
  'reports.aiMetrics.outcome.false_resolved': 'False resolution',
  'reports.aiMetrics.outcome.handed_off': 'Handed over',
  'reports.aiMetrics.outcome.abandoned': 'Abandoned',
  'reports.aiMetrics.outcome.declined': 'Player said No',

  // Reviews (FR-MOD-07.8)
  'reports.reviews.error':
    'Could not load the Reviews report. Check that the API is reachable and try again.',
  'reports.reviews.csat.title': 'Satisfaction (CSAT)',
  'reports.reviews.csat.description':
    'Rated good as a share of all ratings. Null, never 0%, when nobody rated.',
  'reports.reviews.csat.emptyDescription':
    'Once customers rate their conversations, the good / bad split shows up here.',
  'reports.reviews.csat.good': 'Rated good',
  'reports.reviews.csat.bad': 'Rated bad',
  'reports.reviews.csat.noPreviousRatings': 'No ratings in the previous period',
  'reports.reviews.csat.vsPrevious': 'vs {rate} previous period',
  'reports.reviews.csat.donutLabel': 'CSAT {rate}: {good} of {responses} rated good.',
  'reports.reviews.csat.donutUnknown': 'unknown',
  'reports.reviews.byDay.title': 'Ratings by day',
  'reports.reviews.comments.title': 'Comments',
  'reports.reviews.comments.description':
    'What players wrote with their rating in this period, newest first.',
  'reports.reviews.comments.filter': 'Show',
  'reports.reviews.comments.all': 'All ratings',
  'reports.reviews.comments.bad': 'Bad ratings',
  'reports.reviews.comments.good': 'Good ratings',
  'reports.reviews.comments.loading': 'Loading comments…',
  'reports.reviews.comments.error': 'The comments could not be loaded. Try again in a moment.',
  'reports.reviews.comments.emptyTitle': 'No comments yet',
  'reports.reviews.comments.emptyDescription':
    'When a player adds a comment to their rating, it appears here.',
  'reports.reviews.comments.handledBy': 'handled by {name}',
  'reports.reviews.comments.more': 'Load more',
  'reports.reviews.byDay.description':
    'Daily rating volume, good vs bad, over each UTC day in the window.',
  'reports.reviews.byDay.emptyTitle': 'No ratings in this window',
  'reports.reviews.byDay.emptyDescription':
    'Once customers rate conversations, each day’s ratings show up here.',
  'reports.reviews.byDay.caption': 'Ratings per day, split good and bad',
  'reports.reviews.byDay.ratingsColumn': 'Ratings',
  'reports.reviews.byDay.goodColumn': 'Good',
  'reports.reviews.byDay.badColumn': 'Bad',
  // Insights (FR-MOD-07.8) — the sentence for each statement the API can make.
  // Deliberately worded here rather than on the server: the API sends an id and
  // the figures, so an insight is as translated as the card above it.
  'reports.reviews.insights.title': 'Insights',
  'reports.reviews.insights.description':
    'What these figures say, read off them by fixed rules rather than guessed.',
  'reports.reviews.insights.emptyTitle': 'Nothing to report',
  'reports.reviews.insights.emptyDescription':
    'This period produced no statement this version of the console knows how to word.',
  'reports.reviews.insights.tone.positive': 'Good',
  'reports.reviews.insights.tone.negative': 'Watch',
  'reports.reviews.insights.tone.warning': 'Low confidence',
  'reports.reviews.insights.tone.neutral': 'Note',
  'reports.reviews.insights.no_ratings':
    'Nobody rated a conversation in this period, so there is nothing to read yet.',
  'reports.reviews.insights.low_base':
    'Only {responses} ratings in this period — too few to read a trend from, and shares may not be reliable.',
  'reports.reviews.insights.csat_no_baseline':
    'The previous period holds {previous} ratings, too few to compare against.',
  'reports.reviews.insights.csat_improved':
    'Satisfaction is up {points} points on the previous period, over {responses} ratings.',
  'reports.reviews.insights.csat_declined':
    'Satisfaction is down {points} points on the previous period, over {responses} ratings.',
  'reports.reviews.insights.csat_steady':
    'Satisfaction held steady against the previous period ({responses} ratings, {previous} before).',
  'reports.reviews.insights.all_positive':
    'Every one of this period’s {responses} ratings was positive.',
  'reports.reviews.insights.all_negative':
    'Every one of this period’s {responses} ratings was negative.',
  'reports.reviews.insights.bad_day_concentration':
    '{share} of this period’s negative ratings ({bad}) landed on {date}.',

  'reports.reviews.ecommerce.title': 'Ecommerce',
  'reports.reviews.ecommerce.description': 'Sales attributed to supported conversations.',
  'reports.reviews.ecommerce.emptyDescription':
    'Connect a sales source to attribute revenue to supported conversations.',
  'reports.reviews.ecommerce.cta': 'Configure sales platforms',

  // Breakdown (FR-MOD-07.5)
  'reports.breakdown.error':
    'Could not load the breakdown. Check that the API is reachable and try again.',
  'reports.breakdown.byDay.description': 'The resolution split for each UTC day in the window.',
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
    "Required vs scheduled agents per UTC weekday and hour, from observed volume and the presence log. Gaps are the shortfall to close; a cell with too little history shows '—', never a guessed number.",
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
  'reports.cases.byPriority.nearest': '{level} ({value})',

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
    'Connect a sales source to attribute revenue to supported conversations, using the Sales tracker.',

  // Team performance (FR-MOD-07.7, v2)
  'reports.teamPerformance.error':
    'Could not load the Team performance report. Check that the API is reachable and try again.',
  'reports.teamPerformance.description':
    'Per-agent chats, resolution split, first-response time and CSAT for the window.',
  'reports.teamPerformance.emptyTitle': 'No agent activity in this window',
  'reports.teamPerformance.emptyDescription':
    'Once conversations are assigned to agents, their per-agent performance shows up here.',
  'reports.teamPerformance.totals.title': 'Workspace totals',
  'reports.teamPerformance.totals.description':
    'The whole workspace over this window, compared with the previous one. Not the sum of the table below, which shows the top 20 agents only.',
  'reports.teamPerformance.caption': 'Per-agent chats, resolution split, response time and CSAT',
  'reports.teamPerformance.avgFirstResponseColumn': 'Avg first response',

  // Raporlar › AI Kalite (AI-24 · tm 319.3): the QA queue, one review, the calibration round.
  'reports.qa.page.title': 'AI quality',
  'reports.qa.page.description':
    'Conversations the AI took part in, reviewed against the rubric by a person.',
  'reports.qa.page.allReports': 'All reports',
  'reports.qa.page.notForRoleTitle': 'AI quality is reviewed by Team Leads and administrators',
  'reports.qa.page.notForRoleDescription':
    'Ask an administrator if you should be reviewing the AI’s conversations.',
  'reports.qa.tabs.queue': 'Queue',
  'reports.qa.tabs.calibration': 'Calibration',
  'reports.qa.tabs.metrics': 'Metrics',

  'reports.qa.criterion.topic': 'Understood the topic',
  'reports.qa.criterion.required_info': 'Required details collected',
  'reports.qa.criterion.faithfulness': 'Faithful to knowledge, nothing made up',
  'reports.qa.criterion.guardrails': 'Compliance rules kept',
  'reports.qa.criterion.handoff_timing': 'Handed over at the right time',
  'reports.qa.criterion.handoff_summary': 'Hand-over summary complete',
  'reports.qa.criterion.tone': 'Tone',

  'reports.qa.reason.random': 'Random sample',
  'reports.qa.reason.risk_flag': 'Risk flag',
  'reports.qa.reason.low_bsat': 'Low rating',
  'reports.qa.reason.repeat_72h': 'Came back within 72 h',
  'reports.qa.reason.guardrail_scan': 'Guardrail check',
  'reports.qa.reason.mandatory_handoff': 'Mandatory hand-over',
  'reports.qa.reason.handoff_insufficient': 'Hand-over card insufficient',
  'reports.qa.reason.consistency': 'Consistency',
  'reports.qa.reason.manual': 'Sent by hand',

  'reports.qa.priority.risk': 'Risk priority',
  'reports.qa.priority.guardrail': 'Guardrail priority',
  'reports.qa.priority.normal': 'Normal priority',

  'reports.qa.status.pending_prescore': 'Awaiting pre-score',
  'reports.qa.status.ready': 'Ready',
  'reports.qa.status.in_review': 'In review',
  'reports.qa.status.completed': 'Completed',
  'reports.qa.statusOption.open': 'Open',
  'reports.qa.statusOption.ready': 'Ready',
  'reports.qa.statusOption.in_review': 'In review',
  'reports.qa.statusOption.pending_prescore': 'Awaiting pre-score',
  'reports.qa.statusOption.completed': 'Completed',
  'reports.qa.statusOption.all': 'All',

  'reports.qa.final.legend': 'Verdict',
  'reports.qa.final.pass': 'Pass',
  'reports.qa.final.fail': 'Fail',
  'reports.qa.final.required': 'Choose pass or fail.',
  'reports.qa.final.criticalFail': 'A critical criterion failed, so the review is a fail.',

  'reports.qa.score.notApplicable': 'Does not apply',
  'reports.qa.score.critical': 'Critical',
  'reports.qa.score.weight': 'weight {weight}',
  'reports.qa.score.confirm': 'I checked “{criterion}” myself',

  'reports.qa.problem.required': 'Score this criterion.',
  'reports.qa.problem.invalid': 'This value does not fit the criterion.',
  'reports.qa.problem.unconfirmed': 'Confirm this critical criterion on its own.',
  'reports.qa.problem.contradicts': 'A failed critical criterion makes the review a fail.',

  'reports.qa.prescore.suggests': 'AI pre-score: {value}',
  'reports.qa.prescore.evidence': 'Messages it cites:',
  'reports.qa.prescore.evidenceLink': 'Show message {n} cited for “{criterion}”',
  'reports.qa.prescore.overall': 'The model’s overall reading: {value}.',
  'reports.qa.prescore.use': 'Use the pre-score',
  'reports.qa.prescore.neverConfirms':
    'It fills what you have not scored and confirms nothing — tick each critical criterion yourself.',
  'reports.qa.prescore.none': 'No pre-score for this one: score it from the conversation.',

  'reports.qa.excerpt.empty': 'No messages were kept for this conversation.',
  'reports.qa.excerpt.restrictedTitle': 'Responsible gaming conversation',
  'reports.qa.excerpt.restrictedBody':
    'Its text is for the Responsible Gaming team and administrators. The messages and the decision trail stay readable.',
  'reports.qa.excerpt.hidden': 'Text hidden',
  'reports.qa.author.ai': 'AI',
  'reports.qa.author.customer': 'Player',
  'reports.qa.author.agent': 'Agent',
  'reports.qa.author.bot': 'Bot',

  'reports.qa.review.title': 'AI quality review',
  'reports.qa.review.description': 'The conversation, the AI’s decisions and the rubric.',
  'reports.qa.review.back': 'Back to the queue',
  'reports.qa.review.loadError': 'This review could not be loaded.',
  'reports.qa.review.rubricVersion': 'Rubric v{version}',
  'reports.qa.review.conversation': 'Conversation',
  'reports.qa.review.trail': 'Decision trail',
  'reports.qa.review.rubric': 'Rubric',
  'reports.qa.review.pendingPrescore':
    'The model is still pre-scoring this one. It can be claimed in a minute.',
  'reports.qa.review.claimFirst':
    'Claim the review to score it. Nobody else can while you hold it.',
  'reports.qa.review.claim': 'Claim',
  'reports.qa.review.heldByOther': 'Another reviewer holds this review.',
  'reports.qa.review.comments': 'Comments',
  'reports.qa.review.saved': 'Saved.',
  'reports.qa.review.release': 'Return to the queue',
  'reports.qa.review.save': 'Save draft',
  'reports.qa.review.complete': 'Complete review',
  'reports.qa.review.incomplete.one': '{count} thing is still missing — see the rubric.',
  'reports.qa.review.incomplete.other': '{count} things are still missing — see the rubric.',

  'reports.qa.outcome.passed': 'Reviewed: pass',
  'reports.qa.outcome.failed': 'Reviewed: fail',
  'reports.qa.outcome.criticalFail': 'Reviewed: critical failure',
  'reports.qa.outcome.reviewedAt': 'Completed {at}.',
  'reports.qa.outcome.mandatoryHandoff':
    'The AI missed a hand-over it had to make. The administrators were told.',
  'reports.qa.outcome.suggestion': 'Open the coaching suggestion',
  'reports.qa.outcome.scenario': 'Open the test scenario draft',

  'reports.qa.trail.empty':
    'No decision trail is kept for this conversation any more — the excerpt is what remains.',
  'reports.qa.trail.decisions': 'AI decisions',
  'reports.qa.trail.step': 'Step',
  'reports.qa.trail.procedure': 'Procedure',
  'reports.qa.trail.handoffReason': 'Hand-over reason',
  'reports.qa.trail.sources': 'Knowledge sources',
  'reports.qa.trail.guardrails': 'Guardrail checks',
  'reports.qa.trail.handoffs': 'Hand-overs',
  'reports.qa.trail.accepted': 'accepted',
  'reports.qa.trail.riskFlags': 'Risk flags',

  'reports.qa.queue.filters': 'Queue filters',
  'reports.qa.queue.statusFilter': 'Status',
  'reports.qa.queue.reasonFilter': 'Reason',
  'reports.qa.queue.anyReason': 'Any reason',
  'reports.qa.queue.mineOnly': 'Only the ones I hold',
  'reports.qa.queue.count.one': '{count} review',
  'reports.qa.queue.count.other': '{count} reviews',
  'reports.qa.queue.openCount.one': '{count} open',
  'reports.qa.queue.openCount.other': '{count} open',
  'reports.qa.queue.loadError': 'The QA queue could not be loaded.',
  'reports.qa.queue.emptyTitle': 'Nothing to review here',
  'reports.qa.queue.emptyDescription':
    'Each night the AI’s closed conversations are sampled into this queue; Team Leads can also send one from the inbox.',
  'reports.qa.queue.caption': 'Reviews, most pressing first',
  'reports.qa.queue.colConversation': 'Conversation',
  'reports.qa.queue.colReasons': 'Why it is here',
  'reports.qa.queue.colStatus': 'Status',
  'reports.qa.queue.colDue': 'Due',
  'reports.qa.queue.colAction': 'Action',
  'reports.qa.queue.due': 'due {at}',
  'reports.qa.queue.overdue': 'Overdue',
  'reports.qa.queue.yours': 'yours',
  'reports.qa.queue.review': 'Review',
  'reports.qa.queue.continue': 'Continue',
  'reports.qa.queue.open': 'Open',
  'reports.qa.queue.previous': 'Previous',
  'reports.qa.queue.next': 'Next',

  'reports.qa.summary.title': 'AI quality figures',
  'reports.qa.summary.window': 'Last 30 days',
  'reports.qa.summary.open': 'Open',
  'reports.qa.summary.overdue': 'Overdue',
  'reports.qa.summary.completed': 'Completed',
  'reports.qa.summary.passRate': 'Pass rate',
  'reports.qa.summary.criticalFailed': 'Critical failures',
  'reports.qa.summary.handoffMissed': 'Missed hand-overs',
  'reports.qa.summary.handoffChecked.one': 'of {count} mandatory hand-over checked',
  'reports.qa.summary.handoffChecked.other': 'of {count} mandatory hand-overs checked',
  'reports.qa.summary.guardrailBreaches': 'Guardrail breaches confirmed',
  'reports.qa.summary.falseResolutions': 'False resolutions',

  'reports.qa.calibration.description':
    'Once a month every reviewer scores the same conversations on their own; the report shows how far you agree. It opens to everyone when the round closes.',
  'reports.qa.calibration.open': 'Open this month’s round',
  'reports.qa.calibration.loadError': 'The calibration rounds could not be loaded.',
  'reports.qa.calibration.emptyTitle': 'No calibration round yet',
  'reports.qa.calibration.emptyDescription':
    'An administrator opens one from the completed reviews of the last 60 days.',
  'reports.qa.calibration.rounds': 'Calibration rounds',
  'reports.qa.calibration.status.open': 'Open',
  'reports.qa.calibration.status.closed': 'Closed',
  'reports.qa.calibration.progress': 'You scored {scored} of {total}',
  'reports.qa.calibration.pickTitle': 'Pick a round',
  'reports.qa.calibration.pickDescription': 'Its conversations and report open here.',
  'reports.qa.calibration.closedAt': 'closed {at}',
  'reports.qa.calibration.close': 'Close round',
  'reports.qa.calibration.reportLater':
    'The report is shown to administrators while the round is open, and to everyone once it closes.',
  'reports.qa.calibration.items': 'Conversations in this round',
  'reports.qa.calibration.item': 'Conversation {n}',
  'reports.qa.calibration.scored': 'Scored',
  'reports.qa.calibration.notScored': 'Not scored yet',
  'reports.qa.calibration.scoreForm': 'Your scores',
  'reports.qa.calibration.saved': 'Scores saved.',
  'reports.qa.calibration.saveScores': 'Save scores',
  'reports.qa.calibration.report': 'Calibration report',
  'reports.qa.calibration.agreement': 'Agreement per criterion',
  'reports.qa.calibration.criterion': 'Criterion',
  'reports.qa.calibration.agreementCol': 'Agreement',
  'reports.qa.calibration.scoredCol': 'Scores',
  'reports.qa.calibration.reviewers': 'Reviewers',
  'reports.qa.calibration.reviewer': 'Reviewer',
  'reports.qa.calibration.deviationCol': 'Deviation',
  'reports.qa.calibration.outlier': 'Outlier',
  'reports.qa.calibration.needsTwo':
    'Agreement is measured on conversations at least two reviewers scored — none yet.',

  'reports.qa.error.claimed': 'Another reviewer claimed this review first.',
  'reports.qa.error.pending_prescore':
    'The model is still pre-scoring this review — try again in a minute.',
  'reports.qa.error.completed': 'This conversation has already been reviewed.',
  'reports.qa.error.not_claimed': 'Claim the review before scoring it.',
  'reports.qa.error.calibration_exists': 'This month already has a calibration round.',
  'reports.qa.error.calibration_closed': 'This round is closed; its scores can no longer change.',
  'reports.qa.error.conflict_of_interest':
    'You took part in this conversation, so someone else reviews it.',
  'reports.qa.error.outside_reach': 'You review the conversations of the teams you lead.',
  'reports.qa.error.capability_required': 'Your role does not review AI quality in this workspace.',
  'reports.qa.error.role_required': 'Only an administrator can do this.',
  'reports.qa.error.thread_open': 'This conversation is still open — send it once it has closed.',
  'reports.qa.error.thread_no_ai': 'The AI took no part in this conversation.',
};
