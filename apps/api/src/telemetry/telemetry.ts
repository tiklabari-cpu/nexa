/**
 * OpenTelemetry wiring (NFR-M5). Produces one span per HTTP request plus
 * request/latency/error metrics, each tagged with the `request_id` the client
 * and the logs already share (server.ts `genReqId`). That shared id is the
 * bridge: a trace can be found from a log line and a log line from a trace.
 *
 * There is no collector in this environment — a project boundary — so telemetry
 * goes to a console exporter in dev/prod and an in-memory one under test, which
 * is what the telemetry test asserts against. The stack is off by default when
 * NODE_ENV=test so the other suites pay nothing; the telemetry test switches it
 * on explicitly.
 *
 * The providers are deliberately NOT registered as OpenTelemetry globals: a test
 * run boots many servers in one process, and a global tracer would let spans
 * from one leak into another. Callers use `telemetry.tracer`/`meter` directly.
 */
import type { Counter, Histogram, Meter, Tracer } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

export interface TelemetryOptions {
  serviceName: string;
  serviceVersion: string;
  /**
   * Where spans go. `'console'` (the default) prints them, which is all we can
   * do without a collector; tests pass an in-memory exporter to read back.
   */
  spanExporter?: SpanExporter | 'console';
  /** Where metrics go. Same contract as {@link TelemetryOptions.spanExporter}. */
  metricExporter?: PushMetricExporter | 'console';
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
    !options.spanExporter || options.spanExporter === 'console'
      ? new ConsoleSpanExporter()
      : options.spanExporter;

  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });

  const metricExporter: PushMetricExporter =
    !options.metricExporter || options.metricExporter === 'console'
      ? new ConsoleMetricExporter()
      : options.metricExporter;

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
