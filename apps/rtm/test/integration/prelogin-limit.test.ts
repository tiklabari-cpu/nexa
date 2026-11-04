/**
 * The per-address cap on sockets that have not logged in (tm 405).
 *
 * The connection ceiling (`connection-limit.test.ts`) is global. A socket gets
 * in before it says who it is and has the 30 s login window to do so, so one
 * source that never logs in could hold enough sockets to fill that ceiling for
 * everybody else. What is asserted here is the shape of the bound, against a
 * real gateway and real sockets:
 *
 *   - the address at its cap is refused by name (429 `prelogin_limit_reached`),
 *     and its sockets already in are untouched;
 *   - a socket that logs in stops counting, and so does one that closes — the
 *     count is of sockets waiting right now, and it drains to nothing;
 *   - another address is not affected;
 *   - the address is the one the api would derive: the forwarded entry from a
 *     loopback peer at `TRUST_PROXY_HOPS=1`, the socket peer at `0` whatever the
 *     caller wrote. (A public peer cannot be produced on loopback; its forged
 *     header is pinned in `src/client-address.test.ts`.)
 *
 * Every upgrade here comes from 127.0.0.1, so at `TRUST_PROXY_HOPS=1` (the
 * default, and `.env.example`'s) the forwarded-for header is what tells two
 * test "addresses" apart — exactly the trust this suite is checking.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import WebSocket from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedRtmFixtures, type RtmFixtures } from '../helpers/fixtures.js';
import { startRtm, TestSocket } from '../helpers/rtm-harness.js';
import { createTelemetry, type Telemetry } from '../../src/telemetry/telemetry.js';

const A = '198.51.100.1';
const B = '198.51.100.2';

/** Every server a test started, closed in teardown whatever the test did. */
const running: Array<{ close: () => Promise<void> }> = [];
/** Every raw client socket a test opened, likewise. */
const raw: WebSocket[] = [];
/** Every harness socket, likewise. */
const harness: TestSocket[] = [];

let db: PrismaClient;
let fx: RtmFixtures;

beforeAll(() => {
  db = ownerClient();
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  fx = await seedRtmFixtures(db);
});

afterEach(async () => {
  while (raw.length > 0) raw.pop()?.terminate();
  while (harness.length > 0) harness.pop()?.close();
  while (running.length > 0)
    await running
      .pop()
      ?.close()
      .catch(() => {});
});

/** Collects the lines pino actually wrote, so the assertion is on output. */
class LineSink {
  readonly lines: string[] = [];
  write(chunk: string): boolean {
    this.lines.push(chunk);
    return true;
  }
  end(): void {}
  on(): void {}
  once(): void {}
  emit(): boolean {
    return false;
  }
  parsed(): Array<Record<string, unknown>> {
    return this.lines.flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
  }
}

async function start(
  overrides: Partial<NodeJS.ProcessEnv> = {},
  options: { sink?: LineSink; telemetry?: Telemetry } = {},
) {
  const rtm = await startRtm(
    overrides,
    options.sink as unknown as NodeJS.WritableStream | undefined,
    options.telemetry,
  );
  running.push({ close: rtm.close });
  return rtm;
}

/** An upgrade "from" `forwardedFor` — through a loopback peer, as a local proxy would send it. */
async function open(port: number, forwardedFor?: string): Promise<TestSocket> {
  const socket = await TestSocket.connect(port, {
    organizationId: fx.a.organizationId,
    ...(forwardedFor === undefined ? {} : { headers: { 'x-forwarded-for': forwardedFor } }),
  });
  harness.push(socket);
  return socket;
}

type UpgradeOutcome =
  | { accepted: true; ws: WebSocket }
  | {
      accepted: false;
      status: number;
      retryAfter: string | undefined;
      body: { error?: Record<string, unknown> };
    };

