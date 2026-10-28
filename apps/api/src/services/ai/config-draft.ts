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
 * §2.5 step 1: it stamps the row's `updated_at` — for skills (tm 296.2),
 * behaviour rules (tm 299.1) and the guardrail settings, rules and forbidden
 * phrases (tm 301.2), the hand-over rules (tm 303.3), the hand-over routes
 * (tm 307.1), the knowledge sources (tm 309.1; a KB article's from tm 309.2),
 * the structured knowledge tables' rows with their sources (tm 310.2), the
 * access information (tm 310.4) and the agent's own persona row (tm 315).
 * A route that writes `updated_at` itself, or opens a `status`/`version`
 * column, breaks the rule.
 *
 * §2.5 step 3 (tm 315 · AI-21): every helper takes the change's author and
 * records the save in `ai_config_changes` and the audit log, in the same
 * transaction (`config-history.ts` `recordChange`) — the row before, read
 * `FOR UPDATE`, and after. One save is one row. Two kinds of write are not
 * recorded, each said where it is: a mirror (a KB article's or a table row's
 * knowledge source, whose own change is recorded on the article or the row)
 * and a write that is part of a save already recorded (the positions a
 * delete closes up, a template's example marking).
 */
import type { Prisma } from '@prisma/client';
import {
  KNOWLEDGE_TABLE_SAMPLE_SOURCE,
  KNOWLEDGE_TABLE_SOURCE_TYPE,
  KNOWLEDGE_TABLE_SQL_NAMES,
  type AiConfigChangeAction,
  type AiConfigEntityType,
  type KnowledgeAudience,
  type KnowledgeTable,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import { knowledgeTableDelegate, type KnowledgeTableRecords } from '../knowledge-tables/rows.js';
import {
  type ConfigChangeAuthor,
  type ConfigTable,
  recordChange,
  skillEntityType,
  snapshotConfigRow,
  snapshotConfigRows,
} from './config-history.js';

/** Which history entity a row of `table` is. */
function entityTypeOf(table: ConfigTable, row: Record<string, unknown>): AiConfigEntityType {
  switch (table) {
    case 'ai_agents':
      return 'persona';
    case 'skills':
      return skillEntityType(row);
    case 'ai_guidance_rules':
      return 'guidance_rule';
    case 'ai_guardrail_settings':
    case 'ai_guardrail_rules':
    case 'ai_forbidden_phrases':
      return 'guardrail';
    case 'ai_handoff_settings':
    case 'ai_handoff_rules':
      return 'handoff_rule';
    case 'handoff_routes':
      return 'handoff_route';
    case 'knowledge_sources':
      return 'knowledge_source';
    case 'ai_access_info':
      return 'access_info';
    default:
      return 'knowledge_table_row';
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** The agent a row reaches: its own id for the agent's row, else its `ai_agent_id`. */
function agentOf(table: ConfigTable, row: Record<string, unknown>): string | null {
  if (table === 'ai_agents') return text(row['id']);
  return text(row['ai_agent_id']);
}

interface TrackOptions<T> {
  /** The new row's id, for a creation (`key` null). */
  idOf?: (result: T) => string;
  /** The write removes the row: there is no "after". */
  deleted?: boolean;
  note?: string | null;
  /** The action when it is not plain created/updated/deleted (pause, resume). */
  actionOf?: (
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ) => AiConfigChangeAction | null;
}

/**
 * Run one write of `table` and record it: the row before (`key`, locked),
 * the write, the row after. A write that reached no row of this workspace
 * (before and after both missing) records nothing; neither does an update
 * that changed no configuration (`recordChange`).
 */
async function track<T>(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  table: ConfigTable,
  key: string | null,
  write: () => Promise<T>,
  options: TrackOptions<T> = {},
): Promise<T> {
  const before = key === null ? null : await snapshotConfigRow(tx, table, key, { lock: true });
  const result = await write();
  const id = key ?? options.idOf?.(result);
  if (id === undefined) throw new Error(`a created ${table} row needs its id`);
  const after = options.deleted ? null : await snapshotConfigRow(tx, table, id);
  const row = after ?? before;
  if (row === null) return result;
  const action =
    options.actionOf?.(before, after) ??
    (before === null ? 'created' : after === null ? 'deleted' : 'updated');
  await recordChange(tx, author, {
    entityType: entityTypeOf(table, row),
    entityId: text(row['id']) ?? id,
    aiAgentId: agentOf(table, row),
    action,
    before,
    after,
    note: options.note ?? null,
  });
  return result;
}

const idOfRow = (row: { id: string }): string => row.id;

// The agent's own row (tm 315): its persona, tone, languages, name and the
// pause switch. `active` is read live and never versioned (ADR-14b §2.2), yet
// switching it is a change like any other — recorded as `paused`/`resumed`.

type AiAgentCreate = Prisma.AiAgentUncheckedCreateInput;
type AiAgentUpdate = Prisma.AiAgentUncheckedUpdateInput;

export async function createAiAgentDraft<I extends Prisma.AiAgentInclude>(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  data: AiAgentCreate,
  include: I,
) {
  return track(tx, author, 'ai_agents', null, () => tx.aiAgent.create({ data, include }), {
    idOf: idOfRow,
  });
}

function pauseAction(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AiConfigChangeAction | null {
  if (!before || !after || before['active'] === after['active']) return null;
  return after['active'] === true ? 'resumed' : 'paused';
}

export async function updateAiAgentDraft<I extends Prisma.AiAgentInclude>(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  id: string,
  data: AiAgentUpdate,
  include: I,
) {
  return track(
    tx,
    author,
    'ai_agents',
    id,
    () => tx.aiAgent.update({ where: { id }, data, include }),
    { actionOf: pauseAction },
  );
}

type SkillCreate = Omit<Prisma.SkillUncheckedCreateInput, 'updatedAt'>;
type SkillUpdate = Omit<Prisma.SkillUncheckedUpdateInput, 'updatedAt'>;

export async function createSkillDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  data: SkillCreate,
) {
  return track(
    tx,
    author,
    'skills',
    null,
    () => tx.skill.create({ data: { ...data, updatedAt: new Date() } }),
    { idOf: idOfRow },
  );
}

export async function updateSkillDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  id: string,
  data: SkillUpdate,
  note: string | null = null,
) {
  return track(
    tx,
    author,
    'skills',
    id,
    () => tx.skill.update({ where: { id }, data: { ...data, updatedAt: new Date() } }),
    { note },
  );
}

/** How many rows went — 0 when the skill is not this workspace's. The history keeps it whole. */
export async function deleteSkillDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  id: string,
): Promise<number> {
  return track(
    tx,
    author,
    'skills',
    id,
    async () => (await tx.skill.deleteMany({ where: { id } })).count,
    { deleted: true },
  );
}

type GuidanceRuleCreate = Omit<Prisma.AiGuidanceRuleUncheckedCreateInput, 'updatedAt'>;
type GuidanceRuleUpdate = Omit<Prisma.AiGuidanceRuleUncheckedUpdateInput, 'updatedAt'>;

/** A behaviour rule (tm 299.1 · AI-07) — the same one door as a skill. */
export async function createGuidanceRuleDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  data: GuidanceRuleCreate,
) {
  return track(
    tx,
    author,
    'ai_guidance_rules',
    null,
    () => tx.aiGuidanceRule.create({ data: { ...data, updatedAt: new Date() } }),
    { idOf: idOfRow },
  );
}

export async function updateGuidanceRuleDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  id: string,
  data: GuidanceRuleUpdate,
) {
  return track(tx, author, 'ai_guidance_rules', id, () =>
    tx.aiGuidanceRule.update({ where: { id }, data: { ...data, updatedAt: new Date() } }),
  );
}

/** How many rows went — 0 when the rule is not this workspace's. */
export async function deleteGuidanceRuleDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  id: string,
): Promise<number> {
  return track(
    tx,
    author,
    'ai_guidance_rules',
    id,
    async () => (await tx.aiGuidanceRule.deleteMany({ where: { id } })).count,
    { deleted: true },
  );
}

