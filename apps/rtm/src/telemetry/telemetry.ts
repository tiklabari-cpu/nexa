/**
 * OpenTelemetry wiring for the gateway (NFR-M5), same pattern as the API's
 * (`apps/api/src/telemetry/telemetry.ts`): its own `Telemetry` instance, never
 * registered as an OpenTelemetry global — a test run boots many gateways in one
 * process, and a global meter would let one leak into another.
 *
 * The API instruments HTTP requests; this instruments the socket layer instead
 * — three metrics (NFR-M5 · NFR-P1):
 *
 *   - {@link RtmInstruments.activeConnections} — concurrently open sockets.
 *   - {@link RtmInstruments.fanoutDelay} — time from event production
 *     (`BusEnvelope.at`, "used only for observability" by its own doc comment
 *     in `packages/types/src/realtime-bus.ts`) to the socket write. This is
 *     what NFR-P1's p99 < 500ms budget is measured against.
 *   - {@link RtmInstruments.disconnects} — closed sockets, tagged by
 *     {@link DisconnectReason}.
 *
 * No tracer: the API's spans exist to join a request to its log line, and
 * every RTM log call already carries `request_id` directly (M-OPS-c ·
 * KM-OPS) — a per-socket span would have no request boundary to end at.
 *
 * Exporter selection reuses `OTEL_EXPORTER`/`OTEL_EXPORTER_OTLP_ENDPOINT`
 * (M-OTEL-a) — one env key, two processes, so an operator does not point the
 * API at a collector and leave the gateway printing to a console nobody
 * reads.
 */
import type { Counter, Histogram, Meter, ObservableGauge } from '@opentelemetry/api';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

/** Identical vocabulary to the API's (M-OTEL-a · M-PROV-a) — see that file for why. */
export const OTEL_EXPORTERS = ['console', 'otlp', 'none'] as const;
export type OtelExporter = (typeof OTEL_EXPORTERS)[number];

const EXPORT_SUCCESS: ExportResult = { code: ExportResultCode.SUCCESS };

