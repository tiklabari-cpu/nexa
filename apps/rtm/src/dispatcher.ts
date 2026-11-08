/**
 * Action dispatch for an authenticated socket.
 *
 * Every action except `login` and `ping` requires authentication. That is
 * enforced once here rather than in each handler, because a handler that
 * forgets the check is invisible in review and reachable by anyone who can open
 * a socket.
 */
import { performance } from 'node:perf_hooks';
import type { Logger } from 'pino';
import {
  RTM_LIMITS,
  RTM_PUSH_ACTIONS,
  WORKSPACE_SUSPENDED_REASON,
  type ErrorType,
  type RtmAction,
} from '@siyahtus/types';
import {
  principalFitsSide,
  principalLogContext,
  type SocketAuthenticator,
  type SocketPrincipal,
} from './auth.js';
import type { ConflictDetectionService } from './conflict.js';
import type { ConflictPublisher } from './conflict-publisher.js';
import type { Connection, ConnectionRegistry } from './connection.js';
import {
  cursorsWithinBounds,
  hasMoreKeysThan,
  MAX_LOGIN_PUSHES,
  MAX_SYNC_CHAT_ID_LENGTH,
  MAX_SYNC_EVENT_ID_LENGTH,
  pushesWithinBounds,
} from './input-bounds.js';
import { encodeError, encodeResponse, type DecodedRequest } from './protocol.js';
import { revocationNames } from './revocation.js';
import { MAX_SYNC_CHATS, type SyncCursor, type SyncService } from './sync.js';
import type { TypingService } from './typing.js';

/** Actions a socket may send before it has logged in. */
const PRE_AUTH_ACTIONS = new Set<RtmAction>(['login', 'ping']);

/**
 * RFC 6455 "Policy Violation": the close sent after refusing a credential
 * presented at the other side's door (tm 425). The same credential at the same
 * door is refused again, so this is not an invitation to retry.
 */
export const WRONG_SIDE_CLOSE_CODE = 1008;

/**
 * RFC 6455 "Try Again Later": the close sent after refusing a visitor's login
 * at the post-login socket caps (tm 427). A slot frees when one of the
 * visitor's other sockets closes; meanwhile the widget stays on its poll.
 */
