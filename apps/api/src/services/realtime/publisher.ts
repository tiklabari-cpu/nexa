/**
 * Publishes realtime events for the RTM gateway to fan out.
 *
 * Two deliberate properties:
 *
 * **Publishing never fails a request.** A message that was written to Postgres
 * has happened; if the notification does not go out, the client recovers it on
 * its next `sync`. Rolling back a persisted message because Redis blinked would
 * turn a cosmetic delay into data loss.
 *
 * **Publishing happens after the transaction commits.** Announcing an event
 * inside the transaction would let a subscriber fetch the chat before the write
 * is visible — and see it missing.
 */
import type { Redis } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import {
  licenseChannel,
  type BusEnvelope,
  type PushAudience,
  type RtmPushAction,
} from '@nexa/types';
import type { TenantContext } from '../../lib/tenant.js';

export class RealtimePublisher {
  constructor(
    private readonly redis: Redis,
    private readonly log: FastifyBaseLogger,
  ) {}

  async publish<P>(
    tenant: TenantContext,
    action: RtmPushAction,
    audience: PushAudience,
    payload: P,
    options: { originConnectionId?: string } = {},
  ): Promise<void> {
    // An empty audience would either reach nobody (wasted work) or, in a
    // careless gateway, everybody. Refuse to emit it at all.
    if (!hasAudience(audience)) {
      this.log.warn({ action }, 'refusing to publish a push with an empty audience');
      return;
    }

    const envelope: BusEnvelope<P> = {
      v: 1,
      licenseId: tenant.licenseId.toString(),
      organizationId: tenant.organizationId,
      action,
      audience,
      payload,
      at: Date.now(),
      ...(options.originConnectionId ? { originConnectionId: options.originConnectionId } : {}),
    };

    try {
      await this.redis.publish(licenseChannel(tenant.licenseId), JSON.stringify(envelope));
    } catch (error) {
      // Never rethrow: the write already succeeded, and the client's next sync
      // will pick this up.
      this.log.error({ err: error, action }, 'realtime publish failed — clients will resync');
    }
  }
}

function hasAudience(audience: PushAudience): boolean {
  return Boolean(
    audience.allAgents ||
    audience.customerId ||
    (audience.groupIds && audience.groupIds.length > 0) ||
    (audience.agentIds && audience.agentIds.length > 0),
  );
}
