/**
 * The composer's markdown subset — `**bold**`, `*italic*`, `- ` bullet lines —
 * as a parser, shared by the two surfaces that have to agree on it: the agent
 * console's transcript and the customer widget's (FR-MOD-02.3.5, FR-MOD-11.4).
 *
 * Only the *parser* lives here. The console builds React elements and the
 * widget builds DOM nodes, and there is nothing worth abstracting between a
 * `ReactNode` and an `HTMLElement` — what must not be written twice is the
 * definition of the subset, since two copies drift and the visitor then reads
 * something the agent did not write.
 *
 * It parses and never renders: no markup string is produced anywhere in this
 * module, so no caller can end up with one to hand to `innerHTML` (NFR-S6).
 */

export interface RichTextSegment {
  type: 'text' | 'bold' | 'italic';
  content: string;
}

/**
 * `**bold**` before `*italic*`, so a lazy `.+?` never stops at the first half
 * of a double marker. `.` does not match `\n` (no `s` flag), which is what
 * keeps a marker from spanning two lines without any extra code — the lazy
 * quantifier simply cannot find a closing pair across the break.
 */
const INLINE_PATTERN = /\*\*(.+?)\*\*|\*(.+?)\*/g;

/**
 * A `- ` line prefix becomes a bullet glyph — one substituted character, not
 * a semantic list: nothing here needs list/listitem ARIA machinery for a
 * single-character marker, and a real list would force block-per-line layout
 * where both callers instead ride the `white-space: pre-wrap` container the
 * plain text already used.
 */
function markBullets(source: string): string {
  return source
    .split('\n')
    .map((line) => (line.startsWith('- ') ? `•${line.slice(1)}` : line))
    .join('\n');
}

/** Malformed markdown (an unclosed `**`) finds no closing pair and falls out as plain text, never throws. */
export function parseRichText(text: string): RichTextSegment[] {
  const source = markBullets(text);
  const segments: RichTextSegment[] = [];
  let cursor = 0;
  for (const match of source.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ type: 'text', content: source.slice(cursor, index) });
    if (match[1] !== undefined) segments.push({ type: 'bold', content: match[1] });
    else segments.push({ type: 'italic', content: match[2]! });
    cursor = index + match[0].length;
  }
  if (cursor < source.length) segments.push({ type: 'text', content: source.slice(cursor) });
  return segments;
}