export const SOCKET_LIMIT_CLOSE_CODE = 1013;

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
  /**
   * Whether the root panel put the deployment in `full` maintenance (tm
   * 389.13 · `maintenance.ts`): `login` is then refused. Omitted, never.
   */
  inMaintenance?: () => boolean;
  /**
   * Counts an accepted login against the post-login socket caps (tm 427 ·
   * `customer-socket-limit.ts`), synchronously and before the socket is marked
   * logged in. True admits it; false refuses it — the login is answered
   * `too_many_requests` and the socket closed. Omitted, every login is admitted.
   */
  admitLogin?: (connection: Connection, principal: SocketPrincipal) => boolean;
  /**
   * Waits until this node listens to the licence's bus channel, and resolves
   * with when that was last confirmed (`performance.now()`) — `Fanout.
   * ensureSubscribed` (tm 426). A member's or a bot's credential read before
   * then is read again, since a revocation published in between never reached
   * this node. Omitted, the credential is read once and the subscription is
   * left to `onAuthenticated`.
   */
  listen?: (licenseId: string) => Promise<number>;
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
    // One login at a time (tm 425). Taken before anything awaits, so a second
    // `login` arriving while the first one's token is being checked finds it
    // held — without it both passed the check above, both awaited, and both
    // succeeded: the second identity replaced the first on the socket, and the
    // actor index kept the first one's entry for good.
    if (connection.loggingIn) {
      return encodeError(message.request_id, 'login', {
        type: 'not_allowed',
        message: 'A login is already in progress on this socket.',
      });
    }
    connection.loggingIn = true;
    connection.revokedDuringLogin = [];
    try {
      return await this.#attemptLogin(connection, message);
    } finally {
      // On every path: a refused login leaves the socket free to log in again,
      // and a logged-in one is closed by a revocation directly (tm 426).
      connection.loggingIn = false;
      connection.revokedDuringLogin = [];
    }
  }

  async #attemptLogin(connection: Connection, message: DecodedRequest): Promise<string> {
    // Maintenance (tm 389.13): the REST edge's 503 `maintenance`, before the
    // credential is even looked at — there is nothing to sign in to.
    if (this.deps.inMaintenance?.()) {
      return encodeError(message.request_id, 'login', {
        type: 'maintenance',
        message: 'This service is down for maintenance. Please try again later.',
        details: { mode: 'full' },
      });
    }

    const token = message.payload['token'];
    if (typeof token !== 'string') {
      return this.#fail(message, 'validation', 'login requires a `token`.');
    }
    // Before the token is looked at (tm 419 · `input-bounds.ts`): a visitor
    // token is anyone's, and an oversized list is refused unread.
    if (connection.side === 'customer' && !pushesWithinBounds(message.payload['pushes'])) {
      return this.#fail(
        message,
        'validation',
        `login accepts at most ${MAX_LOGIN_PUSHES} push actions.`,
      );
    }

    const authenticate = () =>
      this.deps.authenticator.authenticate(token, connection.organizationId, connection.side);
    const readAt = performance.now();
    let result = await authenticate();

    // A credential this node could not yet hear revoked (tm 426). Revocations
    // travel on the licence's bus channel, which a node subscribes to with the
    // first socket of the licence it holds — so for that login the credential
    // was read before this node listened, and one revoked in between was
    // announced to nobody here. Once the subscription is confirmed, a read
    // that began before it is done again: the API publishes after its commit,
    // so whatever was announced before the subscription is in that read, and
    // whatever is announced after it reaches this node. A visitor's token is
    // signed, not stored, and nothing revokes it.
    if (
      this.deps.listen &&
      result.ok &&
      connection.side === 'agent' &&
      principalFitsSide(result.principal.kind, connection.side)
    ) {
      const confirmedAt = await this.deps.listen(result.principal.licenseId);
      if (confirmedAt >= readAt) result = await authenticate();
    }

    // The door decides who may log in through it (tm 425): a visitor at the
    // customer socket, a member or a bot at the agent socket. A visitor token
    // at the agent door used to log in and be addressed as an agent —
    // `allAgents` pushes reached it. The authenticator refuses a token of the
    // wrong family before checking it; the principal it resolved is checked
    // here as well, whatever the authenticator's routing becomes. Answered like
    // any refused credential, and the socket is closed: the same token at the
    // same door is refused again.
    const wrongSide = result.ok
      ? !principalFitsSide(result.principal.kind, connection.side)
      : result.reason === 'side_mismatch';
    if (wrongSide) {
      this.deps.log.debug(
        { reason: 'side_mismatch', side: connection.side, request_id: message.request_id },
        'rtm login rejected',
      );
      connection.closedBy = 'login_refused';
      connection.closeAfterReply = {
        code: WRONG_SIDE_CLOSE_CODE,
        reason: 'credential not valid for this socket',
      };
      return this.#fail(message, 'authentication', 'Invalid or expired credentials.');
    }

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

      // The platform suspended the workspace (tm 389.2): the credential is
      // genuine, and the REST edge says so with the same 403, so a client
      // shows "temporarily out of service" instead of signing in again.
      if (result.reason === 'workspace_suspended') {
        this.deps.log.debug({ request_id: message.request_id }, 'rtm login refused: suspended');
        return encodeError(message.request_id, 'login', {
          type: 'not_allowed',
          message: 'This workspace is temporarily suspended.',
          details: { reason: WORKSPACE_SUSPENDED_REASON },
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

    // A revocation heard while the credential was being read (tm 426) — the
    // read began before the API's commit and cannot have seen it, and a socket
    // that is not logged in yet is not one the revocation could close. Refused
    // as the credential will be from now on; a reconnect is told the reason.
    // Synchronously before the socket is marked logged in, so a revocation
    // arriving from here on finds it and closes it.
    const subject = {
      licenseId: principal.licenseId,
      organizationId: connection.organizationId,
      side: connection.side,
      actorId: principal.actorId,
      tokenId: principal.tokenId ?? null,
    };
    if (connection.revokedDuringLogin.some((envelope) => revocationNames(envelope, subject))) {
      this.deps.log.debug(
        { reason: 'revoked_during_login', request_id: message.request_id },
        'rtm login rejected',
      );
      return this.#fail(message, 'authentication', 'Invalid or expired credentials.');
    }

    // The post-login socket caps (tm 427), counted before the socket is marked
    // logged in so a refused one never is. Answered like the pre-login cap's
    // refusal — the reason, never the number — and the socket is closed.
    if (this.deps.admitLogin && !this.deps.admitLogin(connection, principal)) {
      connection.closedBy = 'socket_limit';
      connection.closeAfterReply = {
        code: SOCKET_LIMIT_CLOSE_CODE,
        reason: 'socket limit reached',
      };
      return encodeError(message.request_id, 'login', {
        type: 'too_many_requests',
        message: 'Too many connections are open for this visitor or from this network.',
        details: { reason: 'socket_limit_reached' },
      });
    }

    this.deps.registry.authenticate(connection.id, {
      licenseId: principal.licenseId,
      actorId: principal.actorId,
      actorType: principal.kind,
      tokenId: principal.tokenId ?? null,
      groupIds: principal.groupIds,
      unrestricted: principal.unrestricted,
      authority: principal.authority,
      impersonation: principal.impersonation ?? null,
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

    // Counted before the entries are built (tm 419 · `input-bounds.ts`).
    if (hasMoreKeysThan(raw, MAX_SYNC_CHATS)) {
      return this.#fail(
        message,
        'limit_reached',
        `sync accepts at most ${MAX_SYNC_CHATS} chats per request.`,
      );
    }
    // A chat the caller names but cannot see is echoed in `removed_chat_ids`,
    // so a key no chat id could be is refused rather than echoed (tm 428). The
    // message names the bounds, never the key.
    if (!cursorsWithinBounds(raw)) {
      return this.#fail(
        message,
        'validation',
        `sync cursors name a chat in at most ${MAX_SYNC_CHAT_ID_LENGTH} characters and an event in at most ${MAX_SYNC_EVENT_ID_LENGTH}.`,
      );
    }
    const entries = Object.entries(raw as Record<string, unknown>);

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

    // An operator in a read-only session (tm 389.15) says nothing to a
    // visitor: "is typing" is a write like any other, refused as the REST
    // edge refuses one.
    if (connection.impersonation?.mode === 'read_only') {
      return this.#fail(
        message,
        'impersonation_read_only',
        'This is a read-only support session: nothing can be sent from it.',
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
    const access = await this.deps.typing.canType(principal, chatId);
    if (!access) {
      return this.#fail(message, 'not_found', 'Chat not found.');
    }

    // Only the agent the open connection is assigned to answers the visitor
    // (tm 475), so only their typing reaches the visitor: anyone else is
    // writing a note, or cannot reply at all. Not an error — the request was
    // fine, it simply has no audience on the visitor's side — and their stop
    // does not clear the assignee's flag either. A bot is not subject to the
    // rule, as it is not when it writes.
    if (access.assignee || connection.actorType === 'bot') {
      await this.deps.typing.setAgentTyping(connection.licenseId ?? '', chatId, isTyping);
    }

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
          {
            ...principalLogContext(principal),
            err: error,
            chat_id: chatId,
            request_id: message.request_id,
          },
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
      authority: connection.authority,
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
