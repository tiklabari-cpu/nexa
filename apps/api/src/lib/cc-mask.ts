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
 */

/** The masked form the KK names verbatim; the last four digits are preserved. */
const MASK_PREFIX = '**** **** **** ';

/**
 * A run of 13–19 digits, its groups optionally split by a single space or
 * hyphen ("4111 1111 1111 1111" / "4111-1111-1111-1111" / contiguous). The
 * digit-boundary lookarounds stop a longer number — a 20-digit account, an
 * all-digit id — from having a card-length window carved out of its middle.
 *
 * The `[ -]` class is space-or-hyphen: the hyphen is the final character in the
 * class, so it is a literal, not a range. The separator is kept this narrow on
 * purpose — allowing arbitrary whitespace would let a line break splice two
 * unrelated numbers into one false candidate.
 */
const CARD_CANDIDATE = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;

/** Luhn (mod-10) checksum — the check every card network's PAN satisfies. */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48; // '0' is 48
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Replace every Luhn-valid 13–19 digit card number in `input` with
 * `**** **** **** 1234`, preserving the last four digits. Digit runs that are
 * not a valid card (wrong length, failed Luhn) are returned untouched, as is any
 * text with no card in it.
 */
export function maskCardNumbers(input: string): string {
  if (!input) return input;
  return input.replace(CARD_CANDIDATE, (match) => {
    const digits = match.replace(/[ -]/g, '');
    if (digits.length < 13 || digits.length > 19) return match;
    if (!luhnValid(digits)) return match;
    return MASK_PREFIX + digits.slice(-4);
  });
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
