/**
 * SLA targets and breach marking (FR-MOD-11.5, PRD §5.4 "Kurumsal").
 *
 * A workspace declares how long a customer may wait — for a first reply, and
 * for the case to be finished — and the product marks the ones that went over.
 *
 * **It measures and marks; it does not enforce** (§C-A27). A breach produces a
 * row and a notification, and changes nothing about how the conversation is
 * routed or prioritised. Re-routing on a breach is a routing decision with its
 * own failure modes (a slow queue would reshuffle itself into a slower one) and
 * is deliberately not part of this.
 *
 * **What this is not:** NFR-U5's *"contractual uptime commitment + credit
 * mechanism"* — the only place the PRD spells "SLA" out in full. That is a
 * contract term settled between a customer and a sales team, with a billing
 * consequence; no code in this repo can promise it, so it is out of scope and
 * nothing here touches an invoice. See `entitlements.ts`, which draws the same
 * line around the `sla` key.
 */

/** The two clocks a policy can put a target on. */
export const SLA_TARGETS = ['first_response', 'resolution'] as const;
export type SlaTarget = (typeof SLA_TARGETS)[number];

/**
 * What a breach can be *about*.
 *
 * A `thread` is one continuous exchange inside a chat — the unit that carries
 * `first_response_at` and `closed_at`, so it is the unit whose clocks can be
 * read rather than guessed. A `ticket` is the asynchronous half of the inbox.
 */
export const SLA_SUBJECT_TYPES = ['thread', 'ticket'] as const;
export type SlaSubjectType = (typeof SLA_SUBJECT_TYPES)[number];

/**
 * Upper bound on a target, in minutes: 90 days.
 *
 * Not a business rule so much as a typo guard — a target beyond this can never
 * be breached by anything the retention window still holds, so saving one would
 * silently switch the feature off while the settings screen showed it on.
 */
export const SLA_MAX_TARGET_MINUTES = 129_600;

/**
 * A workspace's targets, as the API reports them.
 *
 * Both targets are independently nullable: "reply within 30 minutes, take as
 * long as it takes to finish" is a real policy, and so is its opposite. Null
 * means *no target*, which is different from a target of zero — hence a
 * nullable integer rather than 0-as-off.
 */
export interface SlaPolicy {
  first_response_minutes: number | null;
  resolution_minutes: number | null;
  /**
   * Count only the hours the workspace is open, from the agents' saved work
   * schedules (`work_schedules`). A workspace with no saved schedule at all has
   * no calendar to subtract, so its clocks run continuously — see
   * `services/sla/business-hours.ts`.
   */
  business_hours_only: boolean;
  /**
   * Whether these targets are being measured *today*.
   *
   * False when the licence does not hold the `sla` entitlement, even though the
   * numbers above are still stored (§C-A26: a downgrade must not destroy
   * configuration a re-upgrade should restore). It is also false when both
   * targets are null — nothing is being measured because nothing was asked for.
   * The screen reads this to tell "not bought" apart from "not set".
   */
  active: boolean;
  updated_at: string | null;
}

/** One recorded miss: the report row a breach produces. */
export interface SlaBreachRecord {
  id: string;
  subject_type: SlaSubjectType;
  subject_id: string;
  target: SlaTarget;
  target_minutes: number;
  /** Elapsed when the miss was noticed — business minutes if the policy says so. */
  elapsed_minutes: number;
  business_hours_only: boolean;
  detected_at: string;
  notified_at: string | null;
}

export function isSlaTarget(value: unknown): value is SlaTarget {
  return typeof value === 'string' && (SLA_TARGETS as readonly string[]).includes(value);
}

export function isSlaSubjectType(value: unknown): value is SlaSubjectType {
  return typeof value === 'string' && (SLA_SUBJECT_TYPES as readonly string[]).includes(value);
}
