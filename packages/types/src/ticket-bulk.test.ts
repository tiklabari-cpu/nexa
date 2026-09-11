import { describe, expect, it } from 'vitest';
import {
  TICKET_BULK_MAX,
  TICKET_BULK_SKIP_REASONS,
  hasTicketBulkChange,
  type TicketBulkPatch,
} from './ticket-bulk.js';

describe('bulk ticket actions — the shared rule (FR-13-EK.3)', () => {
  it('caps a selection at one page of the grid', () => {
    // 50 is `TICKET_PAGE_SIZE` in apps/web/src/features/inbox/useTickets.ts.
    // The two are the same number on purpose — "select everything on this page"
    // must never be one row over the ceiling, or the flagship gesture 400s.
    expect(TICKET_BULK_MAX).toBe(50);
  });

  it('keeps the refusal vocabulary closed and free of a "no permission" verdict', () => {
    // A `forbidden` reason would tell the caller that an id they cannot touch
    // nonetheless exists. Invisible and non-existent are one answer (NFR-S5).
    expect([...TICKET_BULK_SKIP_REASONS]).toEqual(['not_found', 'merged']);
    expect(TICKET_BULK_SKIP_REASONS).not.toContain('forbidden');
  });

  it('reads an empty patch as no change', () => {
    expect(hasTicketBulkChange({})).toBe(false);
  });

  it('counts a null assignee or team as a change, not as an absent key', () => {
    // `null` clears the field and an absent key leaves it alone — collapsing the
    // two would make "unassign these six" a silent no-op.
    expect(hasTicketBulkChange({ assignee_id: null })).toBe(true);
    expect(hasTicketBulkChange({ group_id: null })).toBe(true);
  });

  it('recognises each offered field on its own', () => {
    const each: TicketBulkPatch[] = [
      { status: 'solved' },
      { priority: 50 },
      { assignee_id: '00000000-0000-0000-0000-000000000001' },
      { group_id: 3 },
    ];
    for (const patch of each) expect(hasTicketBulkChange(patch)).toBe(true);
  });
});