/** Backs `OTEL_EXPORTER=none`: discards every batch, at no cost. */
class NoopMetricExporter implements PushMetricExporter {
  export(_metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
    resultCallback(EXPORT_SUCCESS);
  }
  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

/** Same base-URL-to-signal-path reasoning as the API's `otlpSignalUrl`. */
function otlpMetricsUrl(base: string): string {
  return `${base.replace(/\/+$/, '')}/v1/metrics`;
}

function buildMetricExporter(
  exporter: OtelExporter,
  otlpEndpoint: string | undefined,
): PushMetricExporter {
  switch (exporter) {
    case 'console':
      return new ConsoleMetricExporter();
    case 'otlp':
      return new OTLPMetricExporter(otlpEndpoint ? { url: otlpMetricsUrl(otlpEndpoint) } : {});
    case 'none':
      return new NoopMetricExporter();
  }
}

/**
 * Why a socket closed (NFR-M5's "kopma nedeni"), a bounded label set —
 * cardinality and PII both forbid a tenant/connection id here.
 *
 * Read from the real closing paths (`server.ts`), not guessed:
 *
 *   - `identity_timeout` — `RTM_LIMITS.loginTimeoutMs` elapsed unauthenticated
 *     (close code 4401).
 *   - `idle_timeout` — `RTM_LIMITS.idleTimeoutMs` elapsed with no traffic
 *     (close code 4408).
 *   - `server_shutdown` — the graceful drain (M-OPS-b, tm 160.2) closed every
 *     open socket with 1001 on its way out.
 *   - `protocol_violation` — `ws` itself closed the socket over a framing
 *     problem it detected (oversized payload, bad opcode, invalid UTF-8) —
 *     codes 1002/1003/1007/1009/1010.
 *   - `normal` — anything else, chiefly a client-initiated close (1000) or a
 *     network drop the socket layer cannot further distinguish.
 *
 * Deliberately NOT included: a rate-limit reason. `dispatcher.ts`'s
 * `#withinRateLimit` throttles by design rather than disconnecting — "the
 * usual cause is an over-eager client, and dropping the connection would cost
 * the agent their live conversation" — so there is no closing path a
 * `rate_limit` label could ever be attached to without contradicting that.
 */
export const DISCONNECT_REASONS = [
  'normal',
  'protocol_violation',
  'identity_timeout',
  'idle_timeout',
  'server_shutdown',
] as const;
export type DisconnectReason = (typeof DISCONNECT_REASONS)[number];

/** Codes `ws` uses when it closes a socket itself over a framing problem. */
const PROTOCOL_VIOLATION_CLOSE_CODES = new Set([1002, 1003, 1007, 1009, 1010]);

const IDENTITY_TIMEOUT_CLOSE_CODE = 4401;
const IDLE_TIMEOUT_CLOSE_CODE = 4408;

/**
 * Classifies one `ws` `'close'` event. `draining` wins over the code: the
 * drain sends every open socket the same 1001 a client might otherwise send
 * for its own reasons (a tab closing), so "was this gateway already leaving"
 * is the more reliable signal for that one code.
 */
export function classifyDisconnectReason(code: number, draining: boolean): DisconnectReason {
  if (draining) return 'server_shutdown';
  if (code === IDENTITY_TIMEOUT_CLOSE_CODE) return 'identity_timeout';
  if (code === IDLE_TIMEOUT_CLOSE_CODE) return 'idle_timeout';
  if (PROTOCOL_VIOLATION_CLOSE_CODES.has(code)) return 'protocol_violation';
  return 'normal';
}

export interface TelemetryOptions {
  serviceName: string;
  serviceVersion: string;
  /**
   * Where metrics go. A name from {@link OTEL_EXPORTERS} builds the matching
   * exporter (default `'console'`); a concrete {@link PushMetricExporter} is
   * used as-is — the path tests take, injecting an in-memory exporter.
   */
  metricExporter?: PushMetricExporter | OtelExporter;
  /** The collector `OTEL_EXPORTER=otlp` sends to (`OTEL_EXPORTER_OTLP_ENDPOINT`). */
  otlpEndpoint?: string;
  /**
   * How often buffered metrics are pushed to the exporter, in milliseconds.
   * Tests leave the default and call {@link Telemetry.flushMetrics} instead so
   * the assertion never races the timer.
   */
  metricIntervalMillis?: number;
}

export interface RtmInstruments {
  /** Concurrently open sockets. Observed on demand — see `server.ts`'s callback. */
  readonly activeConnections: ObservableGauge;
  /** Seconds from `BusEnvelope.at` to the socket write (NFR-P1's p99 budget). */
  readonly fanoutDelay: Histogram;
  /** Count of sockets closed, tagged `reason` (see {@link DisconnectReason}). */
  readonly disconnects: Counter;
}

export interface Telemetry {
  readonly meter: Meter;
  readonly instruments: RtmInstruments;
  /** The metric exporter, exposed so tests can read metrics after a flush. */
  readonly metricExporter: PushMetricExporter;
  /** Push buffered metrics to the exporter now. Tests await this before asserting. */
  flushMetrics(): Promise<void>;
  /** Flush and tear down the provider; called from `server.ts`'s `close()`. */
  shutdown(): Promise<void>;
}

const DEFAULT_METRIC_INTERVAL_MS = 60_000;

export function createTelemetry(options: TelemetryOptions): Telemetry {
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: options.serviceName,
    [ATTR_SERVICE_VERSION]: options.serviceVersion,
  });

  const metricExporter: PushMetricExporter =
    typeof options.metricExporter === 'string'
      ? buildMetricExporter(options.metricExporter, options.otlpEndpoint)
      : (options.metricExporter ?? new ConsoleMetricExporter());

  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: options.metricIntervalMillis ?? DEFAULT_METRIC_INTERVAL_MS,
  });

  const meterProvider = new MeterProvider({ resource, readers: [metricReader] });
  const meter = meterProvider.getMeter(options.serviceName, options.serviceVersion);

  const instruments: RtmInstruments = {
    activeConnections: meter.createObservableGauge('rtm.connections.active', {
      description: 'Concurrently open RTM WebSocket connections.',
      unit: '{connection}',
    }),
    fanoutDelay: meter.createHistogram('rtm.fanout.delay', {
      description: 'Time from event production to the socket write.',
      unit: 's',
    }),
    disconnects: meter.createCounter('rtm.connections.closed', {
      description: 'RTM WebSocket connections closed, tagged by reason.',
      unit: '{connection}',
    }),
  };

  return {
    meter,
    instruments,
    metricExporter,
    flushMetrics: () => meterProvider.forceFlush(),
    shutdown: () => meterProvider.shutdown(),
  };
}
