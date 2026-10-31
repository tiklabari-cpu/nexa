/**
 * SLA targets: what a workspace promised, and what it missed (FR-MOD-11.5 · 11.5-d).
 *
 * Three jobs, deliberately in one module because they share one rule:
 *
 *   1. **The policy** — read and save the targets (`/settings/sla`).
 *   2. **The clock** — turn two timestamps into elapsed minutes, honouring
 *      business hours (`business-hours.ts` does the arithmetic).
 *   3. **The mark** — write the breach row when a clock went over.
 *
 * It measures and marks; it does not enforce (§C-A27). Nothing here calls
 * routing, changes a priority, or touches an invoice. A breach produces a row
 * and, through the sweep, a notification — that is the whole of its authority.
 *
 * ## The entitlement applies at both ends
 *
 * `11.5-b`'s lesson, one capability over: gating the write and stopping there
 * would leave a downgraded workspace still being measured against targets it no
 * longer pays for, still collecting breach rows, still being e-mailed about
 * them. So the *stored* policy and the *effective* policy are two different
 * reads. {@link readStoredPolicy} is what the settings screen edits;
 * {@link readEffectivePolicy} is what the measurement path uses, and it answers
 * null for a licence without `sla` — without deleting the row, so a re-upgrade
 * finds the workspace's configuration where it left it (§C-A26).
 *
 * ## Marking is idempotent, because two things mark
 *
 * A clock stopping (an agent finally replied, a case was closed) and the sweep
 * (nobody has replied and the target has passed) can both notice the same miss.
 * The unique key on `(licence, subject, target)` makes the second one a no-op,
 * which is why {@link markBreach} inserts with `skipDuplicates` rather than
 * checking first: the check-then-insert version has a race, and a case left
 * open over a weekend would otherwise collect a row per sweep.
 */
import {
  SLA_MAX_TARGET_MINUTES,
  SLA_PRIORITY_KEYS,
  normalizeWorkSchedule,
  isWorkScheduleProblem,
  ticketSlaTargetMinutes,
  type SlaPolicy,
  type SlaSubjectType,
  type SlaTarget,
  type SlaTicketPolicyFields,
  type SlaTicketTargetsByPriority,
} from '@siyahtus/types';
import { Prisma } from '@prisma/client';
import { ApiError } from '../../lib/api-error.js';
import { hasEntitlement } from '../../lib/entitlements.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import {
  buildBusinessWeek,
  elapsedMinutes,
  isBreach,
  type BusinessWeek,
} from './business-hours.js';

/** The stored row, as everything here needs it. */
export interface StoredSlaPolicy {
  firstResponseMinutes: number | null;
  resolutionMinutes: number | null;
  /** The ticket clocks (HD-05 · tm 360) — see `ticketSlaTargetMinutes` for how they fall back. */
  ticketFirstResponseMinutes: number | null;
  ticketResolutionMinutes: number | null;
  ticketTargetsByPriority: SlaTicketTargetsByPriority | null;
  businessHoursOnly: boolean;
  updatedAt: Date;
}

/**
 * A full replacement — the three fields are one policy, so a patch has no
 * meaning. The ticket fields are the exception (HD-05): `undefined` keeps what
 * is stored, so a client written before them cannot erase them by omission.
 */
export interface SlaPolicyInput {
  firstResponseMinutes: number | null;
  resolutionMinutes: number | null;
  businessHoursOnly: boolean;
  ticketFirstResponseMinutes?: number | null;
  ticketResolutionMinutes?: number | null;
  ticketTargetsByPriority?: SlaTicketTargetsByPriority | null;
}

/** The policy's ticket fields under the names `@siyahtus/types` reads them by. */
export function ticketPolicyFields(policy: StoredSlaPolicy): SlaTicketPolicyFields {
  return {
    resolution_minutes: policy.resolutionMinutes,
    ticket_first_response_minutes: policy.ticketFirstResponseMinutes,
    ticket_resolution_minutes: policy.ticketResolutionMinutes,
    ticket_targets_by_priority: policy.ticketTargetsByPriority,
  };
}

/**
 * The target one subject is measured against: a thread's is the chat field, a
 * ticket's depends on its priority (HD-05).
 */
export function targetMinutesOf(
  policy: StoredSlaPolicy,
  subject: { subjectType: SlaSubjectType; target: SlaTarget; priority?: number },
): number | null {
  if (subject.subjectType === 'ticket') {
    return ticketSlaTargetMinutes(
      ticketPolicyFields(policy),
      subject.priority ?? 0,
      subject.target,
    );
  }
  return subject.target === 'first_response'
    ? policy.firstResponseMinutes
    : policy.resolutionMinutes;
}

