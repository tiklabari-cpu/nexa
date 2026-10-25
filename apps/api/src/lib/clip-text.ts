/**
 * Text cut to a length the database is asked to keep (tm 357 · HD-02).
 *
 * Two rules a plain `slice` breaks: a surrogate pair is never split — a lone
 * half is not valid UTF-8, and Postgres would refuse it or keep a replacement
 * character — and the reader is told the text was cut, on a line of its own.
 * Clip *after* masking: a card number cut in half no longer passes the Luhn
 * check, and its first twelve digits would be kept in clear.
 */
const MARKER = '\n[…]';

export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max - MARKER.length);
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}${MARKER}`;
}
