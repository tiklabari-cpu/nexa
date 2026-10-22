import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS_CACHE_TTL_MS,
  PermissionMatrixCache,
  parsePermissionsChangedMessage,
  permissionsChangedMessage,
  type PermissionMatrixSnapshot,
  type PermissionMatrixTenant,
} from './permission-matrix.js';

const A: PermissionMatrixTenant = { licenseId: 7n, organizationId: 'org-a' };
const B: PermissionMatrixTenant = { licenseId: 8n, organizationId: 'org-b' };

/** A database the test moves by hand, and a count of how often it was read. */
function fakeStore() {
  const versions = new Map<bigint, number>();
  const reads: bigint[] = [];
  let gate: Promise<void> | null = null;
  let open = (): void => undefined;
  return {
    reads,
    set(licenseId: bigint, version: number) {
      versions.set(licenseId, version);
    },
    /** Reads from now on take their rows, then wait for `resume()` to return them. */
    hold() {
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    resume() {
      gate = null;
      open();
    },
    async load(tenant: PermissionMatrixTenant): Promise<PermissionMatrixSnapshot> {
      reads.push(tenant.licenseId);
      const version = versions.get(tenant.licenseId) ?? 0;
      if (gate) await gate;
      return {
        version,
        overrides: [{ role: 'agent', capability: 'reports.view', value: `v${version}` }],
      };
    },
  };
}

describe('permissionsChangedMessage / parsePermissionsChangedMessage', () => {
  it('round-trips a licence and a version', () => {
    expect(permissionsChangedMessage(12345n, 3)).toBe('12345:3');
    expect(parsePermissionsChangedMessage('12345:3')).toEqual({ licenseId: 12345n, version: 3 });
    expect(parsePermissionsChangedMessage('1:0')).toEqual({ licenseId: 1n, version: 0 });
  });

  it('reads nothing it was not written as — the listener then drops every workspace', () => {
    for (const message of [
      '',
      '*',
      '12',
      '12:',
      ':3',
      '0:1',
      '01:1',
      '1:01',
      '1:-1',
      '1:2:3',
      'a:1',
    ]) {
      expect(parsePermissionsChangedMessage(message)).toBeNull();
    }
  });
});

describe('PermissionMatrixCache', () => {
  it('reuses a snapshot for its minute, then reads again', async () => {
    let now = 1_000;
    const store = fakeStore();
    const cache = new PermissionMatrixCache({ load: (t) => store.load(t), now: () => now });

    await cache.get(A);
    await cache.get(A);
    expect(store.reads).toEqual([7n]);

    now += PERMISSIONS_CACHE_TTL_MS - 1;
    await cache.get(A);
    expect(store.reads).toHaveLength(1);

    now += 1;
    await cache.get(A);
    expect(store.reads).toHaveLength(2);
  });

  it('reads again when the caller knows a different version — older as well as newer', async () => {
    const store = fakeStore();
    const cache = new PermissionMatrixCache({ load: (t) => store.load(t) });
    store.set(7n, 2);
    expect((await cache.get(A, 2)).version).toBe(2);
    expect((await cache.get(A, 2)).version).toBe(2);
    expect(store.reads).toHaveLength(1);

    store.set(7n, 3);
    expect((await cache.get(A, 3)).version).toBe(3);
    expect(store.reads).toHaveLength(2);

    // A licence id that came back starts at 0: "newer than asked" would keep
    // the previous holder's rows.
    store.set(7n, 0);
    const snapshot = await cache.get(A, 0);
    expect(snapshot.version).toBe(0);
    expect(snapshot.overrides[0]?.value).toBe('v0');
    expect(store.reads).toHaveLength(3);
  });

  it('returns what the read found even when it is not the version asked for', async () => {
    const store = fakeStore();
    const cache = new PermissionMatrixCache({ load: (t) => store.load(t) });
    store.set(7n, 4);
    expect((await cache.get(A, 5)).version).toBe(4);
    // Kept: the next caller asking for 4 is answered without a read.
    await cache.get(A, 4);
    expect(store.reads).toHaveLength(1);
  });

  it('drops one workspace on invalidate, or all of them without a licence', async () => {
    const store = fakeStore();
    const cache = new PermissionMatrixCache({ load: (t) => store.load(t) });
    await cache.get(A);
    await cache.get(B);
    cache.invalidate(7n);
    await cache.get(A);
    await cache.get(B);
    expect(store.reads).toEqual([7n, 8n, 7n]);

    cache.invalidate();
    await cache.get(A);
    await cache.get(B);
    expect(store.reads).toEqual([7n, 8n, 7n, 7n, 8n]);
  });

  it('does not keep a read that an invalidation overtook', async () => {
    const store = fakeStore();
    const cache = new PermissionMatrixCache({ load: (t) => store.load(t) });
    store.set(7n, 1);
    store.hold();
    const pending = cache.get(A);
    // The change commits and is announced while the old rows are on their way.
    store.set(7n, 2);
    cache.invalidate(7n);
    store.resume();
    expect((await pending).version).toBe(1);

    // The overtaken read was handed to its caller but not kept.
    expect((await cache.get(A)).version).toBe(2);
    expect(store.reads).toHaveLength(2);
  });

  it('keeps at most maxEntries workspaces, dropping the oldest', async () => {
    const store = fakeStore();
    const cache = new PermissionMatrixCache({ load: (t) => store.load(t), maxEntries: 2 });
    const C: PermissionMatrixTenant = { licenseId: 9n, organizationId: 'org-c' };
    await cache.get(A);
    await cache.get(B);
    await cache.get(C);
    await cache.get(B);
    await cache.get(C);
    expect(store.reads).toEqual([7n, 8n, 9n]);
    await cache.get(A);
    expect(store.reads).toEqual([7n, 8n, 9n, 7n]);
  });
});
