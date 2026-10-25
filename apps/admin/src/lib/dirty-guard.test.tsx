/**
 * The dirty guard: proves closing is silent when there is nothing to lose and
 * asks — once — before discarding unsaved work, with an injectable confirmer so
 * the rule is tested without a real browser dialog.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  confirmDiscard,
  confirmLeave,
  shouldWarnOnLeave,
  useCloseGuard,
  useLeaveGuard,
  DISCARD_MESSAGE,
} from './dirty-guard.js';

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
    const { result } = renderHook(() => useCloseGuard({ isDirty: false, onClose, confirm }));
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

/**
 * Leaving a screen, rather than closing a modal (FR-MOD-06.2.1).
 *
 * `beforeunload` cannot be judged in jsdom — no browser dialog is raised and
 * nothing reports whether one would have been — so the decision lives in a pure
 * helper that is tested directly, and the listener is tested for the only thing
 * jsdom can actually observe: that dispatching the event finds a handler that
 * cancels it.
 */
describe('shouldWarnOnLeave', () => {
  it('warns while there are unsaved edits', () => {
    expect(shouldWarnOnLeave(true, false)).toBe(true);
  });

  it('stays quiet when nothing has been changed', () => {
    expect(shouldWarnOnLeave(false, false)).toBe(false);
  });

  it('stays quiet mid-save — the work is already on its way to the server', () => {
    expect(shouldWarnOnLeave(true, true)).toBe(false);
  });

  it('stays quiet after the save lands, when the form is clean again', () => {
    expect(shouldWarnOnLeave(false, false)).toBe(false);
  });
});

describe('useLeaveGuard + confirmLeave', () => {
  it('lets navigation through without asking while no screen is dirty', () => {
    const confirm = vi.fn(() => false);
    expect(confirmLeave(confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks with the registering screen’s own wording, and blocks when declined', () => {
    const confirm = vi.fn(() => false);
    renderHook(() => useLeaveGuard(true, 'Lose this skill’s edits?'));

    expect(confirmLeave(confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith('Lose this skill’s edits?');
  });

  it('lets navigation through when the discard is confirmed', () => {
    renderHook(() => useLeaveGuard(true, DISCARD_MESSAGE));
    expect(confirmLeave(() => true)).toBe(true);
  });

  it('stops asking once the screen unmounts', () => {
    const confirm = vi.fn(() => false);
    const { unmount } = renderHook(() => useLeaveGuard(true, DISCARD_MESSAGE));
    expect(confirmLeave(confirm)).toBe(false);

    unmount();
    expect(confirmLeave(confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('stops asking as soon as the screen stops being dirty', () => {
    const confirm = vi.fn(() => false);
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useLeaveGuard(active, DISCARD_MESSAGE),
      { initialProps: { active: true } },
    );
    expect(confirmLeave(confirm)).toBe(false);

    rerender({ active: false });
    expect(confirmLeave(confirm)).toBe(true);
  });

  it('cancels a browser reload while dirty, and stops once clean', () => {
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useLeaveGuard(active, DISCARD_MESSAGE),
      { initialProps: { active: true } },
    );

    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    act(() => void window.dispatchEvent(dirtyEvent));
    expect(dirtyEvent.defaultPrevented).toBe(true);

    rerender({ active: false });
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    act(() => void window.dispatchEvent(cleanEvent));
    expect(cleanEvent.defaultPrevented).toBe(false);
  });
});
