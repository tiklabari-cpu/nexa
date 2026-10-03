/**
 * `MeteredEmbeddings` against a recording budget (tm 257.20) — the estimate,
 * the order of reserve, call and settle, who pays (a workspace, a hold, the
 * deployment), and what each kind of failure is counted as. The Postgres side
 * — the rows, the caps, the routes — is in
 * `test/integration/ai-daily-caps-embedding.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { TenantContext } from '../../lib/tenant.js';
import { AiDailyCapError, type AiDailyBudget, type AiReservation } from './ai-daily-budget.js';
import {
  embeddingBilledOnFailure,
  embeddingEstimate,
  EmbeddingHold,
  MeteredEmbeddings,
} from './metered-embeddings.js';
import { EmbeddingProviderError, EMBEDDING_FAILURE_KINDS } from './provider/embedding-error.js';
import type {
  EmbeddingProvider,
  EmbeddingProviderId,
  Embeddings,
} from './provider/embedding-provider.js';

const TENANT: TenantContext = {
  licenseId: 42n,
  organizationId: '00000000-0000-4000-8000-000000000042',
};

class RecordingBudget {
  readonly events: string[] = [];
  refuse: AiDailyCapError | null = null;

  async reserve(
    tenant: TenantContext,
    meter: 'embedding',
    estimate: number,
  ): Promise<AiReservation> {
    this.events.push(`reserve ${tenant.licenseId} ${meter} ${estimate}`);
    if (this.refuse) throw this.refuse;
    return { tenant, meter, day: '20261003', estimate };
  }

  async reserveDeployment(meter: 'embedding', estimate: number): Promise<AiReservation> {
    this.events.push(`reserveDeployment ${meter} ${estimate}`);
    if (this.refuse) throw this.refuse;
    return { tenant: null, meter, day: '20261003', estimate };
  }

  async settle(reservation: AiReservation, used: number): Promise<void> {
    const who = reservation.tenant ? String(reservation.tenant.licenseId) : 'deployment';
    this.events.push(`settle ${who} ${reservation.estimate} ${used}`);
  }
}

/** Answers with `tokens(texts)` as its usage, or throws `fail`. */
function provider(
  events: string[],
  options: {
    id?: EmbeddingProviderId;
    fail?: Error;
    tokens?: (texts: readonly string[]) => number;
  } = {},
): EmbeddingProvider {
  return {
    id: options.id ?? 'openai',
    space: 'openai:test',
    async embed(texts): Promise<Embeddings> {
      events.push(`provider ${texts.length}`);
      if (options.fail) throw options.fail;
      return {
        vectors: texts.map(() => [0]),
        usage: { inputTokens: options.tokens ? options.tokens(texts) : texts.length * 3 },
      };
    },
  };
}

function metered(options: Parameters<typeof provider>[1] = {}) {
  const budget = new RecordingBudget();
  const embeddings = new MeteredEmbeddings(
    provider(budget.events, options),
    budget as unknown as AiDailyBudget,
  );
  return { budget, embeddings };
}

describe('embeddingEstimate', () => {
  it('counts UTF-8 bytes, the adapter’s own upper bound on tokens', () => {
    expect(embeddingEstimate([])).toBe(0);
    expect(embeddingEstimate(['abc', 'de'])).toBe(5);
    // Two bytes each for ş and ı, four for the emoji: characters would undercount.
    expect(embeddingEstimate(['şı'])).toBe(4);
    expect(embeddingEstimate(['ok 👍'])).toBe(7);
  });
});

describe('embeddingBilledOnFailure', () => {
  it('keeps the estimate when billing is unknown, and what was billed otherwise', () => {
    const counted = Object.fromEntries(
      EMBEDDING_FAILURE_KINDS.map((kind) => [
        kind,
        embeddingBilledOnFailure(new EmbeddingProviderError(kind), 500),
      ]),
    );
    expect(counted).toEqual({
      timeout: 500,
      network: 500,
      bad_response: 500,
      rate_limited: 0,
      unavailable: 0,
      quota_exhausted: 0,
      auth: 0,
      forbidden: 0,
      not_found: 0,
      bad_request: 0,
      circuit_open: 0,
    });
    // Earlier batches of the same call answered and were billed.
    expect(
      embeddingBilledOnFailure(
        new EmbeddingProviderError('bad_request', { usage: { inputTokens: 120 } }),
        500,
      ),
    ).toBe(120);
    // A defect is counted, not forgiven.
    expect(embeddingBilledOnFailure(new TypeError('boom'), 500)).toBe(500);
  });
});

