/**
 * The simulation context (tm 314.2 · SiyahTuş analysis AI-19 §6): the flag
 * follows the async chain and nothing else, and every guarded write path
 * refuses inside it before it touches anything — the database (a writable
 * tenant transaction), the live AI meter, RTM, webhooks and mail — while the
 * reads and the test meter's counters go through.
 *
 * Fakes on purpose: what is pinned here is that the refusal comes *before* the
 * path's first side effect (no transaction opened, no publish, no send). That a
 * real run writes nothing to the real tables is the integration suite's
 * (`ai-testing-isolation.test.ts`).
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { AiDailyBudget } from '../services/ai/ai-daily-budget.js';
import { CappedMailer } from '../services/mail/mail-caps.js';
import type { Mailer } from '../services/mail/mailer.js';
import { RealtimePublisher } from '../services/realtime/publisher.js';
import { WebhookDispatcher } from '../services/webhooks/webhook-dispatcher.js';
import {
  SIMULATION_GUARDED_PATHS,
  SimulationWriteRefusedError,
  refuseInSimulation,
  runInSimulation,
  simulationScope,
  type SimulationScope,
} from './simulation-context.js';
import { withTenant, type TenantClient, type TenantContext } from './tenant.js';

const TENANT: TenantContext = {
  licenseId: 7n,
  organizationId: '7a1f8b2c-4d5e-4f60-8a1b-2c3d4e5f6a7b',
};
const SCOPE: SimulationScope = { kind: 'test_run', licenseId: 7n };

/** A Prisma client that records transactions and answers every raw statement. */
function fakeDb() {
  const tx = {
    $executeRawUnsafe: vi.fn(async () => 0),
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async () => [{ scope: null, refused: null }]),
    webhook: { findMany: vi.fn(async () => []) },
  };
  const db = {
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    $queryRaw: vi.fn(async () => [{ scope: null }]),
    $executeRaw: vi.fn(async () => 0),
  };
  return { db, tx, client: db as unknown as PrismaClient };
}

/** What the promise rejected with — the refusal, by its path. */
async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof SimulationWriteRefusedError) return error.path;
    throw error;
  }
  return 'nothing refused';
}

const quietLog = { error: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger;

describe('the simulation context (tm 314.2 · AI-19 §6)', () => {
  it('is set for what the function awaits, across timers and promises, and nowhere else', async () => {
    expect(simulationScope()).toBeNull();
    const seen = await runInSimulation(SCOPE, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return Promise.resolve().then(() => simulationScope());
    });
    expect(seen).toEqual(SCOPE);
    expect(simulationScope()).toBeNull();
  });

  it('does not reach a request running beside it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inside = runInSimulation(SCOPE, async () => {
      await gate;
      return simulationScope();
    });
    const beside = (async () => {
      await Promise.resolve();
      const scope = simulationScope();
      release();
      return scope;
    })();
    expect(await beside).toBeNull();
    expect(await inside).toEqual(SCOPE);
  });

  it('keeps the innermost scope', async () => {
    const sandbox: SimulationScope = { kind: 'sandbox', licenseId: 7n };
    const seen = await runInSimulation(SCOPE, () =>
      runInSimulation(sandbox, async () => simulationScope()),
    );
    expect(seen).toEqual(sandbox);
  });

  it('refuses every guarded path inside, by name, and none outside', async () => {
    for (const path of SIMULATION_GUARDED_PATHS)
      expect(() => refuseInSimulation(path)).not.toThrow();
    for (const path of SIMULATION_GUARDED_PATHS) {
      expect(
        await refusal(runInSimulation(SCOPE, async () => refuseInSimulation(path))),
        path,
      ).toBe(path);
    }
  });
});

