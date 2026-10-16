import { describe, expect, it } from 'vitest';
import { aiJobLeaseMs } from '../../plugins/ai-jobs.js';
import { AI_JOB_LEASE_MS } from './ai-job-worker.js';
import {
  AI_JOBS_LISTENER_APPLICATION_NAME,
  listenConnectionString,
  pgWakeups,
} from './ai-job-wakeups.js';
import { AI_JOB_MAX_LEASE_MS } from './ai-jobs.js';

describe('listenConnectionString', () => {
  it("keeps the role, server and TLS settings and drops Prisma's own parameters", () => {
    const url = new URL(
      listenConnectionString(
        'postgresql://siyahtus_app:secret@db:5432/siyahtus?schema=public&connection_limit=9&pool_timeout=20&sslmode=require',
      )!,
    );
    expect(url.username).toBe('siyahtus_app');
    expect(url.password).toBe('secret');
    expect(url.host).toBe('db:5432');
    expect(url.pathname).toBe('/siyahtus');
    expect([...url.searchParams.keys()].sort()).toEqual(['application_name', 'sslmode']);
    expect(url.searchParams.get('sslmode')).toBe('require');
    expect(url.searchParams.get('application_name')).toBe(AI_JOBS_LISTENER_APPLICATION_NAME);
  });

  it('keeps an application name the URL already gives', () => {
    const url = new URL(listenConnectionString('postgresql://u:p@h/d?application_name=mine')!);
    expect(url.searchParams.get('application_name')).toBe('mine');
  });

  it('gives no doorbell behind PgBouncer in transaction mode, where LISTEN is never delivered', () => {
    expect(listenConnectionString('postgresql://u:p@bouncer:6432/d?pgbouncer=true')).toBeNull();
  });
});

describe('pgWakeups', () => {
  it('a doorbell that cannot connect warns once, keeps trying, and stops cleanly', async () => {
    const warnings: string[] = [];
    let woken = 0;
    const bell = pgWakeups({
      connectionString: 'postgresql://u:p@127.0.0.1:1/d',
      logger: { info: () => undefined, warn: (_o, message) => warnings.push(message) },
      reconnectMs: 10,
      maxReconnectMs: 20,
      connectTimeoutMs: 1_000,
    });
    bell.start(() => {
      woken += 1;
    });
    const deadline = Date.now() + 5_000;
    while (warnings.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // Several reconnects later, still one line for the outage.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await bell.stop();
    expect(warnings).toHaveLength(1);
    expect(woken).toBe(0);
  });
});

describe('aiJobLeaseMs', () => {
  it('outlasts the slowest AI answer and never drops below the default', () => {
    expect(aiJobLeaseMs({ EMBEDDING_TIMEOUT_MS: 10_000, LLM_TIMEOUT_MS: 20_000 })).toBe(
      AI_JOB_LEASE_MS,
    );
    expect(aiJobLeaseMs({ EMBEDDING_TIMEOUT_MS: 30_000, LLM_TIMEOUT_MS: 60_000 })).toBe(120_000);
    expect(aiJobLeaseMs({ EMBEDDING_TIMEOUT_MS: 120_000, LLM_TIMEOUT_MS: 120_000 })).toBe(270_000);
    expect(aiJobLeaseMs({ EMBEDDING_TIMEOUT_MS: 120_000, LLM_TIMEOUT_MS: 120_000 })).toBeLessThan(
      AI_JOB_MAX_LEASE_MS,
    );
  });
});
