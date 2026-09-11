/**
 * The selection model behind the grid's bulk actions (FR-13-EK.3 ·
 * FR-MOD-02.7.1).
 *
 * These are the rules a checkbox cannot show you is wrong. Three of them carry
 * the weight: the ceiling must not become a trap (a ticked row can always be
 * un-ticked), "select all" must refuse rather than truncate once the grid has
 * chained more rows than one action may hold, and a selection must shrink when
 * the list it points into does — otherwise Apply names ids the agent can no
 * longer see.
 */
import { describe, expect, it } from 'vitest';
import {
  canSelectAll,
  canSelectMore,
  pruneTicketSelection,
  selectAllState,
  selectedTicketIds,
  ticketBulkActionFor,
  ticketBulkActionOptions,
  toggleAllTickets,
  toggleTicketSelection,
  TICKET_BULK_MAX,
  UNASSIGN_VALUE,
} from './ticket-selection.js';
import type { Agent, Ticket } from './types.js';

const ids = (count: number, prefix = 'T'): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(3, '0')}`);

function makeTicket(id: string): Ticket {
  return {
    id,
    subject: `Subject ${id}`,
    status: 'open',
    priority: 0,
    assignee_id: null,
    assignee_name: null,
    group_id: null,
    customer_id: 'cust-1',
    customer_name: 'Mira Haddad',
    customer_email: null,
    source_chat_id: null,
    merged_into_id: null,
    last_message_at: '2026-06-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

const AGENTS: Agent[] = [
  {
    id: 'agent-1',
    name: 'Dara',
    email: 'dara@example.com',
    avatar_url: null,
    role: 'agent',
    routing_status: 'accepting_chats',
    concurrent_chats_limit: 5,
  },
];

describe('toggling one row', () => {
  it('adds an id that is not there and removes one that is', () => {
    const first = toggleTicketSelection(new Set(), 'T001');
    expect([...first]).toEqual(['T001']);
    expect([...toggleTicketSelection(first, 'T001')]).toEqual([]);
  });

  it('never mutates the set it was given', () => {
    // The selection is React state; mutating it in place would leave the bar
    // and the boxes reading a value React does not know changed.
    const original = new Set(['T001']);
    toggleTicketSelection(original, 'T002');
    expect([...original]).toEqual(['T001']);
  });
});

describe('the ceiling', () => {
  it('stops offering another row once the selection is full', () => {
    const full = new Set(ids(TICKET_BULK_MAX));
    expect(canSelectMore(full, 'T999')).toBe(false);
  });

  it('always lets a row already in the selection be un-ticked', () => {
    // Without this the last box ticked could not be un-ticked: the control
    // would be disabled at exactly the moment the agent wants to correct it,
    // which is how a ceiling turns into a trap.
    const full = new Set(ids(TICKET_BULK_MAX));
    expect(canSelectMore(full, 'T001')).toBe(true);
  });

  it('allows the row that fills the last slot', () => {
    const nearlyFull = new Set(ids(TICKET_BULK_MAX - 1));
    expect(canSelectMore(nearlyFull, 'LAST')).toBe(true);
  });
});

describe('select all', () => {
  it('reports none, some and all against the rows on screen', () => {
    const loaded = ids(3);
    expect(selectAllState(new Set(), loaded)).toBe('none');
    expect(selectAllState(new Set(['T001']), loaded)).toBe('some');
    expect(selectAllState(new Set(loaded), loaded)).toBe('all');
  });

  it('reads an empty grid as none rather than as all', () => {
    // `every` over an empty list is vacuously true, which would render a ticked
    // "all" box above no rows at all.
    expect(selectAllState(new Set(), [])).toBe('none');
  });

  it('ignores ids that are not on screen when deciding "all"', () => {
    const loaded = ids(2);
    expect(selectAllState(new Set([...loaded, 'GONE']), loaded)).toBe('all');
  });

  it('refuses to act once the grid holds more rows than one action may cover', () => {
    // Truncating would hand the agent a box labelled "all" that means "the
    // first fifty, we picked which" — the one outcome a bulk action must never
    // have. The bar beside the grid says why instead.
    const loaded = ids(TICKET_BULK_MAX + 1);
    expect(canSelectAll(loaded)).toBe(false);
    expect([...toggleAllTickets(new Set(), loaded)]).toEqual([]);
  });

  it('covers a grid of exactly the ceiling', () => {
    const loaded = ids(TICKET_BULK_MAX);
    expect(canSelectAll(loaded)).toBe(true);
    expect(toggleAllTickets(new Set(), loaded).size).toBe(TICKET_BULK_MAX);
  });

  it('clears the selection when every loaded row is already ticked', () => {
    const loaded = ids(3);
    expect([...toggleAllTickets(new Set(loaded), loaded)]).toEqual([]);
  });

  it('completes a partial selection rather than clearing it', () => {
    const loaded = ids(3);
    expect([...toggleAllTickets(new Set(['T002']), loaded)].sort()).toEqual(loaded);
  });
});

describe('pruning', () => {
  it('drops ids the grid no longer holds', () => {
    // Solving a ticket moves it out of `my_open`; changing the view replaces
    // the list wholesale.
    expect([...pruneTicketSelection(new Set(['T001', 'T002']), ['T002'])]).toEqual(['T002']);
  });

  it('returns the same set when nothing was dropped', () => {
    // Identity matters: this runs in an effect on every list change, and a new
    // Set each time would re-render the grid forever.
    const selected = new Set(['T001']);
    expect(pruneTicketSelection(selected, ['T001', 'T002'])).toBe(selected);
  });

  it('empties the selection when the list does', () => {
    expect(pruneTicketSelection(new Set(['T001']), []).size).toBe(0);
  });
});

describe('the action picker', () => {
  it('offers every status and priority band, plus unassign, with no agents', () => {
    const options = ticketBulkActionOptions();
    expect(options.filter((o) => o.group === 'status')).toHaveLength(5);
    expect(options.filter((o) => o.group === 'priority')).toHaveLength(4);
    // An empty agent list still leaves a useful assignee action.
    expect(options.filter((o) => o.group === 'assignee').map((o) => o.value)).toEqual([
      UNASSIGN_VALUE,
    ]);
  });

  it('omits the two single-ticket fields the endpoint does not offer', () => {
    // `subject` describes one ticket and `email_template_id` mails every
    // customer in the selection — neither belongs behind one Apply button.
    const patches = ticketBulkActionOptions(AGENTS).map((option) => Object.keys(option.action));
    expect(patches.flat()).not.toContain('subject');
    expect(patches.flat()).not.toContain('email_template_id');
  });

  it('resolves a chosen value to exactly one field', () => {
    expect(ticketBulkActionFor('status:solved')).toEqual({ status: 'solved' });
    expect(ticketBulkActionFor('priority:100')).toEqual({ priority: 100 });
    expect(ticketBulkActionFor('assignee:agent-1', AGENTS)).toEqual({ assignee_id: 'agent-1' });
  });

  it('reads unassign as an explicit null, not as an absent key', () => {
    // An absent key leaves the assignee alone; collapsing the two would make
    // "unassign these six" a silent no-op.
    const action = ticketBulkActionFor(UNASSIGN_VALUE);
    expect(action).toEqual({ assignee_id: null });
    expect(action && 'assignee_id' in action).toBe(true);
  });

  it('answers nothing for an unchosen or unknown value', () => {
    expect(ticketBulkActionFor('')).toBeNull();
    // An agent who has left the licence between render and click must not
    // resolve to a patch that names them.
    expect(ticketBulkActionFor('assignee:agent-gone', AGENTS)).toBeNull();
  });
});

describe('what gets sent', () => {
  it('names the selected ids in the order the grid shows them', () => {
    const tickets = ids(4).map(makeTicket);
    expect(selectedTicketIds(tickets, new Set(['T003', 'T001']))).toEqual(['T001', 'T003']);
  });

  it('leaves out a ticked id the grid no longer holds', () => {
    // The list is the source of truth for what the agent can see; a stale id
    // would be sent for a row that is off screen.
    const tickets = ids(2).map(makeTicket);
    expect(selectedTicketIds(tickets, new Set(['T001', 'GONE']))).toEqual(['T001']);
  });
});
