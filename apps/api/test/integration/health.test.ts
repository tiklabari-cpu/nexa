/**
 * `GET /health`'s `scheduler` block (M-SCHED-b, sixth job M-SCHED-e · §D113/K1).
 *
 * The dependency probes (`database`, `redis`) already existed and are
 * unchanged by this slice. What is new is the one thing `/health` used to be
 * unable to say: whether the background sweeps are actually ticking in this
 * process, or registered and silent — the exact ambiguity that let a
 * `make dev` with no scheduler at all look identical to one that simply had
 * nothing to sweep.
 *
 * Boots the real server (`buildServer`) rather than the route in isolation,
 * because `app.scheduler` only exists once the real plugin chain has run —
 * the same reason `contract-parity.test.ts` and `scheduler-lock.test.ts` boot
 * real servers rather than stubbing around them.
 */
import { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { startTestServer } from '../helpers/server.js';

interface SchedulerJobBody {
  name: string;
  interval_ms: number;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
}

interface HealthBody {
  scheduler: { enabled: boolean; jobs: SchedulerJobBody[] };
  providers: {
    mail: string;
    push: string;
    storage: string;
    payment: string;
    siem: string;
    llm: string;
    virus_scanner: string;
  };
}

describe('GET /health — scheduler', () => {
  it('lists every registered job, disabled by default under test', async () => {
    const server = await startTestServer();
    try {
      const response = await server.get('/health');
      expect(response.statusCode).toBe(200);
      const body = response.json() as HealthBody;

      expect(body.scheduler.enabled).toBe(false);
      expect(body.scheduler.jobs.map((job) => job.name)).toEqual([
        'chat_timeout',
        'sla',
        'siem',
        'scheduled_reports',
        'retention',
        'webhook_redelivery',
      ]);
      // Registered but never ticked — `SCHEDULER_ENABLED` defaults to off
      // under `NODE_ENV=test` (env.ts), same as every other suite's server.
      for (const job of body.scheduler.jobs) {
        expect(job.last_run_at).toBeNull();
      }
    } finally {
      await server.close();
    }
  });

  it('marks retention disabled from registration — no other job is gated', async () => {
    const server = await startTestServer();
    try {
      const body = (await server.get('/health')).json() as HealthBody;
      const byName = Object.fromEntries(body.scheduler.jobs.map((job) => [job.name, job]));

      expect(byName['retention']).toMatchObject({ enabled: false, last_status: 'disabled' });
      for (const name of [
        'chat_timeout',
        'sla',
        'siem',
        'scheduled_reports',
        'webhook_redelivery',
      ]) {
        expect(byName[name]).toMatchObject({ enabled: true, last_status: null });
      }
    } finally {
      await server.close();
    }
  });

  it('names which implementation each mockable dependency runs', async () => {
    const server = await startTestServer();
    try {
      const body = (await server.get('/health')).json() as HealthBody;

      // Straight off the validated env (`fixtures.ts`'s `testEnv()`), not a
      // separate snapshot — so this can never drift from what `server.ts`
      // actually built the factories with.
      expect(body.providers).toEqual({
        mail: 'null',
        push: 'null',
        storage: 'local',
        payment: 'mock',
        siem: 'file',
        llm: 'mock',
        virus_scanner: 'mock',
      });
    } finally {
      await server.close();
    }
  });

  it('reflects SCHEDULER_ENABLED and RETENTION_ENABLED from the environment', async () => {
    const server = await startTestServer({ SCHEDULER_ENABLED: 'true', RETENTION_ENABLED: 'true' });
    try {
      const body = (await server.get('/health')).json() as HealthBody;

      expect(body.scheduler.enabled).toBe(true);
      expect(body.scheduler.jobs.every((job) => job.enabled)).toBe(true);
    } finally {
      // Stops the now-running scheduler (`onClose`) before the process moves
      // on — the same reason `scheduler.test.ts` never lets a started one
      // outlive its test.
      await server.close();
    }
  });
});

describe('GET /health — body shape (M4-a · §D113/K4-K6)', () => {
  it('reports status, version, region, uptime and both dependencies when everything is up', async () => {
    const server = await startTestServer();
    try {
      const response = await server.get('/health');
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        status: string;
        service: string;
        version: string;
        region: string;
        uptime_s: number;
        dependencies: {
          database: { status: string; latency_ms: number };
          redis: { status: string; latency_ms: number };
        };
      };

      expect(body.status).toBe('ok');
      expect(body.service).toBe('api');
      expect(typeof body.version).toBe('string');
      expect(typeof body.region).toBe('string');
      expect(body.uptime_s).toBeGreaterThanOrEqual(0);
      expect(body.dependencies.database).toMatchObject({ status: 'up' });
      expect(body.dependencies.redis).toMatchObject({ status: 'up' });
    } finally {
      await server.close();
    }
  });
});

describe('GET /health — degraded when a dependency is down (M4-a · §D113/K4-K6)', () => {
  it('returns 503 with dependencies.redis down, without touching the shared test Redis', async () => {
    const server = await startTestServer();
    try {
      // A dedicated, deliberately unreachable client swapped onto *this*
      // server instance — not the connection `with-test-datastores` handed
      // the whole run, which every other suite sharing the process still
      // needs. `redisPlugin`'s own `await redis.ping()` at boot means a bad
      // `REDIS_URL` fails server startup outright (by design — see
      // `plugins/redis.ts`), so the only way to observe the probe's 503 path
      // is to break the connection after boot, not before it.
      const broken = new Redis('redis://127.0.0.1:1/0', {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      });
      broken.on('error', () => {
        // ioredis emits on every failed attempt; a bare listener just stops
        // that from crashing the process, same as `redisPlugin` does.
      });
      server.app.redis = broken;

      try {
        const response = await server.get('/health');
        expect(response.statusCode).toBe(503);
        const body = response.json() as {
          status: string;
          dependencies: { database: { status: string }; redis: { status: string } };
        };
        expect(body.status).toBe('degraded');
        expect(body.dependencies.redis.status).toBe('down');
        expect(body.dependencies.database.status).toBe('up');
      } finally {
        broken.disconnect();
      }
    } finally {
      await server.close();
    }
  });
});
