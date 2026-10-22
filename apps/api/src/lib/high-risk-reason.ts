/**
 * The `reason` a high-risk settings write carries (GV-06-S1 · tm 323.2).
 *
 * The panel saves a high-risk setting — how long data is kept, an AI compliance
 * rule, and the permission matrix once RL-02 adds it — only after the person
 * has seen the change and said why. The reason rides in the request body and is
 * filed with the change's audit entry, so "who loosened this, and why" has an
 * answer in the trail rather than in someone's memory.
 *
 * Accepted, not demanded: the panel always sends one, but these endpoints are
 * also the public API, and turning an optional field into a required one would
 * break every integration that already writes them. A write without a reason is
 * audited exactly as before.
 */
import { HIGH_RISK_REASON_MAX } from '@siyahtus/types';
import { z } from 'zod';

/** Trimmed, non-empty, at most {@link HIGH_RISK_REASON_MAX} characters. */
export const highRiskReason = z.string().trim().min(1).max(HIGH_RISK_REASON_MAX);

/** The reason as audit metadata: `{ reason }`, or nothing when none was given. */
export function reasonMetadata(reason: string | undefined): { reason?: string } {
  return reason === undefined ? {} : { reason };
}
