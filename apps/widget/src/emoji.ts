/**
 * The widget composer's emoji picker (FR-MOD-11.4).
 *
 * A small curated, categorised set — not a full Unicode board or a
 * third-party picker library, the same call `apps/web`'s composer made for
 * the same tool (tm 189.5, `apps/web/src/features/inbox/emoji.ts`). The two
 * do not share this module: the widget's gzip budget (NFR-P3, 50 KB for the
 * *whole* artifact) is far tighter than the panel's, and importing across
 * `apps/web`/`apps/widget` would couple two independently built bundles for
 * the sake of ~24 glyphs — more coupling than the saving is worth.
 */
export interface WidgetEmojiCategory {
  id: string;
  items: readonly string[];
}

export const WIDGET_EMOJI_CATEGORIES: readonly WidgetEmojiCategory[] = [
  { id: 'smileys', items: ['😀', '😂', '🙂', '😊', '😍', '😮', '😢', '😅'] },
  { id: 'gestures', items: ['👍', '👎', '👏', '🙏', '👋', '💪', '🤝', '✌️'] },
  { id: 'symbols', items: ['❤️', '🔥', '🎉', '✅', '⭐', '💯', '⚠️', '❓'] },
];

/**
 * Splices `insertion` at `caret`, leaving the rest of `value` intact — no
 * trailing space, so a visitor chaining emoji (`🎉🎉🎉`) is not fought by one.
 *
 * Caret math is in UTF-16 code units throughout (`String#length`/`#slice`),
 * the same unit `<textarea>`'s own `selectionStart`/`maxLength` use — so a
 * surrogate-pair emoji (`😀` is 2 code units, not 1 character) never lands the
 * caret inside a pair, and a length check against `insertion.length` here
 * agrees with a length check against the resulting `.value.length` anywhere
 * else (the composer's `maxLength`, the server's `z.string().max()`).
 */
export function insertEmojiAtCaret(
  value: string,
  caret: number,
  insertion: string,
): { text: string; caret: number } {
  const before = value.slice(0, caret);
  const after = value.slice(caret);
  return { text: `${before}${insertion}${after}`, caret: before.length + insertion.length };
}
