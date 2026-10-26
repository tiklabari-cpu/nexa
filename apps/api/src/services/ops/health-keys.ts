/**
 * The Redis side of the health publication (tm 389.8) — kept apart from the
 * publisher so the platform process, which only reads, imports a file with no
 * dependencies instead of the tenant API's scheduler and mail modules.
 */
import type { HealthSnapshotBody } from './health-snapshot.js';

export const OPS_HEALTH_KEY = 'siyahtus:ops:health';
/** The key's expiry: with the leader gone, nothing renews it. */
export const OPS_HEALTH_TTL_S = 90;

export interface StoredHealthSnapshot {
  /** ISO-8601, the publisher's clock. */
  generated_at: string;
  health: HealthSnapshotBody;
}
