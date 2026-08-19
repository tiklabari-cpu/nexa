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
  'settings.trustedDomains.loadError': 'Could not load trusted domains.',
  'settings.trustedDomains.domainLabel': 'Domain',
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
  'settings.customFields.addButton': 'Add field',
  'settings.customFields.empty.title': 'No custom fields',
  'settings.customFields.empty.description':
    'Add fields your team needs on tickets and contacts, like a player id or a KYC status.',
  'settings.customFields.deleteAriaLabel': 'Delete field {label}',

  // Pre-chat form — PreChatFormSettings.tsx
  'settings.preChatForm.title': 'Pre-chat form',
  'settings.preChatForm.description':
    'Ask visitors for details before the chat starts. Answers are saved to the contact and shown in the CRM.',
  'settings.preChatForm.loadError': 'Could not load the pre-chat form.',
  'settings.preChatForm.labelLabel': 'Label',
  'settings.preChatForm.labelError': 'Name the field.',
  'settings.preChatForm.typeLabel': 'Type',
  'settings.preChatForm.addButton': 'Add field',
  'settings.preChatForm.empty.title': 'No pre-chat questions',
  'settings.preChatForm.empty.description':
    'Add a field to ask visitors for details — an order number, an account id — before they start chatting.',
  'settings.preChatForm.deleteAriaLabel': 'Delete field {label}',

  // Channels — Channels.tsx
  'settings.channels.title': 'Channels',
  'settings.channels.titleWithBrand': 'Channels · {brand}',
  'settings.channels.description':
    'Everywhere your customers can reach you. Connect the ones you use; we will let you know as the rest arrive.',
  'settings.channels.loadError': 'Could not load channel statuses.',
  'settings.channels.status.connected': 'Connected',
  'settings.channels.status.ready': 'Ready',
  'settings.channels.status.not_connected': 'Not connected',
  'settings.channels.status.coming_soon': 'Coming soon',
  'settings.channels.cta.connect': 'Connect',
  'settings.channels.cta.manage': 'Manage',
  'settings.channels.cta.getLink': 'Get link',
  'settings.channels.cta.getAddress': 'Get address',
  'settings.channels.cta.getNotified': 'Get notified',
  'settings.channels.cta.disconnect': 'Disconnect',
  'settings.channels.notifiedAck': 'We’ll let you know.',
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
  'settings.channels.messenger.name': 'Facebook Messenger',
  'settings.channels.messenger.description': 'Answer Messenger conversations.',
  'settings.channels.whatsapp.name': 'WhatsApp',
  'settings.channels.whatsapp.description': 'Answer WhatsApp messages.',
  'settings.channels.sms.name': 'SMS',
  'settings.channels.sms.description': 'Reply to text messages over Twilio.',
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
  'settings.websiteWidgets.footerHintPrefix': 'Paste the snippet immediately before',
  'settings.websiteWidgets.footerHintSuffix': 'on every page.',
  'settings.websiteWidgets.customizeWidget': 'Customize widget',
  'settings.websiteWidgets.snippet.reportSale':
    'To report a sale once checkout completes, call the tracking code from your own script:',
  'settings.websiteWidgets.snippet.copyCode': 'Copy code',
  'settings.websiteWidgets.snippet.inviteDeveloper': 'Invite developer',
  'settings.websiteWidgets.platformInstall': 'Platform install',
  'settings.websiteWidgets.manualInstall': 'Manual install',
  'settings.websiteWidgets.mailtoSubject': 'Install our chat widget on {domain}',
  'settings.websiteWidgets.mailtoBody':
    'Please paste this snippet immediately before the closing </body> tag on {domain}:\n\n{snippet}',
};
