/**
 * OpenTelemetry instrumentation (NFR-M5).
 *
 * Boots a real Fastify with the real telemetry plugin and the real OTel SDK,
 * wired to in-memory exporters so the spans and metrics can be read back. The
 * one property that matters most is the bridge: the span must carry the same
 * `request_id` the log line does, so an operator can pivot from one to the
 * other without a trace backend (there is no collector here — a boundary).
 *
 * No database: the telemetry stack is orthogonal to persistence, so this builds
 * a bare app rather than the full server.
 */
import { SpanStatusCode } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import telemetryPlugin from '../../src/plugins/telemetry.js';
import { createTelemetry, type Telemetry } from '../../src/telemetry/telemetry.js';

/** onResponse fires after inject resolves; poll briefly rather than race it. */
async function waitForSpans(exporter: InMemorySpanExporter, min: number) {
  for (let i = 0; i < 50; i += 1) {
    if (exporter.getFinishedSpans().length >= min) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return exporter.getFinishedSpans();
}

function dataPoints(metrics: ResourceMetrics[], name: string): { value: unknown }[] {
  const points: { value: unknown }[] = [];
  for (const rm of metrics) {
    for (const sm of rm.scopeMetrics) {
      for (const m of sm.metrics) {
        if (m.descriptor.name === name) points.push(...m.dataPoints);
      }
    }
  }
  return points;
}

function counterTotal(metrics: ResourceMetrics[], name: string): number {
  return dataPoints(metrics, name).reduce((acc, p) => acc + (p.value as number), 0);
}

function histogramCount(metrics: ResourceMetrics[], name: string): number {
  return dataPoints(metrics, name).reduce(
    (acc, p) => acc + (p.value as { count: number }).count,
    0,
  );
}

describe('telemetry (NFR-M5)', () => {
  let spanExporter: InMemorySpanExporter;
  let metricExporter: InMemoryMetricExporter;
  let telemetry: Telemetry;
  let app: FastifyInstance;

  beforeAll(async () => {
    spanExporter = new InMemorySpanExporter();
    metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    telemetry = createTelemetry({
      serviceName: 'nexa-api-test',
      serviceVersion: '0.0.0-test',
      spanExporter,
      metricExporter,
    });

    app = Fastify({
      // Same correlation contract as the real server: the client-supplied id
      // becomes request.id, which the span then carries.
      genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? 'anon',
      requestIdHeader: 'x-request-id',
    });
    await app.register(telemetryPlugin, { telemetry });
    app.get('/ok', async () => ({ ok: true }));
    app.get('/boom', async () => {
      throw new Error('kaboom');
    });
    await app.ready();
  });

  afterAll(async () => {
    // Closing the app runs the plugin's onClose, which shuts telemetry down.
    await app.close();
  });

  beforeEach(() => {
    spanExporter.reset();
    metricExporter.reset();
  });

  it('records a server span carrying the request_id and route', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ok',
      headers: { 'x-request-id': 'req-abc' },
    });
    expect(res.statusCode).toBe(200);

    const spans = await waitForSpans(spanExporter, 1);
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span?.name).toBe('GET /ok');
    // The bridge assertion: same id the logs and X-Request-Id header carry.
    expect(span?.attributes['request_id']).toBe('req-abc');
    expect(span?.attributes['http.route']).toBe('/ok');
    expect(span?.attributes['http.request.method']).toBe('GET');
    expect(span?.attributes['http.response.status_code']).toBe(200);
    expect(span?.status.code).not.toBe(SpanStatusCode.ERROR);
  });

  it('marks a 5xx span as errored and records the exception', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/boom',
      headers: { 'x-request-id': 'req-err' },
    });
    expect(res.statusCode).toBe(500);

    const spans = await waitForSpans(spanExporter, 1);
    const span = spans.find((s) => s.name === 'GET /boom');
    expect(span).toBeDefined();
    expect(span?.attributes['request_id']).toBe('req-err');
    expect(span?.attributes['http.response.status_code']).toBe(500);
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('produces request, duration and error metrics', async () => {
    await app.inject({ method: 'GET', url: '/ok' });
    await app.inject({ method: 'GET', url: '/boom' });
    // Waiting on the spans confirms both onResponse hooks (where metrics are
    // recorded) have run before we flush.
    await waitForSpans(spanExporter, 2);

    await telemetry.flushMetrics();
    const metrics = metricExporter.getMetrics();

    expect(counterTotal(metrics, 'http.server.requests')).toBeGreaterThanOrEqual(2);
    expect(counterTotal(metrics, 'http.server.errors')).toBeGreaterThanOrEqual(1);
    expect(histogramCount(metrics, 'http.server.request.duration')).toBeGreaterThanOrEqual(2);
  });
});