// Compliance guardrails (tm 301.2 · AI-08). A change to any of these touches
// compliance: tm 316 asks the Founder to approve the version that carries it.

type GuardrailSettingsCreate = Omit<Prisma.AiGuardrailSettingsUncheckedCreateInput, 'updatedAt'>;
type GuardrailSettingsUpdate = Omit<Prisma.AiGuardrailSettingsUncheckedUpdateInput, 'updatedAt'>;

/** An agent's guardrail settings — the row is made on its first write. */
export async function upsertGuardrailSettingsDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  create: GuardrailSettingsCreate,
  update: GuardrailSettingsUpdate,
) {
  const updatedAt = new Date();
  return track(tx, author, 'ai_guardrail_settings', create.aiAgentId, () =>
    tx.aiGuardrailSettings.upsert({
      where: { aiAgentId: create.aiAgentId },
      create: { ...create, updatedAt },
      update: { ...update, updatedAt },
    }),
  );
}

type GuardrailRuleCreate = Omit<Prisma.AiGuardrailRuleUncheckedCreateInput, 'updatedAt'>;
type GuardrailRuleUpdate = Omit<Prisma.AiGuardrailRuleUncheckedUpdateInput, 'updatedAt'>;

export async function createGuardrailRuleDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  data: GuardrailRuleCreate,
) {
  return track(
    tx,
    author,
    'ai_guardrail_rules',
    null,
    () => tx.aiGuardrailRule.create({ data: { ...data, updatedAt: new Date() } }),
    { idOf: idOfRow },
  );
}

