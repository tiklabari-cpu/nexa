/**
 * The inbox right-panel tab preference (FR-MOD-01.3): which of Details or
 * Copilot fills the right-hand slot, remembered across reloads the same way
 * `rightPanel.ts` remembers Expand/collapse. The unit contract is the
 * acceptance criterion itself — a choice that survives a reload — plus the
 * storage guards the panel must not crash on when `localStorage` is
 * unavailable or holds a stale/unknown value.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPanelTab, savePanelTab, usePanelTab } from './panelTab.js';

const KEY = 'nexa.inbox.right-panel-tab';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('right-panel tab preference store (FR-MOD-01.3)', () => {
  it('defaults to the Details tab', () => {
    expect(loadPanelTab()).toBe('details');
  });

  it('round-trips the copilot choice through storage', () => {
    savePanelTab('copilot');
    expect(localStorage.getItem(KEY)).toBe('copilot');
    expect(loadPanelTab()).toBe('copilot');

    savePanelTab('details');
    expect(loadPanelTab()).toBe('details');
  });

  it('treats an unknown stored value as Details, not a broken panel', () => {
    localStorage.setItem(KEY, 'nonsense');
    expect(loadPanelTab()).toBe('details');
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
    expect(() => savePanelTab('copilot', blocked)).not.toThrow();
    expect(loadPanelTab(blocked)).toBe('details');
  });
});

describe('usePanelTab (FR-MOD-01.3)', () => {
  it('restores the remembered tab after a reload', () => {
    const first = renderHook(() => usePanelTab());
    act(() => first.result.current.showCopilot());
    expect(first.result.current.tab).toBe('copilot');
    first.unmount();

    // A fresh mount is what a reload is: the hook re-reads storage on init.
    const second = renderHook(() => usePanelTab());
    expect(second.result.current.tab).toBe('copilot');
  });

  it('showDetails drives the tab back and persists it', () => {
    const { result } = renderHook(() => usePanelTab());
    act(() => result.current.showCopilot());
    expect(result.current.tab).toBe('copilot');

    act(() => result.current.showDetails());
    expect(result.current.tab).toBe('details');
    expect(localStorage.getItem(KEY)).toBe('details');
  });
});
