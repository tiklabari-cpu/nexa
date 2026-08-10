/**
 * `goal_achievements` — the storage slice for Goals (13.3-b).
 *
 * Two properties are asserted here and they fail independently:
 *
 *   1. **Idempotency.** The matcher (13.3-d) re-evaluates a visitor on every
 *      page view. A person converts on a goal once, so the second write must be
 *      refused by the database rather than by whoever remembers to check first.
 *      A missing constraint here breaks nothing visibly — the funnel simply
 *      reports more conversions than happened.
 *   2. **Tenant isolation.** The rows are a workspace's conversion performance.
 *      A cross-tenant read hands a competitor its rival's funnel; a
 *      cross-tenant write plants conversions nobody there earned. Both are
 *      attacked on purpose below, through the same client the application uses
 *      — the one that is actually subject to RLS.
 *
 * The negatives run against `DATABASE_APP_URL` (the `nexa_app` role). Fixtures
 * are laid down over `DATABASE_URL` (the owner), which is exempt from RLS — so
 * tenant B's rows genuinely exist while tenant A is failing to reach them.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateShortId } from '@nexa/types';
import { withTenant } from '../../src/lib/tenant.js';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const OWNER_URL = process.env['DATABASE_URL'];

describe('goal achievements (FR-MOD-13.3) — the conversion record', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;

  /** Goal definitions, one per tenant. */
  let aGoalId: string;
  let bGoalId: string;
  /** The chat tenant A's visitor converted in — the funnel's middle stage. */
  let aChatId: string;
  /** Tenant B's achievement, which tenant A must never see or touch. */
  let bAchievementId: string;

  beforeAll(async () => {
    if (!APP_URL || !OWNER_URL) throw new Error('DATABASE_URL and DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    fx = await seedFixtures(owner);

    const aGoal = await owner.goal.create({
      data: { licenseId: fx.a.licenseId, name: 'Checkout complete' },
      select: { id: true },
    });
    const bGoal = await owner.goal.create({
      data: { licenseId: fx.b.licenseId, name: 'Demo booked' },
      select: { id: true },
    });
    aGoalId = aGoal.id;
    bGoalId = bGoal.id;

    aChatId = generateShortId();
    await owner.chat.create({
      data: { id: aChatId, licenseId: fx.a.licenseId, customerId: fx.a.customerId },
    });

    const bAchievement = await owner.goalAchievement.create({
      data: { licenseId: fx.b.licenseId, goalId: bGoalId, customerId: fx.b.customerId },
      select: { id: true },
    });
    bAchievementId = bAchievement.id;
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  describe('the table itself', () => {
    it('has RLS enabled and a tenant policy with both halves — the KK for 13.3-b', async () => {
      const [security] = await owner.$queryRaw<Array<{ relname: string; enabled: boolean }>>`
        SELECT relname, relrowsecurity AS enabled FROM pg_class
        WHERE relname = 'goal_achievements'
      `;
      expect(security).toEqual({ relname: 'goal_achievements', enabled: true });

      // `qual` is what hides another tenant's rows on read; `with_check` is what
      // refuses to plant one. Losing either leaves the other passing.
      const policies = await owner.$queryRaw<
        Array<{ policyname: string; qual: string | null; withCheck: string | null }>
      >`
        SELECT policyname, qual, with_check AS "withCheck" FROM pg_policies
        WHERE tablename = 'goal_achievements'
      `;
      expect(policies).toHaveLength(1);
      expect(policies[0]?.policyname).toBe('goal_achievements_tenant');
      expect(policies[0]?.qual).toMatch(/nexa_current_license/);
      expect(policies[0]?.withCheck).toMatch(/nexa_current_license/);
    });

    it('constrains one conversion per (goal, visitor) and indexes the window read', async () => {
      const indexes = await owner.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'goal_achievements' ORDER BY indexname
      `;
      const byName = new Map(indexes.map((i) => [i.indexname, i.indexdef]));

      // The idempotency constraint has to be UNIQUE, not merely an index: a
      // plain index would let the duplicate through and only make it faster.
      const unique = byName.get('goal_achievements_goal_id_customer_id_key');
      expect(unique).toMatch(/UNIQUE INDEX/);
      expect(unique).toMatch(/\(goal_id, customer_id\)/);

      // 13.3-e asks "conversions in this license between two instants" twice per
      // report (window, then the window before it).
      expect(byName.get('goal_achievements_license_id_achieved_at_idx')).toMatch(
        /\(license_id, achieved_at\)/,
      );
    });

    it('cascades from license, goal and visitor — but never from the chat', async () => {
      const constraints = await owner.$queryRaw<
        Array<{ column: string; foreignTable: string; deleteRule: string }>
      >`
        SELECT kcu.column_name AS "column",
               ccu.table_name  AS "foreignTable",
               rc.delete_rule  AS "deleteRule"
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'goal_achievements' AND tc.constraint_type = 'FOREIGN KEY'
        ORDER BY kcu.column_name
      `;
      // An achievement naming a deleted goal or a purged visitor is a conversion
      // of nothing, and it would keep being counted — those cascade. The chat
      // does not: transcripts are purged on a retention schedule the conversion
      // history has to outlive, and cascading would silently shrink last
      // quarter's numbers after the fact.
      expect(constraints).toEqual([
        { column: 'chat_id', foreignTable: 'chats', deleteRule: 'SET NULL' },
        { column: 'customer_id', foreignTable: 'customers', deleteRule: 'CASCADE' },
        { column: 'goal_id', foreignTable: 'goals', deleteRule: 'CASCADE' },
        { column: 'license_id', foreignTable: 'licenses', deleteRule: 'CASCADE' },
      ]);
    });
  });

  describe('idempotency', () => {
    it('refuses a second conversion for the same (goal, visitor)', async () => {
      const tenantA = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };

      const first = await withTenant(app, tenantA, (tx) =>
        tx.goalAchievement.create({
          data: {
            licenseId: fx.a.licenseId,
            goalId: aGoalId,
            customerId: fx.a.customerId,
            chatId: aChatId,
          },
          select: { id: true, achievedAt: true, chatId: true },
        }),
      );
      expect(first.chatId).toBe(aChatId);
      expect(first.achievedAt).toBeInstanceOf(Date);

      // The matcher firing again on the visitor's next page view. Not a second
      // conversion — and it is the database that says so.
      await expect(
        withTenant(app, tenantA, (tx) =>
          tx.goalAchievement.create({
            data: { licenseId: fx.a.licenseId, goalId: aGoalId, customerId: fx.a.customerId },
          }),
        ),
      ).rejects.toThrow(/[Uu]nique constraint/);

      expect(
        await owner.goalAchievement.count({
          where: { goalId: aGoalId, customerId: fx.a.customerId },
        }),
      ).toBe(1);
    });

    it('still lets the same visitor convert on a different goal', async () => {
      // The constraint is per goal, not per visitor: a funnel with two goals
      // must be able to count the same person in both.
      const second = await owner.goal.create({
        data: { licenseId: fx.a.licenseId, name: 'Newsletter signup' },
        select: { id: true },
      });

      const achievement = await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        (tx) =>
          tx.goalAchievement.create({
            data: { licenseId: fx.a.licenseId, goalId: second.id, customerId: fx.a.customerId },
            select: { id: true },
          }),
      );
      expect(achievement.id).toBeTruthy();

      await owner.goal.delete({ where: { id: second.id } });
    });
  });

  describe('tenant isolation', () => {
    const tenantA = () => ({ licenseId: fx.a.licenseId, organizationId: fx.a.organizationId });

    it("reads only its own license's conversions", async () => {
      // Drop the policy from the migration and this goes red: tenant B's
      // achievement comes back and A learns how well its rival converts.
      const visible = await withTenant(app, tenantA(), (tx) =>
        tx.goalAchievement.findMany({ select: { goalId: true } }),
      );
      expect(visible.every((row) => row.goalId !== bGoalId)).toBe(true);
      expect(visible.length).toBeGreaterThan(0);
    });

    it('cannot fetch a tenant B achievement by its exact id (IDOR)', async () => {
      // Correct SQL, and the row exists — RLS is the only thing hiding it.
      const found = await withTenant(app, tenantA(), (tx) =>
        tx.goalAchievement.findUnique({ where: { id: bAchievementId } }),
      );
      expect(found).toBeNull();
    });

    it('cannot reach one through raw SQL that asks for it by license', async () => {
      // Prisma's filters are not the boundary. This is the report query
      // (13.3-e) aimed deliberately across the line.
      const rows = await withTenant(
        app,
        tenantA(),
        (tx) => tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) AS count FROM goal_achievements WHERE license_id = ${fx.b.licenseId}
        `,
      );
      expect(Number(rows[0]?.count ?? -1)).toBe(0);
    });

    it('cannot plant a conversion in tenant B (WITH CHECK)', async () => {
      await expect(
        withTenant(app, tenantA(), (tx) =>
          tx.goalAchievement.create({
            data: { licenseId: fx.b.licenseId, goalId: bGoalId, customerId: fx.b.customerId },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('cannot falsify or erase a tenant B conversion', async () => {
      // Handed the other tenant's exact id, both statements must touch nothing.
      // A silent success would let one workspace backdate another's conversions
      // out of the reporting window, or delete them outright.
      const result = await withTenant(app, tenantA(), async (tx) => ({
        moved: await tx.goalAchievement.updateMany({
          where: { id: bAchievementId },
          data: { achievedAt: new Date('2030-01-01T00:00:00.000Z') },
        }),
        erased: await tx.goalAchievement.deleteMany({ where: { id: bAchievementId } }),
      }));
      expect(result.moved.count).toBe(0);
      expect(result.erased.count).toBe(0);

      const survivor = await owner.goalAchievement.findUnique({ where: { id: bAchievementId } });
      expect(survivor).not.toBeNull();
      expect(survivor?.achievedAt.getFullYear()).not.toBe(2030);
    });
  });

  describe('lifecycle', () => {
    it('keeps the conversion when the chat it happened in is purged', async () => {
      // Retention deletes transcripts; the conversion count must not move.
      expect(await owner.goalAchievement.count({ where: { chatId: aChatId } })).toBe(1);

      await owner.chat.delete({ where: { id: aChatId } });

      // Same row, found by its goal rather than the pointer that just went away.
      const after = await owner.goalAchievement.findFirst({
        where: { goalId: aGoalId, customerId: fx.a.customerId },
        select: { chatId: true },
      });
      expect(after).not.toBeNull();
      expect(after?.chatId).toBeNull();
    });

    it('drops the conversion when its goal is deleted', async () => {
      // The other direction: a conversion against a goal that no longer exists
      // cannot be reported on, so it must not linger and be counted.
      expect(await owner.goalAchievement.count({ where: { goalId: aGoalId } })).toBe(1);

      await owner.goal.delete({ where: { id: aGoalId } });

      expect(await owner.goalAchievement.count({ where: { goalId: aGoalId } })).toBe(0);
    });
  });
});
