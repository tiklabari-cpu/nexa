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
import type { LogContext, PrincipalRevokedEnvelope } from '@siyahtus/types';
import type { SocketAuthority, SocketImpersonation } from './auth.js';
import type { GatewayCloseReason } from './telemetry/telemetry.js';

export interface Connection {
  id: string;
  ws: WebSocket;
  side: 'agent' | 'customer';
  organizationId: string;
  /** Set at login; until then the socket may only ping. */
  authenticated: boolean;
  /**
   * A `login` on this socket is being checked (tm 425). A second one sent
   * meanwhile is refused rather than raced: two logins awaiting their tokens
   * at once both used to succeed, the second identity replacing the first.
   */
  loggingIn: boolean;
  /**
   * Revocations of this socket's organization heard while its `login` was in
   * flight (tm 426). The login read the credential before they arrived, so it
   * cannot have seen them; it is checked against these before the socket is
   * marked logged in. Emptied when the login ends, whichever way.
   */
  revokedDuringLogin: PrincipalRevokedEnvelope[];
  /**
   * The client network the upgrade came from — an IPv4 address or an IPv6 /64
   * (`client-network.ts`) — when a cap counts by it (tm 405 · tm 427); null
   * otherwise, or when no address could be derived.
   */
  clientNetwork: string | null;
  /**
   * Why the gateway itself closed this socket, once it has decided to — read by
   * the close handler for `rtm.connections.closed` (`GatewayCloseReason`).
   */
  closedBy: GatewayCloseReason | null;
  /**
   * A close decided while answering a request (tm 425 · tm 427): the answer
   * goes out first, then the socket is closed with this code. Cleared once sent.
   */
  closeAfterReply: { code: number; reason: string } | null;
  licenseId: string | null;
  actorId: string | null;
  /** The principal kind that logged in (`agent`, `bot`, `customer`) — for the log. */
  actorType: string | null;
  /**
   * The stored credential the socket logged in with — its `api_tokens` row id —
   * which a `principal_revoked` envelope names to close it (tm 426). The id,
   * never the token. Null for a visitor's signed token, which has no row, and
   * for a socket not yet logged in.
   */
  tokenId: string | null;
  /** Teams the agent belongs to — the audience filter keys on these. */
  groupIds: number[];
  /** True when the token may see every chat in the licence. */
  unrestricted: boolean;
  /**
   * What a member's socket was authorised from — re-read when the permission
   * matrix moves, so `groupIds`/`unrestricted` follow it (tm 325.3). Null for
   * bots, customers and a socket not yet logged in.
   */
  authority: SocketAuthority | null;
  /**
   * An operator signed in as the member (tm 389.15): the session's mode and
   * window. Null for every other socket.
   */
  impersonation: SocketImpersonation | null;
  /**
   * Push actions this socket asked for. Empty means none: a client receives
   * only what it explicitly subscribed to, so adding a new push type cannot
   * flood clients that do not understand it.
   */
  subscriptions: Set<string>;
  pendingRequests: number;
  lastSeenAt: number;
  connectedAt: number;
  /** Fixed-window message budget — see Dispatcher#withinRateLimit. */
  rateWindowStartedAt: number;
  messagesInWindow: number;
}

export class ConnectionRegistry {
  readonly #byId = new Map<string, Connection>();
  readonly #byOrganization = new Map<string, Set<string>>();
  readonly #byActor = new Map<string, Set<string>>();

  add(input: {
    ws: WebSocket;
    side: 'agent' | 'customer';
    organizationId: string;
    clientNetwork?: string | null;
  }): Connection {
    const connection: Connection = {
      id: randomUUID(),
      ws: input.ws,
      side: input.side,
      organizationId: input.organizationId,
      authenticated: false,
      loggingIn: false,
      revokedDuringLogin: [],
      clientNetwork: input.clientNetwork ?? null,
      closedBy: null,
      closeAfterReply: null,
      licenseId: null,
      actorId: null,
      actorType: null,
      tokenId: null,
      groupIds: [],
      unrestricted: false,
      authority: null,
      impersonation: null,
      subscriptions: new Set(),
      pendingRequests: 0,
      lastSeenAt: Date.now(),
      connectedAt: Date.now(),
      rateWindowStartedAt: Date.now(),
      messagesInWindow: 0,
    };

    this.#byId.set(connection.id, connection);
    this.#index(this.#byOrganization, connection.organizationId, connection.id);
    return connection;
  }

