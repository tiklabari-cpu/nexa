/**
 * The visitor's unsent draft as an agent may see it (tm 417 · K5).
 *
 * `POST /customer/chat/typing` carries what a visitor has typed but not sent.
 * The assigned agent sees it live, so it is cleaned once, here, before it
 * leaves the API. The order is fixed, and each step leans on the one before:
 *
 *   1. **Cut to 500 code points** (`SNEAK_PEEK_MAX_LENGTH`), first, so no later
 *      step ever walks more than that — whatever length the caller sent.
 *   2. **Drop control and bidi-override characters.** C0/C1 controls (a tab and
 *      a newline stay) and U+202A–202E / U+2066–2069: a draft that flips the
 *      agent's line right-to-left can make `1234` read as `4321`.
 *   3. **NFKC.** Full-width and other compatibility digits (`４１１１`) become
 *      ASCII, so the card masker below sees the digits it knows.
 *   4. **`maskForWrite(…, 'customer')`** — the mask every visitor message is
 *      stored under (AI-26): a whole card, a code, a password.
 *   5. **The trailing half-typed card.** The masker needs a whole, Luhn-valid
 *      number, and a draft is by definition unfinished: `4111 1111 11` is a
 *      card on its way. The digit run at the very end is masked with `•` when
 *      it looks like one — a group of exactly four, a separator and more
 *      digits, or twelve digits in a row — or when step 1 cut through it.
 *      `siparişim 1234567` stays readable. Found by one backward walk from the
 *      end, not a regex, so it is linear in the run it inspects.
 *   6. **Trim**, then a last cut to 500 (NFKC can lengthen a string).
 *
 * Pure and synchronous. Nothing here logs or stores the text.
 */
import { SNEAK_PEEK_MAX_LENGTH } from '@siyahtus/types';
import { maskForWrite } from './sensitive-mask.js';

/** What a digit of a half-typed card is shown as. */
export const PARTIAL_CARD_DIGIT = '•';

/** A digit run this long at the end of a draft is masked whatever its grouping. */
const PARTIAL_CARD_RUN = 12;

export function sanitizeTypingPreview(raw: string): string {
  const { text: cut, midNumber } = cutCodePoints(raw, SNEAK_PEEK_MAX_LENGTH);
  const normalised = stripControls(cut).normalize('NFKC');
  const masked = maskForWrite(normalised, 'customer').text;
  return cutCodePoints(maskTrailingCard(masked, midNumber).trim(), SNEAK_PEEK_MAX_LENGTH).text;
}

/**
 * The first `max` code points of `text`. `midNumber` says the cut fell inside
 * a run of digits and separators — the kept tail is the start of a longer
 * number, which may be a card.
 */
function cutCodePoints(text: string, max: number): { text: string; midNumber: boolean } {
  let index = 0;
  let count = 0;
  while (index < text.length && count < max) {
    index += (text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
    count += 1;
  }
  if (index >= text.length) return { text, midNumber: false };
  const kept = text.slice(0, index);
  const last = String.fromCodePoint(kept.codePointAt(kept.length - 1) ?? 0);
  const next = String.fromCodePoint(text.codePointAt(index) ?? 0);
  return { text: kept, midNumber: isNumberChar(last) && isNumberChar(next) };
}

/** A digit in any script, or a card separator — before NFKC has run. */
function isNumberChar(char: string): boolean {
  return /^[\p{Nd}\s.\-/]$/u.test(char) || /^[－．／]$/.test(char);
}

/** C0/C1 controls except tab and newline, and the bidi embeddings, overrides and isolates. */
function stripControls(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const control =
      (code <= 0x1f && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
    const bidi = (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
    if (!control && !bidi) out += char;
  }
  return out;
}

function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/** `[\s.\-/]` — what a card's digits are grouped by. */
function isSeparator(code: number): boolean {
  if (code === 0x2e || code === 0x2d || code === 0x2f) return true;
  return /\s/.test(String.fromCharCode(code));
}

/**
 * Mask the digit run the text ends in when it looks like a card being typed.
 * Separators stay, so the agent still sees the shape: `4111 11` → `•••• ••`.
 */
function maskTrailingCard(text: string, force: boolean): string {
  let start = text.length;
  while (start > 0) {
    const code = text.charCodeAt(start - 1);
    if (!isAsciiDigit(code) && !isSeparator(code)) break;
    start -= 1;
  }
  if (start === text.length) return text;

  let digits = 0;
  let group = 0;
  let longest = 0;
  // A group of exactly four has ended at a separator — any digit after it
  // makes the run card-shaped (`4111 1`, `4111.1111.11`).
  let fourEnded = false;
  let fourThenMore = false;
  for (let index = start; index < text.length; index += 1) {
    if (isAsciiDigit(text.charCodeAt(index))) {
      digits += 1;
      group += 1;
      if (fourEnded) fourThenMore = true;
      continue;
    }
    if (group === 4) fourEnded = true;
    longest = Math.max(longest, group);
    group = 0;
  }
  longest = Math.max(longest, group);

  const cardShaped = fourThenMore || longest >= PARTIAL_CARD_RUN;
  if (digits === 0 || !(cardShaped || force)) return text;

  let tail = '';
  for (let index = start; index < text.length; index += 1) {
    tail += isAsciiDigit(text.charCodeAt(index)) ? PARTIAL_CARD_DIGIT : text[index];
  }
  return text.slice(0, start) + tail;
}
