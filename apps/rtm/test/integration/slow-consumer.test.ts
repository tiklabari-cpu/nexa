/**
 * A socket that stops reading is closed, not buffered for without limit — and
 * what it missed comes back with the reconnect `sync` (tm 428).
 *
 * The 2026-11-06 audit's F10: a visitor sending ten `sync` requests a second,
 * each echoing long cursor keys back in `removed_chat_ids`, while never reading
 * its end of the TCP connection, grew the gateway's send buffer for as long as
 * the socket stayed open. Here a real client stops reading — its TCP socket is
 * paused, so the kernel buffers fill and the gateway's own buffer starts to
 * grow — while pushes keep arriving. What is asserted:
 *
 *   - past `RTM_MAX_BUFFERED_BYTES` the gateway stops writing and closes the
 *     socket with 1013, with one `warn` line and `reason=slow_consumer`;
 *   - nothing written before is thrown away: once the client reads again it
 *     receives what was queued, then the close;
 *   - an event that happened meanwhile is not lost: the reconnect `sync`
 *     returns it (NFR-R2);
 *   - the `sync` echo is bounded: a cursor key no chat id could be is refused,
 *     not echoed.
 */
import type { Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import WebSocket from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { licenseChannel, type BusEnvelope } from '@siyahtus/types';
import {
  createConversation,
  customerToken,
  ownerClient,
  seedRtmFixtures,
  type RtmFixtures,
} from '../helpers/fixtures.js';
import { startRtm, TestSocket, type Frame } from '../helpers/rtm-harness.js';
import { createTelemetry } from '../../src/telemetry/telemetry.js';

/** The floor `RTM_MAX_BUFFERED_BYTES` accepts — small, so the kernel buffers are the bulk. */
const LIMIT = 64 * 1024;
/** One filler push: big enough that the buffers fill in few of them. */
const FILLER_TEXT = 'x'.repeat(64 * 1024);
/** Give up past this much — far more than any loopback buffer holds. */
const MAX_PUBLISHED_BYTES = 512 * 1024 * 1024;

const running: Array<{ close: () => Promise<void> }> = [];
const clients: WebSocket[] = [];
const sockets: TestSocket[] = [];

let db: PrismaClient;
let redis: Redis;
let fx: RtmFixtures;
const customerSecret = process.env['CUSTOMER_TOKEN_SECRET'] ?? '';

beforeAll(() => {
  db = ownerClient();
  redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6380');
});

afterAll(async () => {
  await redis.quit();
  await db.$disconnect();
});

beforeEach(async () => {
  fx = await seedRtmFixtures(db);
});

afterEach(async () => {
  while (clients.length > 0) clients.pop()?.terminate();
  while (sockets.length > 0) sockets.pop()?.close();
  while (running.length > 0)
    await running
      .pop()
      ?.close()
      .catch(() => {});
});

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
  parsed(): Array<Record<string, unknown>> {
    return this.lines.flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
  }
}

/** A visitor client whose TCP reads can be stopped: the slow consumer. */
class ReadingClient {
  readonly frames: Frame[] = [];
  closeCode: number | null = null;
  #counter = 0;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      this.frames.push(JSON.parse(raw.toString()) as Frame);
    });
    ws.on('close', (code) => {
      this.closeCode = code;
    });
  }

  static open(port: number, organizationId: string): Promise<ReadingClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${port}/v1/customer/rtm/ws?organization_id=${organizationId}`,
      );
      clients.push(ws);
      const client = new ReadingClient(ws);
      ws.on('open', () => resolve(client));
      ws.on('error', reject);
    });
  }

  async request(action: string, payload: Record<string, unknown>): Promise<Frame> {
    const requestId = `slow-${++this.#counter}`;
    this.ws.send(JSON.stringify({ version: '3.6', request_id: requestId, action, payload }));
    const deadline = Date.now() + 5_000;
    for (;;) {
      const answer = this.frames.find((frame) => frame.request_id === requestId);
      if (answer) return answer;
      if (Date.now() > deadline) throw new Error(`no answer to ${action}`);
      await delay(10);
    }
  }

  /** Stop reading the TCP connection — the kernel buffers fill, then the gateway's. */
  stopReading(): void {
    (this.ws as unknown as { _socket: Socket })._socket.pause();
  }

  resumeReading(): void {
    (this.ws as unknown as { _socket: Socket })._socket.resume();
  }
}

