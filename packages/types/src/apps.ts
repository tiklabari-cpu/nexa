/**
 * Apps marketplace — FR-MOD-09.1 / 09.2.
 *
 * A directory of third-party integrations a workspace can connect. Each card is
 * a catalogue entry: what it is, the permissions it asks for, and — once
 * connected through the (mocked) OAuth flow — the data it surfaces inside a
 * conversation (the Details pane / Copilot), which is what makes an integration
 * worth connecting at all (KK "Kart → izin/OAuth akışı; bağlanınca veri sohbet
 * içinde").
 *
 * The catalogue and the mock data generator live here, in the shared package,
 * so the marketplace grid, the API and the tests all agree on which apps exist
 * and what a connected app shows — one source of truth, no drift between the
 * card a user sees and the data the server returns.
 *
 * Everything here is a *mock* (MASTER-PROMPT §5): connecting an app performs no
 * real OAuth handshake and the surfaced data is a deterministic stub keyed off
 * the customer, never a live third-party call.
 *
 * 09.2 grows the v1 catalogue to the full directory (15–20 cards), each
 * connected by OAuth *or* an API key, and adds the channel-typed cross-link
 * (KK "Her biri OAuth/API key; kanal-tipli olanlar Channels'ta da yönetilir"):
 * some integrations — WhatsApp, Messenger, Instagram, … — are messaging
 * channels that are *also* set up in Settings → Channels. Those carry a
 * `channel` and are managed there, not connected through the marketplace OAuth
 * flow, so the two surfaces never fight over one connection's state.
 */
import type { ChannelType } from './domain.js';

/** How an app is connected. Both OAuth and API-key apps ship in the 09.2 list. */
export const APP_PROVIDERS = ['oauth', 'api_key'] as const;
export type AppProvider = (typeof APP_PROVIDERS)[number];

/** The section of the directory a card sits under. */
export const APP_CATEGORIES = [
  'crm',
  'support',
  'ecommerce',
  'payments',
  'marketing',
  'productivity',
  'analytics',
  'channels',
] as const;
export type AppCategory = (typeof APP_CATEGORIES)[number];

/**
 * One field an app surfaces about a customer in-chat. `options` is the closed
 * set the mock draws from — a real adapter would fetch the value, the stub
 * picks one deterministically from the customer's identity so the same customer
 * always shows the same thing.
 */
export interface AppDataField {
  label: string;
  options: readonly string[];
}

/** A marketplace card: the static description of an integration. */
export interface AppCatalogEntry {
  id: string;
  name: string;
  category: AppCategory;
  provider: AppProvider;
  /** Emoji shown on the card — kept simple, no asset pipeline for a mock. */
  icon: string;
  description: string;
  /** Permissions the app asks for, shown on the consent step of the flow. */
  scopes: readonly string[];
  /**
   * Set when this integration is a messaging channel that is *also* managed in
   * Settings → Channels (KK "kanal-tipli olanlar Channels'ta da yönetilir"). A
   * channel-typed app is connected there, not through the marketplace OAuth
   * flow, so it surfaces no in-chat data here — `dataLabel`/`dataFields` are
   * absent. Every other (data) app has them.
   */
  channel?: ChannelType;
  /** Header the connected app's data sits under, in-chat. Data apps only. */
  dataLabel?: string;
  /** The fields that data is made of. Data apps only. */
  dataFields?: readonly AppDataField[];
}

/**
 * The marketplace directory. 09.1 shipped the first five (one representative data
 * app per section) so the grid and the OAuth flow were real end to end; 09.2
 * grows it to the full 15–20-card list, a mix of OAuth and API-key providers,
 * and adds the channel-typed cards (`channel` set) that are also managed in
 * Settings → Channels. Data apps carry `dataLabel`/`dataFields` (what they show
 * in-chat); channel apps do not (they carry no marketplace connection at all).
 */
