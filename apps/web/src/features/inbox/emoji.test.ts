import { describe, expect, it } from 'vitest';
import { EMOJI_CATEGORIES, insertAtCaret } from './emoji.js';

describe('insertAtCaret (FR-MOD-02.3.5)', () => {
  it('splices the insertion at the caret, leaving the rest of the text intact', () => {
    const result = insertAtCaret('Hello !', 6, '👍');
    expect(result.text).toBe('Hello 👍!');
    expect(result.caret).toBe(8);
  });

  it('adds no trailing space, so a second insertion can sit right next to the first', () => {
    const first = insertAtCaret('', 0, '🎉');
    const second = insertAtCaret(first.text, first.caret, '🎉');
    expect(second.text).toBe('🎉🎉');
  });

  it('inserts at the start and at the end of existing text', () => {
    expect(insertAtCaret('world', 0, 'hello ').text).toBe('hello world');
    expect(insertAtCaret('hello', 5, ' world').text).toBe('hello world');
  });
});

describe('EMOJI_CATEGORIES (FR-MOD-02.3.5)', () => {
  it('is a small, non-empty, categorised set — not a full Unicode board', () => {
    expect(EMOJI_CATEGORIES.length).toBeGreaterThan(0);
    for (const category of EMOJI_CATEGORIES) {
      expect(category.id.length).toBeGreaterThan(0);
      expect(category.items.length).toBeGreaterThan(0);
    }
    const total = EMOJI_CATEGORIES.reduce((sum, category) => sum + category.items.length, 0);
    expect(total).toBeLessThan(60);
  });

  it('carries no duplicate glyph across categories', () => {
    const seen = new Set<string>();
    for (const category of EMOJI_CATEGORIES) {
      for (const item of category.items) {
        expect(seen.has(item), `${item} appears in more than one category`).toBe(false);
        seen.add(item);
      }
    }
  });
});
