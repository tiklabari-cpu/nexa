/**
 * The one writer of the AI's editing tables (ADR `docs/adr/ai-config-versioning.md`
 * §2.5 · opened by tm 296.2).
 *
 * What the panel and the API write is the draft: the tables themselves, no
 * publish state on a row (§2.1). Versioning adds work to every such write — the
 * agent's `draft_revision` with `If-Match` and `409 ai_config_revision_conflict`
 * (tm 316), the change history (tm 315) — and that work belongs in one place,
 * not in each route. So a route never calls `tx.skill.create`/`update`/`delete`
 * on an editing table itself; it calls this.
 *
 * This first form does §2.5 step 1 only: it stamps the row's `updated_at` —
 * for skills (tm 296.2) and behaviour rules (tm 299.1).
 * A route that writes `updated_at` itself, or opens a `status`/`version`
 * column, breaks the rule.
 */
import type { Prisma } from '@prisma/client';
import type { TenantClient } from '../../lib/tenant.js';

type SkillCreate = Omit<Prisma.SkillUncheckedCreateInput, 'updatedAt'>;
type SkillUpdate = Omit<Prisma.SkillUncheckedUpdateInput, 'updatedAt'>;

export async function createSkillDraft(tx: TenantClient, data: SkillCreate) {
  return tx.skill.create({ data: { ...data, updatedAt: new Date() } });
}

export async function updateSkillDraft(tx: TenantClient, id: string, data: SkillUpdate) {
  return tx.skill.update({ where: { id }, data: { ...data, updatedAt: new Date() } });
}

/** How many rows went — 0 when the skill is not this workspace's. */
export async function deleteSkillDraft(tx: TenantClient, id: string): Promise<number> {
  const { count } = await tx.skill.deleteMany({ where: { id } });
  return count;
}

type GuidanceRuleCreate = Omit<Prisma.AiGuidanceRuleUncheckedCreateInput, 'updatedAt'>;
type GuidanceRuleUpdate = Omit<Prisma.AiGuidanceRuleUncheckedUpdateInput, 'updatedAt'>;

/** A behaviour rule (tm 299.1 · AI-07) — the same one door as a skill. */
export async function createGuidanceRuleDraft(tx: TenantClient, data: GuidanceRuleCreate) {
  return tx.aiGuidanceRule.create({ data: { ...data, updatedAt: new Date() } });
}

export async function updateGuidanceRuleDraft(
  tx: TenantClient,
  id: string,
  data: GuidanceRuleUpdate,
) {
  return tx.aiGuidanceRule.update({ where: { id }, data: { ...data, updatedAt: new Date() } });
}

/** How many rows went — 0 when the rule is not this workspace's. */
export async function deleteGuidanceRuleDraft(tx: TenantClient, id: string): Promise<number> {
  const { count } = await tx.aiGuidanceRule.deleteMany({ where: { id } });
  return count;
}
