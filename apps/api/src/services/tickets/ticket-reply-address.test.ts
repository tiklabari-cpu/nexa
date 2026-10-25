/**
 * The signed ticket reply address (tm 358 · SiyahTuş analysis HD-03).
 *
 * The address is a credential: whoever holds it writes into the ticket. So the
 * negatives carry this file — a signature from another licence, another
 * secret, another ticket or one changed character opens nothing — beside the
 * shape the inbound route and the forwarding-address vocabulary depend on.
 */
import { describe, expect, it } from 'vitest';
import { parseRecipient } from '../channels/email-inbound.js';
import { LABEL_RE } from '../channels/inbound-email-address.js';
import { TicketReplyAddresses, isReplyLabel } from './ticket-reply-address.js';

const SECRET = 'dev-only-customer-token-secret-at-least-32-chars';
const DOMAIN = 'inbound.siyahtus.localhost';
const ORG = '0b6f9a4e-2c1d-4e8f-9a7b-3c5d7e9f1a2b';
const TICKET = 'TJ1H8CFKRV';
const tenant = { licenseId: 42n, organizationId: ORG };

const addresses = new TicketReplyAddresses(SECRET, DOMAIN);

describe('TicketReplyAddresses', () => {
  it('writes <org>+t-<ticket>-<signature>@<inbound domain>, a 21-character label', () => {
    const address = addresses.addressFor(tenant, TICKET);
    expect(address).toMatch(
      new RegExp(`^${ORG}\\+t-tj1h8cfkrv-[0-9a-hjkmnp-tv-z]{8}@inbound\\.siyahtus\\.localhost$`),
    );
    const label = addresses.labelFor(tenant.licenseId, TICKET);
    expect(label).toHaveLength(21);
    // A label of the forwarding-address vocabulary, and a local part a mail
    // server takes (RFC 5321 §4.5.3.1.1: 64 octets).
    expect(LABEL_RE.test(label)).toBe(true);
    expect(address.split('@')[0]!.length).toBeLessThanOrEqual(64);
  });

  it('is the same address every time for the same ticket', () => {
    expect(addresses.addressFor(tenant, TICKET)).toBe(addresses.addressFor(tenant, TICKET));
    expect(addresses.labelFor(tenant.licenseId, TICKET.toLowerCase())).toBe(
      addresses.labelFor(tenant.licenseId, TICKET),
    );
  });

  it('reads its own label back to the ticket id, as tickets store it', () => {
    const recipient = parseRecipient(addresses.addressFor(tenant, TICKET));
    expect(recipient?.organizationId).toBe(ORG);
    expect(addresses.ticketOf(tenant.licenseId, recipient!.label!)).toBe(TICKET);
  });

  it('refuses a label signed for another licence, ticket or secret', () => {
    const label = addresses.labelFor(tenant.licenseId, TICKET);
    expect(addresses.ticketOf(43n, label)).toBeNull();
    expect(new TicketReplyAddresses(`${SECRET}-rotated`, DOMAIN).ticketOf(42n, label)).toBeNull();
    const other = addresses.labelFor(tenant.licenseId, 'TJ1H8CFKRW');
    // The other ticket's signature on this ticket's id.
    expect(addresses.ticketOf(42n, `t-tj1h8cfkrv-${other.slice(-8)}`)).toBeNull();
  });

  it('refuses a label with any one character of its signature changed', () => {
    const label = addresses.labelFor(tenant.licenseId, TICKET);
    for (let i = label.length - 8; i < label.length; i += 1) {
      const swapped = label[i] === '0' ? '1' : '0';
      const forged = `${label.slice(0, i)}${swapped}${label.slice(i + 1)}`;
      expect(addresses.ticketOf(tenant.licenseId, forged), forged).toBeNull();
    }
  });

  it('refuses what is not a reply label at all', () => {
    for (const label of [
      'support',
      't-tj1h8cfkrv',
      't-tj1h8cfkrv-8x2k4m6',
      'x-tj1h8cfkrv-8x2k4m6p',
    ]) {
      expect(isReplyLabel(label), label).toBe(false);
      expect(addresses.ticketOf(tenant.licenseId, label), label).toBeNull();
    }
    // Crockford leaves out i, l, o and u: no ticket id holds one.
    expect(isReplyLabel('t-tj1h8cfkro-8x2k4m6p')).toBe(false);
  });
});
