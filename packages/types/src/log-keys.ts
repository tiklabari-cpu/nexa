/**
 * Structured log keys — ID-08 (tm 288.1).
 *
 * "Why did the AI tell this player that?" has to be answerable from a number:
 * an agent reads a Thread ID off the panel, an operator greps the log for it,
 * and every line that request wrote comes back. That only works if every
 * process spells the identity keys the same way on every line. Before this the
 * same chat was `chatId` on one line and `chat_id` on the next, `thread_id` was
 * on none, and the request id was pino's own `reqId`.
 *
 * The keys are the code names, never the panel names (ID-01 · K1 = A): a log
 * line says `chat_id` for what the panel calls "Thread ID" and `thread_id` for
 * its "Chat ID", exactly as the API and the database do — the glossary
 * (`id-glossary.ts`) is where a person's word is translated, not here.
 *
 * `scripts/audit/log-keys.mjs` fails CI when a log call in `apps/api` or
 * `apps/rtm` writes one of these as camelCase (`chatId`); its list is pinned
 * to this one by `apps/api/src/config/log-keys-audit.test.ts`.
 */

/** Every identity key a log line may carry, in the order a reader looks for them. */
export const LOG_KEYS = {
  /** Which workspace — present on every line written after authentication. */
  licenseId: 'license_id',
  organizationId: 'organization_id',
  /** The HTTP request, or the RTM frame's own `request_id`. */
  requestId: 'request_id',
  /** Who acted: `agent`, `bot`, `customer`, `scim`, `enrollment`, `system`. */
  actorType: 'actor_type',
  actorId: 'actor_id',
  /** The day container — the panel's "Thread ID". */
  chatId: 'chat_id',
  /** One connection inside it — the panel's "Chat ID". */
  threadId: 'thread_id',
  customerId: 'customer_id',
} as const;

export type LogKeyName = keyof typeof LOG_KEYS;
export type LogKey = (typeof LOG_KEYS)[LogKeyName];

/** The snake_case keys, as a list — what the audit and the tests iterate. */
export const LOG_KEY_LIST: readonly LogKey[] = Object.values(LOG_KEYS);

/**
 * The identity a logger is bound to.
 *
 * An interface rather than a closed record so a process that knows more can
 * say so without forking the type: the platform admin process (tm 389.3) adds
 * `platform_admin_id` and `impersonation_session_id` by declaration merging,
 * and every helper that takes a `LogContext` carries the extra keys through.
 * Values are strings — a `bigint` licence id is not JSON, and a number would
 * lose its last digits in a log viewer — so `logContextValue` converts.
 */
export interface LogContext {
  license_id?: string;
  organization_id?: string;
  request_id?: string;
  actor_type?: string;
  actor_id?: string;
  chat_id?: string;
  thread_id?: string;
  customer_id?: string;
  /** Extension keys (snake_case), e.g. `platform_admin_id`. */
  [key: `${string}_id` | `${string}_type`]: string | undefined;
}

/**
 * What a client may send as `X-Request-Id` and have echoed back and logged.
 *
 * The header is the caller's text, and it lands on every log line the request
 * writes and in every error body: unchecked, it is a way to forge a line
 * ("…\n{"level":50,…}"), to collide with somebody else's request, or to make a
 * line unsearchable. Eight to sixty-four characters of a URL-safe alphabet
 * covers a UUID, a ULID, a short id and the common tracing formats; anything
 * else is replaced by a fresh UUID rather than refused, because a bad id is
 * the client's bookkeeping problem, not a reason to fail its request.
 */
export const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

export function isAcceptableRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_RE.test(value);
}

/** A context value as it is written: strings stay, bigints and numbers become strings. */
export function logContextValue(
  value: string | bigint | number | null | undefined,
): string | undefined {
  if (value === null || value === undefined) return undefined;
  return typeof value === 'string' ? value : String(value);
}
