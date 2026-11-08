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
 *
 * **A simulation never publishes (tm 314.2 · AI-19 §6).** A test scenario or
 * a sandbox turn has no conversation to announce; a publish inside one throws
 * (`lib/simulation-context.ts`) — the one failure this does not swallow.
 *
 * **A revocation is not a push (tm 426.2).** {@link RealtimePublisher.revoke}
 * tells the gateways that a credential stopped standing — a session signed
 * out, a token revoked, a membership, account or workspace suspended — and
 * every socket it names closes. Same channel, same two rules: after the
 * commit (a gateway that closes a socket lets its client straight back to
 * `login`, which must find the credential already refused), and never
 * failing the request. Every call site is listed in PLAN §D461.
 */
import type { Redis } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import {
  licenseChannel,
  principalRevokedEnvelope,
  PRINCIPAL_REVOKED,
  type BusEnvelope,
  type PrincipalRevokedTarget,
  type PushAudience,
  type RtmPushAction,
} from '@siyahtus/types';
import { refuseInSimulation } from '../../lib/simulation-context.js';
import type { TenantContext } from '../../lib/tenant.js';

/** An `api_tokens` row the caller has just revoked, and whose workspace it is. */
export interface RevokedCredential {
  id: string;
  licenseId: bigint;
  organizationId: string;
}

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
    refuseInSimulation('realtime');
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

  /**
   * Close the sockets `targets` name in this workspace (`principal_revoked`,
   * `@siyahtus/types` `realtime-bus.ts`): one envelope per target on the
   * licence's channel. Call it after the transaction that stopped honouring
   * the credential has committed.
   *
   * Never throws. Unlike a push, a lost revocation has no `sync` to come back
   * by — the socket stays open until it closes for another reason — so a
   * failure is logged as an error, but the change it announces has happened,
   * and the API refuses the credential from the commit on.
   */
  async revoke(tenant: TenantContext, targets: readonly PrincipalRevokedTarget[]): Promise<void> {
    if (targets.length === 0) return;
    const channel = licenseChannel(tenant.licenseId);
    const at = Date.now();
    await Promise.all(
      targets.map(async (target) => {
        try {
          await this.redis.publish(
            channel,
            JSON.stringify(principalRevokedEnvelope(tenant, target, at)),
          );
        } catch (error) {
          this.log.error(
            {
              err: error,
              action: PRINCIPAL_REVOKED,
              license_id: tenant.licenseId.toString(),
              target: target.kind,
            },
            'principal revocation publish failed — its sockets stay open until they close',
          );
        }
      }),
    );
  }

  /** {@link revoke} for the sockets these credential rows opened, workspace by workspace. */
  async revokeTokens(credentials: readonly RevokedCredential[]): Promise<void> {
    const byWorkspace = new Map<string, { tenant: TenantContext; tokenIds: string[] }>();
    for (const credential of credentials) {
      const key = `${credential.licenseId}:${credential.organizationId}`;
      let entry = byWorkspace.get(key);
      if (!entry) {
        entry = {
          tenant: { licenseId: credential.licenseId, organizationId: credential.organizationId },
          tokenIds: [],
        };
        byWorkspace.set(key, entry);
      }
      entry.tokenIds.push(credential.id);
    }
    await Promise.all(
      [...byWorkspace.values()].map(({ tenant, tokenIds }) =>
        this.revoke(
          tenant,
          tokenIds.map((tokenId) => ({ kind: 'token', tokenId })),
        ),
      ),
    );
  }

  /** {@link revoke} for every socket of one member, in each of these workspaces. */
  async revokeMember(agentId: string, workspaces: readonly TenantContext[]): Promise<void> {
    await Promise.all(
      workspaces.map((tenant) => this.revoke(tenant, [{ kind: 'agent', agentId }])),
    );
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
