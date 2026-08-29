/**
 * The gateway's telemetry seam (M-OTEL-b). Two things this file owns:
 *
 *   - the exporter factory builds what `OTEL_EXPORTER` names, same proof
 *     shape as the API's `telemetry.test.ts` (M-OTEL-a);
 *   - `classifyDisconnectReason` maps a `ws` close code (and the drain flag)
 *     to the bounded reason NFR-M5 wants, pinned directly rather than through
 *     a real 30-second `RTM_LIMITS.loginTimeoutMs`/`idleTimeoutMs` wait —
 *     `test/integration/telemetry.test.ts` proves the reachable reasons
 *     end-to-end against a real socket.
 */
import {
  AggregationTemporality,
  ConsoleMetricExporter,
  InMemoryMetricExporter,
} from '@opentelemetry/sdk-metrics';
import { describe, expect, it } from 'vitest';
import {
  classifyDisconnectReason,
  createTelemetry,
  DISCONNECT_REASONS,
  OTEL_EXPORTERS,
} from './telemetry.js';

describe('OTEL_EXPORTER (M-OTEL-b reuses M-OTEL-a)', () => {
  it('names exactly the same three values the API schema and factory agree on', () => {
    expect(OTEL_EXPORTERS).toEqual(['console', 'otlp', 'none']);
  });

  it("defaults to the console exporter — today's behaviour, unchanged", async () => {
    const telemetry = createTelemetry({ serviceName: 'test', serviceVersion: '0.0.0' });
    try {
      expect(telemetry.metricExporter).toBeInstanceOf(ConsoleMetricExporter);
    } finally {
      await telemetry.shutdown();
    }
  });

  it('runs "none" silently and at no cost: every export succeeds without printing or sending', async () => {
    const telemetry = createTelemetry({
      serviceName: 'test',
      serviceVersion: '0.0.0',
      metricExporter: 'none',
    });
    try {
      expect(telemetry.metricExporter).not.toBeInstanceOf(ConsoleMetricExporter);
      telemetry.instruments.disconnects.add(1, { reason: 'normal' });
      await expect(telemetry.flushMetrics()).resolves.toBeUndefined();
    } finally {
      await telemetry.shutdown();
    }
  });

  it('a caller-supplied exporter object always wins over env selection (test injection path)', async () => {
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const telemetry = createTelemetry({
      serviceName: 'test',
      serviceVersion: '0.0.0',
      metricExporter,
    });
    try {
      expect(telemetry.metricExporter).toBe(metricExporter);
    } finally {
      await telemetry.shutdown();
    }
  });
});

/**
 * `classifyDisconnectReason` (NFR-M5's "kopma nedeni"). Pinned directly
 * against the real close codes `server.ts` uses, so a codec typo (4401 vs
 * 4402) fails here rather than only showing up as a mislabelled dashboard.
 */
describe('classifyDisconnectReason', () => {
  it('names exactly the five reasons the taxonomy allows', () => {
    expect(DISCONNECT_REASONS).toEqual([
      'normal',
      'protocol_violation',
      'identity_timeout',
      'idle_timeout',
      'server_shutdown',
    ]);
  });

  it('reads the login-timeout close code (4401) as identity_timeout', () => {
    expect(classifyDisconnectReason(4401, false)).toBe('identity_timeout');
  });

  it('reads the idle-timeout close code (4408) as idle_timeout', () => {
    expect(classifyDisconnectReason(4408, false)).toBe('idle_timeout');
  });

  it('reads ws-native framing-error codes as protocol_violation', () => {
    for (const code of [1002, 1003, 1007, 1009, 1010]) {
      expect(classifyDisconnectReason(code, false)).toBe('protocol_violation');
    }
  });

  it('reads a normal client close (1000) as normal', () => {
    expect(classifyDisconnectReason(1000, false)).toBe('normal');
  });

  it('reads an undistinguished close as normal, not as a fabricated category', () => {
    expect(classifyDisconnectReason(1005, false)).toBe('normal');
    expect(classifyDisconnectReason(1006, false)).toBe('normal');
  });

  it('reads any close while draining as server_shutdown, even 1001 — which a client can also send on its own', () => {
    expect(classifyDisconnectReason(1001, true)).toBe('server_shutdown');
    // The drain flag wins over the code even for a code that looks unrelated:
    // once the gateway is leaving, every open socket is being closed because
    // of that, not because of whatever it happened to send back.
    expect(classifyDisconnectReason(1000, true)).toBe('server_shutdown');
  });

  it('reads a stray 1001 outside a drain as normal — a client can send "going away" on its own', () => {
    expect(classifyDisconnectReason(1001, false)).toBe('normal');
  });
});
