import { describe, expect, it } from 'vitest';
import { adjacentChatId } from './chatNavigation.js';

describe('adjacentChatId (IN-08)', () => {
  const ids = ['a', 'b', 'c'];

  it('steps down and up the list', () => {
    expect(adjacentChatId(ids, 'a', 1)).toBe('b');
    expect(adjacentChatId(ids, 'c', -1)).toBe('b');
  });

  it('stops at either end instead of wrapping', () => {
    expect(adjacentChatId(ids, 'c', 1)).toBe('c');
    expect(adjacentChatId(ids, 'a', -1)).toBe('a');
  });

  it('starts from the matching end when nothing in the list is open', () => {
    expect(adjacentChatId(ids, null, 1)).toBe('a');
    expect(adjacentChatId(ids, 'hidden-by-a-tab', -1)).toBe('c');
  });

  it('has nowhere to go in an empty list', () => {
    expect(adjacentChatId([], 'a', 1)).toBeNull();
  });
});
