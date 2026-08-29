/**
 * OpenTelemetry wiring (NFR-M5). Produces one span per HTTP request plus
 * request/latency/error metrics, each tagged with the `request_id` the client
 * and the logs already share (server.ts `genReqId`). That shared id is the
 * bridge: a trace can be found from a log line and a log line from a trace.
 *
 * Where the two go is `OTEL_EXPORTER` (M-OTEL-a · M-PROV-a) — see
 * {@link OTEL_EXPORTERS}. Dev/prod default to `console`, since there is no
 * collector in this environment (a project boundary); tests bypass all of this
 * and pass an in-memory exporter object directly, which is what the telemetry
 * test asserts against. The stack is off by default when NODE_ENV=test so the
 * other suites pay nothing; the telemetry test switches it on explicitly.
 *
 * The providers are deliberately NOT registered as OpenTelemetry globals: a test
 * run boots many servers in one process, and a global tracer would let spans
 * from one leak into another. Callers use `telemetry.tracer`/`meter` directly.
 */
import type { Counter, Histogram, Meter, Tracer } from '@opentelemetry/api';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

/**
 * The exporters `OTEL_EXPORTER` names (M-OTEL-a · M-PROV-a deseni, the same
 * "the vocabulary lives with the factory, env.ts imports it" shape as
 * {@link ../services/mail/mailer.js!MAIL_PROVIDERS}).
 *
 * `console` is today's behaviour and the default — it is all a deployment
 * without a collector can honestly do. `otlp` sends to a real collector at
 * `OTEL_EXPORTER_OTLP_ENDPOINT`, OpenTelemetry's own standard key rather than
 * one invented here — actually reaching a live collector is out of scope
 * (a project boundary); this factory is proven by unit test, not a connection.
 * `none` keeps the instrumentation running — spans still carry `request_id`,
 * the bridge to logs still works — but every export resolves immediately
 * without printing or sending anything, which is what "maliyetsiz" means here:
 * not that no span object is ever built, but that nothing leaves the process
 * and nothing hits a console a production deployment did not ask to be spammed
 * on merely for turning `OTEL_ENABLED` on.
 */
export const OTEL_EXPORTERS = ['console', 'otlp', 'none'] as const;
export type OtelExporter = (typeof OTEL_EXPORTERS)[number];

const EXPORT_SUCCESS: ExportResult = { code: ExportResultCode.SUCCESS };

/** Backs `OTEL_EXPORTER=none` on the trace side: discards every span. */
class NoopSpanExporter implements SpanExporter {
  export(_spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    resultCallback(EXPORT_SUCCESS);
  }
  async shutdown(): Promise<void> {}
}

/** Backs `OTEL_EXPORTER=none` on the metrics side: discards every batch. */
class NoopMetricExporter implements PushMetricExporter {
  export(_metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
    resultCallback(EXPORT_SUCCESS);
  }
  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

/**
 * `OTEL_EXPORTER_OTLP_ENDPOINT` names the collector's base URL, not the
 * per-signal one — each OTLP HTTP signal has its own path
 * (https://opentelemetry.io/docs/specs/otel/protocol/exporter/), and passing
 * the base straight through as `url` would ask the collector for the base
 * path itself rather than `/v1/traces` or `/v1/metrics`.
 */
function otlpSignalUrl(base: string, signalPath: 'v1/traces' | 'v1/metrics'): string {
  return `${base.replace(/\/+$/, '')}/${signalPath}`;
}

function buildSpanExporter(exporter: OtelExporter, otlpEndpoint: string | undefined): SpanExporter {
  switch (exporter) {
    case 'console':
      return new ConsoleSpanExporter();
    case 'otlp':
      return new OTLPTraceExporter(
        otlpEndpoint ? { url: otlpSignalUrl(otlpEndpoint, 'v1/traces') } : {},
      );
    case 'none':
      return new NoopSpanExporter();
  }
}

function buildMetricExporter(
  exporter: OtelExporter,
  otlpEndpoint: string | undefined,
): PushMetricExporter {
  switch (exporter) {
    case 'console':
      return new ConsoleMetricExporter();
    case 'otlp':
      return new OTLPMetricExporter(
        otlpEndpoint ? { url: otlpSignalUrl(otlpEndpoint, 'v1/metrics') } : {},
      );
    case 'none':
      return new NoopMetricExporter();
  }
}

export interface TelemetryOptions {
  serviceName: string;
  serviceVersion: string;
  /**
   * Where spans go. A name from {@link OTEL_EXPORTERS} builds the matching
   * exporter (default `'console'`); a concrete {@link SpanExporter} is used
   * as-is — which is the path the telemetry test takes, injecting an
   * in-memory exporter to read spans back. Env-driven selection never
   * overrides that: a caller that hands in an object always wins.
   */
  spanExporter?: SpanExporter | OtelExporter;
  /** Where metrics go. Same contract as {@link TelemetryOptions.spanExporter}. */
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

/** The request-scoped instruments the HTTP hooks record into. */
export interface RequestInstruments {
  /** Count of HTTP requests handled, tagged by method/route/status. */
  readonly requests: Counter;
  /** Request duration in seconds (`http.server.request.duration`). */
  readonly duration: Histogram;
  /** Count of requests that ended 5xx. */
  readonly errors: Counter;
}

export interface Telemetry {
  readonly tracer: Tracer;
  readonly meter: Meter;
  readonly instruments: RequestInstruments;
  /** The span exporter, exposed so tests can read the spans that were recorded. */
  readonly spanExporter: SpanExporter;
  /** The metric exporter, exposed so tests can read the metrics after a flush. */
  readonly metricExporter: PushMetricExporter;
  /** Push buffered metrics to the exporter now. Tests await this before asserting. */
  flushMetrics(): Promise<void>;
  /** Flush and tear down both providers; called from the plugin's `onClose`. */
  shutdown(): Promise<void>;
}

const DEFAULT_METRIC_INTERVAL_MS = 60_000;

export function createTelemetry(options: TelemetryOptions): Telemetry {
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: options.serviceName,
    [ATTR_SERVICE_VERSION]: options.serviceVersion,
  });

  const spanExporter: SpanExporter =
    typeof options.spanExporter === 'string'
      ? buildSpanExporter(options.spanExporter, options.otlpEndpoint)
      : (options.spanExporter ?? new ConsoleSpanExporter());

  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
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

  const tracer = tracerProvider.getTracer(options.serviceName, options.serviceVersion);
  const meter = meterProvider.getMeter(options.serviceName, options.serviceVersion);

  const instruments: RequestInstruments = {
    requests: meter.createCounter('http.server.requests', {
      description: 'Number of HTTP requests handled.',
      unit: '{request}',
    }),
    duration: meter.createHistogram('http.server.request.duration', {
      description: 'Duration of inbound HTTP requests.',
      unit: 's',
    }),
    errors: meter.createCounter('http.server.errors', {
      description: 'Number of HTTP requests that ended 5xx.',
      unit: '{request}',
    }),
  };

  return {
    tracer,
    meter,
    instruments,
    spanExporter,
    metricExporter,
    flushMetrics: () => meterProvider.forceFlush(),
    shutdown: async () => {
      await tracerProvider.shutdown();
      await meterProvider.shutdown();
    },
  };
}
