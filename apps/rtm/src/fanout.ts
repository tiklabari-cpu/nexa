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
 */
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import {
  isBusEnvelope,
  licenseChannel,
  type BusEnvelope,
  type SyncRequiredPush,
} from '@siyahtus/types';
import type { Connection, ConnectionRegistry } from './connection.js';
import { encodePush } from './protocol.js';
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

export class Fanout {
  #subscribedLicenses = new Set<string>();
  /** The subscriber has dropped since it was last ready — anything published meanwhile is gone. */
  #lost = false;

  constructor(
    private readonly subscriber: Redis,
    private readonly registry: ConnectionRegistry,
    private readonly log: Logger,
    /** Null when telemetry is off (NODE_ENV=test default) — every call below is then a no-op. */
    private readonly telemetry: Telemetry | null = null,
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
   * Subscribe to a licence's channel on first use.
   *
   * Per-licence channels rather than one global one: a node that happens to
   * host no agents from a busy tenant should not decode that tenant's traffic.
   */
  async ensureSubscribed(licenseId: string): Promise<void> {
    if (this.#subscribedLicenses.has(licenseId)) return;
    this.#subscribedLicenses.add(licenseId);
    try {
      await this.subscriber.subscribe(licenseChannel(licenseId));
    } catch (error) {
      this.#subscribedLicenses.delete(licenseId);
      throw error;
    }
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
    const channels = [...this.#subscribedLicenses].map((licenseId) => licenseChannel(licenseId));
    if (channels.length > 0) {
      try {
        await this.subscriber.subscribe(...channels);
      } catch (error) {
        // Dropped again before it answered: the next `ready` starts over.
        this.#lost = true;
        this.log.warn({ err: error }, 'redis resubscribe failed; waiting for the next reconnect');
        return;
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
        try {
          connection.ws.send(frame);
        } catch (error) {
          this.log.debug({ err: error, connection_id: connection.id }, 'push delivery failed');
        }
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
    if (!isBusEnvelope(parsed)) {
      this.log.warn({ channel }, 'discarded a bus message with an unrecognised shape');
      return;
    }

    const envelope = parsed;
    const frame = encodePush(envelope.action, envelope.payload);

    for (const connection of this.registry.forOrganization(envelope.organizationId)) {
      // The one check the gateway makes for itself. Even a malformed or
      // malicious envelope cannot cross a licence boundary.
      if (connection.licenseId !== envelope.licenseId) continue;
      if (connection.id === envelope.originConnectionId) continue;
      if (!this.#isAddressed(connection, envelope)) continue;
      if (!connection.subscriptions.has(envelope.action)) continue;

      try {
        connection.ws.send(frame);
        // NFR-P1's p99 < 500ms budget is measured against this: the gap
        // between the API deciding something happened (`envelope.at`) and
        // this gateway actually handing it to the socket. Recorded per
        // delivered connection, once per successful send, matching what the
        // metric name promises rather than once per envelope regardless of
        // whether anyone on this node was reachable.
        this.telemetry?.instruments.fanoutDelay.record((Date.now() - envelope.at) / 1000, {
          action: envelope.action,
        });
      } catch (error) {
        this.log.debug({ err: error, connection_id: connection.id }, 'push delivery failed');
      }
    }
  }

  #isAddressed(connection: Connection, envelope: BusEnvelope): boolean {
    const { audience } = envelope;

    if (connection.side === 'customer') {
      // A customer receives only what is addressed to them by id. `allAgents`
      // and team audiences must never reach the widget.
      return audience.customerId !== undefined && audience.customerId === connection.actorId;
    }

    if (audience.allAgents) return true;
    if (audience.agentIds?.includes(connection.actorId ?? '')) return true;
    if (audience.groupIds?.some((groupId) => connection.groupIds.includes(groupId))) return true;

    // An unrestricted token (`chats--all`) sees tenant-wide activity — the same
    // reach it already has over REST.
    return connection.unrestricted && (audience.groupIds?.length ?? 0) > 0;
  }
}
