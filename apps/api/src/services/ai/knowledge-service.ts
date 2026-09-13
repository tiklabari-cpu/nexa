/**
 * Knowledge indexing and retrieval (RAG).
 *
 * Chunks are embedded with the deterministic stub in `@nexa/ai-mock` and stored
 * in pgvector. Retrieval is a nearest-neighbour search restricted to the
 * caller's license — the `<=>` operator is cosine *distance*, so smaller is
 * closer, which is the opposite of the similarity score everything else here
 * talks in.
 */
import { Prisma } from '@prisma/client';
import { chunk, embed, toVectorLiteral } from '@nexa/ai-mock';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

export interface RetrievedChunk {
  id: string;
  sourceId: string;
  sourceName: string;
  text: string;
  /** Cosine similarity in [0, 1]. Higher is closer. */
  score: number;
}

/**
 * Below this a "match" is noise. Answering a customer from an unrelated article
 * is worse than admitting there is no answer, so the engine treats a miss as a
 * reason to hand over rather than something to paper over.
 */
export const RETRIEVAL_THRESHOLD = 0.25;

export class KnowledgeService {
  /**
   * Re-chunk and re-embed a source.
   *
   * Replaces every chunk rather than diffing: sources are edited rarely and
   * wholesale, and a partial update leaves orphaned chunks that keep answering
   * from text the admin already deleted.
   */
  async index(
    tx: TenantClient,
    tenant: TenantContext,
    sourceId: string,
    content: string,
  ): Promise<number> {
    await tx.knowledgeChunk.deleteMany({ where: { sourceId } });

    const pieces = chunk(content);
    for (const [position, text] of pieces.entries()) {
      const vector = toVectorLiteral(embed(text));
      // Raw SQL because Prisma has no vector type; the parameters are still
      // bound, not interpolated.
      await tx.$executeRaw`
        INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding, token_count, position)
        VALUES (gen_random_uuid(), ${sourceId}::uuid, ${tenant.licenseId}, ${text},
                ${vector}::vector, ${text.split(/\s+/).length}, ${position})
      `;
    }

    await tx.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: pieces.length > 0 ? 'ready' : 'empty', updatedAt: new Date() },
    });

    return pieces.length;
  }

  /**
   * Nearest chunks to a question, best first — by exact search, on purpose.
   *
   * `idx_chunks_embedding` is approximate: IVFFlat, built by the domain-model
   * migration on an empty table, so its list centroids are random and a scan
   * with the default `ivfflat.probes` reads one list in a hundred. Ordering by
   * the bare `embedding <=> …` let the planner answer from it whenever its
   * statistics favoured the index, and a passage filed under another list was
   * then simply not there — measured as a customer queued for a human while the
   * answer sat in the knowledge base at 0.58 (GL-16), and as 17–22 of 24
   * questions answered wrongly or not at all on that plan, per fresh database
   * (tm 252). The miss is silent by nature: "nothing above the threshold" is
   * also what an unanswerable question returns.
   *
   * An index can only serve an ORDER BY that is a bare distance operator, so the
   * `+ 0` keeps every plan exact. It sits in the select list, not in the ORDER
   * BY, so the distance — and the TOAST read of each vector — happens once per
   * row. And it stays ascending: a chunk with no searchable word embeds to zero,
   * its cosine distance is NaN, and Postgres sorts NaN above every number, so a
   * descending similarity would hand those rows the LIMIT ahead of a real match.
   *
   * The cost is linear in the chunks in scope, which the tenant and agent filters
   * narrow before any vector is read: p95 ≈ 27 ms at 5,000 chunks, 96 ms at
   * 20,000, 234 ms at 50,000 (PLAN §D170). Past that the answer is an index
   * trained on data with a measured recall, not the untrained one.
   */
  async retrieve(
    tx: TenantClient,
    tenant: TenantContext,
    query: string,
    options: { aiAgentId?: string; limit?: number } = {},
  ): Promise<RetrievedChunk[]> {
    const vector = toVectorLiteral(embed(query));
    const limit = options.limit ?? 3;

    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        source_id: string;
        source_name: string;
        chunk_text: string;
        distance: number;
      }>
    >`
      SELECT c.id, c.source_id, s.name AS source_name, c.chunk_text,
             (c.embedding <=> ${vector}::vector) + 0 AS distance
      FROM knowledge_chunks c
      JOIN knowledge_sources s ON s.id = c.source_id
      WHERE c.license_id = ${tenant.licenseId}
        AND s.status = 'ready'
        ${options.aiAgentId ? Prisma.sql`AND s.ai_agent_id = ${options.aiAgentId}::uuid` : Prisma.empty}
      ORDER BY distance
      LIMIT ${limit}
    `;

    return (
      rows
        // `<=>` is distance; the rest of the system reasons in similarity.
        .map((row) => ({
          id: row.id,
          sourceId: row.source_id,
          sourceName: row.source_name,
          text: row.chunk_text,
          score: Number((1 - Number(row.distance)).toFixed(4)),
        }))
        .filter((row) => row.score >= RETRIEVAL_THRESHOLD)
    );
  }
}
