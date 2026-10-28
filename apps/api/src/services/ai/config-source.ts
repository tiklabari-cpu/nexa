/**
 * The AI configuration a turn answers from once versions exist (tm 316.3 ·
 * ADR-14b `docs/adr/ai-config-versioning.md` §2.6 (2), §2.7, §2.8 (4)) — the
 * {@link AiConfigSource} the live path, a hand-over and a simulation read.
 *
 *   - **`forTurn`**: the version the conversation is pinned to, else the
 *     agent's published one — which the turn's commit then pins
 *     (`ai-responder.ts`), so a publication mid-conversation never changes the
 *     conversation (§2.7 (1)). The package comes from the process's cache
 *     (`config-cache.ts`); the agent's row — its pointer and its pause switch —
 *     is read every time, so a paused agent answers nothing whatever version it
 *     is pinned to (§2.7 (5)).
 *   - **Before there is a package to read** the editing tables answer, as they
 *     did before versioning: an agent that has never published (one created
 *     since the migration) has no version, and the migration's baseline v1
 *     that is not sealed yet *is* the tables (`config-baseline.ts`). The
 *     baseline is still the version a conversation pins.
 *   - **`forDraft`** is the editor's preview and always the tables.
 *   - **`forSimulation`**: `draft` the tables, `published` the agent's
 *     published package (paused or not, §2.2).
 *
 * A turn on a package searches the knowledge the version published — the
 * chunks visible at its `seq`, scoped by its manifest (`knowledge`); a turn on
 * the tables searches the draft view (`KnowledgeService.search`).
 */
import {
  AI_CONFIG_PACKAGE_FORMAT_BASELINE,
  type AiConfigKnowledgeManifestEntry,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import { aiConfigPackages, type CachedAiConfig } from './config-cache.js';
import type { AiConfigPackage } from './config-compiler.js';
import {
  readAndCompile,
  type AiConfigRead,
  type AiConfigSource,
} from './conversation/turn-config.js';

/** What a paused agent's turn runs: nothing (§2.7 (5)). */
const PAUSED = Object.freeze({ skills: Object.freeze([]) });

interface AgentRow {
  id: string;
  active: boolean;
  publishedVersionId: string | null;
}

/** The workspace's customer-facing agent — one per workspace in v1 (tm 390) — or the one named. */
async function readAgent(tx: TenantClient, aiAgentId: string | null): Promise<AgentRow | null> {
  return tx.aiAgent.findFirst({
    where: { kind: 'ai_agent', ...(aiAgentId ? { id: aiAgentId } : {}) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, active: true, publishedVersionId: true },
  });
}

/** A version as the run time may serve it, or the unsealed baseline's label alone. */
type Served =
  | { kind: 'package'; config: CachedAiConfig }
  | { kind: 'baseline'; versionId: string; number: number; seq: number };

/**
 * `versionId`'s package when it is a published (or once published) version
 * of `agent` — from the cache, else read and kept. Null for anything else: an
 * id of another agent, a version that never went out.
 */
async function serve(tx: TenantClient, agent: AgentRow, versionId: string): Promise<Served | null> {
  const cached = aiConfigPackages.get(versionId);
  if (cached) return cached.aiAgentId === agent.id ? { kind: 'package', config: cached } : null;
  const row = await tx.aiConfigVersion.findFirst({
    where: { id: versionId, aiAgentId: agent.id, seq: { not: null } },
    select: {
      id: true,
      aiAgentId: true,
      number: true,
      minor: true,
      seq: true,
      packageFormat: true,
      snapshot: true,
      knowledgeManifest: true,
    },
  });
  if (!row || row.seq === null) return null;
  const seq = Number(row.seq);
  if (row.packageFormat === AI_CONFIG_PACKAGE_FORMAT_BASELINE) {
    return { kind: 'baseline', versionId: row.id, number: row.number, seq };
  }
  const snapshot = row.snapshot as unknown as AiConfigPackage;
  const sources = Array.isArray(row.knowledgeManifest)
    ? (row.knowledgeManifest as unknown as AiConfigKnowledgeManifestEntry[])
    : [];
  const config = aiConfigPackages.set({
    versionId: row.id,
    aiAgentId: row.aiAgentId,
    number: row.number,
    minor: row.minor,
    seq,
    turn: snapshot.turn,
    sources,
    bytes: Buffer.byteLength(JSON.stringify(row.snapshot), 'utf8'),
  });
  return { kind: 'package', config };
}

function fromPackage(config: CachedAiConfig, active: boolean): AiConfigRead {
  return {
    versionId: config.versionId,
    number: config.number,
    seq: config.seq,
    pkg: active ? config.turn : PAUSED,
    knowledge: { seq: config.seq, sources: config.sources },
  };
}

export const publishedConfig: AiConfigSource = {
  async forTurn(tx, input) {
    const agent = await readAgent(tx, input.aiAgentId);
    if (!agent) return readAndCompile.forTurn(tx, input);
    // The pinned version — unless it is not one this agent published (none
    // should be), when the conversation takes the published one instead.
    let served = input.pinnedVersionId ? await serve(tx, agent, input.pinnedVersionId) : null;
    if (!served && agent.publishedVersionId) {
      served = await serve(tx, agent, agent.publishedVersionId);
    }
    if (!served) return readAndCompile.forTurn(tx, input);
    if (served.kind === 'package') return fromPackage(served.config, agent.active);
    const live = await readAndCompile.forTurn(tx, { ...input, aiAgentId: agent.id });
    return { ...live, versionId: served.versionId, number: served.number, seq: served.seq };
  },

  forDraft(tx, input) {
    return readAndCompile.forDraft(tx, input);
  },

  async forSimulation(tx, input) {
    if (input.target === 'draft') return readAndCompile.forSimulation(tx, input);
    const agent = await readAgent(tx, input.aiAgentId);
    const served = agent?.publishedVersionId
      ? await serve(tx, agent, agent.publishedVersionId)
      : null;
    if (!served) return readAndCompile.forSimulation(tx, input);
    if (served.kind === 'package') return fromPackage(served.config, true);
    const live = await readAndCompile.forSimulation(tx, input);
    return { ...live, versionId: served.versionId, number: served.number, seq: served.seq };
  },
};
