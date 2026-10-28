/**
 * A published KB article in the AI's knowledge (tm 309.2 · AI-14-S2 ·
 * `docs/adr/single-knowledge-store.md` §2.6).
 *
 * The Genel KB flows one way into the store: an article that is published and
 * whose `ai_audiences` is not empty is mirrored by one knowledge source
 * (`knowledge_sources.kb_article_id`), for those audiences, every AI agent and
 * every brand — the KB is the whole workspace's. Unpublished or switched off,
 * the source goes, and every chunk with it, so retrieval stops finding the
 * article at once; the article's own delete takes it by the foreign key. The
 * article's publish or edit is the source's review (`reviewed_at` = the
 * article's `updated_at`).
 *
 * One function decides what an article's source should be —
 * {@link KbArticleKnowledge.sync} — and two callers run it: the article's own
 * write (`routes/kb.ts`), right after it commits, and the hourly sweep
 * ({@link KbArticleKnowledgeSweeper}, in the `knowledge_refresh` job) for what
 * a write could not finish — an article published before this release, one
 * saved while the embedding provider was away or the day's AI allowance used
 * up, one saved by a replica of the release before.
 *
 * **The article is never refused for the AI's sake.** The KB is the public help
 * centre, and publishing a correction must not wait on an embedding provider.
 * When the new text cannot be embedded now, the source keeps the article's
 * new text and loses its chunks — `indexing`, with the reason in
 * `last_refresh_error` — rather than answering from what the article no longer
 * says: until the sweep indexes it the AI hands such a question to a person,
 * which is the AI-and-agent-say-different-things problem AI-14 ends.
 *
 * The embedding is the provider call and runs in no transaction (tm 255.7):
 * read, embed, then write — the write takes the article's row lock, reads it
 * again and writes only if what was embedded is still what it says. Two saves
 * of one article race to one end: the one whose text is current writes it.
 */
import type { PrismaClient } from '@prisma/client';
import { normalizeKnowledgeAudiences } from '@siyahtus/types';
import { type TenantClient, type TenantContext, withTenant } from '../../lib/tenant.js';
import { AiDailyCapError, type AiCapScope } from './ai-daily-budget.js';
import {
  createKbArticleSourceDraft,
  deleteKnowledgeSourceDraft,
  updateKbArticleSourceDraft,
  type KbArticleSourceFields,
} from './config-draft.js';
import type { TenantRunner } from './conversation/turn.js';
import { inferenceAllowed, readInferenceResidency, type InferenceProvider } from './inference.js';
import { REFRESH_DEFERRED_AI_CAP, REFRESH_REFUSED_RESIDENCY } from './knowledge-refresh-sweep.js';
import type { KnowledgeService, PreparedChunks } from './knowledge-service.js';
import { EmbeddingProviderError } from './provider/embedding-error.js';

/** How many articles one tenant's sweep pass takes up — the rest wait for the next pass. */
export const KB_ARTICLE_SYNC_BATCH = 50;

/**
 * The text a published article is indexed as: its title, a line break, its
 * body as written — one line break, so the title opens the first paragraph's
 * chunk rather than standing as a passage of its own that answers nothing.
 * The sweep compares a source with its article in SQL by the same
 * concatenation ({@link KbArticleKnowledgeSweeper}), so the two cannot
 * disagree about whether a source is current.
 */
export function kbArticleKnowledgeText(article: { title: string; body: string }): string {
  return `${article.title}\n${article.body}`;
}

/** What `last_refresh_error` says when the provider did not embed the article's text. */
export function kbArticleEmbeddingFailed(kind: string): string {
  return `Not indexed yet: the embedding provider did not answer (${kind}). It is tried again within the hour.`;
}

export type KbArticleSyncOutcome =
  /** The source is what the article says already. */
  | { result: 'unchanged' }
  /** The article's text was embedded and its source written with it. */
  | { result: 'indexed'; chunks: number }
  /** The title or the audiences moved; the text, and so the chunks, did not. */
  | { result: 'updated' }
  /** Unpublished, switched off or gone: the source and its chunks went. */
  | { result: 'removed' }
  /**
   * Not indexed now. `residency`, `ai_daily_cap` and `embedding` leave the
   * source `indexing` with no chunks; `superseded` — the article changed while
   * its text was being embedded — leaves it to the write that changed it.
   */
  | {
      result: 'deferred';
      reason: 'residency' | 'ai_daily_cap' | 'embedding' | 'superseded';
      capScope?: AiCapScope;
    };

