/**
 * Redis → socket fan-out.
 *
 * The gateway is deliberately dumb: it trusts the audience the API put in the
 * envelope and makes no authorization decision of its own. It has no tenant
 * context and no view of team membership, so anything it decided would be a
 * guess — and a guess in this direction means delivering one customer's
 * conversation to the wrong agent.
 *
 * What it *does* enforce is the boundary it can see: the envelope's licence must
 * match the connection's, always, regardless of what the audience says.
 *
 * **A lost subscription is announced (tm 408).** Redis pub/sub is at-most-once:
 * a push published while this node was not subscribed — Redis restarting, its
 * name not resolving for a moment — reaches nobody, and ioredis's resubscribe
 * does not bring it back. The sockets never dropped, so their clients had no
 * reason to run the reconnect `sync` that would. Measured in the tur 2 chaos
 * run: a message accepted (201, in Postgres) during a Redis restart did not
 * reach the open agent socket, 3 of 3 times, until the page was reloaded. So
 * once the subscription is back, every logged-in socket that asked for it gets
 * `sync_required`, and the client runs the same cursor `sync` a reconnect does.
 *
 * **A visitor's draft reaches people only, and a full socket does not lose it
 * (tm 417.4).** The draft preview — `incoming_sneak_peek` while there is text,
 * `incoming_typing_indicator` when it is cleared — is for the human agent who
 * holds the chat. A bot logs in with team reach like a member, and an
 * unrestricted one hears every team-addressed push, so the gateway refuses these
 * two actions to any socket that did not log in as an agent, whatever the
 * audience says. A draft frame is superseded by the next one: on a socket whose
 * send buffer is already full, queueing them all only delays the one that
 * matters. Dropping them is worse — the widget sends nothing while the text
 * stands still, so a dropped last frame is a draft the agent never sees. So on a
 * congested socket the newest frame per chat waits, older ones are discarded,
 * and it goes out once the buffer drains. A clear is never held, and it cancels
 * the frame waiting for its chat.
 *
 * **Every write goes through the gateway's one writer (tm 428).** A socket whose
 * unsent frames passed `RTM_MAX_BUFFERED_BYTES` is closed there instead of being
 * written to (`socket-writer.ts`); the draft holding above happens well below
 * that line ({@link SNEAK_PEEK_COALESCE_BUFFERED_BYTES}).
 *
 * **Who logged in decides the audience, not which door they used (tm 425).**
 * The login refuses a credential at the other side's door; the audience filter
 * keys on the principal as well, so a visitor's credential — wherever it was
 * presented — is reached only by pushes addressed to it by id.
 *
 * **A revocation arrives here too, and is not a push (tm 426).** The API
 * announces a credential it stopped honouring on the licence's channel, so it
 * reaches the gateway in order with the pushes around it: anything published
 * after it finds the socket closed. It goes to the gateway's handler
 * (`revocation.ts`), never to a socket.
 */
import { performance } from 'node:perf_hooks';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import {
  isBusEnvelope,
  licenseChannel,
  readPrincipalRevoked,
  type BusEnvelope,
  type PrincipalRevokedEnvelope,
  type SyncRequiredPush,
} from '@siyahtus/types';
import type { Connection, ConnectionRegistry } from './connection.js';
import { encodePush } from './protocol.js';
import type { SocketWriter } from './socket-writer.js';
import type { Telemetry } from './telemetry/telemetry.js';

/**
 * How the `sync_required` announcement is spread out (tm 408): every socket that
 * hears it runs a `sync`, which is a Postgres transaction, so a node with a few
 * thousand sockets must not send them all in the same millisecond. Each socket
 * widens the window by this much, up to the cap — one socket is told at once,
 * a thousand over five seconds, which is still well inside the gap the restart
 * itself was.
 */
export const RESYNC_SPREAD_PER_SOCKET_MS = 5;
export const RESYNC_SPREAD_MAX_MS = 5_000;

/**
 * Pushes only a person may receive (tm 417.4): the visitor's unsent draft and
 * its clear. Delivered to a socket that logged in as an agent and to nothing
 * else — not a bot, not a customer — however the envelope addresses it.
 */
export const HUMAN_ONLY_ACTIONS: ReadonlySet<string> = new Set([
  'incoming_sneak_peek',
  'incoming_typing_indicator',
]);

/**
 * Pushes where only the newest one per chat matters, so a congested socket
 * holds the latest instead of queueing every one (tm 417.4).
 */
