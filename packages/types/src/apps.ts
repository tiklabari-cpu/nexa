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
 * grew it to a 15–20-card list, a mix of OAuth and API-key providers, and added
 * the channel-typed cards (`channel` set) that are also managed in Settings →
 * Channels. 09.4 added two automation-platform cards (Zapier, Make). 09.2-v2-d
 * grew the mock catalogue to 60+ cards, and 09.2-v2-e grew it again to 100+ —
 * still spread across the same 8 categories, with no upper bound on its size,
 * only a floor the tests pin. Data apps carry `dataLabel`/`dataFields` (what
 * they show in-chat); channel apps do not (they carry no marketplace
 * connection at all).
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
      {
        label: 'Lifecycle stage',
        options: ['Lead', 'Marketing qualified', 'Sales qualified', 'Customer'],
      },
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
      {
        label: 'Next meeting',
        options: ['None scheduled', 'Tomorrow 10:00', 'Friday 15:00', 'Mon 09:30'],
      },
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
    id: 'zapier',
    name: 'Zapier',
    category: 'productivity',
    provider: 'oauth',
    icon: '⚡',
    description:
      'Trigger zaps from workspace events — register a Zapier app through the Nexa partner portal.',
    scopes: ['zaps.trigger', 'zaps.read'],
    dataLabel: 'Zapier',
    dataFields: [
      { label: 'Active zaps', options: ['0', '1', '3', '7'] },
      { label: 'Last zap run', options: ['—', 'Today', 'Yesterday', 'Last week'] },
    ],
  },
  {
    id: 'make',
    name: 'Make',
    category: 'productivity',
    provider: 'api_key',
    icon: '🔗',
    description:
      'Run Make scenarios against this workspace — register a Make app through the Nexa partner portal.',
    scopes: ['scenarios.trigger', 'scenarios.read'],
    dataLabel: 'Make',
    dataFields: [
      { label: 'Active scenarios', options: ['0', '2', '5', '9'] },
      { label: 'Last run', options: ['—', 'Success', 'Failed', 'Never run'] },
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
  // --- 09.2-v2-d: 40 more data apps, spread across the 7 non-channel sections ---
  {
    id: 'pipedrive',
    name: 'Pipedrive',
    category: 'crm',
    provider: 'oauth',
    icon: '🧲',
    description: 'See a contact’s deal stage and pipeline value while you chat.',
    scopes: ['deals.read', 'contacts.read'],
    dataLabel: 'Pipedrive',
    dataFields: [
      { label: 'Deal stage', options: ['Lead in', 'Contact made', 'Proposal made', 'Won'] },
      { label: 'Pipeline value', options: ['$0', '$1,200', '$4,500', '$12,000'] },
    ],
  },
  {
    id: 'zoho-crm',
    name: 'Zoho CRM',
    category: 'crm',
    provider: 'oauth',
    icon: '📇',
    description: 'Show a lead’s status and assigned owner from Zoho CRM.',
    scopes: ['leads.read'],
    dataLabel: 'Zoho CRM',
    dataFields: [
      { label: 'Lead status', options: ['New', 'Contacted', 'Qualified', 'Converted'] },
      { label: 'Owner', options: ['Alex Rivera', 'Sam Okafor', 'Jordan Lee'] },
    ],
  },
  {
    id: 'freshsales',
    name: 'Freshsales',
    category: 'crm',
    provider: 'api_key',
    icon: '🌱',
    description: 'Pull a contact’s deal count and funnel stage from Freshsales.',
    scopes: ['contacts.read', 'deals.read'],
    dataLabel: 'Freshsales',
    dataFields: [
      { label: 'Funnel stage', options: ['Lead', 'Qualified', 'Customer'] },
      { label: 'Open deals', options: ['0', '1', '3'] },
    ],
  },
  {
    id: 'copper',
    name: 'Copper',
    category: 'crm',
    provider: 'oauth',
    icon: '🥉',
    description: 'See a contact’s pipeline and last activity from Copper CRM.',
    scopes: ['contacts.read', 'opportunities.read'],
    dataLabel: 'Copper',
    dataFields: [
      { label: 'Pipeline', options: ['Sales pipeline', 'Referral pipeline'] },
      { label: 'Last activity', options: ['Today', 'This week', 'Last month'] },
    ],
  },
  {
    id: 'close-crm',
    name: 'Close',
    category: 'crm',
    provider: 'api_key',
    icon: '✅',
    description: 'Show a lead’s status and next scheduled task from Close.',
    scopes: ['lead.read', 'task.read'],
    dataLabel: 'Close',
    dataFields: [
      { label: 'Lead status', options: ['Potential', 'Qualified', 'Active', 'Won'] },
      { label: 'Next task', options: ['None', 'Follow-up call', 'Send proposal'] },
    ],
  },
  {
    id: 'insightly',
    name: 'Insightly',
    category: 'crm',
    provider: 'api_key',
    icon: '🔎',
    description: 'Bring a contact’s project and opportunity count from Insightly.',
    scopes: ['contacts.read', 'opportunities.read'],
    dataLabel: 'Insightly',
    dataFields: [
      { label: 'Open opportunities', options: ['0', '1', '2'] },
      { label: 'Projects', options: ['0', '1', '3'] },
    ],
  },
  {
    id: 'freshdesk',
    name: 'Freshdesk',
    category: 'support',
    provider: 'api_key',
    icon: '🍃',
    description: 'Show a customer’s open tickets and satisfaction rating from Freshdesk.',
    scopes: ['tickets.read', 'contacts.read'],
    dataLabel: 'Freshdesk',
    dataFields: [
      { label: 'Open tickets', options: ['0', '1', '2', '4'] },
      { label: 'CSAT', options: ['—', 'Happy', 'Neutral', 'Unhappy'] },
    ],
  },
  {
    id: 'helpscout',
    name: 'Help Scout',
    category: 'support',
    provider: 'oauth',
    icon: '🧭',
    description: 'See a customer’s conversation history and mailbox from Help Scout.',
    scopes: ['conversations.read'],
    dataLabel: 'Help Scout',
    dataFields: [
      { label: 'Open conversations', options: ['0', '1', '2'] },
      { label: 'Mailbox', options: ['Support', 'Billing', 'Sales'] },
    ],
  },
  {
    id: 'front',
    name: 'Front',
    category: 'support',
    provider: 'oauth',
    icon: '📥',
    description: 'Surface a shared inbox conversation with this customer from Front.',
    scopes: ['conversations.read'],
    dataLabel: 'Front',
    dataFields: [
      { label: 'Assigned to', options: ['Unassigned', 'Alex Rivera', 'Sam Okafor'] },
      { label: 'Status', options: ['Open', 'Snoozed', 'Archived'] },
    ],
  },
  {
    id: 'gorgias',
    name: 'Gorgias',
    category: 'support',
    provider: 'api_key',
    icon: '🏛️',
    description: 'Show a shopper’s support ticket history from Gorgias.',
    scopes: ['tickets.read'],
    dataLabel: 'Gorgias',
    dataFields: [
      { label: 'Open tickets', options: ['0', '1', '3'] },
      { label: 'Channel', options: ['Email', 'Chat', 'Social'] },
    ],
  },
  {
    id: 'kayako',
    name: 'Kayako',
    category: 'support',
    provider: 'api_key',
    icon: '🗂️',
    description: 'Bring a customer’s case history and status from Kayako.',
    scopes: ['cases.read'],
    dataLabel: 'Kayako',
    dataFields: [
      { label: 'Open cases', options: ['0', '1', '2'] },
      { label: 'Status', options: ['New', 'Open', 'Pending', 'Resolved'] },
    ],
  },
  {
    id: 'groove',
    name: 'Groove',
    category: 'support',
    provider: 'oauth',
    icon: '🎧',
    description: 'See a customer’s ticket status and assignee from Groove.',
    scopes: ['tickets.read'],
    dataLabel: 'Groove',
    dataFields: [
      { label: 'Ticket status', options: ['Unread', 'Opened', 'Pending', 'Closed'] },
      { label: 'Assignee', options: ['Unassigned', 'Alex Rivera', 'Jordan Lee'] },
    ],
  },
  {
    id: 'bigcommerce',
    name: 'BigCommerce',
    category: 'ecommerce',
    provider: 'oauth',
    icon: '🏬',
    description: 'Pull a shopper’s orders and total spend from BigCommerce.',
    scopes: ['orders.read', 'customers.read'],
    dataLabel: 'BigCommerce',
    dataFields: [
      { label: 'Orders', options: ['0', '1', '4', '9'] },
      { label: 'Total spend', options: ['$0', '$85', '$310', '$960'] },
    ],
  },
  {
    id: 'squarespace-commerce',
    name: 'Squarespace Commerce',
    category: 'ecommerce',
    provider: 'api_key',
    icon: '◼️',
    description: 'Show a customer’s Squarespace order history.',
    scopes: ['orders.read'],
    dataLabel: 'Squarespace',
    dataFields: [
      { label: 'Orders', options: ['0', '1', '2'] },
      { label: 'Last order', options: ['—', '1 week ago', '1 month ago'] },
    ],
  },
  {
    id: 'wix-stores',
    name: 'Wix Stores',
    category: 'ecommerce',
    provider: 'oauth',
    icon: '🎨',
    description: 'See a shopper’s Wix Stores order count and loyalty tier.',
    scopes: ['orders.read'],
    dataLabel: 'Wix Stores',
    dataFields: [
      { label: 'Orders', options: ['0', '2', '5'] },
      { label: 'Loyalty tier', options: ['None', 'Bronze', 'Silver', 'Gold'] },
    ],
  },
  {
    id: 'prestashop',
    name: 'PrestaShop',
    category: 'ecommerce',
    provider: 'api_key',
    icon: '🏪',
    description: 'Bring a PrestaShop customer’s order and cart status in.',
    scopes: ['orders.read', 'carts.read'],
    dataLabel: 'PrestaShop',
    dataFields: [
      { label: 'Orders', options: ['0', '1', '3'] },
      { label: 'Active cart', options: ['Empty', '1 item', '3 items'] },
    ],
  },
  {
    id: 'ecwid',
    name: 'Ecwid',
    category: 'ecommerce',
    provider: 'api_key',
    icon: '🧺',
    description: 'Show an Ecwid shopper’s order history and total spend.',
    scopes: ['orders.read'],
    dataLabel: 'Ecwid',
    dataFields: [
      { label: 'Orders', options: ['0', '1', '2'] },
      { label: 'Total spend', options: ['$0', '$60', '$210'] },
    ],
  },
  {
    id: 'salesforce-commerce',
    name: 'Salesforce Commerce Cloud',
    category: 'ecommerce',
    provider: 'oauth',
    icon: '🌥️',
    description: 'See a shopper’s Salesforce Commerce Cloud order history.',
    scopes: ['orders.read', 'customers.read'],
    dataLabel: 'Salesforce Commerce',
    dataFields: [
      { label: 'Orders', options: ['0', '2', '6'] },
      { label: 'Lifetime value', options: ['$0', '$430', '$1,850'] },
    ],
  },
  {
    id: 'square',
    name: 'Square',
    category: 'payments',
    provider: 'oauth',
    icon: '🔲',
    description: 'Show a customer’s Square payment history and card on file.',
    scopes: ['payments.read', 'customers.read'],
    dataLabel: 'Square',
    dataFields: [
      { label: 'Payments', options: ['0', '1', '3'] },
      { label: 'Card on file', options: ['No', 'Yes'] },
    ],
  },
  {
    id: 'braintree',
    name: 'Braintree',
    category: 'payments',
    provider: 'api_key',
    icon: '🌳',
    description: 'See a customer’s Braintree subscription status.',
    scopes: ['subscriptions.read'],
    dataLabel: 'Braintree',
    dataFields: [{ label: 'Subscription', options: ['None', 'Active', 'Past due', 'Canceled'] }],
  },
  {
    id: 'adyen',
    name: 'Adyen',
    category: 'payments',
    provider: 'api_key',
    icon: '💶',
    description: 'Bring a customer’s Adyen payment status and risk score in.',
    scopes: ['payments.read'],
    dataLabel: 'Adyen',
    dataFields: [
      { label: 'Last payment', options: ['—', 'Authorised', 'Refused', 'Refunded'] },
      { label: 'Risk score', options: ['Low', 'Medium', 'High'] },
    ],
  },
  {
    id: 'razorpay',
    name: 'Razorpay',
    category: 'payments',
    provider: 'oauth',
    icon: '🪒',
    description: 'Show a customer’s Razorpay payment and subscription status.',
    scopes: ['payments.read'],
    dataLabel: 'Razorpay',
    dataFields: [
      { label: 'Status', options: ['No customer', 'Active', 'Failed'] },
      { label: 'Plan', options: ['—', 'Basic', 'Pro'] },
    ],
  },
  {
    id: 'authorize-net',
    name: 'Authorize.Net',
    category: 'payments',
    provider: 'api_key',
    icon: '🔐',
    description: 'See a customer’s Authorize.Net transaction history.',
    scopes: ['transactions.read'],
    dataLabel: 'Authorize.Net',
    dataFields: [
      { label: 'Transactions', options: ['0', '1', '2'] },
      { label: 'Last status', options: ['—', 'Approved', 'Declined'] },
    ],
  },
  {
    id: 'checkout-com',
    name: 'Checkout.com',
    category: 'payments',
    provider: 'oauth',
    icon: '🧾',
    description: 'Bring a customer’s Checkout.com payment status into the chat.',
    scopes: ['payments.read'],
    dataLabel: 'Checkout.com',
    dataFields: [{ label: 'Status', options: ['No customer', 'Active', 'Declined'] }],
  },
  {
    id: 'activecampaign',
    name: 'ActiveCampaign',
    category: 'marketing',
    provider: 'api_key',
    icon: '📣',
    description: 'Know a contact’s automation status and engagement from ActiveCampaign.',
    scopes: ['contacts.read'],
    dataLabel: 'ActiveCampaign',
    dataFields: [
      { label: 'Subscribed', options: ['Yes', 'No'] },
      { label: 'Automations active', options: ['0', '1', '2'] },
    ],
  },
  {
    id: 'constant-contact',
    name: 'Constant Contact',
    category: 'marketing',
    provider: 'oauth',
    icon: '☎️',
    description: 'See a contact’s email engagement from Constant Contact.',
    scopes: ['contacts.read'],
    dataLabel: 'Constant Contact',
    dataFields: [
      { label: 'Subscribed', options: ['Yes', 'No'] },
      { label: 'Opens (30d)', options: ['0', '2', '7'] },
    ],
  },
  {
    id: 'brevo',
    name: 'Brevo',
    category: 'marketing',
    provider: 'api_key',
    icon: '🌤️',
    description: 'Bring a contact’s campaign engagement from Brevo.',
    scopes: ['contacts.read'],
    dataLabel: 'Brevo',
    dataFields: [
      { label: 'Subscribed', options: ['Yes', 'No'] },
      { label: 'Campaigns opened', options: ['0', '1', '4'] },
    ],
  },
  {
    id: 'convertkit',
    name: 'ConvertKit',
    category: 'marketing',
    provider: 'api_key',
    icon: '🔁',
    description: 'Show a subscriber’s tags and sequence status from ConvertKit.',
    scopes: ['subscribers.read'],
    dataLabel: 'ConvertKit',
    dataFields: [
      { label: 'Subscribed', options: ['Yes', 'No'] },
      { label: 'Active sequence', options: ['None', 'Welcome', 'Onboarding'] },
    ],
  },
  {
    id: 'drip',
    name: 'Drip',
    category: 'marketing',
    provider: 'oauth',
    icon: '💧',
    description: 'See a subscriber’s engagement and tags from Drip.',
    scopes: ['subscribers.read'],
    dataLabel: 'Drip',
    dataFields: [
      { label: 'Subscribed', options: ['Yes', 'No'] },
      { label: 'Tags', options: ['0', '1', '3'] },
    ],
  },
  {
    id: 'marketo',
    name: 'Marketo',
    category: 'marketing',
    provider: 'oauth',
    icon: '🎯',
    description: 'Bring a lead’s score and program status from Marketo.',
    scopes: ['leads.read'],
    dataLabel: 'Marketo',
    dataFields: [
      { label: 'Lead score', options: ['0', '25', '60', '90'] },
      { label: 'Program status', options: ['—', 'Enrolled', 'Completed'] },
    ],
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'productivity',
    provider: 'oauth',
    icon: '📝',
    description: 'Link a customer’s shared Notion page to the conversation.',
    scopes: ['pages.read'],
    dataLabel: 'Notion',
    dataFields: [{ label: 'Shared page', options: ['None', 'Onboarding doc', 'Project brief'] }],
  },
  {
    id: 'asana',
    name: 'Asana',
    category: 'productivity',
    provider: 'oauth',
    icon: '📋',
    description: 'See the customer’s open Asana tasks linked to this account.',
    scopes: ['tasks.read'],
    dataLabel: 'Asana',
    dataFields: [{ label: 'Open tasks', options: ['0', '1', '3'] }],
  },
  {
    id: 'trello',
    name: 'Trello',
    category: 'productivity',
    provider: 'api_key',
    icon: '📌',
    description: 'Surface the customer’s linked Trello card and list.',
    scopes: ['boards.read'],
    dataLabel: 'Trello',
    dataFields: [{ label: 'Card', options: ['None', 'In Progress', 'Review', 'Done'] }],
  },
  {
    id: 'monday',
    name: 'monday.com',
    category: 'productivity',
    provider: 'oauth',
    icon: '🌈',
    description: 'Show the customer’s linked monday.com item status.',
    scopes: ['boards.read'],
    dataLabel: 'monday.com',
    dataFields: [{ label: 'Item status', options: ['Not started', 'Working on it', 'Done'] }],
  },
  {
    id: 'mixpanel',
    name: 'Mixpanel',
    category: 'analytics',
    provider: 'api_key',
    icon: '📊',
    description: 'See the customer’s recent product events from Mixpanel.',
    scopes: ['events.read'],
    dataLabel: 'Mixpanel',
    dataFields: [
      { label: 'Sessions (30d)', options: ['0', '4', '15'] },
      { label: 'Last event', options: ['—', 'Signed up', 'Upgraded', 'Churned'] },
    ],
  },
  {
    id: 'amplitude',
    name: 'Amplitude',
    category: 'analytics',
    provider: 'api_key',
    icon: '📶',
    description: 'Bring a customer’s engagement score from Amplitude.',
    scopes: ['events.read'],
    dataLabel: 'Amplitude',
    dataFields: [
      { label: 'Engagement score', options: ['Low', 'Medium', 'High'] },
      { label: 'Last active', options: ['Today', 'This week', 'This month'] },
    ],
  },
  {
    id: 'google-analytics',
    name: 'Google Analytics',
    category: 'analytics',
    provider: 'oauth',
    icon: '🧮',
    description: 'Show a visitor’s session source and pageviews from Google Analytics.',
    scopes: ['analytics.readonly'],
    dataLabel: 'Google Analytics',
    dataFields: [
      { label: 'Sessions', options: ['1', '3', '8'] },
      { label: 'Source', options: ['Direct', 'Organic', 'Paid', 'Referral'] },
    ],
  },
  {
    id: 'hotjar',
    name: 'Hotjar',
    category: 'analytics',
    provider: 'api_key',
    icon: '🔥',
    description: 'See if this visitor’s session was recorded by Hotjar.',
    scopes: ['recordings.read'],
    dataLabel: 'Hotjar',
    dataFields: [
      { label: 'Recording available', options: ['Yes', 'No'] },
      { label: 'Rage clicks', options: ['0', '1', '3'] },
    ],
  },
  {
    id: 'heap',
    name: 'Heap',
    category: 'analytics',
    provider: 'oauth',
    icon: '🗃️',
    description: 'Bring the customer’s autocapture event history from Heap.',
    scopes: ['events.read'],
    dataLabel: 'Heap',
    dataFields: [{ label: 'Events (7d)', options: ['0', '12', '48'] }],
  },
  {
    id: 'posthog',
    name: 'PostHog',
    category: 'analytics',
    provider: 'api_key',
    icon: '🦔',
    description: 'See the customer’s feature flag exposure and recent events from PostHog.',
    scopes: ['events.read'],
    dataLabel: 'PostHog',
    dataFields: [
      { label: 'Recent event', options: ['—', 'Viewed pricing', 'Started trial', 'Upgraded'] },
      { label: 'Feature flags', options: ['0', '1', '2'] },
    ],
  },
  // --- 09.2-v2-e: 40 more data apps, spread across the same 7 sections --------
  {
    id: 'keap',
    name: 'Keap',
    category: 'crm',
    provider: 'oauth',
    icon: '🌵',
    description: 'See a contact’s pipeline stage and tags from Keap.',
    scopes: ['contacts.read', 'pipeline.read'],
    dataLabel: 'Keap',
    dataFields: [
      { label: 'Pipeline stage', options: ['New', 'Contacted', 'Negotiating', 'Won'] },
      { label: 'Tags', options: ['0', '1', '3'] },
    ],
  },
  {
    id: 'nimble',
    name: 'Nimble',
    category: 'crm',
    provider: 'api_key',
    icon: '🐦',
    description: 'Show a contact’s social profile and deal history from Nimble.',
    scopes: ['contacts.read'],
    dataLabel: 'Nimble',
    dataFields: [
      { label: 'Deals', options: ['0', '1', '2'] },
      { label: 'Last contacted', options: ['Today', 'This week', 'Last month'] },
    ],
  },
  {
    id: 'nutshell',
    name: 'Nutshell',
    category: 'crm',
    provider: 'api_key',
    icon: '🥜',
    description: 'Bring a lead’s stage and assigned rep from Nutshell.',
    scopes: ['leads.read'],
    dataLabel: 'Nutshell',
    dataFields: [
      { label: 'Stage', options: ['New lead', 'Qualified', 'Proposal', 'Won'] },
      { label: 'Rep', options: ['Alex Rivera', 'Sam Okafor', 'Jordan Lee'] },
    ],
  },
  {
    id: 'vtiger',
    name: 'Vtiger',
    category: 'crm',
    provider: 'api_key',
    icon: '🐯',
    description: 'See a contact’s open cases and deal value from Vtiger.',
    scopes: ['contacts.read', 'deals.read'],
    dataLabel: 'Vtiger',
    dataFields: [
      { label: 'Open deals', options: ['0', '1', '3'] },
      { label: 'Deal value', options: ['$0', '$800', '$3,200'] },
    ],
  },
  {
    id: 'sugarcrm',
    name: 'SugarCRM',
    category: 'crm',
    provider: 'oauth',
    icon: '🍬',
    description: 'Show a contact’s account status and open opportunities from SugarCRM.',
    scopes: ['contacts.read', 'opportunities.read'],
    dataLabel: 'SugarCRM',
    dataFields: [
      { label: 'Account status', options: ['Prospect', 'Customer', 'Former customer'] },
      { label: 'Open opportunities', options: ['0', '1', '2'] },
    ],
  },
  {
    id: 'capsule-crm',
    name: 'Capsule CRM',
    category: 'crm',
    provider: 'api_key',
    icon: '🧴',
    description: 'Bring a contact’s pipeline stage and tags from Capsule CRM.',
    scopes: ['contacts.read'],
    dataLabel: 'Capsule CRM',
    dataFields: [{ label: 'Pipeline stage', options: ['New', 'Qualifying', 'Proposal', 'Won'] }],
  },
  {
    id: 'liveagent',
    name: 'LiveAgent',
    category: 'support',
    provider: 'api_key',
    icon: '📞',
    description: 'Show a customer’s open tickets and satisfaction rating from LiveAgent.',
    scopes: ['tickets.read'],
    dataLabel: 'LiveAgent',
    dataFields: [
      { label: 'Open tickets', options: ['0', '1', '2'] },
      { label: 'Satisfaction', options: ['—', 'Good', 'Bad'] },
    ],
  },
  {
    id: 'happyfox',
    name: 'HappyFox',
    category: 'support',
    provider: 'oauth',
    icon: '🦊',
    description: 'See a customer’s ticket history and priority from HappyFox.',
    scopes: ['tickets.read'],
    dataLabel: 'HappyFox',
    dataFields: [
      { label: 'Open tickets', options: ['0', '1', '3'] },
      { label: 'Priority', options: ['Low', 'Medium', 'High'] },
    ],
  },
  {
    id: 'deskpro',
    name: 'Deskpro',
    category: 'support',
    provider: 'api_key',
    icon: '🗄️',
    description: 'Bring a customer’s ticket status and department from Deskpro.',
    scopes: ['tickets.read'],
    dataLabel: 'Deskpro',
    dataFields: [
      { label: 'Status', options: ['New', 'Awaiting agent', 'Awaiting customer', 'Resolved'] },
    ],
  },
  {
    id: 'teamsupport',
    name: 'TeamSupport',
    category: 'support',
    provider: 'api_key',
    icon: '🧰',
    description: 'Show a customer’s open tickets and organization plan from TeamSupport.',
    scopes: ['tickets.read'],
    dataLabel: 'TeamSupport',
    dataFields: [
      { label: 'Open tickets', options: ['0', '1', '2'] },
      { label: 'Organization plan', options: ['—', 'Trial', 'Paid'] },
    ],
  },
  {
    id: 'helpcrunch',
    name: 'HelpCrunch',
    category: 'support',
    provider: 'oauth',
    icon: '🐞',
    description: 'See a customer’s conversation history and lead status from HelpCrunch.',
    scopes: ['conversations.read'],
    dataLabel: 'HelpCrunch',
    dataFields: [{ label: 'Open conversations', options: ['0', '1', '2'] }],
  },
  {
    id: 'vivantio',
    name: 'Vivantio',
    category: 'support',
    provider: 'api_key',
    icon: '🗒️',
    description: 'Bring a customer’s case status and SLA from Vivantio.',
    scopes: ['cases.read'],
    dataLabel: 'Vivantio',
    dataFields: [
      { label: 'Case status', options: ['New', 'In progress', 'Resolved'] },
      { label: 'SLA', options: ['On track', 'At risk', 'Breached'] },
    ],
  },
  {
    id: 'shopware',
    name: 'Shopware',
    category: 'ecommerce',
    provider: 'oauth',
    icon: '🛠️',
    description: 'Pull a Shopware customer’s orders and total spend into the conversation.',
    scopes: ['orders.read', 'customers.read'],
    dataLabel: 'Shopware',
    dataFields: [
      { label: 'Orders', options: ['0', '1', '4'] },
      { label: 'Total spend', options: ['$0', '$120', '$450'] },
    ],
  },
  {
    id: 'opencart',
    name: 'OpenCart',
    category: 'ecommerce',
    provider: 'api_key',
    icon: '🛺',
    description: 'Show an OpenCart shopper’s order history and status.',
    scopes: ['orders.read'],
    dataLabel: 'OpenCart',
    dataFields: [
      { label: 'Orders', options: ['0', '1', '2'] },
      { label: 'Last order status', options: ['—', 'Pending', 'Shipped', 'Complete'] },
    ],
  },
  {
    id: 'volusion',
    name: 'Volusion',
    category: 'ecommerce',
    provider: 'api_key',
    icon: '🏷️',
    description: 'See a Volusion customer’s order count and cart status.',
    scopes: ['orders.read'],
    dataLabel: 'Volusion',
    dataFields: [
      { label: 'Orders', options: ['0', '1', '3'] },
      { label: 'Active cart', options: ['Empty', '1 item', '2 items'] },
    ],
  },
  {
    id: 'shift4shop',
    name: 'Shift4Shop',
    category: 'ecommerce',
    provider: 'api_key',
    icon: '🚚',
    description: 'Bring a Shift4Shop customer’s order history into the chat.',
    scopes: ['orders.read'],
    dataLabel: 'Shift4Shop',
    dataFields: [{ label: 'Orders', options: ['0', '2', '5'] }],
  },
  {
    id: 'lightspeed-retail',
    name: 'Lightspeed Retail',
    category: 'ecommerce',
    provider: 'oauth',
    icon: '💡',
    description: 'Show a customer’s in-store and online purchase history from Lightspeed.',
    scopes: ['sales.read', 'customers.read'],
    dataLabel: 'Lightspeed Retail',
    dataFields: [
      { label: 'Purchases', options: ['0', '1', '4'] },
      { label: 'Lifetime value', options: ['$0', '$260', '$980'] },
    ],
  },
  {
    id: 'commercetools',
    name: 'commercetools',
    category: 'ecommerce',
    provider: 'oauth',
    icon: '🧊',
    description: 'Pull a shopper’s order history from commercetools into the conversation.',
    scopes: ['orders.read', 'customers.read'],
    dataLabel: 'commercetools',
    dataFields: [
      { label: 'Orders', options: ['0', '1', '3'] },
      { label: 'Lifetime value', options: ['$0', '$310', '$1,150'] },
    ],
  },
  {
    id: 'mollie',
    name: 'Mollie',
    category: 'payments',
    provider: 'api_key',
    icon: '🟠',
    description: 'Show a customer’s Mollie payment status and active subscription.',
    scopes: ['payments.read'],
    dataLabel: 'Mollie',
    dataFields: [
      { label: 'Status', options: ['No customer', 'Paid', 'Failed', 'Refunded'] },
      { label: 'Subscription', options: ['None', 'Active', 'Canceled'] },
    ],
  },
  {
    id: 'paddle',
    name: 'Paddle',
    category: 'payments',
    provider: 'oauth',
    icon: '🏓',
    description: 'See a customer’s Paddle subscription plan and billing status.',
    scopes: ['subscriptions.read'],
    dataLabel: 'Paddle',
    dataFields: [
      { label: 'Plan', options: ['—', 'Starter', 'Growth', 'Scale'] },
      { label: 'Status', options: ['Active', 'Past due', 'Canceled'] },
    ],
  },
  {
    id: 'worldpay',
    name: 'Worldpay',
    category: 'payments',
    provider: 'api_key',
    icon: '🌍',
    description: 'Bring a customer’s Worldpay transaction history into the chat.',
    scopes: ['transactions.read'],
    dataLabel: 'Worldpay',
    dataFields: [
      { label: 'Transactions', options: ['0', '1', '3'] },
      { label: 'Last status', options: ['—', 'Approved', 'Declined'] },
    ],
  },
  {
    id: 'gocardless',
    name: 'GoCardless',
    category: 'payments',
    provider: 'oauth',
    icon: '🏦',
    description: 'Show a customer’s GoCardless Direct Debit mandate and last payment.',
    scopes: ['payments.read', 'mandates.read'],
    dataLabel: 'GoCardless',
    dataFields: [
      { label: 'Mandate', options: ['None', 'Active', 'Cancelled'] },
      { label: 'Last payment', options: ['—', 'Paid out', 'Pending', 'Failed'] },
    ],
  },
  {
    id: 'klarna',
    name: 'Klarna',
    category: 'payments',
    provider: 'oauth',
    icon: '🩷',
    description: 'See a customer’s Klarna order and installment status.',
    scopes: ['orders.read'],
    dataLabel: 'Klarna',
    dataFields: [
      { label: 'Orders', options: ['0', '1', '2'] },
      { label: 'Installments', options: ['—', 'On track', 'Overdue'] },
    ],
  },
  {
    id: 'affirm',
    name: 'Affirm',
    category: 'payments',
    provider: 'api_key',
    icon: '💵',
    description: 'Bring a customer’s Affirm loan status into the conversation.',
    scopes: ['loans.read'],
    dataLabel: 'Affirm',
    dataFields: [
      { label: 'Loan status', options: ['No loan', 'Active', 'Paid off', 'Delinquent'] },
    ],
  },
  {
    id: 'mailerlite',
    name: 'MailerLite',
    category: 'marketing',
    provider: 'api_key',
    icon: '📧',
    description: 'Know whether a contact is subscribed and their open rate from MailerLite.',
    scopes: ['subscribers.read'],
    dataLabel: 'MailerLite',
    dataFields: [
      { label: 'Subscribed', options: ['Yes', 'No'] },
      { label: 'Opens (30d)', options: ['0', '3', '9'] },
    ],
  },
  {
    id: 'iterable',
    name: 'Iterable',
    category: 'marketing',
    provider: 'oauth',
    icon: '🔔',
    description: 'See a contact’s active journey and engagement from Iterable.',
    scopes: ['users.read'],
    dataLabel: 'Iterable',
    dataFields: [
      { label: 'Subscribed', options: ['Yes', 'No'] },
      { label: 'Active journey', options: ['None', 'Onboarding', 'Win-back'] },
    ],
  },
  {
    id: 'customer-io',
    name: 'Customer.io',
    category: 'marketing',
    provider: 'api_key',
    icon: '✉️',
    description: 'Bring a contact’s email engagement from Customer.io into the chat.',
    scopes: ['customers.read'],
    dataLabel: 'Customer.io',
    dataFields: [
      { label: 'Subscribed', options: ['Yes', 'No'] },
      { label: 'Campaigns opened', options: ['0', '2', '6'] },
    ],
  },
  {
    id: 'sailthru',
    name: 'Sailthru',
    category: 'marketing',
    provider: 'api_key',
    icon: '📤',
    description: 'Show a contact’s lifecycle segment and engagement from Sailthru.',
    scopes: ['profiles.read'],
    dataLabel: 'Sailthru',
    dataFields: [{ label: 'Segment', options: ['New', 'Engaged', 'At risk'] }],
  },
  {
    id: 'autopilot',
    name: 'Autopilot',
    category: 'marketing',
    provider: 'oauth',
    icon: '🛫',
    description: 'See a contact’s active journey and tags from Autopilot.',
    scopes: ['contacts.read'],
    dataLabel: 'Autopilot',
    dataFields: [
      { label: 'Active journey', options: ['None', 'Welcome', 'Nurture'] },
      { label: 'Tags', options: ['0', '1', '2'] },
    ],
  },
  {
    id: 'sharpspring',
    name: 'SharpSpring',
    category: 'marketing',
    provider: 'api_key',
    icon: '🔷',
    description: 'Bring a lead’s score and active campaign from SharpSpring.',
    scopes: ['leads.read'],
    dataLabel: 'SharpSpring',
    dataFields: [
      { label: 'Lead score', options: ['0', '20', '55', '80'] },
      { label: 'Active campaign', options: ['None', 'Nurture', 'Re-engagement'] },
    ],
  },
  {
    id: 'clickup',
    name: 'ClickUp',
    category: 'productivity',
    provider: 'oauth',
    icon: '✔️',
    description: 'See the customer’s linked ClickUp task status.',
    scopes: ['tasks.read'],
    dataLabel: 'ClickUp',
    dataFields: [{ label: 'Task status', options: ['To do', 'In progress', 'Review', 'Done'] }],
  },
  {
    id: 'basecamp',
    name: 'Basecamp',
    category: 'productivity',
    provider: 'oauth',
    icon: '⛺',
    description: 'Surface the customer’s shared Basecamp project and to-do status.',
    scopes: ['projects.read'],
    dataLabel: 'Basecamp',
    dataFields: [
      { label: 'Project', options: ['None', 'Onboarding', 'Support'] },
      { label: 'Open to-dos', options: ['0', '1', '3'] },
    ],
  },
  {
    id: 'airtable',
    name: 'Airtable',
    category: 'productivity',
    provider: 'api_key',
    icon: '📐',
    description: 'Link the customer’s record in a shared Airtable base.',
    scopes: ['bases.read'],
    dataLabel: 'Airtable',
    dataFields: [{ label: 'Record status', options: ['New', 'In review', 'Complete'] }],
  },
  {
    id: 'wrike',
    name: 'Wrike',
    category: 'productivity',
    provider: 'oauth',
    icon: '🔶',
    description: 'Show the customer’s linked Wrike task status.',
    scopes: ['tasks.read'],
    dataLabel: 'Wrike',
    dataFields: [{ label: 'Task status', options: ['New', 'Active', 'Completed'] }],
  },
  {
    id: 'matomo',
    name: 'Matomo',
    category: 'analytics',
    provider: 'api_key',
    icon: '📉',
    description: 'See the visitor’s session count and goal conversions from Matomo.',
    scopes: ['analytics.read'],
    dataLabel: 'Matomo',
    dataFields: [
      { label: 'Sessions', options: ['1', '2', '7'] },
      { label: 'Goals converted', options: ['0', '1', '2'] },
    ],
  },
  {
    id: 'fullstory',
    name: 'FullStory',
    category: 'analytics',
    provider: 'oauth',
    icon: '🎬',
    description: 'See if this visitor’s session was captured by FullStory.',
    scopes: ['sessions.read'],
    dataLabel: 'FullStory',
    dataFields: [
      { label: 'Session captured', options: ['Yes', 'No'] },
      { label: 'Rage clicks', options: ['0', '1', '2'] },
    ],
  },
  {
    id: 'pendo',
    name: 'Pendo',
    category: 'analytics',
    provider: 'api_key',
    icon: '🧠',
    description: 'Bring a customer’s feature adoption and NPS score from Pendo.',
    scopes: ['visitors.read'],
    dataLabel: 'Pendo',
    dataFields: [
      { label: 'NPS', options: ['—', 'Detractor', 'Passive', 'Promoter'] },
      { label: 'Features adopted', options: ['0', '2', '5'] },
    ],
  },
  {
    id: 'woopra',
    name: 'Woopra',
    category: 'analytics',
    provider: 'api_key',
    icon: '📡',
    description: 'Show the customer’s last touchpoint and journey from Woopra.',
    scopes: ['events.read'],
    dataLabel: 'Woopra',
    dataFields: [
      { label: 'Last touchpoint', options: ['—', 'Viewed pricing', 'Signed up', 'Upgraded'] },
    ],
  },
  {
    id: 'crazyegg',
    name: 'Crazy Egg',
    category: 'analytics',
    provider: 'api_key',
    icon: '🥚',
    description: 'See if this visitor’s session has a Crazy Egg heatmap recording.',
    scopes: ['recordings.read'],
    dataLabel: 'Crazy Egg',
    dataFields: [{ label: 'Recording available', options: ['Yes', 'No'] }],
  },
  {
    id: 'kissmetrics',
    name: 'Kissmetrics',
    category: 'analytics',
    provider: 'api_key',
    icon: '💋',
    description: 'Bring the customer’s conversion funnel step from Kissmetrics.',
    scopes: ['events.read'],
    dataLabel: 'Kissmetrics',
    dataFields: [
      { label: 'Funnel step', options: ['Visited', 'Signed up', 'Activated', 'Converted'] },
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

/** Narrowing controls for {@link filterAppCatalog} — both are optional. */
export interface AppCatalogFilter {
  /** Case-insensitive substring match against a card's `name` + `description`. */
  query?: string;
  category?: AppCategory;
}

/**
 * Narrows the catalogue by free-text search and/or category (09.2-v2-b, the
 * pure core behind `GET /settings/apps?query=&category=`). `query` is trimmed
 * first, so whitespace-only input behaves like no query at all; when a
 * `category` is also given the two narrow together (intersection, not union).
 * Order is preserved — callers that need pagination to make sense rely on it.
 */
export function filterAppCatalog(
  entries: readonly AppCatalogEntry[],
  filter: AppCatalogFilter = {},
): AppCatalogEntry[] {
  const query = filter.query?.trim().toLowerCase() ?? '';
  return entries.filter((entry) => {
    if (filter.category !== undefined && entry.category !== filter.category) return false;
    if (!query) return true;
    return (
      entry.name.toLowerCase().includes(query) || entry.description.toLowerCase().includes(query)
    );
  });
}

export interface AppPaginationOptions {
  limit: number;
  /** The `id` of the last card on the previous page, or absent for page one. */
  pageId?: string;
}

export interface AppPage {
  page: AppCatalogEntry[];
  /** The match count across all pages of `entries` — not this page's length. */
  total: number;
  /** The cursor for the next page. Absent on the last page. */
  nextPageId?: string;
}

/**
 * One page of `entries`, in their existing (stable) order — the keyset cursor
 * is only meaningful because that order never changes between calls. `pageId`,
 * when given, is the `id` of the last card the caller already saw; the page
 * resumes right after it. A `pageId` that names no entry in `entries` returns
 * `null` rather than silently restarting at page one, so the caller (route
 * layer, 09.2-v2-c) can turn an unknown cursor into a 400 instead of masking
 * a bad request as an empty result.
 */
export function paginateApps(
  entries: readonly AppCatalogEntry[],
  options: AppPaginationOptions,
): AppPage | null {
  const { limit, pageId } = options;
  let start = 0;
  if (pageId !== undefined) {
    const cursorIndex = entries.findIndex((entry) => entry.id === pageId);
    if (cursorIndex === -1) return null;
    start = cursorIndex + 1;
  }
  const page = entries.slice(start, start + limit);
  const hasNext = start + limit < entries.length;
  return {
    page,
    total: entries.length,
    ...(hasNext ? { nextPageId: page[page.length - 1]!.id } : {}),
  };
}

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
export function isChannelApp(
  entry: AppCatalogEntry,
): entry is AppCatalogEntry & { channel: ChannelType } {
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

/**
 * A page of the marketplace catalogue (09.2 v2): `listApps` narrowed by
 * `query`/`category` and paginated the same way `customers.get` is —
 * `total` is the match count across all pages, `next_page_id` is the opaque
 * keyset cursor for the next one, absent on the last page.
 */
export interface AppListResponse {
  items: AppListItem[];
  total: number;
  next_page_id?: string;
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