export const APP_CATALOG: readonly AppCatalogEntry[] = [
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'crm',
    provider: 'oauth',
    icon: '🧡',
    description: 'See a contact’s lifecycle stage and open deals while you chat.',
    scopes: ['contacts.read', 'deals.read'],
    dataLabel: 'HubSpot CRM',
    dataFields: [
      { label: 'Lifecycle stage', options: ['Lead', 'Marketing qualified', 'Sales qualified', 'Customer'] },
      { label: 'Open deals', options: ['0', '1', '2', '3'] },
      { label: 'Owner', options: ['Alex Rivera', 'Sam Okafor', 'Jordan Lee'] },
    ],
  },
  {
    id: 'shopify',
    name: 'Shopify',
    category: 'ecommerce',
    provider: 'oauth',
    icon: '🛍️',
    description: 'Pull a customer’s orders and lifetime value into the conversation.',
    scopes: ['orders.read', 'customers.read'],
    dataLabel: 'Shopify orders',
    dataFields: [
      { label: 'Orders', options: ['0', '1', '3', '7'] },
      { label: 'Lifetime value', options: ['$0', '$120', '$540', '$1,020'] },
      { label: 'Last order', options: ['—', '2 days ago', '3 weeks ago', '5 months ago'] },
    ],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'payments',
    provider: 'oauth',
    icon: '💳',
    description: 'Show a customer’s subscription status and MRR next to the chat.',
    scopes: ['charges.read', 'customers.read'],
    dataLabel: 'Stripe billing',
    dataFields: [
      { label: 'Status', options: ['No customer', 'Active', 'Past due', 'Canceled'] },
      { label: 'MRR', options: ['$0', '$29', '$99', '$249'] },
    ],
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    category: 'marketing',
    provider: 'oauth',
    icon: '📮',
    description: 'Know whether a contact is subscribed and how they engage.',
    scopes: ['audience.read'],
    dataLabel: 'Mailchimp audience',
    dataFields: [
      { label: 'Subscribed', options: ['Yes', 'No'] },
      { label: 'Campaigns opened', options: ['0', '2', '5', '12'] },
    ],
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    category: 'productivity',
    provider: 'oauth',
    icon: '📅',
    description: 'Surface the next scheduled meeting with this customer.',
    scopes: ['calendar.events.read'],
    dataLabel: 'Google Calendar',
    dataFields: [
      { label: 'Next meeting', options: ['None scheduled', 'Tomorrow 10:00', 'Friday 15:00', 'Mon 09:30'] },
    ],
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    category: 'crm',
    provider: 'oauth',
    icon: '☁️',
    description: 'See the account type and open opportunities for a contact.',
    scopes: ['api', 'refresh_token'],
    dataLabel: 'Salesforce',
    dataFields: [
      { label: 'Account type', options: ['Prospect', 'Customer', 'Partner'] },
      { label: 'Open opportunities', options: ['0', '1', '2', '4'] },
      { label: 'Owner', options: ['Alex Rivera', 'Sam Okafor', 'Jordan Lee'] },
    ],
  },
  {
    id: 'intercom',
    name: 'Intercom',
    category: 'support',
    provider: 'api_key',
    icon: '💠',
    description: 'Bring a contact’s open conversations and lifecycle segment in.',
    scopes: ['read_conversations', 'read_contacts'],
    dataLabel: 'Intercom',
    dataFields: [
      { label: 'Open conversations', options: ['0', '1', '3'] },
      { label: 'Segment', options: ['New', 'Active', 'Power user', 'At risk'] },
      { label: 'Last seen', options: ['Today', 'This week', 'This month', '3 months ago'] },
    ],
  },
  {
    id: 'zendesk',
    name: 'Zendesk',
    category: 'support',
    provider: 'api_key',
    icon: '🎫',
    description: 'Show the customer’s open tickets and satisfaction next to the chat.',
    scopes: ['tickets.read', 'users.read'],
    dataLabel: 'Zendesk',
    dataFields: [
      { label: 'Open tickets', options: ['0', '1', '2', '5'] },
      { label: 'Satisfaction', options: ['—', 'Good', 'Bad'] },
      { label: 'Plan', options: ['Free', 'Team', 'Growth'] },
    ],
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    category: 'ecommerce',
    provider: 'api_key',
    icon: '🛒',
    description: 'Pull a WooCommerce customer’s orders and spend into the conversation.',
    scopes: ['read_orders', 'read_customers'],
    dataLabel: 'WooCommerce',
    dataFields: [
      { label: 'Orders', options: ['0', '1', '3', '8'] },
      { label: 'Lifetime value', options: ['$0', '$95', '$430', '$1,240'] },
      { label: 'Last order', options: ['—', '4 days ago', '2 weeks ago', '6 months ago'] },
    ],
  },
  {
    id: 'magento',
    name: 'Magento',
    category: 'ecommerce',
    provider: 'api_key',
    icon: '🧱',
    description: 'See a Magento shopper’s orders and customer group.',
    scopes: ['orders.read', 'customers.read'],
    dataLabel: 'Magento',
    dataFields: [
      { label: 'Orders', options: ['0', '2', '6'] },
      { label: 'Customer group', options: ['Guest', 'General', 'Wholesale', 'VIP'] },
    ],
  },
  {
    id: 'paypal',
    name: 'PayPal',
    category: 'payments',
    provider: 'oauth',
    icon: '🅿️',
    description: 'Show a customer’s PayPal account status and open disputes.',
    scopes: ['transactions.read', 'disputes.read'],
    dataLabel: 'PayPal',
    dataFields: [
      { label: 'Status', options: ['No account', 'Verified', 'Limited'] },
      { label: 'Open disputes', options: ['0', '1', '2'] },
    ],
  },
  {
    id: 'klaviyo',
    name: 'Klaviyo',
    category: 'marketing',
    provider: 'api_key',
    icon: '✳️',
    description: 'Know whether a contact is subscribed and how they buy.',
    scopes: ['profiles.read', 'events.read'],
    dataLabel: 'Klaviyo',
    dataFields: [
      { label: 'Subscribed', options: ['Yes', 'No'] },
      { label: 'Orders placed', options: ['0', '1', '4', '9'] },
      { label: 'Segment', options: ['New', 'Engaged', 'VIP', 'Lapsed'] },
    ],
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'productivity',
    provider: 'oauth',
    icon: '💬',
    description: 'Surface a shared Slack Connect channel with this customer.',
    scopes: ['channels.read', 'chat.write'],
    dataLabel: 'Slack',
    dataFields: [
      { label: 'Shared channel', options: ['None', '#support', '#vip-customers'] },
      { label: 'Last message', options: ['—', 'Today', 'Yesterday', 'Last week'] },
    ],
  },
  {
    id: 'jira',
    name: 'Jira',
    category: 'productivity',
    provider: 'oauth',
    icon: '🧩',
    description: 'Link the customer’s open Jira issues to the conversation.',
    scopes: ['read:jira-work'],
    dataLabel: 'Jira',
    dataFields: [
      { label: 'Open issues', options: ['0', '1', '2', '4'] },
      { label: 'Highest priority', options: ['—', 'Low', 'Medium', 'High'] },
    ],
  },
  {
    id: 'segment',
    name: 'Segment',
    category: 'analytics',
    provider: 'api_key',
    icon: '📈',
    description: 'See the customer’s recent product activity from your Segment stream.',
    scopes: ['profiles.read'],
    dataLabel: 'Segment',
    dataFields: [
      { label: 'Sessions (30d)', options: ['0', '3', '11', '28'] },
      { label: 'Top event', options: ['—', 'Viewed pricing', 'Started trial', 'Upgraded'] },
    ],
  },
  // --- Channel-typed apps: also managed in Settings → Channels (KK 09.2) ------
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    category: 'channels',
    provider: 'oauth',
    icon: '📱',
    description: 'Answer WhatsApp messages. Connected in Settings → Channels.',
    scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
    channel: 'whatsapp',
  },
  {
    id: 'messenger',
    name: 'Facebook Messenger',
    category: 'channels',
    provider: 'oauth',
    icon: '📨',
    description: 'Answer Messenger conversations. Connected in Settings → Channels.',
    scopes: ['pages_messaging', 'pages_manage_metadata'],
    channel: 'messenger',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    category: 'channels',
    provider: 'oauth',
    icon: '📷',
    description: 'Answer Instagram direct messages. Connected in Settings → Channels.',
    scopes: ['instagram_manage_messages', 'pages_manage_metadata'],
    channel: 'instagram',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    category: 'channels',
    provider: 'api_key',
    icon: '✈️',
    description: 'Answer Telegram chats through a bot. Connected in Settings → Channels.',
    scopes: ['bot.messages'],
    channel: 'telegram',
  },
  {
    id: 'twilio-sms',
    name: 'SMS (Twilio)',
    category: 'channels',
    provider: 'api_key',
    icon: '📟',
    description: 'Reply to text messages over Twilio. Connected in Settings → Channels.',
    scopes: ['sms.read', 'sms.send'],
    channel: 'twilio',
  },
] as const;

