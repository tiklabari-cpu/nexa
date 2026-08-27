/**
 * The gateway's connection ceiling (M-LOAD-CAP · §D127).
 *
 * §D127 measured what this gateway does under more load than it can serve, and
 * the answer was: it accepts. Every socket got in, and the cost came out of the
 * fan-out budget instead — so the agents already connected paid, silently, for
 * the ones still arriving, and nothing in the process knew a limit existed to
 * be crossed. `MAX_CONN|maxConnections|CONNECTION_LIMIT` matched nothing under
 * `apps/rtm/src`.
 *
 * What is asserted here is therefore not "8000 sockets fit" — that number is
 * one laptop's, and the ceiling is deliberately a configured value rather than
 * a constant. It is the three properties that make a configured ceiling worth
 * having:
 *
 *   - at the ceiling, the next upgrade is refused *by name*, and the sockets
 *     already connected are untouched and still working. A limit that sheds
 *     load by degrading everyone is the behaviour this replaces;
 *   - the ceiling tracks live sockets, not lifetime arrivals — when one leaves,
 *     the next one is let in;
 *   - unset changes nothing. This key opening a seam must not be the reason a
 *     running deployment starts refusing anybody.
 *
 * Real sockets and a real server throughout, for the reason `rtm-harness.ts`
 * gives: a refused upgrade is an HTTP response inside a WebSocket handshake,
 * and a fake would test the fake.
 */
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { RTM_LISTEN_BACKLOG, buildRtmServer } from '../../src/server.js';
import { rtmTestEnv, startRtm, TestSocket } from '../helpers/rtm-harness.js';

/** Every server a test started, closed in teardown whatever the test did. */
const running: Array<{ close: () => Promise<void> }> = [];
/** Every client socket a test opened, likewise. */
const sockets: WebSocket[] = [];

afterEach(async () => {
  while (sockets.length > 0) sockets.pop()?.terminate();
  while (running.length > 0)
    await running
      .pop()
      ?.close()
      .catch(() => {});
});

async function start(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  const rtm = await startRtm(overrides);
  running.push({ close: rtm.close });
  return rtm;
}

type UpgradeOutcome =
  | { accepted: true }
  | { accepted: false; status: number; body: { error?: Record<string, unknown> } };

/**
 * Attempt one upgrade and report what came back.
 *
 * `unexpected-response` rather than `error`: `ws` hands the whole HTTP response
 * to that listener and suppresses `error` when it is attached, which is the
 * only way to read the refusal's body from the client side. Without it a
 * refusal is just the string "Unexpected server response: 503", and "the
 * gateway is full" and "the gateway is draining" become indistinguishable —
 * which is the thing this test exists to prevent.
 */
