/**
 * Agent work schedule — PRD §5.3-Vardiya (WORKSCHED), field list from
 * v2-derin-analiz/v2-03-api-veri-referans.md:817 ("WorkScheduler |
 * {timezone, schedule[{enabled, day (monday…sunday), start, end}]}").
 *
 * A workspace declares each agent's standing weekly availability — a timezone
 * plus one start/end/enabled slot per weekday. This is distinct from
 * `routing_status` (`Agent.routing_status`): that is a live online/offline
 * toggle the agent flips themselves, this is the plan the staffing forecast
 * (WORKSCHED-g) reads to predict coverage gaps ahead of time.
 *
 * The type, the defaults and the normaliser live here so the eventual settings
 * form (web), the route that persists it (WORKSCHED-c) and the forecast reader
 * (WORKSCHED-g) all agree on one shape and one validation rule — the same
 * single-source approach `widget.ts` uses for widget appearance.
 */

/** The seven weekdays a schedule can carry a slot for, in week order. */
export const WORK_SCHEDULE_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
export type WorkScheduleDay = (typeof WORK_SCHEDULE_DAYS)[number];

/** One weekday's availability window. */
export interface WorkScheduleSlot {
  day: WorkScheduleDay;
  /** 24h `HH:MM`, e.g. `"09:00"`. */
  start: string;
  /** 24h `HH:MM`, e.g. `"18:00"`. Must be strictly after `start`. */
  end: string;
  /** False marks the day off without discarding its configured hours. */
  enabled: boolean;
}

/** An agent's full weekly plan: an IANA timezone plus zero or more slots. */
export interface WorkSchedule {
  /** IANA zone, e.g. `"Europe/Istanbul"`. */
  timezone: string;
  schedule: WorkScheduleSlot[];
}

/**
 * Zero-padded 24h `HH:MM`, minute 00-59. Deliberately stricter than
 * `Date`-parseable: `"9:00"` and `"09:60"` both fail, so every value that
 * passes sorts and compares correctly as a plain string (`"09:00" < "17:00"`).
 */
export const WORK_SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The shipped default: Monday-Friday 09:00-18:00 enabled, the weekend present
 * but off. An agent who has never opened the schedule screen has this plan,
 * and the database column default matches value-for-value.
 */
export const DEFAULT_WORK_SCHEDULE: WorkSchedule = {
  timezone: 'UTC',
  schedule: WORK_SCHEDULE_DAYS.map((day) => ({
    day,
    start: '09:00',
    end: '18:00',
    enabled: day !== 'saturday' && day !== 'sunday',
  })),
};

/** Why a raw schedule was rejected rather than normalised. */
export interface WorkScheduleProblem {
  reason: 'unknown_day' | 'duplicate_day' | 'invalid_time' | 'range';
  message: string;
}

/**
 * Validate and normalise an untrusted value into a `WorkSchedule`, or report
 * why it cannot be. Null/undefined/an empty `schedule` is not an error — it
 * yields `DEFAULT_WORK_SCHEDULE` (a workspace that has never set one). Past
 * that, every slot must be well-formed: a known, non-repeated weekday and a
 * `start` strictly before its `end`, both matching `WORK_SCHEDULE_TIME_PATTERN`.
 * The single gate both the settings form and the eventual `PUT` route
 * (WORKSCHED-c) validate a submitted schedule against.
 */
export function normalizeWorkSchedule(input: unknown): WorkSchedule | { problem: WorkScheduleProblem } {
  if (input == null || typeof input !== 'object') {
    return DEFAULT_WORK_SCHEDULE;
  }
  const raw = input as Partial<WorkSchedule>;

  const timezone =
    typeof raw.timezone === 'string' && raw.timezone.trim().length > 0
      ? raw.timezone
      : DEFAULT_WORK_SCHEDULE.timezone;

  if (!Array.isArray(raw.schedule) || raw.schedule.length === 0) {
    return { timezone, schedule: DEFAULT_WORK_SCHEDULE.schedule };
  }

  const seenDays = new Set<string>();
  const schedule: WorkScheduleSlot[] = [];

  for (const entry of raw.schedule) {
    const slot = (entry ?? {}) as Partial<WorkScheduleSlot>;

    if (typeof slot.day !== 'string' || !WORK_SCHEDULE_DAYS.includes(slot.day as WorkScheduleDay)) {
      return { problem: { reason: 'unknown_day', message: `Unknown weekday "${String(slot.day)}".` } };
    }
    if (seenDays.has(slot.day)) {
      return { problem: { reason: 'duplicate_day', message: `"${slot.day}" is listed more than once.` } };
    }
    seenDays.add(slot.day);

    const startOk = typeof slot.start === 'string' && WORK_SCHEDULE_TIME_PATTERN.test(slot.start);
    const endOk = typeof slot.end === 'string' && WORK_SCHEDULE_TIME_PATTERN.test(slot.end);
    if (!startOk || !endOk) {
      return {
        problem: { reason: 'invalid_time', message: `"${slot.day}" needs a 24h HH:MM start and end.` },
      };
    }
    if ((slot.start as string) >= (slot.end as string)) {
      return { problem: { reason: 'range', message: `"${slot.day}" start must be before its end.` } };
    }

    schedule.push({
      day: slot.day as WorkScheduleDay,
      start: slot.start as string,
      end: slot.end as string,
      enabled: slot.enabled === true,
    });
  }

  return { timezone, schedule };
}

/** True when `normalizeWorkSchedule` returned a problem rather than a schedule. */
export function isWorkScheduleProblem(
  result: WorkSchedule | { problem: WorkScheduleProblem },
): result is { problem: WorkScheduleProblem } {
  return 'problem' in result;
}
