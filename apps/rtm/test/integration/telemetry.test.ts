/**
 * RTM's three OpenTelemetry metrics (NFR-M5 · NFR-P1 · M-OTEL-b), proved
 * against a real gateway and real sockets — the same reasoning
 * `rtm-harness.ts` gives for every other suite in this package: back-pressure,
 * framing and delivery only exist at the socket level, and a fake would test
 * the fake.
 *
 * `identity_timeout`/`idle_timeout` are not exercised here — both need a real
 * `RTM_LIMITS.loginTimeoutMs`/`idleTimeoutMs` wait (30s each), which is not a
 * cost every run of this suite should pay. `classifyDisconnectReason` in
 * `src/telemetry/telemetry.test.ts` pins those two directly against the close
 * codes `server.ts` actually uses.
 */
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { licenseChannel, type BusEnvelope, type PushAudience } from '@nexa/types';
import { grantToken, ownerClient, seedRtmFixtures, type RtmFixtures } from '../helpers/fixtures.js';
import { settle, startRtm, TestSocket } from '../helpers/rtm-harness.js';
import { createTelemetry, type Telemetry } from '../../src/telemetry/telemetry.js';

/**
 * Reads only the most recent export batch. `InMemoryMetricExporter` appends
 * one `ResourceMetrics` per `export()` call and `AggregationTemporality.CUMULATIVE`
 * means each batch already carries the running total since the provider
 * started — summing data points *across* batches (as opposed to within one)
 * would double-count anything flushed more than once, which both a mid-test
 * `flushMetrics()` and `close()`'s own flush-before-shutdown produce.
 */
function dataPoints(
  metrics: ResourceMetrics[],
  name: string,
): Array<{ value: unknown; attributes: Record<string, unknown> }> {
  const latest = metrics[metrics.length - 1];
  if (!latest) return [];
  const points: Array<{ value: unknown; attributes: Record<string, unknown> }> = [];
  for (const sm of latest.scopeMetrics) {
    for (const m of sm.metrics) {
      if (m.descriptor.name === name) points.push(...m.dataPoints);
    }
  }
  return points;
}

function latestGaugeValue(metrics: ResourceMetrics[], name: string): number | undefined {
  const points = dataPoints(metrics, name);
  return points[points.length - 1]?.value as number | undefined;
}

function histogramCount(metrics: ResourceMetrics[], name: string): number {
  return dataPoints(metrics, name).reduce(
    (acc, p) => acc + (p.value as { count: number }).count,
    0,
  );
}

function counterFor(metrics: ResourceMetrics[], name: string, reason: string): number {
  return dataPoints(metrics, name)
    .filter((p) => p.attributes['reason'] === reason)
    .reduce((acc, p) => acc + (p.value as number), 0);
}

