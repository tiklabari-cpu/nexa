/**
 * `ai.caps_changed` — a change to a workspace's AI caps, announced (tm 283.2 ·
 * PLAN §D218 decision 5 · §D231).
 *
 * The tenant API keeps each workspace's resolved caps for a minute
 * (`ai-caps.ts`). Whoever changes a cap — the root panel's override and plan
 * defaults (tm 389.12), an operator's script — publishes the licence id here
 * after committing, or `*` when a default every workspace inherits moved, and
 * every API process drops what it cached. A message nobody heard (a Redis
 * blip, a process that was restarting) costs at most the cache's minute, so
 * the announcement is a shortcut and never what correctness rests on; that is
 * also why a message this cannot read drops every workspace's caps rather than
 * none.
 */
import { AI_CAPS_CHANGED_CHANNEL } from '@siyahtus/types';
import type { Redis } from 'ioredis';

/** Whose caps a message names: one licence, or `undefined` for every workspace. */
export function capsChangeTarget(message: string): bigint | undefined {
  return /^[1-9][0-9]{0,18}$/.test(message) ? BigInt(message) : undefined;
}

/** Announce that `licenseId`'s caps changed — or every workspace's, with `null`. After the commit. */
export async function publishAiCapsChanged(redis: Redis, licenseId: bigint | null): Promise<void> {
  await redis.publish(AI_CAPS_CHANGED_CHANNEL, licenseId === null ? '*' : licenseId.toString());
}

/**
 * Call `onChange` for every announcement on `subscriber`, which this puts in
 * subscriber mode — a connection of its own, since a subscribed client can do
 * nothing else. ioredis subscribes again by itself after a reconnect.
 */
export async function listenForAiCapsChanges(
  subscriber: Redis,
  onChange: (licenseId: bigint | undefined) => void,
): Promise<void> {
  subscriber.on('message', (channel: string, message: string) => {
    if (channel === AI_CAPS_CHANGED_CHANNEL) onChange(capsChangeTarget(message));
  });
  await subscriber.subscribe(AI_CAPS_CHANGED_CHANNEL);
}
