/**
 * `MeteredLlm` against a recording budget (tm 257.8) — the order of reserve,
 * call and settle, the estimate, and what each kind of failure is counted as;
 * and since tm 283.2 who the call was for, the tier it asked for and its cost
 * split into input and output, for the usage ledger. The Postgres side
 * (atomicity, the two rows, the caps, the ledger row) is in
 * `test/integration/ai-daily-caps.test.ts` and `ai-tenant-caps.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { TenantContext } from '../../lib/tenant.js';
import {
  AiDailyCapError,
  type AiAttribution,
  type AiDailyBudget,
  type AiReservation,
  type AiTokenUsage,
} from './ai-daily-budget.js';
import { billedOnFailure, llmEstimate, llmEstimateUsage, MeteredLlm } from './metered-llm.js';
import { LlmProviderError } from './provider/llm-error.js';
import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmProvider,
  LlmProviderId,
} from './provider/llm-provider.js';

const TENANT: TenantContext = {
  licenseId: 41n,
  organizationId: '00000000-0000-4000-8000-000000000041',
};

const REQUEST: LlmCompletionRequest = {
  system: 'You answer from the passages.', // 29
  messages: [
    { role: 'user', content: 'Where is my parcel?' }, // 19
    { role: 'assistant', content: 'On its way.' }, // 11
  ],
  maxOutputTokens: 400,
  timeoutMs: 20_000,
};
const ESTIMATE = 29 + 19 + 11 + 400;
const AGENT: AiAttribution = { surface: 'ai_agent', chatId: 'CHAT0000001' };

class RecordingBudget {
  readonly events: string[] = [];
  readonly settled: Array<{ reservation: AiReservation; used: number; usage: AiTokenUsage }> = [];
  readonly reserved: Array<{ attribution: AiAttribution; modelTier: string | null }> = [];
  refuse: AiDailyCapError | null = null;

  async reserve(
    tenant: TenantContext,
    meter: 'llm',
    estimate: number,
    attribution: AiAttribution,
    modelTier: 'default' | 'fast' | null = null,
  ): Promise<AiReservation> {
    this.events.push(`reserve ${meter} ${estimate}`);
    this.reserved.push({ attribution, modelTier });
    if (this.refuse) throw this.refuse;
    return {
      tenant,
      meter,
      day: '20261002',
      estimate,
      cap: 1_000_000,
      ledger: {
        surface: attribution.surface,
        modelTier,
        chatId: attribution.chatId ?? null,
        configVersionId: null,
      },
    };
  }

  async settle(reservation: AiReservation, usage: AiTokenUsage): Promise<void> {
    const used = usage.inputTokens + usage.outputTokens;
    this.events.push(`settle ${reservation.estimate} ${used}`);
    this.settled.push({ reservation, used, usage });
  }

  async check(): Promise<void> {
    this.events.push('check');
  }
}

function provider(
  id: LlmProviderId,
  answer: (request: LlmCompletionRequest) => Promise<LlmCompletion>,
  events: string[],
): LlmProvider {
  return {
    id,
    async complete(request) {
      events.push('provider');
      return answer(request);
    },
  };
}

const answered = async (): Promise<LlmCompletion> => ({
  text: 'ok',
  usage: { inputTokens: 30, outputTokens: 7 },
});

function metered(
  answer: (request: LlmCompletionRequest) => Promise<LlmCompletion>,
  id: LlmProviderId = 'openai',
) {
  const budget = new RecordingBudget();
  const llm = new MeteredLlm(
    provider(id, answer, budget.events),
    budget as unknown as AiDailyBudget,
  );
  return { budget, llm };
}

describe('llmEstimate', () => {
  it('is the prompt’s characters plus the reply’s token ceiling', () => {
    expect(llmEstimate(REQUEST)).toBe(ESTIMATE);
  });

  it('splits as the ledger stores a cost: the prompt as input, the ceiling as output', () => {
    expect(llmEstimateUsage(REQUEST)).toEqual({ inputTokens: 59, outputTokens: 400 });
  });
});

describe('MeteredLlm', () => {
  it('reserves the estimate before the provider is asked and settles with what it reported', async () => {
    const { budget, llm } = metered(answered);
    const completion = await llm.complete(TENANT, REQUEST, AGENT);
    expect(completion.text).toBe('ok');
    expect(budget.events).toEqual([`reserve llm ${ESTIMATE}`, 'provider', `settle ${ESTIMATE} 37`]);
    expect(budget.settled[0]!.reservation.tenant).toBe(TENANT);
    // The ledger's split is the provider's own, not the sum.
    expect(budget.settled[0]!.usage).toEqual({ inputTokens: 30, outputTokens: 7 });
  });

  it('reserves with the caller’s attribution and the tier the request asked for (tm 283.2)', async () => {
    const { budget, llm } = metered(answered);
    await llm.complete(TENANT, REQUEST, AGENT);
    await llm.complete(TENANT, { ...REQUEST, tier: 'fast' }, { surface: 'qa' });
    expect(budget.reserved).toEqual([
      { attribution: AGENT, modelTier: 'default' },
      { attribution: { surface: 'qa' }, modelTier: 'fast' },
    ]);
  });

  it('does not reach the provider, and settles nothing, when the cap refuses', async () => {
    const { budget, llm } = metered(answered);
    budget.refuse = new AiDailyCapError('llm', 'workspace', 60);
    await expect(llm.complete(TENANT, REQUEST, AGENT)).rejects.toBe(budget.refuse);
    expect(budget.events).toEqual([`reserve llm ${ESTIMATE}`]);
  });

  it('counts a failure the provider billed by its usage, and rethrows it', async () => {
    const failure = new LlmProviderError('no_answer', {
      reason: 'length',
      usage: { inputTokens: 120, outputTokens: 400 },
    });
    const { budget, llm } = metered(async () => {
      throw failure;
    });
    await expect(llm.complete(TENANT, REQUEST, AGENT)).rejects.toBe(failure);
    expect(budget.settled.map((s) => s.used)).toEqual([520]);
    expect(budget.settled[0]!.usage).toEqual({ inputTokens: 120, outputTokens: 400 });
  });

  it('keeps the estimate for a failure that may have been billed, and nothing for one that was not', async () => {
    for (const [kind, used] of [
      ['timeout', ESTIMATE],
      ['network', ESTIMATE],
      ['bad_response', ESTIMATE],
      ['rate_limited', 0],
      ['unavailable', 0],
      ['quota_exhausted', 0],
      ['auth', 0],
      ['bad_request', 0],
      ['circuit_open', 0],
      ['prompt_too_long', 0],
    ] as const) {
      const { budget, llm } = metered(async () => {
        throw new LlmProviderError(kind);
      });
      await expect(llm.complete(TENANT, REQUEST, AGENT)).rejects.toBeInstanceOf(LlmProviderError);
      expect(
        budget.settled.map((s) => s.used),
        kind,
      ).toEqual([used]);
      // An estimate kept is split as it was reserved; nothing is nothing.
      expect(budget.settled[0]!.usage, kind).toEqual(
        used === 0 ? { inputTokens: 0, outputTokens: 0 } : llmEstimateUsage(REQUEST),
      );
    }
  });

  it('keeps the estimate for a defect, which says nothing about billing', async () => {
    const { budget, llm } = metered(async () => {
      throw new TypeError('boom');
    });
    await expect(llm.complete(TENANT, REQUEST, AGENT)).rejects.toBeInstanceOf(TypeError);
    expect(budget.settled.map((s) => s.used)).toEqual([ESTIMATE]);
  });

  it('counts nothing for the mock provider — no reservation, no settle', async () => {
    const { budget, llm } = metered(answered, 'mock');
    expect(llm.metered).toBe(false);
    await llm.complete(TENANT, REQUEST, AGENT);
    expect(budget.events).toEqual(['provider']);
  });

  it('counts nothing without a budget, and wraps a bare provider that way', async () => {
    const events: string[] = [];
    const bare = provider('openai', answered, events);
    const wrapped = MeteredLlm.wrap(bare);
    expect(wrapped.metered).toBe(false);
    expect(wrapped.id).toBe('openai');
    await wrapped.complete(TENANT, REQUEST, AGENT);
    expect(events).toEqual(['provider']);
    const already = new MeteredLlm(bare, null);
    expect(MeteredLlm.wrap(already)).toBe(already);
  });

  it('binds a workspace and a feature for writers that take a plain provider', async () => {
    const { budget, llm } = metered(answered);
    const bound = llm.forTenant(TENANT, { surface: 'copilot', chatId: 'CHAT0000002' });
    expect(bound.id).toBe('openai');
    await bound.complete(REQUEST);
    expect(budget.settled[0]!.reservation.tenant).toBe(TENANT);
    expect(budget.settled[0]!.reservation.ledger).toEqual({
      surface: 'copilot',
      modelTier: 'default',
      chatId: 'CHAT0000002',
      configVersionId: null,
    });
  });
});

describe('billedOnFailure', () => {
  it('prefers the usage the error carries over any rule', () => {
    const timedOutWithUsage = new LlmProviderError('timeout', {
      usage: { inputTokens: 3, outputTokens: 4 },
    });
    expect(billedOnFailure(timedOutWithUsage, { inputTokens: 900, outputTokens: 99 })).toEqual({
      inputTokens: 3,
      outputTokens: 4,
    });
  });
});