describe('rtm telemetry (NFR-M5 · M-OTEL-b)', () => {
  let db: PrismaClient;
  let redis: Redis;
  let fx: RtmFixtures;

  /** Every server a test started, closed in teardown whatever the test did. */
  const running: Array<{ close: () => Promise<void> }> = [];

  beforeAll(async () => {
    db = ownerClient();
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6380');
  });

  afterAll(async () => {
    await redis.quit();
    await db.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedRtmFixtures(db);
  });

  afterEach(async () => {
    while (running.length > 0)
      await running
        .pop()
        ?.close()
        .catch(() => {});
  });

  /** Starts a gateway wired to a fresh in-memory metric exporter it owns. */
  async function start(overrides: Partial<NodeJS.ProcessEnv> = {}): Promise<{
    rtm: Awaited<ReturnType<typeof startRtm>>;
    telemetry: Telemetry;
    exporter: InMemoryMetricExporter;
  }> {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const telemetry = createTelemetry({
      serviceName: 'nexa-rtm-test',
      serviceVersion: '0.0.0-test',
      metricExporter: exporter,
    });
    const rtm = await startRtm(overrides, undefined, telemetry);
    running.push(rtm);
    return { rtm, telemetry, exporter };
  }

  async function loginAgent(port: number): Promise<TestSocket> {
    const token = await grantToken(db, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['chats--access:rw'],
    });
    const socket = await TestSocket.connect(port, { organizationId: fx.a.organizationId });
    const response = await socket.request('login', {
      token: `Bearer ${token}`,
      pushes: { '3.6': ['incoming_event'] },
    });
    expect(response.success).toBe(true);
    return socket;
  }

  async function publish(action: string, audience: PushAudience, payload: unknown): Promise<void> {
    const envelope: BusEnvelope = {
      v: 1,
      licenseId: fx.a.licenseId.toString(),
      organizationId: fx.a.organizationId,
      action: action as BusEnvelope['action'],
      audience,
      payload,
      at: Date.now(),
    };
    await redis.publish(licenseChannel(fx.a.licenseId), JSON.stringify(envelope));
  }

  describe('concurrent connections (gauge)', () => {
    it('tracks sockets opening and closing', async () => {
      const { rtm, telemetry, exporter } = await start();

      await telemetry.flushMetrics();
      expect(latestGaugeValue(exporter.getMetrics(), 'rtm.connections.active')).toBe(0);

      const first = await TestSocket.connect(rtm.port, { organizationId: fx.a.organizationId });
      await telemetry.flushMetrics();
      expect(latestGaugeValue(exporter.getMetrics(), 'rtm.connections.active')).toBe(1);

      const second = await TestSocket.connect(rtm.port, { organizationId: fx.a.organizationId });
      await telemetry.flushMetrics();
      expect(latestGaugeValue(exporter.getMetrics(), 'rtm.connections.active')).toBe(2);

      first.close();
      await first.waitForClose();
      await telemetry.flushMetrics();
      expect(latestGaugeValue(exporter.getMetrics(), 'rtm.connections.active')).toBe(1);

      second.close();
    });
  });

  describe('fan-out delay (histogram)', () => {
    it('records the gap between event production and the socket write', async () => {
      const { rtm, telemetry, exporter } = await start();
      const socket = await loginAgent(rtm.port);

      await publish('incoming_event', { allAgents: true }, { text: 'hi' });
      await socket.waitForPush('incoming_event');

      await telemetry.flushMetrics();
      const metrics = exporter.getMetrics();
      expect(histogramCount(metrics, 'rtm.fanout.delay')).toBeGreaterThanOrEqual(1);

      const point = dataPoints(metrics, 'rtm.fanout.delay').find(
        (p) => p.attributes['action'] === 'incoming_event',
      );
      expect(point).toBeDefined();
      const summary = point?.value as { count: number; sum?: number };
      // Local pub/sub plus an in-process fan-out: seconds, not the minutes a
      // stuck measurement would produce.
      expect(summary.sum ?? -1).toBeGreaterThanOrEqual(0);
      expect(summary.sum ?? 0).toBeLessThan(5);
    });

    it('does not record anything when nobody on this node was reachable', async () => {
      const { rtm, telemetry, exporter } = await start();

      // Logged in (so the gateway *is* subscribed to the license channel) but
      // not subscribed to `incoming_event` — the envelope reaches
      // `Fanout#handle` and is then discarded by the per-connection
      // subscription filter before any `ws.send()` happens, so there is
      // nothing to time.
      const token = await grantToken(db, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['chats--access:rw'],
      });
      const socket = await TestSocket.connect(rtm.port, { organizationId: fx.a.organizationId });
      const login = await socket.request('login', {
        token: `Bearer ${token}`,
        pushes: { '3.6': [] },
      });
      expect(login.success).toBe(true);

      await publish('incoming_event', { allAgents: true }, { text: 'unheard' });
      await settle();

      await telemetry.flushMetrics();
      expect(histogramCount(exporter.getMetrics(), 'rtm.fanout.delay')).toBe(0);
    });
  });

  describe('disconnect reason (counter)', () => {
    it('labels a client-initiated close as normal', async () => {
      const { rtm, telemetry, exporter } = await start();
      const socket = await TestSocket.connect(rtm.port, { organizationId: fx.a.organizationId });

      socket.close();
      await socket.waitForClose();

      await telemetry.flushMetrics();
      expect(counterFor(exporter.getMetrics(), 'rtm.connections.closed', 'normal')).toBe(1);
    });

    it('labels an oversized frame as protocol_violation — ws itself closes it (1009)', async () => {
      const { rtm, telemetry, exporter } = await start();
      const socket = await TestSocket.connect(rtm.port, { organizationId: fx.a.organizationId });

      // Well past the gateway's 256KiB `maxPayload` (`server.ts`).
      socket.sendRaw('x'.repeat(300_000));
      const code = await socket.waitForClose();
      expect(code).toBe(1009);

      // The server initiated this close, so the closing handshake completes
      // in the opposite order from a client-initiated one: the client's own
      // `'close'` (what `waitForClose` waited for) fires on receiving the
      // close frame, one echo *before* the server's own `'close'` handler —
      // where this test's counter is recorded — completes.
      await settle();

      await telemetry.flushMetrics();
      expect(
        counterFor(exporter.getMetrics(), 'rtm.connections.closed', 'protocol_violation'),
      ).toBe(1);
    });

    it('labels every socket closed by a graceful drain as server_shutdown', async () => {
      // A window wide enough to observe the socket's close code from outside;
      // the suite's usual zero-drain default (production-only otherwise)
      // would race the assertion.
      const { rtm, exporter } = await start({ SHUTDOWN_DRAIN_MS: '500' });
      const socket = await TestSocket.connect(rtm.port, { organizationId: fx.a.organizationId });

      await rtm.close();
      expect(socket.closeCode).toBe(1001);

      // `close()` flushes telemetry itself before shutting it down
      // (`server.ts`) — the drain's own disconnect record must already be in
      // the exporter by the time `close()`'s promise resolves, with no
      // further `flushMetrics()` call needed (or possible: the provider is
      // already shut down).
      expect(counterFor(exporter.getMetrics(), 'rtm.connections.closed', 'server_shutdown')).toBe(
        1,
      );
    });
  });
});
