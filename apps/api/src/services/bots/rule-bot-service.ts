/**
 * Rule bots — the CRUD half (FR-MOD-06.6).
 *
 * List, create, edit and delete the bots a workspace configures, their rules,
 * and the teams they serve. The engine that *runs* them when a visitor writes in
 * lives in `rule-bot-engine.ts`; the two share only the pure matcher, the same
 * separation `ticket-rule-service.ts` / `apply-ticket-rules.ts` keeps — so the
 * settings surface and the message hot path cannot drift into each other.
 *
 * Every read and write goes through the tenant-scoped client, so another
 * workspace's bot id simply does not come back and is reported as a 404 — the
 * same answer an id that never existed gets, because distinguishing the two
 * confirms that an id is real (NFR-S5).
 */
import type { Prisma } from '@prisma/client';
import {
  GROUP_PRIORITIES,
  RULE_BOT_MAX_GROUPS,
  RULE_BOT_MAX_RULES,
  type RuleBot,
  type RuleBotActions,
  type RuleBotConditions,
  type RuleBotGroupAssignment,
  type RuleBotRule,
} from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { type AuditContext, writeAuditEntry } from '../audit/audit-log.js';
import { hasRuleBotAction, hasRuleBotCondition } from './rule-bot-matching.js';

export interface RuleBotInput {
  name: string;
  enabled?: boolean;
  groups?: RuleBotGroupAssignment[];
}

export interface RuleBotPatch {
  name?: string;
  enabled?: boolean;
  groups?: RuleBotGroupAssignment[];
}

export interface RuleBotRuleInput {
  name: string;
  conditions: RuleBotConditions;
  actions: RuleBotActions;
  enabled?: boolean;
  position?: number;
}

export interface RuleBotRulePatch {
  name?: string;
  conditions?: RuleBotConditions;
  actions?: RuleBotActions;
  enabled?: boolean;
  position?: number;
}

interface BotRuleRow {
  id: string;
  name: string;
  conditions: Prisma.JsonValue;
  actions: Prisma.JsonValue;
  enabled: boolean;
  position: number;
  createdAt: Date;
}

interface BotRow {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: Date;
  rules: BotRuleRow[];
  groups: Array<{ groupId: bigint; priority: string }>;
}

/** The shape every read returns: rules in evaluation order, teams by id. */
const BOT_INCLUDE = {
  rules: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
  groups: { orderBy: { groupId: 'asc' } },
} as const satisfies Prisma.BotInclude;

export class RuleBotService {
  /** Every bot in the workspace, oldest first — the order they were created in. */
  async list(
    tx: TenantClient,
    tenant: TenantContext,
  ): Promise<{ items: RuleBot[]; total: number }> {
    const rows = await tx.bot.findMany({
      where: { licenseId: tenant.licenseId },
      orderBy: { createdAt: 'asc' },
      include: BOT_INCLUDE,
    });
    const items = rows.map(toBotDto);
    return { items, total: items.length };
  }

  async create(tx: TenantClient, tenant: TenantContext, input: RuleBotInput): Promise<RuleBot> {
    const name = requireName(input.name);
    const groups = await normalizeGroups(tx, tenant, input.groups ?? []);
    await assertNameFree(tx, tenant, name, null);

    const created = await tx.bot.create({
      data: {
        licenseId: tenant.licenseId,
        name,
        enabled: input.enabled ?? true,
        groups: {
          create: groups.map((g) => ({
            licenseId: tenant.licenseId,
            groupId: BigInt(g.group_id),
            priority: g.priority,
          })),
        },
      },
      include: BOT_INCLUDE,
    });
    return toBotDto(created);
  }

  /**
   * Rename a bot, switch it off, or change the teams it serves.
   *
   * `groups` replaces the whole list rather than merging: a bot's teams are a
   * set the console edits as a whole, and a merge would leave no way to remove
   * one without a second verb. The replacement is a delete + create inside the
   * caller's transaction, so the bot is never briefly reachable from no team.
   */
  async update(
    tx: TenantClient,
    tenant: TenantContext,
    id: string,
    patch: RuleBotPatch,
  ): Promise<RuleBot> {
    await this.#requireBot(tx, tenant, id);

    const data: Prisma.BotUpdateInput = {};
    if (patch.name !== undefined) {
      const name = requireName(patch.name);
      await assertNameFree(tx, tenant, name, id);
      data.name = name;
    }
    if (patch.enabled !== undefined) data.enabled = patch.enabled;

    if (patch.groups !== undefined) {
      const groups = await normalizeGroups(tx, tenant, patch.groups);
      await tx.botGroup.deleteMany({ where: { licenseId: tenant.licenseId, botId: id } });
      if (groups.length > 0) {
        await tx.botGroup.createMany({
          data: groups.map((g) => ({
            licenseId: tenant.licenseId,
            botId: id,
            groupId: BigInt(g.group_id),
            priority: g.priority,
          })),
        });
      }
    }

    const updated =
      Object.keys(data).length > 0
        ? await tx.bot.update({ where: { id }, data, include: BOT_INCLUDE })
        : await tx.bot.findFirstOrThrow({ where: { id }, include: BOT_INCLUDE });
    return toBotDto(updated);
  }

