/**
 * Pure metric arithmetic for the reports overview.
 *
 * Kept free of Fastify, Prisma and env (the only import is the shared
 * CHANNEL_TYPES constant) so the rounding, the null-when-empty rate rule and
 * the channel label mapping can be unit-tested on their own, and so every
 * resolution class — manual, assisted, automated — shares one definition of
 * "share of closed" rather than three hand-copied expressions that could drift.
 */

import { CHANNEL_TYPES } from '../services/channels/channel-adapter.js';

/** Round to three decimals — the precision a percentage KPI ever shows. */
export function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Share of *closed* conversations a resolution class accounts for — null, not
 * zero, when nothing closed. The denominator is closed conversations (an open
 * chat has not resolved either way), so a busy inbox never drags a rate down,
 * and an empty window reads as unknown rather than as a 0% failure.
 */
export function resolutionRate(count: number, closed: number): number | null {
  return closed === 0 ? null : round(count / closed);
}

/**
 * The channel breakdown's dimension label for a `channel_messages.channel_type`
 * value. Known adapter types (CHANNEL_TYPES — the single source of truth,
 * `channel-adapter.ts`) keep their own name; `null` or anything else falls
 * back to `'website'`, since the native web widget is not an adapter and never
 * writes a `channel_messages` row for its chats. `reports.ts`, the CSV export
 * and the UI all consume this one mapping so the fallback bucket cannot drift
 * between them.
 */
export function channelLabel(type: string | null): string {
  return (CHANNEL_TYPES as readonly string[]).includes(type ?? '') ? (type as string) : 'website';
}
