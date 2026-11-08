/**
 * The post-login visitor socket caps (tm 427).
 *
 * The pre-login cap (`prelogin-limit.test.ts`, tm 405) lets go of a socket the
 * moment it logs in. A visitor token is minted for anyone who loads a page with
 * the widget and costs the gateway nothing to verify, so one token opened
 * socket after socket from one address — fifty a second — and every one of
 * them stayed: the 2026-11-06 audit's F09. What is asserted here, against a
 * real gateway and real sockets:
 *
 *   - one visitor holds at most `RTM_MAX_SOCKETS_PER_CUSTOMER` logged-in
 *     sockets; the next one's login is answered `too_many_requests`
 *     (`socket_limit_reached`, never the number) and the socket closed with
 *     1013, and the sockets already in are untouched;
 *   - a slot frees when one of them closes;
 *   - one client network holds at most `RTM_MAX_CUSTOMER_SOCKETS_PER_IP`
 *     visitor sockets, however many visitors it mints — another network is not
 *     affected;
 *   - member sockets are never counted;
 *   - every refusal is counted on `rtm.connections.closed{reason=socket_limit}`,
 *     one `warn` line per episode;
 *   - the counts drain to nothing.
 *
 * Every upgrade comes from 127.0.0.1, so at `TRUST_PROXY_HOPS=1` the
 * forwarded-for header is what tells two test "networks" apart — as in
 * `prelogin-limit.test.ts`.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { licenseChannel, type BusEnvelope } from '@siyahtus/types';
import {
  createCustomer,
  customerToken,
  grantToken,
  ownerClient,
  seedRtmFixtures,
  type RtmFixtures,
} from '../helpers/fixtures.js';
import { startRtm, TestSocket } from '../helpers/rtm-harness.js';
import { createTelemetry, type Telemetry } from '../../src/telemetry/telemetry.js';

const A = '198.51.100.1';
const B = '198.51.100.2';

const running: Array<{ close: () => Promise<void> }> = [];
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

async function start(
  overrides: Partial<NodeJS.ProcessEnv> = {},
  options: { sink?: LineSink; telemetry?: Telemetry } = {},
) {
  const rtm = await startRtm(
    {
      RTM_MAX_SOCKETS_PER_CUSTOMER: '2',
      RTM_MAX_CUSTOMER_SOCKETS_PER_IP: '3',
      ...overrides,
    },
    options.sink as unknown as NodeJS.WritableStream | undefined,
    options.telemetry,
  );
  running.push({ close: rtm.close });
  return rtm;
}

function tokenFor(customerId: string): string {
  return customerToken({
    customerId,
    organizationId: fx.a.organizationId,
    licenseId: fx.a.licenseId,
    secret: customerSecret,
  });
}

/** A visitor's socket "from" `network`, logged in with `token`. */
async function visitor(
  port: number,
  network: string,
  token: string,
): Promise<{ socket: TestSocket; login: Awaited<ReturnType<TestSocket['request']>> }> {
  const socket = await TestSocket.connect(port, {
    organizationId: fx.a.organizationId,
    side: 'customer',
    headers: { 'x-forwarded-for': network },
  });
  sockets.push(socket);
  const login = await socket.request('login', {
    token,
    pushes: { '3.6': ['incoming_event'] },
  });
  return { socket, login };
}

function refusalOf(login: { success?: boolean; payload: Record<string, unknown> }) {
  return login.payload['error'] as
    { type: string; message: string; details?: Record<string, unknown> } | undefined;
}

