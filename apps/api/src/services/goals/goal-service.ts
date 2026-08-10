/**
 * Goals — tracked conversion targets (FR-MOD-13.3).
 *
 * A goal is a name plus a predicate that says what counts as a conversion
 * ("the visitor reached /thank-you"). This service owns both halves: the
 * definition — creating one, listing them, turning one off — and `evaluate`,
 * which records a `goal_achievement` when a visitor reaches one. The funnel
 * report (13.3-f) reads what both write.
 *
 * Every query is filtered on `licenseId` and runs inside the caller's
 * `withTenant` transaction, so the `goals_tenant` RLS policy and the explicit
 * filter agree: a goal belonging to another workspace is not "forbidden", it
 * simply does not exist — a miss is `notFound`, never `forbidden`, so probing
 * ids cannot tell an attacker which ones are real (NFR-S5).
 *
 * There is no delete, only `active: false`. Retiring a goal keeps the
 * conversions it has already recorded, which a delete would cascade away and
 * quietly shrink last month's numbers.
 */
import type { Prisma } from '@prisma/client';
import type { Goal, GoalDefinition, GoalFilter } from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { hasGoalTrigger, matchesGoal } from './goal-matching.js';

/** The columns a DTO needs. */
const GOAL_SELECT = {
  id: true,
  name: true,
  definition: true,
  active: true,
  createdAt: true,
} satisfies Prisma.GoalSelect;

type GoalRow = Prisma.GoalGetPayload<{ select: typeof GOAL_SELECT }>;

export interface GoalInput {
  name: string;
  /** On/off intent; defaults to true — a new goal is meant to track. */
  active?: boolean;
  definition: GoalDefinition;
}

export interface GoalPatch {
  name?: string;
  active?: boolean;
  definition?: GoalDefinition;
}

export class GoalService {
  /** Every goal in the tenant, newest first, optionally narrowed by on/off. */
  async list(
    tx: TenantClient,
    tenant: TenantContext,
    options: { status: GoalFilter },
  ): Promise<{ items: Goal[]; total: number }> {
    const rows = await tx.goal.findMany({
      where: {
        licenseId: tenant.licenseId,
        ...(options.status === 'all' ? {} : { active: options.status === 'active' }),
      },
      orderBy: { createdAt: 'desc' },
      select: GOAL_SELECT,
    });
    const items = rows.map((row) => this.#toDto(row));
    return { items, total: items.length };
  }

  /** Define a conversion target (FR-MOD-13.3). */
  async create(tx: TenantClient, tenant: TenantContext, input: GoalInput): Promise<Goal> {
    const name = input.name.trim();
    if (!name) throw ApiError.validation('name: a goal needs a name.');
    // The same predicate the matcher will apply, so a goal the engine could
    // never reach cannot be saved as one that tracks — a definition with
    // nothing set is not "everyone converts", it is a target nobody hits.
    if (!hasGoalTrigger(input.definition)) {
      throw ApiError.validation('definition: a goal needs something to match on.');
    }

    const created = await tx.goal.create({
      data: {
        licenseId: tenant.licenseId,
        name,
        definition: input.definition as Prisma.InputJsonValue,
        active: input.active ?? true,
      },
      select: GOAL_SELECT,
    });
    return this.#toDto(created);
  }

  /**
   * Edit a goal or toggle it active. Only the keys supplied change; a goal that
   * stays (or becomes) active must still be able to match, so an edit cannot
   * strip the definition out from under one that is still tracking.
   */
  async update(
    tx: TenantClient,
    tenant: TenantContext,
    id: string,
    patch: GoalPatch,
  ): Promise<Goal> {
    const existing = await tx.goal.findFirst({
      where: { id, licenseId: tenant.licenseId },
      select: { active: true, definition: true },
    });
    if (!existing) throw ApiError.notFound('Goal not found.');

    const resultingActive = patch.active ?? existing.active;
    const resultingDefinition = (patch.definition ??
      (existing.definition as GoalDefinition | null) ??
      {}) as GoalDefinition;
    if (resultingActive && !hasGoalTrigger(resultingDefinition)) {
      throw ApiError.validation('definition: an active goal needs something to match on.');
    }

    const data: Prisma.GoalUpdateInput = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw ApiError.validation('name: a goal needs a name.');
      data.name = name;
    }
    if (patch.active !== undefined) data.active = patch.active;
    if (patch.definition !== undefined) data.definition = patch.definition as Prisma.InputJsonValue;

    const updated = await tx.goal.update({ where: { id }, data, select: GOAL_SELECT });
    return this.#toDto(updated);
  }

  /**
   * Record every goal this visitor has now reached, and return how many of them
   * are new (FR-MOD-13.3 — the funnel's conversion stage).
   *
   * Called on the visitor's own write path, so three things decide it:
   *
   * - **Tenant.** Goals are read with an explicit `licenseId` filter on top of
   *   RLS, and the achievement carries the same id. A visitor browsing one
   *   workspace's site can never trip another workspace's goal, and no row can
   *   land under a license the caller is not in.
   * - **Idempotency.** A person converts on a goal once. `UNIQUE(goal_id,
   *   customer_id)` plus `skipDuplicates` makes the second, tenth and hundredth
   *   page view a no-op instead of a row that inflates the funnel — decided by
   *   the database rather than by a read-then-write that two concurrent page
   *   views could both pass.
   * - **The campaign link.** A visitor who was invited by a campaign and then
   *   converted is that campaign's Conversion (FR-MOD-03.3.3). Written in this
   *   same transaction and only when something genuinely new was recorded, so
   *   the two numbers cannot disagree and a repeat view cannot re-flag sends.
   */
  async evaluate(
    tx: TenantClient,
    tenant: TenantContext,
    customerId: string,
    pageUrls: readonly string[],
    now: Date,
  ): Promise<number> {
    if (pageUrls.length === 0) return 0;

    const goals = await tx.goal.findMany({
      where: { licenseId: tenant.licenseId, active: true },
      select: { id: true, definition: true },
    });

    const matched = goals.filter((goal) => matchesGoal(goal.definition, pageUrls));
    if (matched.length === 0) return 0;

    // The conversation the visitor is in, if there is one — the funnel's middle
    // stage, captured on the row rather than re-derived later, since the chat
    // they converted during is not the chat they may be in a week from now.
    const chat = await tx.chat.findFirst({
      where: { customerId, active: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const written = await tx.goalAchievement.createMany({
      data: matched.map((goal) => ({
        licenseId: tenant.licenseId,
        goalId: goal.id,
        customerId,
        chatId: chat?.id ?? null,
        achievedAt: now,
      })),
      skipDuplicates: true,
    });
    if (written.count === 0) return 0;

    await tx.campaignSend.updateMany({
      where: { licenseId: tenant.licenseId, customerId },
      data: { converted: true },
    });

    return written.count;
  }

  #toDto(row: GoalRow): Goal {
    return {
      id: row.id,
      name: row.name,
      definition: (row.definition ?? {}) as GoalDefinition,
      active: row.active,
      created_at: row.createdAt.toISOString(),
    };
  }
}
