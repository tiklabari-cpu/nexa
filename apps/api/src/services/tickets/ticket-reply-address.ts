/**
 * The address a player answers a ticket at (SiyahTuş analysis HD-03 · tm 358).
 *
 * Every reply and notice a ticket sends carries a `Reply-To` that names it:
 *
 *     <organization_id>+t-<ticket id>-<signature>@<inbound domain>
 *
 * an ordinary sub-address of the workspace's default forwarding address, so a
 * provider that delivers `<org>@…` delivers this too, and the inbound route
 * resolves the workspace from the organization id exactly as it always has.
 * The label is 21 characters of `[a-z0-9-]` — the forwarding-address label
 * vocabulary (`LABEL_RE`) — and has no row in `inbound_email_addresses`: the
 * ticket is in the address, and the signature is what makes it believable.
 *
 * **Why a signature.** Whoever knows the address could otherwise write into any
 * ticket whose id they can guess or have seen — the id is printed in every
 * subject. The signature is an HMAC over the ticket id under a key only this
 * deployment holds, cut to 40 bits (8 Crockford characters): guessing one is a
 * mail per try against a webhook that rate-limits senders, and a wrong one
 * matches nothing — the mail is treated as if the label were not there.
 *
 * **The key.** Per licence, derived from `CUSTOMER_TOKEN_SECRET` — the secret
 * that already signs what this deployment hands a customer to come back with —
 * under a label of its own, so no value computed here is one the customer-token
 * code would accept, or the other way round, and nothing new has to be stored,
 * encrypted or required at boot. Rotating the secret retires every address
 * already sent; an answer to one still finds its ticket by `In-Reply-To`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Crockford Base32 as the local part carries it — lower case, `parseRecipient` folds it. */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** The label a reply address carries: `t-<ticket id>-<signature>`. */
const REPLY_LABEL_RE = /^t-([0-9a-hjkmnp-tv-z]{10})-([0-9a-hjkmnp-tv-z]{8})$/;

/** Domain separation for the per-licence key (see the module comment). */
const KEY_LABEL = 'siyahtus/ticket-reply-address/v1';

/** Whether a forwarding-address label has the reply-address shape, signed or not. */
export function isReplyLabel(label: string): boolean {
  return REPLY_LABEL_RE.test(label);
}

/** The first five bytes of `digest` as eight Crockford characters (40 bits). */
function base32Of(digest: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of digest.subarray(0, 5)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

export class TicketReplyAddresses {
  readonly #secret: string;
  readonly #domain: string;

  constructor(secret: string, domain: string) {
    this.#secret = secret;
    this.#domain = domain;
  }

  /** `t-<ticket id>-<signature>` for this licence's ticket. */
  labelFor(licenseId: bigint, ticketId: string): string {
    const id = ticketId.toLowerCase();
    return `t-${id}-${this.#signature(licenseId, id)}`;
  }

  /** The whole `Reply-To` address. */
  addressFor(tenant: { licenseId: bigint; organizationId: string }, ticketId: string): string {
    const local = `${tenant.organizationId}+${this.labelFor(tenant.licenseId, ticketId)}`;
    return `${local.toLowerCase()}@${this.#domain}`;
  }

  /**
   * The ticket a reply label names, when its signature is this licence's — the
   * id upper-cased back to how tickets store it — or null: not a reply label,
   * or one whose signature does not verify (forged, damaged, another licence's,
   * or signed under a secret since rotated). Compared in constant time.
   */
  ticketOf(licenseId: bigint, label: string): string | null {
    const match = REPLY_LABEL_RE.exec(label);
    if (!match) return null;
    const [, id, signature] = match as unknown as [string, string, string];
    const expected = Buffer.from(this.#signature(licenseId, id));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return id.toUpperCase();
  }

  #signature(licenseId: bigint, lowerTicketId: string): string {
    const key = createHmac('sha256', this.#secret).update(`${KEY_LABEL}|${licenseId}`).digest();
    return base32Of(createHmac('sha256', key).update(`ticket|${lowerTicketId}`).digest());
  }
}
