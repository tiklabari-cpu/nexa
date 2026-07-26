/**
 * Ticket rules — condition + action automation over tickets (FR-MOD-08.6.2).
 *
 * The property that carries the requirement is the KK "koşul+eylem zorunlu" and
 * its verification: a rule whose condition matches a newly opened ticket must
 * apply its action — the headline case being automatic assignment. Around that
 * sit the guards: a rule with no condition or no action is refused, a rule
 * cannot assign to nobody, a disabled rule does nothing, and — the failure most
 * easily shipped unseen — a rule never fires at another tenant's ticket.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface TicketDetail {
  id: string;
  subject: string;
  assignee_id: string | null;
  group_id: number | null;
  priority: number;
  tags: string[];
}

interface TicketRule {
  id: string;
  name: string;
  conditions: { subject_contains?: string; source?: 'chat' | 'email' };
  actions: {
    assign_agent_id?: string;
    assign_group_id?: number;
    priority?: number;
    add_tag?: string;
  };
  enabled: boolean;
  position: number;
}

describe('ticket rules', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const createRule = (token: string, body: unknown) =>
    server.post('/settings/ticket-rules', body, auth(token));

  const listRules = async (token: string): Promise<TicketRule[]> => {
    const response = await server.get('/settings/ticket-rules', auth(token));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: TicketRule[] }).items;
  };

  /** Open a ticket for a tenant's own customer — the moment rules fire. */
  const openTicket = async (
    token: string,
    subject: string,
    customerId: string,
  ): Promise<{ status: number; ticket: TicketDetail }> => {
    const response = await server.post('/tickets', { subject, customer_id: customerId }, auth(token));
    return { status: response.statusCode, ticket: response.json() as TicketDetail };
  };

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['tickets--all:rw'],
    });
  });

  // --- Validation: condition + action required (KK "koşul+eylem zorunlu") ----

  it('rejects a rule with no condition', async () => {
    const response = await createRule(adminToken, {
      name: 'No condition',
      conditions: {},
      actions: { priority: 10 },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a rule with no action', async () => {
    const response = await createRule(adminToken, {
      name: 'No action',
      conditions: { subject_contains: 'refund' },
      actions: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a rule that assigns to an agent not on the licence', async () => {
    // The other tenant's agent is a real account, but not a member here — RLS
    // narrows the membership lookup, so it is refused exactly like an unknown id.
    const response = await createRule(adminToken, {
      name: 'Assign to a stranger',
      conditions: { subject_contains: 'refund' },
      actions: { assign_agent_id: fx.b.agentAccountId },
    });
    expect(response.statusCode).toBe(400);
  });

  // --- The verification: rule → automatic assignment ------------------------

  it('auto-assigns a matching ticket to the rule’s agent', async () => {
    const created = await createRule(adminToken, {
      name: 'Refunds to the refund desk',
      conditions: { subject_contains: 'refund' },
      actions: { assign_agent_id: fx.a.agentAccountId },
    });
    expect(created.statusCode).toBe(201);

    const { status, ticket } = await openTicket(adminToken, 'Refund for order 42', fx.a.customerId);
    expect(status).toBe(201);
    expect(ticket.assignee_id).toBe(fx.a.agentAccountId);
  });

  it('also sets priority and applies a tag', async () => {
    await createRule(adminToken, {
      name: 'Escalate the urgent ones',
      conditions: { subject_contains: 'urgent' },
      actions: { priority: 50, add_tag: 'vip' },
    });

    const { ticket } = await openTicket(adminToken, 'URGENT: site is down', fx.a.customerId);
    expect(ticket.priority).toBe(50);
    expect(ticket.tags).toContain('vip');
  });

  it('leaves a ticket untouched when no rule matches', async () => {
    await createRule(adminToken, {
      name: 'Refunds only',
      conditions: { subject_contains: 'refund' },
      actions: { assign_agent_id: fx.a.agentAccountId, priority: 50 },
    });

    const { ticket } = await openTicket(adminToken, 'A general question', fx.a.customerId);
    expect(ticket.assignee_id).toBeNull();
    expect(ticket.priority).toBe(0);
    expect(ticket.tags).toEqual([]);
  });

  it('does not fire while the rule is disabled', async () => {
    await createRule(adminToken, {
      name: 'Off for now',
      conditions: { subject_contains: 'refund' },
      actions: { assign_agent_id: fx.a.agentAccountId },
      enabled: false,
    });

    const { ticket } = await openTicket(adminToken, 'Refund please', fx.a.customerId);
    expect(ticket.assignee_id).toBeNull();
  });

  it('does not fire a chat-only rule on a manually opened ticket', async () => {
    // A ticket opened straight through the API has origin `manual`, so a rule
    // scoped to `source: chat` must not touch it.
    await createRule(adminToken, {
      name: 'Chats only',
      conditions: { source: 'chat' },
      actions: { priority: 99 },
    });

    const { ticket } = await openTicket(adminToken, 'anything', fx.a.customerId);
    expect(ticket.priority).toBe(0);
  });

  it('runs rules in position order, so a later assignment wins', async () => {
    await createRule(adminToken, {
      name: 'First',
      conditions: { subject_contains: 'refund' },
      actions: { assign_agent_id: fx.a.ownerAccountId },
      position: 0,
    });
    await createRule(adminToken, {
      name: 'Second',
      conditions: { subject_contains: 'refund' },
      actions: { assign_agent_id: fx.a.agentAccountId },
      position: 1,
    });

    const { ticket } = await openTicket(adminToken, 'Refund for order 7', fx.a.customerId);
    expect(ticket.assignee_id).toBe(fx.a.agentAccountId);
  });

  // --- Cross-tenant isolation ------------------------------------------------

  it("never fires at another tenant's ticket", async () => {
    // Tenant A has a rule that would assign any refund. Tenant B opens exactly
    // such a ticket; A's rule must not reach across.
    await createRule(adminToken, {
      name: 'A refunds',
      conditions: { subject_contains: 'refund' },
      actions: { assign_agent_id: fx.a.agentAccountId },
    });
    const bToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['tickets--all:rw'],
    });

    const { ticket } = await openTicket(bToken, 'Refund for order 99', fx.b.customerId);
    expect(ticket.assignee_id).toBeNull();
    // And B does not even see A's rules.
    expect(await listRules(bToken)).toHaveLength(0);
  });

  // --- Scope split -----------------------------------------------------------

  it('lets a read-only holder list but not create rules', async () => {
    const readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['tickets--all:ro'],
    });
    expect((await server.get('/settings/ticket-rules', auth(readToken))).statusCode).toBe(200);
    const denied = await createRule(readToken, {
      name: 'Nope',
      conditions: { subject_contains: 'x' },
      actions: { priority: 1 },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('rejects a caller with no ticket scope', async () => {
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:ro'],
    });
    expect((await server.get('/settings/ticket-rules', auth(token))).statusCode).toBe(403);
  });
});
