/**
 * Where a turn's configuration comes from (tm 292.2, tm 292.3 · ADR-14b §2.6).
 *
 * A turn never reads configuration tables itself: it is handed a
 * {@link TurnConfig}, and the one door it comes through is
 * {@link AiConfigSource} — `forTurn` for a conversation, `forDraft` for the
 * editor's preview. Until tm 316 pins a published package to every
 * conversation the implementation is "read and compile"
 * ({@link readAndCompile}): the live tables, read the moment the turn starts,
 * with no version (`versionId` and `seq` null). When versions exist only the
 * implementation changes; a new AI feature that reads a configuration table in
 * the turn directly goes around the seam (ADR-14b §2.6).
 *
 * The tenant is the transaction's: row level security decides the workspace,
 * so the seam takes no tenant beside it.
 */
import {
  FORBIDDEN_PHRASE_ACTIONS,
  FORBIDDEN_PHRASE_MATCHES,
  GUARDRAIL_CATEGORIES,
  GUARDRAIL_RULE_ACTIONS,
  PLATFORM_GUARDRAILS_VERSION,
  readBatchWindowSeconds,
  readClarifyThresholds,
  readDailyMemory,
  readGuidanceScope,
  readPersona,
  readPersonaStyle,
  type GuidanceCategory,
  type DailyMemorySettings,
  type SkillProcedureFields,
} from '@siyahtus/types';
import type { TenantClient } from '../../../lib/tenant.js';
import type {
  ForbiddenPhraseConfig,
  GuardrailConfig,
  GuardrailRuleConfig,
} from './guardrails/config.js';
import { orderGuidance, type GuidanceRuleConfig } from './guidance.js';
import { turnThresholds } from './policy.js';
import type { TurnConfig } from './turn.js';

/** A configuration as the seam returns it (ADR-14b §2.6). */
export interface AiConfigRead {
  /** The published version it is; null before versioning (tm 316) and for a draft. */
  readonly versionId: string | null;
  readonly pkg: TurnConfig;
  /** The version's number on its agent's line; null with `versionId`. */
  readonly seq: number | null;
}

/** What the editor previews: a one-message step list, or a procedure's fields. */
export interface DraftConfigInput {
  aiAgentId: string | null;
  steps: unknown;
  /** A procedure skill's definition, as `POST /skills` takes it; absent for a `single` one. */
  definition?: SkillProcedureFields;
}

/** The one read of the AI configuration a turn runs on (ADR-14b §2.6). */
export interface AiConfigSource {
  /**
   * A conversation's: the version it is pinned to, or — before versioning —
   * the live tables. `aiAgentId` narrows it to one agent's skills; null is
   * every active agent's, which is the live path today (one customer-facing
   * agent per workspace in v1, tm 390).
   */
  forTurn(
    tx: TenantClient,
    input: { aiAgentId: string | null; pinnedVersionId: string | null },
  ): Promise<AiConfigRead>;
  /**
   * The editor's: the unsaved steps — or a procedure's definition (tm
   * 296.4) — as one skill of the agent they belong to.
   */
  forDraft(tx: TenantClient, input: DraftConfigInput): Promise<AiConfigRead>;
}

/**
 * "Read and compile" (ADR-14b §2.6 (1)): the editing tables are the
 * configuration, so a pinned version id — none exists before tm 316 — has
 * nothing to select and is not read.
 */
export const readAndCompile: AiConfigSource = {
  async forTurn(tx, input) {
    return { versionId: null, pkg: await liveTurnConfig(tx, input.aiAgentId), seq: null };
  },
  async forDraft(tx, input) {
    return { versionId: null, pkg: await previewTurnConfig(tx, input), seq: null };
  },
};

/**
 * The live configuration: every active skill of an active AI agent (or of the
 * one named), the most recently edited first — the order the turn tries them in.
 */
