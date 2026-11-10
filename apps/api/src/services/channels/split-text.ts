/**
 * Split an outbound channel message at the provider's per-message limit.
 *
 * Telegram, WhatsApp and the Meta messaging channels all cap a message at a
 * number of UTF-16 code units, and `String.prototype.slice` counts the same
 * unit — so a plain `slice(start, start + max)` can cut an astral character
 * (an emoji is a high + low surrogate pair) in half, and the receiver then
 * shows "�" on both sides of the cut. This splitter never does that.
 *
 * Rules, in order, for each part of at most `max` units:
 *   1. the rest fits → it is the last part;
 *   2. otherwise cut after the last whitespace in the second half of the
 *      window (a break between words reads better than one inside a word; the
 *      first half is skipped so a stray early space does not leave a tiny part);
 *   3. otherwise cut at `max`, one unit earlier when that would separate a high
 *      surrogate (0xD800–0xDBFF) from its low surrogate.
 * The parts concatenate back to the input exactly (nothing is trimmed).
 *
 * Not handled: grapheme clusters (a ZWJ emoji sequence or a flag can still be
 * cut between its code points) — each side stays valid text, only the glyph
 * changes. `max` below 2 is raised to 2 so a pair always fits.
 */
export function splitText(text: string, max: number): string[] {
  const limit = Math.max(2, Math.floor(max));
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let start = 0;
  while (text.length - start > limit) {
    const windowEnd = start + limit;
    let end = lastWhitespaceBreak(text, start + Math.floor(limit / 2), windowEnd);
    if (end < 0) {
      end = windowEnd;
      if (isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  parts.push(text.slice(start));
  return parts;
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

/** The index just after the last whitespace in `[from, to)`, or -1. */
function lastWhitespaceBreak(text: string, from: number, to: number): number {
  for (let i = to - 1; i >= from; i -= 1) {
    if (/\s/.test(text.charAt(i))) return i + 1;
  }
  return -1;
}
