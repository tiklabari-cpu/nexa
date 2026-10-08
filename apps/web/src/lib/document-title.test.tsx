/**
 * The tab title has one writer (tm 259.20 · O15): the page names itself, the
 * unread badge prefixes it, and neither erases the other.
 */
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { composeTitle, setUnreadCount, usePageTitle } from './document-title.js';

function Titled({ title }: { title: string | null }): null {
  usePageTitle(title);
  return null;
}

afterEach(() => {
  setUnreadCount(0);
});

describe('composeTitle', () => {
  it('is the bare product name with no page', () => {
    expect(composeTitle(null, 0)).toBe('SiyahTuş');
  });

  it('puts the page before the product name', () => {
    expect(composeTitle('Inbox', 0)).toBe('Inbox · SiyahTuş');
  });

  it('layers the unread count over the page title', () => {
    expect(composeTitle('Gelen Kutusu', 1)).toBe('(1) Gelen Kutusu · SiyahTuş');
  });
});

describe('usePageTitle', () => {
  it('names the tab while mounted and restores the product name on leaving', () => {
    const { unmount } = render(<Titled title="Reports" />);
    expect(document.title).toBe('Reports · SiyahTuş');
    unmount();
    expect(document.title).toBe('SiyahTuş');
  });

  it('follows a title that changes with the language', () => {
    const { rerender } = render(<Titled title="Inbox" />);
    rerender(<Titled title="Gelen Kutusu" />);
    expect(document.title).toBe('Gelen Kutusu · SiyahTuş');
  });

  it('keeps the unread count when the page changes, and the page when the count changes', () => {
    const { rerender } = render(<Titled title="Inbox" />);
    setUnreadCount(2);
    expect(document.title).toBe('(2) Inbox · SiyahTuş');

    rerender(<Titled title="Team" />);
    expect(document.title).toBe('(2) Team · SiyahTuş');

    setUnreadCount(0);
    expect(document.title).toBe('Team · SiyahTuş');
  });
});
