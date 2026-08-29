/**
 * The exporter seam (M-OTEL-a · M-PROV-a). `OTEL_EXPORTER` is validated by
 * `env.test.ts`'s `provider selection` suite the same way every other
 * `*_PROVIDER` key is; what this file owns is the other half — that each of
 * the three values actually builds the exporter it names, proven by unit
 * test rather than a live collector (out of scope — see telemetry.ts).
 */
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  AggregationTemporality,
  ConsoleMetricExporter,
  InMemoryMetricExporter,
} from '@opentelemetry/sdk-metrics';
import { ConsoleSpanExporter, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';
import { createTelemetry, OTEL_EXPORTERS } from './telemetry.js';

describe('OTEL_EXPORTER (M-OTEL-a)', () => {
  it('names exactly the three values the schema and factory agree on', () => {
    expect(OTEL_EXPORTERS).toEqual(['console', 'otlp', 'none']);
  });

  it("defaults to the console exporter — today's behaviour, unchanged", async () => {
    const telemetry = createTelemetry({ serviceName: 'test', serviceVersion: '0.0.0' });
    try {
      expect(telemetry.spanExporter).toBeInstanceOf(ConsoleSpanExporter);
      expect(telemetry.metricExporter).toBeInstanceOf(ConsoleMetricExporter);
    } finally {
      await telemetry.shutdown();
    }
  });

  it('builds a real OTLP exporter for "otlp"', async () => {
    const telemetry = createTelemetry({
      serviceName: 'test',
      serviceVersion: '0.0.0',
      spanExporter: 'otlp',
      metricExporter: 'otlp',
      otlpEndpoint: 'http://collector.internal:4318',
    });
    try {
      expect(telemetry.spanExporter).toBeInstanceOf(OTLPTraceExporter);
      expect(telemetry.metricExporter).toBeInstanceOf(OTLPMetricExporter);
    } finally {
      await telemetry.shutdown();
    }
  });

  it('runs "none" silently and at no cost: every export succeeds without printing or sending', async () => {
    const telemetry = createTelemetry({
      serviceName: 'test',
      serviceVersion: '0.0.0',
      spanExporter: 'none',
      metricExporter: 'none',
    });
    try {
      // Neither is a Console/OTLP exporter — nothing this test could observe
      // leaving the process.
      expect(telemetry.spanExporter).not.toBeInstanceOf(ConsoleSpanExporter);
      expect(telemetry.spanExporter).not.toBeInstanceOf(OTLPTraceExporter);
      expect(telemetry.metricExporter).not.toBeInstanceOf(ConsoleMetricExporter);
      expect(telemetry.metricExporter).not.toBeInstanceOf(OTLPMetricExporter);

      const spanResult = await new Promise<ExportResult>((resolve) =>
        telemetry.spanExporter.export([], resolve),
      );
      expect(spanResult).toEqual({ code: ExportResultCode.SUCCESS });

      // Drives a real batch through the real MeterProvider rather than a
      // fabricated ResourceMetrics — if the noop exporter's export() ever
      // stopped calling its callback, this would hang and time the test out.
      telemetry.instruments.requests.add(1);
      await expect(telemetry.flushMetrics()).resolves.toBeUndefined();
    } finally {
      await telemetry.shutdown();
    }
  });

  it('a caller-supplied exporter object always wins over env selection (test injection path)', async () => {
    // This is the path the telemetry integration test takes: it passes a
    // concrete InMemorySpanExporter/InMemoryMetricExporter, never a string,
    // so nothing here should ever consult OTEL_EXPORTER for it.
    const spanExporter = new InMemorySpanExporter();
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);

    const telemetry = createTelemetry({
      serviceName: 'test',
      serviceVersion: '0.0.0',
      spanExporter,
      metricExporter,
    });
    try {
      expect(telemetry.spanExporter).toBe(spanExporter);
      expect(telemetry.metricExporter).toBe(metricExporter);
    } finally {
      await telemetry.shutdown();
    }
  });
});
