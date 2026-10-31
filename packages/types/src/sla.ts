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
import { TICKET_PRIORITY_BANDS, nearestTicketPriorityBand } from './domain.js';

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
   * The ticket clocks (HD-05 · tm 360), apart from the chat ones above. A
   * ticket's first response is not measured until this (or a priority's own
   * target) is set: applying the chat target to tickets would have marked
   * every existing workspace's open queue as breached the day it shipped.
   */
  ticket_first_response_minutes: number | null;
  /** Null: a ticket's resolution is measured against `resolution_minutes`, as before. */
  ticket_resolution_minutes: number | null;
  /** A priority's own targets, over the two ticket fields above; null when none is set. */
  ticket_targets_by_priority: SlaTicketTargetsByPriority | null;
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

/**
 * The keys a ticket's own targets are stored under — the named priority
 * levels (`TICKET_PRIORITY_BANDS`), lower-cased. A ticket's signed priority
 * snaps to the nearest one, the way the inbox names it.
 */
export const SLA_PRIORITY_KEYS = ['urgent', 'high', 'normal', 'low'] as const;
export type SlaPriorityKey = (typeof SLA_PRIORITY_KEYS)[number];

/** One priority's targets; a null field falls back to the ticket-wide one. */
export interface SlaTicketTarget {
  first_response_minutes: number | null;
  resolution_minutes: number | null;
}

export type SlaTicketTargetsByPriority = Partial<Record<SlaPriorityKey, SlaTicketTarget>>;

/** The policy fields a ticket's targets are read from. */
export type SlaTicketPolicyFields = Pick<
  SlaPolicy,
  | 'resolution_minutes'
  | 'ticket_first_response_minutes'
  | 'ticket_resolution_minutes'
  | 'ticket_targets_by_priority'
>;

export function slaPriorityKeyOf(priority: number): SlaPriorityKey {
  return nearestTicketPriorityBand(priority).label.toLowerCase() as SlaPriorityKey;
}

/**
 * The target a ticket of this priority is measured against, or null when that
 * clock is not measured (HD-05).
 *
 * The priority's own value wins; then the ticket-wide one. The two clocks fall
 * back differently, and on purpose: a first-response target never borrows the
 * chat's (no workspace asked for its tickets to be measured that way), while a
 * resolution target with no ticket value is the shared `resolution_minutes` —
 * what every ticket was measured against before tickets had their own.
 */
export function ticketSlaTargetMinutes(
  policy: SlaTicketPolicyFields,
  priority: number,
  target: SlaTarget,
): number | null {
  const own = policy.ticket_targets_by_priority?.[slaPriorityKeyOf(priority)];
  if (target === 'first_response') {
    return own?.first_response_minutes ?? policy.ticket_first_response_minutes ?? null;
  }
  return (
    own?.resolution_minutes ?? policy.ticket_resolution_minutes ?? policy.resolution_minutes ?? null
  );
}

/**
 * The shortest target of this clock any ticket can carry, or null when no
 * ticket is measured on it — the cut-off the sweep's candidate query uses.
 */
export function shortestTicketSlaTarget(
  policy: SlaTicketPolicyFields,
  target: SlaTarget,
): number | null {
  const values = TICKET_PRIORITY_BANDS.map((band) =>
    ticketSlaTargetMinutes(policy, band.value, target),
  ).filter((value): value is number => value !== null);
  return values.length > 0 ? Math.min(...values) : null;
}

/**
 * A ticket's first-response clock as `GET /tickets` reports it (HD-05).
 *
 * `first_response_due_at` is the moment from which a first reply would be
 * late — null when the clock is not running (answered, solved, merged, opened
 * from a chat, or no target). `first_response_breached` is true once the miss
 * has been recorded, or once a running clock has passed its due moment.
 */
export interface TicketSla {
  first_response_at: string | null;
  first_response_due_at: string | null;
  first_response_breached: boolean;
}

/**
 * Whole minutes left on a running clock; negative from the due moment on.
 * Rounded down, so "0" is said only in the last minute before it.
 */
export function slaMinutesLeft(dueAt: string, now: number): number {
  return Math.ceil((Date.parse(dueAt) - now) / 60_000) - 1;
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
