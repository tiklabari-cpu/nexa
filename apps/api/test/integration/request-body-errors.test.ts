/**
 * A body Fastify cannot read is the caller's mistake, not ours (tm 256.6).
 *
 * The pilot rehearsal (2026-09-30, PLAN §D193) sent a malformed JSON body and
 * got `500 {type: internal}` plus an error-level log line — the line an
 * operator is paged for. `plugins/error-handler.ts` recognised the empty-body,
 * media-type and body-limit failures of Fastify's content-type parser but not
 * the malformed-JSON one (`FST_ERR_CTP_INVALID_JSON_BODY`), nor a body shorter
 * than its `Content-Length`. Every one of them now leaves as `validation` and
 * is logged at warn.
 *
 * The status is the one `validation` has (400), including for the two cases
 * Fastify itself numbers 413 and 415: ADR-06 derives the status from the error
 * type, and the body limit has answered `400 validation` since FR-MOD-08.9.4
 * pinned it. That behaviour is measured here and kept.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { startTestServer, type TestServer } from '../helpers/server.js';

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
}

interface LogLine {
  level: number;
  msg?: string;
  reqId?: string;
  request_id?: string;
  error_type?: string;
}

const PINO_WARN = 40;
const PINO_ERROR = 50;

describe('a request body Fastify cannot read', () => {
  let server: TestServer | undefined;
  let sink: LineSink;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function boot(): Promise<TestServer> {
    sink = new LineSink();
    server = await startTestServer(
      { LOG_LEVEL: 'info' },
      { logStream: sink as unknown as NodeJS.WritableStream },
    );
    return server;
  }

  function logLines(): LogLine[] {
    return sink.lines.flatMap((line) => {
      try {
        return [JSON.parse(line) as LogLine];
      } catch {
        return [];
      }
    });
  }

  /** The handler's own line for this request — the one that says what went wrong. */
  function handlerLine(response: LightMyRequestResponse): LogLine | undefined {
    const requestId = response.headers['x-request-id'];
    return logLines().find((line) => line.request_id === requestId && line.error_type);
  }

  async function send(
    app: TestServer,
    payload: string,
    headers: Record<string, string>,
  ): Promise<LightMyRequestResponse> {
    return app.app.inject({ method: 'POST', url: app.url('/auth/login'), payload, headers });
  }

  function expectCallerError(response: LightMyRequestResponse): void {
    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { type: string; request_id: string } };
    expect(body.error.type).toBe('validation');
    expect(body.error.request_id).toBe(response.headers['x-request-id']);
    expect(response.body).not.toContain('internal');

    const line = handlerLine(response);
    expect(line?.level).toBe(PINO_WARN);
    expect(line?.error_type).toBe('validation');
    expect(logLines().filter((entry) => entry.level >= PINO_ERROR)).toEqual([]);
  }

  it('answers malformed JSON with 400 validation and a warn line, not 500 and an error line', async () => {
    const app = await boot();
    const response = await send(app, '{"email": "a@example.test", ', {
      'content-type': 'application/json',
    });

    expectCallerError(response);
    expect(response.json().error.message).toMatch(/not valid JSON/);
  });

  it('answers an empty body sent as application/json with 400 validation', async () => {
    const app = await boot();
    const response = await send(app, '', { 'content-type': 'application/json' });

    expectCallerError(response);
    expect(response.json().error.message).toMatch(/cannot be empty/);
  });

  it('answers a body shorter than its Content-Length with 400 validation', async () => {
    const app = await boot();
    const response = await send(app, '{"email":"a@example.test"}', {
      'content-type': 'application/json',
      'content-length': '400',
    });

    expectCallerError(response);
  });

  it('answers a media type the route does not read with 400 validation (Fastify: 415)', async () => {
    const app = await boot();
    const response = await send(app, '<login/>', { 'content-type': 'application/xml' });

    expectCallerError(response);
  });

  it('answers a body over the 1 MiB limit with 400 validation (Fastify: 413) and says so', async () => {
    const app = await boot();
    const response = await send(app, JSON.stringify({ email: 'x'.repeat(1_100_000) }), {
      'content-type': 'application/json',
    });

    expectCallerError(response);
    expect(response.json().error.message).toBe(
      'Request body is larger than this endpoint accepts.',
    );
  });

  it('still answers a well-formed body the route handles itself', async () => {
    const app = await boot();
    const response = await send(
      app,
      JSON.stringify({ email: 'nobody@example.test', password: 'wrong-password-1' }),
      { 'content-type': 'application/json' },
    );

    // No such account: the route ran, which is all this pins.
    expect(response.statusCode).toBe(401);
  });
});
