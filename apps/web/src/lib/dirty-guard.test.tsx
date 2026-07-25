/**
 * The dirty guard: proves closing is silent when there is nothing to lose and
 * asks — once — before discarding unsaved work, with an injectable confirmer so
 * the rule is tested without a real browser dialog.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { confirmDiscard, useCloseGuard, DISCARD_MESSAGE } from './dirty-guard.js';

describe('confirmDiscard', () => {
  it('lets a clean form through without ever asking', () => {
    const confirm = vi.fn(() => false);
    expect(confirmDiscard(false, DISCARD_MESSAGE, confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks when dirty and proceeds only if confirmed', () => {
    expect(confirmDiscard(true, 'Discard?', () => true)).toBe(true);
    expect(confirmDiscard(true, 'Discard?', () => false)).toBe(false);
  });

  it('passes the message to the confirmer', () => {
    const confirm = vi.fn(() => true);
    confirmDiscard(true, 'Lose your edits?', confirm);
    expect(confirm).toHaveBeenCalledWith('Lose your edits?');
  });
});

describe('useCloseGuard', () => {
  it('closes straight through when the form is clean', () => {
    const onClose = vi.fn();
    const confirm = vi.fn(() => false);
    const { result } = renderHook(() =>
      useCloseGuard({ isDirty: false, onClose, confirm }),
    );
    act(() => result.current());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not close when a dirty discard is declined', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useCloseGuard({ isDirty: true, onClose, confirm: () => false }),
    );
    act(() => result.current());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when a dirty discard is confirmed', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useCloseGuard({ isDirty: true, onClose, confirm: () => true }),
    );
    act(() => result.current());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
