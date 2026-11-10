import { describe, expect, it } from 'vitest';
import { HEALTH_PROBE_TTL_MS, SharedProbe } from './health-probe.js';

/** A probe whose answer the test releases by hand, so "in flight" is a state it can hold. */
function heldProbe<T>() {
  const pending: Array<{ resolve: (value: T) => void; reject: (error: Error) => void }> = [];
  let calls = 0;
  const run = () =>
    new Promise<T>((resolve, reject) => {
      calls += 1;
      pending.push({ resolve, reject });
    });
  return {
    run,
    calls: () => calls,
    resolve: (value: T) => pending.shift()?.resolve(value),
    reject: (error: Error) => pending.shift()?.reject(error),
  };
}

describe('SharedProbe — one dependency probe however many health requests (tm 454 · F34)', () => {
  it('serves 100 concurrent reads from a single probe', async () => {
    const probe = heldProbe<string>();
    const shared = new SharedProbe(probe.run, { now: () => 0 });

    const reads = Array.from({ length: 100 }, () => shared.read());
    expect(probe.calls()).toBe(1);
    probe.resolve('ok');

    expect(await Promise.all(reads)).toEqual(Array.from({ length: 100 }, () => 'ok'));
    expect(probe.calls()).toBe(1);
    expect(shared.runs).toBe(1);
  });

  it('answers from the finished result inside the TTL, and probes again once it has passed', async () => {
    let clock = 0;
    const probe = heldProbe<string>();
    const shared = new SharedProbe(probe.run, { ttlMs: 1_000, now: () => clock });

    const first = shared.read();
    probe.resolve('ok');
    expect(await first).toBe('ok');

    clock = 999;
    expect(await shared.read()).toBe('ok');
    expect(probe.calls()).toBe(1);

    clock = 1_000;
    const again = shared.read();
    expect(probe.calls()).toBe(2);
    probe.resolve('degraded');
    expect(await again).toBe('degraded');
  });

  it('starts the TTL when the probe finishes, not when it started', async () => {
    // A probe that spends its whole timeout must not come back already stale —
    // otherwise a slow dependency is probed back-to-back, the load this stops.
    let clock = 0;
    const probe = heldProbe<string>();
    const shared = new SharedProbe(probe.run, { ttlMs: 1_000, now: () => clock });

    const first = shared.read();
    clock = 2_000;
    probe.resolve('degraded');
    await first;

    clock = 2_500;
    expect(await shared.read()).toBe('degraded');
    expect(probe.calls()).toBe(1);
  });

  it('caches a degraded result like a healthy one', async () => {
    const probe = heldProbe<{ status: string }>();
    const shared = new SharedProbe(probe.run, { now: () => 0 });

    const first = shared.read();
    probe.resolve({ status: 'degraded' });
    await first;

    expect(await shared.read()).toEqual({ status: 'degraded' });
    expect(probe.calls()).toBe(1);
  });

  it('does not cache a probe that rejects — every waiter sees the error, the next read probes again', async () => {
    const probe = heldProbe<string>();
    const shared = new SharedProbe(probe.run, { now: () => 0 });

    const a = shared.read();
    const b = shared.read();
    probe.reject(new Error('boom'));
    await expect(a).rejects.toThrow('boom');
    await expect(b).rejects.toThrow('boom');

    const next = shared.read();
    expect(probe.calls()).toBe(2);
    probe.resolve('ok');
    expect(await next).toBe('ok');
  });

  it('defaults to a TTL well under any orchestrator probe interval', () => {
    // Helm readiness `periodSeconds: 10` (templates/deployment.yaml); compose
    // gives api/rtm no healthcheck. A TTL near that would hand an orchestrator
    // a result it did not cause.
    expect(HEALTH_PROBE_TTL_MS).toBeGreaterThan(0);
    expect(HEALTH_PROBE_TTL_MS).toBeLessThanOrEqual(2_000);
  });
});
