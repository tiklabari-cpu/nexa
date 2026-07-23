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

  /** Nearest chunks to a question, best first. */
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
             (c.embedding <=> ${vector}::vector) AS distance
      FROM knowledge_chunks c
      JOIN knowledge_sources s ON s.id = c.source_id
      WHERE c.license_id = ${tenant.licenseId}
        AND s.status = 'ready'
        ${options.aiAgentId ? Prisma.sql`AND s.ai_agent_id = ${options.aiAgentId}::uuid` : Prisma.empty}
      ORDER BY c.embedding <=> ${vector}::vector
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
