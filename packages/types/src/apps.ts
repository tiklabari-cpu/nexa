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
 */

/** How an app is connected. 09.1 ships the OAuth flow; 09.2 adds API-key apps. */
export const APP_PROVIDERS = ['oauth', 'api_key'] as const;
export type AppProvider = (typeof APP_PROVIDERS)[number];

/** The section of the directory a card sits under. */
export const APP_CATEGORIES = [
  'crm',
  'ecommerce',
  'payments',
  'marketing',
  'productivity',
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
  /** Header the connected app's data sits under, in-chat. */
  dataLabel: string;
  /** The fields that data is made of. */
  dataFields: readonly AppDataField[];
}

/**
 * The v1 marketplace (09.1). A deliberately small, representative set — one card
 * per category — so the grid and the OAuth flow are real end to end. The full
 * 15–20-card directory and the channel-typed cross-links are 09.2, which simply
 * extends this array.
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
] as const;

/** The catalogue entry for an id, or undefined if it names no app. */
export function findApp(id: string): AppCatalogEntry | undefined {
  return APP_CATALOG.find((entry) => entry.id === id);
}

/** True when `id` names a real marketplace app. */
export function isAppId(id: unknown): id is string {
  return typeof id === 'string' && APP_CATALOG.some((entry) => entry.id === id);
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
  return {
    app_id: entry.id,
    app_name: entry.name,
    icon: entry.icon,
    data_label: entry.dataLabel,
    fields: entry.dataFields.map((field) => ({
      label: field.label,
      value: field.options[hash32(`${seed}:${field.label}`) % field.options.length] ?? '—',
    })),
  };
}
