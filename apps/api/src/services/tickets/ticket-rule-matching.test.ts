import { describe, expect, it } from 'vitest';
import { hasAction, hasCondition, matchesTicketRule } from './ticket-rule-matching.js';

describe('hasCondition', () => {
  it('is true only when a condition carries something to match on', () => {
    expect(hasCondition({ subject_contains: 'refund' })).toBe(true);
    expect(hasCondition({ source: 'email' })).toBe(true);
    expect(hasCondition({})).toBe(false);
    // Whitespace is not a condition — it would match every ticket.
    expect(hasCondition({ subject_contains: '   ' })).toBe(false);
  });
});

describe('hasAction', () => {
  it('is true only when the rule does at least one thing', () => {
    expect(hasAction({ assign_agent_id: 'a1' })).toBe(true);
    expect(hasAction({ assign_group_id: 3 })).toBe(true);
    expect(hasAction({ add_tag: 'vip' })).toBe(true);
    expect(hasAction({})).toBe(false);
    expect(hasAction({ add_tag: '  ' })).toBe(false);
  });

  it('counts a priority of 0 as a real action', () => {
    // 0 is the default priority, but setting it is still a deliberate action —
    // a `!actions.priority` check would drop it and wrongly reject the rule.
    expect(hasAction({ priority: 0 })).toBe(true);
  });
});

describe('matchesTicketRule', () => {
  const ticket = { subject: 'Refund for order 42', source: 'email' as const };

  it('matches a case-insensitive subject substring', () => {
    expect(matchesTicketRule({ subject_contains: 'refund' }, ticket)).toBe(true);
    expect(matchesTicketRule({ subject_contains: 'REFUND' }, ticket)).toBe(true);
    expect(matchesTicketRule({ subject_contains: 'invoice' }, ticket)).toBe(false);
  });

  it('matches on origin', () => {
    expect(matchesTicketRule({ source: 'email' }, ticket)).toBe(true);
    expect(matchesTicketRule({ source: 'chat' }, ticket)).toBe(false);
    // A manual ticket is matched by no `source` condition at all.
    expect(matchesTicketRule({ source: 'chat' }, { subject: 'x', source: 'manual' })).toBe(false);
    expect(matchesTicketRule({ source: 'email' }, { subject: 'x', source: 'manual' })).toBe(false);
  });

  it('requires every set condition to hold (AND)', () => {
    expect(matchesTicketRule({ subject_contains: 'refund', source: 'email' }, ticket)).toBe(true);
    // Right subject, wrong origin — a rule reading "refunds, from chat" must not
    // fire for a refund that arrived by email.
    expect(matchesTicketRule({ subject_contains: 'refund', source: 'chat' }, ticket)).toBe(false);
  });

  it('matches nobody when no condition is set', () => {
    // The engine only ever sees validated rules, but a predicate with nothing
    // set must fire at no one rather than everyone.
    expect(matchesTicketRule({}, ticket)).toBe(false);
  });
});