describe('each guarded path refuses before its first side effect', () => {
  it('database — a writable tenant transaction is never opened; a read-only one and the test meter’s are', async () => {
    const { db, client } = fakeDb();
    const fn = async (_tx: TenantClient) => 'done';
    expect(await refusal(runInSimulation(SCOPE, () => withTenant(client, TENANT, fn)))).toBe(
      'database',
    );
    expect(db.$transaction).not.toHaveBeenCalled();

    await expect(
      runInSimulation(SCOPE, () => withTenant(client, TENANT, fn, { readOnly: true })),
    ).resolves.toBe('done');
    await expect(
      runInSimulation(SCOPE, () =>
        withTenant(client, TENANT, fn, { simulationWrite: 'test_meter' }),
      ),
    ).resolves.toBe('done');
    expect(db.$transaction).toHaveBeenCalledTimes(2);

    // Outside a simulation nothing changed.
    await expect(withTenant(client, TENANT, fn)).resolves.toBe('done');
  });

  it('live_meter — a live reservation is refused before the caps are read; the test meter is counted', async () => {
    const { db, client } = fakeDb();
    const capInputs = vi.fn(async () => ({
      override: { llm: null, embedding: null },
      plan: { llm: null, embedding: null },
    }));
    const budget = new AiDailyBudget(
      client,
      {
        llm: { workspace: 100_000, global: 1_000_000 },
        embedding: { workspace: 100_000, global: 1_000_000 },
      },
      { logger: quietLog, capInputs },
    );
    for (const surface of ['ai_agent', 'copilot', 'knowledge_index'] as const) {
      expect(
        await refusal(
          runInSimulation(SCOPE, () => budget.reserve(TENANT, 'llm', 100, { surface })),
        ),
        surface,
      ).toBe('live_meter');
    }
    expect(capInputs).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();

    const reservation = await runInSimulation(SCOPE, () =>
      budget.reserve(TENANT, 'llm', 100, { surface: 'simulation' }),
    );
    expect(reservation.meter).toBe('llm_test');
    await runInSimulation(SCOPE, () =>
      budget.settle(reservation, { inputTokens: 40, outputTokens: 10 }),
    );
    // The reservation and the settle, both on the test meter's counters.
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    const embedding = await runInSimulation(SCOPE, () =>
      budget.reserve(TENANT, 'embedding', 10, { surface: 'simulation' }),
    );
    expect(embedding.meter).toBe('embedding_test');
  });

  it('realtime — nothing is published to the RTM bus', async () => {
    const redis = { publish: vi.fn(async () => 1) };
    const publisher = new RealtimePublisher(redis as unknown as Redis, quietLog);
    const push = () =>
      publisher.publish(TENANT, 'incoming_chat', { allAgents: true }, { chat_id: 'c1' });
    expect(await refusal(runInSimulation(SCOPE, push))).toBe('realtime');
    expect(redis.publish).not.toHaveBeenCalled();
    await push();
    expect(redis.publish).toHaveBeenCalledTimes(1);
  });

  it('webhook — no subscription is read and no attempt is sent', async () => {
    const sender = vi.fn(async () => ({ ok: true as const, status: 200 }));
    const dispatcher = new WebhookDispatcher({
      sender,
      resolver: async () => ['93.184.216.34'],
    });
    const { tx } = fakeDb();
    expect(
      await refusal(
        runInSimulation(SCOPE, () =>
          dispatcher.dispatch(tx as unknown as TenantClient, TENANT, {
            action: 'chat_started',
            payload: {},
          }),
        ),
      ),
    ).toBe('webhook');
    expect(tx.webhook.findMany).not.toHaveBeenCalled();
    const webhook = {
      id: 'wh_1',
      url: 'https://hooks.example.test/x',
      action: 'chat_started',
      secretKey: 'whsec_1',
    };
    expect(await refusal(runInSimulation(SCOPE, () => dispatcher.attempt(webhook, '{}')))).toBe(
      'webhook',
    );
    expect(sender).not.toHaveBeenCalled();
  });

  it('mail — nothing is counted and nothing handed to the carrier', async () => {
    const { db, client } = fakeDb();
    const carrier: Mailer = { send: vi.fn(async () => undefined) };
    const mailer = new CappedMailer(
      carrier,
      client,
      { workspace: 100, external: 100, global: 1_000, reserve: 10, recipient: 10 },
      { logger: { warn: vi.fn(), error: vi.fn() } },
    );
    const send = () =>
      mailer.send({
        to: 'owner@example.test',
        subject: 'x',
        body: 'x',
        licenseId: 7n,
        kind: 'notification',
      });
    expect(await refusal(runInSimulation(SCOPE, send))).toBe('mail');
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(carrier.send).not.toHaveBeenCalled();
  });
});
