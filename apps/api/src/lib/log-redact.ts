/**
 * Keeping personal data out of logs and telemetry (NFR-C4 · C4-e · NFR-S9).
 *
 * The server's redaction list already covered *secrets* — the authorization
 * header, a password, a bot token. It did not cover **people**. A request line
 * carries the URL verbatim, and this API puts personal data in query strings:
 * `?query=jane@example.test` on the customer search, an address on a lookup. A
 * span carries the same URL to an exporter. Neither is a secret, and both are
 * exactly what "PHI must not leak into logs or telemetry" means.
 *
 * **Unconditional, not per-workspace.** HIPAA is what forced the question, but
 * the answer cannot be "mask when the workspace is covered": a request line is
 * written before authentication resolves, so at the moment the mask would have
 * to apply, nobody knows whose request it is. A mask that depends on an answer
 * that does not exist yet is a mask that is absent. `lib/cc-mask.ts` (GL-5)
 * settled the same question the same way — mask at write time, for everyone,
 * not only in the surface that happens to display it — and card masking is
 * reused here rather than re-implemented.
 *
 * The bias is the opposite of cc-mask's, on purpose. Card masking accepts
 * over-masking because a false positive costs a support agent a digit. Here the
 * masked text is what an operator debugs an incident with, so the patterns stay
 * narrow: an address, a card, and the values of query keys that are named as
 * carrying a credential or an identity. Everything else — the path, the ids,
 * the pagination cursor — survives, because a log line nobody can read is a log
 * line nobody keeps.
 */
import { maskCardNumbers } from './cc-mask.js';

/** What a masked value reads as. Matches the server's pino `censor`. */
const CENSOR = '[redacted]';

/**
 * An e-mail address, accepting both the raw `@` and its percent-encoded form —
 * a URL carries `jane%40example.test`, and a pattern that only knows `@` would
 * pass exactly the case this exists for. Deliberately whole-address: keeping the
 * domain would leave "which company" legible, which is itself the identifying
 * half in a B2B support product.
 */
const EMAIL = /[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Query keys whose *value* is masked whatever it looks like: a credential, or a
 * free-text field a person types their own details into. Longest alternatives
 * first so the pattern reads in the order it matches (`code_verifier` before
 * `code`); the trailing `=` makes the distinction load-bearing either way.
 */
const SENSITIVE_QUERY_KEY =
  /([?&](?:access_token|refresh_token|code_verifier|client_secret|signature|password|secret|token|email|query|code|state|key|sig)=)[^&#]*/gi;

/**
 * Mask personal data in free text — an address, a card number.
 *
 * Used on anything that is about to be written to a log or attached to a span.
 * A non-string or empty value is returned untouched so callers can pass a field
 * through without widening its type.
 */
export function maskPii(input: string): string {
  if (!input) return input;
  return maskCardNumbers(input.replace(EMAIL, CENSOR));
}

/**
 * A request URL in the form it may be logged.
 *
 * Two passes, and the order matters: the named keys go first, so a value that
 * carries no recognisable pattern (an opaque token, a name) is still removed;
 * then the general PII pass catches an address wherever it appears, including
 * in a key nobody thought to name. The path and the unnamed query keys survive
 * intact — that is what makes the line usable afterwards.
 */
export function logSafeUrl(url: string): string {
  if (!url) return url;
  return maskPii(url.replace(SENSITIVE_QUERY_KEY, `$1${CENSOR}`));
}

/**
 * The path half of a request URL, with the query string dropped entirely.
 *
 * For span attributes rather than logs, and stricter than {@link logSafeUrl} on
 * purpose: a span is the thing that leaves the process for a collector somebody
 * else runs, so the query — where every one of the values above lives — does not
 * travel at all rather than travelling masked. It is also what OpenTelemetry
 * means by `url.path`; the query has its own attribute, which this deliberately
 * does not set.
 */
export function requestPath(url: string): string {
  if (!url) return url;
  const cut = url.search(/[?#]/);
  return cut < 0 ? url : url.slice(0, cut);
}
