/**
 * The freshness sweep (FR-MOD-06.3.3, "expiry + automatic re-crawl" — the PRD
 * acceptance criterion's last unclosed piece, tm 198.4).
 *
 * A `website` source is crawled once and, until now, stays exactly as it was
 * crawled forever — no staleness threshold, no scheduled refresh. This sweep
 * is that: like `sla-sweep.ts` it walks every tenant through the shared
 * SECURITY DEFINER enumerator (RLS-scoped, one workspace's sweep can neither
 * see nor touch another's sources) and re-crawls whichever `website` sources
 * are past their own `refresh_after_days` window — through the *same*
 * SSRF-guarded crawl path the manual reindex endpoint uses
 * (`knowledge-refresh.ts`'s `fetchRefreshedText`), not a second one.
 *
 * A source with `refresh_after_days: null` (every source before this field
 * existed, and every source an admin has not opted into) is never selected:
 * `next_refresh_at` stays null forever, so the "due" query finds nothing for
 * it.
 *
 * **A failed refresh must not look like data loss.** If the crawl is refused
 * — the SSRF guard, or a URL that no longer names anything fetchable — the
 * source's old `content` and chunks are left exactly as they were; only
 * `last_refresh_error` moves, so the row can say *why* the last attempt did
 * not land. The next attempt is still scheduled from now, on the same
 * window, so a permanently broken URL is retried on the sweep's normal
 * cadence rather than hammered every tick.
 *
 * **The embedding provider is the second thing that can refuse (tm 255.7),
 * and it is treated like the first.** The refreshed text is embedded before
 * the write transaction opens; when the provider cannot embed it the source
 * keeps its old text and chunks and `last_refresh_error` says so. And since no
 * request carries this work, the residency rule is asked here: a workspace
 * under a signed BAA whose content the embedding provider would take out of
 * its region is not refreshed at all (NFR-C4 · `inference.ts`).
 *
 * **The daily AI cap is the third (tm 257.20).** A refresh is counted against
 * its workspace's embedding allowance, like the same refresh pressed in the
 * panel. When today's cap cannot take it, the source keeps its text and
 * chunks, `last_refresh_error` says the allowance is used up, and the next
 * attempt is the next UTC midnight — when there is room again — rather than a
 * whole window away. The workspace's other due sources are deferred the same
 * way without being crawled (a page fetched only to be thrown away is an
 * outbound request for nothing), and every source after a deployment-wide
 * refusal is too.
 */
import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../../lib/api-error.js';
import { type TenantContext, withTenant } from '../../lib/tenant.js';
import { AiDailyCapError, nextUtcMidnight, type AiCapScope } from './ai-daily-budget.js';
import { inferenceAllowed, readInferenceResidency, type InferenceProvider } from './inference.js';
import { computeNextRefreshAt, fetchRefreshedText } from './knowledge-refresh.js';
import type { KnowledgeService, PreparedChunks } from './knowledge-service.js';
import { EmbeddingProviderError } from './provider/embedding-error.js';

/** What `last_refresh_error` says when the residency rule refused the refresh. */
export const REFRESH_REFUSED_RESIDENCY =
  'Not refreshed: this workspace is covered by a signed HIPAA agreement and the embedding provider runs outside its region.';

/** What `last_refresh_error` says when today's AI cap could not take the refresh (tm 257.20). */
export const REFRESH_DEFERRED_AI_CAP =
  "Not refreshed: today's AI allowance is used up. The previous text still answers; it is tried again after 00:00 UTC.";

export interface KnowledgeRefreshSweeperOptions {
  /** Indexes the refreshed text — the server's instance, or one the CLI builds from the env. */
  knowledge: KnowledgeService;
  /** Where that service's embedding provider runs (`resolveEmbeddingInferenceProvider`). */
  embeddingInference: InferenceProvider;
}

export interface TenantRefreshResult {
  /** Stringified: a bigint cannot be JSON-serialised, and this report is JSON. */
  licenseId: string;
  organizationId: string;
  /** Website sources whose `next_refresh_at` was due this pass. */
  checked: number;
  refreshed: number;
  failed: number;
}

export interface KnowledgeRefreshReport {
  startedAt: string;
  finishedAt: string;
  tenants: TenantRefreshResult[];
  totals: { tenants: number; checked: number; refreshed: number; failed: number };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

interface DueSource {
  id: string;
  sourceUrl: string | null;
  content: string | null;
  refreshAfterDays: number | null;
}

export class KnowledgeRefreshSweeper {
  readonly #db: PrismaClient;
  readonly #knowledge: KnowledgeService;
  readonly #embeddingInference: InferenceProvider;

  constructor(db: PrismaClient, options: KnowledgeRefreshSweeperOptions) {
    this.#db = db;
    this.#knowledge = options.knowledge;
    this.#embeddingInference = options.embeddingInference;
  }

  async run(options: { now?: Date } = {}): Promise<KnowledgeRefreshReport> {
    const now = options.now ?? new Date();
    const startedAt = now.toISOString();

    const results: TenantRefreshResult[] = [];
    // Set once the deployment's cap refuses a refresh: nothing after it fits today.
    const pass = { deploymentCapped: false };
    for (const tenant of await this.#listTenants()) {
      results.push(await this.#sweepTenant(tenant, now, pass));
    }

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      tenants: results,
      totals: {
        tenants: results.length,
        checked: results.reduce((sum, r) => sum + r.checked, 0),
        refreshed: results.reduce((sum, r) => sum + r.refreshed, 0),
        failed: results.reduce((sum, r) => sum + r.failed, 0),
      },
    };
  }

