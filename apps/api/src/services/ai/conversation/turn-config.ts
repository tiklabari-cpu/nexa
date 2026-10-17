/**
 * Where a turn's configuration comes from today (tm 292.2 · ADR-14b §2.6).
 *
 * A turn never reads configuration tables itself: it is handed a
 * {@link TurnConfig}. These two loaders are the only reads that build one —
 * the live skill list and the editor preview's — so when the configuration
 * becomes a versioned package, these are what change. ADR-14b §2.6 names the
 * seam: `AiConfigSource.forTurn` / `forDraft`, which the context loader
 * (tm 292.3) builds over these reads ("read and compile" until tm 316 pins a
 * published package to every conversation).
 */
import { readPersona } from '@siyahtus/types';
import type { TenantClient } from '../../../lib/tenant.js';
import type { TurnConfig } from './turn.js';

/**
 * The live configuration: every active skill of an active AI agent, the most
 * recently edited first — the order the turn tries them in.
 */
export async function liveTurnConfig(tx: TenantClient): Promise<TurnConfig> {
  const skills = await tx.skill.findMany({
    where: { active: true, kind: 'ai_agent', aiAgent: { active: true } },
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
  return {
    skills: skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      aiAgentId: skill.aiAgentId,
      steps: skill.steps,
      persona: readPersona(skill.aiAgent),
    })),
  };
}

/**
 * The editor preview's configuration (FR-MOD-06.2.5): the steps being edited,
 * as one unsaved skill, under the persona the live path would use for the
 * agent it belongs to — a preview that shows an unshaped answer promises
 * something the product does not do.
 */
export async function previewTurnConfig(
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
