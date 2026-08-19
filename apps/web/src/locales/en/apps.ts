import type { Messages } from '../merge.js';

/**
 * Apps marketplace + Developer portal (I18N-k, tm 133.11).
 *
 * `APP_CATALOG` (`packages/types/src/apps.ts`, 102 cards) is DATA, not chrome — a
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
  'apps.marketplace.filterByCategory': 'Filter by category',
  'apps.marketplace.category.all': 'All',
  'apps.marketplace.category.crm': 'CRM',
  'apps.marketplace.category.support': 'Support',
  'apps.marketplace.category.ecommerce': 'E-commerce',
  'apps.marketplace.category.payments': 'Payments',
  'apps.marketplace.category.marketing': 'Marketing',
  'apps.marketplace.category.productivity': 'Productivity',
  'apps.marketplace.category.analytics': 'Analytics',
  'apps.marketplace.category.channels': 'Channels',
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

  // ConsentDialog — the OAuth permission step
  'apps.marketplace.consent.title': 'Connect {name}',
  'apps.marketplace.consent.description': 'This app is asking for the following permissions:',
  'apps.marketplace.consent.error': 'Could not connect the app. Try again.',
  'apps.marketplace.consent.authorize': 'Authorize',
  'apps.marketplace.consent.connecting': 'Connecting…',

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
    "Register an OAuth client to let a script, a Zap, or a service you build call the Nexa API on this workspace's behalf.",

  // AppRow
  'apps.developers.clientType.confidential': 'Confidential',
  'apps.developers.clientType.public': 'Public',
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
  'apps.developers.form.register': 'Register',
  'apps.developers.form.registering': 'Registering…',

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

  // SubscribeForm
  'apps.developers.webhooks.form.urlLabel': 'URL',
  'apps.developers.webhooks.form.urlRequired': 'Enter the URL to receive the webhook.',
  'apps.developers.webhooks.form.eventLabel': 'Event',
  'apps.developers.webhooks.form.eventRequired': 'Choose an event.',
  'apps.developers.webhooks.form.loadingEvents': 'Loading events…',
  'apps.developers.webhooks.form.selectEvent': 'Select an event…',
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