export const COALESCIBLE_ACTIONS: ReadonlySet<string> = new Set(['incoming_sneak_peek']);

/**
 * A socket with more than this many bytes waiting to be written is congested.
 * The largest draft frame is about 2.5 KB (500 code points of text plus the
 * envelope), so this is some 25 of them already queued.
 */
export const SNEAK_PEEK_COALESCE_BUFFERED_BYTES = 64 * 1024;

/** How often a congested socket with held frames is looked at again. */
export const SNEAK_PEEK_COALESCE_RETRY_MS = 250;

/** The newest coalescible frame per chat, waiting on one congested socket. */
interface HeldFrames {
  connection: Connection;
  /** By chat id. Insertion order is the order they go out in. */
  frames: Map<string, { frame: string; action: string; at: number }>;
  timer: ReturnType<typeof setTimeout>;
}

export class Fanout {
  /**
   * The licences this node listens to, each with when its subscription was
   * last confirmed (`performance.now()`) — a promise, so a login arriving while
   * the first one's `SUBSCRIBE` is in flight waits for the same answer instead
   * of taking the subscription as made (tm 426).
   */
  #subscribedLicenses = new Map<string, Promise<number>>();
  /** The subscriber has dropped since it was last ready — anything published meanwhile is gone. */
  #lost = false;
  /** Held draft frames by connection id (tm 417.4): one timer per connection, not per frame. */
  #held = new Map<string, HeldFrames>();

