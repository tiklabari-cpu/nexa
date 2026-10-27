/**
 * Politeness towards one host (tm 312.2 · AI-17): at least
 * `hostIntervalMs` between the starts of two requests to it, at most
 * `hostConcurrency` in flight at once — across every job this process runs,
 * so two workspaces crawling one site do not add up to twice the load.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { KNOWLEDGE_CRAWL_LIMITS } from '@siyahtus/types';

export interface HostGateOptions {
  intervalMs?: number;
  concurrency?: number;
  /** The clock and the wait — tests drive both. */
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

interface HostState {
  active: number;
  /** The earliest the next request may start. */
  nextStart: number;
  waiting: Array<() => void>;
}

/** Hosts remembered before the idle ones are forgotten. */
const HOSTS_KEPT = 1000;

export class HostGate {
  readonly #intervalMs: number;
  readonly #concurrency: number;
  readonly #now: () => number;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly #hosts = new Map<string, HostState>();

  constructor(options: HostGateOptions = {}) {
    this.#intervalMs = options.intervalMs ?? KNOWLEDGE_CRAWL_LIMITS.hostIntervalMs;
    this.#concurrency = Math.max(1, options.concurrency ?? KNOWLEDGE_CRAWL_LIMITS.hostConcurrency);
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
  }

  /**
   * Wait for a turn at `host`; resolves with the function that gives it back.
   * Call it when the request is over — body read or abandoned. Rejects (and
   * holds nothing) when `signal` aborts while waiting.
   */
  async acquire(host: string, signal?: AbortSignal): Promise<() => void> {
    const key = host.toLowerCase();
    for (;;) {
      signal?.throwIfAborted();
      const state = this.#state(key);
      if (state.active < this.#concurrency) {
        const now = this.#now();
        const start = Math.max(now, state.nextStart);
        state.nextStart = start + this.#intervalMs;
        state.active += 1;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          state.active -= 1;
          state.waiting.shift()?.();
        };
        if (start > now) {
          try {
            await this.#sleep(start - now, signal);
          } catch (error) {
            release();
            throw error;
          }
        }
        return release;
      }
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          const index = state.waiting.indexOf(wake);
          if (index !== -1) state.waiting.splice(index, 1);
          reject(signal!.reason);
        };
        const wake = () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };
        state.waiting.push(wake);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
  }

  #state(key: string): HostState {
    let state = this.#hosts.get(key);
    if (state) return state;
    if (this.#hosts.size >= HOSTS_KEPT) {
      const now = this.#now();
      for (const [host, entry] of this.#hosts) {
        if (entry.active === 0 && entry.waiting.length === 0 && entry.nextStart <= now) {
          this.#hosts.delete(host);
        }
      }
    }
    state = { active: 0, nextStart: 0, waiting: [] };
    this.#hosts.set(key, state);
    return state;
  }
}
