/**
 * `permissions.changed` — a workspace's permission matrix moved (tm 325.2 ·
 * RL-02), announced after the commit so every process drops its cached copy.
 *
 * The message is `<licence>:<version>` (`@siyahtus/types`
 * `permissionsChangedMessage`). One nobody heard costs at most the cache's
 * minute (`PERMISSIONS_CACHE_TTL_MS`), so correctness never rests on it; a
 * message this cannot read drops every workspace's matrix rather than none —
 * the shape `ai-caps-events.ts` has for the AI caps.
 */
import {
  PERMISSIONS_CHANGED_CHANNEL,
  parsePermissionsChangedMessage,
  permissionsChangedMessage,
} from '@siyahtus/types';
import type { Redis } from 'ioredis';

/** Announce that `licenseId`'s matrix reached `version`. After the commit. */
export async function publishPermissionsChanged(
  redis: Redis,
  licenseId: bigint,
  version: number,
): Promise<void> {
  await redis.publish(PERMISSIONS_CHANGED_CHANNEL, permissionsChangedMessage(licenseId, version));
}

/**
 * Call `onChange` for every announcement on `subscriber`, which this puts in
 * subscriber mode — a connection of its own, since a subscribed client can do
 * nothing else. `undefined` means "every workspace". ioredis subscribes again
 * by itself after a reconnect.
 */
export async function listenForPermissionsChanges(
  subscriber: Redis,
  onChange: (licenseId: bigint | undefined) => void,
): Promise<void> {
  subscriber.on('message', (channel: string, message: string) => {
    if (channel !== PERMISSIONS_CHANGED_CHANNEL) return;
    onChange(parsePermissionsChangedMessage(message)?.licenseId);
  });
  await subscriber.subscribe(PERMISSIONS_CHANGED_CHANNEL);
}
