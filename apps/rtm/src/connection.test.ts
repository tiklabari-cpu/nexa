import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { ConnectionRegistry } from './connection.js';

function fakeSocket(): WebSocket {
  return { close: () => undefined } as unknown as WebSocket;
}

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

describe('ConnectionRegistry', () => {
  it('tracks and removes connections', () => {
    const registry = new ConnectionRegistry();
    const connection = registry.add({ ws: fakeSocket(), side: 'agent', organizationId: ORG_A });

    expect(registry.size).toBe(1);
    expect(registry.get(connection.id)).toBe(connection);

    registry.remove(connection.id);
    expect(registry.size).toBe(0);
    expect(registry.get(connection.id)).toBeUndefined();
  });

  it('excludes sockets that have not logged in from tenant fan-out', () => {
    const registry = new ConnectionRegistry();
    registry.add({ ws: fakeSocket(), side: 'agent', organizationId: ORG_A });

    // A connected-but-unauthenticated socket must never receive a push: at this
    // point the server has no idea who is on the other end.
    expect(registry.forOrganization(ORG_A)).toHaveLength(0);
  });

  it("never returns another tenant's sockets", () => {
    const registry = new ConnectionRegistry();
    const a = registry.add({ ws: fakeSocket(), side: 'agent', organizationId: ORG_A });
    const b = registry.add({ ws: fakeSocket(), side: 'agent', organizationId: ORG_B });
    registry.authenticate(a.id, { licenseId: '1', actorId: 'agent-a' });
    registry.authenticate(b.id, { licenseId: '2', actorId: 'agent-b' });

    expect(registry.forOrganization(ORG_A).map((c) => c.id)).toEqual([a.id]);
    expect(registry.forOrganization(ORG_B).map((c) => c.id)).toEqual([b.id]);
  });

  it('keys actors by organization so identical actor ids do not collide', () => {
    const registry = new ConnectionRegistry();
    const a = registry.add({ ws: fakeSocket(), side: 'agent', organizationId: ORG_A });
    const b = registry.add({ ws: fakeSocket(), side: 'agent', organizationId: ORG_B });
    // Same actor id in two tenants — a naive index would merge these.
    registry.authenticate(a.id, { licenseId: '1', actorId: 'shared@example.com' });
    registry.authenticate(b.id, { licenseId: '2', actorId: 'shared@example.com' });

    expect(registry.forActor(ORG_A, 'shared@example.com').map((c) => c.id)).toEqual([a.id]);
    expect(registry.forActor(ORG_B, 'shared@example.com').map((c) => c.id)).toEqual([b.id]);
  });

  it('groups multiple sockets belonging to one agent (several open tabs)', () => {
    const registry = new ConnectionRegistry();
    const first = registry.add({ ws: fakeSocket(), side: 'agent', organizationId: ORG_A });
    const second = registry.add({ ws: fakeSocket(), side: 'agent', organizationId: ORG_A });
    registry.authenticate(first.id, { licenseId: '1', actorId: 'agent-a' });
    registry.authenticate(second.id, { licenseId: '1', actorId: 'agent-a' });

    expect(registry.forActor(ORG_A, 'agent-a')).toHaveLength(2);

    registry.remove(first.id);
    expect(registry.forActor(ORG_A, 'agent-a').map((c) => c.id)).toEqual([second.id]);
  });

  it('drops empty index buckets so long-running nodes do not leak memory', () => {
    const registry = new ConnectionRegistry();
    const connection = registry.add({ ws: fakeSocket(), side: 'agent', organizationId: ORG_A });
    registry.authenticate(connection.id, { licenseId: '1', actorId: 'agent-a' });
    registry.remove(connection.id);

    expect(registry.forOrganization(ORG_A)).toEqual([]);
    expect(registry.forActor(ORG_A, 'agent-a')).toEqual([]);
  });

  it('tolerates removing an unknown id', () => {
    const registry = new ConnectionRegistry();
    expect(() => registry.remove('does-not-exist')).not.toThrow();
  });

  it('survives sockets that throw on close', () => {
    const registry = new ConnectionRegistry();
    registry.add({
      ws: {
        close: () => {
          throw new Error('already destroyed');
        },
      } as unknown as WebSocket,
      side: 'agent',
      organizationId: ORG_A,
    });
    expect(() => registry.closeAll(1001, 'bye')).not.toThrow();
  });
});