/** The catalogue entry for an id, or undefined if it names no app. */
export function findApp(id: string): AppCatalogEntry | undefined {
  return APP_CATALOG.find((entry) => entry.id === id);
}

/** True when `id` names a real marketplace app. */
export function isAppId(id: unknown): id is string {
  return typeof id === 'string' && APP_CATALOG.some((entry) => entry.id === id);
}

/**
 * True when an app is a messaging channel managed in Settings → Channels
 * (KK 09.2 "kanal-tipli olanlar Channels'ta da yönetilir"). A channel-typed app
 * is not connected through the marketplace OAuth flow — it points to Channels.
 */
export function isChannelApp(entry: AppCatalogEntry): entry is AppCatalogEntry & { channel: ChannelType } {
  return entry.channel !== undefined;
}

/** The channel-typed apps — the marketplace ⋈ Channels cross-link (09.2). */
export function channelApps(): AppCatalogEntry[] {
  return APP_CATALOG.filter(isChannelApp);
}

/** The data apps — connected in the marketplace and surfacing in-chat data. */
export function connectableApps(): AppCatalogEntry[] {
  return APP_CATALOG.filter((entry) => !isChannelApp(entry));
}

/** A connected integration, as stored for a workspace. */
export interface AppInstallation {
  app_id: string;
  status: 'connected';
  /** The account label the (mock) OAuth grant returned. */
  external_account: string;
  /** Permissions granted — the app's requested scopes, all granted by the mock. */
  scopes: string[];
  connected_at: string;
}