/** May this workspace's content go to the embedding provider now (NFR-C4)? Asked only when there is text to embed. */
export type KbArticleEmbedGate = () => Promise<boolean>;

const ARTICLE_SELECT = {
  id: true,
  title: true,
  body: true,
  status: true,
  aiAudiences: true,
  createdBy: true,
  updatedAt: true,
} as const;

const SOURCE_SELECT = {
  id: true,
  name: true,
  content: true,
  audiences: true,
  status: true,
} as const;

interface ArticleRow {
  id: string;
  title: string;
  body: string;
  status: string;
  aiAudiences: string[];
  createdBy: string | null;
  updatedAt: Date;
}

/** What `article`'s source should be — or null, when it should have none. */
function wanted(article: ArticleRow | null): KbArticleSourceFields | null {
  if (article === null || article.status !== 'published') return null;
  const audiences = normalizeKnowledgeAudiences(article.aiAudiences);
  if (audiences.length === 0) return null;
  return {
    name: article.title,
    content: kbArticleKnowledgeText(article),
    audiences,
    reviewedAt: article.updatedAt,
  };
}

function sameAudiences(stored: readonly string[], wanted: readonly string[]): boolean {
  return stored.length === wanted.length && stored.every((audience, i) => audience === wanted[i]);
}

export class KbArticleKnowledge {
  readonly #knowledge: KnowledgeService;

  constructor(knowledge: KnowledgeService) {
    this.#knowledge = knowledge;
  }

