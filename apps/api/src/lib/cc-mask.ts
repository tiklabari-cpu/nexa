/**
 * Card-number masking at write time (FR-MOD-08.9.5 · NFR-C5/S9 · PCI SAQ A).
 *
 * A visitor or an agent can type a card number straight into a live
 * conversation. The requirement is that a PAN is written **masked** to the
 * database and to logs — not merely hidden in the UI — so a raw card number
 * never comes to rest in `events.text`, a ticket subject, a transcript e-mail,
 * an audit row or a request log. Masking therefore happens at the write paths
 * (`chats.ts`, `customer.ts`, `email-inbound.ts`), before the value is
 * persisted, pushed over realtime or handed to the AI skill matcher.
 *
 * Detection is Luhn-gated on purpose. A run of 13–19 digits is only a
 * *candidate*; masking every such run would eat order numbers, long phone
 * numbers and identifiers. The Luhn (mod-10) checksum is the line between "looks
 * like digits" and "is a card number", and it is what the negative tests pin: a
 * 16-digit order number that fails Luhn is left untouched, and a phone number,
 * UUID or timestamp is never a candidate in the first place.
 *
 * The trade deliberately favours over-masking a Luhn-valid non-card (rare) over
 * leaking a real PAN (the thing PCI SAQ A cares about) — a chosen false-positive
 * bias, not an accident.
 *
 * Since tm 300.1 the detector lives in `sensitive-mask.ts`, which masks the
 * other seven sensitive types too (AI-26). This module is the cards-only view of
 * it, kept so existing callers behave exactly as before until they move to
 * `maskSensitive`. Two edges changed, both toward not masking a non-card: a
 * Luhn-valid run inside a valid IBAN or inside a hex string (a TXID) is no
 * longer taken for a card.
 */
import type { SensitivePolicy } from '@siyahtus/types';
import { maskSensitive } from './sensitive-mask.js';

const CARDS_ONLY: SensitivePolicy = Object.freeze({
  customer: ['card'],
  agent: ['card'],
  bot: ['card'],
});

/**
 * Replace every Luhn-valid 13–19 digit card number in `input` with
 * `**** **** **** 1234`, preserving the last four digits. Digit runs that are
 * not a valid card (wrong length, failed Luhn) are returned untouched, as is any
 * text with no card in it.
 */
export function maskCardNumbers(input: string): string {
  if (!input) return input;
  return maskSensitive(input, { author: 'customer', policy: CARDS_ONLY }).text;
}

/**
 * Mask a value that may be absent — the shape the write paths carry, where a
 * free-text field is `string | null | undefined` (an optional message, a
 * cleared custom field). A non-string is returned unchanged so callers can pass
 * the field through without widening its type.
 */
export function maskOptional<T extends string | null | undefined>(value: T): T {
  return (typeof value === 'string' ? maskCardNumbers(value) : value) as T;
}