export async function updateGuardrailRuleDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  id: string,
  data: GuardrailRuleUpdate,
) {
  return track(tx, author, 'ai_guardrail_rules', id, () =>
    tx.aiGuardrailRule.update({ where: { id }, data: { ...data, updatedAt: new Date() } }),
  );
}

/** How many rows went — 0 when the rule is not this workspace's. */
export async function deleteGuardrailRuleDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  id: string,
): Promise<number> {
  return track(
    tx,
    author,
    'ai_guardrail_rules',
    id,
    async () => (await tx.aiGuardrailRule.deleteMany({ where: { id } })).count,
    { deleted: true },
  );
}

type ForbiddenPhraseCreate = Omit<Prisma.AiForbiddenPhraseUncheckedCreateInput, 'updatedAt'>;
type ForbiddenPhraseUpdate = Omit<Prisma.AiForbiddenPhraseUncheckedUpdateInput, 'updatedAt'>;

export async function createForbiddenPhraseDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  data: ForbiddenPhraseCreate,
) {
  return track(
    tx,
    author,
    'ai_forbidden_phrases',
    null,
    () => tx.aiForbiddenPhrase.create({ data: { ...data, updatedAt: new Date() } }),
    { idOf: idOfRow },
  );
}

export async function updateForbiddenPhraseDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  id: string,
  data: ForbiddenPhraseUpdate,
) {
  return track(tx, author, 'ai_forbidden_phrases', id, () =>
    tx.aiForbiddenPhrase.update({ where: { id }, data: { ...data, updatedAt: new Date() } }),
  );
}

/** How many rows went — 0 when the phrase is not this workspace's. */
export async function deleteForbiddenPhraseDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  id: string,
): Promise<number> {
  return track(
    tx,
    author,
    'ai_forbidden_phrases',
    id,
    async () => (await tx.aiForbiddenPhrase.deleteMany({ where: { id } })).count,
    { deleted: true },
  );
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
  author: ConfigChangeAuthor,
  create: HandoffSettingsCreate,
  update: HandoffSettingsUpdate,
  select: S,
) {
  return track(tx, author, 'ai_handoff_settings', create.aiAgentId, () =>
    tx.aiHandoffSettings.upsert({
      where: { aiAgentId: create.aiAgentId },
      create,
      update,
      select,
    }),
  );
}

// Hand-over rules (tm 303.3 · AI-09, K9). Their order is behaviour — the first
// active rule that matches decides — so a reorder is a write like any other.

type HandoffRuleCreate = Omit<Prisma.AiHandoffRuleUncheckedCreateInput, 'updatedAt'>;
type HandoffRuleUpdate = Omit<Prisma.AiHandoffRuleUncheckedUpdateInput, 'updatedAt'>;

export async function createHandoffRuleDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  data: HandoffRuleCreate,
) {
  return track(
    tx,
    author,
    'ai_handoff_rules',
    null,
    () => tx.aiHandoffRule.create({ data: { ...data, updatedAt: new Date() } }),
    { idOf: idOfRow },
  );
}

