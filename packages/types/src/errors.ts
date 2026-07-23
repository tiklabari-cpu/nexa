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
  'misdirected_request',
  'not_allowed',
  'not_found',
  'pending_requests_limit_reached',
  'request_timeout',
  'service_unavailable',
  // Nexa addition. The source catalogue (v2-03 §1.8) is chat-only — ticketing
  // lives in a separate product there — so it has no "this already exists"
  // conflict. Kept narrow rather than adding a generic `conflict`, which is how
  // the rest of this list is written (`group_offline`, not `unavailable`).
  'ticket_exists',
  'too_many_requests',
  'unsupported_version',
  'users_limit_reached',
  'validation',
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
  misdirected_request: 421,
  not_allowed: 403,
  // Enumeration protection (NFR-S5): unknown *and* out-of-tenant resources
  // both surface as 404, never 403.
  not_found: 404,
  pending_requests_limit_reached: 429,
  request_timeout: 408,
  service_unavailable: 503,
  ticket_exists: 409,
  too_many_requests: 429,
  unsupported_version: 400,
  users_limit_reached: 429,
  validation: 400,
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
