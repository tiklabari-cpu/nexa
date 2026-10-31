/**
 * Availability and agent activity reports (RP-03 · tm 370):
 * `GET /reports/availability` (time per state per agent, the local hour-of-day
 * distribution, time against the plan) and `GET /reports/agent-activity` (one
 * day's agent × hour strip with the plan laid over it).
 *
 * The arithmetic is `presence-timeline.ts`; this module reads the log, decides
 * whose activity the caller may read, and assembles the two responses.
 *
 * Reach (05 RP-03 decision 2, RL-02): presence is staff-monitoring data, so
 * it is bounded by person rather than by conversation —
 *   - `reports_read` — every member of the workspace;
 *   - `reports_read--groups` — the members of the teams the caller leads, and
 *     the caller;
 *   - any other agent — themselves only.
 * Naming an agent (or a team) outside that reach is a 403, not an empty
 * report: "you may not read this person" is the answer, and an empty strip
 * would claim they were never online.
 */
import { Prisma } from '@prisma/client';
import {
  ACTIVITY_STATES,
  AGENT_ACTIVITY_PAGE_DEFAULT,
  AGENT_ACTIVITY_PAGE_MAX,
  AVAILABILITY_MAX_DAYS,
  hasAnyScope,
  isDayKey,
  isWorkScheduleProblem,
  localDayKey,
  localDayStart,
  normalizeWorkSchedule,
  shiftDayKey,
  type ActivityState,
  type WorkScheduleSlot,
} from '@siyahtus/types';
import { z } from 'zod';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';
import { readDayBoundary } from '../chat/day-boundary.js';
import { ledGroupIds } from '../team/led-groups.js';
import {
  activitySegments,
  addHourly,
  countSegments,
  emptyHourly,
  hourMinutes,
  intervalSeconds,
  localHours,
  plannedIntervals,
  roundHourly,
  stateSeconds,
  stateSecondsWithin,
  type ActivitySegment,
  type PresenceLogRow,
  type StateSeconds,
} from './presence-timeline.js';

/**
 * Rows one presence read may return before it refuses (a 400 asking for a
 * narrower window), the forecast's rule: truncating a change log silently
 * rewrites the time it implies, so a limit that changes the answer is worse
 * than an error.
 */
export const PRESENCE_LOG_ROW_LIMIT = 250_000;

/**
 * The presence log for `[from, to)` with each agent's opening row — the last
 * change before `from`, without which an agent who has not touched the switch
 * since last week would read as unknown all window. `agentIds` narrows the
 * read; `null` reads every agent.
 */
