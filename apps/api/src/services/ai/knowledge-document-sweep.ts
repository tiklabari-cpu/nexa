/**
 * The orphan sweep for knowledge documents (tm 313.3 · SiyahTuş analysis
 * AI-18): removes the stored PDF and Word originals no source holds.
 *
 * Two things leave one behind. A source is deleted and its object is removed
 * *after* the delete commits (`DELETE /knowledge-sources/{id}`) — a store that
 * did not answer then leaves the object, the source already gone. And an upload
 * nobody turned into a source (`POST /uploads` stored it, the form was closed,
 * the same file was a 409). Neither is visible to a person, both are customer
 * files, so this walks each workspace's `<licence>/knowledge/` prefix, and
 * removes the objects that no source's `file_key` names and that are older than
 * {@link ORPHAN_GRACE_MS} — long enough that an upload still on its way to
 * becoming a source is never taken from under it.
 *
 * Mirrors the freshness sweep (`knowledge-refresh-sweep.ts`): the workspaces
 * come from the shared SECURITY DEFINER enumerator, everything else is read
 * inside a tenant, and one workspace's store failing is that workspace's line
 * of the report, not the sweep's end.
 */
import type { PrismaClient } from '@prisma/client';
import { withTenant } from '../../lib/tenant.js';
import type { ObjectStore } from '../storage/object-store.js';

/** An unreferenced object is left this long before it is removed. */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

export interface TenantOrphanResult {
  /** Stringified: a bigint cannot be JSON-serialised, and this report is JSON. */
  licenseId: string;
  /** Objects the workspace's prefix holds. */
  checked: number;
  /** Orphans removed. */
  removed: number;
  /** Orphans the store would not remove, or a listing it would not give. */
  failed: number;
}

export interface KnowledgeDocumentSweepReport {
  tenants: TenantOrphanResult[];
  totals: { tenants: number; checked: number; removed: number; failed: number };
}

export class KnowledgeDocumentObjectSweeper {
  readonly #db: PrismaClient;
  readonly #store: ObjectStore;
  readonly #graceMs: number;

  constructor(db: PrismaClient, store: ObjectStore, options: { graceMs?: number } = {}) {
    this.#db = db;
    this.#store = store;
    this.#graceMs = options.graceMs ?? ORPHAN_GRACE_MS;
  }

  async run(options: { now?: Date } = {}): Promise<KnowledgeDocumentSweepReport> {
    const now = options.now ?? new Date();
    const tenants = await this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
    const results: TenantOrphanResult[] = [];
    for (const tenant of tenants) results.push(await this.#sweepTenant(tenant, now));
    return {
      tenants: results,
      totals: {
        tenants: results.length,
        checked: results.reduce((sum, r) => sum + r.checked, 0),
        removed: results.reduce((sum, r) => sum + r.removed, 0),
        failed: results.reduce((sum, r) => sum + r.failed, 0),
      },
    };
  }

  async #sweepTenant(tenant: TenantRow, now: Date): Promise<TenantOrphanResult> {
    const result: TenantOrphanResult = {
      licenseId: tenant.license_id.toString(),
      checked: 0,
      removed: 0,
      failed: 0,
    };
    let stored;
    try {
      stored = await this.#store.listKnowledge(tenant.license_id);
    } catch {
      result.failed += 1;
      return result;
    }
    result.checked = stored.length;
    const old = stored.filter(
      (object) => now.getTime() - object.lastModified.getTime() >= this.#graceMs,
    );
    if (old.length === 0) return result;

    const held = await withTenant(
      this.#db,
      { licenseId: tenant.license_id, organizationId: tenant.organization_id },
      (tx) =>
        tx.knowledgeSource.findMany({
          where: { fileKey: { in: old.map((object) => object.key) } },
          select: { fileKey: true },
        }),
      { readOnly: true },
    );
    const keep = new Set(held.map((source) => source.fileKey));
    for (const object of old) {
      if (keep.has(object.key)) continue;
      try {
        await this.#store.delete(object.key);
        result.removed += 1;
      } catch {
        result.failed += 1;
      }
    }
    return result;
  }
}