async function until(check: () => boolean, timeoutMs = 5_000): Promise<boolean> {
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

describe('one visitor (RTM_MAX_SOCKETS_PER_CUSTOMER)', () => {
  it('closes the socket past the cap with socket_limit_reached and 1013, and leaves the ones already in working (NFR-S8)', async () => {
    const rtm = await start();
    const token = tokenFor(fx.a.customerId);
    const first = await visitor(rtm.port, A, token);
    const second = await visitor(rtm.port, A, token);
    expect(first.login.success).toBe(true);
    expect(second.login.success).toBe(true);
    const key = `${fx.a.organizationId}:${fx.a.customerId}`;
    expect(rtm.server.customerSockets?.heldByCustomer(key)).toBe(2);

    const third = await visitor(rtm.port, A, token);

    expect(third.login.success).toBe(false);
    expect(refusalOf(third.login)).toMatchObject({
      type: 'too_many_requests',
      details: { reason: 'socket_limit_reached' },
    });
    // The reason, never the number.
    expect(JSON.stringify(third.login)).not.toMatch(/\b2\b|RTM_MAX|max_sockets/i);
    expect(await third.socket.waitForClose()).toBe(1013);
    expect(rtm.server.customerSockets?.heldByCustomer(key)).toBe(2);

    // The two in are untouched: they ping, and a reply addressed to the visitor
    // reaches both of them.
    expect((await first.socket.request('ping')).success).toBe(true);
    const envelope: BusEnvelope = {
      v: 1,
      licenseId: fx.a.licenseId.toString(),
      organizationId: fx.a.organizationId,
      action: 'incoming_event',
      audience: { customerId: fx.a.customerId },
      payload: { chat_id: 'TJ1H8CFKRV', event: { id: 'TJ1H8CFKRV_2', recipients: 'all' } },
      at: Date.now(),
    };
    await redis.publish(licenseChannel(fx.a.licenseId), JSON.stringify(envelope));
    await first.socket.waitForPush('incoming_event');
    await second.socket.waitForPush('incoming_event');
  });

  it('lets a new socket in once one of the visitor’s sockets closes', async () => {
    const rtm = await start();
    const token = tokenFor(fx.a.customerId);
    const first = await visitor(rtm.port, A, token);
    await visitor(rtm.port, A, token);
    expect((await visitor(rtm.port, A, token)).login.success).toBe(false);

    first.socket.close();
    const key = `${fx.a.organizationId}:${fx.a.customerId}`;
    expect(await until(() => rtm.server.customerSockets?.heldByCustomer(key) === 1)).toBe(true);

    expect((await visitor(rtm.port, A, token)).login.success).toBe(true);
  });

  it('counts the visitor across networks — a second address does not buy more tabs', async () => {
    const rtm = await start();
    const token = tokenFor(fx.a.customerId);
    await visitor(rtm.port, A, token);
    await visitor(rtm.port, B, token);

    const third = await visitor(rtm.port, '198.51.100.3', token);
    expect(refusalOf(third.login)?.details).toEqual({ reason: 'socket_limit_reached' });
  });
});

describe('one client network (RTM_MAX_CUSTOMER_SOCKETS_PER_IP)', () => {
  it('refuses a fresh visitor past the network cap — minting a token per socket does not get past it (NFR-S8)', async () => {
    const rtm = await start();
    const visitors = [fx.a.customerId];
    for (let i = 0; i < 3; i += 1) visitors.push(await createCustomer(db, fx.a));

    for (const customerId of visitors.slice(0, 3)) {
      expect((await visitor(rtm.port, A, tokenFor(customerId))).login.success).toBe(true);
    }
    const past = await visitor(rtm.port, A, tokenFor(visitors[3]!));

    expect(refusalOf(past.login)).toMatchObject({
      type: 'too_many_requests',
      details: { reason: 'socket_limit_reached' },
    });
    expect(await past.socket.waitForClose()).toBe(1013);
    expect(rtm.server.customerSockets?.heldByNetwork(A)).toBe(3);
  });

  it('does not touch another network', async () => {
    const rtm = await start();
    for (let i = 0; i < 3; i += 1) {
      const customerId = await createCustomer(db, fx.a);
      await visitor(rtm.port, A, tokenFor(customerId));
    }
    expect((await visitor(rtm.port, A, tokenFor(fx.a.customerId))).login.success).toBe(false);

    expect((await visitor(rtm.port, B, tokenFor(fx.a.customerId))).login.success).toBe(true);
    expect(rtm.server.customerSockets?.heldByNetwork(B)).toBe(1);
  });

  it('counts every address of one IPv6 /64 as one network', async () => {
    const rtm = await start();
    for (const address of ['2001:db8:1:2::1', '2001:db8:1:2::2', '2001:db8:1:2:a:b:c:d']) {
      const customerId = await createCustomer(db, fx.a);
      expect((await visitor(rtm.port, address, tokenFor(customerId))).login.success).toBe(true);
    }
    const customerId = await createCustomer(db, fx.a);
    expect(
      (await visitor(rtm.port, '2001:db8:1:2::ffff', tokenFor(customerId))).login.success,
    ).toBe(false);
    expect(rtm.server.customerSockets?.heldByNetwork('2001:db8:1:2::/64')).toBe(3);
  });
});

describe('members are not visitors', () => {
  it('never counts a member’s sockets: one token opens more than either cap from one network', async () => {
    const rtm = await start();
    const token = await grantToken(db, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['chats--access:rw'],
    });

    for (let i = 0; i < 5; i += 1) {
      const socket = await TestSocket.connect(rtm.port, {
        organizationId: fx.a.organizationId,
        side: 'agent',
        headers: { 'x-forwarded-for': A },
      });
      sockets.push(socket);
      expect(
        (await socket.request('login', { token: `Bearer ${token}` })).success,
        `tab ${i + 1}`,
      ).toBe(true);
    }
    expect(rtm.server.customerSockets?.size).toBe(0);
  });
});

