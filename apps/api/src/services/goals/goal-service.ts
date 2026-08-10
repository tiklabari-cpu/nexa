/**
 * Goals — tracked conversion targets (FR-MOD-13.3).
 *
 * A goal is a name plus a predicate that says what counts as a conversion
 * ("the visitor reached /thank-you"). This service owns only the definition:
 * creating one, listing them, and turning one off. The matcher that writes a
 * `goal_achievement` when someone reaches a goal (13.3-d) and the funnel report
 * (13.3-f) both read what is defined here.
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

/**
 * True when the definition has at least one usable predicate. A definition with
 * nothing set does not mean "everyone converts" — it means the goal can never
 * be reached, so it is rejected rather than saved as a target nobody hits.
 */
export function hasDefinition(definition: GoalDefinition): boolean {
  return Boolean(definition.url_contains && definition.url_contains.trim());
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
    if (!hasDefinition(input.definition)) {
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
    if (resultingActive && !hasDefinition(resultingDefinition)) {
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
