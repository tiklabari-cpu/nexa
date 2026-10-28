/**
 * The published AI configuration packages the run time answers from, kept
 * in the process by version (tm 316.3 · ADR-14b `docs/adr/ai-config-versioning.md`
 * §2.6 (2)).
 *
 * A published package never changes — the table's trigger refuses it — so an
 * entry never goes stale and nothing ever invalidates one: it leaves only to
 * make room, least recently used first. What does change is *which* version
 * an agent answers with, its pointer (`ai_agents.published_version_id`), and
 * that is deliberately not kept here: it is read on every turn from the same
 * row as the pause switch, which has to be read live anyway (§2.2) — so a
 * publication, a rollback and a pause all take effect on the next turn in
 * every API process, with nothing to announce and no window in which a
 * process that missed an announcement answers from the old version. The
 * `ai_config_published` push after a publication (`announceAiConfigPublished`)
 * is for the people watching — the Inbox band — not for this cache.
 *
 * Bounded by entries and by bytes (a package's canonical size, at most
 * `AI_CONFIG_PACKAGE_MAX_BYTES` each). An entry names the agent it belongs to,
 * and the reader serves it only to a turn that read that agent under its own
 * row level security (`config-source.ts`), so a version id alone never reaches
 * another workspace's package. The package is frozen: every turn of the
 * version shares it, and one that wrote to it would change the next.
 */
import type { AiConfigVersion } from '@prisma/client';
import {
  aiConfigVersionLabel,
  type AiConfigKnowledgeManifestEntry,
  type AiConfigPublishedPush,
} from '@siyahtus/types';
import type { TenantContext } from '../../lib/tenant.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import type { TurnConfig } from './conversation/turn.js';

/** A published version, as a turn runs on it. */
export interface CachedAiConfig {
  readonly versionId: string;
  readonly aiAgentId: string;
  readonly number: number;
  readonly minor: number;
  /** The workspace's publication order: the chunks visible at it are the version's. */
  readonly seq: number;
  readonly turn: TurnConfig;
  /** The sources the version answers from, scoped as they were when it was compiled. */
  readonly sources: readonly AiConfigKnowledgeManifestEntry[];
  /** The package's size, as the cache counts it. */
  readonly bytes: number;
}

/** How many packages a process keeps by default, and how many bytes of them. */
export const AI_CONFIG_CACHE_ENTRIES = 256;
export const AI_CONFIG_CACHE_BYTES = 64 * 1024 * 1024;

export class AiConfigPackageCache {
  readonly #entries = new Map<string, CachedAiConfig>();
  #bytes = 0;

  constructor(
    readonly maxEntries = AI_CONFIG_CACHE_ENTRIES,
    readonly maxBytes = AI_CONFIG_CACHE_BYTES,
  ) {}

  get size(): number {
    return this.#entries.size;
  }

  get bytes(): number {
    return this.#bytes;
  }

  /** The version's package, now the most recently used — or undefined. */
  get(versionId: string): CachedAiConfig | undefined {
    const hit = this.#entries.get(versionId);
    if (hit === undefined) return undefined;
    this.#entries.delete(versionId);
    this.#entries.set(versionId, hit);
    return hit;
  }

  /**
   * Keep `entry`, frozen, and return it. One larger than the whole cache is
   * returned without being kept: the turn still runs on it, the next one reads
   * it again.
   */
  set(entry: CachedAiConfig): CachedAiConfig {
    const frozen = deepFreeze(entry);
    if (entry.bytes > this.maxBytes) return frozen;
    this.#drop(entry.versionId);
    this.#entries.set(entry.versionId, frozen);
    this.#bytes += entry.bytes;
    for (const [oldest, kept] of this.#entries) {
      if (this.#entries.size <= this.maxEntries && this.#bytes <= this.maxBytes) break;
      if (kept === frozen) break;
      this.#drop(oldest);
    }
    return frozen;
  }

  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }

  #drop(versionId: string): void {
    const kept = this.#entries.get(versionId);
    if (kept === undefined) return;
    this.#entries.delete(versionId);
    this.#bytes -= kept.bytes;
  }
}

/** The process's one cache: packages are the same for every caller. */
export const aiConfigPackages = new AiConfigPackageCache();

/**
 * Tell the workspace's agents a version went live (`ai_config_published`,
 * ADR-14b §2.10 (3)) — after the commit that published it, by whoever
 * published it: the approval, the rollback, the scheduled job (tm 316.6).
 * Never fails the publication (`RealtimePublisher`).
 */
export async function announceAiConfigPublished(
  publisher: RealtimePublisher,
  tenant: TenantContext,
  version: AiConfigVersion,
): Promise<void> {
  if (version.status !== 'published' || version.seq === null || version.publishedAt === null)
    return;
  const payload: AiConfigPublishedPush = {
    ai_agent_id: version.aiAgentId,
    version_id: version.id,
    label: aiConfigVersionLabel(version),
    seq: Number(version.seq),
    published_at: version.publishedAt.toISOString(),
    rollback_of: version.rollbackOf,
  };
  await publisher.publish(tenant, 'ai_config_published', { allAgents: true }, payload);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
