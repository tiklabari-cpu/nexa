/**
 * Bulk actions over the Tickets grid (PRD §5.2 "Ticketing (gelişmiş)" ·
 * FR-13-EK.3 · FR-MOD-02.7.1).
 *
 * PRD §5.2 puts "bulk actions" in v1 and then never says what one is: no FR
 * row, no acceptance criterion, no effort estimate, and no mention in
 * `rapor-1-fonksiyonel.md`. The shape below is therefore a set of product
 * decisions, made once and written down here because both ends need the same
 * answer — the console decides how many rows a selection may hold and what a
 * refusal means, and the server enforces both.
 *
 * **The selection is a list of ids, never "everything matching".** A server-side
 * "apply to the whole view" reads well in a mock-up and is wrong here: `GET
 * /tickets` is keyset-paged over a collection that moves while it is being read,
 * so the rows matching at click time are not the rows matching when the write
 * runs. An agent would then change tickets they never saw. Explicit ids mean the
 * request can only ever name what was on screen, which is also what makes a
 * per-row verdict meaningful and what keeps the work bounded.
 *
 * **A partial success is the expected outcome, not an error.** Tickets move
 * under a queue being worked: one of six may have been merged a second before
 * the click. Failing all six would throw away five correct decisions and teach
 * agents to select fewer rows than they mean. Each id comes back with its own
 * verdict and the successful writes stand.
 */

/**
 * How many tickets one bulk request may name.
 *
 * Fifty, because that is `TICKET_PAGE_SIZE` in the console — one page of the
 * grid. The ceiling exists for two reasons and the page is the honest answer to
 * both. It bounds the server's work: everything about the write is batched (one
 * read, one `updateMany`, one validation of the target) except the `audit_log`
 * entries, and that chain is sequential by construction — each entry hashes the
 * one before it — so per-row cost is real and has to be capped to stay inside
 * NFR-P2's write budget. And it bounds what an agent can do by accident, which
 * matters more: "select everything on this page" is a gesture whose consequences
 * are visible on the screen that produced it.
 */
export const TICKET_BULK_MAX = 50;

/**
 * Why one selected ticket was left alone.
 *
 * A closed vocabulary rather than a sentence, so the console can group and count
 * refusals instead of showing the agent fifty lines of prose.
 *
 * `not_found` deliberately covers three different things — another workspace's
 * id, a ticket outside this agent's teams, and one that never existed — for the
 * same reason `GET /tickets/{id}` answers 404 rather than 403: distinguishing
 * them confirms that an id is real (NFR-S5).
 */
export const TICKET_BULK_SKIP_REASONS = ['not_found', 'merged'] as const;
export type TicketBulkSkipReason = (typeof TICKET_BULK_SKIP_REASONS)[number];

/**
 * The fields a bulk action may set.
 *
 * Exactly the subset of `PATCH /tickets/{ticketId}` that means something across
 * many rows. Two of that endpoint's fields are absent on purpose:
 *
 *   - `subject` describes one ticket. Setting fifty subjects to the same string
 *     destroys the only column that tells them apart.
 *   - `email_template_id` mails the customer. Mailing every customer in a
 *     selection is a different product decision from correcting a queue, and
 *     the safe default is to not make it silently — the single endpoint is
 *     still there for a notice that is meant.
 */
export interface TicketBulkPatch {
  status?: string;
  priority?: number;
  assignee_id?: string | null;
  group_id?: number | null;
}

/** True when the patch actually asks for something. */
export function hasTicketBulkChange(patch: TicketBulkPatch): boolean {
  return (
    patch.status !== undefined ||
    patch.priority !== undefined ||
    patch.assignee_id !== undefined ||
    patch.group_id !== undefined
  );
}
