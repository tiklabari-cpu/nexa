/**
 * The migration's baseline v1, sealed before the draft first changes (tm
 * 316.3 · ADR-14b `docs/adr/ai-config-versioning.md` §2.3 "Geri dolum").
 *
 * 20261115090000 bound every customer-facing agent that existed to a v1 that
 * holds no package (`package_format` 0) and opened every chunk there was at its
 * `seq`: "the tables as they are". Until something in the draft changes, that
 * is exactly what the tables are — so the run time answers such an agent from
 * them (`config-source.ts`) and a draft told against it has no changes.
 *
 * {@link sealBaselines} keeps that true. It runs before every change to the
 * draft — every save through `config-draft.ts`, every chunk generation
 * `KnowledgeService` writes, a submission — and compiles the tables as they
 * still are into v1 (the version's trigger lets a baseline be sealed exactly
 * once), opening the chunks its manifest names that the migration could not
 * (written since, `visible_from_version` null) at v1's `seq`. From then on the
 * change is the draft's, and v1 is what answers. Sealing is not judged: v1
 * records what was answering, whether or not a submission would pass today.
 *
 * Two writers sealing at once meet on the version row: the second's update
 * finds it sealed and opens nothing.
 */
import { Prisma } from '@prisma/client';
import { AI_CONFIG_PACKAGE_FORMAT_BASELINE } from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import { compilePackage } from './config-compiler.js';

/**
 * Seal every unsealed baseline of the transaction's workspace — a no-op past
 * the first change (one indexed read). Returns how many it sealed.
 */
export async function sealBaselines(tx: TenantClient): Promise<number> {
  const open = await tx.$queryRaw<Array<{ version_id: string; ai_agent_id: string; seq: bigint }>>`
    SELECT v.id::text AS version_id, v.ai_agent_id::text AS ai_agent_id, v.seq
      FROM ai_agents a
      JOIN ai_config_versions v ON v.id = a.published_version_id
     WHERE a.kind = 'ai_agent'
       AND v.package_format = ${AI_CONFIG_PACKAGE_FORMAT_BASELINE}`;
  let sealed = 0;
  for (const baseline of open) {
    const read = await compilePackage(tx, baseline.ai_agent_id);
    if (!read) continue;
    const { compiled } = read;
    const updated = await tx.$executeRaw`
      UPDATE ai_config_versions
         SET package_format = ${compiled.packageFormat},
             snapshot = ${JSON.stringify(compiled.snapshot)}::jsonb,
             snapshot_hash = ${compiled.snapshotHash},
             knowledge_manifest = ${JSON.stringify(compiled.knowledgeManifest)}::jsonb
       WHERE id = ${baseline.version_id}::uuid
         AND package_format = ${AI_CONFIG_PACKAGE_FORMAT_BASELINE}`;
    if (updated === 0) continue;
    sealed += 1;
    const manifest = compiled.knowledgeManifest;
    if (manifest.length === 0) continue;
    await tx.$executeRaw(Prisma.sql`
      UPDATE knowledge_chunks c SET visible_from_version = ${baseline.seq}
        FROM unnest(${manifest.map((entry) => entry.source_id)}::uuid[],
                    ${manifest.map((entry) => entry.generation)}::int[]) AS m(source_id, generation)
       WHERE c.source_id = m.source_id AND c.generation = m.generation
         AND c.visible_from_version IS NULL`);
  }
  return sealed;
}
