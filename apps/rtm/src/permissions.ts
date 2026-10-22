/**
 * The permission matrix on the gateway (RL-02 · tm 325.3): the snapshot loader
 * behind the gateway's `PermissionMatrixCache`, and what keeps an *open*
 * socket's reach in step with the matrix.
 *
 * A login reads the matrix at the version it finds, exactly as the REST edge
 * does per request. A socket, though, outlives its login: the fan-out decides
 * every push from the `groupIds`/`unrestricted` the login wrote, so a Founder
 * switching "Ekip Üyesi bütün sohbetleri görsün" on or off has to reach the
 * sockets already open — within the minute, without anybody logging in again
 * (the KK says "API ve RTM"). Two ways in, for the reason the cache has two:
 *
 *   1. the API announces `<licence>:<version>` on `permissions.changed` after
 *      the commit; the gateway drops that workspace's snapshot and derives the
 *      reach of its member sockets again — at once;
 *   2. a sweep every {@link AUTHORITY_SWEEP_MS} compares each workspace's
 *      version with the one its sockets were derived at, and derives again
 *      where they differ — what catches an announcement nobody heard (a Redis
 *      blip, this process reconnecting). Correctness never rests on (1).
 *
 * Deriving again re-reads the role too, so a demotion that happened meanwhile
 * lands with the matrix change rather than at the next login.
 */
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import {
  PERMISSIONS_CHANGED_CHANNEL,
  parsePermissionsChangedMessage,
  permissionMatrixFromRows,
  type PermissionMatrixCache,
  type PermissionMatrixRow,
  type PermissionMatrixSnapshot,
  type PermissionMatrixTenant,
} from '@siyahtus/types';
import type { SocketAuthenticator } from './auth.js';
import type { ConnectionRegistry } from './connection.js';

/**
 * How often the gateway checks the versions behind its open member sockets.
 * Half the cache's minute, so a lost announcement is caught well inside the
 * bound the KK states.
 */
export const AUTHORITY_SWEEP_MS = 30_000;

/**
 * The snapshot statement the API runs (`apps/api/src/services/auth/
 * permission-matrix.ts` · `readPermissionMatrix`): version and rows in one
 * statement, so they describe the same matrix. Under the workspace's tenant
 * context, so RLS applies as it does there.
 */
export function rtmPermissionMatrixLoader(
  db: PrismaClient,
): (tenant: PermissionMatrixTenant) => Promise<PermissionMatrixSnapshot> {
  return ({ licenseId, organizationId }) =>
    db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_license', ${licenseId.toString()}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_organization', ${organizationId}, true)`;
      const rows = await tx.$queryRaw<PermissionMatrixRow[]>`
        SELECT l.permissions_version AS version, o.role, o.capability, o.value
          FROM licenses l
          LEFT JOIN role_capability_overrides o ON o.license_id = l.id
         WHERE l.id = ${licenseId}
         ORDER BY o.role, o.capability`;
      return permissionMatrixFromRows(rows);
    });
}

/** Derives the reach of open member sockets again when a workspace's matrix moves. */
export class AuthorityRefresher {
  /** One chain per licence: a refresh starts after the one before it, so the last word is the newest read. */
  readonly #chains = new Map<string, Promise<void>>();

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly authenticator: SocketAuthenticator,
    private readonly log: Logger,
  ) {}

  /** Derive again every member socket of `licenseId`, or of every licence on this node. */
  async refresh(licenseId?: string): Promise<void> {
    const licences =
      licenseId !== undefined
        ? [licenseId]
        : [...new Set(this.registry.members().map((c) => c.licenseId ?? ''))];
    await Promise.all(licences.filter((l) => l !== '').map((l) => this.#queue(l)));
  }

  /**
   * One pass of the sweep: for every licence with member sockets here, read
   * its version and refresh it if any socket was derived at another one.
   * Licence by licence, so a node hosting many workspaces spreads the reads.
   */
  async sweep(): Promise<void> {
    const byLicence = new Map<string, { organizationId: string; versions: Set<number> }>();
    for (const connection of this.registry.members()) {
      if (!connection.licenseId || !connection.authority) continue;
      const entry = byLicence.get(connection.licenseId) ?? {
        organizationId: connection.organizationId,
        versions: new Set<number>(),
      };
      entry.versions.add(connection.authority.version);
      byLicence.set(connection.licenseId, entry);
    }
    for (const [licenseId, { organizationId, versions }] of byLicence) {
      try {
        const current = await this.authenticator.matrixVersion(licenseId, organizationId);
        if (versions.size > 1 || !versions.has(current)) await this.#queue(licenseId);
      } catch (error) {
        this.log.warn({ err: error, license_id: licenseId }, 'permission sweep skipped a licence');
      }
    }
  }

  #queue(licenseId: string): Promise<void> {
    const previous = this.#chains.get(licenseId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.#refreshLicence(licenseId));
    this.#chains.set(licenseId, next);
    void next.finally(() => {
      if (this.#chains.get(licenseId) === next) this.#chains.delete(licenseId);
    });
    return next;
  }

  async #refreshLicence(licenseId: string): Promise<void> {
    for (const connection of this.registry.members(licenseId)) {
      const authority = connection.authority;
      if (!authority || !connection.actorId) continue;
      try {
        const reach = await this.authenticator.reassess({
          licenseId,
          organizationId: connection.organizationId,
          actorId: connection.actorId,
          authority,
        });
        // The socket may have gone while the read ran; a gone one has nothing to update.
        if (this.registry.get(connection.id) !== connection) continue;
        connection.groupIds = reach.groupIds;
        connection.unrestricted = reach.unrestricted;
        connection.authority = { ...authority, version: reach.version };
      } catch (error) {
        // Left as it was: the sweep tries again, since its version is still the old one.
        this.log.warn(
          { err: error, license_id: licenseId, connection_id: connection.id },
          'socket reach not re-derived after a permission change',
        );
      }
    }
  }
}

/**
 * Listen for `permissions.changed` on `subscriber` — a connection of its own,
 * since a subscribed client can do nothing else. An announcement this cannot
 * read drops every workspace's snapshot and re-derives every socket, the
 * shape the API's listener has.
 */
export async function listenForPermissionsChanges(
  subscriber: Redis,
  cache: PermissionMatrixCache,
  refresher: AuthorityRefresher,
  log: Logger,
): Promise<void> {
  subscriber.on('message', (channel: string, message: string) => {
    if (channel !== PERMISSIONS_CHANGED_CHANNEL) return;
    const licenseId = parsePermissionsChangedMessage(message)?.licenseId;
    cache.invalidate(licenseId);
    refresher.refresh(licenseId?.toString()).catch((error: unknown) => {
      log.warn({ err: error }, 'socket reach not re-derived after a permission change');
    });
  });
  await subscriber.subscribe(PERMISSIONS_CHANGED_CHANNEL);
}
