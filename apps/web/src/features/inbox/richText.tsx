import type { ReactNode } from 'react';

/** A caret (`start === end`) or selection range in a `<textarea>`. */
export interface TextRange {
  start: number;
  end: number;
}

interface EditResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Wraps the selection in `marker` (`**` for bold, `*` for italic) — or, with
 * nothing selected, drops an empty pair with the caret left in between so the
 * next keystrokes land inside it. No toggle-off: `**` and `*` share a
 * character, so a naive "already wrapped, strip it" check misreads a bold
 * selection as already-italic. Re-running the button twice just doubles the
 * markers, the same trade every one-shot toolbar button in this composer
 * already makes (the `#` picker does not toggle either).
 */
export function wrapSelection(value: string, range: TextRange, marker: string): EditResult {
  const before = value.slice(0, range.start);
  const selected = value.slice(range.start, range.end);
  const after = value.slice(range.end);
  const selectionStart = range.start + marker.length;
  return {
    text: `${before}${marker}${selected}${marker}${after}`,
    selectionStart,
    selectionEnd: selectionStart + selected.length,
  };
}

/**
 * Prefixes every line the selection touches with `- `, skipping a line that
 * already carries it. Whole-line rather than whole-selection: a caret
 * anywhere in a line, or a partial selection into one, still marks that
 * entire line — the way every other list-toggling editor treats it.
 */
export function applyBulletPrefix(value: string, range: TextRange): EditResult {
  const lineStart = range.start === 0 ? 0 : value.lastIndexOf('\n', range.start - 1) + 1;
  // One back from `end`: a selection that ends exactly at the next line's
  // first character (a triple-click, say) must not pull that line in too.
  const searchFrom = Math.max(range.end - 1, lineStart);
  const nextBreak = value.indexOf('\n', searchFrom);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;

  const block = value.slice(lineStart, lineEnd);
  const nextBlock = block
    .split('\n')
    .map((line) => (line.startsWith('- ') ? line : `- ${line}`))
    .join('\n');

  return {
    text: value.slice(0, lineStart) + nextBlock + value.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + nextBlock.length,
  };
}

interface Segment {
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

/** Malformed markdown (an unclosed `**`) finds no closing pair and falls out as plain text, never throws. */
function parseInline(source: string): Segment[] {
  const segments: Segment[] = [];
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

/**
 * A `- ` line prefix becomes a bullet glyph — one substituted character, not
 * a semantic `<ul>`: nothing here needs list/listitem ARIA machinery for a
 * single-character marker, and a real list would force block-per-line layout
 * where this instead rides the same `white-space: pre-wrap` span the plain
 * text already used.
 */
function markBullets(source: string): string {
  return source
    .split('\n')
    .map((line) => (line.startsWith('- ') ? `•${line.slice(1)}` : line))
    .join('\n');
}

/**
 * The composer's markdown subset — `**bold**`, `*italic*`, `- ` bullet lines —
 * rendered as React elements, never HTML. There is no `dangerouslySetInnerHTML`
 * here or anywhere in the transcript, so this is exactly as safe against
 * injection as the plain-text span it replaces (`#### K02.3.5`). Callers gate
 * it to non-customer authors as a *product* decision — a customer's literal
 * asterisks should read back exactly as they typed them, not be reinterpreted
 * — not a security boundary.
 */
export function renderRichText(text: string): ReactNode {
  return parseInline(markBullets(text)).map((segment, index) => {
    if (segment.type === 'bold') return <strong key={index}>{segment.content}</strong>;
    if (segment.type === 'italic') return <em key={index}>{segment.content}</em>;
    return segment.content;
  });
}