export async function updateHandoffRuleDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  id: string,
  data: HandoffRuleUpdate,
) {
  return track(tx, author, 'ai_handoff_rules', id, () =>
    tx.aiHandoffRule.update({ where: { id }, data: { ...data, updatedAt: new Date() } }),
  );
}

/** How many rows went — 0 when the rule is not this workspace's. */
export async function deleteHandoffRuleDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  id: string,
): Promise<number> {
  return track(
    tx,
    author,
    'ai_handoff_rules',
    id,
    async () => (await tx.aiHandoffRule.deleteMany({ where: { id } })).count,
    { deleted: true },
  );
}

/**
 * Positions 1…n in the order given; the caller has checked the ids are the
 * agent's, all of them. One change for the whole order, filed under the
 * agent (`entity_id`): before and after are the rule ids in order. `author`
 * null: the positions a delete closes up, part of a save already recorded.
 */
export async function reorderHandoffRulesDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor | null,
  orderedIds: readonly string[],
  updatedBy: string | null,
): Promise<void> {
  const rows = author ? await snapshotConfigRows(tx, 'ai_handoff_rules', orderedIds) : null;
  const updatedAt = new Date();
  for (const [index, id] of orderedIds.entries()) {
    await tx.aiHandoffRule.update({
      where: { id },
      data: { position: index + 1, updatedBy, updatedAt },
    });
  }
  if (!author || !rows) return;
  const first = rows.get(orderedIds[0] ?? '');
  const agentId = first ? text(first['ai_agent_id']) : null;
  if (agentId === null) return;
  const before = [...rows.values()]
    .sort((a, b) => Number(a['position']) - Number(b['position']))
    .map((row) => String(row['id']));
  await recordChange(tx, author, {
    entityType: 'handoff_rule',
    entityId: agentId,
    aiAgentId: agentId,
    action: 'updated',
    before: { order: before },
    after: { order: [...orderedIds] },
    note: 'reorder',
  });
}

// Hand-over routes (tm 307.1 · AI-12, shared with AU-01). Human routing reads
// them live; the AI's hand-over target is versioned with the package
// (ADR-14b §2.12), so they are written here like any editing table.

type HandoffRouteCreate = Omit<Prisma.HandoffRouteUncheckedCreateInput, 'updatedAt'>;
type HandoffRouteUpdate = Omit<Prisma.HandoffRouteUncheckedUpdateInput, 'updatedAt'>;

export async function createHandoffRouteDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  data: HandoffRouteCreate,
) {
  return track(
    tx,
    author,
    'handoff_routes',
    null,
    () => tx.handoffRoute.create({ data: { ...data, updatedAt: new Date() } }),
    { idOf: idOfRow },
  );
}

export async function updateHandoffRouteDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  id: string,
  data: HandoffRouteUpdate,
) {
  return track(tx, author, 'handoff_routes', id, () =>
    tx.handoffRoute.update({ where: { id }, data: { ...data, updatedAt: new Date() } }),
  );
}

/** How many rows went — 0 when the route is not this workspace's. */
export async function deleteHandoffRouteDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  id: string,
): Promise<number> {
  return track(
    tx,
    author,
    'handoff_routes',
    id,
    async () => (await tx.handoffRoute.deleteMany({ where: { id } })).count,
    { deleted: true },
  );
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
 * so filing a source for agents only never fails on setup order. Setup, not a
 * configuration change: not recorded.
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
  author: ConfigChangeAuthor,
  scope: KnowledgeAudienceScope,
  data: KnowledgeSourceCreate,
) {
  const at = new Date();
  const aiAgentId = await knowledgeFilingOf(tx, BigInt(data.licenseId), scope);
  return track(
    tx,
    author,
    'knowledge_sources',
    null,
    () =>
      tx.knowledgeSource.create({
        data: { ...data, ...scope, aiAgentId, reviewedAt: at, updatedAt: at },
      }),
    { idOf: idOfRow },
  );
}

