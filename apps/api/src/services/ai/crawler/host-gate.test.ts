/**
 * Politeness towards one host (tm 312.2 · AI-17): at least the interval
 * between two request starts, at most the concurrency in flight. Driven by a
 * fake clock — the gate's waits advance it.
 */
import { describe, expect, it } from 'vitest';
import { HostGate } from './host-gate.js';

function clocked(options: { intervalMs?: number; concurrency?: number } = {}) {
  let now = 0;
  const starts: Array<{ host: string; at: number }> = [];
  const gate = new HostGate({
    ...options,
    now: () => now,
    sleep: async (ms, signal) => {
      signal?.throwIfAborted();
      now += ms;
    },
  });
  const enter = async (host: string, signal?: AbortSignal) => {
    const release = await gate.acquire(host, signal);
    starts.push({ host, at: now });
    return release;
  };
  return { gate, starts, enter, advance: (ms: number) => (now += ms) };
}

describe('HostGate — interval and concurrency per host (FR-MOD-06.3.2)', () => {
  it('spaces request starts to one host by the interval', async () => {
    const { starts, enter } = clocked({ intervalMs: 500, concurrency: 2 });
    const first = await enter('example.com');
    first();
    const second = await enter('example.com');
    second();
    const third = await enter('Example.COM');
    third();
    expect(starts.map((s) => s.at)).toEqual([0, 500, 1000]);
  });

  it('holds a third request until one of two in flight is done', async () => {
    const { starts, enter, advance } = clocked({ intervalMs: 500, concurrency: 2 });
    const a = await enter('example.com');
    await enter('example.com');
    let third = false;
    const waiting = enter('example.com').then((release) => {
      third = true;
      return release;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(third).toBe(false);
    advance(5_000);
    a();
    (await waiting)();
    expect(third).toBe(true);
    expect(starts).toHaveLength(3);
    expect(starts[2]!.at).toBeGreaterThanOrEqual(starts[1]!.at + 500);
  });

  it('keeps hosts apart', async () => {
    const { starts, enter } = clocked({ intervalMs: 500, concurrency: 1 });
    await enter('a.example');
    await enter('b.example');
    expect(starts).toEqual([
      { host: 'a.example', at: 0 },
      { host: 'b.example', at: 0 },
    ]);
  });

  it('gives a slot back when a waiter is cancelled, and a release is idempotent', async () => {
    const { enter } = clocked({ intervalMs: 0, concurrency: 1 });
    const held = await enter('example.com');
    const controller = new AbortController();
    const cancelled = enter('example.com', controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toBeDefined();
    held();
    held();
    const next = await enter('example.com');
    const after = enter('example.com');
    let entered = false;
    void after.then(() => (entered = true));
    await new Promise((resolve) => setImmediate(resolve));
    // Only one slot: the double release did not make two.
    expect(entered).toBe(false);
    next();
    (await after)();
  });
});
