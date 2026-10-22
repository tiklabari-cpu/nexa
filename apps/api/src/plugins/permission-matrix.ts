/**
 * `app.permissionMatrix` — each workspace's permission matrix, cached for a
 * minute, and the announcement that drops it everywhere (tm 325.2 · RL-02).
 *
 * The cache and its version rules are `@siyahtus/types`' (`permission-matrix.ts`)
 * so the RTM gateway can hold the same one; the loader is this process's
 * (`services/auth/permission-matrix.ts`). A change is announced on
 * `permissions.changed` after its commit; this process drops its own copy
 * first, so the Founder's next read here never waits on Redis.
 *
 * The subscription has a connection of its own — a subscribed client can do
 * nothing else — and is never a reason not to boot: without it every process
 * still reads a change within the cache's minute.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { PermissionMatrixCache } from '@siyahtus/types';
import {
  listenForPermissionsChanges,
  publishPermissionsChanged,
} from '../services/auth/permission-events.js';
import { prismaPermissionMatrixLoader } from '../services/auth/permission-matrix.js';

export interface PermissionMatrixService {
  readonly cache: PermissionMatrixCache;
  /**
   * Tell every process, this one included, that `licenseId`'s matrix reached
   * `version`. Call after the commit. Never throws: an announcement Redis
   * did not take is caught up by the cache's minute.
   */
  announce(licenseId: bigint, version: number): Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    permissionMatrix: PermissionMatrixService;
  }
}

async function permissionMatrixPlugin(app: FastifyInstance): Promise<void> {
  const log = app.log.child({ component: 'permission-matrix' });
  const cache = new PermissionMatrixCache({ load: prismaPermissionMatrixLoader(app.db) });

  const service: PermissionMatrixService = {
    cache,
    async announce(licenseId, version) {
      cache.invalidate(licenseId);
      try {
        await publishPermissionsChanged(app.redis, licenseId, version);
      } catch (error) {
        log.warn(
          { err: error, license_id: licenseId.toString(), version },
          'permissions.changed not announced; other processes refresh within a minute',
        );
      }
    },
  };
  app.decorate('permissionMatrix', service);

  const subscriber = app.redis.duplicate({ connectionName: 'siyahtus-api-permissions' });
  subscriber.on('error', (error) => {
    log.error({ err: error }, 'redis permissions.changed subscriber error');
  });
  await listenForPermissionsChanges(subscriber, (licenseId) => cache.invalidate(licenseId)).catch(
    (error: unknown) => {
      log.warn({ err: error }, 'permissions.changed not subscribed; matrices refresh every minute');
    },
  );
  app.addHook('onClose', async () => {
    await subscriber.quit().catch(() => subscriber.disconnect());
  });
}

export default fp(permissionMatrixPlugin, {
  name: 'permission-matrix',
  dependencies: ['database', 'redis'],
});