export async function presenceLog(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  agentIds: readonly string[] | null,
  tooMuch = 'The requested range holds too much presence history; narrow it.',
): Promise<PresenceLogRow[]> {
  const agents =
    agentIds === null ? Prisma.sql`TRUE` : Prisma.sql`p.agent_id = ANY(${[...agentIds]}::uuid[])`;
  const rows = await tx.$queryRaw<
    Array<{ agent_id: string; status: string; source: string; changed_at: Date }>
  >`
    WITH inside AS (
      SELECT p.agent_id, p.status, p.source, p.changed_at
      FROM agent_presence_events p
      WHERE p.license_id = ${licenseId} AND ${agents}
        AND p.changed_at >= ${from} AND p.changed_at < ${to}
    ), opening AS (
      SELECT DISTINCT ON (p.agent_id) p.agent_id, p.status, p.source, p.changed_at
      FROM agent_presence_events p
      WHERE p.license_id = ${licenseId} AND ${agents} AND p.changed_at < ${from}
      ORDER BY p.agent_id, p.changed_at DESC
    )
    SELECT agent_id::text AS agent_id, status, source, changed_at FROM inside
    UNION ALL
    SELECT agent_id::text AS agent_id, status, source, changed_at FROM opening
    ORDER BY agent_id, changed_at
    LIMIT ${PRESENCE_LOG_ROW_LIMIT + 1}
  `;
  if (rows.length > PRESENCE_LOG_ROW_LIMIT) throw ApiError.validation(tooMuch);
  return rows.map((row) => ({
    agentId: row.agent_id,
    status: row.status,
    source: row.source,
    changedAt: row.changed_at,
  }));
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const uuid = z.string().uuid();
const teamId = z.string().regex(/^\d{1,18}$/);
const oneOrMany = <T extends z.ZodTypeAny>(item: T) =>
  z
    .union([item, z.array(item).max(100)])
    .transform((value): z.infer<T>[] => (Array.isArray(value) ? value : [value]))
    .optional();

/** The person filter both reports take (RP-01's `agent_id` / `group_id`). */
const personFilter = {
  agent_id: oneOrMany(uuid),
  group_id: oneOrMany(teamId),
};

export interface PersonFilter {
  agentIds?: string[];
  groupIds?: string[];
}

function refuseConversationKeys(query: Record<string, unknown>): void {
  for (const key of ['tag', 'topic']) {
    if (query[key] !== undefined) {
      throw ApiError.validation(
        `The availability and agent activity reports count people, not conversations: \`${key}\` does not apply.`,
      );
    }
  }
}

function firstIssue(error: z.ZodError, fallback: string): never {
  const issue = error.issues[0];
  const key = issue?.path[0];
  throw ApiError.validation(
    typeof key === 'string' ? `\`${key}\`: ${issue?.message ?? 'invalid value'}.` : fallback,
  );
}

function toPersonFilter(data: { agent_id?: string[]; group_id?: string[] }): PersonFilter {
  const out: PersonFilter = {};
  if (data.agent_id?.length)
    out.agentIds = [...new Set(data.agent_id.map((id) => id.toLowerCase()))];
  if (data.group_id?.length)
    out.groupIds = [...new Set(data.group_id.map((id) => BigInt(id).toString()))];
  return out;
}

const availabilityQuery = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  ...personFilter,
});

/** `GET /reports/availability`'s query: a window of at most {@link AVAILABILITY_MAX_DAYS} days. */
export function parseAvailabilityQuery(query: unknown): {
  from: Date;
  to: Date;
  filter: PersonFilter;
} {
  const raw = (query ?? {}) as Record<string, unknown>;
  refuseConversationKeys(raw);
  const parsed = availabilityQuery.safeParse(raw);
  if (!parsed.success) firstIssue(parsed.error, 'Invalid availability query.');
  const from = new Date(parsed.data.from);
  const to = new Date(parsed.data.to);
  if (!(from < to)) throw ApiError.validation('`from` must be before `to`.');
  if (to.getTime() - from.getTime() > AVAILABILITY_MAX_DAYS * 86_400_000) {
    throw ApiError.validation(
      `The availability report reads at most ${AVAILABILITY_MAX_DAYS} days; narrow \`from\`/\`to\`.`,
    );
  }
  return { from, to, filter: toPersonFilter(parsed.data) };
}

const activityQuery = z.object({
  date: z.string().refine(isDayKey, 'must be a YYYY-MM-DD calendar day').optional(),
  limit: z.coerce.number().int().min(1).max(AGENT_ACTIVITY_PAGE_MAX).optional(),
  cursor: uuid.optional(),
  ...personFilter,
});

/** `GET /reports/agent-activity`'s query. */
export function parseAgentActivityQuery(query: unknown): {
  date: string | null;
  limit: number;
  cursor: string | null;
  filter: PersonFilter;
} {
  const raw = (query ?? {}) as Record<string, unknown>;
  refuseConversationKeys(raw);
  const parsed = activityQuery.safeParse(raw);
  if (!parsed.success) firstIssue(parsed.error, 'Invalid agent activity query.');
  return {
    date: parsed.data.date ?? null,
    limit: parsed.data.limit ?? AGENT_ACTIVITY_PAGE_DEFAULT,
    cursor: parsed.data.cursor?.toLowerCase() ?? null,
    filter: toPersonFilter(parsed.data),
  };
}

