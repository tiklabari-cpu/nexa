/**
 * `plugins/pending-audit.ts` (tm 324.3) on a bare Fastify instance: the boot
 * pass is never fatal, and says so at `error` when it could not sign. The pass
 * itself against a real database — the move, the chain, the race — is
 * `test/integration/viceowner-migration.test.ts`.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { afterEach, describe, expect, it } from 'vitest';
import type { Env } from '../config/env.js';
import pendingAudit from './pending-audit.js';

class Sink {
  readonly raw: string[] = [];
  write(chunk: string): boolean {
    this.raw.push(chunk);
    return true;
  }
  lines(): Array<Record<string, unknown>> {
    return this.raw
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line['component'] === 'pending-audit');
  }
}

const ENV = { AUDIT_CHAIN_SECRET: 'x'.repeat(32) } as Env;
const TENANT = { license_id: 7n, organization_id: '0f9e8d7c-6b5a-4f3e-9d2c-1b0a9f8e7d6c' };

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** A server whose `database` plugin is a stub answering the pass's two calls. */
async function boot(sink: Sink, db: { $queryRaw: unknown; $transaction: unknown }) {
  app = Fastify({ logger: { level: 'info', stream: sink } });
  await app.register(
    fp(
      async (inner: FastifyInstance) => {
        inner.decorate('db', db as FastifyInstance['db']);
      },
      { name: 'database' },
    ),
  );
  await app.register(pendingAudit, { env: ENV });
  await app.ready();
}

const never = async () => {
  throw new Error('not reached');
};

describe('pending audit boot pass', () => {
  it('says nothing when no entry is waiting', async () => {
    const sink = new Sink();
    await boot(sink, { $queryRaw: async () => [], $transaction: never });
    expect(sink.lines()).toEqual([]);
  });

  it('starts the server when the waiting workspaces cannot be listed, and logs it at error', async () => {
    const sink = new Sink();
    await boot(sink, {
      $queryRaw: async () => {
        throw new Error('function pending_audit_tenants() does not exist');
      },
      $transaction: never,
    });
    expect(sink.lines()).toEqual([
      expect.objectContaining({
        level: 50,
        msg: 'pending audit entries could not be listed; retried at the next boot',
      }),
    ]);
  });

  it("starts the server when a workspace's entries cannot be signed, and names the workspace", async () => {
    const sink = new Sink();
    await boot(sink, {
      $queryRaw: async () => [TENANT],
      $transaction: async () => {
        throw new Error('audit chain head unreachable');
      },
    });
    const [failure, summary] = sink.lines();
    expect(failure).toMatchObject({
      level: 50,
      license_id: '7',
      msg: 'pending audit entries not signed; they stay pending until the next boot',
    });
    expect(summary).toMatchObject({ level: 30, tenants: 1, signed: 0, failed: 1 });
  });
});
