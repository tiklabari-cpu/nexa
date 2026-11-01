import { describe, expect, it, vi } from 'vitest';
import type { TenantClient } from '../../lib/tenant.js';
import { applyTicketRules } from './apply-ticket-rules.js';
import {
  TicketSignals,
  changedFields,
  eventMoments,
  ticketChangeSignals,
  ticketOrigin,
  type TicketEventState,
} from './ticket-events.js';

const BEFORE: TicketEventState = {
  id: 'TCK1',
  subject: 'Çekim bekliyor',
  status: 'open',
  priority: 0,
  assigneeId: null,
  groupId: 7n,
  sourceChatId: null,
  inboundAddressId: null,
};
const AT = new Date('2026-11-01T10:00:00.000Z');

describe('what a ticket change says (AU-03 · tm 374)', () => {
  it('names the fields that moved, in a fixed order, and none for a change of nothing', () => {
    expect(changedFields(BEFORE, { ...BEFORE })).toEqual([]);
    expect(
      changedFields(BEFORE, { ...BEFORE, assigneeId: 'a1', status: 'solved', groupId: 7n }),
    ).toEqual(['status', 'assignee_id']);
    expect(changedFields(BEFORE, { ...BEFORE, groupId: null, subject: 'x' })).toEqual([
      'subject',
      'group_id',
    ]);
    expect(ticketChangeSignals(BEFORE, { ...BEFORE }, AT)).toEqual([]);
  });

  it('a status move is an update and a status change; a hand-over adds ticket_assigned', () => {
    const signals = ticketChangeSignals(
      BEFORE,
      { ...BEFORE, status: 'solved', assigneeId: 'a1' },
      AT,
    );
    expect(signals.map((s) => s.action)).toEqual([
      'ticket_updated',
      'ticket_status_changed',
      'ticket_assigned',
    ]);
    expect(signals[1]!.payload).toEqual({
      ticket_id: 'TCK1',
      from: 'open',
      to: 'solved',
      changed_at: AT.toISOString(),
    });
    expect(signals[2]!.payload).toMatchObject({
      assignee_id: 'a1',
      group_id: 7,
      previous_assignee_id: null,
      previous_group_id: 7,
    });
  });

  it('maps an event to its rule moments', () => {
    expect(eventMoments([], false)).toEqual([]);
    expect(eventMoments(['priority'], false)).toEqual(['updated']);
    expect(eventMoments(['status'], false)).toEqual(['updated', 'status_changed']);
    expect(eventMoments([], true)).toEqual(['message_added']);
    expect(eventMoments(['status'], true)).toEqual(['updated', 'status_changed', 'message_added']);
  });

  it('reads the origin a `source` condition sees off the row', () => {
    expect(ticketOrigin({ ...BEFORE, inboundAddressId: 'addr' })).toBe('email');
    expect(ticketOrigin({ ...BEFORE, sourceChatId: 'CH1' })).toBe('chat');
    expect(ticketOrigin(BEFORE)).toBe('manual');
  });

  it('collects deliveries and sends them in order; with no emitter, nothing', async () => {
    const signals = new TicketSignals();
    signals.push('ticket_updated', { a: 1 });
    signals.push('ticket_message_added', { b: 2 });
    const emit = vi.fn(async () => {});
    const tenant = { licenseId: 1n, organizationId: 'o', accountId: null } as never;
    await signals.emit({ emit }, tenant);
    expect(emit.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
      'ticket_updated',
      'ticket_message_added',
    ]);
    await expect(signals.emit(undefined, tenant)).resolves.toBeUndefined();
  });
});

describe('the loop guard (AU-03 · tm 374)', () => {
  it("a rule's own change runs nothing — not even the read of the rules", async () => {
    const findMany = vi.fn();
    const tx = { ticketRule: { findMany } } as unknown as TenantClient;
    const result = await applyTicketRules(
      tx,
      1n,
      'TCK1',
      { subject: 's', source: 'manual' },
      { on: ['updated'], triggeredByRule: true },
    );
    expect(result).toEqual({ ack: null, changes: { touched: false, tags: [] } });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('filters rules read once for a bulk gesture by moment, without reading again', async () => {
    const findMany = vi.fn();
    const tx = { ticketRule: { findMany } } as unknown as TenantClient;
    const result = await applyTicketRules(
      tx,
      1n,
      'TCK1',
      { subject: 's', source: 'manual' },
      {
        on: ['updated'],
        rules: [{ name: 'only on messages', on: 'message_added', conditions: {}, actions: {} }],
      },
    );
    expect(result.changes.touched).toBe(false);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('reads only the rules of the run’s moments', async () => {
    const findMany = vi.fn(async () => []);
    const tx = { ticketRule: { findMany } } as unknown as TenantClient;
    await applyTicketRules(
      tx,
      1n,
      'TCK1',
      { subject: 's', source: 'manual' },
      {
        on: ['updated', 'status_changed'],
      },
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { licenseId: 1n, enabled: true, on: { in: ['updated', 'status_changed'] } },
      }),
    );
  });
});
