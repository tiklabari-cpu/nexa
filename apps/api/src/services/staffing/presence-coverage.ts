/**
 * Online coverage derived from the presence event log (PRD §5.3-Vardiya,
 * WORKSCHED-d).
 *
 * `agent_memberships.routing_status` is a single mutable cell: it answers "is
 * this agent available *now*" and remembers nothing. The staffing forecast
 * needs the other question — "how much of last Tuesday's 14:00 hour was anyone
 * actually at their desk" — which only the append-only
 * `agent_presence_events` log can answer. This module turns that log into the
 * agent × hour grid the forecast (WORKSCHED-f) consumes.
 *
 * Pure on purpose, the same way `reports-metrics.ts` is: no Fastify, no Prisma,
 * no env. The caller queries the rows; the interval arithmetic and the
 * unknown-vs-zero rule live here where they can be unit-tested exhaustively,
 * because both are easy to get subtly wrong and impossible to notice
 * afterwards — a coverage number is plausible whatever it says.
 *
 * Two rules carry most of the weight:
 *
 *   - **Online means `accepting_chats`, and nothing else.** That is the exact
 *     condition routing assigns on (`routing-service.ts`: `m.routing_status =
 *     'accepting_chats'`), so it is the only status that represents capacity.
 *     An unrecognised status is counted as *not* online rather than skipped or
 *     assumed available: over-reporting coverage is the one error this feature
 *     must not make, because it hides understaffing instead of showing it.
 *   - **An empty log is `null`, never 0.** No events means "nothing is known
 *     about this window", which is not the same claim as "nobody was online" —
 *     the null-when-empty philosophy `resolutionRate` already holds to. Once
 *     there *is* a log, a zero bucket is real information (the agent was
 *     recorded as away) and is reported as 0.
 */

/** One row of `agent_presence_events`, as this module needs it. */
export interface PresenceEvent {
  agentId: string;
  /** One of `ROUTING_STATUSES`; anything else counts as not online. */
  status: string;
  changedAt: Date;
}

/** One agent's online minutes, bucketed by UTC hour of day. */
export interface AgentCoverage {
  agentId: string;
  /** 24 buckets, index = UTC hour of day (0-23), summed over the window. */
  onlineMinutes: number[];
}

/** The status that means "can be given a chat" — see the header. */
const ONLINE_STATUS = 'accepting_chats';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const HOURS_PER_DAY = 24;

/** Three decimals, the same precision `reports-metrics.round` settled on. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function assertTime(value: Date, label: string): number {
  const time = value instanceof Date ? value.getTime() : Number.NaN;
  if (!Number.isFinite(time))
    throw new TypeError(`presenceCoverage: ${label} must be a valid Date.`);
  return time;
}

/**
 * Add an online interval to an agent's hour-of-day buckets.
 *
 * Walks hour boundary to hour boundary rather than assigning the whole interval
 * to the hour it started in: a shift from 08:45 to 10:10 puts 15 minutes in
 * hour 8, 60 in hour 9 and 10 in hour 10. Epoch milliseconds and UTC hours share
 * their origin, so the boundary is plain integer arithmetic and no timezone
 * conversion — and therefore no DST discontinuity — enters the loop.
 */
function addInterval(buckets: number[], startMs: number, endMs: number): void {
  let cursor = startMs;
  while (cursor < endMs) {
    const hourEnd = Math.floor(cursor / HOUR_MS) * HOUR_MS + HOUR_MS;
    const sliceEnd = Math.min(endMs, hourEnd);
    const hour = new Date(cursor).getUTCHours();
    buckets[hour] = (buckets[hour] ?? 0) + (sliceEnd - cursor) / MINUTE_MS;
    cursor = sliceEnd;
  }
}

/**
 * Online minutes per agent per UTC hour of day across `[from, to)`, or `null`
 * when the log says nothing about that window.
 *
 * **The caller must include, for each agent, the last event at or before
 * `from`.** The table is a *change* log, so the state an agent was already in
 * when the window opened is knowable only from the row that set it; drop those
 * rows and every window silently begins with the agent unaccounted for. Events
 * are clipped to the window here, so passing extra history is safe and passing
 * too little is the failure mode to avoid.
 *
 * The last event for an agent runs open-ended to `to` — that is what "still in
 * that status" means in a log with no closing row.
 */
export function presenceCoverage(
  events: readonly PresenceEvent[],
  from: Date,
  to: Date,
): AgentCoverage[] | null {
  const fromMs = assertTime(from, '`from`');
  const toMs = assertTime(to, '`to`');
  if (fromMs >= toMs) {
    throw new RangeError('presenceCoverage: `from` must be strictly before `to`.');
  }

  // An event at or after `to` describes a state the window never saw, so it
  // cannot make an otherwise-unknown window known. Filtering here rather than
  // inside the walk keeps "is anything known?" a single, honest question.
  const known = events.filter((event) => assertTime(event.changedAt, '`changedAt`') < toMs);
  if (known.length === 0) return null;

  const byAgent = new Map<string, PresenceEvent[]>();
  for (const event of known) {
    const bucket = byAgent.get(event.agentId);
    if (bucket) bucket.push(event);
    else byAgent.set(event.agentId, [event]);
  }

  const coverage: AgentCoverage[] = [];

  for (const [agentId, agentEvents] of byAgent) {
    // Sorted defensively: the reader orders by `changed_at`, but a grid built
    // from mis-ordered rows would produce negative intervals that silently
    // vanish rather than an error anyone would notice.
    const ordered = [...agentEvents].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
    const onlineMinutes = new Array<number>(HOURS_PER_DAY).fill(0);

    for (const [index, event] of ordered.entries()) {
      if (event.status !== ONLINE_STATUS) continue;

      // This status holds until the next event, or until the end of the window
      // when there is no next one.
      const nextMs = ordered[index + 1]?.changedAt.getTime() ?? toMs;
      const startMs = Math.max(event.changedAt.getTime(), fromMs);
      const endMs = Math.min(nextMs, toMs);
      if (endMs > startMs) addInterval(onlineMinutes, startMs, endMs);
    }

    coverage.push({ agentId, onlineMinutes: onlineMinutes.map(round) });
  }

  // Deterministic order so two runs over the same log are byte-identical — the
  // property the forecast's own determinism rests on.
  return coverage.sort((a, b) => a.agentId.localeCompare(b.agentId));
}
