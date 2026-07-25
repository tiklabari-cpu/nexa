/**
 * The stepper: proves Next stops at the last step and Back at the first, so a
 * wizard can never walk past its own ends.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useStepper } from './stepper.js';

describe('useStepper', () => {
  it('starts on the first step', () => {
    const { result } = renderHook(() => useStepper(4));
    expect(result.current.index).toBe(0);
    expect(result.current.current).toBe(1);
    expect(result.current.count).toBe(4);
    expect(result.current.isFirst).toBe(true);
    expect(result.current.isLast).toBe(false);
  });

  it('advances and reports the last step, never running past it', () => {
    const { result } = renderHook(() => useStepper(3));
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.index).toBe(2);
    expect(result.current.isLast).toBe(true);

    act(() => result.current.next()); // clamped
    expect(result.current.index).toBe(2);
  });

  it('goes back but never below the first step', () => {
    const { result } = renderHook(() => useStepper(3));
    act(() => result.current.goTo(2));
    act(() => result.current.back());
    expect(result.current.index).toBe(1);

    act(() => result.current.back());
    act(() => result.current.back()); // clamped at 0
    expect(result.current.index).toBe(0);
    expect(result.current.isFirst).toBe(true);
  });

  it('clamps an out-of-range jump into the step list', () => {
    const { result } = renderHook(() => useStepper(3));
    act(() => result.current.goTo(99));
    expect(result.current.index).toBe(2);
    act(() => result.current.goTo(-5));
    expect(result.current.index).toBe(0);
  });

  it('reset returns to the first step', () => {
    const { result } = renderHook(() => useStepper(4));
    act(() => result.current.goTo(3));
    act(() => result.current.reset());
    expect(result.current.index).toBe(0);
  });
});
