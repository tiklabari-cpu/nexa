/**
 * Action dispatch for an authenticated socket.
 *
 * Every action except `login` and `ping` requires authentication. That is
 * enforced once here rather than in each handler, because a handler that
 * forgets the check is invisible in review and reachable by anyone who can open
 * a socket.
 */
import type { Logger } from 'pino';
import { RTM_LIMITS, RTM_PUSH_ACTIONS, type ErrorType, type RtmAction } from '@nexa/types';
import type { SocketAuthenticator, SocketPrincipal } from './auth.js';
import type { Connection, ConnectionRegistry } from './connection.js';
import { encodeError, encodeResponse, type DecodedRequest } from './protocol.js';
import { MAX_SYNC_CHATS, type SyncCursor, type SyncService } from './sync.js';

/** Actions a socket may send before it has logged in. */
const PRE_AUTH_ACTIONS = new Set<RtmAction>(['login', 'ping']);

export interface DispatcherDeps {
  registry: ConnectionRegistry;
  authenticator: SocketAuthenticator;
  sync: SyncService;
  log: Logger;
  onAuthenticated: (connection: Connection, principal: SocketPrincipal) => Promise<void>;
  /** Per-connection message budget, from RATE_LIMIT_RTM_PER_SEC. */
  messagesPerSecond: number;
}

export class Dispatcher {
  constructor(private readonly deps: DispatcherDeps) {}

  async dispatch(connection: Connection, message: DecodedRequest): Promise<string> {
    if (!connection.authenticated && !PRE_AUTH_ACTIONS.has(message.action)) {
      return encodeError(message.request_id, message.action, {
        type: 'authentication',
        message: 'Send `login` before any other action.',
      });
    }

    // A socket that outruns its budget is throttled rather than closed: the
    // usual cause is an over-eager client, and dropping the connection would
    // cost the agent their live conversation.
    if (!this.#withinRateLimit(connection)) {
      return encodeError(message.request_id, message.action, {
        type: 'too_many_requests',
        message: `Rate limit exceeded (${this.deps.messagesPerSecond} messages/second).`,
      });
    }

    switch (message.action) {
      case 'ping':
        return encodeResponse(message.request_id, 'ping', {});
      case 'login':
        return this.#login(connection, message);
      case 'subscribe':
        return this.#subscribe(connection, message);
      case 'unsubscribe':
        return this.#unsubscribe(connection, message);
      case 'sync':
        return this.#sync(connection, message);
      case 'logout':
        return encodeResponse(message.request_id, 'logout', {});
      default:
        // Chat mutations go over REST (ADR-04). Accepting them here too would
        // mean two implementations of the same invariants.
        return encodeError(message.request_id, message.action, {
          type: 'not_allowed',
          message: `"${message.action}" is not available over RTM — use the REST API.`,
        });
    }
  }

  async #login(connection: Connection, message: DecodedRequest): Promise<string> {
    if (connection.authenticated) {
      return encodeError(message.request_id, 'login', {
        type: 'not_allowed',
        message: 'This socket is already authenticated.',
      });
    }

    const token = message.payload['token'];
    if (typeof token !== 'string') {
      return this.#fail(message, 'validation', 'login requires a `token`.');
    }

    const result = await this.deps.authenticator.authenticate(token, connection.organizationId);
    if (!result.ok) {
      // The precise reason is logged, never returned: distinguishing "expired"
      // from "never existed" confirms which tokens are real.
      this.deps.log.debug({ reason: result.reason }, 'rtm login rejected');
      return this.#fail(message, 'authentication', 'Invalid or expired credentials.');
    }

    const { principal } = result;
    this.deps.registry.authenticate(connection.id, {
      licenseId: principal.licenseId,
      actorId: principal.actorId,
      groupIds: principal.groupIds,
      unrestricted: principal.unrestricted,
    });

    // Requested subscriptions are applied at login so a client is live from its
    // first frame, with no window where events are missed.
    const requested = extractPushes(message.payload['pushes']);
    for (const action of requested) connection.subscriptions.add(action);

    await this.deps.onAuthenticated(connection, principal);

    return encodeResponse(message.request_id, 'login', {
      license: { id: principal.licenseId, organization_id: principal.organizationId },
      my_profile: {
        id: principal.actorId,
        kind: principal.kind,
        scopes: principal.scopes,
      },
      subscribed: [...connection.subscriptions],
      limits: {
        ping_interval_ms: RTM_LIMITS.pingIntervalMs,
        max_pending_requests: RTM_LIMITS.maxPendingRequests,
        request_timeout_ms: RTM_LIMITS.requestTimeoutMs,
      },
    });
  }

  #subscribe(connection: Connection, message: DecodedRequest): string {
    const requested = extractPushes(message.payload['pushes'] ?? message.payload['actions']);
    if (requested.length === 0) {
      return this.#fail(
        message,
        'validation',
        'subscribe requires at least one known push action.',
      );
    }
    for (const action of requested) connection.subscriptions.add(action);
    return encodeResponse(message.request_id, 'subscribe', {
      subscribed: [...connection.subscriptions],
    });
  }

  #unsubscribe(connection: Connection, message: DecodedRequest): string {
    const requested = extractPushes(message.payload['pushes'] ?? message.payload['actions']);
    for (const action of requested) connection.subscriptions.delete(action);
    return encodeResponse(message.request_id, 'unsubscribe', {
      subscribed: [...connection.subscriptions],
    });
  }

  async #sync(connection: Connection, message: DecodedRequest): Promise<string> {
    const raw = message.payload['cursors'];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return this.#fail(message, 'validation', 'sync requires a `cursors` object.');
    }

    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > MAX_SYNC_CHATS) {
      return this.#fail(
        message,
        'limit_reached',
        `sync accepts at most ${MAX_SYNC_CHATS} chats per request.`,
      );
    }

    const cursors: SyncCursor[] = entries.map(([chatId, lastEventId]) => ({
      chatId,
      lastEventId: typeof lastEventId === 'string' ? lastEventId : null,
    }));

    const principal: SocketPrincipal = {
      kind: connection.side === 'customer' ? 'customer' : 'agent',
      actorId: connection.actorId ?? '',
      licenseId: connection.licenseId ?? '',
      organizationId: connection.organizationId,
      scopes: [],
      groupIds: connection.groupIds,
      unrestricted: connection.unrestricted,
    };

    const result = await this.deps.sync.sync(principal, cursors);
    return encodeResponse(message.request_id, 'sync', result);
  }

  #fail(message: DecodedRequest, type: ErrorType, text: string): string {
    return encodeError(message.request_id, message.action, { type, message: text });
  }

  /** Fixed window, one second — coarse on purpose; this only stops runaways. */
  #withinRateLimit(connection: Connection): boolean {
    const now = Date.now();
    if (now - connection.rateWindowStartedAt >= 1000) {
      connection.rateWindowStartedAt = now;
      connection.messagesInWindow = 0;
    }
    connection.messagesInWindow += 1;
    return connection.messagesInWindow <= this.deps.messagesPerSecond;
  }
}

/** Keeps unknown push names out of the subscription set. */
function extractPushes(value: unknown): string[] {
  const known = new Set<string>(RTM_PUSH_ACTIONS);

  const collect = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((v): v is string => typeof v === 'string') : [];

  if (Array.isArray(value)) return collect(value).filter((v) => known.has(v));

  // Version-keyed form: { "3.6": ["incoming_event", ...] }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>)
      .flatMap(collect)
      .filter((v) => known.has(v));
  }
  return [];
}