/**
 * How many rows changed — 0 when the source is not this workspace's or has
 * gone. `at` is the moment the caller counts from (a refresh schedule), so the
 * row's `updated_at` and what was computed from it agree. `rescope` moves who
 * the source is for by audience and AI agent, and its filing with it. `note`
 * says what the save was when it is not an edit (`reindex`).
 */
export async function updateKnowledgeSourceDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  id: string,
  data: KnowledgeSourceUpdate,
  at: Date = new Date(),
  rescope?: { licenseId: bigint; scope: KnowledgeAudienceScope },
  note: string | null = null,
): Promise<number> {
  const filed = rescope
    ? {
        ...rescope.scope,
        aiAgentId: await knowledgeFilingOf(tx, rescope.licenseId, rescope.scope),
      }
    : {};
  return track(
    tx,
    author,
    'knowledge_sources',
    id,
    async () =>
      (
        await tx.knowledgeSource.updateMany({
          where: { id },
          data: { ...data, ...filed, updatedAt: at },
        })
      ).count,
    { note },
  );
}

/**
 * A person confirmed the source still holds (AI-14-S3): its review moves to
 * `at`. A meta write (ADR-14b §2.2) — nothing the AI says changes — yet a
 * write, so `updated_at` moves with it and the history records it. With the
 * KB article sync's, the only writers of `reviewed_at`.
 */
export async function reviewKnowledgeSourceDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  id: string,
  at: Date = new Date(),
): Promise<number> {
  return track(
    tx,
    author,
    'knowledge_sources',
    id,
    async () =>
      (
        await tx.knowledgeSource.updateMany({
          where: { id },
          data: { reviewedAt: at, updatedAt: at },
        })
      ).count,
  );
}

/**
 * How many rows went — 0 when the source is not this workspace's, or not
 * `within` when that is given (the Copilot view removes only the sources for
 * agents only). The chunks go with it. `author` null: a mirror's source (a KB
 * article's, a table row's) going with what it mirrors — recorded there.
 */
export async function deleteKnowledgeSourceDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor | null,
  id: string,
  within: Prisma.KnowledgeSourceWhereInput = {},
): Promise<number> {
  const remove = async () =>
    (await tx.knowledgeSource.deleteMany({ where: { ...within, id } })).count;
  if (author === null) return remove();
  const inScope = await tx.knowledgeSource.count({ where: { ...within, id } });
  if (inScope === 0) return 0;
  return track(tx, author, 'knowledge_sources', id, remove, { deleted: true });
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
 * A mirror of the article: the article's publish is its record
 * (`kb.article_published`), so this writes no history row.
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
 * nothing the article no longer says. A mirror, as on create.
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
// in the same transaction. The history records the row; its mirror is not
// recorded again.

/** The row as written: the table's columns in Prisma's terms (`records.ts` `knowledgeTableDataOf`). */
type KnowledgeTableRowData = Record<string, unknown>;

/**
 * A new row, reviewed the moment it is added (AI-13-S2, as a knowledge
 * source is — AI-14-S3); `by` is who added it.
 */
export async function createKnowledgeTableRowDraft<T extends KnowledgeTable>(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  table: T,
  licenseId: bigint,
  data: KnowledgeTableRowData,
  by: string | null,
): Promise<KnowledgeTableRecords[T]> {
  const at = new Date();
  return track(
    tx,
    author,
    KNOWLEDGE_TABLE_SQL_NAMES[table],
    null,
    async () =>
      (await knowledgeTableDelegate(tx, table).create({
        data: {
          ...data,
          licenseId,
          createdBy: by,
          updatedBy: by,
          reviewedAt: at,
          updatedAt: at,
        },
      })) as KnowledgeTableRecords[T],
    { idOf: (row) => (row as { id: string }).id },
  );
}

/**
 * How many rows changed — 0 when the row is not this workspace's. An edit is
 * not a review: `reviewed_at` stays. `confirmSample` turns an example row
 * into the workspace's own in the same save (AI-15-S1).
 */
export async function updateKnowledgeTableRowDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  table: KnowledgeTable,
  id: string,
  data: KnowledgeTableRowData,
  by: string | null,
  options: { confirmSample?: boolean } = {},
): Promise<number> {
  return track(tx, author, KNOWLEDGE_TABLE_SQL_NAMES[table], id, async () => {
    const { count } = await knowledgeTableDelegate(tx, table).updateMany({
      where: { id },
      data: { ...data, updatedBy: by, updatedAt: new Date() },
    });
    if (options.confirmSample) await confirmKnowledgeTableSampleRowDraft(tx, table, id);
    return count;
  });
}

