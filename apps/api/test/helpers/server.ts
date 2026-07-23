/**
 * Boots a real server for integration tests — real Fastify, real plugins, real
 * Postgres, real Redis. `app.inject()` skips only the network socket.
 *
 * Deliberately not mocking the database: the properties under test here
 * (row level security, single-use codes, refresh rotation) live *in* Postgres.
 * A mocked repository would assert that the test double behaves, which is not
 * the question.
 */
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildServer, API_PREFIX, type BuildServerOptions } from '../../src/server.js';
import { testEnv } from './fixtures.js';

type Headers = Record<string, string>;

export interface TestServer {
  app: FastifyInstance;
  close: () => Promise<void>;
  /** Prefixes the API base path so tests read as the route, not the mount. */
  url: (path: string) => string;
  get: (path: string, headers?: Headers) => Promise<LightMyRequestResponse>;
  post: (path: string, payload?: unknown, headers?: Headers) => Promise<LightMyRequestResponse>;
  patch: (path: string, payload?: unknown, headers?: Headers) => Promise<LightMyRequestResponse>;
  del: (path: string, headers?: Headers) => Promise<LightMyRequestResponse>;
}

export async function startTestServer(
  overrides: Partial<NodeJS.ProcessEnv> = {},
  /** Everything `buildServer` takes besides `env` — currently the mailer. */
  build: Partial<Omit<BuildServerOptions, 'env'>> = {},
): Promise<TestServer> {
  const app = await buildServer({ env: testEnv(overrides), ...build });
  await app.ready();

  const url = (path: string): string => `${API_PREFIX}${path}`;

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
    patch: (path, payload, headers = {}) =>
      app.inject({
        method: 'PATCH',
        url: url(path),
        headers,
        ...(payload === undefined ? {} : { payload: payload as object }),
      }),
    del: (path, headers = {}) => app.inject({ method: 'DELETE', url: url(path), headers }),
    close: async () => {
      await app.close();
    },
  };
}

/**
 * Rate limiting is keyed in Redis and survives between test files. Clearing the
 * namespace keeps a test that intentionally exhausts a bucket from breaking
 * whatever runs next.
 */
export async function clearRateLimits(app: FastifyInstance): Promise<void> {
  const keys = await app.redis.keys('rl:*');
  if (keys.length > 0) await app.redis.del(...keys);
}
