/**
 * A workspace's permission matrix as the servers hold it (RL-02 · tm 325.2):
 * the stored choices, the version that names them, the cache both processes
 * keep, and the message that tells them a choice changed.
 *
 * `licenses.permissions_version` is the matrix's revision: 0 for a workspace
 * that never touched it, plus one for every `PUT /settings/permissions` that
 * changed a stored row, bumped in the same transaction as the rows. A snapshot
 * is the version and the rows read in one statement, so the two always
 * describe the same matrix.
 *
 * How a change reaches a session (the KK's "≤ 60 s, without signing in again"):
 *
 *   1. the PUT commits the rows and the new version together;
 *   2. after the commit it announces `<licence>:<version>` on
 *      {@link PERMISSIONS_CHANGED_CHANNEL}, and every process drops that
 *      workspace's cached snapshot (the version is for the log line);
 *   3. a reader that knows the version it wants — read with something it was
 *      reading anyway, like `/auth/me`'s licence row — passes it to
 *      {@link PermissionMatrixCache.get}, and an entry with any other version
 *      is read again;
 *   4. whatever was missed (a Redis blip, a process restarting while the
 *      message went by) is read again when the entry's minute runs out.
 *
 * So the announcement is a shortcut and the minute is the bound: correctness
 * never rests on a message arriving. Announcing before the commit would let a
 * process re-read the old rows and keep them as fresh — which step 3 catches
 * only for a reader that knows the version — so the order is commit, then
 * announce.
 *
 * Here rather than in `apps/api` because the RTM gateway has to answer from
 * the same snapshot the REST edge does (tm 145); each process brings its own
 * loader, the rules are this one.
 */
import type { CapabilityOverride } from './capabilities.js';

/** The Redis channel a matrix change is announced on, after its commit. */
export const PERMISSIONS_CHANGED_CHANNEL = 'permissions.changed';

/** How long a process reuses a workspace's snapshot without hearing of a change. */
export const PERMISSIONS_CACHE_TTL_MS = 60_000;

/**
 * Cells one `PUT /settings/permissions` may name. The matrix has fewer than
 * this many cells (capabilities × columns), so a whole-matrix save fits; the
 * cap bounds the request, not the screen.
 */
export const MAX_PERMISSION_CHANGES = 200;

/** A workspace's stored choices and the version that names them. */
export interface PermissionMatrixSnapshot {
  readonly version: number;
  readonly overrides: readonly CapabilityOverride[];
}

/** Whose matrix: the licence it is keyed by, and the organization RLS needs to read it. */
export interface PermissionMatrixTenant {
  readonly licenseId: bigint;
  readonly organizationId: string;
}

/** The announcement for `licenseId`'s matrix reaching `version`. */
export function permissionsChangedMessage(licenseId: bigint, version: number): string {
  return `${licenseId.toString()}:${version}`;
}

/**
 * What an announcement names, or `null` when it cannot be read — which the
 * listener treats as "every workspace changed": dropping the whole cache costs
 * a reload, keeping a stale entry costs a wrong answer for a minute.
 */
export function parsePermissionsChangedMessage(
  message: string,
): { licenseId: bigint; version: number } | null {
  const match = /^([1-9][0-9]{0,18}):(0|[1-9][0-9]{0,9})$/.exec(message);
  if (!match) return null;
  return { licenseId: BigInt(match[1]!), version: Number(match[2]) };
}

export interface PermissionMatrixCacheOptions {
  /** Read a workspace's version and rows — in one statement, so they agree. */
  load: (tenant: PermissionMatrixTenant) => Promise<PermissionMatrixSnapshot>;
  /** How long a snapshot is reused; {@link PERMISSIONS_CACHE_TTL_MS} by default. */
  ttlMs?: number;
  /** Milliseconds, for the expiry. */
  now?: () => number;
  /** Workspaces kept; the oldest entry goes first past this. */
  maxEntries?: number;
}

const MAX_ENTRIES = 10_000;

/**
 * Each workspace's snapshot, per process.
 *
 * Concurrent misses each read: no shared in-flight load, so a reader never
 * receives a snapshot that was being read before the version it asked for
 * existed. A load that an invalidation overtook is returned to its caller but
 * not kept.
 */
export class PermissionMatrixCache {
  readonly #load: PermissionMatrixCacheOptions['load'];
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #maxEntries: number;
  readonly #entries = new Map<string, { snapshot: PermissionMatrixSnapshot; expires: number }>();
  /** Bumped by every invalidation; a load that saw it change is not kept. */
  #generation = 0;

  constructor(options: PermissionMatrixCacheOptions) {
    this.#load = options.load;
    this.#ttlMs = options.ttlMs ?? PERMISSIONS_CACHE_TTL_MS;
    this.#now = options.now ?? Date.now;
    this.#maxEntries = options.maxEntries ?? MAX_ENTRIES;
  }

  /**
   * `tenant`'s snapshot. With `version`, an entry naming any other version is
   * read again — *any* other, not only an older one: a licence id that came
   * back (a restored database, a test that truncated with `RESTART IDENTITY`)
   * starts at 0 again, and "newer than asked" would keep the old workspace's
   * rows. What the read returns is the answer either way; the database is the
   * truth, not the caller's number.
   */
  async get(tenant: PermissionMatrixTenant, version?: number): Promise<PermissionMatrixSnapshot> {
    const key = tenant.licenseId.toString();
    const hit = this.#entries.get(key);
    if (
      hit &&
      hit.expires > this.#now() &&
      (version === undefined || hit.snapshot.version === version)
    ) {
      return hit.snapshot;
    }

    const generation = this.#generation;
    const snapshot = await this.#load(tenant);
    if (generation === this.#generation) {
      this.#entries.delete(key);
      if (this.#entries.size >= this.#maxEntries) {
        const oldest = this.#entries.keys().next().value;
        if (oldest !== undefined) this.#entries.delete(oldest);
      }
      this.#entries.set(key, { snapshot, expires: this.#now() + this.#ttlMs });
    }
    return snapshot;
  }

  /**
   * Forget `licenseId`'s snapshot, or every workspace's with no licence. Not
   * "only if older than the announced version": versions only climb in a
   * database that keeps its rows, and the one that does not (a reused licence
   * id) is exactly where comparing them would keep the wrong workspace's rows.
   * Dropping costs one read.
   */
  invalidate(licenseId?: bigint): void {
    this.#generation += 1;
    if (licenseId === undefined) this.#entries.clear();
    else this.#entries.delete(licenseId.toString());
  }
}
