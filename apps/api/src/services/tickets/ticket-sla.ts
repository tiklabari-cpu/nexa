/**
 * A ticket's first-response clock (HD-05 · tm 360).
 *
 * The clock starts when the ticket is created and stops at the first
 * `agent_reply` — an internal note or a system line does not stop it. It runs
 * only while the ticket is someone's work: open or pending, not merged (the
 * merged ticket's clock is not carried to its primary), and not opened from a
 * chat, whose first reply happened in the conversation and is measured there.
 * Reopening does not restart it: the start is always the creation.
 *
 * The target comes from the ticket's priority (`ticketSlaTargetMinutes`), so a
 * change of priority moves the due moment and never the start. With no target
 * for the priority the clock is not measured at all — the default, so no
 * existing workspace wakes up to a queue of breaches.
 *
 * ## Why the due moment is stored
 *
 * The list sorts the whole collection by it ("nearest to SLA"), and the sort is
 * the database's. With business hours on, the moment is a walk through the
 * workspace's calendar that SQL does not know, so it is computed here and
 * written to `tickets.first_response_due_at` by every path that can move it:
 * creation, a priority or status change, a merge, the first reply, the player
 * reopening a solved ticket, a policy save — and the SLA sweep, which rewrites
 * it for every running clock each pass so a schedule edit or a downgrade
 * catches up. The breach itself is still judged by `evaluate` against the live
 * calendar; the stored moment is `lateFrom` of the same numbers, so the two
 * agree.
 */
import type { Prisma } from '@prisma/client';
import type { TicketSla } from '@siyahtus/types';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { lateFrom } from '../sla/business-hours.js';
import { readClock, targetMinutesOf, type SlaClock } from '../sla/sla-service.js';

/** The tickets whose first-response clock is running (the target aside). */
export const RUNNING_FIRST_RESPONSE = {
  firstResponseAt: null,
  status: { in: ['open', 'pending'] },
  mergedIntoId: null,
  sourceChatId: null,
} satisfies Prisma.TicketWhereInput;

interface ClockRow {
  id: string;
  createdAt: Date;
  priority: number;
  status: string;
  firstResponseAt: Date | null;
  mergedIntoId: string | null;
  sourceChatId: string | null;
  firstResponseDueAt: Date | null;
}

const CLOCK_SELECT = {
  id: true,
  createdAt: true,
  priority: true,
  status: true,
  firstResponseAt: true,
  mergedIntoId: true,
  sourceChatId: true,
  firstResponseDueAt: true,
} as const;

/** From when a first reply to this ticket is late, or null when its clock is not running. */
export function firstResponseDueOf(
  row: Omit<ClockRow, 'id' | 'firstResponseDueAt'>,
  clock: SlaClock | null,
): Date | null {
  if (!clock) return null;
  if (row.firstResponseAt !== null || row.mergedIntoId !== null || row.sourceChatId !== null) {
    return null;
  }
  if (row.status !== 'open' && row.status !== 'pending') return null;
  const target = targetMinutesOf(clock.policy, {
    subjectType: 'ticket',
    target: 'first_response',
    priority: row.priority,
  });
  return target === null ? null : lateFrom(row.createdAt, target, clock.week);
}

/**
 * Recompute and store the due moment of the tickets `where` matches; returns
 * each one's new value so a caller holding a row can patch it.
 *
 * `clock` may be passed when the caller already read it (the sweep, a policy
 * save); otherwise it is read here — one primary-key lookup for a workspace
 * with no policy. Only rows whose value changes are written, in one statement.
 */
export async function refreshFirstResponseDue(
  tx: TenantClient,
  tenant: TenantContext,
  where: Prisma.TicketWhereInput,
  options: { clock?: SlaClock | null; at?: Date } = {},
): Promise<Map<string, Date | null>> {
  const at = options.at ?? new Date();
  const clock = options.clock !== undefined ? options.clock : await readClock(tx, tenant, at);
  const rows: ClockRow[] = await tx.ticket.findMany({ where, select: CLOCK_SELECT });

  const due = new Map<string, Date | null>();
  const ids: string[] = [];
  const values: Array<string | null> = [];
  for (const row of rows) {
    const next = firstResponseDueOf(row, clock);
    due.set(row.id, next);
    if ((row.firstResponseDueAt?.getTime() ?? null) !== (next?.getTime() ?? null)) {
      ids.push(row.id);
      values.push(next?.toISOString() ?? null);
    }
  }
  if (ids.length > 0) {
    await tx.$executeRaw`
      UPDATE tickets AS t SET first_response_due_at = v.due::timestamptz
      FROM unnest(${ids}::text[], ${values}::text[]) AS v(id, due)
      WHERE t.id = v.id AND t.license_id = ${tenant.licenseId}
    `;
  }
  return due;
}

/** The tickets among `ids` whose first-response miss is recorded. */
export async function breachedFirstResponses(
  tx: TenantClient,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx.slaBreach.findMany({
    where: { subjectType: 'ticket', target: 'first_response', subjectId: { in: ids } },
    select: { subjectId: true },
  });
  return new Set(rows.map((row) => row.subjectId));
}

/** The `sla` block of a ticket in the API. */
export function ticketSlaOf(
  row: { id: string; firstResponseAt: Date | null; firstResponseDueAt: Date | null },
  breached: ReadonlySet<string>,
  now: Date,
): TicketSla {
  const due = row.firstResponseDueAt;
  return {
    first_response_at: row.firstResponseAt?.toISOString() ?? null,
    first_response_due_at: due?.toISOString() ?? null,
    first_response_breached: breached.has(row.id) || (due !== null && now >= due),
  };
}