// ---------------------------------------------------------------------------
// Reach
// ---------------------------------------------------------------------------

export interface ReportAgent {
  agentId: string;
  name: string | null;
}

/**
 * The members whose presence the caller may read, narrowed by the filter, in
 * name order (then id, so the order — and a page cursor — is stable). See the
 * module header for the three reaches.
 */
export async function resolveAgentReach(
  tx: TenantClient,
  licenseId: bigint,
  principal: Principal,
  filter: PersonFilter,
): Promise<ReportAgent[]> {
  if (principal.kind === 'customer')
    throw ApiError.authorization('This token cannot read reports.');
  const workspace = hasAnyScope(principal.scopes, ['reports_read']);
  const teams = !workspace && hasAnyScope(principal.scopes, ['reports_read--groups']);
  if (!workspace && principal.kind !== 'agent') {
    throw ApiError.authorization('This token cannot read reports.');
  }

  const members = await tx.agentMembership.findMany({
    where: { licenseId },
    select: { agentId: true, agent: { select: { name: true } } },
  });

  let allowed: Set<string> | null = null; // null = the workspace
  let ledTeams: Set<string> | null = null;
  if (!workspace && principal.kind === 'agent') {
    allowed = new Set([principal.accountId]);
    if (teams) {
      const led = await ledGroupIds(tx, principal.accountId);
      ledTeams = new Set(led.map(String));
      if (led.length > 0) {
        const rows = await tx.groupAgent.findMany({
          where: { licenseId, groupId: { in: led } },
          select: { agentId: true },
        });
        for (const row of rows) allowed.add(row.agentId);
      }
    }
  }

  if (filter.groupIds !== undefined && allowed !== null) {
    const outside = filter.groupIds.filter((id) => !ledTeams?.has(id));
    if (outside.length > 0) {
      throw ApiError.authorization(
        teams
          ? 'You can read the activity of the teams you lead only.'
          : 'You can read your own activity only.',
      );
    }
  }
  if (filter.agentIds !== undefined && allowed !== null) {
    const reach = allowed;
    if (filter.agentIds.some((id) => !reach.has(id))) {
      throw ApiError.authorization(
        teams
          ? "You can read the activity of your teams' members only."
          : 'You can read your own activity only.',
      );
    }
  }

  let inGroups: Set<string> | null = null;
  if (filter.groupIds !== undefined) {
    const rows = await tx.groupAgent.findMany({
      where: { licenseId, groupId: { in: filter.groupIds.map((id) => BigInt(id)) } },
      select: { agentId: true },
    });
    inGroups = new Set(rows.map((row) => row.agentId));
  }
  const named = filter.agentIds === undefined ? null : new Set(filter.agentIds);

  return members
    .filter(
      (member) =>
        (allowed === null || allowed.has(member.agentId)) &&
        (inGroups === null || inGroups.has(member.agentId)) &&
        (named === null || named.has(member.agentId)),
    )
    .map((member) => ({ agentId: member.agentId, name: member.agent.name }))
    .sort(
      (a, b) =>
        (a.name ?? '').localeCompare(b.name ?? '', 'en') || a.agentId.localeCompare(b.agentId),
    );
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

async function plansOf(
  tx: TenantClient,
  licenseId: bigint,
  agentIds: readonly string[],
): Promise<Map<string, { timezone: string; schedule: WorkScheduleSlot[] }>> {
  const rows = await tx.workSchedule.findMany({
    where: { licenseId, agentId: { in: [...agentIds] } },
    select: { agentId: true, timezone: true, schedule: true },
  });
  const out = new Map<string, { timezone: string; schedule: WorkScheduleSlot[] }>();
  for (const row of rows) {
    const plan = normalizeWorkSchedule({ timezone: row.timezone, schedule: row.schedule });
    if (isWorkScheduleProblem(plan)) continue;
    out.set(row.agentId, { timezone: plan.timezone, schedule: [...plan.schedule] });
  }
  return out;
}

function groupRows(rows: readonly PresenceLogRow[]): Map<string, PresenceLogRow[]> {
  const out = new Map<string, PresenceLogRow[]>();
  for (const row of rows) {
    const list = out.get(row.agentId);
    if (list) list.push(row);
    else out.set(row.agentId, [row]);
  }
  return out;
}

function secondsBody(seconds: StateSeconds): Record<`${ActivityState}_seconds`, number> {
  return Object.fromEntries(
    ACTIVITY_STATES.map((state) => [`${state}_seconds`, seconds[state]]),
  ) as Record<`${ActivityState}_seconds`, number>;
}

// ---------------------------------------------------------------------------
// GET /reports/availability
// ---------------------------------------------------------------------------

export interface AvailabilityReport {
  range: { from: string; to: string };
  timezone: string;
  agents: number;
  totals: Record<`${ActivityState}_seconds`, number>;
  by_hour: Array<
    { hour: number } & Record<`${ActivityState}_minutes`, number> & {
        mean_accepting_agents: number;
      }
  >;
  by_agent: Array<
    {
      agent_id: string;
      name: string | null;
      disconnects: number;
      unresponsive_pauses: number;
      planned_seconds: number | null;
      planned_accepting_seconds: number | null;
    } & Record<`${ActivityState}_seconds`, number>
  >;
}

/**
 * Time in each state over `[from, to)` for `agents`. `to` is clipped to `now`:
 * the future is not "unknown" time anyone should be measured against.
 */
export async function availabilityReport(
  tx: TenantClient,
  licenseId: bigint,
  agents: readonly ReportAgent[],
  from: Date,
  requestedTo: Date,
  now: Date,
): Promise<AvailabilityReport> {
  const { timezone } = await readDayBoundary(tx);
  const to = new Date(Math.min(requestedTo.getTime(), now.getTime()));
  const range = { from: from.toISOString(), to: to.toISOString() };
  const zero = secondsBody(Object.fromEntries(ACTIVITY_STATES.map((s) => [s, 0])) as StateSeconds);
  const hours =
    from < to ? localHours(from.getTime(), to.getTime(), timezone) : { starts: [], hours: [] };
  const divisor = hourMinutes(hours, to.getTime());
  const hourly = emptyHourly();
  const totals = { ...zero };
  const byAgent: AvailabilityReport['by_agent'] = [];

  if (from < to && agents.length > 0) {
    const ids = agents.map((agent) => agent.agentId);
    const log = groupRows(
      await presenceLog(
        tx,
        licenseId,
        from,
        to,
        ids,
        'The requested range holds too much presence history; narrow `from`/`to` or the agents.',
      ),
    );
    const plans = await plansOf(tx, licenseId, ids);
    for (const agent of agents) {
      const segments = activitySegments(log.get(agent.agentId) ?? [], from.getTime(), to.getTime());
      addHourly(hourly, segments, hours, to.getTime());
      const seconds = secondsBody(stateSeconds(segments));
      for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
        totals[key] += seconds[key];
      }
      const plan = plans.get(agent.agentId);
      const planned = plan ? plannedIntervals(plan, from.getTime(), to.getTime()) : null;
      byAgent.push({
        agent_id: agent.agentId,
        name: agent.name,
        ...seconds,
        disconnects: countSegments(segments, (s) => s.state === 'disconnected'),
        unresponsive_pauses: countSegments(segments, (s) => s.source === 'unresponsive'),
        planned_seconds: planned ? intervalSeconds(planned) : null,
        planned_accepting_seconds: planned
          ? stateSecondsWithin(segments, planned, 'accepting')
          : null,
      });
    }
  }

  const rounded = roundHourly(hourly);
  return {
    range,
    timezone,
    agents: agents.length,
    totals,
    by_hour: rounded.map((bucket, hour) => ({
      hour,
      ...(Object.fromEntries(
        ACTIVITY_STATES.map((state) => [`${state}_minutes`, bucket[state]]),
      ) as Record<`${ActivityState}_minutes`, number>),
      mean_accepting_agents:
        (divisor[hour] ?? 0) > 0
          ? Math.round((bucket.accepting / (divisor[hour] ?? 1)) * 1000) / 1000
          : 0,
    })),
    by_agent: byAgent,
  };
}

