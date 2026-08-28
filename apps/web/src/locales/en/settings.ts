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
  'settings.pageTitle': 'Settings',
  'settings.pageDescription': 'Widget installation, saved replies and routing.',

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

  // Chat timeout — ChatTimeout.tsx
  'settings.chatTimeout.title': 'Chat timeout',
  'settings.chatTimeout.description':
    'Automatically close conversations that have gone quiet for a while.',
  'settings.chatTimeout.loadError': 'Could not load the chat timeout setting.',
  'settings.chatTimeout.enableLabel': 'Automatically close idle chats',
  'settings.chatTimeout.enableHint':
    'Off by default. While on, a conversation with no activity for the duration below is closed automatically.',
  'settings.chatTimeout.amountLabel': 'Idle for',
  'settings.chatTimeout.unitLabel': 'Unit',
  'settings.chatTimeout.unitMinutes': 'Minutes',
  'settings.chatTimeout.unitHours': 'Hours',
  'settings.chatTimeout.amountError': 'Enter a whole number greater than 0, up to 30 days total.',

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

  // Chat forms (pre/post-chat) — ChatFormsSettings.tsx
  'settings.chatForms.title': 'Chat forms',
  'settings.chatForms.description':
    'Ask visitors for details before the chat starts, or once it ends. Answers are saved to the contact and shown in the CRM.',
  'settings.chatForms.loadError': 'Could not load the chat forms.',
  'settings.chatForms.labelLabel': 'Label',
  'settings.chatForms.labelError': 'Name the field.',
  'settings.chatForms.typeLabel': 'Type',
  'settings.chatForms.placementLabel': 'Asked',
  'settings.chatForms.placement.preChat': 'Before the chat',
  'settings.chatForms.placement.postChat': 'After the chat',
  'settings.chatForms.addButton': 'Add field',
  'settings.chatForms.empty.title': 'No chat questions',
  'settings.chatForms.empty.description':
    'Add a field to ask visitors for details — an order number, an account id — before they start chatting or once the chat ends.',
  'settings.chatForms.deleteAriaLabel': 'Delete field {label}',

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

  // Settings, second half (I18N-j, tm 133.10): security (SSO/SCIM/IP allowlist/
  // HIPAA/SIEM/audit), sandbox, white-label widget appearance, SLA, sales
  // tracker, brands, MCP connection, scheduled exports, banned IPs, file
  // sharing, skills and routing/ticket rules — see HANDOFF.md for the split.

  // MCP server — McpConnection.tsx
  'settings.mcpConnection.title': 'MCP server',
  'settings.mcpConnection.description':
    'Ask AI assistants about your Nexa data. Works with Claude, ChatGPT, and any MCP-compatible tool.',
  'settings.mcpConnection.loadError': 'Could not load the MCP server details.',
  'settings.mcpConnection.serverUrlLabel': 'MCP server URL',
  'settings.mcpConnection.claudeSetup': 'Claude setup',
  'settings.mcpConnection.step1': 'Open Claude, then go to Settings → Connectors.',
  'settings.mcpConnection.step2': 'Choose “Add custom connector”.',
  'settings.mcpConnection.step3': 'Paste the MCP server URL above.',
  'settings.mcpConnection.step4':
    'Sign in with your Nexa account when prompted, and approve the scopes it requests.',
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
  'settings.widgetCustomization.poweredByLabel': 'Show “Powered by Nexa”',
  'settings.widgetCustomization.poweredByHint':
    'A small credit in the widget footer. Turn it off to remove it.',
  'settings.widgetCustomization.entitlementError':
    'Removing the Nexa badge is an Enterprise feature. Upgrade the plan to hide it.',
  'settings.widgetCustomization.saveButton': 'Save appearance',
  'settings.widgetCustomization.resetButton': 'Reset',
  'settings.widgetCustomization.previewLabel': 'Preview',
  'settings.widgetCustomization.previewChatWithUs': 'Chat with us',
  'settings.widgetCustomization.previewGreeting': 'Hi! How can we help?',
  'settings.widgetCustomization.previewCustomerMessage': 'I have a question',
  'settings.widgetCustomization.previewPoweredBy': 'Powered by Nexa',
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
  'settings.ipAllowlist.entryLabel': 'Address or CIDR range',
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
  'settings.ipAllowlist.idleTimeoutSummary': 'Idle timeout: {value}',
  'settings.ipAllowlist.minutesValue.one': '{count} minute',
  'settings.ipAllowlist.minutesValue.other': '{count} minutes',
  'settings.ipAllowlist.maxSessionsLabel': 'Max concurrent sessions',
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

  // Blocked IP addresses — BannedCustomerIps.tsx
  'settings.bannedIps.title': 'Blocked IP addresses',
  'settings.bannedIps.description':
    'A visitor on one of these addresses is refused a chat, even from a fresh session. To ban a named contact instead, use the block action on their profile in Customers.',
  'settings.bannedIps.loadError': 'Could not load blocked addresses.',
  'settings.bannedIps.ipLabel': 'IP address',
  'settings.bannedIps.ipHint':
    'An IPv4 or IPv6 address. The visitor is blocked until you remove it here.',
  'settings.bannedIps.blockButton': 'Block address',
  'settings.bannedIps.empty.title': 'No blocked addresses',
  'settings.bannedIps.empty.description':
    'Add an IP address to refuse chats from it. Nothing is blocked until you do.',

  // Audit log door — AuditLog.tsx (the page itself is the `audit.*` namespace)
  'settings.auditLog.title': 'Audit log',
  'settings.auditLog.description':
    'Sign-ins, role changes, deletions and webhook changes — the last 30 days, kept for every plan.',
  'settings.auditLog.body': 'Review who did what across this workspace.',
  'settings.auditLog.openButton': 'Open audit log',

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
  'settings.routing.anything': 'Anything',
  'settings.routing.conditionSkill': 'skill {names}',

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
};
