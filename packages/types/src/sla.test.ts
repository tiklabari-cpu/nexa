import { describe, expect, it } from 'vitest';
import {
  shortestTicketSlaTarget,
  slaMinutesLeft,
  slaPriorityKeyOf,
  ticketSlaTargetMinutes,
  type SlaTicketPolicyFields,
} from './sla.js';

const policy = (fields: Partial<SlaTicketPolicyFields> = {}): SlaTicketPolicyFields => ({
  resolution_minutes: null,
  ticket_first_response_minutes: null,
  ticket_resolution_minutes: null,
  ticket_targets_by_priority: null,
  ...fields,
});

describe('ticket SLA targets (HD-05)', () => {
  it('snaps a signed priority to the named level the inbox shows', () => {
    expect(slaPriorityKeyOf(100)).toBe('urgent');
    expect(slaPriorityKeyOf(75)).toBe('urgent');
    expect(slaPriorityKeyOf(40)).toBe('high');
    expect(slaPriorityKeyOf(0)).toBe('normal');
    expect(slaPriorityKeyOf(-80)).toBe('low');
  });

  it('measures no first response by default — the chat target is not borrowed', () => {
    expect(ticketSlaTargetMinutes(policy(), 100, 'first_response')).toBeNull();
    expect(shortestTicketSlaTarget(policy(), 'first_response')).toBeNull();
  });

  it("takes the priority's own target, then the ticket-wide one", () => {
    const p = policy({
      ticket_first_response_minutes: 240,
      ticket_targets_by_priority: {
        urgent: { first_response_minutes: 60, resolution_minutes: null },
        low: { first_response_minutes: null, resolution_minutes: 10_000 },
      },
    });
    expect(ticketSlaTargetMinutes(p, 100, 'first_response')).toBe(60);
    expect(ticketSlaTargetMinutes(p, 0, 'first_response')).toBe(240);
    // A null in a priority's entry inherits rather than switching the clock off.
    expect(ticketSlaTargetMinutes(p, -50, 'first_response')).toBe(240);
    expect(shortestTicketSlaTarget(p, 'first_response')).toBe(60);
  });

  it('falls a resolution target back to the shared one, as before tickets had their own', () => {
    expect(ticketSlaTargetMinutes(policy({ resolution_minutes: 480 }), 0, 'resolution')).toBe(480);
    expect(
      ticketSlaTargetMinutes(
        policy({ resolution_minutes: 480, ticket_resolution_minutes: 2880 }),
        0,
        'resolution',
      ),
    ).toBe(2880);
  });

  it('counts whole minutes left, negative once late', () => {
    const due = '2026-10-31T12:00:00.000Z';
    expect(slaMinutesLeft(due, Date.parse('2026-10-31T11:15:30.000Z'))).toBe(44);
    expect(slaMinutesLeft(due, Date.parse('2026-10-31T11:59:59.000Z'))).toBe(0);
    expect(slaMinutesLeft(due, Date.parse('2026-10-31T12:00:00.000Z'))).toBe(-1);
    expect(slaMinutesLeft(due, Date.parse('2026-10-31T12:00:01.000Z'))).toBe(-1);
  });
});
