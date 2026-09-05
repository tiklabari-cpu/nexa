/**
 * The composer's emoji picker (FR-MOD-02.3.5).
 *
 * A small curated, categorised set rather than a full Unicode board or a
 * third-party picker library — the PRD names the tool, not an emoji keyboard,
 * and a dependency here is weight `apps/web`'s own bundle would carry for a
 * handful of glyphs. The widget's own composer (FR-MOD-11.4, tm 195.2) is a
 * separate surface and untouched by this file.
 */
export interface EmojiCategory {
  id: string;
  items: readonly string[];
}

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  { id: 'smileys', items: ['😀', '😂', '🙂', '😊', '😍', '😮', '😢', '😅'] },
  { id: 'gestures', items: ['👍', '👎', '👏', '🙏', '👋', '💪', '🤝', '✌️'] },
  { id: 'symbols', items: ['❤️', '🔥', '🎉', '✅', '⭐', '💯', '⚠️', '❓'] },
];

/**
 * Splices `insertion` at `caret` — no trailing space, unlike the canned-reply
 * shortcut's `applyShortcut`. That one text replaces a whole phrase an agent
 * then keeps typing after; an emoji is often chained with another one
 * (`🎉🎉🎉`), and a forced space after each click would fight that.
 */
export function insertAtCaret(
  value: string,
  caret: number,
  insertion: string,
): { text: string; caret: number } {
  const before = value.slice(0, caret);
  const after = value.slice(caret);
  return { text: `${before}${insertion}${after}`, caret: before.length + insertion.length };
}