/**
 * "Gözden geçirdim" (AI-13-S2): the row's review moves to `at`. A meta write
 * (§2.2) — nothing the AI says changes — yet a write, so `updated_at` moves
 * and the history records it. `confirmSample` as on update.
 */
export async function reviewKnowledgeTableRowDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  table: KnowledgeTable,
  id: string,
  by: string | null,
  at: Date = new Date(),
  options: { confirmSample?: boolean } = {},
): Promise<number> {
  return track(tx, author, KNOWLEDGE_TABLE_SQL_NAMES[table], id, async () => {
    const { count } = await knowledgeTableDelegate(tx, table).updateMany({
      where: { id },
      data: { reviewedAt: at, updatedBy: by, updatedAt: at },
    });
    if (count > 0 && options.confirmSample) {
      await confirmKnowledgeTableSampleRowDraft(tx, table, id);
    }
    return count;
  });
}

/**
 * A template pack's rows become "örnek — doğrulayın" (`source = 'sample'`,
 * AI-15-S1): written by the tables' writer, then marked, in one transaction.
 * Part of the install's save — each row's creation is its record — so this
 * writes no history row of its own.
 */
export async function markKnowledgeTableRowsSampleDraft(
  tx: TenantClient,
  table: KnowledgeTable,
  ids: readonly string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const { count } = await knowledgeTableDelegate(tx, table).updateMany({
    where: { id: { in: [...ids] } },
    data: { source: KNOWLEDGE_TABLE_SAMPLE_SOURCE, updatedAt: new Date() },
  });
  return count;
}

/**
 * A person edited or reviewed an example row: it is the workspace's own now
 * (`manual`) and the AI reads it. A row that is no example is left alone.
 * Inside the edit's or review's own save (their `confirmSample`).
 */
async function confirmKnowledgeTableSampleRowDraft(
  tx: TenantClient,
  table: KnowledgeTable,
  id: string,
): Promise<number> {
  const { count } = await knowledgeTableDelegate(tx, table).updateMany({
    where: { id, source: KNOWLEDGE_TABLE_SAMPLE_SOURCE },
    data: { source: 'manual' },
  });
  return count;
}

/**
 * How many rows went — 0 when the row is not this workspace's. Its knowledge
 * source and chunks go with it; the history keeps the row whole.
 */
export async function deleteKnowledgeTableRowDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  table: KnowledgeTable,
  id: string,
): Promise<number> {
  const count = await track(
    tx,
    author,
    KNOWLEDGE_TABLE_SQL_NAMES[table],
    id,
    async () => (await knowledgeTableDelegate(tx, table).deleteMany({ where: { id } })).count,
    { deleted: true },
  );
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
 * (the sweep indexes it later); it stays `indexing`. A mirror of the row,
 * whose own change is recorded: no history row.
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
 * A mirror, as on create.
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

// The access information (tm 310.4 · K13). What the panel writes is the
// draft; `last_value` / `last_fetched_at` are not — they are the fetch's cache
// (`knowledge-tables/access-info.ts`), written at run time and never a change.

type AccessInfoCreate = Omit<Prisma.AiAccessInfoUncheckedCreateInput, 'updatedAt'>;
type AccessInfoUpdate = Omit<Prisma.AiAccessInfoUncheckedUpdateInput, 'updatedAt'>;

export async function createAiAccessInfoDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  data: AccessInfoCreate,
) {
  return track(
    tx,
    author,
    'ai_access_info',
    null,
    () => tx.aiAccessInfo.create({ data: { ...data, updatedAt: new Date() } }),
    { idOf: idOfRow },
  );
}

export async function updateAiAccessInfoDraft(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  id: string,
  data: AccessInfoUpdate,
) {
  return track(tx, author, 'ai_access_info', id, () =>
    tx.aiAccessInfo.update({ where: { id }, data: { ...data, updatedAt: new Date() } }),
  );
}
