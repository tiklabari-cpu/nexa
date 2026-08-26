/**
 * Error taxonomy — v2-03 §1.8 (23 types), plus the clone-specific additions the
 * source platform lacks. The wire envelope is ADR-06:
 *
 *   { error: { type, message, request_id, details? } }
 *
 * `type` is the machine-readable category clients switch on; the HTTP status is
 * derived from it via ERROR_STATUS so the two can never drift.
 */

export const ERROR_TYPES = [
  // Nexa addition. Signup is not in the source catalogue at all — that API
  // assumes a workspace already exists — and "this email is taken" is a
  // conflict, not a malformed request.
  'account_exists',
  'authentication',
  'authorization',
  // Nexa additions — Multibrand (PRD §5.3 · NFR-S4/S5). The source catalogue
  // (v2-03 §1.8) has no brand concept. `brand_not_found` gives the brands surface
  // its own 404 (a foreign or unknown brand id is un-enumerable, like every other
  // resource); `brand_exists` is the 409 a duplicate slug within a license raises,
  // kept narrow like `website_exists`/`ticket_exists` rather than a generic conflict.
  'brand_exists',
  'brand_not_found',
  'chat_anonymized',
  'chat_inactive',
  'customer_banned',
  'greeting_not_found',
  'group_not_found',
  'group_offline',
  'group_unavailable',
  'groups_offline',
  'internal',
  'license_expired',
  'limit_reached',
  // Nexa addition. A write refused for content reasons at the visitor edge —
  // the spam filter (FR-MOD-08.9.3). Deliberately generic: it does not name the
  // rule that fired, so an enveloped refusal cannot be used to probe the filter.
  // Kept narrow like `customer_banned`, not folded into `not_allowed` (which is
  // an authorization verdict).
  'message_rejected',
  'misdirected_request',
  'not_allowed',
  'not_found',
  'pending_requests_limit_reached',
  'request_timeout',
  // Nexa addition — the sandbox workspace (FR-MOD-11.5 · 11.5-f). A licence may
  // hold at most one sandbox, and asking for a second is a conflict rather than
  // a malformed request: the caller's body was fine, the workspace's state is
  // what refused them. Kept narrow like `website_exists`/`ticket_exists` rather
  // than folding into a generic conflict, which is how the rest of this list is
  // written.
  'sandbox_exists',
  'service_unavailable',
  // Nexa addition — supervisor takeover (FR-MOD-08.6.3). Two supervisors racing
  // to seize the same chat: the conditional re-assign lets exactly one win, and
  // the loser gets this 409. Not `not_allowed` (that is an authorization verdict
  // — the loser *was* allowed, they simply lost the race) and not `chat_inactive`
  // (the chat is open); kept narrow like `ticket_exists`, not a generic conflict.
  'takeover_conflict',
  // Nexa addition. The source catalogue (v2-03 §1.8) is chat-only — ticketing
  // lives in a separate product there — so it has no "this already exists"
  // conflict. Kept narrow rather than adding a generic `conflict`, which is how
  // the rest of this list is written (`group_offline`, not `unavailable`).
  'ticket_exists',
  'too_many_requests',
  // Nexa addition — two-factor authentication (NFR-S11 · FR-MOD-00.1). The
  // second login step (S11-2FA-e) answers with this rather than
  // `authentication`: the password was correct, a second factor is simply
  // still owed, and a client needs to tell the two apart to know whether to
  // show a code screen or a login form.
  'two_factor_required',
  'unsupported_version',
  'users_limit_reached',
  'validation',
  // Nexa addition. Websites (FR-MOD-08.5.2) are not in the source catalogue
  // (v2-03 §1.8, chat-only); a duplicate install domain is a conflict, kept
  // narrow like `ticket_exists`/`account_exists` rather than a generic one.
  'website_exists',
  'wrong_product_version',
] as const;

export type ErrorType = (typeof ERROR_TYPES)[number];

/**
 * type → HTTP status. The source platform never published this mapping
 * (v2-03 §1.8 flags it as a gap); these are the clone's locked choices.
 */
export const ERROR_STATUS: Record<ErrorType, number> = {
  account_exists: 409,
  authentication: 401,
  authorization: 403,
  brand_exists: 409,
  brand_not_found: 404,
  chat_anonymized: 410,
  chat_inactive: 409,
  customer_banned: 403,
  greeting_not_found: 404,
  group_not_found: 404,
  group_offline: 409,
  group_unavailable: 409,
  groups_offline: 409,
  internal: 500,
  license_expired: 402,
  limit_reached: 429,
  message_rejected: 403,
  misdirected_request: 421,
  not_allowed: 403,
  // Enumeration protection (NFR-S5): unknown *and* out-of-tenant resources
  // both surface as 404, never 403.
  not_found: 404,
  pending_requests_limit_reached: 429,
  request_timeout: 408,
  sandbox_exists: 409,
  service_unavailable: 503,
  takeover_conflict: 409,
  ticket_exists: 409,
  too_many_requests: 429,
  // Not authenticated yet, same as `authentication` — the second factor is
  // the missing piece, not a different kind of failure.
  two_factor_required: 401,
  unsupported_version: 400,
  users_limit_reached: 429,
  validation: 400,
  website_exists: 409,
  wrong_product_version: 409,
};

export interface ApiErrorBody {
  error: {
    type: ErrorType;
    message: string;
    request_id: string;
    details?: Record<string, unknown>;
  };
}

export function isErrorType(value: unknown): value is ErrorType {
  return typeof value === 'string' && (ERROR_TYPES as readonly string[]).includes(value);
}