  /** Called once the login handshake succeeds. */
  authenticate(
    id: string,
    actor: {
      licenseId: string;
      actorId: string;
      actorType?: string;
      /** The `api_tokens` row the credential is (tm 426); absent for a visitor. */
      tokenId?: string | null;
      groupIds?: number[];
      unrestricted?: boolean;
      authority?: SocketAuthority | null;
      impersonation?: SocketImpersonation | null;
    },
  ): Connection | undefined {
    const connection = this.#byId.get(id);
    if (!connection) return undefined;
    // A socket is indexed under one actor at most (tm 425). The dispatcher
    // lets a socket log in once; should this run twice all the same, the first
    // actor's entry goes rather than outliving the socket — `remove` drops
    // only the actor the socket holds at the end.
    if (connection.actorId !== null && connection.actorId !== actor.actorId) {
      this.#deindex(
        this.#byActor,
        this.#actorKey(connection.organizationId, connection.actorId),
        id,
      );
    }
    connection.authenticated = true;
    connection.licenseId = actor.licenseId;
    connection.actorId = actor.actorId;
    connection.actorType = actor.actorType ?? connection.side;
    connection.tokenId = actor.tokenId ?? null;
    connection.groupIds = actor.groupIds ?? [];
    connection.unrestricted = actor.unrestricted ?? false;
    connection.authority = actor.authority ?? null;
    connection.impersonation = actor.impersonation ?? null;
    this.#index(this.#byActor, this.#actorKey(connection.organizationId, actor.actorId), id);
    return connection;
  }

  get(id: string): Connection | undefined {
    return this.#byId.get(id);
  }

  /**
   * Every logged-in member socket — the ones whose reach the permission matrix
   * decides — of one licence, or of every licence. A walk over the node's
   * sockets: it runs when a matrix moves and on the gateway's sweep, not per
   * push.
   */
  members(licenseId?: string): Connection[] {
    const out: Connection[] = [];
    for (const connection of this.#byId.values()) {
      if (!connection.authenticated || connection.authority === null) continue;
      if (licenseId !== undefined && connection.licenseId !== licenseId) continue;
      out.push(connection);
    }
    return out;
  }

  /**
   * Every logged-in socket on this node, of every tenant — for the one message
   * that is not about any tenant: the gateway's own bus came back and pushes may
   * have been lost meanwhile (tm 408). A walk, and a rare one.
   */
  authenticated(): Connection[] {
    return [...this.#byId.values()].filter((connection) => connection.authenticated);
  }

  /** Every authenticated socket for a tenant. Never crosses organizations. */
  forOrganization(organizationId: string): Connection[] {
    return this.inOrganization(organizationId).filter((c) => c.authenticated);
  }

  /**
   * Every socket of a tenant, logged in or not — for the one reader that has to
   * see a login still in flight: a revocation heard meanwhile (tm 426).
   */
  inOrganization(organizationId: string): Connection[] {
    const ids = this.#byOrganization.get(organizationId);
    if (!ids) return [];
    return [...ids].map((id) => this.#byId.get(id)).filter((c): c is Connection => c !== undefined);
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

  /** Actors with at least one socket indexed — what the actor index actually holds. */
  get actors(): number {
    return this.#byActor.size;
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

/**
 * Who a socket's log line is about (ID-08) — the gateway's half of the API's
 * `plugins/log-context.ts`, with the same `LOG_KEYS`. Before login only the
 * organization is known; afterwards the licence and the actor are too.
 */
export function connectionLogContext(connection: Connection): LogContext {
  return {
    organization_id: connection.organizationId,
    ...(connection.licenseId ? { license_id: connection.licenseId } : {}),
    ...(connection.actorId ? { actor_id: connection.actorId } : {}),
    actor_type: connection.actorType ?? connection.side,
  };
}