async function liveTurnConfig(tx: TenantClient, aiAgentId: string | null): Promise<TurnConfig> {
  const skills = await tx.skill.findMany({
    where: {
      active: true,
      kind: 'ai_agent',
      aiAgent: { active: true },
      ...(aiAgentId ? { aiAgentId } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      steps: true,
      aiAgentId: true,
      // A procedure skill's definition (tm 296.3); the turn judges it.
      mode: true,
      whenToUse: true,
      examples: true,
      priority: true,
      slots: true,
      procedure: true,
      locked: true,
      isFallback: true,
      // The persona travels with the skill because it belongs to the agent
      // that owns it: two agents in one workspace answer in two voices, so
      // "which persona applies" is only decidable once a skill has been
      // picked (FR-MOD-06.4).
      aiAgent: { select: { tone: true, languages: true, persona: true } },
    },
  });
  const agentIds = aiAgentId
    ? [aiAgentId]
    : [...new Set(skills.flatMap((skill) => skill.aiAgentId ?? []))];
  const guidance = await activeGuidance(tx, agentIds);
  const guardrails = await activeGuardrails(tx, agentIds);
  const waits = skills
    .map((skill) => readBatchWindowSeconds(skill.aiAgent?.persona))
    .filter((seconds): seconds is number => seconds !== null);
  return {
    skills: skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      aiAgentId: skill.aiAgentId,
      steps: skill.steps,
      persona: readPersona(skill.aiAgent),
      style: readPersonaStyle(skill.aiAgent?.persona),
      ...(skill.isFallback ? { isFallback: true } : {}),
      ...(skill.mode === 'procedure'
        ? {
            mode: 'procedure' as const,
            definition: {
              when_to_use: skill.whenToUse,
              examples: skill.examples,
              priority: skill.priority,
              slots: skill.slots,
              procedure: skill.procedure,
            },
            locked: skill.locked,
          }
        : {}),
    })),
    // Unset stays absent, so a configuration nobody tuned is what it was.
    ...(waits.length > 0 ? { batchWindowSeconds: Math.max(...waits) } : {}),
    ...(skills.length > 0
      ? { dailyMemory: strictest(skills.map((skill) => readDailyMemory(skill.aiAgent?.persona))) }
      : {}),
    ...(skills.length > 0
      ? {
          clarifyThresholds: turnThresholds(
            skills.map((skill) => readClarifyThresholds(skill.aiAgent?.persona)),
          ),
        }
      : {}),
    ...(guidance.length > 0 ? { guidance } : {}),
    ...(guardrails ? { guardrails } : {}),
  };
}

/**
 * The agents' active behaviour rules (tm 299.1 · AI-07), most binding first —
 * the package's `guidance` (ADR-14b §2.4). A rule whose stored scope reads as
 * none of the three applies nowhere, so it is not carried.
 */
async function activeGuidance(
  tx: TenantClient,
  aiAgentIds: readonly string[],
): Promise<GuidanceRuleConfig[]> {
  if (aiAgentIds.length === 0) return [];
  const rows = await tx.aiGuidanceRule.findMany({
    where: { active: true, aiAgentId: { in: [...aiAgentIds] } },
    select: { id: true, aiAgentId: true, body: true, category: true, scope: true, priority: true },
  });
  return orderGuidance(
    rows.flatMap((row) => {
      const scope = readGuidanceScope(row.scope);
      return scope ? [{ ...row, category: row.category as GuidanceCategory, scope }] : [];
    }),
  );
}

/**
 * The agents' guardrail settings, active rules and active forbidden phrases
 * (tm 301.3 · AI-08) — the package's `guardrails` (ADR-14b §2.12) — or null
 * when the agents have none of them. A row whose stored value reads as
 * nothing the API writes (an action, a category, a scope) is not carried: the
 * CHECKs hold the first two, `readGuidanceScope` the third.
 */
