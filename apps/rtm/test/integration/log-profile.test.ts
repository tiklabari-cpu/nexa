/**
 * Production log profile (M-OPS-c · NFR-M5 · NFR-S9).
 *
 * The gateway's pino instance had no way to be observed from a test — only
 * source could be read, never what actually reached stdout. `startRtm`'s
 * optional log stream (mirroring the API's `logStream`,
 * `apps/api/src/server.ts`) makes that measurable, the same way
 * `hipaa-constraints.test.ts` and `device-tokens.test.ts` do for the API.
 *
 * Two properties, both already true in source and neither previously run:
 * level follows `LOG_LEVEL` exactly as the API's does (`config/env.ts`), and
 * a per-message log line now carries the `request_id` the client sent
 * (`dispatcher.ts`, `server.ts`) — without it, an operator reading "rtm login
 * rejected" in production has no way to tell which frame the client is still
 * waiting on, the one correlation NFR-M5 asks for.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ownerClient, seedRtmFixtures, type RtmFixtures } from '../helpers/fixtures.js';
import { startRtm, TestSocket } from '../helpers/rtm-harness.js';

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

describe('rtm production log profile', () => {
  let db: PrismaClient;
  let fx: RtmFixtures;
  let rtm: Awaited<ReturnType<typeof startRtm>> | undefined;

  beforeAll(async () => {
    db = ownerClient();
    fx = await seedRtmFixtures(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  afterEach(async () => {
    await rtm?.close();
    rtm = undefined;
  });

  it('follows LOG_LEVEL exactly as the API — a debug line is silent at the info default', async () => {
    const sink = new LineSink();
    rtm = await startRtm({ LOG_LEVEL: 'info' }, sink as unknown as NodeJS.WritableStream);

    const socket = await TestSocket.connect(rtm.port, { organizationId: fx.a.organizationId });
    const response = await socket.request('login', { token: 'never-existed' });
    expect(response.success).toBe(false);
    socket.close();

    // `rtm login rejected` is logged at `debug` (`dispatcher.ts`); `info` must
    // not surface it — the same threshold discipline as `LOG_LEVEL` on the API.
    expect(sink.lines.join('\n')).not.toContain('rtm login rejected');
  });

  it('writes the debug line once LOG_LEVEL exposes it', async () => {
    const sink = new LineSink();
    rtm = await startRtm({ LOG_LEVEL: 'debug' }, sink as unknown as NodeJS.WritableStream);

    const socket = await TestSocket.connect(rtm.port, { organizationId: fx.a.organizationId });
    const response = await socket.request('login', { token: 'never-existed' });
    expect(response.success).toBe(false);
    socket.close();

    const rejected = parsedLines(sink).find((entry) => entry['msg'] === 'rtm login rejected');
    expect(rejected).toBeDefined();
  });

  it("carries the client's request_id, so the line can be matched to the response frame (NFR-M5)", async () => {
    const sink = new LineSink();
    rtm = await startRtm({ LOG_LEVEL: 'debug' }, sink as unknown as NodeJS.WritableStream);

    const socket = await TestSocket.connect(rtm.port, { organizationId: fx.a.organizationId });
    const response = await socket.request('login', { token: 'never-existed' });
    expect(response.success).toBe(false);
    socket.close();

    const rejected = parsedLines(sink).find((entry) => entry['msg'] === 'rtm login rejected');
    // `response.request_id` is what `TestSocket.request` generated and the
    // gateway echoed back on the response frame — this is the id an operator
    // has in hand from the client side.
    expect(rejected?.['request_id']).toBe(response.request_id);
    expect(response.request_id).toBeTruthy();
  });
});