// ---------------------------------------------------------------------------
// GET /reports/agent-activity
// ---------------------------------------------------------------------------

export interface AgentActivityReport {
  date: string;
  timezone: string;
  range: { from: string; to: string };
  as_of: string;
  agents: Array<
    {
      agent_id: string;
      name: string | null;
      segments: Array<{
        state: ActivityState;
        source: string | null;
        from: string;
        to: string;
      }>;
      planned: Array<{ from: string; to: string }> | null;
    } & Record<`${ActivityState}_seconds`, number>
  >;
  next_cursor: string | null;
}

/**
 * One workspace day of the strip: `[start of date, start of the next day)` in
 * the workspace's day boundary (ID-04 — zone and hour), drawn up to `now` for
 * today. A day that has not begun is a 400. Paged by agent (`cursor` = the
 * last agent id of the previous page).
 */
export async function agentActivityReport(
  tx: TenantClient,
  licenseId: bigint,
  agents: readonly ReportAgent[],
  requestedDate: string | null,
  page: { limit: number; cursor: string | null },
  now: Date,
): Promise<AgentActivityReport> {
  const boundary = await readDayBoundary(tx);
  const date = requestedDate ?? localDayKey(now, boundary.timezone, boundary.hour);
  const from = localDayStart(date, boundary.timezone, boundary.hour);
  const end = localDayStart(shiftDayKey(date, 1), boundary.timezone, boundary.hour);
  if (from.getTime() > now.getTime()) {
    throw ApiError.validation('`date` has not begun yet in the workspace time zone.');
  }
  const asOf = new Date(Math.min(end.getTime(), now.getTime()));

  let startIndex = 0;
  if (page.cursor !== null) {
    const index = agents.findIndex((agent) => agent.agentId === page.cursor);
    if (index < 0) throw ApiError.validation('`cursor` does not name an agent of this report.');
    startIndex = index + 1;
  }
  const slice = agents.slice(startIndex, startIndex + page.limit);
  const nextCursor =
    startIndex + page.limit < agents.length ? (slice[slice.length - 1]?.agentId ?? null) : null;

  const ids = slice.map((agent) => agent.agentId);
  const log =
    ids.length > 0 && from < asOf
      ? groupRows(await presenceLog(tx, licenseId, from, asOf, ids))
      : new Map<string, PresenceLogRow[]>();
  const plans = ids.length > 0 ? await plansOf(tx, licenseId, ids) : new Map();

  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    date,
    timezone: boundary.timezone,
    range: { from: from.toISOString(), to: end.toISOString() },
    as_of: asOf.toISOString(),
    agents: slice.map((agent) => {
      const segments: ActivitySegment[] =
        from < asOf
          ? activitySegments(log.get(agent.agentId) ?? [], from.getTime(), asOf.getTime())
          : [];
      const plan = plans.get(agent.agentId);
      const planned = plan ? plannedIntervals(plan, from.getTime(), end.getTime()) : null;
      return {
        agent_id: agent.agentId,
        name: agent.name,
        ...secondsBody(stateSeconds(segments)),
        segments: segments.map((segment) => ({
          state: segment.state,
          source: segment.source,
          from: iso(segment.from),
          to: iso(segment.to),
        })),
        planned: planned
          ? planned.map((interval) => ({ from: iso(interval.from), to: iso(interval.to) }))
          : null,
      };
    }),
    next_cursor: nextCursor,
  };
}