  constructor(
    private readonly subscriber: Redis,
    private readonly registry: ConnectionRegistry,
    private readonly log: Logger,
    /** The gateway's one writer (tm 428) — the slow-consumer check lives there. */
    private readonly writer: SocketWriter,
    /** Null when telemetry is off (NODE_ENV=test default) — every call below is then a no-op. */
    private readonly telemetry: Telemetry | null = null,
    /**
     * Where a `principal_revoked` envelope goes (tm 426 · `revocation.ts`).
     * Null drops it — the behaviour of a gateway that predates it.
     */
    private readonly onRevoked: ((envelope: PrincipalRevokedEnvelope) => void) | null = null,
  ) {
    this.subscriber.on('message', (channel, message) => {
      this.#handle(channel, message);
    });
    // `reconnecting` rather than `close`: a `quit` at shutdown closes too, and
    // is not an outage. It fires again before every attempt; only the first of
    // an outage is news.
    this.subscriber.on('reconnecting', () => {
      if (this.#lost) return;
      this.#lost = true;
      this.log.warn(
        { subscribed_licenses: this.#subscribedLicenses.size },
        'redis subscription lost; pushes published until it is back will not be delivered',
      );
    });
    this.subscriber.on('ready', () => {
      if (!this.#lost) return;
      this.#lost = false;
      void this.#recover();
    });
  }

  /**
   * Subscribe to a licence's channel on first use. Resolves once the
   * subscription is confirmed, with when it last was (`performance.now()`).
   *
   * Per-licence channels rather than one global one: a node that happens to
   * host no agents from a busy tenant should not decode that tenant's traffic.
   *
   * The time is for a login (tm 426): a credential read before the
   * subscription was confirmed may have missed a revocation published in
   * between, which this node never heard — so the dispatcher reads it again.
   */
  ensureSubscribed(licenseId: string): Promise<number> {
    const existing = this.#subscribedLicenses.get(licenseId);
    if (existing) return existing;
    const confirmed = this.subscriber.subscribe(licenseChannel(licenseId)).then(
      () => performance.now(),
      (error: unknown) => {
        // Only this attempt's entry: a later one may already have replaced it.
        if (this.#subscribedLicenses.get(licenseId) === confirmed) {
          this.#subscribedLicenses.delete(licenseId);
        }
        throw error;
      },
    );
    this.#subscribedLicenses.set(licenseId, confirmed);
    return confirmed;
  }

  /**
   * Re-subscribe, then tell the sockets to `sync`.
   *
   * ioredis resubscribes on its own, but `ready` is emitted *before* it sends
   * those commands, so an announcement made from the event itself would let a
   * client's `sync` race a push published in the next few milliseconds into the
   * same hole. Subscribing again here (idempotent on the server) and waiting for
   * the answer means that by the time a socket hears `sync_required`, anything
   * published from then on is delivered live and anything before it is in what
   * the `sync` reads.
   */
  async #recover(): Promise<void> {
    const licenses = [...this.#subscribedLicenses.keys()];
    const channels = licenses.map((licenseId) => licenseChannel(licenseId));
    if (channels.length > 0) {
      try {
        await this.subscriber.subscribe(...channels);
      } catch (error) {
        // Dropped again before it answered: the next `ready` starts over.
        this.#lost = true;
        this.log.warn({ err: error }, 'redis resubscribe failed; waiting for the next reconnect');
        return;
      }
      // Confirmed again only now (tm 426): a login that read its credential
      // during the outage reads it again, as it would on a first subscription.
      const confirmedAt = Promise.resolve(performance.now());
      for (const licenseId of licenses) {
        if (this.#subscribedLicenses.has(licenseId)) {
          this.#subscribedLicenses.set(licenseId, confirmedAt);
        }
      }
    }
    const told = this.#announceResync();
    this.log.info(
      { subscribed_licenses: channels.length, sockets_told: told },
      'redis subscription restored; sockets asked to sync',
    );
  }

  /** Send `sync_required` to every logged-in socket that subscribed to it; returns how many. */
  #announceResync(): number {
    const payload: SyncRequiredPush = { reason: 'bus_reconnected' };
    const frame = encodePush('sync_required', payload);
    const targets = this.registry
      .authenticated()
      .filter((connection) => connection.subscriptions.has('sync_required'));
    const window = Math.min(targets.length * RESYNC_SPREAD_PER_SOCKET_MS, RESYNC_SPREAD_MAX_MS);

    for (const connection of targets) {
      const timer = setTimeout(() => {
        // Closed (or replaced) while it waited its turn.
        if (this.registry.get(connection.id) !== connection) return;
        this.writer.write(connection, frame);
      }, Math.random() * window);
      timer.unref();
    }
    return targets.length;
  }

  #handle(channel: string, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.log.warn({ channel }, 'discarded a non-JSON bus message');
      return;
    }
    // Before the push shape (tm 426): a revocation is not one, and is never
    // delivered to a socket.
    const revocation = readPrincipalRevoked(parsed);
    if (revocation !== null) {
      this.#revoke(channel, revocation);
      return;
    }
    if (!isBusEnvelope(parsed)) {
      this.log.warn({ channel }, 'discarded a bus message with an unrecognised shape');
      return;
    }

    const envelope = parsed;
    const frame = encodePush(envelope.action, envelope.payload);
    const humanOnly = HUMAN_ONLY_ACTIONS.has(envelope.action);
    const coalescible = COALESCIBLE_ACTIONS.has(envelope.action);
    const chatId = humanOnly ? chatIdOf(envelope.payload) : null;

    for (const connection of this.registry.forOrganization(envelope.organizationId)) {
      // The one check the gateway makes for itself. Even a malformed or
      // malicious envelope cannot cross a licence boundary.
      if (connection.licenseId !== envelope.licenseId) continue;
      if (connection.id === envelope.originConnectionId) continue;
      if (!this.#isAddressed(connection, envelope)) continue;
      if (!connection.subscriptions.has(envelope.action)) continue;
      // The draft is for a person (tm 417.4): a bot logs in with team reach
      // and, unrestricted, would otherwise hear every chat's.
      if (humanOnly && connection.actorType !== 'agent') continue;

      if (chatId !== null) {
        if (coalescible && connection.ws.bufferedAmount > SNEAK_PEEK_COALESCE_BUFFERED_BYTES) {
          this.#hold(connection, chatId, frame, envelope);
          continue;
        }
        // Whatever goes out now — a newer draft or the clear — supersedes a
        // frame still waiting for this chat.
        this.#discardHeld(connection.id, chatId);
      }

      this.#deliver(connection, frame, envelope.action, envelope.at);
    }
  }

  /**
   * Hand a revocation to the gateway's handler (tm 426). Loud when it cannot:
   * a revocation dropped is a socket left open that should have closed.
   */
  #revoke(channel: string, revocation: PrincipalRevokedEnvelope | 'malformed'): void {
    if (revocation === 'malformed') {
      this.log.error({ channel }, 'discarded a principal_revoked message it could not read');
      return;
    }
    // An envelope acts on the licence whose channel carried it and on no
    // other: only the API publishes here, and a mistake in one licence's
    // announcement must not close another's sockets.
    if (channel !== licenseChannel(revocation.licenseId)) {
      this.log.error(
        { channel, license_id: revocation.licenseId },
        'discarded a principal_revoked message from another licence channel',
      );
      return;
    }
    this.onRevoked?.(revocation);
  }

