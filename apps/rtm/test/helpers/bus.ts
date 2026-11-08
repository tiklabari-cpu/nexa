/**
 * What the API puts on the bus, published the way it does — for the suites
 * that drive a real gateway without an API in front of it.
 *
 * `publishRevocation` stands in for the API's revocation points, which publish
 * the same envelope on the same channel since tm 426.2 (the API side is
 * proven against a real gateway in `apps/api/test/integration/revocation-points.test.ts`).
 * Like the API, a caller commits the change first (the token revoked, the
 * membership suspended) and publishes after — a gateway that closes a socket
 * lets its client straight back to `login`.
 */
import type { Redis } from 'ioredis';
import {
  licenseChannel,
  principalRevokedEnvelope,
  type BusEnvelope,
  type PrincipalRevokedEnvelope,
  type PrincipalRevokedTarget,
  type PushAudience,
} from '@siyahtus/types';
import type { RtmTenant } from './fixtures.js';

export async function publishRevocation(
  redis: Redis,
  tenant: Pick<RtmTenant, 'licenseId' | 'organizationId'>,
  target: PrincipalRevokedTarget,
): Promise<PrincipalRevokedEnvelope> {
  const envelope = principalRevokedEnvelope(tenant, target);
  await redis.publish(licenseChannel(tenant.licenseId), JSON.stringify(envelope));
  return envelope;
}

export async function publishPush(
  redis: Redis,
  tenant: Pick<RtmTenant, 'licenseId' | 'organizationId'>,
  action: string,
  audience: PushAudience,
  payload: unknown,
): Promise<void> {
  const envelope: BusEnvelope = {
    v: 1,
    licenseId: tenant.licenseId.toString(),
    organizationId: tenant.organizationId,
    action: action as BusEnvelope['action'],
    audience,
    payload,
    at: Date.now(),
  };
  await redis.publish(licenseChannel(tenant.licenseId), JSON.stringify(envelope));
}
