import type { Messages } from '../merge.js';

/**
 * Apps marketplace + Developer portal (I18N-k, tm 133.11).
 *
 * `APP_CATALOG` (`packages/types/src/apps.ts`, 103 cards) is DATA, not chrome — a
 * card's `name`/`description` comes from the server response and is never run
 * through `t()`, the same call `channelsFor()` (I18N-c) and ticket status/priority
 * (I18N-f) made for other server-shaped catalogues. Only the screen furniture
 * around it (search, filters, category chips, the OAuth consent step, the
 * developer portal's forms/tabs/secret panels) is translated here.
 */
export const apps: Messages = {
  // Shared across this namespace's modals — AppsMarketplace's consent dialog,
  // DeveloperPortal's register/delete/rotate modals, both secret-once panels.
  'apps.common.cancel': 'Cancel',
  'apps.common.done': 'Done',
  'apps.common.copy': 'Copy',
  'apps.common.copied': 'Copied',
  'apps.common.loading': 'Loading…',
  'apps.common.deleting': 'Deleting…',

  // Routed page shell — AppsMarketplacePage
  'apps.marketplace.page.title': 'Apps',
  'apps.marketplace.page.description': 'Third-party integrations for your workspace.',

  // AppsMarketplace
  'apps.marketplace.title': 'Marketplace',
  'apps.marketplace.description':
    'Connect the tools your team already uses. Connected apps show their data right inside a conversation.',
  'apps.marketplace.searchLabel': 'Search apps',
  'apps.marketplace.searchPlaceholder': 'Search apps…',
  // Visible names of the four chip rows (UX audit D20); each is also its group's accessible name.
  'apps.marketplace.filterLabel.category': 'Category',
  'apps.marketplace.filterLabel.collection': 'Collection',
  'apps.marketplace.filterLabel.pricing': 'Pricing',
  'apps.marketplace.filterLabel.placement': 'Placement',
  'apps.marketplace.category.all': 'All',
  'apps.marketplace.category.crm': 'CRM',
  'apps.marketplace.category.support': 'Support',
  'apps.marketplace.category.ecommerce': 'E-commerce',
  'apps.marketplace.category.payments': 'Payments',
  'apps.marketplace.category.marketing': 'Marketing',
  'apps.marketplace.category.productivity': 'Productivity',
  'apps.marketplace.category.analytics': 'Analytics',
  'apps.marketplace.category.channels': 'Channels',
  'apps.marketplace.collection.all': 'All',
  'apps.marketplace.collection.byText': 'By Text',
  'apps.marketplace.collection.aiPowered': 'AI-Powered',
  'apps.marketplace.collection.new': 'New',
  'apps.marketplace.collection.staffPicks': 'Staff Picks',
  'apps.marketplace.pricing.all': 'All',
  'apps.marketplace.pricing.free': 'Free',
  'apps.marketplace.pricing.paid': 'Paid',
  'apps.marketplace.placement.all': 'All',
  'apps.marketplace.placement.details': 'Details panel',
  'apps.marketplace.placement.fullscreen': 'Fullscreen',
  'apps.marketplace.placement.messagebox': 'Messagebox',
  'apps.marketplace.loadError': 'Could not load the apps marketplace.',
  'apps.marketplace.empty.noneTitle': 'No apps yet',
  'apps.marketplace.empty.noneDescription':
    'Connect the tools your team already uses from the marketplace.',
  'apps.marketplace.empty.noMatchTitle': 'No apps match',
  'apps.marketplace.empty.noMatchDescription': 'Try a shorter search, or a different category.',
  'apps.marketplace.listLabel': 'Apps',
  'apps.marketplace.loadMore': 'Load more',
  'apps.marketplace.loadingMore': 'Loading…',

  // AppCard (channel + data variants)
  'apps.marketplace.card.connected': 'Connected',
  'apps.marketplace.card.notConnected': 'Not connected',
  'apps.marketplace.card.inChannels': 'In Channels',
  'apps.marketplace.card.manageInChannels': 'Manage in Channels',
  'apps.marketplace.card.connect': 'Connect',
  'apps.marketplace.card.disconnect': 'Disconnect',
  'apps.marketplace.card.disconnecting': 'Disconnecting…',
  // The automation cards' two live figures (FR-MOD-09.4). Read from the
  // workspace's own webhook registry, so the sentence is chrome and the
  // numbers in it are not.
  'apps.marketplace.card.automation': '{triggers} trigger(s) · last run {lastRun}',
  'apps.marketplace.card.automationNeverRun': 'never',

  // ConsentDialog — the OAuth permission step
  'apps.marketplace.consent.title': 'Connect {name}',
  'apps.marketplace.consent.description': 'This app is asking for the following permissions:',
  'apps.marketplace.consent.error': 'Could not connect the app. Try again.',
  'apps.marketplace.consent.authorize': 'Authorize',
  'apps.marketplace.consent.connecting': 'Connecting…',

  // ApiKeyDialog — the `provider: api_key` step (09.2). No permission list:
  // nothing is granted here, a key the provider already issued is handed over.
  'apps.marketplace.apiKey.title': 'Connect {name}',
  'apps.marketplace.apiKey.description': 'This app connects with an API key.',
  'apps.marketplace.apiKey.label': 'API key',
  'apps.marketplace.apiKey.hint':
    'Only the last four characters are stored in a readable form. Paste the key from the provider.',
  'apps.marketplace.apiKey.requiredError': 'Enter the API key.',
  'apps.marketplace.apiKey.tooShortError': 'Enter at least {min} characters.',
  'apps.marketplace.apiKey.tooLongError': 'Enter at most {max} characters.',
  'apps.marketplace.apiKey.error': 'Could not connect the app. Check the key and try again.',
  'apps.marketplace.apiKey.submit': 'Connect app',

  // Live connections (tm 263): a card this deployment connects to its real
  // provider, told apart from the demo ones everywhere it appears.
  'apps.live.badge.live': 'Live',
  'apps.live.badge.liveTitle':
    'Connects to {name} itself: the key is checked with {name} and stored encrypted.',
  'apps.live.badge.demo': 'Demo',
  'apps.live.badge.demoTitle':
    'Demo connection: nothing is sent to {name}, and what chats show is sample data.',
  'apps.live.status.needsReconnect': 'Reconnect needed',
  'apps.live.card.reconnect': 'Reconnect',
  'apps.live.dialog.description':
    'The key is checked with {name} before it is saved, then stored encrypted. It is never shown again.',
  'apps.live.subdomain.label': 'Account subdomain',
  'apps.live.subdomain.hint': 'The part before .freshdesk.com: for acme.freshdesk.com, enter acme.',
  'apps.live.subdomain.requiredError': 'Enter the account subdomain.',
  'apps.live.subdomain.invalidError':
    'Enter one word of letters, digits and hyphens, such as acme.',
  'apps.live.error.invalidKey': '{name} did not accept this key.',
  'apps.live.error.notFound': '{name} has no account at that address. Check the subdomain.',
  'apps.live.error.unavailable': '{name} could not be reached. Try again in a moment.',
  'apps.live.error.webhookUnreachable':
    'Telegram cannot reach this server: it needs a public https address. Ask your administrator to set one.',
  'apps.live.error.providerSaid': '{name} said: “{message}”',

  // DeveloperPortalPage shell — title/description shown both gated and open
  'apps.developers.page.title': 'Developers',
  'apps.developers.page.description':
    'Register OAuth apps that can act on this workspace through the API.',
  'apps.developers.notAvailable.title': 'Developer portal not available',
  'apps.developers.notAvailable.description':
    "Registering apps is limited to owners and admins with write access to this workspace's access rules.",
  'apps.developers.registerApp': 'Register app',

  // Tabs
  'apps.developers.tablistLabel': 'Developer portal',
  'apps.developers.tabs.apps': 'Apps',
  'apps.developers.tabs.webhooks': 'Webhooks',
  'apps.developers.tabs.manifest': 'Manifest',

  // Partner apps list
  'apps.developers.partnerApps.title': 'Partner apps',
  'apps.developers.partnerApps.description':
    'Apps your team has registered, and what each one may do on this workspace.',
  'apps.developers.partnerApps.loadError': 'Could not load your partner apps.',
  'apps.developers.partnerApps.emptyTitle': 'No partner apps yet',
  'apps.developers.partnerApps.emptyDescription':
    "Register an OAuth client to let a script, a Zap, or a service you build call the SiyahTuş API on this workspace's behalf.",

  // AppRow
  'apps.developers.clientType.confidential': 'Confidential',
  'apps.developers.clientType.public': 'Public',
  'apps.developers.builtIn': 'Built in',
  'apps.developers.builtInHint': "The panel's own sign-in app; it can't be changed.",
  'apps.developers.edit': 'Edit',
  'apps.developers.editFor': 'Edit {name}',
  'apps.developers.rotateSecretFor': 'Rotate secret for {name}',
  'apps.developers.rotateSecret': 'Rotate secret',
  'apps.developers.deleteFor': 'Delete {name}',
  'apps.developers.delete': 'Delete',
  'apps.developers.redirectUriCount.one': '{count} redirect URI',
  'apps.developers.redirectUriCount.other': '{count} redirect URIs',
  'apps.developers.scopeCount.one': '{count} scope',
  'apps.developers.scopeCount.other': '{count} scopes',

  // RegisterAppModal
  'apps.developers.registerModal.title': 'Register app',
  'apps.developers.registerModal.description':
    'Register an OAuth client that can act on this workspace through the API.',
  'apps.developers.form.redirectUrisRequired': 'Enter at least one redirect URI, one per line.',
  'apps.developers.form.appName': 'App name',
  'apps.developers.form.appNamePlaceholder': 'Acme Zap Connector',
  'apps.developers.form.nameRequired': 'Enter a name for this app.',
  'apps.developers.form.clientType': 'Client type',
  'apps.developers.form.clientTypePublic': 'Public (PKCE, no secret)',
  'apps.developers.form.clientTypeConfidential': 'Confidential (issues a secret)',
  'apps.developers.form.redirectUris': 'Redirect URIs',
  'apps.developers.form.oneUriPerLine': 'One URI per line.',
  'apps.developers.form.scopes': 'Scopes',
  'apps.developers.form.scopesHint':
    'Only scopes your own session already holds can be granted to the app.',
  'apps.developers.form.selectScope': 'Select at least one scope.',
  // A refusal's stable `details.reason`, worded here (tm 261). `{uri}` is the value
  // the server rejected, so the sentence still says which one.
  'apps.developers.reason.redirect_uri_too_long':
    'The redirect URI “{uri}” is longer than {max} characters.',
  'apps.developers.reason.redirect_uri_not_absolute':
    'The redirect URI “{uri}” is not an absolute URI — start it with https://.',
  'apps.developers.reason.redirect_uri_fragment':
    'The redirect URI “{uri}” contains a fragment (#…), which a redirect URI cannot have.',
  'apps.developers.reason.redirect_uri_path_traversal':
    'The redirect URI “{uri}” contains a path traversal segment (..).',
  'apps.developers.reason.redirect_uri_wildcard':
    'The redirect URI “{uri}” contains a wildcard; redirect URIs are matched exactly.',
  'apps.developers.reason.redirect_uri_credentials':
    'The redirect URI “{uri}” embeds a username or password.',
  'apps.developers.reason.redirect_uri_no_host': 'The redirect URI “{uri}” has no host.',
  'apps.developers.reason.redirect_uri_scheme':
    'The redirect URI “{uri}” must use https (http is allowed only on localhost, for development).',
  'apps.developers.reason.redirect_uri_not_canonical':
    'The redirect URI “{uri}” is not in canonical form and would never match; register “{canonical}” instead.',
  'apps.developers.reason.redirect_uris_required': 'Add at least one redirect URI.',
  'apps.developers.reason.redirect_uris_too_many': 'An app can have at most {max} redirect URIs.',
  'apps.developers.reason.redirect_uris_duplicate':
    'The same redirect URI is listed more than once.',
  'apps.developers.reason.scopes_required': 'Select at least one scope.',
  'apps.developers.reason.scopes_not_held':
    'You cannot grant scopes your own session does not hold: {scopes}.',
  'apps.developers.form.register': 'Register',
  'apps.developers.form.registering': 'Registering…',
  'apps.developers.form.save': 'Save',
  'apps.developers.form.saving': 'Saving…',

  // EditAppModal (tm 215 TRACKED · tm 245) — name and redirect URIs only;
  // client_type and scopes are not editable here, see the component's header.
  'apps.developers.editModal.title': 'Edit {name}',
  'apps.developers.editModal.description':
    'Rename this app or update its redirect URIs. Client type and scopes are unchanged.',

  // SecretOncePanel — register + rotate both feed this
  'apps.developers.secret.registeredTitle': '{name} registered',
  'apps.developers.secret.rotatedTitle': '{name} secret rotated',
  'apps.developers.secret.description': 'Save these credentials now.',
  'apps.developers.secret.clientId': 'Client ID',
  'apps.developers.secret.clientSecret': 'Client secret',
  'apps.developers.secret.warning': 'This secret will not be shown again — store it now.',

  // DeleteAppModal
  'apps.developers.deleteModal.title': 'Delete {name}?',
  'apps.developers.deleteModal.description':
    'Any live tokens this app holds stop working immediately. This cannot be undone.',
  'apps.developers.deleteModal.confirm': 'Delete app',

  // RotateSecretModal
  'apps.developers.rotateModal.title': 'Rotate secret for {name}?',
  'apps.developers.rotateModal.description':
    'The current secret stops working immediately. Update every integration that uses it with the new one.',
  'apps.developers.rotateModal.rotating': 'Rotating…',

  // WebhookSubscriptions
  'apps.developers.webhooks.title': 'Webhooks',
  'apps.developers.webhooks.description':
    'Subscribe a URL to be POSTed when something happens here — the same REST Hooks model Zapier and Make use.',
  'apps.developers.webhooks.loadError': 'Could not load your webhooks.',
  'apps.developers.webhooks.emptyTitle': 'No webhook subscriptions yet',
  'apps.developers.webhooks.emptyDescription':
    'Subscribe a URL to be notified the moment a chat starts, a message comes in, or a ticket opens.',
  'apps.developers.webhooks.enabled': 'Enabled',
  'apps.developers.webhooks.disabled': 'Disabled',
  'apps.developers.webhooks.deleteFor': 'Delete webhook for {url}',
  'apps.developers.webhooks.botScoped': 'Bot-scoped',
  'apps.developers.webhooks.workspaceWide': 'Workspace-wide',
  'apps.developers.webhooks.viaApp': 'via {app}',

  // SubscribeForm
  'apps.developers.webhooks.form.urlLabel': 'URL',
  'apps.developers.webhooks.form.urlRequired': 'Enter the URL to receive the webhook.',
  'apps.developers.webhooks.form.eventLabel': 'Event',
  'apps.developers.webhooks.form.eventRequired': 'Choose an event.',
  'apps.developers.webhooks.reason.url_invalid':
    'Enter a valid URL, like https://example.com/hook.',
  'apps.developers.webhooks.reason.url_scheme': 'Only http and https addresses can be called.',
  'apps.developers.webhooks.reason.url_credentials':
    'Remove the username and password from the URL.',
  'apps.developers.webhooks.reason.url_private_host':
    'That address points at a private or internal host and cannot be called.',
  'apps.developers.webhooks.reason.app_not_automation':
    'Only an automation app (Zapier, Make) can own a webhook.',
  'apps.developers.webhooks.reason.app_not_connected':
    'Connect {app_name} in the app marketplace first.',
  'apps.developers.webhooks.form.loadingEvents': 'Loading events…',
  'apps.developers.webhooks.form.selectEvent': 'Select an event…',
  'apps.developers.webhooks.form.appLabel': 'Automation app',
  'apps.developers.webhooks.form.appNone': 'None',
  'apps.developers.webhooks.form.subscribe': 'Subscribe',
  'apps.developers.webhooks.form.subscribing': 'Subscribing…',

  // WebhookSecretPanel
  'apps.developers.webhooks.secret.title': 'Webhook subscribed',
  'apps.developers.webhooks.secret.description': 'Save this signing secret now.',
  'apps.developers.webhooks.secret.url': 'URL',
  'apps.developers.webhooks.secret.signingSecret': 'Signing secret',
  'apps.developers.webhooks.secret.warning':
    'This secret will not be shown again — every delivery is signed with it.',

  // DeleteWebhookModal
  'apps.developers.webhooks.deleteModal.title': 'Delete webhook for {url}?',
  'apps.developers.webhooks.deleteModal.description':
    'Deliveries to this URL stop immediately. This cannot be undone.',
  'apps.developers.webhooks.deleteModal.confirm': 'Delete webhook',

  // IntegrationManifestReference
  'apps.developers.manifest.loadError': 'Could not load the integration manifest.',
  'apps.developers.manifest.triggersTitle': 'Triggers',
  'apps.developers.manifest.triggersDescription':
    'Workspace events a Zapier/Make trigger can subscribe to — one per webhook action.',
  'apps.developers.manifest.actionsTitle': 'Actions',
  'apps.developers.manifest.actionsDescription':
    'Existing write endpoints a Zapier/Make action step may call — no new endpoint or scope.',
  'apps.developers.manifest.requires': 'Requires: {scopes}',
  'apps.developers.manifest.orJoiner': ' or ',
  'apps.developers.manifest.subscribeTitle': 'Subscribe / unsubscribe',
  'apps.developers.manifest.subscribeDescription':
    'Where a REST Hooks integration registers and removes a subscription.',
};