  /**
   * Forget a closed socket's held frames and stop its timer — the socket's close
   * handler calls this. The timer also checks the registry, should a close
   * ever be missed.
   */
  release(connectionId: string): void {
    const held = this.#held.get(connectionId);
    if (!held) return;
    clearTimeout(held.timer);
    this.#held.delete(connectionId);
  }

  #deliver(connection: Connection, frame: string, action: string, at: number): void {
    if (!this.writer.write(connection, frame)) {
      this.log.debug({ connection_id: connection.id, action }, 'push not delivered');
      return;
    }
    // NFR-P1's p99 < 500ms budget is measured against this: the gap
    // between the API deciding something happened (`envelope.at`) and
    // this gateway actually handing it to the socket. Recorded per
    // delivered connection, once per successful send, matching what the
    // metric name promises rather than once per envelope regardless of
    // whether anyone on this node was reachable. A held frame's wait counts.
    this.telemetry?.instruments.fanoutDelay.record((Date.now() - at) / 1000, { action });
  }

  /** Keep `frame` as this chat's newest on a congested socket, replacing an older one. */
  #hold(connection: Connection, chatId: string, frame: string, envelope: BusEnvelope): void {
    let held = this.#held.get(connection.id);
    if (!held) {
      held = { connection, frames: new Map(), timer: this.#retryTimer(connection.id) };
      this.#held.set(connection.id, held);
    }
    // Deleted first so a replaced chat moves to the back: frames leave in the
    // order their newest version arrived.
    held.frames.delete(chatId);
    held.frames.set(chatId, { frame, action: envelope.action, at: envelope.at });
    this.telemetry?.instruments.fanoutCoalesced.add(1, { action: envelope.action });
    // Ids and the action only — never the payload, which is the visitor's text.
    this.log.debug(
      { connection_id: connection.id, action: envelope.action },
      'coalesced a push on a congested socket',
    );
  }

  #discardHeld(connectionId: string, chatId: string): void {
    const held = this.#held.get(connectionId);
    if (!held?.frames.delete(chatId)) return;
    if (held.frames.size === 0) this.release(connectionId);
  }

  #retryTimer(connectionId: string): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.#flushHeld(connectionId);
    }, SNEAK_PEEK_COALESCE_RETRY_MS);
    timer.unref();
    return timer;
  }

  #flushHeld(connectionId: string): void {
    const held = this.#held.get(connectionId);
    if (!held) return;
    // Closed (or replaced) while its frames waited.
    if (this.registry.get(connectionId) !== held.connection) {
      this.release(connectionId);
      return;
    }
    if (held.connection.ws.bufferedAmount > SNEAK_PEEK_COALESCE_BUFFERED_BYTES) {
      held.timer = this.#retryTimer(connectionId);
      return;
    }
    this.#held.delete(connectionId);
    for (const { frame, action, at } of held.frames.values()) {
      this.#deliver(held.connection, frame, action, at);
    }
  }

  #isAddressed(connection: Connection, envelope: BusEnvelope): boolean {
    const { audience } = envelope;

    // Keyed on the principal as well as the door (tm 425). A visitor's
    // credential receives only what is addressed to it by id, wherever it was
    // presented; `allAgents` and team audiences must never reach a widget, nor
    // a visitor at the agent door. Nothing but a member or a bot hears them,
    // and only at the agent door.
    if (connection.actorType === 'customer' || connection.side === 'customer') {
      return (
        connection.actorType === 'customer' &&
        audience.customerId !== undefined &&
        audience.customerId === connection.actorId
      );
    }
    if (connection.actorType !== 'agent' && connection.actorType !== 'bot') return false;

    if (audience.allAgents) return true;
    if (audience.agentIds?.includes(connection.actorId ?? '')) return true;
    if (audience.groupIds?.some((groupId) => connection.groupIds.includes(groupId))) return true;

    // An unrestricted token (`chats--all`) sees tenant-wide activity — the same
    // reach it already has over REST.
    return connection.unrestricted && (audience.groupIds?.length ?? 0) > 0;
  }
}

/** The chat a push is about, when its payload names one. */
function chatIdOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const chatId = (payload as { chat_id?: unknown }).chat_id;
  return typeof chatId === 'string' && chatId !== '' ? chatId : null;
}
