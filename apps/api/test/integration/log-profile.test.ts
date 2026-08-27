/**
 * Production log profile (M-OPS-c · NFR-M5 · NFR-S9).
 *
 * Three properties `server.ts` already claims in comments, none of them
 * previously run against a production `Env` the way `production-boot.test.ts`
 * (M-PROD-CFG-a) first ran the CORS branch:
 *
 *  - `genReqId`/`X-Request-Id` (`server.ts`) mean every log line Fastify
 *    writes for a request carries the same `reqId` the client can read off
 *    the response header — the correlation NFR-M5 asks for. Untested, a
 *    refactor that moved the header write off `request.id` (or vice versa)
 *    would pass every other suite and silently break the one thing an
 *    operator uses the id for: finding the log line that matches a report.
 *  - `lib/log-redact.ts`'s masking (`server.ts`'s `redact` option) is built
 *    unconditionally — it does not read `env.isProduction` — but nothing had
 *    ever run it under `NODE_ENV=production` to confirm the branch that
 *    *would* gate it does not exist. `hipaa-constraints.test.ts` and
 *    `device-tokens.test.ts` already prove the masking works; this proves it
 *    is not, and cannot quietly become, test-only.
 *  - `disableRequestLogging: env.isTest && !logStream` (`server.ts`) means
 *    production requests are logged, not silenced — and Fastify's default
 *    request/response serializers carry method, url and status, never the
 *    body, so "path + status + duration, no body" is what a production line
 *    already looks like without a bespoke serializer to keep in sync.
 */
import { afterEach, describe, expect, it } from 'vitest';
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

function parsedLines(sink: LineSink): Array<Record<string, unknown>> {
  return sink.lines
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

/** 32+ characters and not the `dev-only-` placeholder — the same fixture `production-boot.test.ts` uses. */
const realSecret = (label: string): string => `${label}-0123456789abcdef0123456789abcdef`;

const PRODUCTION_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  LOG_LEVEL: 'info',
  SCHEDULER_ENABLED: 'false',
  OTEL_ENABLED: 'false',
  WEB_ORIGIN: 'https://panel.nexa.test',
  INBOUND_EMAIL_SECRET: 'an-inbound-webhook-shared-secret',
  JWT_SIGNING_KEY: realSecret('jwt'),
  WEBHOOK_HMAC_SEED: realSecret('webhook'),
  CUSTOMER_TOKEN_SECRET: realSecret('customer'),
  UPLOAD_SIGNING_KEY: realSecret('upload'),
  AUDIT_CHAIN_SECRET: realSecret('audit'),
};

describe('production log profile', () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function productionServer(sink: LineSink): Promise<TestServer> {
    return startTestServer(PRODUCTION_ENV, {
      logStream: sink as unknown as NodeJS.WritableStream,
    });
  }

  it('logs the same request_id the client reads off X-Request-Id (NFR-M5)', async () => {
    const sink = new LineSink();
    server = await productionServer(sink);

    const response = await server.get('/health', { 'x-request-id': 'client-supplied-abc123' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('client-supplied-abc123');

    const completed = parsedLines(sink).find((entry) => entry['msg'] === 'request completed');
    expect(completed?.['reqId']).toBe('client-supplied-abc123');
  });

  it('still correlates when the client sends no id — the server-generated one matches on both sides', async () => {
    const sink = new LineSink();
    server = await productionServer(sink);

    const response = await server.get('/health');
    const generatedId = response.headers['x-request-id'];
    expect(typeof generatedId).toBe('string');
    expect((generatedId as string).length).toBeGreaterThan(0);

    const completed = parsedLines(sink).find((entry) => entry['msg'] === 'request completed');
    expect(completed?.['reqId']).toBe(generatedId);
  });

  it('masks a PII-bearing query string under NODE_ENV=production, not only under the test default', async () => {
    const sink = new LineSink();
    server = await productionServer(sink);

    const response = await server.get('/health?email=jane.doe%40example.test&chat_id=c1');
    expect(response.statusCode).toBe(200);

    const written = sink.lines.join('\n');
    expect(written).not.toContain('jane.doe');
    expect(written).not.toContain('example.test');
    expect(written).toContain('[redacted]');
    // Still debuggable: the route and the harmless parameter survive.
    expect(written).toContain('/health');
    expect(written).toContain('chat_id=c1');
  });

  it('logs path, status and duration for a production request, but never a body it carried', async () => {
    const sink = new LineSink();
    server = await productionServer(sink);

    const response = await server.post('/auth/login', {
      email: 'nobody@example.test',
      password: 'never-logged-9f3a2b1c',
    });
    // No such account — the response itself is uninteresting, the log line is.
    expect(response.statusCode).toBe(401);

    const written = sink.lines.join('\n');
    expect(written).not.toContain('never-logged-9f3a2b1c');

    const completed = parsedLines(sink).find((entry) => entry['msg'] === 'request completed');
    expect(completed).toBeDefined();
    expect((completed?.['res'] as { statusCode?: number } | undefined)?.statusCode).toBe(401);
    expect(typeof completed?.['responseTime']).toBe('number');
  });

  it('is a branch, not a constant — production requests are logged, unlike the test default', async () => {
    const sink = new LineSink();
    server = await productionServer(sink);

    await server.get('/health');

    // `disableRequestLogging: env.isTest && !logStream` — this suite proves
    // the production half of that branch: `env.isTest` is false, so the
    // request line is written even though a stream was also supplied.
    expect(parsedLines(sink).some((entry) => entry['msg'] === 'incoming request')).toBe(true);
  });
});
