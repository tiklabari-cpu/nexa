import { describe, expect, it } from 'vitest';
import { TICKET_RULE_EVENTS, isTicketRuleEvent } from './domain.js';
import { INTEGRATION_TRIGGERS } from './integrations.js';
import { RTM_PUSH_ACTIONS } from './rtm.js';
import {
  DEFAULT_BAD_RATING_ACTIONS,
  readBadRatingActions,
  type ChatRatedSignal,
  type TicketAssignedSignal,
  type TicketMessageAddedSignal,
  type TicketStatusChangedSignal,
  type TicketUpdatedSignal,
} from './ticket-triggers.js';

/** Every key of `T`, so a sample that drifts from its type fails here. */
const keysOf = <T>(shape: Record<keyof T, true>) => Object.keys(shape).sort();

describe('what a rated chat and a ticket say outside (AU-03 · tm 374)', () => {
  it('the manifest samples carry exactly the signal fields', () => {
    const expected: Record<string, string[]> = {
      chat_rated: keysOf<ChatRatedSignal>({
        rating_id: true,
        chat_id: true,
        thread_id: true,
        value: true,
        comment: true,
        customer_id: true,
        group_id: true,
        rated_at: true,
      }),
      ticket_updated: keysOf<TicketUpdatedSignal>({
        ticket_id: true,
        changed: true,
        status: true,
        priority: true,
        assignee_id: true,
        group_id: true,
        updated_at: true,
      }),
      ticket_status_changed: keysOf<TicketStatusChangedSignal>({
        ticket_id: true,
        from: true,
        to: true,
        changed_at: true,
      }),
      ticket_assigned: keysOf<TicketAssignedSignal>({
        ticket_id: true,
        assignee_id: true,
        group_id: true,
        previous_assignee_id: true,
        previous_group_id: true,
        assigned_at: true,
      }),
      ticket_message_added: keysOf<TicketMessageAddedSignal>({
        ticket_id: true,
        message_id: true,
        kind: true,
        author_type: true,
        created_at: true,
      }),
    };
    for (const [action, keys] of Object.entries(expected)) {
      const trigger = INTEGRATION_TRIGGERS.find((t) => t.action === action);
      expect(trigger, action).toBeDefined();
      expect(Object.keys(trigger!.sample_payload['data'] as object).sort(), action).toEqual(keys);
    }
    // No message text leaves with a ticket message.
    const message = INTEGRATION_TRIGGERS.find((t) => t.action === 'ticket_message_added')!;
    expect(JSON.stringify(message.sample_payload)).not.toMatch(/"(text|body)/);
  });

  it('the rule moments are the CHECK list, and the lead alert is a push', () => {
    expect([...TICKET_RULE_EVENTS]).toEqual([
      'created',
      'updated',
      'status_changed',
      'message_added',
    ]);
    expect(isTicketRuleEvent('status_changed')).toBe(true);
    expect(isTicketRuleEvent('assigned')).toBe(false);
    expect(RTM_PUSH_ACTIONS).toContain('chat_bad_rating_alert');
  });

  it('reads the bad-rating switches with the decision as the default', () => {
    expect(DEFAULT_BAD_RATING_ACTIONS).toEqual({
      notify_team_leads: true,
      add_to_qa_queue: true,
      open_ticket: false,
    });
    expect(readBadRatingActions(null)).toEqual(DEFAULT_BAD_RATING_ACTIONS);
    expect(readBadRatingActions({ open_ticket: true, notify_team_leads: 'no' })).toEqual({
      notify_team_leads: true,
      add_to_qa_queue: true,
      open_ticket: true,
    });
    expect(readBadRatingActions([])).toEqual(DEFAULT_BAD_RATING_ACTIONS);
  });
});