function attemptUpgrade(
  port: number,
  organizationId = crypto.randomUUID(),
): Promise<UpgradeOutcome> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/v1/agent/rtm/ws?organization_id=${organizationId}`,
    );
    sockets.push(ws);

    ws.on('open', () => resolve({ accepted: true }));
    ws.on('unexpected-response', (_request, response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        resolve({
          accepted: false,
          status: response.statusCode ?? 0,
          body: raw === '' ? {} : (JSON.parse(raw) as { error?: Record<string, unknown> }),
        });
      });
    });
    ws.on('error', (error: Error) => reject(error));
  });
}

/** Wait for the server to notice a socket went away — `ws` closes it, we see it. */
async function waitForRegistrySize(
  registry: { size: number },
  expected: number,
  timeoutMs = 5_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (registry.size !== expected && Date.now() < deadline) await delay(20);
  return registry.size;
}

describe('at the ceiling', () => {
  it('refuses the next upgrade by name and leaves the sockets already connected working', async () => {
    const rtm = await start({ RTM_MAX_CONNECTIONS: '2' });

    const first = await TestSocket.connect(rtm.port, {
      organizationId: crypto.randomUUID(),
      side: 'agent',
    });
    const second = await TestSocket.connect(rtm.port, {
      organizationId: crypto.randomUUID(),
      side: 'agent',
    });
    expect(rtm.server.registry.size).toBe(2);

    const refused = await attemptUpgrade(rtm.port);
    expect(refused.accepted).toBe(false);
    if (refused.accepted) throw new Error('unreachable');

    expect(refused.status).toBe(503);
    // The named half. `service_unavailable` is the existing 503 error type
    // (`packages/types/src/errors.ts`); `details.reason` is what tells this
    // apart from the drain's refusal, which shares the status and the type.
    expect(refused.body.error).toMatchObject({
      type: 'service_unavailable',
      details: { reason: 'connection_limit_reached' },
    });

    // What the ceiling is *for*: the sockets that got in are not paying for the
    // one that did not. Both still answer, and the count did not move.
    expect((await first.request('ping')).success).toBe(true);
    expect((await second.request('ping')).success).toBe(true);
    expect(first.closed).toBe(false);
    expect(second.closed).toBe(false);
    expect(rtm.server.registry.size).toBe(2);
  });

  it('never names the configured number, which is what an anonymous caller would be learning', async () => {
    // The *fact* that this instance is full is operationally necessary — it is
    // what separates "the pod refused me" from "my machine ran out of ports"
    // (§D127). The number is capacity intelligence and stays behind /health's
    // admin gate (M-SEC-b2).
    const rtm = await start({ RTM_MAX_CONNECTIONS: '1' });
    await TestSocket.connect(rtm.port, {
      organizationId: crypto.randomUUID(),
      side: 'agent',
    });

    const refused = await attemptUpgrade(rtm.port);
    if (refused.accepted) throw new Error('the upgrade was accepted');

    expect(JSON.stringify(refused.body)).not.toMatch(/\b1\b/);
    expect(JSON.stringify(refused.body)).not.toMatch(/max_connections|RTM_MAX_CONNECTIONS/i);
  });

  it('lets the next one in as soon as a socket leaves — a ceiling on live sockets, not on arrivals', async () => {
    const rtm = await start({ RTM_MAX_CONNECTIONS: '1' });

    const held = await TestSocket.connect(rtm.port, {
      organizationId: crypto.randomUUID(),
      side: 'agent',
    });
    expect((await attemptUpgrade(rtm.port)).accepted).toBe(false);

    held.close();
    expect(await waitForRegistrySize(rtm.server.registry, 0)).toBe(0);

    // Without this, the ceiling would be a lifetime budget: a pod would refuse
    // every reconnect after its first N clients had ever connected, and NFR-R2
    // reconnects would be the traffic that exhausts it.
    expect((await attemptUpgrade(rtm.port)).accepted).toBe(true);
    expect(rtm.server.registry.size).toBe(1);
  });
});

describe('with no ceiling configured', () => {
  it('accepts every upgrade, exactly as it did before this key existed', async () => {
    // "Unlimited" cannot be proved by opening sockets, so this pins the thing
    // that actually could regress: with the key unset there is no branch a
    // socket can be refused by. Six is arbitrary and comfortably past the
    // smallest ceiling the tests above use.
    const rtm = await start();
    expect(rtmTestEnv().maxConnections).toBeNull();

    for (let i = 0; i < 6; i += 1) {
      expect((await attemptUpgrade(rtm.port)).accepted, `upgrade ${i + 1}`).toBe(true);
    }
    expect(rtm.server.registry.size).toBe(6);
  });
});

describe('the listen backlog', () => {
  it('is chosen explicitly rather than inherited from Node', async () => {
    // §D127's overload is bursty by construction — accepting and fanning out
    // compete for one JS thread — so the accept queue is what stands between a
    // burst and an anonymous kernel `ECONNREFUSED`. Node's implicit 511 was
    // nobody's decision; this asserts a decision was made, and that the options
    // form of `listen` is what carries it.
    const server = buildRtmServer(rtmTestEnv());
    running.push({ close: () => server.close() });

    const observed: unknown[] = [];
    const realListen = server.http.listen.bind(server.http);
    server.http.listen = ((...args: unknown[]) => {
      observed.push(args[0]);
      return (realListen as (...a: unknown[]) => unknown)(...args);
    }) as typeof server.http.listen;

    await server.listen();

    expect(observed[0]).toMatchObject({ backlog: RTM_LISTEN_BACKLOG });
    expect(RTM_LISTEN_BACKLOG).toBeGreaterThan(511);
    // Linux clamps to `net.core.somaxconn`; asking for more than that is a
    // claim the OS will not honour.
    expect(RTM_LISTEN_BACKLOG).toBeLessThanOrEqual(4096);
  });
});