  /**
   * Bring `articleId`'s source to what the article says now. `run` opens a
   * tenant transaction per step; `mayEmbed` is asked only when there is text
   * to embed. Throws only what is not the provider's or the allowance's to
   * refuse — a database error, a defect.
   */
  async sync(
    run: TenantRunner,
    tenant: TenantContext,
    articleId: string,
    mayEmbed: KbArticleEmbedGate,
  ): Promise<KbArticleSyncOutcome> {
    const read = await run(async (tx) => ({
      article: await tx.kbArticle.findFirst({ where: { id: articleId }, select: ARTICLE_SELECT }),
      source: await tx.knowledgeSource.findFirst({
        where: { kbArticleId: articleId },
        select: SOURCE_SELECT,
      }),
    }));
    const fields = wanted(read.article);

    if (fields === null) {
      if (read.source === null) return { result: 'unchanged' };
      return run(async (tx) => {
        await lockArticle(tx, articleId);
        // Published again meanwhile: that save's sync writes it.
        if (wanted(await readArticle(tx, articleId)) !== null) {
          return { result: 'deferred', reason: 'superseded' } as const;
        }
        await deleteKnowledgeSourceDraft(tx, null, read.source!.id, { kbArticleId: articleId });
        return { result: 'removed' } as const;
      });
    }

    const embedded =
      read.source !== null &&
      read.source.content === fields.content &&
      read.source.status !== 'indexing';
    if (embedded) {
      if (
        read.source!.name === fields.name &&
        sameAudiences(read.source!.audiences, fields.audiences)
      ) {
        return { result: 'unchanged' };
      }
      return this.#write(run, tenant, articleId, fields, null);
    }

    if (!(await mayEmbed())) {
      return this.#hold(run, tenant, articleId, fields, REFRESH_REFUSED_RESIDENCY, 'residency');
    }
    let prepared: PreparedChunks;
    try {
      prepared = await this.#knowledge.prepare(fields.content, tenant);
    } catch (error) {
      if (error instanceof AiDailyCapError) {
        const held = await this.#hold(
          run,
          tenant,
          articleId,
          fields,
          REFRESH_DEFERRED_AI_CAP,
          'ai_daily_cap',
        );
        return held.result === 'deferred' && held.reason === 'ai_daily_cap'
          ? { ...held, capScope: error.scope }
          : held;
      }
      if (!(error instanceof EmbeddingProviderError)) throw error;
      return this.#hold(
        run,
        tenant,
        articleId,
        fields,
        kbArticleEmbeddingFailed(error.kind),
        'embedding',
      );
    }
    return this.#write(run, tenant, articleId, fields, prepared);
  }

  /**
   * Write the source as `fields` say, under the article's row lock and only if
   * the article still says it. `prepared` is the new text's chunks; null when
   * the text is the source's already and only its title or audiences move.
   */
  async #write(
    run: TenantRunner,
    tenant: TenantContext,
    articleId: string,
    fields: KbArticleSourceFields,
    prepared: PreparedChunks | null,
  ): Promise<KbArticleSyncOutcome> {
    return run(async (tx) => {
      await lockArticle(tx, articleId);
      const article = await readArticle(tx, articleId);
      const now = wanted(article);
      if (now === null || now.content !== fields.content) {
        return { result: 'deferred', reason: 'superseded' } as const;
      }
      const source = await tx.knowledgeSource.findFirst({
        where: { kbArticleId: articleId },
        select: { id: true },
      });
      let sourceId: string;
      if (source) {
        await updateKbArticleSourceDraft(tx, { id: source.id, licenseId: tenant.licenseId }, now);
        sourceId = source.id;
      } else {
        if (prepared === null) return { result: 'deferred', reason: 'superseded' } as const;
        sourceId = (
          await createKbArticleSourceDraft(
            tx,
            { licenseId: tenant.licenseId, id: articleId, createdBy: article!.createdBy },
            now,
          )
        ).id;
      }
      if (prepared === null) return { result: 'updated' } as const;
      const chunks = await this.#knowledge.index(tx, tenant, sourceId, prepared);
      return { result: 'indexed', chunks } as const;
    });
  }

  /**
   * The article's text could not be embedded now: its source takes the text
   * anyway, without chunks — `indexing`, `pending` saying why — so nothing
   * answers from what the article no longer says. The sweep indexes it later.
   */
  async #hold(
    run: TenantRunner,
    tenant: TenantContext,
    articleId: string,
    fields: KbArticleSourceFields,
    pending: string,
    reason: 'residency' | 'ai_daily_cap' | 'embedding',
  ): Promise<KbArticleSyncOutcome> {
    return run(async (tx) => {
      await lockArticle(tx, articleId);
      const article = await readArticle(tx, articleId);
      const now = wanted(article);
      if (now === null || now.content !== fields.content) {
        return { result: 'deferred', reason: 'superseded' } as const;
      }
      const source = await tx.knowledgeSource.findFirst({
        where: { kbArticleId: articleId },
        select: { ...SOURCE_SELECT, lastRefreshError: true },
      });
      if (
        source &&
        source.status === 'indexing' &&
        source.content === now.content &&
        source.name === now.name &&
        sameAudiences(source.audiences, now.audiences) &&
        source.lastRefreshError === pending
      ) {
        // Held already, for the same reason: a sweep pass that cannot index
        // it either writes nothing.
        return { result: 'deferred', reason } as const;
      }
      if (source) {
        // Its chunks first, through the writer of chunks (ADR-14b §2.8).
        await this.#knowledge.unindex(tx, source.id);
        await updateKbArticleSourceDraft(
          tx,
          { id: source.id, licenseId: tenant.licenseId },
          now,
          pending,
        );
      } else {
        await createKbArticleSourceDraft(
          tx,
          { licenseId: tenant.licenseId, id: articleId, createdBy: article!.createdBy },
          now,
          pending,
        );
      }
      return { result: 'deferred', reason } as const;
    });
  }
}

