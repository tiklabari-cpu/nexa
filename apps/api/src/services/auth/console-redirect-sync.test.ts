/**
 * The boot-time console callback registration reports and never throws
 * (tm 255.17). The SQL it calls is exercised for real in
 * `test/integration/console-redirect.test.ts`; this is the part that decides
 * whether a failure takes the boot down with it.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerConsoleRedirect } from './console-redirect-sync.js';

const REDIRECT = 'https://panel.example.test/auth/callback';

function logger() {
  return { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger & {
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

const dbAnswering = (queryRaw: () => Promise<unknown>) =>
  ({ $queryRaw: vi.fn(queryRaw) }) as unknown as PrismaClient;

describe('registerConsoleRedirect', () => {
  it('reports how many clients gained the callback, in one info line', async () => {
    const log = logger();
    const count = await registerConsoleRedirect({
      db: dbAnswering(async () => [{ registered: 3 }]),
      redirect: REDIRECT,
      logger: log,
    });

    expect(count).toBe(3);
    expect(log.info).toHaveBeenCalledOnce();
    expect(log.info.mock.calls[0]![0]).toMatchObject({ console_redirect: REDIRECT, clients: 3 });
  });

  it('stays quiet on a boot that had nothing to add', async () => {
    const log = logger();
    const count = await registerConsoleRedirect({
      db: dbAnswering(async () => [{ registered: 0 }]),
      redirect: REDIRECT,
      logger: log,
    });

    expect(count).toBe(0);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('logs a failure and returns null rather than failing the boot', async () => {
    const log = logger();
    const count = await registerConsoleRedirect({
      db: dbAnswering(async () => {
        throw new Error('connection terminated');
      }),
      redirect: REDIRECT,
      logger: log,
    });

    expect(count).toBeNull();
    expect(log.error).toHaveBeenCalledOnce();
    expect(log.error.mock.calls[0]![0]).toMatchObject({
      console_redirect: REDIRECT,
      error_code: 'Error',
    });
  });
});
