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
 */
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { isBusEnvelope, licenseChannel, type BusEnvelope } from '@nexa/types';
import type { Connection, ConnectionRegistry } from './connection.js';
import { encodePush } from './protocol.js';

export class Fanout {
  #subscribedLicenses = new Set<string>();

  constructor(
    private readonly subscriber: Redis,
    private readonly registry: ConnectionRegistry,
    private readonly log: Logger,
  ) {
    this.subscriber.on('message', (channel, message) => {
      this.#handle(channel, message);
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
