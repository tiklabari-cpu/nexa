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
 * settings, rules and forbidden phrases (tm 301.2), the hand-over rules
 * (tm 303.3), the hand-over routes (tm 307.1), the knowledge sources
 * (tm 309.1; a KB article's from tm 309.2) and the structured knowledge tables'
 * rows with their sources (tm 310.2). A route that writes `updated_at` itself, or opens a
 * `status`/`version` column, breaks the rule.
 */
import type { Prisma } from '@prisma/client';
import {
  KNOWLEDGE_TABLE_SOURCE_TYPE,
  KNOWLEDGE_TABLE_SQL_NAMES,
  type KnowledgeAudience,
  type KnowledgeTable,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import { knowledgeTableDelegate, type KnowledgeTableRecords } from '../knowledge-tables/rows.js';

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

// Hand-over routes (tm 307.1 · AI-12, shared with AU-01). Human routing reads
// them live; the AI's hand-over target is versioned with the package
// (ADR-14b §2.12), so they are written here like any editing table.

type HandoffRouteCreate = Omit<Prisma.HandoffRouteUncheckedCreateInput, 'updatedAt'>;
type HandoffRouteUpdate = Omit<Prisma.HandoffRouteUncheckedUpdateInput, 'updatedAt'>;

export async function createHandoffRouteDraft(tx: TenantClient, data: HandoffRouteCreate) {
  return tx.handoffRoute.create({ data: { ...data, updatedAt: new Date() } });
}

export async function updateHandoffRouteDraft(
  tx: TenantClient,
  id: string,
  data: HandoffRouteUpdate,
) {
  return tx.handoffRoute.update({ where: { id }, data: { ...data, updatedAt: new Date() } });
}

/** How many rows went — 0 when the route is not this workspace's. */
export async function deleteHandoffRouteDraft(tx: TenantClient, id: string): Promise<number> {
  const { count } = await tx.handoffRoute.deleteMany({ where: { id } });
  return count;
}

// Knowledge sources (tm 309.1–309.2 · AI-14, `docs/adr/single-knowledge-store.md`):
// one store for the AI agent and Copilot, told apart by who a source is for —
// `audiences`, `ai_agent_ids`, `brand_ids`, `valid_until` — which retrieval
// reads since tm 309.2. A source is still filed under an agent record
// (`ai_agent_id`, required until the contract step) and the filing follows the
// scope (ADR §2.8.2, {@link knowledgeFilingOf}), so the release before this one,
// rolled back to, still keeps a source for agents only away from players. Two
// writers stay outside: `KnowledgeService.index`, the one writer of chunks,
// which marks the indexing `status` as it goes (ADR-14b §2.8), and the
// freshness sweep's re-crawl (`knowledge-refresh-sweep.ts`), a system refresh
// rather than an edit — tm 316 settles how either is versioned. A KB article's
// source (AI-14-S2) is written through its own two helpers below, by the
// article's sync (`kb-article-knowledge.ts`) alone.

type KnowledgeSourceCreate = Omit<
  Prisma.KnowledgeSourceUncheckedCreateInput,
  'updatedAt' | 'aiAgentId' | 'audiences' | 'aiAgentIds' | 'reviewedAt' | 'kbArticleId'
>;
type KnowledgeSourceUpdate = Omit<
  Prisma.KnowledgeSourceUncheckedUpdateManyInput,
  'updatedAt' | 'aiAgentId' | 'audiences' | 'aiAgentIds' | 'reviewedAt' | 'kbArticleId'
>;

/** The agent record a source is filed under. */
export interface KnowledgeFiling {
  id: string;
  kind: string;
}

/** Who a source is for by audience and AI agent — what its filing follows. */
export interface KnowledgeAudienceScope {
  audiences: KnowledgeAudience[];
  /** `kind = 'ai_agent'` records only, checked by the writer; empty: every one. */
  aiAgentIds: string[];
}

/**
 * Who a source filed under `agent` is for, in the store's terms — ADR §2.8's
 * mapping, the one 20261021000000's backfill applies to the older rows, and a
 * write's scope when its request names none. An AI agent's source is for the
 * AI's answers and Copilot, that agent alone; any other record's (Copilot's)
 * is for agents only, so a kind this does not know can never put a source in
 * front of a player.
 */
export function knowledgeScopeOfFiling(agent: KnowledgeFiling): KnowledgeAudienceScope {
  return agent.kind === 'ai_agent'
    ? { audiences: ['ai_agent', 'copilot'], aiAgentIds: [agent.id] }
    : { audiences: ['copilot'], aiAgentIds: [] };
}

/**
 * The workspace's Copilot record — the oldest, made on first use (FR-MOD-12),
 * so filing a source for agents only never fails on setup order.
 */
export async function ensureCopilotAgentId(tx: TenantClient, licenseId: bigint): Promise<string> {
  const existing = await tx.aiAgent.findFirst({
    where: { kind: 'copilot' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.aiAgent.create({
    data: { licenseId, kind: 'copilot', name: 'Copilot', active: true },
    select: { id: true },
  });
  return created.id;
}

/**
 * The record a source of `scope` is filed under (ADR §2.8.2) — what a release
 * reading `ai_agent_id` instead of the scope sees. For agents only: the
 * Copilot record. Anything the AI agent may use: its first AI agent, else the
 * workspace's oldest. A workspace with no AI agent files it under Copilot —
 * the safe direction for that older release, which then shows it to agents
 * and never to a player, and there is no AI agent to answer one anyway.
 */
export async function knowledgeFilingOf(
  tx: TenantClient,
  licenseId: bigint,
  scope: KnowledgeAudienceScope,
): Promise<string> {
  if (scope.audiences.includes('ai_agent')) {
    const named = scope.aiAgentIds[0];
    if (named !== undefined) return named;
    const oldest = await tx.aiAgent.findFirst({
      where: { kind: 'ai_agent' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (oldest) return oldest.id;
  }
  return ensureCopilotAgentId(tx, licenseId);
}

/** A new source counts as reviewed the moment it is added (AI-14-S3). */
export async function createKnowledgeSourceDraft(
  tx: TenantClient,
  scope: KnowledgeAudienceScope,
  data: KnowledgeSourceCreate,
) {
  const at = new Date();
  return tx.knowledgeSource.create({
    data: {
      ...data,
      ...scope,
      aiAgentId: await knowledgeFilingOf(tx, BigInt(data.licenseId), scope),
      reviewedAt: at,
      updatedAt: at,
    },
  });
}

/**
 * How many rows changed — 0 when the source is not this workspace's or has
 * gone. `at` is the moment the caller counts from (a refresh schedule), so the
 * row's `updated_at` and what was computed from it agree. `rescope` moves who
 * the source is for by audience and AI agent, and its filing with it.
 */
export async function updateKnowledgeSourceDraft(
  tx: TenantClient,
  id: string,
  data: KnowledgeSourceUpdate,
  at: Date = new Date(),
  rescope?: { licenseId: bigint; scope: KnowledgeAudienceScope },
): Promise<number> {
  const filed = rescope
    ? {
        ...rescope.scope,
        aiAgentId: await knowledgeFilingOf(tx, rescope.licenseId, rescope.scope),
      }
    : {};
  const { count } = await tx.knowledgeSource.updateMany({
    where: { id },
    data: { ...data, ...filed, updatedAt: at },
  });
  return count;
}

/**
 * A person confirmed the source still holds (AI-14-S3): its review moves to
 * `at`. A meta write (ADR-14b §2.2) — nothing the AI says changes — yet a
 * write, so `updated_at` moves with it. With the KB article sync's, the only
 * writers of `reviewed_at`.
 */
export async function reviewKnowledgeSourceDraft(
  tx: TenantClient,
  id: string,
  at: Date = new Date(),
): Promise<number> {
  const { count } = await tx.knowledgeSource.updateMany({
    where: { id },
    data: { reviewedAt: at, updatedAt: at },
  });
  return count;
}

/**
 * How many rows went — 0 when the source is not this workspace's, or not
 * `within` when that is given (the Copilot view removes only the sources for
 * agents only). The chunks go with it.
 */
export async function deleteKnowledgeSourceDraft(
  tx: TenantClient,
  id: string,
  within: Prisma.KnowledgeSourceWhereInput = {},
): Promise<number> {
  const { count } = await tx.knowledgeSource.deleteMany({ where: { ...within, id } });
  return count;
}

/**
 * What a published KB article puts in the store (AI-14-S2): the article's own
 * title, text and audiences. The article's publish or edit is the source's
 * review (ADR §2.6), so `reviewedAt` is the article's `updated_at`.
 */
export interface KbArticleSourceFields {
  name: string;
  content: string;
  audiences: KnowledgeAudience[];
  reviewedAt: Date;
}

/**
 * The source a published article becomes — for every AI agent and every
 * brand, as the article is (the KB has no brand), and indexed by the caller in
 * the same transaction (`KnowledgeService.index`). `pending` says why its text
 * is not being indexed now (the sweep indexes it later); it stays `indexing`.
 */
export async function createKbArticleSourceDraft(
  tx: TenantClient,
  article: { licenseId: bigint; id: string; createdBy: string | null },
  fields: KbArticleSourceFields,
  pending: string | null = null,
) {
  const scope: KnowledgeAudienceScope = { audiences: fields.audiences, aiAgentIds: [] };
  return tx.knowledgeSource.create({
    data: {
      licenseId: article.licenseId,
      kbArticleId: article.id,
      type: 'article',
      status: 'indexing',
      lastRefreshError: pending,
      addedBy: article.createdBy,
      name: fields.name,
      content: fields.content,
      ...scope,
      aiAgentId: await knowledgeFilingOf(tx, article.licenseId, scope),
      reviewedAt: fields.reviewedAt,
      updatedAt: new Date(),
    },
  });
}

/**
 * The article changed: its source takes the article's title, text and
 * audiences; its meta fields (owner, language, review interval) are the
 * store's and stay. `pending` as on create — the caller has taken the
 * source's chunks away first (`KnowledgeService.unindex`), so it answers
 * nothing the article no longer says.
 */
export async function updateKbArticleSourceDraft(
  tx: TenantClient,
  source: { id: string; licenseId: bigint },
  fields: KbArticleSourceFields,
  pending: string | null = null,
): Promise<number> {
  const scope: KnowledgeAudienceScope = { audiences: fields.audiences, aiAgentIds: [] };
  const { count } = await tx.knowledgeSource.updateMany({
    where: { id: source.id },
    data: {
      name: fields.name,
      content: fields.content,
      ...scope,
      aiAgentId: await knowledgeFilingOf(tx, source.licenseId, scope),
      reviewedAt: fields.reviewedAt,
      lastRefreshError: pending,
      ...(pending === null ? {} : { status: 'indexing' }),
      updatedAt: new Date(),
    },
  });
  return count;
}

// Structured knowledge tables (tm 310.2 · AI-13, ADR-14b §2.12): the four
// tables' rows are editing tables like any above — no publish state, written
// here, copied into the package once tm 316 versions it (and then always
// behind the configuration's approval, never the fast path, §2.10). Each row
// is mirrored by one knowledge source (`type = 'table_row'`, AI-13 coding
// logic 3) that `services/knowledge-tables/row-knowledge.ts` alone writes,
// through the two source helpers at the end; a row's delete takes its source
// in the same transaction.

/** The row as written: the table's columns in Prisma's terms (`records.ts` `knowledgeTableDataOf`). */
type KnowledgeTableRowData = Record<string, unknown>;

/**
 * A new row, reviewed the moment it is added (AI-13-S2, as a knowledge
 * source is — AI-14-S3); `by` is who added it.
 */
export async function createKnowledgeTableRowDraft<T extends KnowledgeTable>(
  tx: TenantClient,
  table: T,
  licenseId: bigint,
  data: KnowledgeTableRowData,
  by: string | null,
): Promise<KnowledgeTableRecords[T]> {
  const at = new Date();
  return (await knowledgeTableDelegate(tx, table).create({
    data: {
      ...data,
      licenseId,
      createdBy: by,
      updatedBy: by,
      reviewedAt: at,
      updatedAt: at,
    },
  })) as KnowledgeTableRecords[T];
}

/**
 * How many rows changed — 0 when the row is not this workspace's. An edit is
 * not a review: `reviewed_at` stays.
 */
export async function updateKnowledgeTableRowDraft(
  tx: TenantClient,
  table: KnowledgeTable,
  id: string,
  data: KnowledgeTableRowData,
  by: string | null,
): Promise<number> {
  const { count } = await knowledgeTableDelegate(tx, table).updateMany({
    where: { id },
    data: { ...data, updatedBy: by, updatedAt: new Date() },
  });
  return count;
}

/**
 * "Gözden geçirdim" (AI-13-S2): the row's review moves to `at`. A meta write
 * (§2.2) — nothing the AI says changes — yet a write, so `updated_at` moves.
 */
export async function reviewKnowledgeTableRowDraft(
  tx: TenantClient,
  table: KnowledgeTable,
  id: string,
  by: string | null,
  at: Date = new Date(),
): Promise<number> {
  const { count } = await knowledgeTableDelegate(tx, table).updateMany({
    where: { id },
    data: { reviewedAt: at, updatedBy: by, updatedAt: at },
  });
  return count;
}

/** How many rows went — 0 when the row is not this workspace's. Its knowledge source and chunks go with it. */
export async function deleteKnowledgeTableRowDraft(
  tx: TenantClient,
  table: KnowledgeTable,
  id: string,
): Promise<number> {
  const { count } = await knowledgeTableDelegate(tx, table).deleteMany({ where: { id } });
  await tx.knowledgeSource.deleteMany({
    where: { sourceTable: KNOWLEDGE_TABLE_SQL_NAMES[table], sourceRowId: id },
  });
  return count;
}

/**
 * What a row's knowledge source holds (AI-13 coding logic 3): the row's
 * label and Turkish text, and its meta fields — the row's brands, owner and
 * review (the store's badge and the AI-14 filters read the source), a bonus's
 * campaign end as the source's end. For the AI and Copilot, every AI agent.
 */
export interface TableRowSourceFields {
  name: string;
  content: string;
  brandIds: string[];
  ownerId: string | null;
  reviewedAt: Date;
  reviewIntervalDays: number;
  validUntil: Date | null;
  addedBy: string | null;
}

/**
 * Who a row's source is for: the AI's answers and Copilot ("Copilot da aynı
 * veriyi kullanır", AI-13), every AI agent — a workspace has one set of tables.
 */
export const TABLE_ROW_SOURCE_SCOPE: KnowledgeAudienceScope = {
  audiences: ['ai_agent', 'copilot'],
  aiAgentIds: [],
};

/**
 * The source a row becomes, indexed by the caller in the same transaction
 * (`KnowledgeService.index`). `pending` says why its text is not indexed now
 * (the sweep indexes it later); it stays `indexing`.
 */
export async function createTableRowSourceDraft(
  tx: TenantClient,
  row: { licenseId: bigint; table: KnowledgeTable; id: string },
  fields: TableRowSourceFields,
  pending: string | null = null,
) {
  return tx.knowledgeSource.create({
    data: {
      licenseId: row.licenseId,
      type: KNOWLEDGE_TABLE_SOURCE_TYPE,
      sourceTable: KNOWLEDGE_TABLE_SQL_NAMES[row.table],
      sourceRowId: row.id,
      status: 'indexing',
      lastRefreshError: pending,
      ...fields,
      ...TABLE_ROW_SOURCE_SCOPE,
      aiAgentId: await knowledgeFilingOf(tx, row.licenseId, TABLE_ROW_SOURCE_SCOPE),
      updatedAt: new Date(),
    },
  });
}

/**
 * The row changed: its source takes what the row says now. `pending` as on
 * create — the caller has taken the source's chunks away first
 * (`KnowledgeService.unindex`), so it answers nothing the row no longer says.
 */
export async function updateTableRowSourceDraft(
  tx: TenantClient,
  source: { id: string; licenseId: bigint },
  fields: TableRowSourceFields,
  pending: string | null = null,
): Promise<number> {
  const { count } = await tx.knowledgeSource.updateMany({
    where: { id: source.id },
    data: {
      ...fields,
      ...TABLE_ROW_SOURCE_SCOPE,
      aiAgentId: await knowledgeFilingOf(tx, source.licenseId, TABLE_ROW_SOURCE_SCOPE),
      lastRefreshError: pending,
      ...(pending === null ? {} : { status: 'indexing' }),
      updatedAt: new Date(),
    },
  });
  return count;
}
