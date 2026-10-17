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
import { readBatchWindowSeconds, readPersona } from '@siyahtus/types';
import type { TenantClient } from '../../../lib/tenant.js';
import type { TurnConfig } from './turn.js';

/** A configuration as the seam returns it (ADR-14b §2.6). */
export interface AiConfigRead {
  /** The published version it is; null before versioning (tm 316) and for a draft. */
  readonly versionId: string | null;
  readonly pkg: TurnConfig;
  /** The version's number on its agent's line; null with `versionId`. */
  readonly seq: number | null;
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
  /** The editor's: the unsaved steps, as one skill of the agent they belong to. */
  forDraft(
    tx: TenantClient,
    input: { aiAgentId: string | null; steps: unknown },
  ): Promise<AiConfigRead>;
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
      // The persona travels with the skill because it belongs to the agent
      // that owns it: two agents in one workspace answer in two voices, so
      // "which persona applies" is only decidable once a skill has been
      // picked (FR-MOD-06.4).
      aiAgent: { select: { tone: true, languages: true, persona: true } },
    },
  });
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
    })),
    // Unset stays absent, so a configuration nobody tuned is what it was.
    ...(waits.length > 0 ? { batchWindowSeconds: Math.max(...waits) } : {}),
  };
}

/**
 * The editor preview's configuration (FR-MOD-06.2.5): the steps being edited,
 * as one unsaved skill, under the persona the live path would use for the
 * agent it belongs to — a preview that shows an unshaped answer promises
 * something the product does not do.
 */
async function previewTurnConfig(
  tx: TenantClient,
  input: { steps: unknown; aiAgentId: string | null },
): Promise<TurnConfig> {
  const { aiAgentId } = input;
  const agent = aiAgentId
    ? await tx.aiAgent.findFirst({
        where: { id: aiAgentId },
        select: { tone: true, languages: true, persona: true },
      })
    : null;
  return {
    skills: [
      {
        id: 'preview',
        name: 'Preview',
        aiAgentId,
        steps: input.steps,
        persona: readPersona(agent),
      },
    ],
  };
}
