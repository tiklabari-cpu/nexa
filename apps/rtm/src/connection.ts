/**
 * In-process registry of live sockets.
 *
 * Indexed by tenant and by agent so a fan-out never has to walk every socket on
 * the node, and — more importantly — so a push can be addressed to exactly the
 * recipients allowed to see it. Cross-tenant delivery is prevented here by
 * construction: lookups are always keyed by organization first.
 */
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';

export interface Connection {
  id: string;
  ws: WebSocket;
  side: 'agent' | 'customer';
  organizationId: string;
  /** Set at login; until then the socket may only ping. */
  authenticated: boolean;
  licenseId: string | null;
  actorId: string | null;
  /** Push actions this socket subscribed to; empty means "none yet". */
  subscriptions: Set<string>;
  pendingRequests: number;
  lastSeenAt: number;
  connectedAt: number;
}

export class ConnectionRegistry {
  readonly #byId = new Map<string, Connection>();
  readonly #byOrganization = new Map<string, Set<string>>();
  readonly #byActor = new Map<string, Set<string>>();

  add(input: { ws: WebSocket; side: 'agent' | 'customer'; organizationId: string }): Connection {
    const connection: Connection = {
      id: randomUUID(),
      ws: input.ws,
      side: input.side,
      organizationId: input.organizationId,
      authenticated: false,
      licenseId: null,
      actorId: null,
      subscriptions: new Set(),
      pendingRequests: 0,
      lastSeenAt: Date.now(),
      connectedAt: Date.now(),
    };

    this.#byId.set(connection.id, connection);
    this.#index(this.#byOrganization, connection.organizationId, connection.id);
    return connection;
  }

  /** Called once the login handshake succeeds (slice 5). */
  authenticate(id: string, actor: { licenseId: string; actorId: string }): Connection | undefined {
    const connection = this.#byId.get(id);
    if (!connection) return undefined;
    connection.authenticated = true;
    connection.licenseId = actor.licenseId;
    connection.actorId = actor.actorId;
    this.#index(this.#byActor, this.#actorKey(connection.organizationId, actor.actorId), id);
    return connection;
  }

  get(id: string): Connection | undefined {
    return this.#byId.get(id);
  }

  /** Every authenticated socket for a tenant. Never crosses organizations. */
  forOrganization(organizationId: string): Connection[] {
    const ids = this.#byOrganization.get(organizationId);
    if (!ids) return [];
    return [...ids]
      .map((id) => this.#byId.get(id))
      .filter((c): c is Connection => c !== undefined && c.authenticated);
  }

  /** Every socket belonging to one actor — an agent may have several tabs open. */
  forActor(organizationId: string, actorId: string): Connection[] {
    const ids = this.#byActor.get(this.#actorKey(organizationId, actorId));
    if (!ids) return [];
    return [...ids].map((id) => this.#byId.get(id)).filter((c): c is Connection => c !== undefined);
  }

  remove(id: string): void {
    const connection = this.#byId.get(id);
    if (!connection) return;
    this.#byId.delete(id);
    this.#deindex(this.#byOrganization, connection.organizationId, id);
    if (connection.actorId) {
      this.#deindex(
        this.#byActor,
        this.#actorKey(connection.organizationId, connection.actorId),
        id,
      );
    }
  }

  closeAll(code: number, reason: string): void {
    for (const connection of this.#byId.values()) {
      try {
        connection.ws.close(code, reason);
      } catch {
        // Socket already torn down — nothing to do.
      }
    }
  }

  get size(): number {
    return this.#byId.size;
  }

  #actorKey(organizationId: string, actorId: string): string {
    return `${organizationId}:${actorId}`;
  }

  #index(map: Map<string, Set<string>>, key: string, id: string): void {
    const existing = map.get(key);
    if (existing) existing.add(id);
    else map.set(key, new Set([id]));
  }

  #deindex(map: Map<string, Set<string>>, key: string, id: string): void {
    const existing = map.get(key);
    if (!existing) return;
    existing.delete(id);
    if (existing.size === 0) map.delete(key);
  }
}
