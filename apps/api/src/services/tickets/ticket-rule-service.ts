/**
 * Ticket rules — condition + action automation over tickets (FR-MOD-08.6.2).
 *
 * This is the CRUD half: list, create, edit and delete the rules a workspace
 * configures. The engine that *applies* them when a ticket is opened lives in
 * `apply-ticket-rules.ts`; keeping the two apart means the settings surface and
 * the creation hot-path share only the pure matcher, not each other.
 *
 * Both a condition and an action are required (KK "koşul+eylem zorunlu"): a rule
 * that could match nobody, or that would do nothing, is rejected rather than
 * saved inert — checked here on every create and edit, and again in the pure
 * matcher for the row that somehow reaches the engine without one. An action
 * that names an agent or team is validated against the tenant now, so a rule
 * cannot be saved pointing at nothing.
 */
import type { Prisma } from '@prisma/client';
import type { TicketRule, TicketRuleActions, TicketRuleConditions } from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { hasAction, hasCondition } from './ticket-rule-matching.js';

export interface TicketRuleInput {
  name: string;
  conditions: TicketRuleConditions;
  actions: TicketRuleActions;
  enabled?: boolean;
  position?: number;
}

export interface TicketRulePatch {
  name?: string;
  conditions?: TicketRuleConditions;
  actions?: TicketRuleActions;
  enabled?: boolean;
  position?: number;
}

interface TicketRuleRow {
  id: string;
  name: string;
  conditions: Prisma.JsonValue;
  actions: Prisma.JsonValue;
  enabled: boolean;
  position: number;
  createdAt: Date;
}

export class TicketRuleService {
  /** Every rule in the tenant, in evaluation order (position, then age). */
  async list(
    tx: TenantClient,
    tenant: TenantContext,
  ): Promise<{ items: TicketRule[]; total: number }> {
    const rows = await tx.ticketRule.findMany({
      where: { licenseId: tenant.licenseId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    const items = rows.map(toDto);
    return { items, total: items.length };
  }

  async create(
    tx: TenantClient,
    tenant: TenantContext,
    input: TicketRuleInput,
  ): Promise<TicketRule> {
    const name = input.name.trim();
    if (!name) throw ApiError.validation('name: a rule needs a name.');
    if (!hasCondition(input.conditions)) {
      throw ApiError.validation('conditions: a rule needs a condition.');
    }
    if (!hasAction(input.actions)) {
      throw ApiError.validation('actions: a rule needs an action.');
    }
    await assertActionsResolvable(tx, tenant, input.actions);

    const created = await tx.ticketRule.create({
      data: {
        licenseId: tenant.licenseId,
        name,
        conditions: input.conditions as Prisma.InputJsonValue,
        actions: input.actions as Prisma.InputJsonValue,
        enabled: input.enabled ?? true,
        position: input.position ?? 0,
      },
    });
    return toDto(created);
  }

  /**
   * Edit a rule or toggle it on/off. Only the keys supplied change. The result
   * must still be a valid rule — an edit cannot strip the condition or action
   * out from under one, exactly as the campaign editor cannot strip a trigger.
   */
  async update(
    tx: TenantClient,
    tenant: TenantContext,
    id: string,
    patch: TicketRulePatch,
  ): Promise<TicketRule> {
    const existing = await tx.ticketRule.findFirst({ where: { id, licenseId: tenant.licenseId } });
    if (!existing) throw ApiError.notFound('Ticket rule not found.');

    const conditions = (patch.conditions ?? (existing.conditions ?? {})) as TicketRuleConditions;
    const actions = (patch.actions ?? (existing.actions ?? {})) as TicketRuleActions;
    if (!hasCondition(conditions)) {
      throw ApiError.validation('conditions: a rule needs a condition.');
    }
    if (!hasAction(actions)) {
      throw ApiError.validation('actions: a rule needs an action.');
    }
    if (patch.actions !== undefined) await assertActionsResolvable(tx, tenant, actions);

    const data: Prisma.TicketRuleUpdateInput = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw ApiError.validation('name: a rule needs a name.');
      data.name = name;
    }
    if (patch.conditions !== undefined) data.conditions = patch.conditions as Prisma.InputJsonValue;
    if (patch.actions !== undefined) data.actions = patch.actions as Prisma.InputJsonValue;
    if (patch.enabled !== undefined) data.enabled = patch.enabled;
    if (patch.position !== undefined) data.position = patch.position;

    const updated = await tx.ticketRule.update({ where: { id }, data });
    return toDto(updated);
  }

  /** Delete a rule. Scoped by licence so an id alone cannot reach another tenant's. */
  async remove(tx: TenantClient, tenant: TenantContext, id: string): Promise<void> {
    const { count } = await tx.ticketRule.deleteMany({ where: { id, licenseId: tenant.licenseId } });
    if (count === 0) throw ApiError.notFound('Ticket rule not found.');
  }
}

/**
 * Reject an action that assigns to an agent or team that does not exist on this
 * tenant — the same guard `TicketService` makes on a direct assignment, so a
 * rule cannot be saved that would drop tickets into a queue no one reads. RLS
 * narrows both lookups to the caller's licence, so another workspace's agent or
 * group fails here exactly as an unknown id does.
 */
async function assertActionsResolvable(
  tx: TenantClient,
  tenant: TenantContext,
  actions: TicketRuleActions,
): Promise<void> {
  if (actions.assign_agent_id) {
    const membership = await tx.agentMembership.findFirst({
      where: { agentId: actions.assign_agent_id, licenseId: tenant.licenseId, suspended: false },
      select: { agentId: true },
    });
    if (!membership) {
      throw ApiError.validation('assign_agent_id: not an active agent on this licence.');
    }
  }
  if (actions.assign_group_id != null) {
    const group = await tx.group.findFirst({
      where: { id: BigInt(actions.assign_group_id), licenseId: tenant.licenseId },
      select: { id: true },
    });
    if (!group) throw ApiError.validation('assign_group_id: team does not exist on this licence.');
  }
}

function toDto(row: TicketRuleRow): TicketRule {
  return {
    id: row.id,
    name: row.name,
    conditions: (row.conditions ?? {}) as TicketRuleConditions,
    actions: (row.actions ?? {}) as TicketRuleActions,
    enabled: row.enabled,
    position: row.position,
    created_at: row.createdAt.toISOString(),
  };
}