  /** Delete a bot. Its rules and team assignments go with it (ON DELETE CASCADE). */
  async remove(
    tx: TenantClient,
    tenant: TenantContext,
    audit: AuditContext,
    id: string,
  ): Promise<void> {
    const { count } = await tx.bot.deleteMany({ where: { id, licenseId: tenant.licenseId } });
    if (count === 0) throw ApiError.notFound('Bot not found.');
    // Only a delete that actually happened is worth an entry. A bot answers
    // customers, so its removal is a change to what the workspace says.
    await writeAuditEntry(tx, audit, {
      action: 'data.deleted',
      target: `bot:${id}`,
      metadata: { kind: 'rule_bot' },
    });
  }

  async createRule(
    tx: TenantClient,
    tenant: TenantContext,
    botId: string,
    input: RuleBotRuleInput,
  ): Promise<RuleBotRule> {
    await this.#requireBot(tx, tenant, botId);
    assertRuleUsable(input.conditions, input.actions);
    await assertActionsResolvable(tx, tenant, input.actions);

    const count = await tx.botRule.count({ where: { licenseId: tenant.licenseId, botId } });
    if (count >= RULE_BOT_MAX_RULES) {
      throw new ApiError(
        'limit_reached',
        `A bot may carry at most ${RULE_BOT_MAX_RULES} rules.`,
        {},
      );
    }

    const created = await tx.botRule.create({
      data: {
        licenseId: tenant.licenseId,
        botId,
        name: requireName(input.name),
        conditions: input.conditions as Prisma.InputJsonValue,
        actions: input.actions as Prisma.InputJsonValue,
        enabled: input.enabled ?? true,
        position: input.position ?? 0,
      },
    });
    return toRuleDto(created);
  }

  /**
   * Edit a rule or toggle it on/off. Only the keys supplied change, and the
   * result must still be a valid rule — an edit cannot strip the condition or
   * the action out from under one, the same discipline the ticket-rule and
   * campaign editors keep.
   */
  async updateRule(
    tx: TenantClient,
    tenant: TenantContext,
    botId: string,
    ruleId: string,
    patch: RuleBotRulePatch,
  ): Promise<RuleBotRule> {
    const existing = await tx.botRule.findFirst({
      where: { id: ruleId, botId, licenseId: tenant.licenseId },
    });
    if (!existing) throw ApiError.notFound('Bot rule not found.');

    const conditions = (patch.conditions ?? existing.conditions ?? {}) as RuleBotConditions;
    const actions = (patch.actions ?? existing.actions ?? {}) as RuleBotActions;
    assertRuleUsable(conditions, actions);
    if (patch.actions !== undefined) await assertActionsResolvable(tx, tenant, actions);

    const data: Prisma.BotRuleUpdateInput = {};
    if (patch.name !== undefined) data.name = requireName(patch.name);
    if (patch.conditions !== undefined) data.conditions = patch.conditions as Prisma.InputJsonValue;
    if (patch.actions !== undefined) data.actions = patch.actions as Prisma.InputJsonValue;
    if (patch.enabled !== undefined) data.enabled = patch.enabled;
    if (patch.position !== undefined) data.position = patch.position;

    const updated = await tx.botRule.update({ where: { id: ruleId }, data });
    return toRuleDto(updated);
  }

  async removeRule(
    tx: TenantClient,
    tenant: TenantContext,
    botId: string,
    ruleId: string,
  ): Promise<void> {
    const { count } = await tx.botRule.deleteMany({
      where: { id: ruleId, botId, licenseId: tenant.licenseId },
    });
    if (count === 0) throw ApiError.notFound('Bot rule not found.');
  }

