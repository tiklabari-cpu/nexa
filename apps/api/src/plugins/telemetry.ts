/**
 * HTTP instrumentation (NFR-M5). Opens a SERVER span at `onRequest`, closes it
 * at `onResponse`, and records the request/latency/error metrics there too.
 *
 * Every span carries `request_id` — the same id the log line and the
 * `X-Request-Id` response header carry — so the three can be joined without a
 * trace backend. Low-cardinality tags come from the matched route pattern
 * (`/chats/:id`, not `/chats/abc123`) so the metric time series stay bounded.
 *
 * When telemetry is disabled the plugin adds no hooks and no decorators, so a
 * request pays exactly nothing.
 */
import { SpanKind, SpanStatusCode, type Span } from '@opentelemetry/api';
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_URL_PATH,
} from '@opentelemetry/semantic-conventions';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Telemetry } from '../telemetry/telemetry.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The server span for this request, or null when telemetry is off. */
    otelSpan: Span | null;
  }
}

export interface TelemetryPluginOptions {
  /** The telemetry instance, or null to disable instrumentation entirely. */
  telemetry: Telemetry | null;
}

/** Route pattern for tags/span name; `url` is undefined for unmatched (404) routes. */
function routeOf(request: FastifyRequest): string {
  return request.routeOptions.url ?? 'unmatched';
}

async function telemetryPlugin(
  app: FastifyInstance,
  options: TelemetryPluginOptions,
): Promise<void> {
  const telemetry = options.telemetry;
  if (!telemetry) return;

  app.decorateRequest('otelSpan', null);

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const route = routeOf(request);
    request.otelSpan = telemetry.tracer.startSpan(`${request.method} ${route}`, {
      kind: SpanKind.SERVER,
      attributes: {
        [ATTR_HTTP_REQUEST_METHOD]: request.method,
        [ATTR_HTTP_ROUTE]: route,
        [ATTR_URL_PATH]: request.url,
        // The bridge to logs and the X-Request-Id header (server.ts genReqId).
        request_id: request.id,
      },
    });
  });

  app.addHook('onError', async (request: FastifyRequest, _reply, error) => {
    request.otelSpan?.recordException(error);
  });

  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const status = reply.statusCode;
    const attributes = {
      [ATTR_HTTP_REQUEST_METHOD]: request.method,
      [ATTR_HTTP_ROUTE]: routeOf(request),
      [ATTR_HTTP_RESPONSE_STATUS_CODE]: status,
    };

    telemetry.instruments.requests.add(1, attributes);
    // Fastify measures wall time from routing to response; seconds is the
    // OpenTelemetry convention for http.server.request.duration.
    telemetry.instruments.duration.record(reply.elapsedTime / 1000, attributes);
    if (status >= 500) telemetry.instruments.errors.add(1, attributes);

    const span = request.otelSpan;
    if (span) {
      span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, status);
      if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      request.otelSpan = null;
    }
  });

  app.addHook('onClose', async () => {
    await telemetry.shutdown();
  });
}

export default fp(telemetryPlugin, { name: 'telemetry' });
