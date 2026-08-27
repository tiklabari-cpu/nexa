/**
 * The gateway's graceful drain (M-OPS-b).
 *
 * A gateway is where a rolling deploy is most visible, because its clients are
 * long-lived rather than request-shaped: every agent panel and every open chat
 * widget is holding a socket here. Closing them is unavoidable — the process is
 * going away — so the question is only whether the client is told in a way it
 * knows how to handle, and whether the orchestrator stopped sending it new ones
 * first. The four things below are that sequence:
 *
 *   - readiness turns false before anything closes, so the orchestrator can
 *     take this instance out of rotation while it is still working;
 *   - liveness stays 200, because a process that is shutting down on request
 *     has not failed and killing it only adds a SIGKILL to the deploy;
 *   - a new upgrade during the window is refused, or the client we are about to
 *     disconnect reconnects straight back into the instance that is leaving;
 *   - the sockets that were open get close code 1001 ("going away"), which is
 *     the code a client reads as reconnect (NFR-R2) rather than as an error.
 *
 * Real sockets and a real server throughout, for the reason `rtm-harness.ts`
 * gives: these properties only exist at the socket level, and a fake would test
 * the fake.
 */
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { startRtm, TestSocket } from '../helpers/rtm-harness.js';

/** Every server a test started, closed in teardown whatever the test did. */
const running: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
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

async function get(port: number, path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: response.status, body: await response.json() };
}

describe('readiness while draining', () => {
  it('answers 503 draining, and keeps answering liveness 200', async () => {
    // A window long enough to observe from outside. Production defaults to 5s
    // and everything else to 0 (`config/env.ts`), so a suite that did not ask
    // for one never pays for it.
    const { port, close } = await start({ SHUTDOWN_DRAIN_MS: '1500' });

    expect(await get(port, '/health/ready')).toMatchObject({
      status: 200,
      body: { status: 'ok', service: 'rtm' },
    });

    const closing = close();

    const ready = await get(port, '/health/ready');
    expect(ready.status).toBe(503);
    // `draining`, not `degraded`: both take the instance out of rotation, but
    // only one of them is a reason to wake somebody up.
    expect(ready.body).toEqual({ status: 'draining', service: 'rtm' });

    const live = await get(port, '/health/live');
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({ status: 'ok', service: 'rtm' });

    await closing;
  });

  it('answers the legacy /health as draining too', async () => {
    const { port, close } = await start({ SHUTDOWN_DRAIN_MS: '1000' });

    const closing = close();
    const health = await get(port, '/health');

    expect(health.status).toBe(503);
    expect(health.body).toEqual({ status: 'draining', service: 'rtm' });

    await closing;
  });
});

describe('new connections during the window', () => {
  it('refuses an upgrade instead of accepting one it is about to close', async () => {
    // Without this, a client disconnected by the drain reconnects to the very
    // instance that disconnected it, and the deploy loops it around again.
    const { port, close } = await start({ SHUTDOWN_DRAIN_MS: '1500' });
    const closing = close();

    const refused = new Promise<Error>((resolve) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${port}/v1/agent/rtm/ws?organization_id=${crypto.randomUUID()}`,
      );
      ws.on('error', (error: Error) => resolve(error));
      ws.on('open', () => resolve(new Error('the upgrade was accepted')));
    });

    expect((await refused).message).toContain('503');

    await closing;
  });

  it('says which refusal this is, so a drain is not read as a full gateway (M-LOAD-CAP)', async () => {
    // The gateway now has two reasons to turn an upgrade away and they share a
    // status code. `details.reason` is what tells them apart; without it, the
    // response to "why did that pod refuse me" would be prose, and the answers
    // are opposite ones — this instance is leaving on purpose, versus this
    // instance is out of room.
    const { port, close } = await start({ SHUTDOWN_DRAIN_MS: '1500' });
    const closing = close();

    const body = await new Promise<{ error?: Record<string, unknown> }>((resolve, reject) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${port}/v1/agent/rtm/ws?organization_id=${crypto.randomUUID()}`,
      );
      ws.on('unexpected-response', (_request, response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve(
            JSON.parse(Buffer.concat(chunks).toString()) as {
              error?: Record<string, unknown>;
            },
          ),
        );
      });
      ws.on('error', (error: Error) => reject(error));
      ws.on('open', () => reject(new Error('the upgrade was accepted')));
    });

    expect(body.error).toMatchObject({
      type: 'service_unavailable',
      details: { reason: 'draining' },
    });

    await closing;
  });
});

describe('the sockets that were already open', () => {
  it('gets close code 1001, which a client reads as reconnect rather than as an error', async () => {
    const { port, close } = await start();
    const socket = await TestSocket.connect(port, {
      organizationId: crypto.randomUUID(),
      side: 'agent',
    });

    await close();
    // The handshake completes asynchronously; the code is what matters, not
    // which turn of the loop it lands on.
    const deadline = Date.now() + 5_000;
    while (socket.closeCode === null) {
      if (Date.now() > deadline) throw new Error('the socket was never closed');
      await delay(20);
    }

    // 1001 "going away". `apps/web/src/lib/realtime.ts` retries any close it
    // did not initiate, so this is what hands the session to NFR-R2's
    // reconnect + missed-event sync instead of surfacing an error to an agent.
    expect(socket.closeCode).toBe(1001);
  });

  it('closes without waiting out the window when there is none to wait', async () => {
    // The zero-drain default is what keeps every other suite in this package
    // from paying for this feature; a regression here shows up as minutes.
    const { port, close } = await start();
    await TestSocket.connect(port, { organizationId: crypto.randomUUID(), side: 'agent' });

    const startedAt = Date.now();
    await close();

    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
