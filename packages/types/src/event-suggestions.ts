/**
 * Event-bound suggested replies (IN-07 · tm 364).
 *
 * A saved reply can be offered as a chip when something happens in a
 * conversation: it starts, it is handed to the agent, the player goes quiet, or
 * the player rates it. The events are detected in the panel (the pure function
 * is `apps/web/src/features/inbox/eventSuggestions.ts`); the server stores which
 * replies are bound to which event and in which order, and nothing more. No chip
 * ever sends itself.
 */

/** The events a saved reply may be bound to (`canned_responses.suggest_on`). */
export const SUGGEST_EVENTS = [
  'chat_started',
  'chat_transferred',
  'customer_idle',
  'rated_good',
  'rated_bad',
] as const;
export type SuggestEvent = (typeof SUGGEST_EVENTS)[number];

export function isSuggestEvent(value: string): value is SuggestEvent {
  return (SUGGEST_EVENTS as readonly string[]).includes(value);
}

/**
 * A saved reply's category (`canned_responses.category`). `promotion` marks a
 * bonus/promotion text: it is not suggested in a conversation whose player is
 * kept from promotions (EN-01, `isPromoSuppressed`).
 */
export const CANNED_CATEGORIES = ['general', 'promotion'] as const;
export type CannedCategory = (typeof CANNED_CATEGORIES)[number];

/** The most chips one event row shows: a short row read at a glance. */
export const EVENT_SUGGESTION_MAX_CHIPS = 4;

/** Seconds of player silence before `customer_idle` fires, when the workspace sets none. */
export const DEFAULT_CUSTOMER_IDLE_SECONDS = 180;
/** Bounds of `inbox_settings.customer_idle_seconds` (CHECK in the migration). */
export const CUSTOMER_IDLE_MIN_SECONDS = 10;
export const CUSTOMER_IDLE_MAX_SECONDS = 86_400;

/** Largest `suggest_order` (CHECK `canned_responses_suggest_order_check`). */
export const SUGGEST_ORDER_MAX = 1000;
