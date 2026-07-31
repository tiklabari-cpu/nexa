import { describe, expect, it } from 'vitest';
import { maskCardNumbers, maskOptional } from './cc-mask.js';

/**
 * FR-MOD-08.9.5 — card masking at write time.
 *
 * The negatives come first and are the point of the guard: a Luhn check that
 * masked too eagerly would eat order numbers and phone numbers, turning a
 * privacy control into a data-loss bug. Only once the false-positive boundary
 * holds do the positives matter.
 */
describe('maskCardNumbers', () => {
  // --- Negatives: what must NOT be masked ----------------------------------

  it('leaves a 16-digit order number that fails Luhn untouched', () => {
    // 16 digits, but not a card — the Luhn check is the whole boundary.
    expect(maskCardNumbers('order 1234567890123456 shipped')).toBe(
      'order 1234567890123456 shipped',
    );
  });

  it('does not touch a phone number', () => {
    expect(maskCardNumbers('call me on 555 123 4567')).toBe('call me on 555 123 4567');
    expect(maskCardNumbers('+90 212 555 0199')).toBe('+90 212 555 0199');
  });

  it('does not touch a UUID', () => {
    const uuid = 'ref 550e8400-e29b-41d4-a716-446655440000 ok';
    expect(maskCardNumbers(uuid)).toBe(uuid);
  });

  it('does not touch a unix timestamp', () => {
    expect(maskCardNumbers('seen at 1706659200')).toBe('seen at 1706659200');
    expect(maskCardNumbers('millis 1706659200000')).toBe('millis 1706659200000');
  });

  it('does not carve a card-length window out of a longer digit run', () => {
    // A 20-digit account number never becomes a candidate…
    expect(maskCardNumbers('acct 12345678901234567890 x')).toBe('acct 12345678901234567890 x');
    // …and a valid 16-digit card glued inside a 19-digit run is not extracted:
    // the whole run is one candidate and it fails Luhn as a whole.
    expect(maskCardNumbers('9994111111111111111')).toBe('9994111111111111111');
  });

  it('leaves runs shorter than 13 digits alone', () => {
    expect(maskCardNumbers('pin 411111111111')).toBe('pin 411111111111'); // 12 digits
  });

  it('returns empty / whitespace input unchanged', () => {
    expect(maskCardNumbers('')).toBe('');
    expect(maskCardNumbers('no digits here')).toBe('no digits here');
  });

  // --- Positives: valid PANs, in every separator form ----------------------

  it('masks a contiguous 16-digit Visa, keeping the last four', () => {
    expect(maskCardNumbers('4111111111111111')).toBe('**** **** **** 1111');
  });

  it('masks a space-separated card', () => {
    expect(maskCardNumbers('4111 1111 1111 1111')).toBe('**** **** **** 1111');
  });

  it('masks a hyphen-separated card', () => {
    expect(maskCardNumbers('4111-1111-1111-1111')).toBe('**** **** **** 1111');
  });

  it('masks a card embedded in a sentence, preserving the surrounding text', () => {
    expect(maskCardNumbers('here is my card 4111111111111111 thanks')).toBe(
      'here is my card **** **** **** 1111 thanks',
    );
  });

  it('masks 13-, 15- and 19-digit PANs (the length range)', () => {
    expect(maskCardNumbers('4222222222222')).toBe('**** **** **** 2222'); // 13
    expect(maskCardNumbers('378282246310005')).toBe('**** **** **** 0005'); // 15 (Amex)
    expect(maskCardNumbers('4111111111111111110')).toBe('**** **** **** 1110'); // 19
  });

  it('masks a Mastercard and Discover test PAN', () => {
    expect(maskCardNumbers('5555555555554444')).toBe('**** **** **** 4444');
    expect(maskCardNumbers('6011111111111117')).toBe('**** **** **** 1117');
  });

  it('masks every card when more than one appears', () => {
    expect(maskCardNumbers('cards 4111111111111111 and 5555555555554444')).toBe(
      'cards **** **** **** 1111 and **** **** **** 4444',
    );
  });
});

describe('maskOptional', () => {
  it('passes null and undefined through unchanged', () => {
    expect(maskOptional(null)).toBeNull();
    expect(maskOptional(undefined)).toBeUndefined();
  });

  it('masks a present string', () => {
    expect(maskOptional('pay 4111111111111111')).toBe('pay **** **** **** 1111');
  });
});
