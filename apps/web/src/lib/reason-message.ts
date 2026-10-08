/**
 * A refusal's stable `details.reason`, worded in the console's language
 * (O14, tm 259.18).
 *
 * Some refusals say something the type's general sentence would lose — the
 * downgrade guard names a quota, the self-lockout guard names the fix. They
 * used to be shown as the server's English `message`, behind an `i18n-ignore`.
 * The server now sends a stable `reason` (and the numbers the sentence is
 * about) in `details`; this resolves it through the catalogue under `prefix`.
 *
 * `null` when the error carries no reason this build has wording for — a
 * server ahead of the console, say — so the caller falls back to the error-type
 * catalogue (`t(errorMessageKey(error))`) rather than to the server's prose.
 */
import { ApiClientError } from './api-client.js';
import { hasMessage, type TFunction, type TranslateParams } from './i18n.js';

export function reasonMessage(
  t: TFunction,
  error: unknown,
  prefix: string,
  overrides: TranslateParams = {},
): string | null {
  if (!(error instanceof ApiClientError)) return null;
  const reason = error.details?.['reason'];
  if (typeof reason !== 'string') return null;
  const key = `${prefix}.${reason}`;
  if (!hasMessage('en', key)) return null;

  // Only the scalar facts the sentence is about; a nested object has no
  // placeholder to fill.
  const params: TranslateParams = {};
  for (const [name, value] of Object.entries(error.details ?? {})) {
    if (typeof value === 'string' || typeof value === 'number') params[name] = value;
  }
  return t(key, { ...params, ...overrides });
}
