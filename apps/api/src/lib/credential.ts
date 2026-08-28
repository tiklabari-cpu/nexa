/**
 * Reading the `Authorization` header, and deciding what verifying it costs.
 *
 * Lives here rather than inside `plugins/auth.ts` because two plugins need the
 * same answer at two different points of the request lifecycle: the rate
 * limiter looks at the header in `onRequest` *before* authentication runs
 * (M-SEC-c1), and authentication itself looks at it a moment later. A second
 * copy of this parsing in the rate limiter would be a second definition of what
 * counts as a credential, and the two would eventually disagree about some
 * malformed header — which is the kind of disagreement that turns into a bypass.
 */
import type { FastifyRequest } from 'fastify';
import { CUSTOMER_TOKEN_PREFIX } from '../services/auth/customer-token.js';

export interface Credential {
  scheme: 'bearer' | 'basic';
  value: string;
}

/**
 * Reads `Authorization`.
 *
 * Supports `Bearer <token>` (OAuth access token, bot token or customer token)
 * and `Basic base64(account_id:pat)` — the personal access token scheme from
 * v2-03 §1.4, which server integrations expect.
 */
export function readCredential(request: FastifyRequest): Credential | null {
  const header = request.headers.authorization;
  if (!header) return null;

  const separator = header.indexOf(' ');
  if (separator < 0) return null;

  const scheme = header.slice(0, separator).toLowerCase();
  const value = header.slice(separator + 1).trim();
  if (!value) return null;

  if (scheme === 'bearer') return { scheme: 'bearer', value };
  if (scheme === 'basic') {
    let decoded: string;
    try {
      decoded = Buffer.from(value, 'base64').toString('utf8');
    } catch {
      return null;
    }
    const colon = decoded.indexOf(':');
    if (colon < 0) return null;
    // The account id half is informational; the PAT is what is verified.
    return { scheme: 'basic', value: decoded.slice(colon + 1) };
  }
  return null;
}

/**
 * Whether verifying this credential costs a database round-trip.
 *
 * The one thing the pre-auth budget in `plugins/rate-limit.ts` exists to bound
 * (M-SEC-c1 · §D116 LOW/1) is `auth_resolve_token`: a flood of invalid bearer
 * tokens used to buy one indexed lookup *each* before any limit was consulted.
 * So the budget meters exactly that, and nothing else:
 *
 *   - a customer token (`nxc1.…`) is verified by HMAC in this process, with no
 *     query at all. Metering it would put every visitor of a workspace behind
 *     one NAT into a shared per-IP failure budget in exchange for protecting a
 *     signature check that costs microseconds;
 *   - an absent or unparseable `Authorization` header never reaches the token
 *     service either — it is refused by `readCredential` above. Those requests
 *     are metered, but by the ordinary anonymous per-IP bucket, which is the
 *     limit that has always applied to callers without a credential.
 *
 * Everything else — a bearer token that is not a customer token, and every
 * `Basic` personal access token — is resolved against the database, so it is
 * what this predicate selects.
 */
export function costsTokenResolution(credential: Credential | null): boolean {
  if (!credential) return false;
  if (credential.scheme === 'bearer' && credential.value.startsWith(`${CUSTOMER_TOKEN_PREFIX}.`)) {
    return false;
  }
  return true;
}