/** The article's row, locked for this transaction: one source writer per article at a time. */
async function lockArticle(tx: TenantClient, articleId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM kb_articles WHERE id = ${articleId}::uuid FOR UPDATE`;
}

function readArticle(tx: TenantClient, articleId: string): Promise<ArticleRow | null> {
  return tx.kbArticle.findFirst({ where: { id: articleId }, select: ARTICLE_SELECT });
}

export interface KbArticleKnowledgeSweeperOptions {
  knowledge: KnowledgeService;
  /** Where that service's embedding provider runs (`resolveEmbeddingInferenceProvider`). */
  embeddingInference: InferenceProvider;
  /** Overrides {@link KB_ARTICLE_SYNC_BATCH}; a test lowers it. */
  batch?: number;
}

export interface KbArticleKnowledgeReport {
  startedAt: string;
  finishedAt: string;
  totals: {
    tenants: number;
    /** Articles whose source was not what they say. */
    checked: number;
    /** Indexed, updated or removed this pass. */
    synced: number;
    /** Left for a later pass: the residency rule, the day's cap, the provider. */
    deferred: number;
  };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

/**
 * The sweep half (see the file header): per workspace, the articles whose
 * source is not what they say — a published, AI-open article with no source,
 * a source still `indexing`, or one whose title, text or audiences differ;
 * an unpublished or switched-off article that still has one — oldest change
 * first, {@link KB_ARTICLE_SYNC_BATCH} at a time, each through
 * {@link KbArticleKnowledge.sync}. Like the freshness sweep it walks the
 * tenants through the shared SECURITY DEFINER enumerator and works inside
 * each one's own RLS context; it asks a workspace's residency only when one
 * of its articles has text to embed, and stops embedding for a workspace — or
 * for the pass — once the day's AI cap refuses.
 */
export class KbArticleKnowledgeSweeper {
  readonly #db: PrismaClient;
  readonly #sync: KbArticleKnowledge;
  readonly #embeddingInference: InferenceProvider;
  readonly #batch: number;

  constructor(db: PrismaClient, options: KbArticleKnowledgeSweeperOptions) {
    this.#db = db;
    this.#sync = new KbArticleKnowledge(options.knowledge);
    this.#embeddingInference = options.embeddingInference;
    this.#batch = options.batch ?? KB_ARTICLE_SYNC_BATCH;
  }

  async run(): Promise<KbArticleKnowledgeReport> {
    const startedAt = new Date().toISOString();
    const totals = { tenants: 0, checked: 0, synced: 0, deferred: 0 };
    const pass = { deploymentCapped: false };
    const tenants = await this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
    for (const row of tenants) {
      totals.tenants += 1;
      const tenant: TenantContext = {
        licenseId: row.license_id,
        organizationId: row.organization_id,
      };
      const run: TenantRunner = (fn) => withTenant(this.#db, tenant, fn);
      const due = await run((tx) => this.#due(tx));
      if (due.length === 0) continue;

      let allowed: boolean | null = null;
      let workspaceCapped = false;
      const mayEmbed: KbArticleEmbedGate = async () => {
        if (workspaceCapped || pass.deploymentCapped) return false;
        allowed ??= await run(async (tx) => {
          const residency = await readInferenceResidency(tx, tenant);
          return (
            residency !== null &&
            inferenceAllowed({
              provider: this.#embeddingInference,
              workspaceRegion: residency.region,
              hipaaScope: residency.hipaaScope,
            })
          );
        });
        return allowed;
      };

      for (const articleId of due) {
        totals.checked += 1;
        // Capped for this workspace or the pass: the rest wait — nothing is
        // written for them, and no provider is asked.
        if (workspaceCapped || pass.deploymentCapped) {
          totals.deferred += 1;
          continue;
        }
        const outcome = await this.#sync.sync(run, tenant, articleId, mayEmbed);
        if (outcome.result === 'deferred') {
          totals.deferred += 1;
          if (outcome.capScope === 'workspace') workspaceCapped = true;
          if (outcome.capScope === 'global') pass.deploymentCapped = true;
        } else if (outcome.result !== 'unchanged') {
          totals.synced += 1;
        }
      }
    }
    return { startedAt, finishedAt: new Date().toISOString(), totals };
  }

  /** The articles whose source is not what they say, oldest change first. */
  async #due(tx: TenantClient): Promise<string[]> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT a.id
        FROM kb_articles a
        LEFT JOIN knowledge_sources s ON s.kb_article_id = a.id
       WHERE CASE
               WHEN a.status = 'published' AND cardinality(a.ai_audiences) > 0 THEN
                 s.id IS NULL
                 OR s.status = 'indexing'
                 OR s.content IS DISTINCT FROM a.title || E'\n' || a.body
                 OR s.name IS DISTINCT FROM a.title
                 OR s.audiences IS DISTINCT FROM a.ai_audiences
               ELSE s.id IS NOT NULL
             END
       ORDER BY a.updated_at, a.id
       LIMIT ${this.#batch}`;
    return rows.map((row) => row.id);
  }
}
