/**
 * Whether this process is on its way out (M-OPS-b).
 *
 * One boolean, but it has to live somewhere both the signal handler
 * (`lib/shutdown.ts`) and a request handler (`routes/health.ts`) can reach, and
 * a module-level variable would be shared by every server a test suite builds —
 * one test draining its own instance would make every other instance in the
 * process report 503. Decorating the instance keeps the flag as scoped as the
 * server it describes.
 *
 * Registered before the routes, and with no dependencies: readiness has to be
 * able to say "draining" even if the drain began while a dependency was down,
 * which is exactly the moment the two answers must not be confused for each
 * other.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export interface Lifecycle {
  /**
   * True from the moment shutdown starts. Readiness answers 503 while it is
   * set — that 503 is the whole point of the drain window, because an
   * orchestrator only stops routing here after its next probe fails.
   */
  readonly draining: boolean;
  /** Idempotent: a second SIGTERM must not restart the clock. */
  beginDraining(): void;
}

declare module 'fastify' {
  interface FastifyInstance {
    lifecycle: Lifecycle;
  }
}

export function createLifecycle(): Lifecycle {
  let draining = false;
  return {
    get draining() {
      return draining;
    },
    beginDraining() {
      draining = true;
    },
  };
}

async function lifecyclePlugin(app: FastifyInstance): Promise<void> {
  app.decorate('lifecycle', createLifecycle());

  /**
   * Tell every reply written during a drain not to reuse its connection.
   *
   * `server.ts` sets `forceCloseConnections: false`, because Fastify's default
   * destroys in-flight requests along with idle ones. `close()` then waits for
   * connections to end — and Node's own `server.close()` hands back the ones
   * that are *already* idle, but not the one that is busy right now. That
   * connection finishes its response, parks as keep-alive, and holds the
   * shutdown open for `keepAliveTimeout` (72 seconds by default) — longer than
   * any orchestrator's grace period, so a drain that got everything else right
   * would still end in SIGKILL.
   *
   * `Connection: close` closes that gap at the only place that knows the reply
   * is the last one: Node reads the header while writing it, marks the response
   * as final, and ends the socket once it has been sent. The client opens a
   * fresh connection for its next request, which is what it should be doing
   * anyway — this process is leaving.
   *
   * `onSend`, not `onRequest`: the request this matters most for is the one
   * that was already in flight when the drain began, and `onRequest` fired for
   * it before there was anything to say.
   */
  app.addHook('onSend', async (_request, reply) => {
    if (app.lifecycle.draining) reply.header('connection', 'close');
  });
}

export default fp(lifecyclePlugin, { name: 'lifecycle' });
