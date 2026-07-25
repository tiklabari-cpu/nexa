/**
 * The inbox right-panel preference (FR-MOD-01.3): a two-state switch between the
 * Details panel and an expanded, full-width transcript, remembered across
 * reloads. The unit contract is exactly the acceptance criterion — toggle,
 * expand, and a choice that survives a reload — plus the storage guards the
 * panel must not crash on when `localStorage` is unavailable.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRightPanel, saveRightPanel, useRightPanel } from './rightPanel.js';

const KEY = 'nexa.inbox.right-panel';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('right-panel preference store', () => {
  it('defaults to a visible Details panel', () => {
    expect(loadRightPanel()).toBe('details');
  });

  it('round-trips the expanded choice through storage', () => {
    saveRightPanel('expanded');
    expect(localStorage.getItem(KEY)).toBe('expanded');
    expect(loadRightPanel()).toBe('expanded');

    saveRightPanel('details');
    expect(loadRightPanel()).toBe('details');
  });

  it('treats an unknown stored value as the default', () => {
    // A stale token or a future "copilot" mode must not leave a broken layout.
    localStorage.setItem(KEY, 'copilot');
    expect(loadRightPanel()).toBe('details');
  });

  it('never throws when storage access is blocked', () => {
    const blocked: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    expect(() => saveRightPanel('expanded', blocked)).not.toThrow();
    expect(loadRightPanel(blocked)).toBe('details');
  });
});

describe('useRightPanel', () => {
  it('starts with Details visible and toggles to the expanded transcript', () => {
    const { result } = renderHook(() => useRightPanel());
    expect(result.current.expanded).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('expanded');

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(false);
    expect(localStorage.getItem(KEY)).toBe('details');
  });

  it('setExpanded drives the mode both ways', () => {
    const { result } = renderHook(() => useRightPanel());

    act(() => result.current.setExpanded(true));
    expect(result.current.expanded).toBe(true);

    act(() => result.current.setExpanded(false));
    expect(result.current.expanded).toBe(false);
  });

  it('restores the remembered choice after a reload', () => {
    const first = renderHook(() => useRightPanel());
    act(() => first.result.current.setExpanded(true));
    expect(first.result.current.expanded).toBe(true);
    first.unmount();

    // A fresh mount is what a reload is: the hook re-reads storage on init.
    const second = renderHook(() => useRightPanel());
    expect(second.result.current.expanded).toBe(true);
  });
});
