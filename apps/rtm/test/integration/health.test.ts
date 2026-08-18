/**
 * `GET /health` — the gateway's own readiness probe (M-ENV-b · §D113/K3).
 *
 * Every agent login reads Postgres (`auth.ts`), so a health check that only
 * pings Redis can say `ok` while every login in the process is about to fail.
 * This suite proves the database is actually part of the answer: a real
 * server against a real Postgres reports `ok`, and the same server pointed at
 * a connection string nothing is listening on reports `degraded` + 503 —
 * without ever bringing Redis down, so the failure is attributable to the
 * dependency the test broke.
 */
import { describe, expect, it } from 'vitest';
import { startRtm } from '../helpers/rtm-harness.js';

interface HealthBody {
  status: 'ok' | 'degraded';
  service: string;
  dependencies: {
    database: { status: 'up' | 'down'; error?: string };
    redis: { status: 'up' | 'down'; error?: string };
  };
}

async function getHealth(port: number): Promise<{ statusCode: number; body: HealthBody }> {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  return { statusCode: response.status, body: (await response.json()) as HealthBody };
}

describe('GET /health', () => {
  it('reports ok with both dependencies up against a real server', async () => {
    const rtm = await startRtm();
    try {
      const { statusCode, body } = await getHealth(rtm.port);

      expect(statusCode).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.service).toBe('rtm');
      expect(body.dependencies.database).toEqual({ status: 'up' });
      expect(body.dependencies.redis).toEqual({ status: 'up' });
    } finally {
      await rtm.close();
    }
  });

  it('reports degraded + 503 when Postgres is unreachable, without taking Redis down', async () => {
    // Nothing listens on this port. `connect_timeout=1` keeps Prisma's own
    // failure comfortably under the probe's 2s timeout — without it, the two
    // race close enough (~2.0-2.1s either way) to flip which error surfaces.
    // `runtimeDatabaseUrl` prefers `DATABASE_APP_URL` when set (test isolation
    // gives every run its own), so both must be overridden or the probe would
    // still reach the real one.
    const brokenUrl = 'postgresql://baduser:badpass@127.0.0.1:1/nonexistent_db?connect_timeout=1';
    const rtm = await startRtm({ DATABASE_URL: brokenUrl, DATABASE_APP_URL: brokenUrl });
    try {
      const { statusCode, body } = await getHealth(rtm.port);

      expect(statusCode).toBe(503);
      expect(body.status).toBe('degraded');
      expect(body.dependencies.database.status).toBe('down');
      // The error class, never the driver message — which could carry the
      // connection string (including the password above).
      expect(body.dependencies.database.error).toBe('PrismaClientInitializationError');
      expect(body.dependencies.database.error).not.toMatch(/badpass/);
      expect(body.dependencies.redis).toEqual({ status: 'up' });
    } finally {
      await rtm.close();
    }
  });
});