describe('what an operator sees', () => {
  it('counts every refusal as reason=socket_limit and logs one line per episode, in snake_case', async () => {
    const sink = new LineSink();
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const telemetry = createTelemetry({
      serviceName: 'siyahtus-rtm-test',
      serviceVersion: '0.0.0-test',
      metricExporter: exporter,
    });
    const rtm = await start(
      { RTM_MAX_SOCKETS_PER_CUSTOMER: '1', LOG_LEVEL: 'info' },
      { sink, telemetry },
    );
    const token = tokenFor(fx.a.customerId);
    await visitor(rtm.port, A, token);

    for (let i = 0; i < 2; i += 1) {
      const refused = await visitor(rtm.port, A, token);
      expect(await refused.socket.waitForClose()).toBe(1013);
    }
    expect(await until(() => rtm.server.registry.size === 1)).toBe(true);

    const lines = sink
      .parsed()
      .filter((line) => String(line['msg']).startsWith('rtm visitor socket limit reached'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 40,
      customer_id: fx.a.customerId,
      client_network: A,
      limit: 'customer',
      customer_sockets: 1,
      max_sockets_per_customer: 1,
      max_customer_sockets_per_ip: 3,
    });

    await telemetry.flushMetrics();
    expect(closedCounted(exporter.getMetrics(), 'socket_limit')).toBe(2);
  });
});

describe('the count is of sockets open right now', () => {
  it('drains to nothing once every socket has gone', async () => {
    const rtm = await start({
      RTM_MAX_SOCKETS_PER_CUSTOMER: '5',
      RTM_MAX_CUSTOMER_SOCKETS_PER_IP: '50',
    });
    const second = await createCustomer(db, fx.a);
    const opened = [
      await visitor(rtm.port, A, tokenFor(fx.a.customerId)),
      await visitor(rtm.port, A, tokenFor(fx.a.customerId)),
      await visitor(rtm.port, B, tokenFor(second)),
    ];
    expect(rtm.server.customerSockets?.keys).toEqual({ customers: 2, networks: 2 });

    for (const { socket } of opened) socket.close();
    expect(await until(() => rtm.server.registry.size === 0)).toBe(true);
    expect(rtm.server.customerSockets?.size).toBe(0);
    expect(rtm.server.customerSockets?.keys).toEqual({ customers: 0, networks: 0 });
  });

  it('does not count a visitor whose login was refused for its token', async () => {
    const rtm = await start();
    const { login } = await visitor(rtm.port, A, `${tokenFor(fx.a.customerId)}x`);
    expect(login.success).toBe(false);
    expect(rtm.server.customerSockets?.size).toBe(0);
  });
});

describe('turned off', () => {
  it('builds no limiter and refuses nobody when both caps are 0', async () => {
    const rtm = await start({
      RTM_MAX_SOCKETS_PER_CUSTOMER: '0',
      RTM_MAX_CUSTOMER_SOCKETS_PER_IP: '0',
    });
    expect(rtm.server.customerSockets).toBeNull();
    const token = tokenFor(fx.a.customerId);
    for (let i = 0; i < 4; i += 1) {
      expect((await visitor(rtm.port, A, token)).login.success, `socket ${i + 1}`).toBe(true);
    }
  });
});
