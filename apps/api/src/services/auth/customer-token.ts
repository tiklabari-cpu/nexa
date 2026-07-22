/**
 * Customer tokens for the widget.
 *
 * Stateless and HMAC-signed rather than stored, because they are minted for
 * every anonymous visitor: persisting one row per browser that ever loaded a
 * page carrying the widget would dwarf the conversation data itself.
 *
 * The trade-off is that an individual token cannot be revoked. That is
 * acceptable here and only here: the TTL is short, a customer token grants
 * nothing beyond the Customer Chat API for one organization (I4), and the
 * things that must take effect immediately — customer bans, license expiry —
 * are checked per request against live data rather than trusted from the token.
 */
import { createHmac } from 'node:crypto';
import { constantTimeEqual } from '../../lib/crypto.js';
import type { CustomerPrincipal } from './principal.js';

interface CustomerTokenPayload {
  /** Customer uuid. */
  sub: string;
  /** Organization uuid — the only tenant this token can ever reach. */
  org: string;
  /** License id, as a string because JSON has no bigint. */
  lic: string;
  /** Issued at / expires at, seconds since epoch. */
  iat: number;
  exp: number;
}

export type CustomerTokenRejection = 'malformed' | 'bad_signature' | 'expired';

export type CustomerTokenVerification =
  { ok: true; principal: CustomerPrincipal } | { ok: false; reason: CustomerTokenRejection };

/** Distinguishes these from any other HMAC the system produces. */
const TOKEN_PREFIX = 'nxc1';

export class CustomerTokenService {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
  ) {
    if (secret.length < 32) {
      throw new Error('CUSTOMER_TOKEN_SECRET must be at least 32 characters.');
    }
  }

  issue(input: { customerId: string; organizationId: string; licenseId: bigint }): {
    token: string;
    expiresIn: number;
  } {
    const now = Math.floor(Date.now() / 1000);
    const payload: CustomerTokenPayload = {
      sub: input.customerId,
      org: input.organizationId,
      lic: input.licenseId.toString(),
      iat: now,
      exp: now + this.ttlSeconds,
    };

    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return {
      token: `${TOKEN_PREFIX}.${body}.${this.#sign(body)}`,
      expiresIn: this.ttlSeconds,
    };
  }

  verify(token: string): CustomerTokenVerification {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
      return { ok: false, reason: 'malformed' };
    }
    const [, body, signature] = parts as [string, string, string];

    // Signature first: never parse a payload that has not been authenticated.
    if (!constantTimeEqual(this.#sign(body), signature)) {
      return { ok: false, reason: 'bad_signature' };
    }

    let payload: CustomerTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CustomerTokenPayload;
    } catch {
      return { ok: false, reason: 'malformed' };
    }

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.org !== 'string' ||
      typeof payload.lic !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      return { ok: false, reason: 'malformed' };
    }
    if (payload.exp * 1000 <= Date.now()) {
      return { ok: false, reason: 'expired' };
    }

    let licenseId: bigint;
    try {
      licenseId = BigInt(payload.lic);
    } catch {
      return { ok: false, reason: 'malformed' };
    }

    return {
      ok: true,
      principal: {
        kind: 'customer',
        customerId: payload.sub,
        organizationId: payload.org,
        licenseId,
      },
    };
  }

  #sign(body: string): string {
    return createHmac('sha256', this.secret).update(`${TOKEN_PREFIX}.${body}`).digest('base64url');
  }
}
