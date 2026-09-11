import type { ReactNode } from 'react';
import { parseRichText } from '@nexa/types';

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

/**
 * The composer's markdown subset — `**bold**`, `*italic*`, `- ` bullet lines —
 * rendered as React elements, never HTML. There is no `dangerouslySetInnerHTML`
 * here or anywhere in the transcript, so this is exactly as safe against
 * injection as the plain-text span it replaces (`#### K02.3.5`). Callers gate
 * it to non-customer authors as a *product* decision — a customer's literal
 * asterisks should read back exactly as they typed them, not be reinterpreted
 * — not a security boundary.
 *
 * The subset itself is defined once, in `@nexa/types#parseRichText`, because
 * the customer widget has to read back exactly what this shows the agent
 * (`apps/widget/src/rich-text.ts`, tm 235). Only the parse is shared: this
 * side makes React elements, that side makes DOM nodes.
 */
export function renderRichText(text: string): ReactNode {
  return parseRichText(text).map((segment, index) => {
    if (segment.type === 'bold') return <strong key={index}>{segment.content}</strong>;
    if (segment.type === 'italic') return <em key={index}>{segment.content}</em>;
    return segment.content;
  });
}