function visitorToken(): string {
  return customerToken({
    customerId: fx.a.customerId,
    organizationId: fx.a.organizationId,
    licenseId: fx.a.licenseId,
    secret: customerSecret,
  });
}

async function publishEvent(chatId: string, event: Record<string, unknown>): Promise<number> {
  const envelope: BusEnvelope = {
    v: 1,
    licenseId: fx.a.licenseId.toString(),
    organizationId: fx.a.organizationId,
    action: 'incoming_event',
    audience: { customerId: fx.a.customerId },
    payload: { chat_id: chatId, event },
    at: Date.now(),
  };
  const message = JSON.stringify(envelope);
  await redis.publish(licenseChannel(fx.a.licenseId), message);
  return message.length;
}

async function until(check: () => boolean, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await delay(20);
  return check();
}

function closedCounted(metrics: ResourceMetrics[], reason: string): number {
  const latest = metrics[metrics.length - 1];
  if (!latest) return 0;
  let total = 0;
  for (const scope of latest.scopeMetrics) {
    for (const metric of scope.metrics) {
      if (metric.descriptor.name !== 'rtm.connections.closed') continue;
      for (const point of metric.dataPoints) {
        if (point.attributes['reason'] === reason) total += point.value as number;
      }
    }
  }
  return total;
}

