import { useSyncExternalStore } from 'react';
import { serverNow } from './server-clock.js';

/**
 * One shared clock for everything on screen that counts up (IN-03 · tm 361).
 *
 * A timer per inbox row would be 200 intervals for a 200-row list; this is
 * one interval however many rows read it, started by the first subscriber
 * and stopped with the last. Each tick is the server's time ({@link serverNow}),
 * so a counter agrees with the API's timestamps even on a clock that is off.
 */
export const NOW_TICK_MS = 15_000;

const listeners = new Set<() => void>();
let current = serverNow();
let stamp = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function refresh(): void {
  current = serverNow();
  stamp = Date.now();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    refresh();
    timer = setInterval(() => {
      refresh();
      for (const notify of listeners) notify();
    }, NOW_TICK_MS);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function snapshot(): number {
  // With nobody listening the value would only age: bring it up to date when
  // it is a tick old, so the first render after a quiet spell is not stale.
  // Within a tick it stays put, which `useSyncExternalStore` requires.
  if (listeners.size === 0 && Date.now() - stamp >= NOW_TICK_MS) refresh();
  return current;
}

/** The server's time in epoch milliseconds, moving every {@link NOW_TICK_MS}. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