  /**
   * Cross-tenant read via the shared SECURITY DEFINER enumerator — the only
   * place this sweep steps outside a single-tenant context, and it reads
   * nothing but the two ids the loop needs. Same function `sla-sweep.ts` and
   * the retention runner already share.
   */
  async #listTenants(): Promise<TenantRow[]> {
    return this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
  }

  async #sweepTenant(
    tenant: TenantRow,
    now: Date,
    pass: { deploymentCapped: boolean },
  ): Promise<TenantRefreshResult> {
    const context: TenantContext = {
      licenseId: tenant.license_id,
      organizationId: tenant.organization_id,
    };

    const due = await withTenant(this.#db, context, (tx) =>
      tx.knowledgeSource.findMany({
        where: { type: 'website', refreshAfterDays: { not: null }, nextRefreshAt: { lte: now } },
        select: { id: true, sourceUrl: true, content: true, refreshAfterDays: true },
      }),
    );

    // Only a workspace with something due is asked where it lives: most sweeps
    // of most tenants find nothing, and should cost nothing more than that.
    const allowed =
      due.length > 0 &&
      (await withTenant(this.#db, context, async (tx) => {
        const residency = await readInferenceResidency(tx, context);
        return (
          residency !== null &&
          inferenceAllowed({
            provider: this.#embeddingInference,
            workspaceRegion: residency.region,
            hipaaScope: residency.hipaaScope,
          })
        );
      }));

    let refreshed = 0;
    let failed = 0;
    let workspaceCapped = false;
    for (const source of due) {
      if (!allowed) {
        await this.#recordFailure(context, source, now, REFRESH_REFUSED_RESIDENCY);
        failed += 1;
      } else if (workspaceCapped || pass.deploymentCapped) {
        await this.#deferForCap(context, source, now);
        failed += 1;
      } else {
        const outcome = await this.#refreshOne(context, source, now);
        if (outcome === 'refreshed') refreshed += 1;
        else failed += 1;
        if (outcome === 'workspace') workspaceCapped = true;
        if (outcome === 'global') pass.deploymentCapped = true;
      }
    }

    return {
      licenseId: tenant.license_id.toString(),
      organizationId: tenant.organization_id,
      checked: due.length,
      refreshed,
      failed,
    };
  }

  /** `refreshed`, `failed`, or which daily AI cap refused it (`workspace` / `global`). */
  async #refreshOne(
    context: TenantContext,
    source: DueSource,
    now: Date,
  ): Promise<'refreshed' | 'failed' | AiCapScope> {
    let text: string;
    try {
      text = await fetchRefreshedText({
        type: 'website',
        sourceUrl: source.sourceUrl,
        content: source.content,
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Could not refresh this source.';
      await this.#recordFailure(context, source, now, message);
      return 'failed';
    }

    // Embedded before the write transaction, like the crawl above (tm 255.7),
    // and counted against the workspace's daily AI allowance (tm 257.20).
    let prepared: PreparedChunks;
    try {
      prepared = await this.#knowledge.prepare(text, context);
    } catch (error) {
      if (error instanceof AiDailyCapError) {
        await this.#deferForCap(context, source, now);
        return error.scope;
      }
      if (!(error instanceof EmbeddingProviderError)) throw error;
      await this.#recordFailure(
        context,
        source,
        now,
        `Not refreshed: the embedding provider did not answer (${error.kind}). The previous text still answers.`,
      );
      return 'failed';
    }

    await withTenant(this.#db, context, async (tx) => {
      await tx.knowledgeSource.updateMany({
        where: { id: source.id },
        data: {
          content: text,
          updatedAt: now,
          lastRefreshError: null,
          nextRefreshAt: computeNextRefreshAt(source.refreshAfterDays, now),
        },
      });
      // Re-chunked chunks written in the same transaction as the content,
      // exactly as the manual reindex endpoint does — a source that exists but
      // answers from stale chunks is worse than one still stale.
      await this.#knowledge.index(tx, context, source.id, prepared);
    });
    return 'refreshed';
  }

  /**
   * A refresh today's AI cap could not take: the text and chunks stay, the
   * reason is recorded, and the next attempt is the next UTC midnight — when
   * the day's allowance starts again — not a whole refresh window away.
   */
  async #deferForCap(context: TenantContext, source: DueSource, now: Date): Promise<void> {
    await withTenant(this.#db, context, (tx) =>
      tx.knowledgeSource.updateMany({
        where: { id: source.id },
        data: { lastRefreshError: REFRESH_DEFERRED_AI_CAP, nextRefreshAt: nextUtcMidnight(now) },
      }),
    );
  }

  /**
   * A refresh that did not land: the source's text and chunks are untouched,
   * only the reason and the next attempt move.
   */
  async #recordFailure(
    context: TenantContext,
    source: DueSource,
    now: Date,
    message: string,
  ): Promise<void> {
    await withTenant(this.#db, context, (tx) =>
      tx.knowledgeSource.updateMany({
        where: { id: source.id },
        data: {
          lastRefreshError: message,
          nextRefreshAt: computeNextRefreshAt(source.refreshAfterDays, now),
        },
      }),
    );
  }
}
