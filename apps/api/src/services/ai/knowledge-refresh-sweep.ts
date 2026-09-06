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
 */
import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../../lib/api-error.js';
import { type TenantContext, withTenant } from '../../lib/tenant.js';
import { computeNextRefreshAt, fetchRefreshedText } from './knowledge-refresh.js';
import { KnowledgeService } from './knowledge-service.js';

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
  readonly #knowledge = new KnowledgeService();

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  async run(options: { now?: Date } = {}): Promise<KnowledgeRefreshReport> {
    const now = options.now ?? new Date();
    const startedAt = now.toISOString();

    const results: TenantRefreshResult[] = [];
    for (const tenant of await this.#listTenants()) {
      results.push(await this.#sweepTenant(tenant, now));
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

  async #sweepTenant(tenant: TenantRow, now: Date): Promise<TenantRefreshResult> {
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

    let refreshed = 0;
    let failed = 0;
    for (const source of due) {
      if (await this.#refreshOne(context, source, now)) refreshed += 1;
      else failed += 1;
    }

    return {
      licenseId: tenant.license_id.toString(),
      organizationId: tenant.organization_id,
      checked: due.length,
      refreshed,
      failed,
    };
  }

  async #refreshOne(context: TenantContext, source: DueSource, now: Date): Promise<boolean> {
    let text: string;
    try {
      text = await fetchRefreshedText({
        type: 'website',
        sourceUrl: source.sourceUrl,
        content: source.content,
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Could not refresh this source.';
      await withTenant(this.#db, context, (tx) =>
        tx.knowledgeSource.updateMany({
          where: { id: source.id },
          data: {
            lastRefreshError: message,
            nextRefreshAt: computeNextRefreshAt(source.refreshAfterDays, now),
          },
        }),
      );
      return false;
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
      // Re-chunked and re-embedded in the same transaction as the content
      // write, exactly as the manual reindex endpoint does — a source that
      // exists but answers from stale chunks is worse than one still stale.
      await this.#knowledge.index(tx, context, source.id, text);
    });
    return true;
  }
}