function hasAnyTarget(policy: StoredSlaPolicy): boolean {
  if (
    policy.firstResponseMinutes !== null ||
    policy.resolutionMinutes !== null ||
    policy.ticketFirstResponseMinutes !== null ||
    policy.ticketResolutionMinutes !== null
  ) {
    return true;
  }
  return Object.values(policy.ticketTargetsByPriority ?? {}).some(
    (entry) => entry.first_response_minutes !== null || entry.resolution_minutes !== null,
  );
}

/**
 * The stored JSON, read defensively: the CHECK guarantees only an object, so an
 * entry this release cannot read is dropped rather than trusted.
 */
function readTargetsByPriority(value: unknown): SlaTicketTargetsByPriority | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const out: SlaTicketTargetsByPriority = {};
  for (const key of SLA_PRIORITY_KEYS) {
    const entry = (value as Record<string, unknown>)[key];
    if (typeof entry !== 'object' || entry === null) continue;
    const { first_response_minutes: first, resolution_minutes: resolution } = entry as Record<
      string,
      unknown
    >;
    out[key] = {
      first_response_minutes: isTarget(first) ? first : null,
      resolution_minutes: isTarget(resolution) ? resolution : null,
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

function isTarget(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= SLA_MAX_TARGET_MINUTES
  );
}

function toStored(row: {
  firstResponseMinutes: number | null;
  resolutionMinutes: number | null;
  ticketFirstResponseMinutes: number | null;
  ticketResolutionMinutes: number | null;
  ticketTargetsByPriority: unknown;
  businessHoursOnly: boolean;
  updatedAt: Date;
}): StoredSlaPolicy {
  return {
    firstResponseMinutes: row.firstResponseMinutes,
    resolutionMinutes: row.resolutionMinutes,
    ticketFirstResponseMinutes: row.ticketFirstResponseMinutes,
    ticketResolutionMinutes: row.ticketResolutionMinutes,
    ticketTargetsByPriority: readTargetsByPriority(row.ticketTargetsByPriority),
    businessHoursOnly: row.businessHoursOnly,
    updatedAt: row.updatedAt,
  };
}

/**
 * A policy plus the calendar it is measured against, resolved once.
 *
 * The measurement path takes this rather than re-reading per subject: the sweep
 * asks about every waiting case in a workspace, and rebuilding the standing week
 * for each of them would be the same answer computed hundreds of times.
 */
export interface SlaClock {
  policy: StoredSlaPolicy;
  /** Null when business hours are off, or when the workspace has published none. */
  week: BusinessWeek | null;
}

/** What a workspace has saved, whether or not it is entitled to it today. */
export async function readStoredPolicy(
  tx: TenantClient,
  tenant: TenantContext,
): Promise<StoredSlaPolicy | null> {
  const row = await tx.slaPolicy.findUnique({ where: { licenseId: tenant.licenseId } });
  return row ? toStored(row) : null;
}

/**
 * What is actually being measured — null when nothing is.
 *
 * Three ways to get null, and they are the same answer to the caller: no row,
 * no target on the row, or a licence that does not hold `sla`. The last is the
 * downgrade path, and it is checked *after* the row read so a workspace with no
 * policy costs one indexed lookup rather than two — the common case, since this
 * runs on every thread's first reply and every close.
 */
export async function readEffectivePolicy(
  tx: TenantClient,
  tenant: TenantContext,
): Promise<StoredSlaPolicy | null> {
  const stored = await readStoredPolicy(tx, tenant);
  if (!stored) return null;
  if (!hasAnyTarget(stored)) return null;
  if (!(await hasEntitlement(tx, tenant, 'sla'))) return null;
  return stored;
}

/**
 * The effective policy with its calendar, or null when nothing is measured.
 *
 * `at` is the instant the timezones are resolved at — see `business-hours.ts`
 * for why a standing week is placed once rather than per date.
 */
export async function readClock(
  tx: TenantClient,
  tenant: TenantContext,
  at: Date,
): Promise<SlaClock | null> {
  const policy = await readEffectivePolicy(tx, tenant);
  if (!policy) return null;
  const week = policy.businessHoursOnly ? await readBusinessWeek(tx, tenant, at) : null;
  return { policy, week };
}

/**
 * The workspace's open week, from the agents' saved work schedules (§C-A27).
 *
 * `normalizeWorkSchedule` is applied here rather than trusted from the column:
 * the JSON check in the migration guarantees only that the value is an array,
 * so a row written before a rule tightened would otherwise place a shift at a
 * time nobody can read. A row that fails it is dropped, not defaulted — an
 * invented 09:00-18:00 would subtract hours the workspace never claimed.
 */
export async function readBusinessWeek(
  tx: TenantClient,
  tenant: Pick<TenantContext, 'licenseId'>,
  at: Date,
): Promise<BusinessWeek | null> {
  const rows = await tx.workSchedule.findMany({
    where: { licenseId: tenant.licenseId },
    select: { timezone: true, schedule: true },
  });

  const plans = rows.flatMap((row) => {
    const normalized = normalizeWorkSchedule({ timezone: row.timezone, schedule: row.schedule });
    if (isWorkScheduleProblem(normalized)) return [];
    return [{ timezone: normalized.timezone, schedule: normalized.schedule }];
  });

  return buildBusinessWeek(plans, at);
}

/**
 * Save the targets, replacing whatever was there.
 *
 * Validated here as well as in the route's schema and the database's CHECKs.
 * Three layers sounds like two too many until you notice they answer different
 * callers: the route guards the HTTP body, this guards every caller of the
 * service, and the CHECK guards a row written by anything at all. A zero saved
 * by a client that conflates it with null would mark every conversation in the
 * workspace as breached the moment it opened, which is worth stopping at each.
 */
export async function saveSlaPolicy(
  tx: TenantClient,
  tenant: TenantContext,
  input: SlaPolicyInput,
): Promise<StoredSlaPolicy> {
  assertTarget('first_response_minutes', input.firstResponseMinutes);
  assertTarget('resolution_minutes', input.resolutionMinutes);
  if (input.ticketFirstResponseMinutes !== undefined) {
    assertTarget('ticket_first_response_minutes', input.ticketFirstResponseMinutes);
  }
  if (input.ticketResolutionMinutes !== undefined) {
    assertTarget('ticket_resolution_minutes', input.ticketResolutionMinutes);
  }
  for (const [key, entry] of Object.entries(input.ticketTargetsByPriority ?? {})) {
    if (!(SLA_PRIORITY_KEYS as readonly string[]).includes(key)) {
      throw ApiError.validation(`ticket_targets_by_priority: unknown priority "${key}".`);
    }
    assertTarget(
      `ticket_targets_by_priority.${key}.first_response_minutes`,
      entry.first_response_minutes,
    );
    assertTarget(`ticket_targets_by_priority.${key}.resolution_minutes`, entry.resolution_minutes);
  }

  const data = {
    firstResponseMinutes: input.firstResponseMinutes,
    resolutionMinutes: input.resolutionMinutes,
    businessHoursOnly: input.businessHoursOnly,
    ...(input.ticketFirstResponseMinutes !== undefined
      ? { ticketFirstResponseMinutes: input.ticketFirstResponseMinutes }
      : {}),
    ...(input.ticketResolutionMinutes !== undefined
      ? { ticketResolutionMinutes: input.ticketResolutionMinutes }
      : {}),
    ...(input.ticketTargetsByPriority !== undefined
      ? {
          ticketTargetsByPriority:
            (compactTargets(input.ticketTargetsByPriority) as Prisma.InputJsonObject | null) ??
            Prisma.DbNull,
        }
      : {}),
  };
  const row = await tx.slaPolicy.upsert({
    where: { licenseId: tenant.licenseId },
    create: { licenseId: tenant.licenseId, ...data },
    update: data,
  });

  return toStored(row);
}

/** A priority with neither target set is the same as one left out; null when none is left. */
function compactTargets(
  targets: SlaTicketTargetsByPriority | null,
): SlaTicketTargetsByPriority | null {
  const out: SlaTicketTargetsByPriority = {};
  for (const key of SLA_PRIORITY_KEYS) {
    const entry = targets?.[key];
    if (entry && (entry.first_response_minutes !== null || entry.resolution_minutes !== null)) {
      out[key] = {
        first_response_minutes: entry.first_response_minutes,
        resolution_minutes: entry.resolution_minutes,
      };
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function assertTarget(field: string, value: number | null): void {
  if (value === null) return;
  if (!Number.isInteger(value) || value <= 0) {
    throw ApiError.validation(`${field}: a target is a positive number of minutes, or null.`);
  }
  if (value > SLA_MAX_TARGET_MINUTES) {
    throw ApiError.validation(
      `${field}: a target cannot exceed ${SLA_MAX_TARGET_MINUTES} minutes.`,
    );
  }
}

/**
 * Record a miss, unless it is already recorded.
 *
 * Returns whether this call was the one that wrote it, which is what the sweep
 * reports and what a test asserts on. `createMany` with `skipDuplicates` rather
 * than a read-then-write: the unique key already states the rule, and asking
 * first would leave a window for the other writer to arrive in between.
 */
export async function markBreach(
  tx: TenantClient,
  tenant: TenantContext,
  breach: {
    subjectType: SlaSubjectType;
    subjectId: string;
    target: SlaTarget;
    targetMinutes: number;
    elapsedMinutes: number;
    businessHoursOnly: boolean;
    detectedAt: Date;
  },
): Promise<boolean> {
  const { count } = await tx.slaBreach.createMany({
    data: [
      {
        licenseId: tenant.licenseId,
        subjectType: breach.subjectType,
        subjectId: breach.subjectId,
        target: breach.target,
        targetMinutes: breach.targetMinutes,
        elapsedMinutes: breach.elapsedMinutes,
        businessHoursOnly: breach.businessHoursOnly,
        detectedAt: breach.detectedAt,
      },
    ],
    skipDuplicates: true,
  });
  return count > 0;
}

/**
 * Measure one clock and mark it if it went over — the single path every caller
 * uses, so "what counts as a breach" is stated once.
 *
 * `clock` is passed in rather than read here because the two callers have very
 * different shapes: a request has one subject and would rebuild the calendar
 * for it, while the sweep has hundreds and must not.
 */
export async function evaluate(
  tx: TenantClient,
  tenant: TenantContext,
  clock: SlaClock,
  subject: {
    subjectType: SlaSubjectType;
    subjectId: string;
    target: SlaTarget;
    /** When the clock started — the thread's or ticket's creation. */
    startedAt: Date;
    /** When it stopped, or "now" for a clock still running. */
    stoppedAt: Date;
    /**
     * A ticket's priority as it stands now (HD-05): a change of priority
     * changes the target, never the start.
     */
    priority?: number;
  },
): Promise<boolean> {
  const targetMinutes = targetMinutesOf(clock.policy, subject);
  if (targetMinutes === null) return false;

  const elapsed = elapsedMinutes(subject.startedAt, subject.stoppedAt, clock.week);
  if (!isBreach(targetMinutes, elapsed)) return false;

  return markBreach(tx, tenant, {
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    target: subject.target,
    targetMinutes,
    elapsedMinutes: elapsed,
    businessHoursOnly: clock.policy.businessHoursOnly,
    detectedAt: subject.stoppedAt,
  });
}

/**
 * The measurement entry point for a request: read the clock, evaluate, mark.
 *
 * Swallows nothing and does no I/O when nothing is configured — a workspace
 * with no policy pays one indexed primary-key lookup, which is why this can sit
 * on the send-event path at all. It is called once per thread lifecycle per
 * clock (the *first* reply, the close), not once per message.
 */
export async function evaluateSubject(
  tx: TenantClient,
  tenant: TenantContext,
  subject: {
    subjectType: SlaSubjectType;
    subjectId: string;
    target: SlaTarget;
    startedAt: Date;
    stoppedAt: Date;
    priority?: number;
  },
): Promise<boolean> {
  const clock = await readClock(tx, tenant, subject.stoppedAt);
  if (!clock) return false;
  return evaluate(tx, tenant, clock, subject);
}

/** The API shape: stored values plus whether they are in force today. */
export function serialiseSlaPolicy(stored: StoredSlaPolicy | null, entitled: boolean): SlaPolicy {
  return {
    first_response_minutes: stored?.firstResponseMinutes ?? null,
    resolution_minutes: stored?.resolutionMinutes ?? null,
    ticket_first_response_minutes: stored?.ticketFirstResponseMinutes ?? null,
    ticket_resolution_minutes: stored?.ticketResolutionMinutes ?? null,
    ticket_targets_by_priority: stored?.ticketTargetsByPriority ?? null,
    business_hours_only: stored?.businessHoursOnly ?? false,
    // "Bought it" and "asked for something" are both required for a target to
    // be measured, and a screen needs to tell the two failures apart — one is
    // an upsell, the other is an empty form.
    active: entitled && stored !== null && hasAnyTarget(stored),
    updated_at: stored?.updatedAt.toISOString() ?? null,
  };
}
