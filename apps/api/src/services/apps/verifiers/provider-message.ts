/**
 * What of a provider's own words may reach the user (tm 263).
 *
 * "Key not found" from Brevo tells a person exactly what to fix, so the refusal
 * carries it. But the text is the provider's, and a provider that echoes the
 * request ("invalid key xkeysib-abc…") would put the credential into a response
 * body, a toast, a screenshot. So the message is cut to a short single line and
 * any run of eight or more characters it shares with a credential is removed
 * before anyone sees it.
 */
import { SafeHttpError } from '../../../lib/safe-fetch.js';
import type { VerifyFailureReason } from './types.js';

export const PROVIDER_MESSAGE_MAX = 200;
const SHARED_RUN = 8;

export function sanitiseProviderMessage(
  raw: unknown,
  secrets: readonly string[],
): string | undefined {
  if (typeof raw !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  let text = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  for (const secret of secrets) {
    if (secret.length >= SHARED_RUN) text = redactShared(text, secret);
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > PROVIDER_MESSAGE_MAX ? `${text.slice(0, PROVIDER_MESSAGE_MAX - 1)}…` : text;
}

/** Replaces every run of ≥ SHARED_RUN characters that also occurs in `secret`. */
function redactShared(text: string, secret: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    let longest = 0;
    for (let len = SHARED_RUN; i + len <= text.length; len += 1) {
      if (secret.includes(text.slice(i, i + len))) longest = len;
      else break;
    }
    if (longest > 0) {
      out += '[redacted]';
      i += longest;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

/** How a transport failure reads as a verification outcome. */
export function reasonForTransportError(error: unknown): VerifyFailureReason {
  if (error instanceof SafeHttpError) {
    return error.kind === 'too_large' ? 'provider_error' : 'unreachable';
  }
  return 'unreachable';
}

/** The first string among the usual places a JSON error body keeps its message. */
export function messageOf(body: unknown): unknown {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  return record['message'] ?? record['description'] ?? record['error'] ?? record['code'];
}
