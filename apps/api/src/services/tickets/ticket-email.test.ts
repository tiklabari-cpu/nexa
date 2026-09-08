/**
 * Rendering a stored ticket e-mail template (FR-MOD-08.7.5 — the consuming half).
 *
 * The positive case is one line of substitution; the reason this file is longer
 * than that is the refusals. Before tm 227 a workspace could author a template
 * and nothing would ever send it, and the way to re-introduce that failure
 * quietly is not to stop sending — it is to send something wrong: raw
 * `{{ticket.titel}}` braces in a customer's inbox, a template the workspace had
 * switched off, or a message addressed to nobody. Each of those is pinned here.
 */
import { describe, expect, it } from 'vitest';
import type { TicketEmailFacts } from './ticket-email.js';
import { renderTicketEmail, ticketTemplateContext } from './ticket-email.js';

const FACTS: TicketEmailFacts = {
  ticketId: 'TCK00000001',
  subject: 'Withdrawal is stuck',
  status: 'solved',
  priority: 50,
  customerName: 'Ada Lovelace',
  customerEmail: 'ada@example.com',
  agentName: 'Grace',
  companyName: 'Acme Support',
};

const TEMPLATE = {
  id: '11111111-1111-4111-8111-111111111111',
  subject: '[{{company.name}}] Ticket {{ticket.id}} is {{ticket.status}}',
  body: 'Hi {{customer.name}},\n\n{{agent.name}} marked "{{ticket.subject}}" as {{ticket.status}}.\nPriority: {{ticket.priority}}.\n',
  enabled: true,
};

describe('ticketTemplateContext', () => {
  it('gives every catalogued variable a value', () => {
    const context = ticketTemplateContext(FACTS);
    expect(context).toEqual({
      'ticket.id': 'TCK00000001',
      'ticket.subject': 'Withdrawal is stuck',
      'ticket.status': 'solved',
      'ticket.priority': 'High',
      'customer.name': 'Ada Lovelace',
      'customer.email': 'ada@example.com',
      'agent.name': 'Grace',
      'company.name': 'Acme Support',
    });
  });

  it('renders the priority as its named band, never as the stored integer', () => {
    // The column is a signed ±100 queue-ordering scale. "Priority: -50" tells a
    // customer nothing; the band table is the one the inbox renders.
    expect(ticketTemplateContext({ ...FACTS, priority: -50 })['ticket.priority']).toBe('Low');
    expect(ticketTemplateContext({ ...FACTS, priority: 0 })['ticket.priority']).toBe('Normal');
    expect(ticketTemplateContext({ ...FACTS, priority: 97 })['ticket.priority']).toBe('Urgent');
  });

  it('turns an absent name into an empty value rather than leaving it unset', () => {
    // An unset key and an empty one render identically, but only the explicit
    // one says the emptiness was decided rather than forgotten.
    const context = ticketTemplateContext({ ...FACTS, agentName: null, companyName: null });
    expect(context['agent.name']).toBe('');
    expect(context['company.name']).toBe('');
  });
});

describe('renderTicketEmail (FR-MOD-08.7.5)', () => {
  it('fills the placeholders and addresses the customer', () => {
    const outcome = renderTicketEmail(TEMPLATE, FACTS);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.message.to).toBe('ada@example.com');
    expect(outcome.message.subject).toBe('[Acme Support] Ticket TCK00000001 is solved');
    expect(outcome.message.body).toContain('Hi Ada Lovelace,');
    expect(outcome.message.body).toContain('Grace marked "Withdrawal is stuck" as solved.');
    expect(outcome.message.body).toContain('Priority: High.');
  });

  it('leaves no placeholder syntax in anything it sends', () => {
    const outcome = renderTicketEmail(TEMPLATE, {
      ...FACTS,
      // The thin case: a ticket whose customer has a name we never captured.
      customerName: null,
      agentName: null,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.message.subject + outcome.message.body).not.toContain('{{');
    expect(outcome.message.subject + outcome.message.body).not.toContain('}}');
  });

  it('reports the variables used, and no values', () => {
    const outcome = renderTicketEmail(TEMPLATE, FACTS);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect([...outcome.message.variables].sort()).toEqual([
      'agent.name',
      'company.name',
      'customer.name',
      'ticket.id',
      'ticket.priority',
      'ticket.status',
      'ticket.subject',
    ]);
    expect(JSON.stringify(outcome.message.variables)).not.toContain('Ada');
  });

  it('refuses a template that is switched off', () => {
    const outcome = renderTicketEmail({ ...TEMPLATE, enabled: false }, FACTS);
    expect(outcome).toEqual({ ok: false, refusal: { reason: 'disabled' } });
  });

  it('refuses a stored template naming a variable the product cannot fill', () => {
    // The failure this whole module exists to prevent: a row authored against
    // yesterday's catalogue, rendered today, shipping raw braces to a customer.
    const outcome = renderTicketEmail(
      { ...TEMPLATE, subject: 'Ticket {{ticket.titel}}', body: 'Hello.' },
      FACTS,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal.reason).toBe('invalid_template');
  });

  it('refuses a stored template with a broken placeholder', () => {
    const outcome = renderTicketEmail({ ...TEMPLATE, body: 'Hi {{customer.name}!' }, FACTS);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal.reason).toBe('invalid_template');
  });

  it('refuses when the ticket has no customer address', () => {
    for (const email of [null, '', '   ']) {
      const outcome = renderTicketEmail(TEMPLATE, { ...FACTS, customerEmail: email });
      expect(outcome).toEqual({ ok: false, refusal: { reason: 'no_recipient' } });
    }
  });

  it('checks the template before it checks the recipient', () => {
    // Order matters for the message the agent gets back: a broken template is
    // the thing they can fix, and hearing "no address" first would send them
    // looking at the customer record instead.
    const outcome = renderTicketEmail(
      { ...TEMPLATE, body: '{{ticket.titel}}' },
      { ...FACTS, customerEmail: null },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal.reason).toBe('invalid_template');
  });
});
