/**
 * Linear multi-step navigation, in one place (FR-EK-A.2).
 *
 * A wizard is just an index into a list of steps with two rules everyone
 * re-implements: Next stops at the last step, Back stops at the first. Hand-
 * rolled, those bounds drift — an off-by-one lets Back run negative, or Next
 * walks past the end and renders nothing. This owns the index and the clamping
 * so a flow only has to say what its steps are and what to do at the end.
 */
import { useCallback, useMemo, useState } from 'react';

export interface Stepper {
  /** Zero-based position in the step list. */
  index: number;
  /** Human-facing "Step 3 of 4" numerator. */
  current: number;
  count: number;
  isFirst: boolean;
  isLast: boolean;
  /** Advance one step; a no-op (clamped) on the last step. */
  next: () => void;
  /** Go back one step; a no-op (clamped) on the first step. */
  back: () => void;
  /** Jump to a specific step, clamped into range. */
  goTo: (index: number) => void;
  reset: () => void;
}

const clamp = (value: number, count: number): number =>
  Math.max(0, Math.min(value, count - 1));

/**
 * `count` is how many steps there are. `next`/`back` never leave the range, so
 * callers bind them straight to buttons and read `isLast` to decide whether the
 * primary action advances or finishes.
 */
export function useStepper(count: number): Stepper {
  const [index, setIndex] = useState(0);

  const next = useCallback(() => setIndex((i) => clamp(i + 1, count)), [count]);
  const back = useCallback(() => setIndex((i) => clamp(i - 1, count)), [count]);
  const goTo = useCallback((target: number) => setIndex(clamp(target, count)), [count]);
  const reset = useCallback(() => setIndex(0), []);

  return useMemo(
    () => ({
      index,
      current: index + 1,
      count,
      isFirst: index === 0,
      isLast: index === count - 1,
      next,
      back,
      goTo,
      reset,
    }),
    [index, count, next, back, goTo, reset],
  );
}
