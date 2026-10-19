import type { Messages } from '../merge.js';

/**
 * Settings, first half (I18N-i, tm 133.9): channels, website widgets, tags,
 * saved replies, custom fields, forms and ticket templates. Security, sandbox,
 * white-label, SLA, sales tracker, brands and the audit log follow in I18N-j
 * (tm 133.10) — see HANDOFF.md for the exact section split.
 *
 * Several of these screens live in their own file (`TrustedDomains.tsx`,
 * `CannedResponses.tsx`, …) rather than as a section inside `SettingsPage.tsx`,
 * for the same reason `NotificationSettings.tsx` split out in I18N-e: the i18n
 * coverage sentinel claims a whole *file* as translated, and `SettingsPage.tsx`
 * still renders a dozen sections I18N-j owns in English.
 */
export const settings: Messages = {
  // Shared across this file's screens
  'settings.loading': 'Loading…',
  'settings.adding': 'Adding…',
  'settings.saving': 'Saving…',
  'settings.copied': 'Copied',
  'settings.remove': 'Remove',
  'settings.delete': 'Delete',
  'settings.cancel': 'Cancel',
  'settings.requiredLabel': 'Required',
  'settings.requiredSuffix': ' · required',
  // Shared across I18N-j's screens too (tm 133.10)
  'settings.save': 'Save',
  'settings.copy': 'Copy',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.never': 'Never',
  'settings.enable': 'Enable',
  'settings.disable': 'Disable',
  'settings.andJoiner': ' and ',
  // The header's second line over a section: the product area, then the group
  // the section sits in (tm 259.15) — the first line is the section's own name.
  'settings.pageBreadcrumb': 'Settings · {group}',

  // Side navigation — SettingsNav.tsx (FR-MOD-08.1). A section's label repeats
  // its heading, except where it would repeat its own group's name or another
  // link on the same screen (the rail's Billing).
  'settings.nav.label': 'Settings navigation',
  'settings.nav.pin': 'Pin side navigation',
  'settings.nav.unpin': 'Unpin side navigation',
  'settings.nav.group.general': 'General',
  'settings.nav.group.channels': 'Channels',
  'settings.nav.group.routing': 'Routing',
  'settings.nav.group.inbox': 'Inbox',
  'settings.nav.group.integrations': 'Integrations',
  'settings.nav.group.security': 'Security',
  'settings.nav.group.usage': 'Usage and quotas',
  'settings.nav.group.billing': 'Billing',
  'settings.nav.section.notifications': 'Notifications',
  'settings.nav.section.company': 'Company details',
  'settings.nav.section.brands': 'Brands',
  'settings.nav.section.appearance': 'Appearance',
  'settings.appearance.title': 'Appearance',
  'settings.appearance.description':
    'The font every member sees the panel in. A member can still pick their own in the account menu — whichever was chosen last applies.',
  'settings.appearance.legend': 'Workspace font',
  // A glyph sample with every Turkish letter, shown under each preset in both
  // languages on purpose: the dotted/dotless i and the cedillas are where
  // fonts differ most.
  'settings.appearance.sample': 'Pijamalı hasta yağız şoföre çabucak güvendi.',
  'settings.appearance.save': 'Save default',
  'settings.appearance.remove': 'Remove default',
  'settings.appearance.saved': 'Saved — members see it the next time the panel loads.',
  'settings.appearance.removed': 'Default removed.',
  'settings.appearance.ownerOnly': 'Only the workspace owner can change this setting.',
  'settings.appearance.current.none': 'No workspace default: members who chose nothing see Inter.',
  'settings.appearance.current.set': 'Current default: {font} · set {date}',
  'settings.appearance.yours': 'Your panel now: {source}',
  'settings.appearance.loadError': 'The appearance settings could not be loaded.',
  'settings.nav.section.channels': 'All channels',
  'settings.nav.section.websiteWidgets': 'Website widgets',
  'settings.nav.section.widget': 'Widget appearance',
  'settings.nav.section.salesTracker': 'Sales tracker',
  'settings.nav.section.routingRules': 'Chat routing',
  'settings.nav.section.skills': 'Skills',
  'settings.nav.section.ticketRules': 'Ticket rules',
  'settings.nav.section.sla': 'SLA',
  'settings.nav.section.cannedResponses': 'Saved replies',
  'settings.nav.section.tags': 'Tags',
  'settings.nav.section.chatTimeout': 'Chat timeout and day boundary',
  'settings.nav.section.ticketEmailTemplates': 'Ticket email templates',
  'settings.nav.section.customFields': 'Custom fields',
  'settings.nav.section.chatForms': 'Chat forms',
  'settings.nav.section.integrations': 'App marketplace',
  'settings.nav.section.mcp': 'MCP server',
  'settings.nav.section.personalAccessTokens': 'Personal access tokens',
  'settings.nav.section.scheduledExports': 'Scheduled exports',
  'settings.nav.section.sandbox': 'Sandbox',
  'settings.nav.section.trustedDomains': 'Trusted domains',
  'settings.nav.section.bannedCustomers': 'Blocked IP addresses',
  'settings.nav.section.memberRecognition': 'Member recognition',
  'settings.nav.section.fileSharing': 'File sharing',
  'settings.nav.section.sensitiveData': 'Sensitive data',
  'settings.nav.section.ipAllowlist': 'IP allowlist',
  'settings.nav.section.sso': 'Single sign-on',
  'settings.nav.section.twoFactor': 'Two-factor authentication',
  'settings.nav.section.compliance': 'Data region and compliance',
  'settings.nav.section.dataRetention': 'Data retention',
  'settings.nav.section.aiUsage': 'AI usage',
  'settings.nav.section.auditLog': 'Audit log',
  'settings.nav.section.siem': 'SIEM export',
  'settings.nav.section.billing': 'Subscription and invoices',

  // Side navigation search — SettingsNav.tsx (FR-MOD-08.1 · tm 255.11)
  'settings.nav.search.label': 'Search settings',
  'settings.nav.search.placeholder': 'Search settings…',
  'settings.nav.search.resultsLabel': 'Search results',
  'settings.nav.search.empty': 'No sections found for “{query}”.',
  'settings.nav.search.resultsCount.one': '{count} section found.',
  'settings.nav.search.resultsCount.other': '{count} sections found.',

  // Company details — CompanyDetails.tsx (FR-MOD-08.3)
  'settings.company.title': 'Company details',
  'settings.company.description':
    'Who this workspace is: the name on invoices and on the widget, the sector reports group it under, the postal address, and the clock the team works to.',
  'settings.company.descriptionPilot':
    'Who this workspace is: the name on the widget, the sector reports group it under, the postal address, and the clock the team works to.',
  'settings.company.loadError': 'Could not load the company details.',
  'settings.company.nameLabel': 'Company name',
  'settings.company.nameRequiredError': 'Enter the company name.',
  'settings.company.nameTooLongError': 'Use 200 characters or fewer.',
  'settings.company.sectorLabel': 'Sector',
  'settings.company.sectorUnset': 'Not set',
  'settings.company.sectorHint':
    'A fixed list, so reports can group workspaces by it. Pick Other if none fits.',
  'settings.company.sector.ecommerce_retail': 'E-commerce and retail',
  'settings.company.sector.saas_technology': 'SaaS and technology',
  'settings.company.sector.financial_services': 'Financial services',
  'settings.company.sector.healthcare': 'Healthcare',
  'settings.company.sector.travel_hospitality': 'Travel and hospitality',
  'settings.company.sector.education': 'Education',
  'settings.company.sector.real_estate': 'Real estate',
  'settings.company.sector.telecommunications': 'Telecommunications',
  'settings.company.sector.media_entertainment': 'Media and entertainment',
  'settings.company.sector.gaming_gambling': 'Gaming and gambling',
  'settings.company.sector.nonprofit_government': 'Non-profit and government',
  'settings.company.sector.professional_services': 'Professional services',
  'settings.company.sector.manufacturing_logistics': 'Manufacturing and logistics',
  'settings.company.sector.other': 'Other',
  'settings.company.sizeLabel': 'Company size',
  'settings.company.sizeUnset': 'Not set',
  'settings.company.sizeHint':
    'How many people work here — helps us tailor recommendations for you.',
  'settings.company.size.1_10': '1–10 people',
  'settings.company.size.11_50': '11–50 people',
  'settings.company.size.51_200': '51–200 people',
  'settings.company.size.201_1000': '201–1,000 people',
  'settings.company.size.1000_plus': '1,000+ people',
  'settings.company.addressLabel': 'Address',
  'settings.company.addressPlaceholder': 'Street, city, postcode, country',
  'settings.company.addressTooLongError': 'Use {max} characters or fewer.',
  'settings.company.timezoneLabel': 'Time zone',
  'settings.company.timezoneHintPrefix':
    'The workspace clock. A new work schedule starts in this zone; an agent who works another one can override it in Team →',
  'settings.company.timezoneHintLink': 'Work schedule',
  'settings.company.timezoneHintSuffix': '.',
  'settings.company.timezoneSavedNote':
    'Saved. Work schedules already saved keep the zone they were saved with — changing this never moves an agent’s existing hours.',

  // Integrations — Integrations.tsx
  'settings.integrations.title': 'Integrations',
  'settings.integrations.description':
    'Connect third-party apps — CRM, payments, e-commerce and more. A connected app shows its data right inside a conversation.',
  'settings.integrations.hint':
    'Browse the marketplace to connect the tools your team already uses.',
  'settings.integrations.openMarketplace': 'Open marketplace',

  // Trusted domains — TrustedDomains.tsx
  'settings.trustedDomains.title': 'Trusted domains',
  'settings.trustedDomains.description':
    'The allowlist the widget checks. Adding a website above fills this in for you; edit it here only for finer control, such as covering subdomains.',
  'settings.trustedDomains.removeConfirmTitle': 'Remove {domain}?',
  'settings.trustedDomains.removeAriaLabel': 'Remove {domain}',
  'settings.trustedDomains.removeConfirmDescription':
    'The widget no longer treats this domain as trusted. This cannot be undone.',
  'settings.trustedDomains.loadError': 'Could not load trusted domains.',
  'settings.trustedDomains.domainLabel': 'Domain',
  'settings.trustedDomains.domainRequiredError': 'Enter a domain.',
  'settings.trustedDomains.includeSubdomains': 'Include subdomains',
  'settings.trustedDomains.addButton': 'Add domain',
  'settings.trustedDomains.empty.title': 'No domains yet',
  'settings.trustedDomains.empty.description':
    'Add the site you want the widget on. Until then it cannot start conversations anywhere.',

  // Saved replies — CannedResponses.tsx
  'settings.cannedResponses.title': 'Saved replies',
  'settings.cannedResponses.description': 'Agents insert these by typing # in the composer.',
  'settings.cannedResponses.loadError': 'Could not load saved replies.',
  'settings.cannedResponses.shortcutLabel': 'Shortcut',
  'settings.cannedResponses.shortcutError': 'Enter a shortcut.',
  'settings.cannedResponses.replyLabel': 'Reply',
  'settings.cannedResponses.replyError': 'Enter the reply text.',
  'settings.cannedResponses.saveButton': 'Save reply',
  'settings.cannedResponses.empty.title': 'No saved replies',
  'settings.cannedResponses.empty.description': 'Save the answers your team types most often.',
  'settings.cannedResponses.deleteAriaLabel': 'Delete #{shortcut}',
  'settings.cannedResponses.deleteConfirmTitle': 'Delete #{shortcut}?',
  'settings.cannedResponses.deleteConfirmDescription':
    'The saved reply is deleted for everyone who can use it. This cannot be undone.',
  'settings.cannedResponses.teamLabel': 'Team',
  'settings.cannedResponses.allTeams': 'All teams',
  'settings.cannedResponses.teamOnly': '{name} only',
  'settings.cannedResponses.teamHint': 'Leave this on All teams to let everyone use the reply.',
  'settings.cannedResponses.editTeamButton': 'Edit team',
  'settings.cannedResponses.editTeamAriaLabel': 'Edit team for #{shortcut}',
  'settings.cannedResponses.teamForLabel': 'Team for #{shortcut}',

  // Tags — Tags.tsx
  'settings.tags.title': 'Tags',
  'settings.tags.description':
    'Labels agents apply to conversations. The inbox suggests these as they type.',
  'settings.tags.loadError': 'Could not load tags.',
  'settings.tags.tagLabel': 'Tag',
  'settings.tags.nameError': 'Enter a tag name.',
  'settings.tags.addButton': 'Add tag',
  'settings.tags.empty.title': 'No tags yet',
  'settings.tags.empty.description': 'Agree the words your team uses to label conversations.',
  'settings.tags.allTeams': 'All teams',
  'settings.tags.teamCount.one': '{count} team',
  'settings.tags.teamCount.other': '{count} teams',
  'settings.tags.inUse': '{count} in use',
  'settings.tags.deleteAriaLabel': 'Delete tag {name}',
  'settings.tags.deleteConfirmTitle': 'Delete tag “{name}”?',
  'settings.tags.deleteConfirmDescription':
    'The tag is deleted for everyone on the account. This cannot be undone.',
  'settings.tags.teamsLabel': 'Teams',
  'settings.tags.teamsHint': 'Leave every box unchecked to apply this tag to all teams.',
  'settings.tags.editTeamsButton': 'Edit teams',
  'settings.tags.editTeamsAriaLabel': 'Edit teams for tag {name}',

  // Chat timeout — ChatTimeout.tsx
  'settings.chatTimeout.title': 'Chat timeout and day boundary',
  'settings.chatTimeout.description':
    'Automatically close conversations that have gone quiet for a while, and choose where one conversation day ends and the next begins.',
  'settings.chatTimeout.loadError': 'Could not load the chat timeout setting.',
  'settings.chatTimeout.enableLabel': 'Automatically close idle chats',
  'settings.chatTimeout.enableHint':
    'While off, website widget conversations still close after 30 minutes without activity, and conversations from messaging channels stay open. While on, every conversation with no activity for the duration below is closed automatically.',
  'settings.chatTimeout.amountLabel': 'Idle for',
  'settings.chatTimeout.unitLabel': 'Unit',
  'settings.chatTimeout.unitMinutes': 'Minutes',
  'settings.chatTimeout.unitHours': 'Hours',
  'settings.chatTimeout.amountError': 'Enter a whole number greater than 0, up to 30 days total.',

  // Conversation day boundary — ChatTimeout.tsx (ID-04)
  'settings.dayBoundary.heading': 'Day boundary',
  'settings.dayBoundary.description':
    'A conversation belongs to one day. Pick the time zone that day is counted in and the hour it starts, so a player writing just after midnight is filed under the right day.',
  'settings.dayBoundary.searchLabel': 'Search time zones',
  'settings.dayBoundary.searchPlaceholder': 'e.g. istanbul, new york, utc+3',
  'settings.dayBoundary.zoneLabel': 'Time zone',
  'settings.dayBoundary.noMatch': 'No time zone matches that search.',
  'settings.dayBoundary.hourLabel': 'Day starts at',
  'settings.dayBoundary.exampleLabel': 'Day boundary example',
  'settings.dayBoundary.exampleNow':
    'Right now it is {time} in {zone}: a chat started now belongs to {day}.',
  'settings.dayBoundary.exampleSpanMidnight': 'Each day runs from 00:00 to 23:59.',
  'settings.dayBoundary.exampleSpan':
    'The day starts at {start}: a chat at {before} still belongs to the previous day, one at {start} to the new day.',
  'settings.dayBoundary.scopeNote':
    'A change applies to connections that start afterwards; a chat already filed under a day keeps it. Reports and the AI daily quota keep counting days in UTC.',

  // Ticket email templates — TicketEmailTemplates.tsx
  'settings.ticketEmailTemplates.title': 'Ticket email templates',
  'settings.ticketEmailTemplates.description':
    'Branded, reusable replies. Insert a variable with double braces, e.g. {{ticket.id}}.',
  'settings.ticketEmailTemplates.loadError': 'Could not load email templates.',
  'settings.ticketEmailTemplates.nameLabel': 'Template name',
  'settings.ticketEmailTemplates.nameError': 'Name the template.',
  'settings.ticketEmailTemplates.subjectLabel': 'Subject',
  'settings.ticketEmailTemplates.subjectError': 'Enter a subject.',
  'settings.ticketEmailTemplates.messageLabel': 'Message',
  'settings.ticketEmailTemplates.bodyError': 'Enter the message body.',
  'settings.ticketEmailTemplates.variablesLabel': 'Variables: {list}',
  'settings.ticketEmailTemplates.addButton': 'Add template',
  'settings.ticketEmailTemplates.empty.title': 'No email templates',
  'settings.ticketEmailTemplates.empty.description':
    'Author a branded, variabled reply your team can send on a ticket.',
  'settings.ticketEmailTemplates.statusOn': 'On',
  'settings.ticketEmailTemplates.statusOff': 'Off',
  'settings.ticketEmailTemplates.enable': 'Enable',
  'settings.ticketEmailTemplates.disable': 'Disable',
  'settings.ticketEmailTemplates.deleteAriaLabel': 'Delete template {name}',
  'settings.ticketEmailTemplates.deleteConfirmTitle': 'Delete template {name}?',
  'settings.ticketEmailTemplates.deleteConfirmDescription':
    'The template is deleted for everyone on the account. This cannot be undone.',

  // Custom fields — CustomFieldsSettings.tsx
  'settings.customFields.title': 'Custom fields',
  'settings.customFields.description':
    'Extra fields on tickets and contacts — a player id, a KYC status, a balance. They appear on the ticket Details pane and in the CRM.',
  'settings.customFields.loadError': 'Could not load custom fields.',
  'settings.customFields.labelLabel': 'Label',
  'settings.customFields.labelError': 'Name the field.',
  'settings.customFields.onLabel': 'On',
  'settings.customFields.typeLabel': 'Type',
  'settings.customFields.entity.ticket': 'Ticket',
  'settings.customFields.entity.contact': 'Contact',
  'settings.fieldType.text': 'Text',
  'settings.fieldType.number': 'Number',
  'settings.fieldType.boolean': 'Yes / No',
  'settings.fieldType.date': 'Date',
  'settings.customFields.addButton': 'Add field',
  'settings.customFields.showInTableLabel': 'Show in Contacts table',
  'settings.customFields.showInTableBadge': 'In Contacts table',
  'settings.customFields.empty.title': 'No custom fields',
  'settings.customFields.empty.description':
    'Add fields your team needs on tickets and contacts, like a player id or a KYC status.',
  'settings.customFields.deleteAriaLabel': 'Delete field {label}',
  'settings.customFields.deleteConfirmTitle': 'Delete field {label}?',
  'settings.customFields.deleteConfirmDescription':
    'The field is deleted for everyone on the account. This cannot be undone.',
  'settings.customFields.labelFieldAriaLabel': '{label} label',

  // Chat forms (pre-chat/post-chat/ticket/prospect) — ChatFormsSettings.tsx
  'settings.chatForms.title': 'Chat forms',
  'settings.chatForms.description':
    'Ask visitors for details before the chat starts, once it ends, or when nobody is available and they leave a message. Answers are saved to the contact — or, for questions about the message itself, to the ticket it opens.',
  'settings.chatForms.loadError': 'Could not load the chat forms.',
  'settings.chatForms.labelLabel': 'Label',
  'settings.chatForms.labelError': 'Name the field.',
  'settings.chatForms.typeLabel': 'Type',
  'settings.chatForms.placementLabel': 'Asked',
  'settings.chatForms.placement.preChat': 'Before the chat',
  'settings.chatForms.placement.postChat': 'After the chat',
  'settings.chatForms.placement.ticket': 'Offline message — about the request',
  'settings.chatForms.placement.prospect': 'Offline message — about the person',
  'settings.chatForms.addButton': 'Add field',
  'settings.chatForms.empty.title': 'No chat questions',
  'settings.chatForms.empty.description':
    'Add a field to ask visitors for details — an order number, an account id — before they start chatting, once the chat ends, or when they leave a message because nobody is available.',
  'settings.chatForms.deleteAriaLabel': 'Delete field {label}',
  'settings.chatForms.deleteConfirmTitle': 'Delete field {label}?',
  'settings.chatForms.deleteConfirmDescription':
    'The field is removed from this form, so visitors are no longer asked for it. This cannot be undone.',
  'settings.chatForms.builtIn.title': 'Built-in fields',
  'settings.chatForms.builtIn.description':
    'The form a visitor fills in before their first conversation. Choose whether it opens, and which of its four fields it shows and requires.',
  'settings.chatForms.builtIn.loadError': 'Could not load the pre-chat form.',
  'settings.chatForms.builtIn.enabledLabel': 'Ask before the chat starts',
  'settings.chatForms.builtIn.enabledHint':
    'When off, visitors write straight away and their first message opens the chat.',
  'settings.chatForms.builtIn.customHidden':
    'Your own pre-chat questions will not be asked either while the form is off.',
  'settings.chatForms.builtIn.fieldColumn': 'Field',
  'settings.chatForms.builtIn.showColumn': 'Show',
  'settings.chatForms.builtIn.requiredColumn': 'Required',
  'settings.chatForms.builtIn.field.name': 'Full name',
  'settings.chatForms.builtIn.field.username': 'Username',
  'settings.chatForms.builtIn.field.email': 'Email',
  'settings.chatForms.builtIn.field.message': 'Opening message',
  'settings.chatForms.builtIn.showAria': 'Show {field}',
  'settings.chatForms.builtIn.requireAria': 'Require {field}',
  'settings.chatForms.builtIn.usernameWarning':
    'Without the username, member recognition and same-day conversation memory are weaker.',
  'settings.chatForms.builtIn.messageHint':
    "Without it, the visitor's first line in the chat opens the conversation.",
  'settings.chatForms.builtIn.notSaved':
    'These are the defaults and have not been saved. Once saved, required fields are also checked by the server.',
  'settings.chatForms.builtIn.save': 'Save form',
  'settings.chatForms.builtIn.reset': 'Discard changes',
  'settings.chatForms.builtIn.leaveMessage': 'Discard your unsaved pre-chat form changes?',
  'settings.chatForms.builtIn.preview': 'Preview',
  'settings.chatForms.builtIn.previewSubmit': 'Start the chat',
  'settings.chatForms.builtIn.previewOff': 'No form: the visitor goes straight to the chat.',

  // Channels — Channels.tsx
  'settings.channels.title': 'Channels',
  'settings.channels.titleWithBrand': 'Channels · {brand}',
  'settings.channels.description':
    'Everywhere your customers can reach you. Connect the ones you use — each one starts delivering to the same inbox.',
  'settings.channels.loadError': 'Could not load channel statuses.',
  'settings.channels.status.connected': 'Connected',
  'settings.channels.status.ready': 'Ready',
  'settings.channels.status.not_connected': 'Not connected',
  'settings.channels.cta.connect': 'Connect',
  'settings.channels.cta.manage': 'Manage',
  'settings.channels.cta.getLink': 'Get link',
  'settings.channels.cta.getAddress': 'Get address',
  'settings.channels.cta.disconnect': 'Disconnect',
  'settings.channels.connecting': 'Connecting…',
  'settings.channels.disconnecting': 'Disconnecting…',
  'settings.channels.discardConnectionConfirm': 'Discard this connection attempt?',
  'settings.channels.website.name': 'Website widget',
  'settings.channels.website.description': 'The chat bubble on your own site.',
  'settings.channels.chatPage.name': 'Chat page',
  'settings.channels.chatPage.description':
    'A hosted link customers chat from — no install needed.',
  'settings.channels.email.name': 'Email',
  'settings.channels.email.description':
    'Forward your support inbox here and each email becomes a ticket.',
  'settings.channels.email.manage': 'Manage addresses',
  'settings.channels.email.manageTitle': 'Email forwarding addresses',
  'settings.channels.email.manageDescription':
    'Forward support mail to any of these and each message becomes a ticket. Send a test message to check an address you have just set up.',
  'settings.channels.email.defaultAddress': 'Default',
  'settings.channels.email.received': '{count} received · last {when}',
  'settings.channels.email.neverReceived': 'Nothing received yet.',
  'settings.channels.email.sendTest': 'Send test message',
  'settings.channels.email.testSent': 'Test message delivered to {address} — check your Tickets.',
  'settings.channels.email.remove': 'Remove',
  'settings.channels.email.removeConfirm':
    'Remove this address? Mail sent to it will stop arriving. Existing tickets are kept.',
  'settings.channels.email.add': 'Add address',
  'settings.channels.email.labelLabel': 'Address name (for example support)',
  'settings.channels.email.labelRequired': 'Enter a name for the address.',
  'settings.channels.email.labelInvalid':
    'Use 1-32 lowercase letters, digits or interior hyphens, e.g. support.',
  'settings.channels.messenger.name': 'Facebook Messenger',
  'settings.channels.messenger.description': 'Answer Messenger conversations.',
  'settings.channels.messenger.connectCta': 'Connect with Facebook (mock)',
  'settings.channels.messenger.connectTitle': 'Connect Facebook Messenger',
  'settings.channels.messenger.connectDescription':
    'Mock authorization for this build — a Facebook authorization code is generated automatically; add the Page id it should connect (name optional).',
  'settings.channels.messenger.pageIdLabel': 'Facebook Page id',
  'settings.channels.messenger.pageIdError': 'Enter the Facebook Page id.',
  'settings.channels.messenger.pageNameLabel': 'Page name (optional)',
  'settings.channels.messenger.disconnectConfirm':
    'Disconnect Messenger? Messages will stop arriving until you reconnect.',
  'settings.channels.whatsapp.name': 'WhatsApp',
  'settings.channels.whatsapp.description': 'Answer WhatsApp messages.',
  'settings.channels.whatsapp.connectTitle': 'Connect WhatsApp',
  'settings.channels.whatsapp.connectDescription':
    'Mock provider for this build — enter the WhatsApp Business Account id and the business phone number to answer messages on.',
  'settings.channels.whatsapp.wabaIdLabel': 'WhatsApp Business Account id',
  'settings.channels.whatsapp.wabaIdError': 'Enter the WhatsApp Business Account id.',
  'settings.channels.whatsapp.phoneNumberLabel': 'Phone number',
  'settings.channels.whatsapp.phoneNumberError': 'Enter a valid phone number, e.g. +15551234567.',
  'settings.channels.whatsapp.disconnectConfirm':
    'Disconnect WhatsApp? Messages will stop arriving until you reconnect.',
  'settings.channels.sms.name': 'SMS',
  'settings.channels.sms.description': 'Reply to text messages over Twilio.',
  'settings.channels.sms.connectTitle': 'Connect SMS (Twilio)',
  'settings.channels.sms.connectDescription':
    'Mock provider for this build — enter the Twilio Account SID, Auth token and the phone number to answer texts on.',
  'settings.channels.sms.accountSidLabel': 'Twilio Account SID',
  'settings.channels.sms.accountSidError': 'Enter the Twilio Account SID.',
  'settings.channels.sms.authTokenLabel': 'Twilio Auth token',
  'settings.channels.sms.authTokenError': 'Enter the Twilio Auth token.',
  'settings.channels.sms.phoneNumberLabel': 'Phone number',
  'settings.channels.sms.phoneNumberError': 'Enter a valid phone number, e.g. +15551234567.',
  'settings.channels.sms.disconnectConfirm':
    'Disconnect SMS? Messages will stop arriving until you reconnect.',
  'settings.channels.instagram.name': 'Instagram',
  'settings.channels.instagram.description': 'Answer Instagram direct messages.',
  'settings.channels.instagram.connectTitle': 'Connect Instagram',
  'settings.channels.instagram.connectDescription':
    'Mock authorization for this build — any code and user id complete the handshake.',
  'settings.channels.instagram.codeLabel': 'Authorization code',
  'settings.channels.instagram.codeError': 'Enter the authorization code.',
  'settings.channels.instagram.userIdLabel': 'Instagram user id',
  'settings.channels.instagram.userIdError': 'Enter the Instagram user id.',
  'settings.channels.instagram.disconnectConfirm':
    'Disconnect Instagram? Direct messages will stop arriving until you reconnect.',
  'settings.channels.telegram.name': 'Telegram',
  'settings.channels.telegram.description': 'Answer Telegram chats.',
  'settings.channels.telegram.connectTitle': 'Connect Telegram',
  'settings.channels.telegram.connectDescription':
    'Enter the bot token from @BotFather and its username to receive Telegram messages here.',
  'settings.channels.telegram.tokenLabel': 'Bot token',
  'settings.channels.telegram.tokenError': 'Enter the bot token.',
  'settings.channels.telegram.usernameLabel': 'Bot username',
  'settings.channels.telegram.usernameError': 'Enter the bot username.',
  'settings.channels.telegram.disconnectConfirm':
    'Disconnect Telegram? Messages will stop arriving until you reconnect.',
  // tm 263: the live bot — the name comes from Telegram, only the token is asked for.
  'settings.channels.telegram.liveDescription':
    'Paste the token @BotFather gave you. It is checked with Telegram, the bot name comes from Telegram, and the token is stored encrypted.',
  'settings.channels.live': 'Live',

  // Website widgets — WebsiteWidgets.tsx
  'settings.websiteWidgets.title': 'Website widgets',
  'settings.websiteWidgets.titleWithBrand': 'Website widgets · {brand}',
  'settings.websiteWidgets.description':
    'Install the chat widget on your sites. Adding one here also trusts its domain, so the widget can start conversations there right away.',
  'settings.websiteWidgets.loadError': 'Could not load your websites.',
  'settings.websiteWidgets.domainLabel': 'Website domain',
  'settings.websiteWidgets.domainRequiredError': 'Enter a website domain.',
  'settings.websiteWidgets.domainInvalidError': 'Enter a valid domain, like shop.example.',
  'settings.websiteWidgets.installMethodLabel': 'Install method',
  'settings.websiteWidgets.installMethod.manual': 'Paste code manually',
  'settings.websiteWidgets.installMethod.platform': 'Platform (Shopify / WordPress / GTM)',
  'settings.websiteWidgets.addButton': 'Add website',
  'settings.websiteWidgets.empty.title': 'No websites yet',
  'settings.websiteWidgets.empty.description':
    'Add the site you want the widget on, then paste the snippet before its closing body tag.',
  'settings.websiteWidgets.status.connected': 'Connected',
  'settings.websiteWidgets.status.pending': 'Waiting for first message',
  'settings.websiteWidgets.status.error': 'Error',
  'settings.websiteWidgets.testMessageReceived': 'Test message received',
  'settings.websiteWidgets.getCode': 'Get code',
  'settings.websiteWidgets.hideCode': 'Hide code',
  'settings.websiteWidgets.removeAriaLabel': 'Remove {domain}',
  'settings.websiteWidgets.removeConfirmTitle': 'Remove {domain}?',
  'settings.websiteWidgets.removeConfirmDescription':
    'The chat widget stops working on this site, so visitors there can no longer start a chat. This cannot be undone.',
  'settings.websiteWidgets.footerHintPrefix': 'Paste the snippet immediately before',
  'settings.websiteWidgets.footerHintSuffix': 'on every page.',
  'settings.websiteWidgets.customizeWidget': 'Customize widget',
  'settings.websiteWidgets.snippet.reportSale':
    'To report a sale once checkout completes, call the tracking code from your own script:',
  'settings.websiteWidgets.snippet.signOut':
    'When your site signs a user out, make the chat forget them too, so the next person on this browser starts a new conversation. Wait for it before you leave the page:',
  'settings.websiteWidgets.snippet.copyCode': 'Copy code',
  'settings.websiteWidgets.snippet.inviteDeveloper': 'Invite developer',
  'settings.websiteWidgets.platformInstall': 'Platform install',
  'settings.websiteWidgets.manualInstall': 'Manual install',
  'settings.websiteWidgets.mailtoSubject': 'Install our chat widget on {domain}',
  'settings.websiteWidgets.mailtoBody':
    'Please paste this snippet immediately before the closing </body> tag on {domain}:\n\n{snippet}',

  // Settings, second half (I18N-j, tm 133.10): security (SSO/SCIM/IP allowlist/
  // HIPAA/SIEM/audit), sandbox, white-label widget appearance, SLA, sales
  // tracker, brands, MCP connection, scheduled exports, banned IPs, file
  // sharing, skills and routing/ticket rules — see HANDOFF.md for the split.

  // MCP server — McpConnection.tsx
  'settings.mcpConnection.title': 'MCP server',
  'settings.mcpConnection.description':
    'Ask AI assistants about your SiyahTuş data. Works with Claude, ChatGPT, and any MCP-compatible tool.',
  'settings.mcpConnection.loadError': 'Could not load the MCP server details.',
  'settings.mcpConnection.serverUrlLabel': 'MCP server URL',
  'settings.mcpConnection.claudeSetup': 'Claude setup',
  'settings.mcpConnection.step1': 'Open Claude, then go to Settings → Connectors.',
  'settings.mcpConnection.step2': 'Choose “Add custom connector”.',
  'settings.mcpConnection.step3': 'Paste the MCP server URL above.',
  'settings.mcpConnection.step4':
    'Sign in with your SiyahTuş account when prompted, and approve the scopes it requests.',
  'settings.mcpConnection.step5': 'Ask a question about your workspace — see the example below.',
  'settings.mcpConnection.examplePromptLabel': 'Example prompt',
  'settings.mcpConnection.examplePrompt': 'Find all tickets where customers ask about bulk orders',
  'settings.mcpConnection.availableToolsLabel': 'Available tools',
  'settings.mcpConnection.empty.title': 'No tools published yet',
  'settings.mcpConnection.empty.description':
    'Tools appear here as they are connected to this server.',

  // Brands — Brands.tsx
  'settings.brands.title': 'Brands',
  'settings.brands.description':
    'Run several brands under one subscription. Each has its own channels, websites and widget appearance, selected from the brand switcher.',
  'settings.brands.loadError': 'Could not load your brands.',
  'settings.brands.nameLabel': 'Brand name',
  'settings.brands.nameError': 'Enter a brand name.',
  'settings.brands.addButton': 'Add brand',
  'settings.brands.empty.title': 'No brands yet',
  'settings.brands.empty.description':
    'Add a brand to run a second storefront or support line under this subscription.',
  'settings.brands.default': 'Default',
  'settings.brands.removeAriaLabel': 'Remove {name}',
  'settings.brands.removeConfirmTitle': 'Remove {name}?',
  'settings.brands.removeConfirmDescription':
    'The brand is removed from your subscription. This cannot be undone.',
  'settings.brands.nameFieldAriaLabel': '{name} name',

  // Widget appearance / white-label — WidgetCustomization.tsx
  'settings.widgetCustomization.title': 'Widget appearance',
  'settings.widgetCustomization.titleWithBrand': 'Widget appearance · {brand}',
  'settings.widgetCustomization.description':
    'How the chat widget looks on your sites. Changes are baked into the install snippet and applied the next time the widget loads.',
  'settings.widgetCustomization.loadError': 'Could not load widget appearance.',
  'settings.widgetCustomization.colorLabel': 'Brand colour',
  'settings.widgetCustomization.colorSwatchAriaLabel': 'Brand colour swatch',
  'settings.widgetCustomization.colorHexAriaLabel': 'Brand colour hex',
  'settings.widgetCustomization.colorError': 'Enter a hex colour such as #2d67fa.',
  'settings.widgetCustomization.positionLegend': 'Position',
  'settings.widgetCustomization.positionHint': 'Which corner the launcher sits in.',
  'settings.widgetCustomization.position.bottom-right': 'Bottom right',
  'settings.widgetCustomization.position.bottom-left': 'Bottom left',
  'settings.widgetCustomization.themeLegend': 'Colour scheme',
  'settings.widgetCustomization.themeHint':
    "Auto follows each visitor's device; the others force it.",
  'settings.widgetCustomization.theme.auto': 'Auto',
  'settings.widgetCustomization.theme.light': 'Light',
  'settings.widgetCustomization.theme.dark': 'Dark',
  'settings.widgetCustomization.mobileFullscreenLabel': 'Full screen on mobile',
  'settings.widgetCustomization.mobileFullscreenHint':
    'Open edge-to-edge on phones rather than as a floating card.',
  'settings.widgetCustomization.poweredByLabel': 'Show “Powered by SiyahTuş”',
  'settings.widgetCustomization.poweredByHint':
    'A small credit in the widget footer. Turn it off to remove it.',
  'settings.widgetCustomization.welcomeLegend': 'Welcome message',
  'settings.widgetCustomization.welcomeHint':
    'Shown as your team’s first message when a visitor opens the chat. Leave both empty to use the built-in line.',
  'settings.widgetCustomization.welcomeTitleLabel': 'Title',
  'settings.widgetCustomization.welcomeTextLabel': 'Message',
  'settings.widgetCustomization.welcomeTextHint':
    'For a link, write [label](https://address). **bold** and *italic* work too.',
  'settings.widgetCustomization.languageLegend': 'Language',
  'settings.widgetCustomization.languageLabel': 'Widget language',
  'settings.widgetCustomization.language.auto': 'Automatic (visitor’s browser)',
  'settings.widgetCustomization.languageHint':
    'Automatic opens the widget in each visitor’s browser language. It ships in eight languages.',
  'settings.widgetCustomization.fallbackLanguageLabel': 'Fallback language',
  'settings.widgetCustomization.fallbackLanguageHint':
    'Used when Automatic finds none of the eight languages in the visitor’s browser.',
  'settings.widgetCustomization.languageSnippetNote':
    'A language written into your install snippet (data-language) overrides this setting on that page.',
  'settings.widgetCustomization.entitlementError':
    'Removing the SiyahTuş badge is an Enterprise feature. Upgrade the plan to hide it.',
  'settings.widgetCustomization.saveButton': 'Save appearance',
  'settings.widgetCustomization.resetButton': 'Reset',
  'settings.widgetCustomization.previewLabel': 'Preview',
  'settings.widgetCustomization.previewChatWithUs': 'Chat with us',
  'settings.widgetCustomization.previewGreeting': 'Hi! How can we help?',
  'settings.widgetCustomization.previewCustomerMessage': 'I have a question',
  'settings.widgetCustomization.previewPoweredBy': 'Powered by SiyahTuş',
  'settings.widgetCustomization.previewLanguageNote':
    'The preview text is in your panel’s language; visitors see the widget in the language above.',
  'settings.widgetCustomization.previewAutoNote':
    "Auto shows light or dark to match each visitor's device — light shown here.",
  'settings.widgetCustomization.previewFullscreenNote': 'On phones the panel opens full screen.',
  'settings.widgetCustomization.previewFloatingNote':
    'On phones the panel opens as a floating card.',

  // Sales tracker — SalesTracker.tsx
  'settings.salesTracker.title': 'Sales tracker',
  'settings.salesTracker.description':
    'Attribute orders your site reports through the widget snippet to the chat that led to them.',
  'settings.salesTracker.loadError': 'Could not load the sales tracker settings.',
  'settings.salesTracker.attributionWindowError': 'Enter a whole number of days, {min}-{max}.',
  'settings.salesTracker.trackLabel': 'Track sales',
  'settings.salesTracker.trackHint':
    "Off by default. While on, orders reported through the widget's tracking snippet are recorded and attributed to the chat that led to them.",
  'settings.salesTracker.currencyLabel': 'Currency',
  'settings.salesTracker.currencyHint':
    'Every tracked order is recorded and reported in this currency.',
  'settings.salesTracker.windowLabel': 'Attribution window (days)',
  'settings.salesTracker.windowHint': 'How long after a chat a sale can still be credited to it.',
  'settings.salesTracker.savedNotePrefix': 'Saved. Tracked sales show up in',
  'settings.salesTracker.savedNoteLink': 'Reports → Reviews → Ecommerce',
  'settings.salesTracker.savedNoteSuffix': '.',

  // IP allowlist + session policy — IpAllowlist.tsx
  'settings.ipAllowlist.title': 'IP allowlist',
  'settings.ipAllowlist.description':
    'Sources allowed to reach the agent/admin panel once enforcement is on below. A saved list can never exclude the address you are connecting from — the server refuses a change that would lock you out.',
  'settings.ipAllowlist.loadError': 'Could not load the IP allowlist.',
  'settings.ipAllowlist.savedNote': 'Saved.',
  'settings.ipAllowlist.entryLabel': 'Address or CIDR range',
  'settings.ipAllowlist.entryRequiredError': 'Enter an address or CIDR range.',
  'settings.ipAllowlist.labelLabel': 'Label (optional)',
  'settings.ipAllowlist.addButton': 'Add entry',
  'settings.ipAllowlist.empty.title': 'No allowlist entries',
  'settings.ipAllowlist.empty.description':
    'Nothing is restricted yet. Add the addresses your team connects from before turning enforcement on below.',
  'settings.ipAllowlist.sessionPolicyTitle': 'Session policy',
  'settings.ipAllowlist.sessionPolicyDescription':
    'Whether the allowlist above is enforced, how long a session may sit idle, and how many may run at once for one owner. Leave a limit blank to turn it off.',
  'settings.ipAllowlist.sessionPolicyLoadError': 'Could not load the session policy.',
  'settings.ipAllowlist.enforceLabel': 'IP allowlist enforcement',
  'settings.ipAllowlist.enforceCheckboxLabel': 'Enforce the IP allowlist',
  'settings.ipAllowlist.enforceHint':
    'Once on, only the addresses above may reach the agent/admin panel.',
  'settings.ipAllowlist.idleTimeoutLabel': 'Idle timeout (minutes)',
  'settings.ipAllowlist.idleTimeoutError':
    'Enter a number of minutes, or leave it blank to turn it off.',
  'settings.ipAllowlist.idleTimeoutSummary': 'Idle timeout: {value}',
  'settings.ipAllowlist.minutesValue.one': '{count} minute',
  'settings.ipAllowlist.minutesValue.other': '{count} minutes',
  'settings.ipAllowlist.maxSessionsLabel': 'Max concurrent sessions',
  'settings.ipAllowlist.maxSessionsError':
    'Enter a whole number of 1 or more, or leave it blank for the default.',
  'settings.ipAllowlist.maxSessionsSummary': 'Max concurrent sessions: {value}',
  'settings.ipAllowlist.defaultMaxSessions': '25 (default)',
  'settings.ipAllowlist.requireTwoFactorLabel': 'Two-factor authentication',
  'settings.ipAllowlist.requireTwoFactorCheckboxLabel': 'Require two-factor authentication',
  'settings.ipAllowlist.requireTwoFactorHint':
    'Once on, any teammate without it set up is asked to add it the next time they sign in — nobody is signed out or locked out immediately.',
  'settings.ipAllowlist.requireTwoFactorConfirmTitle': 'Require two-factor authentication?',
  'settings.ipAllowlist.requireTwoFactorConfirmDescription':
    'Every teammate will need a working authenticator. Anyone without one yet keeps working normally until their next sign-in, when they will be asked to set it up.',
  'settings.ipAllowlist.requireTwoFactorMissingCount.one':
    '{count} of {total} teammate has not set up two-factor yet.',
  'settings.ipAllowlist.requireTwoFactorMissingCount.other':
    '{count} of {total} teammates have not set up two-factor yet.',
  'settings.ipAllowlist.requireTwoFactorConfirmButton': 'Require two-factor',

  // Single sign-on + SCIM — SsoConnection.tsx
  'settings.sso.title': 'Single sign-on',
  'settings.sso.description':
    'Federate sign-in to a SAML 2.0 identity provider. Adding or changing a connection is restricted to the workspace owner — writing the certificate here decides whose signature is trusted.',
  'settings.sso.loadError': 'Could not load SSO connections.',
  'settings.sso.restrictedNote': 'Only the workspace owner can add, rotate or remove a connection.',
  'settings.sso.nameLabel': 'Name',
  'settings.sso.nameError': 'Name this connection.',
  'settings.sso.entityIdLabel': 'IdP entity id',
  'settings.sso.entityIdError': 'Enter the IdP entity id.',
  'settings.sso.ssoUrlLabel': 'Sign-on URL',
  'settings.sso.ssoUrlError': 'Enter the IdP sign-on URL.',
  'settings.sso.certificateLabel': 'IdP signing certificate (PEM)',
  'settings.sso.certificateError': 'Paste the IdP certificate.',
  'settings.sso.verifiedDomainsLabel': 'Verified domains',
  'settings.sso.verifiedDomainsError': 'Enter at least one domain, like acme.com.',
  'settings.sso.verifiedDomainsHint':
    'Comma-separated. Only addresses in these domains can be provisioned by this identity provider or by SCIM — one per line of your company’s domains, in full and without a wildcard. Each one has to prove ownership before it provisions anybody.',
  'settings.sso.verifiedDomainsSummary': 'Provisions: {domains}',
  'settings.sso.domainVerified': 'Verified',
  'settings.sso.domainPendingStatus': 'Not verified yet',
  'settings.sso.domainPending': 'provisions nobody until you verify it',
  'settings.sso.domainChallengeSent': 'code sent to {mailbox}',
  'settings.sso.domainSendCode': 'Send verification code',
  'settings.sso.domainResend': 'Send again',
  'settings.sso.domainEnterCode': 'Enter code',
  'settings.sso.domainCodeLabel': 'Verification code for {domain}',
  'settings.sso.domainVerifyAction': 'Verify',
  'settings.sso.domainErrorFallback': 'That did not work. Try again.',
  'settings.sso.emailAttributeLabel': 'Email attribute (optional)',
  'settings.sso.nameAttributeLabel': 'Name attribute (optional)',
  'settings.sso.allowIdpInitiatedLabel': 'Allow IdP-initiated sign-in',
  'settings.sso.enableImmediatelyLabel': 'Enable immediately',
  'settings.sso.verifyButton': 'Verify format',
  'settings.sso.addButton': 'Add connection',
  'settings.sso.verifyHint':
    'Verify format checks the certificate, entity id and URL locally — it never contacts the identity provider.',
  'settings.sso.verifyOk': 'Looks well-formed.',
  'settings.sso.entitlementError':
    'Single sign-on is an Enterprise feature. Upgrade the plan to add a connection.',
  'settings.sso.empty.title': 'No SSO connections',
  'settings.sso.empty.description':
    "Add your identity provider's metadata to let its members sign in with SAML.",
  'settings.sso.enabledStatus': 'Enabled',
  'settings.sso.disabledStatus': 'Disabled',
  'settings.sso.rotationOverlapNote': 'Rotation overlap active until {date}',
  'settings.sso.enforcedActiveNote':
    'Required — members cannot sign in with a password. Owners keep theirs.',
  'settings.sso.enforcedInactiveNote':
    'Marked required, but the connection is switched off, so passwords still work.',
  'settings.sso.enabledCheckboxLabel': 'Enabled',
  'settings.sso.requireSsoLabel': 'Require SSO',
  'settings.sso.enforceModalTitle': 'Require {name} for sign-in?',
  'settings.sso.enforceModalDescription':
    'Everyone in this workspace will have to sign in through your identity provider — their passwords stop working here. Owners keep a password door so a provider outage cannot lock the workspace out, and every one of those sign-ins is recorded in the audit log.',
  'settings.sso.requireButton': 'Require single sign-on',
  'settings.sso.requiring': 'Requiring…',
  'settings.sso.requireErrorFallback': 'Could not require single sign-on.',
  // Refusals that name the exact fix, by the server's stable `details.reason`
  // (lib/reason-message.ts, tm 259.18).
  'settings.reason.sso_no_break_glass_owner':
    'That would lock this workspace out: with single sign-on required, an owner with a password is the only way back in when the identity provider cannot answer. Set a password on the owner account before requiring SSO.',
  'settings.reason.sso_domain_code_expired':
    'That verification code has expired. Send a new one to the domain and try again.',
  'settings.reason.sso_domain_none_outstanding':
    'No verification code is outstanding for that domain. Send one first.',
  'settings.reason.sso_domain_code_mismatch':
    'That verification code does not match. Check it and retry.',
  'settings.reason.sso_domain_challenge_too_soon':
    'A verification message for that domain was just sent. Wait a minute before sending another.',
  'settings.reason.ip_allowlist_self_lockout':
    'That would lock you out: the list must still include the address you are connecting from.',
  'settings.sso.removeModalTitle': 'Remove {name}?',
  'settings.sso.removeModalDescription':
    'Anyone who signs in through this connection loses that path immediately. This cannot be undone.',
  'settings.sso.removeConfirmButton': 'Remove connection',
  'settings.sso.removing': 'Removing…',
  'settings.scim.title': 'SCIM provisioning',
  'settings.scim.description':
    "Bearer tokens for your identity provider's SCIM connector. A token is shown once, at creation, then never again.",
  'settings.scim.loadError': 'Could not load provisioning tokens.',
  'settings.scim.tokenNameLabel': 'Token name',
  'settings.scim.tokenNameError': 'Name this token.',
  'settings.scim.expiresInLabel': 'Expires in (days)',
  'settings.scim.createButton': 'Create token',
  'settings.scim.creating': 'Creating…',
  'settings.scim.expiryRangeError': 'Expiry must be a whole number of days, 1 to 365.',
  'settings.scim.empty.title': 'No provisioning tokens',
  'settings.scim.empty.description':
    "Create one to paste into your identity provider's SCIM connector.",
  'settings.scim.untitledToken': 'Untitled token',
  'settings.scim.lastUsed': 'Last used {date}',
  'settings.scim.neverUsed': 'Never used',
  'settings.scim.expires': 'Expires {date}',
  'settings.scim.noExpiry': 'No expiry',
  'settings.scim.revokeButton': 'Revoke',
  'settings.scim.revokeModalTitle': 'Revoke {name}?',
  'settings.scim.revokeModalDefaultName': 'this token',
  'settings.scim.revokeModalDescription':
    "Your identity provider's connector stops being able to provision or deprovision users the moment this takes effect. This cannot be undone.",
  'settings.scim.revokeConfirmButton': 'Revoke token',
  'settings.scim.revoking': 'Revoking…',
  'settings.scim.tokenCreatedTitle': '{name} created',
  'settings.scim.defaultTokenName': 'Token',
  'settings.scim.tokenCreatedDescription':
    "Paste this into your identity provider's SCIM connector now.",
  'settings.scim.bearerTokenLabel': 'Bearer token',
  'settings.scim.tokenWarning': 'This token will not be shown again — store it now.',
  'settings.scim.doneButton': 'Done',

  // Data region + HIPAA/BAA — Compliance.tsx
  'settings.compliance.title': 'Data region and compliance',
  'settings.compliance.description':
    "Where this workspace's data lives, and its HIPAA Business Associate Agreement status.",
  'settings.compliance.loadError': 'Could not load compliance settings.',
  'settings.compliance.regionLabel': 'Data region',
  'settings.compliance.regionFixedNote':
    "Fixed at signup — a workspace's region can never be changed.",
  'settings.compliance.region.eu': 'European Union',
  'settings.compliance.region.us': 'United States',
  'settings.compliance.baaLabel': 'HIPAA Business Associate Agreement',
  'settings.compliance.baaSigned': 'Signed',
  'settings.compliance.baaNotSigned': 'Not signed',
  'settings.compliance.baaAcceptedOn': 'Accepted {date}.',
  'settings.compliance.baaUnavailable':
    'HIPAA cover is only available to workspaces hosted in the United States.',
  'settings.compliance.baaRestricted': 'Only the workspace owner can accept the BAA.',
  'settings.compliance.acceptButton': 'Accept the BAA',
  'settings.compliance.accepting': 'Accepting…',
  'settings.compliance.entitlementError':
    'HIPAA cover is an Enterprise feature. Upgrade the plan to accept the agreement.',

  // Data retention — DataRetention.tsx
  'settings.retention.title': 'Data retention',
  'settings.retention.description':
    'How long this workspace keeps conversations and visitor data before they are permanently deleted.',
  'settings.retention.loadError': 'Could not load retention settings.',
  'settings.retention.threadLabel': 'Closed conversations',
  'settings.retention.threadHint':
    'Applies to closed conversations and every message in them. Live conversations are never touched.',
  'settings.retention.visitLabel': 'Visitor data',
  'settings.retention.visitHint': 'Visits recorded by the widget — IP address, browser and pages.',
  'settings.retention.inherit': 'Use the default ({days} days)',
  'settings.retention.tier.30d': '30 days',
  'settings.retention.tier.60d': '60 days',
  'settings.retention.tier.365d': '365 days',
  'settings.retention.tier.unlimited': 'Keep indefinitely',
  'settings.retention.effectiveDays': 'Deleted after {days} days.',
  'settings.retention.effectiveUnlimited': 'Never deleted automatically.',
  'settings.retention.hipaaNote':
    'This workspace has a signed HIPAA agreement, so data cannot be kept longer than {days} days and cannot be kept indefinitely.',
  'settings.retention.auditNote':
    'The audit log keeps its own 30-day window and is not affected by these settings.',

  // SIEM export — SiemExport.tsx
  'settings.siemExport.title': 'SIEM export',
  'settings.siemExport.description':
    "Ship this workspace's audit trail to a SIEM destination on a schedule (SOC 2 / ISO 27001).",
  'settings.siemExport.loadError': 'Could not load the SIEM export configuration.',
  'settings.siemExport.gapTitle': 'A gap was found in the audit trail.',
  'settings.siemExport.gapBody':
    'The chain of audit entries is missing a piece — some part of the record cannot be accounted for. Delivery keeps running; this needs investigating.',
  'settings.siemExport.enableLabel': 'Enable export',
  'settings.siemExport.enableHint':
    'When on, a scheduled job ships new audit entries to the destination below.',
  'settings.siemExport.destinationLabel': 'Destination',
  'settings.siemExport.entitlementError':
    'SIEM export is an Enterprise feature. Upgrade the plan to turn it on.',
  'settings.siemExport.target.file': 'File (.data/siem sink)',
  'settings.siemExport.lastExport': 'Last export',
  'settings.siemExport.lastRun': 'Last run',
  'settings.siemExport.delivered': 'Delivered',
  'settings.siemExport.pending': 'Pending',

  // SLA — SlaPolicy.tsx
  'settings.sla.title': 'SLA',
  'settings.sla.description':
    'How long a customer may wait for a first reply and for a case to be finished. Measured and marked, never enforced — nothing here re-routes or re-prioritises a conversation.',
  'settings.sla.loadError': 'Could not load the SLA targets.',
  'settings.sla.minutesError':
    'Enter a whole number of minutes, 1-{max}, or leave blank for no target.',
  'settings.sla.statusLabel': 'Status',
  'settings.sla.active': 'Active',
  'settings.sla.notActive': 'Not active',
  'settings.sla.downgradeNote':
    'Targets are saved but not being measured right now — this plan does not include SLA tracking. Upgrading restores measurement against the numbers below, unchanged.',
  'settings.sla.firstResponseLabel': 'First response target (minutes)',
  'settings.sla.resolutionLabel': 'Resolution target (minutes)',
  'settings.sla.noTargetPlaceholder': 'No target',
  'settings.sla.businessHoursLabel': 'Count only business hours',
  'settings.sla.businessHoursHint':
    "Measured against the agents' saved work schedules. With no saved schedule anywhere, clocks run continuously.",
  'settings.sla.entitlementError':
    'SLA targets are an Enterprise feature. Upgrade the plan to save changes here.',
  'settings.sla.savedNotePrefix': 'Saved. Misses show up as',
  'settings.sla.savedNoteLink': 'Reports → Overview → SLA breaches',
  'settings.sla.savedNoteSuffix': '.',

  // Sandbox — Sandbox.tsx
  'settings.sandbox.title': 'Sandbox',
  'settings.sandbox.description':
    'A second, disconnected workspace to test integrations or onboard a new hire in — never billed, never counted against a seat, and invisible from production.',
  'settings.sandbox.loadError': 'Could not load the sandbox.',
  'settings.sandbox.isSandboxLabel': 'This is a sandbox',
  'settings.sandbox.isSandboxNote':
    'Everything in this workspace is disconnected from production — nothing here is billed or counted, and nothing here is real customer data.',
  'settings.sandbox.resetButton': 'Reset sandbox',
  'settings.sandbox.resetting': 'Resetting…',
  'settings.sandbox.resetRestricted': 'Only the workspace owner can reset this sandbox.',
  'settings.sandbox.notAvailable': 'Not available',
  'settings.sandbox.entitlementNote':
    'A sandbox is an Enterprise feature. Upgrade the plan to create one.',
  // tm 257.15: the six "Enterprise feature — upgrade the plan" notes, as the public
  // pilot words them. The plan cannot be changed there (Billing is hidden), so the
  // note says the feature is off and who to ask. Chosen by `useEntitlementNote`.
  'settings.pilot.unavailable': 'This feature is not available in the pilot — contact {email}.',
  'settings.pilot.unavailableNoContact': 'This feature is not available in the pilot.',
  'settings.sandbox.createdLabel': 'Sandbox created',
  'settings.sandbox.createdSummary': 'Created {created}. Last reset: {reset}.',
  'settings.sandbox.createdUnknown': 'unknown',
  'settings.sandbox.resetNever': 'never',
  'settings.sandbox.resetFromInsideNote':
    'Reset it by signing in to the sandbox itself — a production credential cannot wipe it.',
  'settings.sandbox.emptyNote': 'This workspace has no sandbox yet.',
  'settings.sandbox.createButton': 'Create sandbox',
  'settings.sandbox.creating': 'Creating…',
  'settings.sandbox.createRestricted': 'Only the workspace owner can create a sandbox.',
  'settings.sandbox.resetModalTitle': 'Reset this sandbox?',
  'settings.sandbox.resetModalDescription':
    'Every conversation, contact, and setting inside it is deleted. This cannot be undone, and you will be signed out.',

  // Scheduled exports — ScheduledExports.tsx
  'settings.scheduledExports.title': 'Scheduled exports',
  'settings.scheduledExports.description':
    'Mail a report group to your team on a timer — daily, weekly or monthly, as a CSV.',
  'settings.scheduledExports.loadError': 'Could not load scheduled exports.',
  'settings.scheduledExports.reportLabel': 'Report',
  'settings.scheduledExports.reportPlaceholder': 'Select a report…',
  'settings.scheduledExports.frequencyLabel': 'Frequency',
  'settings.scheduledExports.frequency.daily': 'Daily',
  'settings.scheduledExports.frequency.weekly': 'Weekly',
  'settings.scheduledExports.frequency.monthly': 'Monthly',
  'settings.scheduledExports.scheduleButton': 'Schedule export',
  'settings.scheduledExports.scheduling': 'Scheduling…',
  'settings.scheduledExports.recipientsLegend': 'Recipients',
  'settings.scheduledExports.noActiveAgents': 'No active agents to notify.',
  'settings.scheduledExports.groupError': 'Select a report group.',
  'settings.scheduledExports.recipientsError': 'Select at least one recipient.',
  'settings.scheduledExports.empty.title': 'No scheduled exports',
  'settings.scheduledExports.empty.description':
    "Schedule a report group above and it lands in your team's inbox automatically.",
  'settings.scheduledExports.neverRun': 'Never run',
  'settings.scheduledExports.delivered': 'Delivered',
  'settings.scheduledExports.failed': 'Failed',
  'settings.scheduledExports.running': 'Running',
  'settings.scheduledExports.checking': 'Checking…',
  'settings.scheduledExports.recipientCount.one': '{count} recipient',
  'settings.scheduledExports.recipientCount.other': '{count} recipients',
  'settings.scheduledExports.summary': '{frequency} · {recipients}',
  'settings.scheduledExports.cancelConfirm': 'Cancel this export?',
  'settings.scheduledExports.confirmCancelButton': 'Confirm cancel',
  'settings.scheduledExports.keepButton': 'Keep',
  'settings.scheduledExports.cancelAriaLabel': 'Cancel {group} export',
  // EditScheduledExportModal (tm 215 TRACKED · tm 245)
  'settings.scheduledExports.editButton': 'Edit',
  'settings.scheduledExports.editAriaLabel': 'Edit {group} export',
  'settings.scheduledExports.editModal.title': 'Edit scheduled export',
  'settings.scheduledExports.editModal.description':
    'Change the report group, frequency or recipients.',
  'settings.scheduledExports.saving': 'Saving…',

  // Blocked IP addresses — BannedCustomerIps.tsx
  'settings.bannedIps.title': 'Blocked IP addresses',
  'settings.bannedIps.description':
    'A visitor on one of these addresses is refused a chat, even from a fresh session. To ban a named contact instead, use the block action on their profile in Customers.',
  'settings.bannedIps.loadError': 'Could not load blocked addresses.',
  'settings.bannedIps.ipLabel': 'IP address',
  'settings.bannedIps.ipRequiredError': 'Enter an IP address.',
  'settings.bannedIps.ipHint':
    'An IPv4 or IPv6 address. The visitor is blocked until you remove it here.',
  'settings.bannedIps.blockButton': 'Block address',
  'settings.bannedIps.empty.title': 'No blocked addresses',
  'settings.bannedIps.empty.description':
    'Add an IP address to refuse chats from it. Nothing is blocked until you do.',

  // Sensitive data — SensitiveData.tsx (tm 300.2 · AI-26)
  'settings.sensitiveData.title': 'Sensitive data',
  'settings.sensitiveData.description':
    'Secrets a visitor types into a conversation are masked the moment the message arrives — before it is stored, logged or shown to the AI. This cannot be switched off.',
  'settings.sensitiveData.tableCaption': 'What is masked, and in whose messages',
  'settings.sensitiveData.col.type': 'Type',
  'settings.sensitiveData.col.detected': 'Recognised as',
  'settings.sensitiveData.col.player': "Visitor's messages",
  'settings.sensitiveData.col.team': "Team's and AI's messages",
  'settings.sensitiveData.masked': 'Masked',
  'settings.sensitiveData.shown': 'Shown in full',
  'settings.sensitiveData.detected.card':
    'A card number that passes the Luhn check; the last four digits are kept',
  'settings.sensitiveData.detected.cvv': '3–4 digits next to "CVV", "CVC" or "security code"',
  'settings.sensitiveData.detected.otp':
    '4–8 digits next to "code", "SMS", "OTP" or "verification" — never a bare number, an amount or a reference',
  'settings.sensitiveData.detected.password':
    'The word after "my password", "password:" or "pw" and similar',
  'settings.sensitiveData.detected.iban':
    'An IBAN with a valid checksum; the country and the last four characters are kept',
  'settings.sensitiveData.detected.seed_phrase': '12 or more wallet recovery words in a row',
  'settings.sensitiveData.detected.private_key':
    'A wallet private key — a 64-character transaction hash on its own is left alone',
  'settings.sensitiveData.detected.banking_credential':
    'A customer number for online banking together with its password',
  'settings.sensitiveData.note.everywhere':
    'The original value is not kept anywhere: not in the transcript, the logs, the AI records or the transcript e-mail.',
  'settings.sensitiveData.note.warning':
    'The visitor is told once per conversation for each kind of secret, in their own language, that the value was hidden and that they should not share it.',
  'settings.sensitiveData.note.iban':
    'An IBAN an agent sends the visitor stays whole, so a deposit can be made to it. The AI never sends one itself.',
  'settings.sensitiveData.note.ai':
    'When a visitor shares a password or a code, the AI is told to warn them never to share it — it never sees the value.',
  'settings.sensitiveData.note.attachments':
    'Images and files are not masked: a receipt may show a card number or an IBAN.',
  'settings.sensitiveData.note.badge':
    'In the inbox, a masked message carries a "Sensitive data hidden" label naming what was hidden.',

  // File sharing — FileSharing.tsx
  'settings.fileSharing.title': 'File sharing',
  'settings.fileSharing.description':
    'Applies to attachments from agents and customers alike. Anything outside these rules is refused.',
  'settings.fileSharing.loadError': 'Could not load file sharing rules.',
  'settings.fileSharing.allowLabel': 'Allow file sharing',
  'settings.fileSharing.allowHint': 'Turning this off refuses every attachment, whoever sends it.',
  'settings.fileSharing.allowedTypesLabel': 'Allowed types',
  'settings.fileSharing.allowedTypesHint':
    'MIME types, comma separated — the form a browser labels a file with.',
  'settings.fileSharing.maxSizeLabel': 'Max size (MB)',
  'settings.fileSharing.maxSizeError': 'Enter a size from 1 to 100 MB.',

  // Skills (expertise catalogue) — Skills.tsx
  'settings.skills.title': 'Skills',
  'settings.skills.description':
    'Areas of expertise. Require one in a routing rule, or assign one to an agent in Team.',
  'settings.skills.loadError': 'Could not load skills.',
  'settings.skills.nameLabel': 'Skill',
  'settings.skills.nameError': 'Name the skill.',
  'settings.skills.addButton': 'Add skill',
  'settings.skills.empty.title': 'No skills yet',
  'settings.skills.empty.description':
    'Add a skill to require it in a routing rule or assign it to an agent in Team.',
  'settings.skills.deleteAriaLabel': 'Delete skill {name}',
  'settings.skills.deleteConfirmTitle': 'Delete skill {name}?',
  'settings.skills.deleteConfirmDescription':
    'The skill is deleted for everyone on the account. This cannot be undone.',

  // Routing rules — RoutingRules.tsx
  'settings.routing.title': 'Routing',
  'settings.routing.description':
    'Checked in order. The first rule whose conditions all match decides the team.',
  'settings.routing.loadError': 'Could not load routing rules.',
  'settings.routing.empty.title': 'No routing rules',
  'settings.routing.empty.description':
    'Without a fallback rule, conversations have nowhere to go.',
  'settings.routing.fallbackBadge': 'fallback',
  'settings.routing.everythingElse': 'Everything else',
  'settings.routing.ruleLabel': 'Rule',
  'settings.routing.noTeam': 'no team',
  'settings.routing.fallbackDisabledTitle': 'The fallback rule cannot be disabled',
  'settings.routing.fallbackDeleteTitle':
    'The fallback rule cannot be deleted — point it at another team instead',
  'settings.routing.deleteAriaLabel': 'Delete rule {name}',
  'settings.routing.deleteConfirmTitle': 'Delete rule {name}?',
  'settings.routing.deleteConfirmDescription':
    'New chats are no longer routed by this rule. This cannot be undone.',
  'settings.routing.anything': 'Anything',
  'settings.routing.conditionSkill': 'skill {names}',
  'settings.routing.form.nameLabel': 'Rule name',
  'settings.routing.form.nameError': 'Name the rule.',
  'settings.routing.form.urlLabel': 'When the page URL contains',
  'settings.routing.form.urlError': 'Enter the text the URL must contain.',
  'settings.routing.form.teamLabel': 'Send to team',
  'settings.routing.form.teamPlaceholder': 'Choose a team',
  'settings.routing.form.teamError': 'Choose the team this rule sends to.',
  'settings.routing.form.priorityLabel': 'Priority',
  'settings.routing.form.priorityError': 'Enter a whole number between 0 and 1000.',
  'settings.routing.form.asFallbackLabel':
    'Make this the fallback — it takes everything no other rule matched',
  'settings.routing.form.addButton': 'Add rule',
  'settings.routing.form.noTeams':
    'Create a team first — a rule has to send conversations somewhere.',

  // Ticket rules — TicketRules.tsx
  'settings.ticketRules.title': 'Ticket rules',
  'settings.ticketRules.description':
    'When a ticket is opened, the first matching rule sets its priority or applies a tag.',
  'settings.ticketRules.loadError': 'Could not load ticket rules.',
  'settings.ticketRules.ruleNameLabel': 'Rule name',
  'settings.ticketRules.ruleNameError': 'Name the rule.',
  'settings.ticketRules.subjectLabel': 'When subject contains',
  'settings.ticketRules.subjectError': 'Enter the text the subject must contain.',
  'settings.ticketRules.thenLabel': 'Then',
  'settings.ticketRules.setPriorityOption': 'Set priority',
  'settings.ticketRules.addTagOption': 'Add tag',
  'settings.ticketRules.priorityLabel': 'Priority',
  'settings.ticketRules.tagLabel': 'Tag',
  'settings.ticketRules.valueError': 'Enter a value for the action.',
  'settings.ticketRules.priorityWholeNumberError': 'Enter a whole number, 0 or more.',
  'settings.ticketRules.addButton': 'Add rule',
  'settings.ticketRules.empty.title': 'No ticket rules',
  'settings.ticketRules.empty.description':
    'Auto-assign, prioritise or tag tickets the moment they are opened.',
  'settings.ticketRules.deleteAriaLabel': 'Delete rule {name}',
  'settings.ticketRules.deleteConfirmTitle': 'Delete rule {name}?',
  'settings.ticketRules.deleteConfirmDescription':
    'New tickets are no longer handled by this rule. This cannot be undone.',
  'settings.ticketRules.subjectContains': 'subject contains “{text}”',
  'settings.ticketRules.fromSource': 'from {source}',
  'settings.ticketRules.anyTicket': 'any ticket',
  'settings.ticketRules.assignAgent': 'assign to an agent',
  'settings.ticketRules.assignTeam': 'assign to a team',
  'settings.ticketRules.setPriorityAction': 'set priority {priority}',
  'settings.ticketRules.addTagAction': 'add tag “{tag}”',
  'settings.ticketRules.doNothing': 'do nothing',

  // Two-factor authentication — TwoFactor.tsx
  'settings.twoFactor.title': 'Two-factor authentication',
  'settings.twoFactor.description':
    'Ask for a code from an authenticator app, in addition to your password, when you sign in.',
  'settings.twoFactor.loadError': 'Could not load two-factor authentication status.',
  'settings.twoFactor.offDescription': 'Your account currently signs in with a password alone.',
  'settings.twoFactor.pendingHint':
    'Setup was started but never finished. Enable it again to pick up where you left off.',
  'settings.twoFactor.recoveryCodesRemaining.one': '{count} recovery code left',
  'settings.twoFactor.recoveryCodesRemaining.other': '{count} recovery codes left',
  'settings.twoFactor.enableButton': 'Enable two-factor authentication',
  'settings.twoFactor.enabling': 'Starting…',
  'settings.twoFactor.regenerateButton': 'Get new recovery codes',
  'settings.twoFactor.disableButton': 'Turn off',
  'settings.twoFactor.disableBlockedByWorkspaces':
    'Two-factor authentication is required by {names}. It cannot be turned off while you are a member there.',

  'settings.twoFactor.enrollPasswordUnavailable':
    'This account signs in through an identity provider and belongs to more than one workspace. Set a password on it first — otherwise one workspace would be choosing the second factor that guards all of them.',

  'settings.twoFactor.enrollPassword.title': 'Confirm it is you, to turn two-factor on',
  'settings.twoFactor.enrollPassword.description':
    'A second factor covers every workspace this account can sign in to, so setting one up asks for your password — the same as turning it off.',
  'settings.twoFactor.enrollPassword.label': 'Password',
  'settings.twoFactor.enrollPassword.error': 'This field is required.',
  'settings.twoFactor.enrollPassword.confirmButton': 'Continue',
  'settings.twoFactor.enrollPassword.confirming': 'Checking…',
  'settings.twoFactor.enrollPassword.discardConfirm': 'Discard this?',

  'settings.twoFactor.enroll.title': 'Set up two-factor authentication',
  'settings.twoFactor.enroll.description':
    'Enter this into your authenticator app, then enter the code it shows.',
  'settings.twoFactor.enroll.secretLabel': 'Setup key',
  'settings.twoFactor.enroll.copySecretAriaLabel': 'Copy setup key',
  'settings.twoFactor.enroll.uriLabel': 'Setup link',
  'settings.twoFactor.enroll.copyUriAriaLabel': 'Copy setup link',
  'settings.twoFactor.enroll.codeLabel': 'Authentication code',
  'settings.twoFactor.enroll.codeError': 'Enter the code your authenticator app is showing.',
  'settings.twoFactor.enroll.verifyButton': 'Verify & activate',
  'settings.twoFactor.enroll.verifying': 'Verifying…',
  'settings.twoFactor.enroll.discardConfirm': 'Discard this setup attempt?',

  'settings.twoFactor.recovery.title': 'Save your recovery codes',
  'settings.twoFactor.recovery.description':
    'Each code works once, and gets you back in if you lose access to your authenticator app. They will not be shown again.',
  'settings.twoFactor.recovery.downloadButton': 'Download .txt',
  'settings.twoFactor.recovery.savedConfirm': 'I have saved these codes somewhere safe.',
  'settings.twoFactor.recovery.doneButton': 'Done',
  'settings.twoFactor.recovery.discardConfirm':
    'These codes will not be shown again. Close without saving them?',

  'settings.twoFactor.reauth.disableTitle':
    'Confirm it is you, to turn off two-factor authentication',
  'settings.twoFactor.reauth.regenerateTitle': 'Confirm it is you, to get new recovery codes',
  'settings.twoFactor.reauth.passwordLabel': 'Password',
  'settings.twoFactor.reauth.codeLabel': 'Two-factor or recovery code',
  'settings.twoFactor.reauth.credentialError': 'This field is required.',
  'settings.twoFactor.reauth.confirmButton': 'Confirm',
  'settings.twoFactor.reauth.confirming': 'Confirming…',
  'settings.twoFactor.reauth.discardConfirm': 'Discard this?',

  // Personal access tokens — PersonalAccessTokens.tsx (M-UI-b)
  'settings.pat.title': 'Personal access tokens',
  'settings.pat.description':
    'Long-lived credentials for scripts and integrations that call the API as you.',
  'settings.pat.loadError': 'Could not load your personal access tokens.',
  'settings.pat.noAccess':
    'This session is not allowed to read personal access tokens. Sign in again to manage them.',
  'settings.pat.unnamed': 'Untitled token',
  'settings.pat.scopeCount.one': '{count} scope',
  'settings.pat.scopeCount.other': '{count} scopes',
  'settings.pat.created': 'Created {when}',
  'settings.pat.lastUsed': 'Last used {when}',
  'settings.pat.neverUsed': 'Never used',
  'settings.pat.expires': 'Expires {when}',
  'settings.pat.neverExpires': 'No expiry',
  'settings.pat.revokeButton': 'Revoke',
  'settings.pat.revokeAriaLabel': 'Revoke token {name}',
  'settings.pat.empty.title': 'No tokens yet',
  'settings.pat.empty.description':
    'Create one to call the API from a script or an integration, instead of borrowing your session.',

  'settings.pat.form.nameLabel': 'Token name',
  'settings.pat.form.namePlaceholder': 'Nightly reporting job',
  'settings.pat.form.nameError': 'Name this token, so you know what you are revoking later.',
  'settings.pat.form.nameInvalid': 'Use a name of up to 120 characters.',
  'settings.pat.reason.scopes_required': 'Select at least one scope.',
  'settings.pat.reason.scopes_not_held':
    'You cannot grant scopes your own session does not hold: {scopes}.',
  'settings.pat.form.expiryLabel': 'Expires after',
  'settings.pat.form.days': '{days} days',
  'settings.pat.form.scopesLabel': 'Scopes',
  'settings.pat.form.scopesHint':
    'Only the scopes your own session holds can be granted, and they are fixed when the token is created — give it the least it needs.',
  'settings.pat.form.createButton': 'Create token',
  'settings.pat.form.creating': 'Creating…',

  'settings.pat.issued.title': '{name} is ready',
  'settings.pat.issued.description': 'Copy it now — this is the only time it is shown.',
  'settings.pat.issued.tokenLabel': 'Token',
  'settings.pat.issued.copyAriaLabel': 'Copy token',
  'settings.pat.issued.warning':
    'This token will not be shown again. If you lose it, revoke it and create another.',
  'settings.pat.issued.usageLabel': 'How to send it',
  'settings.pat.issued.doneButton': 'Done',

  'settings.pat.revoke.title': 'Revoke {name}?',
  'settings.pat.revoke.description':
    'Anything still using this token stops working immediately, and it cannot be undone.',
  'settings.pat.revoke.confirmButton': 'Revoke token',
  'settings.pat.revoke.revoking': 'Revoking…',

  // Example values shown inside empty fields (tm 259.18). Only the ones made of
  // words live here; an address, a CIDR range, a certificate or a time stays a
  // literal in the markup because it reads the same in every language.
  'settings.brands.namePlaceholder': 'Acme Support',
  'settings.cannedResponses.shortcutPlaceholder': 'shipping',
  'settings.cannedResponses.messagePlaceholder': 'Standard delivery takes 3-5 working days.',
  'settings.chatForms.labelPlaceholder': 'Order number',
  'settings.customFields.namePlaceholder': 'Player ID',
  'settings.ipAllowlist.labelPlaceholder': 'Office VPN',
  'settings.skills.namePlaceholder': 'Billing',
  'settings.sso.scimNamePlaceholder': 'Okta (corp) provisioning',
  'settings.ticketEmailTemplates.namePlaceholder': 'Ticket received',
  'settings.ticketEmailTemplates.subjectPlaceholder': 'We received your ticket {{ticket.id}}',
  'settings.ticketEmailTemplates.bodyPlaceholder': 'Hi {{customer.name}}, thanks for reaching out.',
  'settings.ticketRules.namePlaceholder': 'Refunds',
  'settings.ticketRules.subjectPlaceholder': 'refund',

  // AI usage — AiUsage.tsx (tm 283.4)
  'settings.aiUsage.title': 'AI usage',
  'settings.aiUsage.description':
    'How much of the workspace’s daily AI allowance has been spent, which feature spent it, and who is warned when it runs low. Numbers only — no conversation text.',
  'settings.aiUsage.loadError': 'The AI usage could not be loaded.',
  'settings.aiUsage.utcNote':
    'Today is {day} in UTC. The allowance renews at {resets} (00:00 UTC), whatever time zone the workspace uses.',
  'settings.aiUsage.meter.llm': 'Language model tokens',
  'settings.aiUsage.meter.embedding': 'Embedding tokens',
  'settings.aiUsage.meter.llm_test': 'Language model tokens (tests)',
  'settings.aiUsage.meter.embedding_test': 'Embedding tokens (tests)',
  'settings.aiUsage.testHeading': 'Simulations and tests (their own, smaller allowance)',
  'settings.aiUsage.usedOfCap': '{used} of {cap} today ({percent})',
  'settings.aiUsage.percentOfCap': '{percent} of the daily allowance',
  'settings.aiUsage.reserved': '{count} more held by requests still in flight.',
  'settings.aiUsage.costToday': 'Estimated cost today',
  'settings.aiUsage.costEstimateHint': 'An estimate — it will not match an invoice.',
  'settings.aiUsage.priceLlm':
    'language model {input} per million input tokens, {output} per million output tokens',
  'settings.aiUsage.priceEmbedding': 'embeddings {price} per million tokens',
  'settings.aiUsage.pricingNote':
    'Estimated at the prices configured for this deployment: {prices}. Provider discounts and later price changes are not reflected.',
  'settings.aiUsage.chartHeading': 'Last {days} days (UTC)',
  'settings.aiUsage.chartTotal': '{total} tokens in total',
  'settings.aiUsage.chartTableCaption': '{meter} per UTC day',
  'settings.aiUsage.col.day': 'Day (UTC)',
  'settings.aiUsage.col.surface': 'Feature',
  'settings.aiUsage.col.meter': 'Meter',
  'settings.aiUsage.col.input': 'Input tokens',
  'settings.aiUsage.col.output': 'Output tokens',
  'settings.aiUsage.col.cost': 'Estimated cost',
  'settings.aiUsage.surfaceHeading': 'Where the tokens went, last {days} days',
  'settings.aiUsage.surfaceEmpty': 'No AI use recorded in this period.',
  'settings.aiUsage.surface.ai_agent': 'AI agent',
  'settings.aiUsage.surface.copilot': 'Copilot',
  'settings.aiUsage.surface.knowledge_index': 'Knowledge indexing',
  'settings.aiUsage.surface.simulation': 'Simulations',
  'settings.aiUsage.surface.qa': 'Conversation review',
  'settings.aiUsage.surface.cluster': 'Unanswered-question grouping',
  'settings.aiUsage.alertsHeading': 'Alerts today',
  'settings.aiUsage.alertsNote':
    'You are warned once at 80% and once at 100% of each meter, per day. The owner always receives them.',
  'settings.aiUsage.alertsNone': 'No alert has been sent today.',
  'settings.aiUsage.alertRow': '{threshold} of {meter} — sent {time}',
  'settings.aiUsage.recipientsLegend': 'Also warn',
  'settings.aiUsage.recipientsNoteOwner':
    'Choose which vice-owners and admins are warned besides you.',
  'settings.aiUsage.recipientsNoteOther': 'Only the workspace owner can change who is warned.',
  'settings.aiUsage.recipientsNone': 'There are no other admins to choose from.',
  'settings.aiUsage.recipientsSave': 'Save recipients',
  'settings.aiUsage.recipientsSaved': 'Saved.',
  'settings.aiUsage.capNote':
    'The daily allowance is set by the SiyahTuş team and cannot be changed here. To raise it, contact us.',

  // Member recognition — MemberRecognition.tsx (ID-03 · tm 287.5)
  'settings.memberRecognition.title': 'Member recognition',
  'settings.memberRecognition.description':
    'How a returning visitor is recognised on your website, and what an agent is shown about other records that may be the same person.',
  'settings.memberRecognition.loadError': 'Could not load the member recognition settings.',
  'settings.memberRecognition.ttlHeading': 'How long a visitor is remembered',
  'settings.memberRecognition.ttlHint':
    'A visitor is recognised again for this long after their last visit. Every visit starts the time over, so someone who keeps coming back is never forgotten.',
  'settings.memberRecognition.amountLabel': 'Remember for',
  'settings.memberRecognition.unitLabel': 'Unit',
  'settings.memberRecognition.unitDays': 'days',
  'settings.memberRecognition.unitHours': 'hours',
  'settings.memberRecognition.ttlBounds': 'From {min} day to {max} days.',
  'settings.memberRecognition.ttlError': 'Enter a whole number from 1 day to 365 days.',
  'settings.memberRecognition.matchesLabel': 'Show possible matches to agents',
  'settings.memberRecognition.matchesHint':
    'Other customers who typed the same username or e-mail are listed on a customer as unverified suggestions. Only an agent’s confirmation links two records. Off, the list is empty.',
  'settings.memberRecognition.keyHeading': 'Signing key',
  'settings.memberRecognition.keyHint':
    'The key the server signs member tokens with. It is never shown. Rotate it when you suspect it has leaked, or on a schedule.',
  'settings.memberRecognition.keyNone':
    'No key yet. One is created the first time a visitor is recognised, or when you rotate.',
  'settings.memberRecognition.keyVersion': 'Current version',
  'settings.memberRecognition.keyCreated': 'Created',
  'settings.memberRecognition.keyPrevious': 'Previous key',
  'settings.memberRecognition.keyPreviousUntil': 'Version {version}, still accepted until {date}',
  'settings.memberRecognition.graceLabel': 'Keep the old key for (days)',
  'settings.memberRecognition.graceHint.one':
    'Visitors the old key signed are still recognised for {count} day, and signed again under the new key.',
  'settings.memberRecognition.graceHint.other':
    'Visitors the old key signed are still recognised for {count} days, and signed again under the new key.',
  'settings.memberRecognition.graceNone':
    '0 retires the old key at once: every returning visitor starts again as a new visitor.',
  'settings.memberRecognition.graceError': 'Enter a whole number from {min} to {max}.',
  'settings.memberRecognition.rotateButton': 'Rotate the key',
  'settings.memberRecognition.rotateConfirmTitle': 'Rotate the signing key?',
  'settings.memberRecognition.rotateConfirmGrace.one':
    'A new key signs from now on. Visitors the old key signed are still recognised for {count} day.',
  'settings.memberRecognition.rotateConfirmGrace.other':
    'A new key signs from now on. Visitors the old key signed are still recognised for {count} days.',
  'settings.memberRecognition.rotateConfirmNone':
    'The old key stops working at once. Every returning visitor starts again as a new visitor.',
  'settings.memberRecognition.rotateConfirm': 'Rotate key',
  'settings.memberRecognition.rotateFailure': 'The key could not be rotated.',
  'settings.memberRecognition.forgetHeading': 'Forget every returning visitor',
  'settings.memberRecognition.forgetHint':
    'Every browser that was recognised before now becomes a new visitor. Nothing is deleted and nobody is blocked; conversations and customer records stay as they are.',
  'settings.memberRecognition.forgetLast': 'Last done {date}.',
  'settings.memberRecognition.forgetButton': 'Forget all visitors',
  'settings.memberRecognition.forgetConfirmTitle': 'Forget every returning visitor?',
  'settings.memberRecognition.forgetConfirmDescription':
    'Every visitor your website recognised so far starts again as a new visitor on their next visit. This cannot be undone.',
  'settings.memberRecognition.forgetConfirm': 'Forget all visitors',
  'settings.memberRecognition.forgetFailure': 'The visitors could not be forgotten.',
  // Risk flags (AI-27 · tm 302.3) — RiskFlagSettings.tsx
  'settings.nav.section.riskFlags': 'Risk flags',
  'settings.riskFlags.title': 'Risk flags',
  'settings.riskFlags.description':
    'Who handles responsible gaming, and who is told the moment an urgent flag is raised. A flag keeps promotions and bonus talk away from a player at risk and the AI out of a conversation that must stay with a person.',
  'settings.riskFlags.loadError': 'The risk flag settings could not be loaded.',
  'settings.riskFlags.teamLabel': 'Responsible Gaming team',
  'settings.riskFlags.teamNone': 'No team chosen',
  'settings.riskFlags.teamUnknown': 'Team #{id} (no longer exists)',
  'settings.riskFlags.teamHint':
    'Members of this team read the notes on flags and are told of every urgent flag. A flagged conversation goes to them when it is handed over.',
  'settings.riskFlags.emailsLabel': 'Also email urgent flags to',
  'settings.riskFlags.emailsHint':
    'Up to {max} addresses, separated by commas. Workspace owners and admins are always told. The email says that a flag was raised, never what the player wrote.',
  'settings.riskFlags.emailsTooMany': 'At most {max} addresses.',
  'settings.riskFlags.emailsInvalid': '“{address}” is not a valid email address.',
  'settings.riskFlags.saved': 'Saved.',
  'settings.riskFlags.legend.title': 'Kinds of flag',
  'settings.riskFlags.legend.description':
    'These are fixed by the platform. Anyone who can see a conversation sees its flags; only the notes are restricted.',
  'settings.riskFlags.legend.type': 'Flag',
  'settings.riskFlags.legend.severity': 'Severity',
  'settings.riskFlags.legend.clearedBy': 'Cleared by',
  'settings.riskFlags.legend.effect': 'What it does',
  'settings.riskFlags.legend.andUp': '{role} and up',
};
