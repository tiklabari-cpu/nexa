/**
 * Boots a real platform-api server for integration tests (tm 389.3) — the
 * platform twin of `startTestServer`: real Fastify, real Postgres as
 * `siyahtus_platform` (the run's own `DATABASE_PLATFORM_URL`, derived by
 * `with-test-datastores.ts`), real Redis. Same database as the tenant server
 * of the same run, so a suite can act here and read the effect there.
 */
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import {
  buildPlatformServer,
  PLATFORM_PREFIX,
  type BuildPlatformServerOptions,
} from '../../src/platform-server.js';
import { testEnv } from './fixtures.js';

type Headers = Record<string, string>;

export interface PlatformTestServer {
  app: FastifyInstance;
  close: () => Promise<void>;
  /** Prefixes `/platform/v1` so tests read as the route, not the mount. */
  url: (path: string) => string;
  get: (path: string, headers?: Headers) => Promise<LightMyRequestResponse>;
  post: (path: string, payload?: unknown, headers?: Headers) => Promise<LightMyRequestResponse>;
}

export async function buildPlatformTestServer(
  overrides: Partial<NodeJS.ProcessEnv> = {},
  build: Partial<Omit<BuildPlatformServerOptions, 'env'>> = {},
): Promise<PlatformTestServer> {
  const app = await buildPlatformServer({ env: testEnv(overrides), ...build });
  await app.ready();

  const url = (path: string): string => `${PLATFORM_PREFIX}${path}`;
  return {
    app,
    url,
    get: (path, headers = {}) => app.inject({ method: 'GET', url: url(path), headers }),
    post: (path, payload, headers = {}) =>
      app.inject({
        method: 'POST',
        url: url(path),
        headers,
        ...(payload === undefined ? {} : { payload: payload as object }),
      }),
    close: async () => {
      await app.close();
    },
  };
}
