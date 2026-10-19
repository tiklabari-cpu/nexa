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
 * for skills (tm 296.2), behaviour rules (tm 299.1) and the guardrail
 * settings, rules and forbidden phrases (tm 301.2), and the hand-over rules
 * (tm 303.3).
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

// Compliance guardrails (tm 301.2 · AI-08). A change to any of these touches
// compliance: tm 316 asks the Founder to approve the version that carries it.

type GuardrailSettingsCreate = Omit<Prisma.AiGuardrailSettingsUncheckedCreateInput, 'updatedAt'>;
type GuardrailSettingsUpdate = Omit<Prisma.AiGuardrailSettingsUncheckedUpdateInput, 'updatedAt'>;

/** An agent's guardrail settings — the row is made on its first write. */
export async function upsertGuardrailSettingsDraft(
  tx: TenantClient,
  create: GuardrailSettingsCreate,
  update: GuardrailSettingsUpdate,
) {
  const updatedAt = new Date();
  return tx.aiGuardrailSettings.upsert({
    where: { aiAgentId: create.aiAgentId },
    create: { ...create, updatedAt },
    update: { ...update, updatedAt },
  });
}

type GuardrailRuleCreate = Omit<Prisma.AiGuardrailRuleUncheckedCreateInput, 'updatedAt'>;
type GuardrailRuleUpdate = Omit<Prisma.AiGuardrailRuleUncheckedUpdateInput, 'updatedAt'>;

export async function createGuardrailRuleDraft(tx: TenantClient, data: GuardrailRuleCreate) {
  return tx.aiGuardrailRule.create({ data: { ...data, updatedAt: new Date() } });
}

export async function updateGuardrailRuleDraft(
  tx: TenantClient,
  id: string,
  data: GuardrailRuleUpdate,
) {
  return tx.aiGuardrailRule.update({ where: { id }, data: { ...data, updatedAt: new Date() } });
}

/** How many rows went — 0 when the rule is not this workspace's. */
export async function deleteGuardrailRuleDraft(tx: TenantClient, id: string): Promise<number> {
  const { count } = await tx.aiGuardrailRule.deleteMany({ where: { id } });
  return count;
}

type ForbiddenPhraseCreate = Omit<Prisma.AiForbiddenPhraseUncheckedCreateInput, 'updatedAt'>;
type ForbiddenPhraseUpdate = Omit<Prisma.AiForbiddenPhraseUncheckedUpdateInput, 'updatedAt'>;

export async function createForbiddenPhraseDraft(tx: TenantClient, data: ForbiddenPhraseCreate) {
  return tx.aiForbiddenPhrase.create({ data: { ...data, updatedAt: new Date() } });
}

export async function updateForbiddenPhraseDraft(
  tx: TenantClient,
  id: string,
  data: ForbiddenPhraseUpdate,
) {
  return tx.aiForbiddenPhrase.update({ where: { id }, data: { ...data, updatedAt: new Date() } });
}

/** How many rows went — 0 when the phrase is not this workspace's. */
export async function deleteForbiddenPhraseDraft(tx: TenantClient, id: string): Promise<number> {
  const { count } = await tx.aiForbiddenPhrase.deleteMany({ where: { id } });
  return count;
}

// Hand-over settings (tm 303.1 · AI-09). The row's `updated_at` is its write
// trigger's (20261017120000) — the app role may not write that column — so
// step 1 is the database's here. `assignment_mode` and the stall timeout share
// the row but are read live, outside the package (ADR-14b §2.2); the triggers,
// messages and after-hours text are versioned.

type HandoffSettingsCreate = Omit<Prisma.AiHandoffSettingsUncheckedCreateInput, 'updatedAt'>;
type HandoffSettingsUpdate = Omit<Prisma.AiHandoffSettingsUncheckedUpdateInput, 'updatedAt'>;

/** An agent's hand-over settings — the row is made on its first write. */
export async function upsertHandoffSettingsDraft<S extends Prisma.AiHandoffSettingsSelect>(
  tx: TenantClient,
  create: HandoffSettingsCreate,
  update: HandoffSettingsUpdate,
  select: S,
) {
  return tx.aiHandoffSettings.upsert({
    where: { aiAgentId: create.aiAgentId },
    create,
    update,
    select,
  });
}

// Hand-over rules (tm 303.3 · AI-09, K9). Their order is behaviour — the first
// active rule that matches decides — so a reorder is a write like any other.

type HandoffRuleCreate = Omit<Prisma.AiHandoffRuleUncheckedCreateInput, 'updatedAt'>;
type HandoffRuleUpdate = Omit<Prisma.AiHandoffRuleUncheckedUpdateInput, 'updatedAt'>;

export async function createHandoffRuleDraft(tx: TenantClient, data: HandoffRuleCreate) {
  return tx.aiHandoffRule.create({ data: { ...data, updatedAt: new Date() } });
}

export async function updateHandoffRuleDraft(
  tx: TenantClient,
  id: string,
  data: HandoffRuleUpdate,
) {
  return tx.aiHandoffRule.update({ where: { id }, data: { ...data, updatedAt: new Date() } });
}

/** How many rows went — 0 when the rule is not this workspace's. */
export async function deleteHandoffRuleDraft(tx: TenantClient, id: string): Promise<number> {
  const { count } = await tx.aiHandoffRule.deleteMany({ where: { id } });
  return count;
}

/** Positions 1…n in the order given; the caller has checked the ids are the agent's, all of them. */
export async function reorderHandoffRulesDraft(
  tx: TenantClient,
  orderedIds: readonly string[],
  updatedBy: string | null,
): Promise<void> {
  const updatedAt = new Date();
  for (const [index, id] of orderedIds.entries()) {
    await tx.aiHandoffRule.update({
      where: { id },
      data: { position: index + 1, updatedBy, updatedAt },
    });
  }
}
