/**
 * `buildHealthSnapshot` and the probes (tm 389.8) — the admin `/health` body as a value. The
 * route's own behaviour (admin-gated body, 503s, draining) stays pinned by
 * `test/integration/health.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildHealthSnapshot, probe, probeDependencies } from './health-snapshot.js';

const ENV = {
  SIYAHTUS_REGION: 'eu',
  MAIL_PROVIDER: 'file',
  PUSH_PROVIDER: 'mock',
  STORAGE_PROVIDER: 'local',
  STRIPE_PROVIDER: 'mock',
  SIEM_PROVIDER: 'file',
  LLM_PROVIDER: 'mock',
  VIRUS_SCANNER: 'mock',
} as const;

const up = { status: 'up', latency_ms: 1 } as const;
const down = { status: 'down', latency_ms: 2, error: 'Error' } as const;

function fixture(healthy = true) {
  const queryRaw = vi.fn().mockResolvedValue([{ pending: 3n, running: 1n, oldest_age_s: 4.26 }]);
  const warn = vi.fn();
  return {
    queryRaw,
    warn,
    input: {
      db: { $queryRaw: queryRaw } as never,
      env: ENV as never,
      version: '1.2.3',
      uptimeS: 12.5,
      probes: { database: healthy ? up : down, redis: up, healthy },
      scheduler: { snapshot: () => ({ enabled: true, jobs: [] }) },
      eventPartitions: { snapshot: () => ({ ok: true }) as never },
      logger: { warn },
    },
  };
}

describe('buildHealthSnapshot', () => {
  it('keeps the body the route has always sent, key for key and in order', async () => {
    const body = await buildHealthSnapshot(fixture().input);
    expect(Object.keys(body)).toEqual([
      'status',
      'service',
      'version',
      'region',
      'uptime_s',
      'dependencies',
      'scheduler',
      'event_partitions',
      'ai_jobs',
      'providers',
    ]);
    expect(body).toMatchObject({
      status: 'ok',
      service: 'api',
      version: '1.2.3',
      region: 'eu',
      uptime_s: 12.5,
      ai_jobs: { pending: 3, running: 1, oldest_age_s: 4.3 },
      providers: { mail: 'file', llm: 'mock', virus_scanner: 'mock', payment: 'mock' },
    });
  });

  it('is degraded when a dependency is down, and does not read the queue through a dead database', async () => {
    const { input, queryRaw } = fixture(false);
    const body = await buildHealthSnapshot(input);
    expect(body.status).toBe('degraded');
    expect(body.ai_jobs).toBeNull();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('answers null for a queue reading that fails, and says so once', async () => {
    const { input, queryRaw, warn } = fixture();
    queryRaw.mockRejectedValue(new Error('boom'));
    const body = await buildHealthSnapshot(input);
    expect(body.ai_jobs).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('probe', () => {
  it('reports the error class only, never the driver message', async () => {
    const result = await probe('database', async () => {
      throw new TypeError('postgres://user:secret@host/db refused');
    });
    expect(result).toMatchObject({ status: 'down', error: 'TypeError' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('probes both dependencies together', async () => {
    const result = await probeDependencies({ $queryRaw: vi.fn().mockResolvedValue([]) } as never, {
      ping: vi.fn().mockRejectedValue(new Error('x')),
    });
    expect(result.database.status).toBe('up');
    expect(result.redis.status).toBe('down');
    expect(result.healthy).toBe(false);
  });
});
