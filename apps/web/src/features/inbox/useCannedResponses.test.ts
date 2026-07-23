/**
 * The `#` shortcut parser.
 *
 * Pure functions, tested hard, because the failure modes are all silent: a
 * picker that opens inside a URL interrupts typing, one that never opens makes
 * the feature invisible, and a bad replacement range corrupts the message an
 * agent is about to send to a customer.
 */
import { describe, expect, it } from 'vitest';
import { activeShortcutQuery, applyShortcut } from './useCannedResponses.js';

describe('activeShortcutQuery', () => {
  it('finds a shortcut at the start of the message', () => {
    expect(activeShortcutQuery('#ship', 5)).toEqual({ query: 'ship', from: 0 });
  });

  it('finds one after a space', () => {
    expect(activeShortcutQuery('hello #ship', 11)).toEqual({ query: 'ship', from: 6 });
  });

  it('opens on a bare # so the agent sees what is available', () => {
    expect(activeShortcutQuery('#', 1)).toEqual({ query: '', from: 0 });
  });

  it('does not trigger inside a word', () => {
    // A `#` in a URL fragment or a hex colour is not a shortcut, and opening a
    // picker there interrupts someone mid-sentence.
    expect(activeShortcutQuery('colour is #fff', 14)).toEqual({ query: 'fff', from: 10 });
    expect(activeShortcutQuery('see example.com/page#anchor', 27)).toBeNull();
  });

  it('only looks before the caret', () => {
    // The agent moved back to fix a typo earlier in the message; the `#ship`
    // ahead of the caret is not what they are typing.
    expect(activeShortcutQuery('hello #ship', 5)).toBeNull();
  });

  it('closes once the token ends', () => {
    expect(activeShortcutQuery('#ship ', 6)).toBeNull();
    expect(activeShortcutQuery('#ship and more', 14)).toBeNull();
  });

  it('stops at characters a shortcut cannot contain', () => {
    // Shortcuts are `[A-Za-z0-9_-]`, so a `/` ends the token.
    expect(activeShortcutQuery('#ship/now', 9)).toBeNull();
  });

  it('handles a newline as a word boundary', () => {
    expect(activeShortcutQuery('first line\n#ship', 16)).toEqual({ query: 'ship', from: 11 });
  });

  it('returns nothing for an empty field', () => {
    expect(activeShortcutQuery('', 0)).toBeNull();
  });
});

describe('applyShortcut', () => {
  it('replaces the token and leaves the caret after the insertion', () => {
    const result = applyShortcut('#ship', 5, 0, 'Delivery takes 3-5 days.');
    expect(result.text).toBe('Delivery takes 3-5 days. ');
    expect(result.caret).toBe(result.text.length);
  });

  it('keeps the text on either side intact', () => {
    const value = 'Hi there #ship — thanks';
    const caret = 14; // just after "#ship"
    const result = applyShortcut(value, caret, 9, 'Delivery takes 3-5 days.');

    expect(result.text).toBe('Hi there Delivery takes 3-5 days.  — thanks');
    // The caret sits at the end of what was inserted, not at the end of the
    // whole message — an agent continues typing where they were.
    expect(result.text.slice(0, result.caret)).toBe('Hi there Delivery takes 3-5 days. ');
  });

  it('replaces a bare # with no query', () => {
    const result = applyShortcut('Hello #', 7, 6, 'Reply text');
    expect(result.text).toBe('Hello Reply text ');
  });

  it('survives a multi-line message', () => {
    const value = 'line one\n#ship';
    const result = applyShortcut(value, 14, 9, 'Delivery info');
    expect(result.text).toBe('line one\nDelivery info ');
  });
});
