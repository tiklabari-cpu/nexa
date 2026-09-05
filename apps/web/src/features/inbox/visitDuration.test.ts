/**
 * The live visit duration (FR-MOD-02.4.1–.6).
 *
 * The PRD's acceptance criterion for the Details panel ends "süre/ziyaret
 * canlı" — the visit's length has to run on screen. The server can only send a
 * measurement, so the running part is this module's job, and these tests are
 * what say it runs: without them "live" is a claim about a number that in fact
 * sat still until an unrelated refetch moved it.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDuration, liveDurationSeconds, useLiveDurationSeconds } from './visitDuration.js';

describe('liveDurationSeconds — the server figure plus the time since (FR-MOD-02.4.1–.6)', () => {
  it('adds the whole seconds elapsed since the figure was taken', () => {
    expect(liveDurationSeconds(200, 1_000_000, 1_000_000)).toBe(200);
    expect(liveDurationSeconds(200, 1_000_000, 1_004_900)).toBe(204);
  });

  it('leaves an unknown duration unknown rather than starting it at zero', () => {
    expect(liveDurationSeconds(null, 1_000_000, 1_060_000)).toBeNull();
  });

  it('never counts backwards when the clock moves the wrong way', () => {
    expect(liveDurationSeconds(200, 1_000_000, 900_000)).toBe(200);
  });
});

describe('useLiveDurationSeconds (FR-MOD-02.4.1–.6)', () => {
  afterEach(() => vi.useRealTimers());

  it('climbs once a second while the visit is open', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLiveDurationSeconds(200, true));

    expect(result.current).toBe(200);
    act(() => void vi.advanceTimersByTime(3_000));
    expect(result.current).toBe(203);
  });

  it('holds a finished visit at the length it actually had', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLiveDurationSeconds(200, false));

    act(() => void vi.advanceTimersByTime(10_000));
    expect(result.current).toBe(200);
  });

  it('re-anchors on a fresh figure instead of adding to a stale one', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ base }: { base: number }) => useLiveDurationSeconds(base, true),
      { initialProps: { base: 200 } },
    );

    act(() => void vi.advanceTimersByTime(5_000));
    expect(result.current).toBe(205);

    // A refetch lands with the server's own count of the same visit; the client
    // restarts from it rather than piling its own five seconds on top.
    rerender({ base: 206 });
    expect(result.current).toBe(206);
  });
});

describe('formatDuration', () => {
  it('reads as a length a person can scan, and a dash when unknown', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-1)).toBe('—');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(200)).toBe('3m 20s');
    expect(formatDuration(180)).toBe('3m');
    expect(formatDuration(3_840)).toBe('1h 4m');
  });
});