async function activeGuardrails(
  tx: TenantClient,
  aiAgentIds: readonly string[],
): Promise<GuardrailConfig | null> {
  if (aiAgentIds.length === 0) return null;
  const agents = { in: [...aiAgentIds] };
  const settings = await tx.aiGuardrailSettings.findMany({
    where: { aiAgentId: agents },
    select: {
      aiAgentId: true,
      crisisText: true,
      complaintText: true,
      judgeEnabled: true,
      approvedAt: true,
    },
  });
  const rules = await tx.aiGuardrailRule.findMany({
    where: { active: true, aiAgentId: agents },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      aiAgentId: true,
      title: true,
      body: true,
      category: true,
      action: true,
      scope: true,
    },
  });
  const phrases = await tx.aiForbiddenPhrase.findMany({
    where: { active: true, aiAgentId: agents },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      aiAgentId: true,
      phrase: true,
      match: true,
      lang: true,
      scope: true,
      action: true,
    },
  });
  if (settings.length === 0 && rules.length === 0 && phrases.length === 0) return null;
  return {
    catalogVersion: PLATFORM_GUARDRAILS_VERSION,
    settings: settings.map((row) => ({
      aiAgentId: row.aiAgentId,
      crisisText: row.crisisText,
      crisisApproved: row.approvedAt !== null,
      complaintText: row.complaintText,
      judgeEnabled: row.judgeEnabled,
    })),
    rules: rules.flatMap((row): GuardrailRuleConfig[] => {
      const scope = readGuidanceScope(row.scope);
      if (!scope || !oneOf(row.action, GUARDRAIL_RULE_ACTIONS)) return [];
      if (!oneOf(row.category, GUARDRAIL_CATEGORIES)) return [];
      return [{ ...row, category: row.category, action: row.action, scope }];
    }),
    phrases: phrases.flatMap((row): ForbiddenPhraseConfig[] => {
      const scope = readGuidanceScope(row.scope);
      if (!scope || !oneOf(row.match, FORBIDDEN_PHRASE_MATCHES)) return [];
      if (!oneOf(row.action, FORBIDDEN_PHRASE_ACTIONS)) return [];
      return [{ ...row, match: row.match, action: row.action, scope }];
    }),
  };
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

/**
 * The same-day memory of several agents at once (tm 294): the turn picks its
 * skill only after the memory is read, so the setting that discloses least
 * applies — off if any agent turned it off, topic-only if any asked for it.
 */
function strictest(settings: readonly DailyMemorySettings[]): DailyMemorySettings {
  return {
    enabled: settings.every((setting) => setting.enabled),
    recall: settings.some((setting) => setting.recall === 'on_topic_only')
      ? 'on_topic_only'
      : 'auto_if_unresolved',
  };
}

/**
 * The editor preview's configuration (FR-MOD-06.2.5): the steps being edited,
 * as one unsaved skill, under the persona the live path would use for the
 * agent it belongs to — a preview that shows an unshaped answer promises
 * something the product does not do.
 */
async function previewTurnConfig(tx: TenantClient, input: DraftConfigInput): Promise<TurnConfig> {
  const { aiAgentId } = input;
  const agent = aiAgentId
    ? await tx.aiAgent.findFirst({
        where: { id: aiAgentId },
        select: { tone: true, languages: true, persona: true },
      })
    : null;
  const guidance = await activeGuidance(tx, aiAgentId ? [aiAgentId] : []);
  const guardrails = await activeGuardrails(tx, aiAgentId ? [aiAgentId] : []);
  return {
    ...(agent ? { clarifyThresholds: readClarifyThresholds(agent.persona) } : {}),
    ...(guidance.length > 0 ? { guidance } : {}),
    ...(guardrails ? { guardrails } : {}),
    skills: [
      {
        id: 'preview',
        name: 'Preview',
        aiAgentId,
        steps: input.steps,
        persona: readPersona(agent),
        style: readPersonaStyle(agent?.persona),
        ...(input.definition
          ? { mode: 'procedure' as const, definition: input.definition, locked: false }
          : {}),
      },
    ],
  };
}