describe('MeteredEmbeddings — a workspace pays per call', () => {
  it('reserves the estimate, asks the provider, and settles what it billed', async () => {
    const { budget, embeddings } = metered();
    const result = await embeddings.embed(['abcd', 'ef'], TENANT);

    expect(result.usage).toEqual({ inputTokens: 6 });
    expect(budget.events).toEqual(['reserve 42 embedding 6', 'provider 2', 'settle 42 6 6']);
  });

  it('asks nothing when the cap refuses, and lets the refusal through as it is', async () => {
    const { budget, embeddings } = metered();
    budget.refuse = new AiDailyCapError('embedding', 'workspace', 60);

    await expect(embeddings.embed(['abcd'], TENANT)).rejects.toBe(budget.refuse);
    expect(budget.events).toEqual(['reserve 42 embedding 4']);
  });

  it('settles a failed call with what it may have cost, and rethrows the failure', async () => {
    const timeout = metered({ fail: new EmbeddingProviderError('timeout') });
    await expect(timeout.embeddings.embed(['abcd'], TENANT)).rejects.toMatchObject({
      kind: 'timeout',
    });
    expect(timeout.budget.events).toEqual([
      'reserve 42 embedding 4',
      'provider 1',
      'settle 42 4 4',
    ]);

    const refused = metered({ fail: new EmbeddingProviderError('auth') });
    await expect(refused.embeddings.embed(['abcd'], TENANT)).rejects.toMatchObject({
      kind: 'auth',
    });
    expect(refused.budget.events.at(-1)).toBe('settle 42 4 0');
  });

  it('refuses a counted call that names no payer, before anything is reserved or asked', async () => {
    const { budget, embeddings } = metered();
    await expect(embeddings.embed(['abcd'])).rejects.toThrow(/needs the workspace/);
    expect(budget.events).toEqual([]);
  });

  it('counts nothing for the stub, for an unmetered instance, or for no texts', async () => {
    const stub = metered({ id: 'mock' });
    await stub.embeddings.embed(['abcd']);
    expect(stub.budget.events).toEqual(['provider 1']);
    expect(stub.embeddings.metered).toBe(false);

    const events: string[] = [];
    const bare = MeteredEmbeddings.wrap(provider(events));
    await bare.embed(['abcd']);
    expect(events).toEqual(['provider 1']);
    expect(bare.metered).toBe(false);
    expect(MeteredEmbeddings.wrap(bare)).toBe(bare);

    const empty = metered();
    await empty.embeddings.embed([], TENANT);
    expect(empty.budget.events).toEqual(['provider 0']);
  });
});

describe('MeteredEmbeddings — a hold pays for many calls (the bulk import)', () => {
  it('reserves once, draws each call from it, and settles the total once', async () => {
    const { budget, embeddings } = metered({ tokens: (texts) => texts.join('').length - 1 });
    const hold = await embeddings.hold(TENANT, 10);
    await embeddings.embed(['abcd'], hold);
    await embeddings.embed(['efgh'], hold);
    expect(hold).toMatchObject({ reserved: 10, used: 6 });
    await hold.settle();
    await hold.settle();

    expect(budget.events).toEqual([
      'reserve 42 embedding 10',
      'provider 1',
      'provider 1',
      'settle 42 10 6',
    ]);
  });

  it('reserves the shortfall when a call does not fit what is held, and refuses it when the day cannot', async () => {
    const { budget, embeddings } = metered({ tokens: (texts) => texts.join('').length });
    const hold = await embeddings.hold(TENANT, 4);
    await embeddings.embed(['abcd'], hold);
    // Nothing left: the next call reserves its own six.
    await embeddings.embed(['abcdef'], hold);
    budget.refuse = new AiDailyCapError('embedding', 'workspace', 60);
    await expect(embeddings.embed(['xy'], hold)).rejects.toBe(budget.refuse);
    expect(hold).toMatchObject({ reserved: 10, used: 10 });
    await hold.settle();

    expect(budget.events).toEqual([
      'reserve 42 embedding 4',
      'provider 1',
      'reserve 42 embedding 6',
      'provider 1',
      'reserve 42 embedding 2',
      // The cost on the first reservation, every other one handed back whole.
      'settle 42 4 10',
      'settle 42 6 0',
    ]);
  });

  it('reserves nothing for an empty estimate, or when nothing is counted', async () => {
    const { budget, embeddings } = metered();
    const hold = await embeddings.hold(TENANT, 0);
    expect(hold).toBeInstanceOf(EmbeddingHold);
    await hold.settle();
    expect(budget.events).toEqual([]);

    const stub = metered({ id: 'mock' });
    const free = await stub.embeddings.hold(TENANT, 1_000);
    await stub.embeddings.embed(['abcd'], free);
    await free.settle();
    expect(stub.budget.events).toEqual(['provider 1']);
  });

  it('is refused whole when the day cannot take the estimate', async () => {
    const { budget, embeddings } = metered();
    budget.refuse = new AiDailyCapError('embedding', 'global', 60);
    await expect(embeddings.hold(TENANT, 10)).rejects.toBe(budget.refuse);
  });

  it('cannot be drawn on once settled', async () => {
    const { embeddings } = metered();
    const hold = await embeddings.hold(TENANT, 10);
    await hold.settle();
    await expect(embeddings.embed(['abcd'], hold)).rejects.toThrow(/already been settled/);
  });
});

describe('MeteredEmbeddings — the operator pays on the deployment’s row (knowledge:reembed)', () => {
  it('reserves and settles on the deployment alone, never on a workspace', async () => {
    const { budget, embeddings } = metered();
    await embeddings.embedForDeployment(['abcd']);
    expect(budget.events).toEqual([
      'reserveDeployment embedding 4',
      'provider 1',
      'settle deployment 4 3',
    ]);
  });

  it('asks nothing when the deployment’s cap refuses', async () => {
    const { budget, embeddings } = metered();
    budget.refuse = new AiDailyCapError('embedding', 'global', 60);
    await expect(embeddings.embedForDeployment(['abcd'])).rejects.toBe(budget.refuse);
    expect(budget.events).toEqual(['reserveDeployment embedding 4']);
  });
});