describe('a socket that stops reading (tm 428)', () => {
  it('is closed with 1013 past RTM_MAX_BUFFERED_BYTES; what was queued still arrives, and the reconnect sync brings back what it missed (NFR-S8 · NFR-R2)', async () => {
    const sink = new LineSink();
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const telemetry = createTelemetry({
      serviceName: 'siyahtus-rtm-test',
      serviceVersion: '0.0.0-test',
      metricExporter: exporter,
    });
    const rtm = await startRtm(
      { RTM_MAX_BUFFERED_BYTES: String(LIMIT), LOG_LEVEL: 'info' },
      sink as unknown as NodeJS.WritableStream,
      telemetry,
    );
    running.push({ close: rtm.close });

    const conversation = await createConversation(db, { tenant: fx.a, messages: ['hello'] });
    const client = await ReadingClient.open(rtm.port, fx.a.organizationId);
    const login = await client.request('login', {
      token: visitorToken(),
      pushes: { '3.6': ['incoming_event'] },
    });
    expect(login.success).toBe(true);
    const connection = rtm.server.registry
      .authenticated()
      .find((candidate) => candidate.actorType === 'customer');
    if (!connection) throw new Error('the visitor socket is not in the registry');

    client.stopReading();
    let published = 0;
    let filler = 0;
    while (connection.closedBy !== 'slow_consumer' && published < MAX_PUBLISHED_BYTES) {
      for (let i = 0; i < 16; i += 1) {
        filler += 1;
        published += await publishEvent(conversation.chatId, {
          id: `FILLER_${filler}`,
          text: FILLER_TEXT,
          recipients: 'all',
        });
      }
      await delay(25);
    }
    expect(connection.closedBy, `published ${published} bytes`).toBe('slow_consumer');

    // An event the visitor must not lose, happening while the socket is being
    // closed: in the database, and pushed — the push is not written.
    const missedId = `${conversation.threadId}_2`;
    await db.event.create({
      data: {
        id: missedId,
        threadId: conversation.threadId,
        chatId: conversation.chatId,
        licenseId: fx.a.licenseId,
        type: 'message',
        text: 'while you were not reading',
        authorType: 'agent',
        recipients: 'all',
      },
    });
    await publishEvent(conversation.chatId, {
      id: missedId,
      text: 'while you were not reading',
      recipients: 'all',
    });
    await delay(100);

    // Reading again: what was queued arrives, then the close — 1013, "try again later".
    client.resumeReading();
    expect(await until(() => client.closeCode !== null)).toBe(true);
    expect(client.closeCode).toBe(1013);
    const pushed = client.frames.filter((frame) => frame.type === 'push');
    expect(pushed.length).toBeGreaterThan(0);
    expect(pushed.length).toBeLessThan(filler);
    expect(JSON.stringify(pushed.map((frame) => frame.payload['event']))).not.toContain(missedId);

    const lines = sink
      .parsed()
      .filter((line) => String(line['msg']).startsWith('rtm slow consumer'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 40,
      connection_id: connection.id,
      actor_id: fx.a.customerId,
      max_buffered_bytes: LIMIT,
    });
    expect(Number(lines[0]!['buffered_bytes'])).toBeGreaterThan(LIMIT);
    // Ids and sizes, never a frame.
    expect(sink.lines.join('')).not.toContain('xxxxxxxx');

    expect(await until(() => rtm.server.registry.get(connection.id) === undefined)).toBe(true);
    await telemetry.flushMetrics();
    expect(closedCounted(exporter.getMetrics(), 'slow_consumer')).toBe(1);

    // The widget reconnects on a close it did not ask for, and syncs from the
    // last event it had read.
    const again = await TestSocket.connect(rtm.port, {
      organizationId: fx.a.organizationId,
      side: 'customer',
    });
    sockets.push(again);
    expect((await again.request('login', { token: visitorToken() })).success).toBe(true);
    const sync = await again.request('sync', {
      cursors: { [conversation.chatId]: conversation.eventIds[0] },
    });
    const chats = sync.payload['chats'] as Array<{ events: Array<{ id: string; text: string }> }>;
    expect(chats[0]!.events.map((event) => [event.id, event.text])).toEqual([
      [missedId, 'while you were not reading'],
    ]);
  });

  it('keeps a reading socket open however much it is sent', async () => {
    const rtm = await startRtm({ RTM_MAX_BUFFERED_BYTES: String(LIMIT) });
    running.push({ close: rtm.close });
    const conversation = await createConversation(db, { tenant: fx.a, messages: ['hello'] });
    const socket = await TestSocket.connect(rtm.port, {
      organizationId: fx.a.organizationId,
      side: 'customer',
    });
    sockets.push(socket);
    await socket.request('login', { token: visitorToken(), pushes: { '3.6': ['incoming_event'] } });

    // Sixty-four of them, one at a time — 4 MiB in all, sixty-four times the
    // limit, but never more than one frame waiting.
    for (let i = 1; i <= 64; i += 1) {
      await publishEvent(conversation.chatId, {
        id: `READ_${i}`,
        text: FILLER_TEXT,
        recipients: 'all',
      });
      await socket.waitFor(
        (frame) =>
          frame.type === 'push' &&
          (frame.payload['event'] as { id?: string } | undefined)?.id === `READ_${i}`,
      );
    }
    expect(socket.closed).toBe(false);
    expect((await socket.request('ping')).success).toBe(true);
  });
});

describe('the sync echo is bounded (tm 428)', () => {
  it('refuses a cursor key no chat id could be, rather than echoing it back', async () => {
    const rtm = await startRtm();
    running.push({ close: rtm.close });
    const socket = await TestSocket.connect(rtm.port, {
      organizationId: fx.a.organizationId,
      side: 'customer',
    });
    sockets.push(socket);
    await socket.request('login', { token: visitorToken() });

    const longKey = `ECHO${'K'.repeat(1_020)}`;
    const refused = await socket.request('sync', { cursors: { [longKey]: null } });
    expect(refused.success).toBe(false);
    expect((refused.payload['error'] as { type: string }).type).toBe('validation');
    expect(JSON.stringify(refused)).not.toContain('ECHO');

    // An id-shaped key the visitor cannot see is still answered as gone.
    const answered = await socket.request('sync', { cursors: { ZZZZZZZZZZ: null } });
    expect(answered.payload['removed_chat_ids']).toEqual(['ZZZZZZZZZZ']);
  });
});