/** A marketplace card joined with whether this workspace has connected it. */
export interface AppListItem {
  id: string;
  name: string;
  category: AppCategory;
  provider: AppProvider;
  icon: string;
  description: string;
  scopes: string[];
  /**
   * The channel this app is managed as in Settings → Channels, or null for a
   * data app connected here. When set, the card links to Channels rather than
   * offering a Connect button (KK 09.2).
   */
  channel: ChannelType | null;
  installed: boolean;
  installation: AppInstallation | null;
}

/** What starting the (mock) OAuth flow hands back — where to send the user. */
export interface AppOAuthStart {
  authorize_url: string;
  state: string;
}

/** A connected app's data for one customer, ready to render in-chat. */
export interface AppChatData {
  app_id: string;
  app_name: string;
  icon: string;
  data_label: string;
  fields: Array<{ label: string; value: string }>;
}

/**
 * A stable 32-bit hash (FNV-1a) of a string. Used to pick mock field values so
 * the same customer always sees the same data — a deterministic stand-in for a
 * real fetch, and the property the tests pin.
 */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in the unsigned range.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The data a connected app shows for a customer. Deterministic in `seed` (the
 * customer's identity): each field's value is chosen from its `options` by
 * hashing the seed with the field label, so different fields vary independently
 * yet the whole set is stable for a given customer.
 */
export function appChatData(entry: AppCatalogEntry, seed: string): AppChatData {
  // Channel apps carry no in-chat data (they are never connected here), so a
  // missing set is an empty one rather than an error.
  const fields = entry.dataFields ?? [];
  return {
    app_id: entry.id,
    app_name: entry.name,
    icon: entry.icon,
    data_label: entry.dataLabel ?? entry.name,
    fields: fields.map((field) => ({
      label: field.label,
      value: field.options[hash32(`${seed}:${field.label}`) % field.options.length] ?? '—',
    })),
  };
}
