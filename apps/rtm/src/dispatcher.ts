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
import type { ConflictDetectionService } from './conflict.js';
import type { ConflictPublisher } from './conflict-publisher.js';
import type { Connection, ConnectionRegistry } from './connection.js';
import { encodeError, encodeResponse, type DecodedRequest } from './protocol.js';
import { MAX_SYNC_CHATS, type SyncCursor, type SyncService } from './sync.js';
import type { TypingService } from './typing.js';

/** Actions a socket may send before it has logged in. */
const PRE_AUTH_ACTIONS = new Set<RtmAction>(['login', 'ping']);

export interface DispatcherDeps {
  registry: ConnectionRegistry;
  authenticator: SocketAuthenticator;
  sync: SyncService;
  typing: TypingService;
  /**
   * Multi-agent conflict detection (08.6.3). Optional so the 02.9 typing path
   * never depends on it being wired — when absent, `send_typing_indicator`
   * behaves exactly as before. The gateway always provides both.
   */
  conflict?: ConflictDetectionService;
  conflictPublisher?: ConflictPublisher;
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
      case 'send_typing_indicator':
        return this.#typing(connection, message);
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
      // Data residency (NFR-C4 · C4-b) is the one refusal that is *not*
      // undifferentiated. The credential is genuine and the caller is not short
      // of permission — they opened a socket against a gateway that does not
      // hold their workspace, and unless they are told which one does, the
      // client's only recovery is to retry the wrong address forever. Answered
      // exactly as the REST edge answers it, down to `details.region`, because
      // a client that has to special-case one door per surface will eventually
      // get one of them wrong.
      if (result.reason === 'region_mismatch') {
        this.deps.log.debug(
          { region: result.region, request_id: message.request_id },
          'rtm login refused: wrong region',
        );
        return encodeError(message.request_id, 'login', {
          type: 'misdirected_request',
          message: 'Wrong region for this organization.',
          details: { region: result.region },
        });
      }

      // The precise reason is logged, never returned: distinguishing "expired"
      // from "never existed" confirms which tokens are real. `request_id`
      // rides along (NFR-M5) so the line can be matched to the response frame
      // the client received for the same login attempt.
      this.deps.log.debug(
        { reason: result.reason, request_id: message.request_id },
        'rtm login rejected',
      );
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

    const result = await this.deps.sync.sync(this.#principalOf(connection), cursors);
    return encodeResponse(message.request_id, 'sync', result);
  }

  /**
   * `send_typing_indicator` — the agent side of live typing preview (02.9).
   *
   * A visitor's own typing arrives over the Customer API, not here; the widget
   * polls and has no socket, so it also cannot receive an agent's typing as a
   * push. The bridge is a short-lived flag the visitor's poll reads back, which
   * is all this writes. The chat is authorised first so the indicator cannot be
   * used to probe or spoof a conversation the sender cannot see.
   */
  async #typing(connection: Connection, message: DecodedRequest): Promise<string> {
    if (connection.side === 'customer') {
      // A visitor signals typing through the Customer API's sneak-peek, where
      // the audience (agents only, never the visitor's own side) is decided.
      return this.#fail(
        message,
        'not_allowed',
        'Customers send typing via the Customer API, not RTM.',
      );
    }

    const chatId = message.payload['chat_id'];
    if (typeof chatId !== 'string' || chatId === '') {
      return this.#fail(message, 'validation', 'send_typing_indicator requires a `chat_id`.');
    }
    const isTyping = message.payload['is_typing'];
    if (typeof isTyping !== 'boolean') {
      return this.#fail(message, 'validation', '`is_typing` must be a boolean.');
    }

    const principal = this.#principalOf(connection);
    // An inaccessible chat answers exactly as a missing one: a typing indicator
    // must not confirm which chat ids exist.
    if (!(await this.deps.typing.canType(principal, chatId))) {
      return this.#fail(message, 'not_found', 'Chat not found.');
    }

    await this.deps.typing.setAgentTyping(connection.licenseId ?? '', chatId, isTyping);

    // Multi-agent conflict detection (08.6.3), layered on top of the typing
    // flag above. Register this agent as composing and, when a second agent is
    // composing the same chat at once, warn everyone who is. Kept entirely
    // inside its own guard: no 08.6.3 failure may break the 02.9 indicator that
    // already succeeded, and the warning is best-effort by design.
    const { conflict, conflictPublisher } = this.deps;
    if (conflict && conflictPublisher) {
      try {
        const decision = await conflict.record(principal, chatId, isTyping);
        if (isTyping && decision.conflict) {
          await conflictPublisher.publish(principal, chatId, decision.agents);
        }
      } catch (error) {
        this.deps.log.error(
          { err: error, chat_id: chatId, request_id: message.request_id },
          'conflict detection failed',
        );
      }
    }

    return encodeResponse(message.request_id, 'send_typing_indicator', {
      chat_id: chatId,
      is_typing: isTyping,
    });
  }

  /** The authenticated identity carried on a socket, in the shape reads expect. */
  #principalOf(connection: Connection): SocketPrincipal {
    return {
      kind: connection.side === 'customer' ? 'customer' : 'agent',
      actorId: connection.actorId ?? '',
      licenseId: connection.licenseId ?? '',
      organizationId: connection.organizationId,
      scopes: [],
      groupIds: connection.groupIds,
      unrestricted: connection.unrestricted,
    };
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
