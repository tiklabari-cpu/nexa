/**
 * Boots a real server for integration tests — real Fastify, real plugins, real
 * Postgres, real Redis. `app.inject()` skips only the network socket.
 *
 * Deliberately not mocking the database: the properties under test here
 * (row level security, single-use codes, refresh rotation) live *in* Postgres.
 * A mocked repository would assert that the test double behaves, which is not
 * the question.
 */
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
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
  put: (path: string, payload?: unknown, headers?: Headers) => Promise<LightMyRequestResponse>;
  patch: (path: string, payload?: unknown, headers?: Headers) => Promise<LightMyRequestResponse>;
  del: (path: string, headers?: Headers) => Promise<LightMyRequestResponse>;
}

export async function startTestServer(
  overrides: Partial<NodeJS.ProcessEnv> = {},
  /** Everything `buildServer` takes besides `env` — currently the mailer. */
  build: Partial<Omit<BuildServerOptions, 'env'>> = {},
): Promise<TestServer> {
  // `in_process` (tm 289.5): this server's AI job worker answers what its own
  // requests wrote, never another open server's — a suite holding two, one of
  // them with a stubbed model, would otherwise race their workers for a job.
  const app = await buildServer({
    env: testEnv(overrides),
    aiJobDiscovery: 'in_process',
    // The AI's disclosure (tm 308) changes every first reply's text: off for
    // the suites about something else; `ai-request-human` turns it on.
    aiDisclosure: false,
    ...build,
  });
  await app.ready();

  const url = (path: string): string => `${API_PREFIX}${path}`;

  /**
   * One request, returned once the AI jobs it set off have run (tm 256.10 ·
   * tm 289.5): a visitor's message is answered after its response, by the AI
   * job worker, so a suite asserting on the answer would otherwise race it.
   * These helpers read the state the visitor eventually sees; a test about the
   * gap itself — the response arriving before the answer — calls `app.inject`
   * directly.
   */
  const request = async (options: InjectOptions): Promise<LightMyRequestResponse> => {
    const response = await app.inject(options);
    await app.aiJobs.idle();
    // A queued test run is played after its 202 (tm 314.2): the suite reads
    // its results the way the Test tab reads them once it has finished.
    await app.aiTestRuns.idle();
    // A counted model call tells the AI usage alerts after it settles, and they
    // run beside the response (tm 283.3); a suite that resets the database
    // next must not TRUNCATE under their transaction.
    await app.aiUsageAlerts.idle();
    // A raised or cleared risk flag is announced beside the response too (tm
    // 302.2): the push, the webhook, the urgent mail.
    await app.riskFlags.idle();
    return response;
  };

  return {
    app,
    url,
    get: (path, headers = {}) => request({ method: 'GET', url: url(path), headers }),
    post: (path, payload, headers = {}) =>
      request({
        method: 'POST',
        url: url(path),
        headers,
        ...(payload === undefined ? {} : { payload: payload as object }),
      }),
    put: (path, payload, headers = {}) =>
      request({
        method: 'PUT',
        url: url(path),
        headers,
        ...(payload === undefined ? {} : { payload: payload as object }),
      }),
    patch: (path, payload, headers = {}) =>
      request({
        method: 'PATCH',
        url: url(path),
        headers,
        ...(payload === undefined ? {} : { payload: payload as object }),
      }),
    del: (path, headers = {}) => request({ method: 'DELETE', url: url(path), headers }),
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
