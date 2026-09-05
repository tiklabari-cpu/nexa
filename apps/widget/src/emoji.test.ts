import { describe, expect, it } from 'vitest';
import { insertEmojiAtCaret, WIDGET_EMOJI_CATEGORIES } from './emoji.js';

describe('insertEmojiAtCaret (FR-MOD-11.4)', () => {
  it('splices the insertion at the caret, leaving the rest of the text intact', () => {
    const result = insertEmojiAtCaret('Hello !', 6, '👍');
    expect(result.text).toBe('Hello 👍!');
    expect(result.caret).toBe(8);
  });

  it('adds no trailing space, so a second insertion can sit right next to the first', () => {
    const first = insertEmojiAtCaret('', 0, '🎉');
    const second = insertEmojiAtCaret(first.text, first.caret, '🎉');
    expect(second.text).toBe('🎉🎉');
  });

  it('inserts at the start and at the end of existing text', () => {
    expect(insertEmojiAtCaret('world', 0, 'hi ').text).toBe('hi world');
    expect(insertEmojiAtCaret('hello', 5, ' world').text).toBe('hello world');
  });

  it('advances the caret by UTF-16 code units, not glyphs — a surrogate pair is 2, not 1', () => {
    // U+1F600 GRINNING FACE encodes as a surrogate pair: `.length` is 2.
    expect('😀'.length).toBe(2);
    const result = insertEmojiAtCaret('ab', 1, '😀');
    expect(result.text).toBe('a😀b');
    expect(result.caret).toBe(3);
    // The pair lands whole — slicing at the reported caret never splits it.
    expect(result.text.slice(1, 3)).toBe('😀');
  });
});

describe('WIDGET_EMOJI_CATEGORIES (FR-MOD-11.4)', () => {
  it('is a small, non-empty, categorised set — not a full Unicode board', () => {
    expect(WIDGET_EMOJI_CATEGORIES.length).toBeGreaterThan(0);
    for (const category of WIDGET_EMOJI_CATEGORIES) {
      expect(category.id.length).toBeGreaterThan(0);
      expect(category.items.length).toBeGreaterThan(0);
    }
    const total = WIDGET_EMOJI_CATEGORIES.reduce((sum, category) => sum + category.items.length, 0);
    expect(total).toBeLessThan(60);
  });

  it('carries no duplicate glyph across categories', () => {
    const seen = new Set<string>();
    for (const category of WIDGET_EMOJI_CATEGORIES) {
      for (const item of category.items) {
        expect(seen.has(item), `${item} appears in more than one category`).toBe(false);
        seen.add(item);
      }
    }
  });
});
