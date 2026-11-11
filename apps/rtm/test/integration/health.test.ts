/**
 * `GET /health` — the gateway's own readiness probe (M-ENV-b · §D113/K3).
 * `GET /health/live` and `GET /health/ready` (M-OPS-a) sit alongside it: the
 * liveness/readiness split from `apps/api/src/routes/health.ts`, mirrored here
 * since the gateway probes the same Postgres for the same reason.
 *
 * Every agent login reads Postgres (`auth.ts`), so a health check that only
 * pings Redis can say `ok` while every login in the process is about to fail.
 * This suite proves the database is actually part of the answer: a real
 * server against a real Postgres reports `ok`, and the same server pointed at
 * a connection string nothing is listening on reports `degraded` + 503 —
 * without ever bringing Redis down, so the failure is attributable to the
 * dependency the test broke.
 *
 * Since tm 454 (F35) every body is the narrow one, whoever asks — a
 * workspace owner's token included: region, version and the socket count are
 * the deployment's, and a workspace admin is a tenant (until then an admin
 * token got them, M-SEC-b2). `/health` and `/health/ready` share one
 * dependency probe, one in flight at a time and reused for a second
 * (tm 454 · F34) — a burst of health requests is one `SELECT 1`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HEALTH_PROBE_TTL_MS } from '../../src/health-probe.js';
import { grantToken, ownerClient, seedRtmFixtures } from '../helpers/fixtures.js';
import { startRtm } from '../helpers/rtm-harness.js';

interface HealthBody {
  status: 'ok' | 'degraded' | 'draining';
  service: string;
  uptime_s?: number;
}

async function getHealth(
  port: number,
  authorization?: string,
): Promise<{ statusCode: number; body: HealthBody }> {
  return getHealthAt(port, '/health', authorization);
}

async function getHealthAt(
  port: number,
  path: string,
  authorization?: string,
): Promise<{ statusCode: number; body: HealthBody }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: authorization ? { authorization } : {},
  });
  return { statusCode: response.status, body: (await response.json()) as HealthBody };
}

// An owner-role bearer token (admin+) and an agent-role one (below admin),
// minted once for the whole file the way `apps/api/test/integration/
// health.test.ts` does — every test here only reads `/health`.
const owner = ownerClient();
let adminAuth: string;
let agentAuth: string;

beforeAll(async () => {
  const fx = await seedRtmFixtures(owner);
  const [adminToken, agentToken] = await Promise.all([
    grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: [],
    }),
    grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: [],
    }),
  ]);
  adminAuth = `Bearer ${adminToken}`;
  agentAuth = `Bearer ${agentToken}`;
});

afterAll(async () => {
  await owner.$disconnect();
});

describe('GET /health', () => {
  it('reports ok with both dependencies up', async () => {
    const rtm = await startRtm();
    try {
      const { statusCode, body } = await getHealth(rtm.port);

      expect(statusCode).toBe(200);
      expect(body).toEqual({ status: 'ok', service: 'rtm' });
    } finally {
      await rtm.close();
    }
  });

  it('reports degraded + 503 when Postgres is unreachable, without taking Redis down', async () => {
    // Nothing listens on this port. `connect_timeout=1` keeps Prisma's own
    // failure comfortably under the probe's 2s timeout. `runtimeDatabaseUrl`
    // prefers `DATABASE_APP_URL` when set (test isolation gives every run its
    // own), so both must be overridden or the probe would still reach the
    // real one.
    const brokenUrl = 'postgresql://baduser:badpass@127.0.0.1:1/nonexistent_db?connect_timeout=1';
    const rtm = await startRtm({ DATABASE_URL: brokenUrl, DATABASE_APP_URL: brokenUrl });
    try {
      const { statusCode, body } = await getHealth(rtm.port);

      expect(statusCode).toBe(503);
      expect(body).toEqual({ status: 'degraded', service: 'rtm' });
    } finally {
      await rtm.close();
    }
  });
});

describe('GET /health — the narrow body for every caller, a workspace admin included (tm 454 · F35)', () => {
  it('gives an owner-role caller only status + service — no region, version or socket count', async () => {
    // The owner is the highest tenant role; before tm 454 this token read the
    // region, the version, the connection count and its ceiling.
    const rtm = await startRtm({ RTM_MAX_CONNECTIONS: '4096' });
    try {
      const { statusCode, body } = await getHealth(rtm.port, adminAuth);

      expect(statusCode).toBe(200);
      expect(body).toEqual({ status: 'ok', service: 'rtm' });
    } finally {
      await rtm.close();
    }
  });

  it('gives an agent-role caller and an anonymous one the same body', async () => {
    const rtm = await startRtm();
    try {
      expect(await getHealth(rtm.port, agentAuth)).toEqual({
        statusCode: 200,
        body: { status: 'ok', service: 'rtm' },
      });
      expect(await getHealth(rtm.port)).toEqual({
        statusCode: 200,
        body: { status: 'ok', service: 'rtm' },
      });
    } finally {
      await rtm.close();
    }
  });

  it('answers an admin token while Postgres is down without looking it up — 503 degraded, same as anyone', async () => {
    // The token is never resolved any more, so a database that cannot verify
    // it cannot slow the answer down either.
    const brokenUrl = 'postgresql://baduser:badpass@127.0.0.1:1/nonexistent_db?connect_timeout=1';
    const rtm = await startRtm({ DATABASE_URL: brokenUrl, DATABASE_APP_URL: brokenUrl });
    try {
      const { statusCode, body } = await getHealth(rtm.port, adminAuth);

      expect(statusCode).toBe(503);
      expect(body).toEqual({ status: 'degraded', service: 'rtm' });
    } finally {
      await rtm.close();
    }
  });
});

describe('/health and /health/ready share one probe (tm 454 · F34)', () => {
  it('answers 100 concurrent requests from a single dependency probe', async () => {
    const rtm = await startRtm();
    try {
      const answers = await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          getHealthAt(rtm.port, i % 2 === 0 ? '/health/ready' : '/health'),
        ),
      );

      for (const answer of answers) {
        expect(answer).toEqual({ statusCode: 200, body: { status: 'ok', service: 'rtm' } });
      }
      expect(rtm.server.healthProbe.runs).toBe(1);
    } finally {
      await rtm.close();
    }
  });

  it('probes again once the result is older than the TTL', async () => {
    const rtm = await startRtm();
    try {
      await getHealthAt(rtm.port, '/health/ready');
      await getHealthAt(rtm.port, '/health/ready');
      expect(rtm.server.healthProbe.runs).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, HEALTH_PROBE_TTL_MS + 50));
      expect(await getHealthAt(rtm.port, '/health/ready')).toEqual({
        statusCode: 200,
        body: { status: 'ok', service: 'rtm' },
      });
      expect(rtm.server.healthProbe.runs).toBe(2);
    } finally {
      await rtm.close();
    }
  });

  it('answers 503 draining the moment the drain starts, ahead of a cached ok', async () => {
    const rtm = await startRtm({ SHUTDOWN_DRAIN_MS: '1000' });
    let closing: Promise<void> | null = null;
    try {
      expect((await getHealthAt(rtm.port, '/health/ready')).statusCode).toBe(200);

      // Inside the TTL: an `ok` is cached, and must not be what answers.
      closing = rtm.close();
      expect(await getHealthAt(rtm.port, '/health/ready')).toEqual({
        statusCode: 503,
        body: { status: 'draining', service: 'rtm' },
      });
      expect(await getHealthAt(rtm.port, '/health')).toEqual({
        statusCode: 503,
        body: { status: 'draining', service: 'rtm' },
      });
      expect(rtm.server.healthProbe.runs).toBe(1);
    } finally {
      await (closing ?? rtm.close());
    }
  });
});

describe('GET /health/live — liveness never touches a dependency (M-OPS-a)', () => {
  it('reports 200 even when Postgres is unreachable', async () => {
    const brokenUrl = 'postgresql://baduser:badpass@127.0.0.1:1/nonexistent_db?connect_timeout=1';
    const rtm = await startRtm({ DATABASE_URL: brokenUrl, DATABASE_APP_URL: brokenUrl });
    try {
      // Confirms /health/ready genuinely observes the break (otherwise this
      // test would prove nothing about /health/live being different).
      const ready = await getHealthAt(rtm.port, '/health/ready');
      expect(ready.statusCode).toBe(503);

      const { statusCode, body } = await getHealthAt(rtm.port, '/health/live');
      expect(statusCode).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.service).toBe('rtm');
    } finally {
      await rtm.close();
    }
  });

  it('answers anonymously with no admin-only fields, same as an anonymous /health', async () => {
    const rtm = await startRtm();
    try {
      const { statusCode, body } = await getHealthAt(rtm.port, '/health/live', adminAuth);
      expect(statusCode).toBe(200);
      expect(body).toEqual({ status: 'ok', service: 'rtm', uptime_s: expect.any(Number) });
    } finally {
      await rtm.close();
    }
  });
});

describe('GET /health/ready — readiness probes for real, narrow body always (M-OPS-a)', () => {
  it('reports 200 with the narrow body when every dependency is up', async () => {
    const rtm = await startRtm();
    try {
      const { statusCode, body } = await getHealthAt(rtm.port, '/health/ready');
      expect(statusCode).toBe(200);
      expect(body).toEqual({ status: 'ok', service: 'rtm' });
    } finally {
      await rtm.close();
    }
  });

  it('reports 503 with the narrow body when Postgres is unreachable, even for an admin caller', async () => {
    const brokenUrl = 'postgresql://baduser:badpass@127.0.0.1:1/nonexistent_db?connect_timeout=1';
    const rtm = await startRtm({ DATABASE_URL: brokenUrl, DATABASE_APP_URL: brokenUrl });
    try {
      // No admin/anonymous split here (unlike /health) — an orchestrator
      // probe never presents a bearer token, so the body stays narrow
      // regardless of what is presented.
      const { statusCode, body } = await getHealthAt(rtm.port, '/health/ready', adminAuth);
      expect(statusCode).toBe(503);
      expect(body).toEqual({ status: 'degraded', service: 'rtm' });
    } finally {
      await rtm.close();
    }
  });
});
