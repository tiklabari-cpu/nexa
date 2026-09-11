/**
 * The selection model behind the Tickets grid's bulk actions (PRD §5.2
 * "Ticketing (gelişmiş)" · FR-13-EK.3 · FR-MOD-02.7.1).
 *
 * Pure and separate from the components for the usual reason — the rules are
 * what is worth pinning, and a checkbox is not — but also because two of them
 * are easy to get subtly wrong in JSX and invisible when they are:
 *
 *   - **A selection is a set of ids, never "everything matching".** The grid is
 *     keyset-paged over a collection that moves while it is read, so a
 *     server-side "apply to this whole view" would act on rows that arrived
 *     after the agent clicked. What the agent ticked is what gets written.
 *   - **The ceiling is the server's, imported rather than restated.** A client
 *     that lets somebody tick one row more than `POST /tickets/bulk` accepts
 *     turns the flagship gesture into a 400.
 */
import { TICKET_BULK_MAX, TICKET_PRIORITY_BANDS } from '@nexa/types';
import type { Agent, Ticket, TicketStatus } from './types.js';

export { TICKET_BULK_MAX };

/** How the header checkbox should read against the rows currently loaded. */
export type SelectAllState = 'none' | 'some' | 'all';

/** Add or remove one id. Returns a new set; never mutates the argument. */
export function toggleTicketSelection(
  selected: ReadonlySet<string>,
  id: string,
): ReadonlySet<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * Whether one more row may be ticked.
 *
 * A row already in the selection always may — otherwise the last box ticked
 * could not be un-ticked, which is how a ceiling turns into a trap.
 */
export function canSelectMore(selected: ReadonlySet<string>, id: string): boolean {
  return selected.has(id) || selected.size < TICKET_BULK_MAX;
}

export function selectAllState(
  selected: ReadonlySet<string>,
  loadedIds: readonly string[],
): SelectAllState {
  if (loadedIds.length === 0) return 'none';
  const hit = loadedIds.filter((id) => selected.has(id)).length;
  if (hit === 0) return 'none';
  return hit === loadedIds.length ? 'all' : 'some';
}

/**
 * Can the header checkbox act at all?
 *
 * It is refused, rather than quietly selecting the first fifty, once the grid
 * has chained more rows than one action may hold. Truncating would hand an
 * agent a box labelled "all" that means "some of them, we picked which" — the
 * one outcome a bulk action must never have. The bar beside it says why.
 */
export function canSelectAll(loadedIds: readonly string[]): boolean {
  return loadedIds.length > 0 && loadedIds.length <= TICKET_BULK_MAX;
}

/** Tick every loaded row, or clear them — whichever the header checkbox means now. */
export function toggleAllTickets(
  selected: ReadonlySet<string>,
  loadedIds: readonly string[],
): ReadonlySet<string> {
  if (!canSelectAll(loadedIds)) return selected;
  if (selectAllState(selected, loadedIds) === 'all') return new Set();
  return new Set(loadedIds);
}

/**
 * Drop ids the grid no longer holds.
 *
 * Solving a ticket moves it out of `my_open`, and changing the view replaces
 * the list wholesale. Without this the bar would go on counting rows that are
 * not on screen, and Apply would name ids the agent can no longer see.
 */
export function pruneTicketSelection(
  selected: ReadonlySet<string>,
  loadedIds: readonly string[],
): ReadonlySet<string> {
  const loaded = new Set(loadedIds);
  const kept = [...selected].filter((id) => loaded.has(id));
  return kept.length === selected.size ? selected : new Set(kept);
}

/** The patch one chosen action sends. Mirrors `POST /tickets/bulk`'s body. */
export interface TicketBulkAction {
  status?: TicketStatus;
  priority?: number;
  assignee_id?: string | null;
}

/**
 * One entry in the action picker: a stable `value` for the `<option>` and the
 * patch it stands for.
 *
 * The picker offers concrete *decisions* ("Status: Solved") rather than a field
 * plus a second control for its value. One `<select>` and one Apply is two
 * deliberate gestures before fifty tickets move; a field picker that applies on
 * change is one slip.
 */
export interface TicketBulkActionOption {
  value: string;
  group: 'status' | 'priority' | 'assignee';
  /** Translation key for the option's label, plus the argument it needs. */
  labelKey: string;
  labelArg?: string;
  action: TicketBulkAction;
}

const BULK_STATUSES: TicketStatus[] = ['open', 'pending', 'solved', 'closed', 'spam'];

/** The sentinel for "take the assignee off" — `assignee_id: null` on the wire. */
export const UNASSIGN_VALUE = 'assignee:none';

/**
 * Every action the picker offers, in the order it shows them.
 *
 * `agents` comes from the licence's agent list; an empty list simply means the
 * assignee group is the unassign entry alone, which is still a useful action.
 */
export function ticketBulkActionOptions(
  agents: readonly Agent[] = [],
): readonly TicketBulkActionOption[] {
  const statuses: TicketBulkActionOption[] = BULK_STATUSES.map((status) => ({
    value: `status:${status}`,
    group: 'status',
    labelKey: `inbox.ticketStatus.${status}`,
    action: { status },
  }));

  const priorities: TicketBulkActionOption[] = TICKET_PRIORITY_BANDS.map((band) => ({
    value: `priority:${band.value}`,
    group: 'priority',
    labelKey: `inbox.priority.${band.label.toLowerCase()}`,
    action: { priority: band.value },
  }));

  const assignees: TicketBulkActionOption[] = [
    {
      value: UNASSIGN_VALUE,
      group: 'assignee',
      labelKey: 'inbox.ticketBulk.unassign',
      action: { assignee_id: null },
    },
    ...agents.map((agent) => ({
      value: `assignee:${agent.id}`,
      group: 'assignee' as const,
      labelKey: 'inbox.ticketBulk.assignTo',
      labelArg: agent.name,
      action: { assignee_id: agent.id },
    })),
  ];

  return [...statuses, ...priorities, ...assignees];
}

/** The patch a picker value stands for, or null when nothing is chosen. */
export function ticketBulkActionFor(
  value: string,
  agents: readonly Agent[] = [],
): TicketBulkAction | null {
  return ticketBulkActionOptions(agents).find((option) => option.value === value)?.action ?? null;
}

/** Ids in the order the grid shows them — the order the report comes back in. */
export function selectedTicketIds(
  tickets: readonly Ticket[],
  selected: ReadonlySet<string>,
): string[] {
  return tickets.filter((ticket) => selected.has(ticket.id)).map((ticket) => ticket.id);
}
