/**
 * The freshness sweep (FR-MOD-06.3.3, "expiry + automatic re-crawl" — the PRD
 * acceptance criterion's last unclosed piece, tm 198.4).
 *
 * A `website` source past its own `refresh_after_days` window is re-crawled:
 * like `sla-sweep.ts` the sweep walks every tenant through the shared
 * SECURITY DEFINER enumerator (RLS-scoped, one workspace's sweep can neither
 * see nor touch another's sources) and, since tm 312.3, **queues a `refresh`
 * job** for each due source — the same crawl the panel's "Crawl again"
 * queues, worked through by the knowledge job runner
 * (`crawler/job-runner.ts`), which embeds only the pages whose text changed.
 * The sweep itself fetches nothing.
 *
 * A source with `refresh_after_days: null` (every source before this field
 * existed, and every source an admin has not opted into) is never selected:
 * `next_refresh_at` stays null forever, so the "due" query finds nothing for
 * it. A due source is moved a whole window on as it is queued, so the next
 * pass does not queue it again while its crawl runs; the job's end counts the
 * window from when it finished.
 *
 * **A refused refresh must not look like data loss.** Two refusals are the
 * sweep's, before anything is queued:
 *
 *   - the stored URL is re-checked by the SSRF guard (NFR-S7) — the row is
 *     not the request that created it;
 *   - a workspace under a signed BAA whose content the embedding provider
 *     would take out of its region is not refreshed at all (NFR-C4 ·
 *     `inference.ts`) — no request carries this work, so the sweep asks.
 *
 * Either leaves the source's text and chunks as they were; only
 * `last_refresh_error` moves, and the next attempt is scheduled a window
 * away. The rest — the day's AI allowance, the provider failing, a page gone
 * — is the runner's, under the same rule.
 */
import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../../lib/api-error.js';
import { assertPublicHttpUrl } from '../../lib/ssrf.js';
import { type TenantContext, withTenant } from '../../lib/tenant.js';
import { enqueueKnowledgeJob } from './crawler/jobs.js';
import { inferenceAllowed, readInferenceResidency, type InferenceProvider } from './inference.js';
import { computeNextRefreshAt } from './knowledge-refresh.js';

/** What `last_refresh_error` says when the residency rule refused the refresh. */
export const REFRESH_REFUSED_RESIDENCY =
  'Not refreshed: this workspace is covered by a signed HIPAA agreement and the embedding provider runs outside its region.';

/** What `last_refresh_error` says when today's AI cap could not take the refresh (tm 257.20). */
export const REFRESH_DEFERRED_AI_CAP =
  "Not refreshed: today's AI allowance is used up. The previous text still answers; it is tried again after 00:00 UTC.";

export interface KnowledgeRefreshSweeperOptions {
  /** Where the embedding provider runs (`resolveEmbeddingInferenceProvider`) — the residency gate. */
  embeddingInference: InferenceProvider;
  /** Told when a crawl was queued — the server's runner, woken at once. */
  onQueued?: () => void;
}

export interface TenantRefreshResult {
  /** Stringified: a bigint cannot be JSON-serialised, and this report is JSON. */
  licenseId: string;
  organizationId: string;
  /** Website sources whose `next_refresh_at` was due this pass. */
  checked: number;
  /** Crawls queued for them — or already under way. */
  queued: number;
  /** Refused before queueing (SSRF, residency). */
  failed: number;
}

export interface KnowledgeRefreshReport {
  startedAt: string;
  finishedAt: string;
  tenants: TenantRefreshResult[];
  totals: { tenants: number; checked: number; queued: number; failed: number };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

interface DueSource {
  id: string;
  sourceUrl: string | null;
  refreshAfterDays: number | null;
}

export class KnowledgeRefreshSweeper {
  readonly #db: PrismaClient;
  readonly #embeddingInference: InferenceProvider;
  readonly #onQueued: () => void;

  constructor(db: PrismaClient, options: KnowledgeRefreshSweeperOptions) {
    this.#db = db;
    this.#embeddingInference = options.embeddingInference;
    this.#onQueued = options.onQueued ?? (() => {});
  }

  async run(options: { now?: Date } = {}): Promise<KnowledgeRefreshReport> {
    const now = options.now ?? new Date();
    const startedAt = now.toISOString();

    const results: TenantRefreshResult[] = [];
    for (const tenant of await this.#listTenants()) {
      results.push(await this.#sweepTenant(tenant, now));
    }
    if (results.some((r) => r.queued > 0)) this.#onQueued();

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      tenants: results,
      totals: {
        tenants: results.length,
        checked: results.reduce((sum, r) => sum + r.checked, 0),
        queued: results.reduce((sum, r) => sum + r.queued, 0),
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

  async #sweepTenant(tenant: TenantRow, now: Date): Promise<TenantRefreshResult> {
    const context: TenantContext = {
      licenseId: tenant.license_id,
      organizationId: tenant.organization_id,
    };

    const due = await withTenant(this.#db, context, (tx) =>
      tx.knowledgeSource.findMany({
        where: { type: 'website', refreshAfterDays: { not: null }, nextRefreshAt: { lte: now } },
        select: { id: true, sourceUrl: true, refreshAfterDays: true },
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

    let queued = 0;
    let failed = 0;
    for (const source of due) {
      const refusal = allowed ? refusedUrl(source.sourceUrl) : REFRESH_REFUSED_RESIDENCY;
      if (refusal !== null) {
        await this.#recordFailure(context, source, now, refusal);
        failed += 1;
      } else {
        await this.#queue(context, source, now);
        queued += 1;
      }
    }

    return {
      licenseId: tenant.license_id.toString(),
      organizationId: tenant.organization_id,
      checked: due.length,
      queued,
      failed,
    };
  }

  /** The crawl, queued — or the one already under way kept — and the window moved on. */
  async #queue(context: TenantContext, source: DueSource, now: Date): Promise<void> {
    await withTenant(this.#db, context, async (tx) => {
      const job = await enqueueKnowledgeJob(tx, {
        context,
        sourceId: source.id,
        kind: 'refresh',
        requestedBy: null,
      });
      await tx.knowledgeSource.updateMany({
        where: { id: source.id },
        data: {
          ...(job.created ? { status: 'crawling' } : {}),
          nextRefreshAt: computeNextRefreshAt(source.refreshAfterDays, now),
        },
      });
    });
  }

  /**
   * A refresh refused before it was queued: the source's text and chunks are
   * untouched, only the reason and the next attempt move.
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

/** Why the stored URL may not be fetched (the SSRF guard's words), or null. */
function refusedUrl(sourceUrl: string | null): string | null {
  if (!sourceUrl) return 'This website source has no URL to crawl.';
  try {
    assertPublicHttpUrl(sourceUrl);
    return null;
  } catch (error) {
    return error instanceof ApiError ? error.message : 'Could not refresh this source.';
  }
}
