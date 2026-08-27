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
 * Since M-SEC-b2 (§D116 MEDIUM (b)) the `/health` body has two shapes, the
 * same split as `apps/api/src/routes/health.ts`: region/connection-count/
 * dependency detail is infrastructure fingerprinting, admin-role bearer token
 * only. `/health/live` never touches a dependency and `/health/ready` never
 * splits by identity — both are meant for an orchestrator, not a person.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedRtmFixtures } from '../helpers/fixtures.js';
import { startRtm } from '../helpers/rtm-harness.js';

interface HealthBody {
  status: 'ok' | 'degraded';
  service: string;
  region?: string;
  connections?: number;
  max_connections?: number | null;
  uptime_s?: number;
  dependencies?: {
    database: { status: 'up' | 'down'; error?: string };
    redis: { status: 'up' | 'down'; error?: string };
  };
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
  it('reports ok with both dependencies up for an admin caller', async () => {
    const rtm = await startRtm();
    try {
      const { statusCode, body } = await getHealth(rtm.port, adminAuth);

      expect(statusCode).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.service).toBe('rtm');
      expect(body.dependencies?.database).toEqual({ status: 'up' });
      expect(body.dependencies?.redis).toEqual({ status: 'up' });
    } finally {
      await rtm.close();
    }
  });

  it('reports the connection ceiling next to the count it bounds (M-LOAD-CAP)', async () => {
    // A count of open sockets means nothing on its own: 4000 is healthy under
    // one ceiling and a page under another. Reported together, from one read,
    // so the two cannot be compared across two different moments.
    const withCeiling = await startRtm({ RTM_MAX_CONNECTIONS: '4096' });
    try {
      const { body } = await getHealth(withCeiling.port, adminAuth);
      expect(body.connections).toBe(0);
      expect(body.max_connections).toBe(4096);
    } finally {
      await withCeiling.close();
    }

    // Unset is unlimited, and says so — an absent field would read as "this
    // build does not report it", which is the wrong thing to conclude while
    // deciding whether a pod is near its limit.
    const unlimited = await startRtm();
    try {
      const { body } = await getHealth(unlimited.port, adminAuth);
      expect(body).toHaveProperty('max_connections', null);
    } finally {
      await unlimited.close();
    }
  });

  it('reports degraded + 503 when Postgres is unreachable, without taking Redis down', async () => {
    // Nothing listens on this port. `connect_timeout=1` keeps Prisma's own
    // failure comfortably under the probe's 2s timeout — without it, the two
    // race close enough (~2.0-2.1s either way) to flip which error surfaces.
    // `runtimeDatabaseUrl` prefers `DATABASE_APP_URL` when set (test isolation
    // gives every run its own), so both must be overridden or the probe would
    // still reach the real one.
    //
    // Anonymous on purpose (M-SEC-b2): resolving *any* bearer token — admin's
    // included — is itself a query against this same Postgres, so a token
    // presented here cannot be verified either. The dependency detail
    // (including the redacted error class this test used to assert on
    // directly) is consequently unreachable through this endpoint in exactly
    // the scenario where Postgres is what is down; see the next `describe`
    // for that fail-closed property proved with a bearer token attached.
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

describe('GET /health — anonymous and non-admin bodies are narrowed (M-SEC-b2 · §D116 MEDIUM (b))', () => {
  it('gives an anonymous caller only status + service', async () => {
    const rtm = await startRtm();
    try {
      const { statusCode, body } = await getHealth(rtm.port);

      expect(statusCode).toBe(200);
      expect(body).toEqual({ status: 'ok', service: 'rtm' });
    } finally {
      await rtm.close();
    }
  });

  it('gives an agent-role caller (below admin) only status + service too', async () => {
    const rtm = await startRtm();
    try {
      const { statusCode, body } = await getHealth(rtm.port, agentAuth);

      expect(statusCode).toBe(200);
      expect(body).toEqual({ status: 'ok', service: 'rtm' });
    } finally {
      await rtm.close();
    }
  });

  it('fails closed to the narrow body even with a valid admin token, when Postgres — what verifies it — is itself down', async () => {
    // The interesting case: `adminAuth` resolves to the owner role against a
    // healthy database (proved above). Pointed at a database nothing is
    // listening on, that same token cannot be verified — `wantsHealthDetail`
    // (server.ts) fails closed rather than hanging or throwing — so the
    // response is exactly what an anonymous caller would get, not a 500.
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