/** One upgrade, reporting a refusal's status and body (`unexpected-response`, as in connection-limit). */
function attemptUpgrade(port: number, forwardedFor?: string): Promise<UpgradeOutcome> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/v1/agent/rtm/ws?organization_id=${fx.a.organizationId}`,
      forwardedFor === undefined ? {} : { headers: { 'x-forwarded-for': forwardedFor } },
    );
    raw.push(ws);
    ws.on('open', () => resolve({ accepted: true, ws }));
    ws.on('unexpected-response', (_request, response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({
          accepted: false,
          status: response.statusCode ?? 0,
          retryAfter: response.headers['retry-after'],
          body: text === '' ? {} : (JSON.parse(text) as { error?: Record<string, unknown> }),
        });
      });
    });
    ws.on('error', (error: Error) => reject(error));
  });
}

async function agentToken(): Promise<string> {
  return grantToken(db, {
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
    ownerId: fx.a.agentAccountId,
    scopes: ['chats--access:rw'],
  });
}

/** Wait for the gateway to see what the client already did. */
async function until(check: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await delay(20);
  return check();
}

function refusalsCounted(metrics: ResourceMetrics[], reason: string): number {
  const latest = metrics[metrics.length - 1];
  if (!latest) return 0;
  let total = 0;
  for (const scope of latest.scopeMetrics) {
    for (const metric of scope.metrics) {
      if (metric.descriptor.name !== 'rtm.upgrades.refused') continue;
      for (const point of metric.dataPoints) {
        if (point.attributes['reason'] === reason) total += point.value as number;
      }
    }
  }
  return total;
}

describe('at the cap for one address', () => {
  it('refuses the next upgrade from it with 429, Retry-After and its reason, and leaves its sockets working (NFR-S8)', async () => {
    const rtm = await start({ RTM_MAX_PRELOGIN_PER_IP: '2' });
    const first = await open(rtm.port, A);
    const second = await open(rtm.port, A);
    expect(rtm.server.preLogin?.heldBy(A)).toBe(2);

    const refused = await attemptUpgrade(rtm.port, A);
    if (refused.accepted) throw new Error('the upgrade past the cap was accepted');
    expect(refused.status).toBe(429);
    expect(refused.retryAfter).toBe('1');
    expect(refused.body.error).toMatchObject({
      type: 'too_many_requests',
      details: { reason: 'prelogin_limit_reached' },
    });
    // Like the ceiling's refusal: the reason, never the number.
    expect(JSON.stringify(refused.body)).not.toMatch(/\b2\b|RTM_MAX_PRELOGIN|max_prelogin/i);

    // Pre-login sockets may still ping — the refusal took nothing from them.
    expect((await first.request('ping')).success).toBe(true);
    expect((await second.request('ping')).success).toBe(true);
    expect(rtm.server.registry.size).toBe(2);
    expect(rtm.server.preLogin?.heldBy(A)).toBe(2);
  });

  it('does not touch another address', async () => {
    const rtm = await start({ RTM_MAX_PRELOGIN_PER_IP: '1' });
    await open(rtm.port, A);
    expect((await attemptUpgrade(rtm.port, A)).accepted).toBe(false);

    expect((await attemptUpgrade(rtm.port, B)).accepted).toBe(true);
    expect(rtm.server.preLogin?.heldBy(B)).toBe(1);
  });

  it('counts the refusal on every upgrade and logs one line per episode, in snake_case', async () => {
    const sink = new LineSink();
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const telemetry = createTelemetry({
      serviceName: 'siyahtus-rtm-test',
      serviceVersion: '0.0.0-test',
      metricExporter: exporter,
    });
    const rtm = await start(
      { RTM_MAX_PRELOGIN_PER_IP: '1', LOG_LEVEL: 'info' },
      { sink, telemetry },
    );
    await open(rtm.port, A);

    for (let i = 0; i < 3; i += 1) expect((await attemptUpgrade(rtm.port, A)).accepted).toBe(false);

    const lines = sink
      .parsed()
      .filter((line) => String(line['msg']).startsWith('rtm pre-login limit reached'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 40,
      client_ip: A,
      prelogin_sockets: 1,
      max_prelogin_per_ip: 1,
    });

    await telemetry.flushMetrics();
    expect(refusalsCounted(exporter.getMetrics(), 'prelogin_limit_reached')).toBe(3);
  });
});

describe('rtm.upgrades.refused', () => {
  it('counts each refusal under its own reason — the ceiling is not the address cap', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const telemetry = createTelemetry({
      serviceName: 'siyahtus-rtm-test',
      serviceVersion: '0.0.0-test',
      metricExporter: exporter,
    });
    const rtm = await start(
      { RTM_MAX_CONNECTIONS: '1', RTM_MAX_PRELOGIN_PER_IP: '1' },
      { telemetry },
    );
    await open(rtm.port, A);

    // Full: the ceiling answers first, whatever the address.
    const refused = await attemptUpgrade(rtm.port, B);
    if (refused.accepted) throw new Error('the upgrade past the ceiling was accepted');
    expect(refused.status).toBe(503);

    await telemetry.flushMetrics();
    expect(refusalsCounted(exporter.getMetrics(), 'connection_limit_reached')).toBe(1);
    expect(refusalsCounted(exporter.getMetrics(), 'prelogin_limit_reached')).toBe(0);
  });
});

describe('the count is of sockets waiting right now', () => {
  it('drops a socket that logs in, so the next one from that address gets in', async () => {
    const rtm = await start({ RTM_MAX_PRELOGIN_PER_IP: '1' });
    const socket = await open(rtm.port, A);
    expect((await attemptUpgrade(rtm.port, A)).accepted).toBe(false);

    const login = await socket.request('login', { token: `Bearer ${await agentToken()}` });
    expect(login.success).toBe(true);
    expect(rtm.server.preLogin?.heldBy(A)).toBe(0);
    expect(rtm.server.preLogin?.size).toBe(0);

    // The logged-in socket is still connected; it simply is not waiting.
    expect(rtm.server.registry.size).toBe(1);
    expect((await attemptUpgrade(rtm.port, A)).accepted).toBe(true);
    expect(rtm.server.preLogin?.heldBy(A)).toBe(1);
  });

  it('keeps counting a socket whose login failed — it is still waiting', async () => {
    const rtm = await start({ RTM_MAX_PRELOGIN_PER_IP: '1' });
    const socket = await open(rtm.port, A);

    const login = await socket.request('login', { token: 'Bearer not-a-real-token' });
    expect(login.success).toBe(false);
    expect(rtm.server.preLogin?.heldBy(A)).toBe(1);
    expect((await attemptUpgrade(rtm.port, A)).accepted).toBe(false);
  });

  it('drops a socket that closes, and a logged-in socket closing later releases nothing twice', async () => {
    const rtm = await start({ RTM_MAX_PRELOGIN_PER_IP: '2' });
    const waiting = await open(rtm.port, A);
    const loggedIn = await open(rtm.port, A);
    expect(
      (await loggedIn.request('login', { token: `Bearer ${await agentToken()}` })).success,
    ).toBe(true);
    expect(rtm.server.preLogin?.heldBy(A)).toBe(1);

    waiting.close();
    expect(await until(() => rtm.server.registry.size === 1)).toBe(true);
    expect(rtm.server.preLogin?.heldBy(A)).toBe(0);

    // A new socket takes the freed slot; then the logged-in one leaves. Had its
    // close released a second time, the newcomer's slot would vanish with it.
    await open(rtm.port, A);
    loggedIn.close();
    expect(await until(() => rtm.server.registry.size === 1)).toBe(true);
    expect(rtm.server.preLogin?.heldBy(A)).toBe(1);
  });

  it('drains to nothing once every socket has gone — no address is left behind', async () => {
    const rtm = await start({ RTM_MAX_PRELOGIN_PER_IP: '3' });
    const sockets = [
      await open(rtm.port, A),
      await open(rtm.port, A),
      await open(rtm.port, B),
      await open(rtm.port, '198.51.100.3'),
    ];
    expect(rtm.server.preLogin?.addresses).toBe(3);

    for (const socket of sockets) socket.close();
    expect(await until(() => rtm.server.registry.size === 0)).toBe(true);
    expect(rtm.server.preLogin?.size).toBe(0);
    expect(rtm.server.preLogin?.addresses).toBe(0);
  });
});

describe('the address is the one the api would derive', () => {
  it('ignores the forwarded header at TRUST_PROXY_HOPS=0 — every caller here is 127.0.0.1', async () => {
    const rtm = await start({ RTM_MAX_PRELOGIN_PER_IP: '2', TRUST_PROXY_HOPS: '0' });
    await open(rtm.port, A);
    await open(rtm.port, B);
    expect(rtm.server.preLogin?.heldBy('127.0.0.1')).toBe(2);

    // A third invented address does not buy a third slot.
    expect((await attemptUpgrade(rtm.port, '198.51.100.3')).accepted).toBe(false);
  });

  it('reads only the rightmost entry at one hop — what a caller wrote to its left is not a key', async () => {
    const rtm = await start({ RTM_MAX_PRELOGIN_PER_IP: '1', TRUST_PROXY_HOPS: '1' });
    await open(rtm.port, `203.0.113.66, ${A}`);
    expect(rtm.server.preLogin?.heldBy(A)).toBe(1);
    expect((await attemptUpgrade(rtm.port, `203.0.113.67, ${A}`)).accepted).toBe(false);
  });

  it('falls back to the socket peer when nothing is forwarded', async () => {
    const rtm = await start({ RTM_MAX_PRELOGIN_PER_IP: '1' });
    await open(rtm.port);
    expect(rtm.server.preLogin?.heldBy('127.0.0.1')).toBe(1);
    expect((await attemptUpgrade(rtm.port)).accepted).toBe(false);
  });
});

describe('turned off', () => {
  it('derives no address and refuses nobody at RTM_MAX_PRELOGIN_PER_IP=0', async () => {
    const rtm = await start({ RTM_MAX_PRELOGIN_PER_IP: '0' });
    expect(rtm.server.preLogin).toBeNull();
    // Past the default (50) would be slow for no gain; past a cap of 1 proves
    // the branch is gone.
    for (let i = 0; i < 6; i += 1) {
      expect((await attemptUpgrade(rtm.port, A)).accepted, `upgrade ${i + 1}`).toBe(true);
    }
    expect(rtm.server.registry.size).toBe(6);
  });
});