  /**
   * The bot, or a 404. Every rule path goes through this first so a rule id
   * cannot be reached by pairing it with a bot the caller may not see.
   */
  async #requireBot(tx: TenantClient, tenant: TenantContext, id: string): Promise<void> {
    const bot = await tx.bot.findFirst({
      where: { id, licenseId: tenant.licenseId },
      select: { id: true },
    });
    if (!bot) throw ApiError.notFound('Bot not found.');
  }
}

function requireName(raw: string): string {
  const name = raw.trim();
  if (!name) throw ApiError.validation('name: a name is required.');
  return name;
}

/**
 * Two bots called "FAQ" in one console is a support call, not a feature, and the
 * unique index says so. Checked here as well so the refusal is a readable 400
 * naming the field rather than a driver-level constraint violation.
 */
async function assertNameFree(
  tx: TenantClient,
  tenant: TenantContext,
  name: string,
  exceptId: string | null,
): Promise<void> {
  const clash = await tx.bot.findFirst({
    where: {
      licenseId: tenant.licenseId,
      name,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw ApiError.validation('name: a bot with that name already exists.');
}

/** Both halves of "a rule is finished": something to match on, something to do. */
function assertRuleUsable(conditions: RuleBotConditions, actions: RuleBotActions): void {
  if (!hasRuleBotCondition(conditions)) {
    throw ApiError.validation('conditions: a rule needs a condition.');
  }
  if (!hasRuleBotAction(actions)) {
    throw ApiError.validation('actions: a rule needs an action.');
  }
}

/**
 * De-duplicate the assignment list, check the vocabulary, and refuse a team that
 * does not exist on this tenant.
 *
 * The last of those is what stops a bot being parked on a team nobody reads —
 * and, because the lookup runs under RLS, another workspace's team id fails here
 * exactly as an unknown one does.
 */
async function normalizeGroups(
  tx: TenantClient,
  tenant: TenantContext,
  groups: readonly RuleBotGroupAssignment[],
): Promise<RuleBotGroupAssignment[]> {
  if (groups.length > RULE_BOT_MAX_GROUPS) {
    throw new ApiError(
      'limit_reached',
      `A bot may serve at most ${RULE_BOT_MAX_GROUPS} teams.`,
      {},
    );
  }

  // Last one wins on a repeated team id, rather than letting the insert fail on
  // the composite primary key with a message nobody can act on.
  const byGroup = new Map<number, RuleBotGroupAssignment>();
  for (const assignment of groups) {
    if (!GROUP_PRIORITIES.includes(assignment.priority as (typeof GROUP_PRIORITIES)[number])) {
      throw ApiError.validation(`groups.priority: ${assignment.priority} is not a priority.`);
    }
    byGroup.set(assignment.group_id, { ...assignment });
  }

  const wanted = [...byGroup.keys()];
  if (wanted.length > 0) {
    const found = await tx.group.findMany({
      where: { licenseId: tenant.licenseId, id: { in: wanted.map((id) => BigInt(id)) } },
      select: { id: true },
    });
    if (found.length !== wanted.length) {
      throw ApiError.validation('groups.group_id: team does not exist on this licence.');
    }
  }

  return [...byGroup.values()];
}

/**
 * Refuse an action pointing at a team that does not exist on this tenant — the
 * same guard the ticket-rule editor makes, so a rule cannot be saved that would
 * hand conversations to nobody.
 */
async function assertActionsResolvable(
  tx: TenantClient,
  tenant: TenantContext,
  actions: RuleBotActions,
): Promise<void> {
  if (actions.transfer_to_group_id != null) {
    const group = await tx.group.findFirst({
      where: { id: BigInt(actions.transfer_to_group_id), licenseId: tenant.licenseId },
      select: { id: true },
    });
    if (!group) {
      throw ApiError.validation('transfer_to_group_id: team does not exist on this licence.');
    }
  }
}

function toBotDto(row: BotRow): RuleBot {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    groups: row.groups.map((g) => ({ group_id: Number(g.groupId), priority: g.priority })),
    rules: row.rules.map(toRuleDto),
    created_at: row.createdAt.toISOString(),
  };
}

function toRuleDto(row: BotRuleRow): RuleBotRule {
  return {
    id: row.id,
    name: row.name,
    conditions: (row.conditions ?? {}) as RuleBotConditions,
    actions: (row.actions ?? {}) as RuleBotActions,
    enabled: row.enabled,
    position: row.position,
    created_at: row.createdAt.toISOString(),
  };
}
