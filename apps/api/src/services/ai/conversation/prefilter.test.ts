/**
 * The catalogue narrowing (tm 297.3 · SiyahTuş analysis AI-05 §2): which
 * entries `narrowCatalogue` keeps, and what the engine does with it — one
 * embedding, the call offered the nearest 10, the locked and the active ones
 * always, everything when the narrowing cannot run, and the knowledge search
 * of the same turn reusing the embedding.
 *
 * The nearness is a stub here (`ProcedureExamples.rank` is the database's —
 * `procedure-examples.test.ts`); the understanding is the mock's reading, so
 * the catalogue the call was offered is read back from its prompt.
 */
import { describe, expect, it } from 'vitest';
import {
  readPersona,
  splitSkillProcedure,
  validateProcedure,
  type Procedure,
} from '@siyahtus/types';
import { FakeLlmProvider } from '../../../../test/helpers/fake-llm-provider.js';
import { depositProcedure } from '../../../../test/helpers/procedure-fixtures.js';
import type { TenantClient, TenantContext } from '../../../lib/tenant.js';
import { AiDailyCapError } from '../ai-daily-budget.js';
import { skillDecision } from '../decision-log.js';
import {
  RETRIEVAL_THRESHOLD,
  type KnowledgeSearch,
  type KnowledgeService,
  type QueryEmbedding,
} from '../knowledge-service.js';
import type { ExampleRanking, ProcedureExamples, RankedSkill } from '../procedure-examples.js';
import { EmbeddingProviderError } from '../provider/embedding-error.js';
import { ConversationEngine } from './conversation-engine.js';
import { narrowCatalogue, PREFILTER_ABOVE, PREFILTER_KEEP, prefilterDetail } from './prefilter.js';
import type { CatalogueEntry } from './procedure/understanding.js';
import { readUnderstandGrounding } from './understand.js';
import {
  emptyTurnState,
  type TenantRunner,
  type TurnContext,
  type TurnSkill,
  type TurnState,
} from './turn.js';

const TENANT: TenantContext = { licenseId: 1n, organizationId: 'org-test' };
const NOW = new Date('2026-10-18T10:50:00Z');
const PERSONA = readPersona({ tone: null, languages: [], persona: null });

/** A skill id: the narrowing ranks only those. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function entry(n: number, extra: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return {
    key: id(n),
    name: `Konu ${String(n).padStart(2, '0')}`,
    examples: [`örnek ${n}`],
    priority: 100,
    locked: false,
    ...extra,
  };
}

/** Nearest first, in the order given. */
const ranking = (...ns: number[]): RankedSkill[] =>
  ns.map((n, index) => ({ skillId: id(n), similarity: 0.9 - index * 0.01 }));

const numbers = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

describe('narrowCatalogue (AI-05 §2)', () => {
  const twenty = numbers(1, 20).map((n) => entry(n));

  it('leaves 15 procedures or fewer alone, and says nothing', () => {
    const fifteen = twenty.slice(0, PREFILTER_ABOVE);
    const narrowed = narrowCatalogue({
      catalogue: fifteen,
      ranked: ranking(1),
      activeKey: null,
      strategy: 'exact',
    });
    expect(narrowed.catalogue).toEqual(fifteen);
    expect(narrowed.record).toBeUndefined();
  });

  it('past 15, keeps the 10 nearest — in the catalogue’s order, not the ranking’s', () => {
    const narrowed = narrowCatalogue({
      catalogue: twenty,
      ranked: ranking(...numbers(11, 20).reverse(), ...numbers(1, 10)),
      activeKey: null,
      strategy: 'exact',
    });
    expect(narrowed.catalogue.map((item) => item.key)).toEqual(numbers(11, 20).map(id));
    expect(narrowed.record).toEqual({
      procedures: 20,
      offered: 10,
      unranked: 0,
      strategy: 'exact',
    });
    expect(PREFILTER_KEEP).toBe(10);
  });

  it('keeps the locked ones and the active one however far they lie', () => {
    const catalogue = twenty.map((item, index) =>
      index === 19 ? { ...item, locked: true } : item,
    );
    const narrowed = narrowCatalogue({
      catalogue,
      ranked: ranking(...numbers(1, 20)),
      activeKey: id(15),
      strategy: 'approximate',
    });
    expect(narrowed.catalogue.map((item) => item.key)).toEqual([...numbers(1, 10), 15, 20].map(id));
    expect(narrowed.record).toMatchObject({ offered: 12, strategy: 'approximate' });
  });

  it('keeps every procedure the ranking does not know — no examples in this space is no reason to drop it', () => {
    const narrowed = narrowCatalogue({
      catalogue: twenty,
      ranked: ranking(...numbers(1, 12)),
      activeKey: null,
      strategy: 'exact',
    });
    expect(narrowed.catalogue.map((item) => item.key)).toEqual(
      [...numbers(1, 10), ...numbers(13, 20)].map(id),
    );
    expect(narrowed.record).toEqual({
      procedures: 20,
      offered: 18,
      unranked: 8,
      strategy: 'exact',
    });
    // A ranking that knows nothing keeps everything.
    expect(
      narrowCatalogue({ catalogue: twenty, ranked: [], activeKey: null, strategy: 'exact' })
        .catalogue,
    ).toEqual(twenty);
  });

  it('ignores a ranked id that is not in the catalogue (unpublished since, another agent’s)', () => {
    const narrowed = narrowCatalogue({
      catalogue: twenty,
      ranked: [{ skillId: id(99), similarity: 1 }, ...ranking(...numbers(1, 20))],
      activeKey: null,
      strategy: 'exact',
    });
    expect(narrowed.catalogue.map((item) => item.key)).toEqual(numbers(1, 10).map(id));
  });

  it('writes one log line of counts', () => {
    expect(
      prefilterDetail({ procedures: 20, offered: 13, unranked: 2, strategy: 'approximate' }),
    ).toBe(
      'narrowed 20 procedures to 13 · the 10 nearest by example, locked and active kept · 2 without examples in this space kept · approximate',
    );
  });
});

// ---------------------------------------------------------------------------
// Through the engine.
// ---------------------------------------------------------------------------

const untouchable = new Proxy(
  {},
  {
    get: (_, table) => {
      throw new Error(`a turn touched the database (${String(table)})`);
    },
  },
) as TenantClient;
const db: TenantRunner = (fn) => fn(untouchable);

function build(raw: Record<string, unknown>): Procedure {
  const result = validateProcedure(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

function procedureSkill(
  skillId: string,
  name: string,
  procedure: Procedure,
  extra: Partial<TurnSkill> = {},
): TurnSkill {
  const { procedure: body, ...own } = splitSkillProcedure(procedure);
  return {
    id: skillId,
    name,
    aiAgentId: 'agent-1',
    steps: [],
    persona: PERSONA,
    mode: 'procedure',
    definition: { ...own, procedure: body },
    locked: false,
    ...extra,
  };
}

/** A one-turn topic whose examples only it shares. */
function topic(n: number): TurnSkill {
  return procedureSkill(
    id(n),
    `Konu ${n}`,
    build({
      when_to_use: `Konu ${n}.`,
      examples: [`zarzavat${n} sorusu`],
      steps: [
        { id: 'bilgi', type: 'say', template_key: 'bilgi' },
        { id: 'bitti', type: 'resolve', outcome: 'resolved' },
      ],
      templates: [{ key: 'bilgi', text: `Konu ${n} hakkında bilgi.` }],
    }),
  );
}

/** Topic 1 is the deposit procedure — it asks and waits; topic 20 is locked. */
const DEPOSIT = procedureSkill(id(1), 'Yatırım geçmedi', depositProcedure());
const LOCKED = { ...topic(20), locked: true };

function skills(count: number): TurnSkill[] {
  return [DEPOSIT, ...numbers(2, count - 1).map(topic), LOCKED];
}

class Harness {
  readonly embedded: string[] = [];
  readonly ranked: Array<{ query: QueryEmbedding; skillIds: readonly string[] }> = [];
  readonly searched: QueryEmbedding[] = [];
  readonly llm = new FakeLlmProvider();
  /** What `rank` answers; nearest first. */
  order: RankedSkill[] = [];
  embedFailure: Error | null = null;

  readonly engine = new ConversationEngine({
    llm: this.llm,
    maxOutputTokens: 400,
    timeoutMs: 20_000,
    maxPromptChars: 32_000,
    knowledge: {
      threshold: RETRIEVAL_THRESHOLD,
      embedQuery: async (text: string) => {
        this.embedded.push(text);
        if (this.embedFailure) throw this.embedFailure;
        return { space: 'test:space', vector: '[1]', usage: { inputTokens: 5 } };
      },
      search: async (_tx: unknown, _tenant: unknown, query: QueryEmbedding) => {
        this.searched.push(query);
        return {
          strategy: 'exact',
          chunksInScope: 1,
          chunks: [
            {
              id: 'chunk-1',
              sourceId: 'source-1',
              sourceName: 'Kargo',
              text: 'Kargolar iki günde teslim edilir.',
              score: 0.9,
            },
          ],
        } satisfies KnowledgeSearch;
      },
    } as unknown as KnowledgeService,
    procedureExamples: {
      rank: async (
        _tx: unknown,
        _tenant: unknown,
        query: QueryEmbedding,
        skillIds: readonly string[],
      ): Promise<ExampleRanking> => {
        this.ranked.push({ query, skillIds });
        return { strategy: 'exact', examplesInScope: skillIds.length, ranked: this.order };
      },
    } as unknown as ProcedureExamples,
  });

  context(all: TurnSkill[]): TurnContext {
    return {
      tenant: TENANT,
      db,
      now: NOW,
      mode: 'live',
      chatId: 'c',
      configVersionId: null,
      config: { skills: all },
      toolStubs: {},
      timeZone: 'Europe/Istanbul',
    };
  }

  /** The keys the understanding call was offered on its `n`th call. */
  offered(n = 0): string[] {
    const grounding = readUnderstandGrounding(this.llm.understandCalls[n]!.system);
    return grounding!.catalogue.map((item) => item.key);
  }
}

describe('the narrowing in a turn (AI-05 §2 · tm 297.3)', () => {
  it('at 15 procedures embeds nothing and offers all of them', async () => {
    const harness = new Harness();
    const result = await harness.engine.runTurn(
      emptyTurnState(),
      { text: 'zarzavat3 sorusu' },
      harness.context(skills(15)),
    );
    expect(harness.embedded).toEqual([]);
    expect(harness.ranked).toEqual([]);
    expect(harness.offered()).toHaveLength(15);
    expect(result.decisions.understood).not.toHaveProperty('prefilter');
    expect(result.decisions.usage.embeddingTokens).toBe(0);
  });

  it('past 15 embeds the message once and offers the 10 nearest and the locked one; the choice is among them', async () => {
    const harness = new Harness();
    harness.order = ranking(...numbers(10, 19), ...numbers(1, 9), 20);
    const result = await harness.engine.runTurn(
      emptyTurnState(),
      { text: 'zarzavat12 sorusu' },
      harness.context(skills(20)),
    );
    expect(harness.embedded).toEqual(['zarzavat12 sorusu']);
    expect(harness.ranked).toHaveLength(1);
    expect(harness.ranked[0]!.skillIds).toHaveLength(20);
    expect(harness.ranked[0]!.query).toMatchObject({ space: 'test:space', vector: '[1]' });
    // Locked first, then the catalogue's order.
    expect(harness.offered()).toEqual([id(20), ...numbers(10, 19).map(id)]);
    expect(result.decisions.skillId).toBe(id(12));
    expect(result.reply).toBe('Konu 12 hakkında bilgi.\nSorununuz çözüldü mü?');
    expect(result.decisions.usage.embeddingTokens).toBe(5);
    expect(result.decisions.understood?.prefilter).toEqual({
      procedures: 20,
      offered: 11,
      unranked: 0,
      strategy: 'exact',
    });
    expect(result.decisions.log[0]).toEqual({
      step: 'prefilter',
      detail: 'narrowed 20 procedures to 11 · the 10 nearest by example, locked and active kept',
      ok: true,
    });
    expect(skillDecision(result)?.details).toMatchObject({
      understood: { prefilter: { procedures: 20, offered: 11 } },
    });
  });

  it('a procedure narrowed away cannot be chosen, however well its examples match', async () => {
    const harness = new Harness();
    harness.order = ranking(...numbers(10, 19), ...numbers(1, 9));
    const result = await harness.engine.runTurn(
      emptyTurnState(),
      { text: 'zarzavat5 sorusu' },
      harness.context(skills(20)),
    );
    expect(harness.offered()).not.toContain(id(5));
    expect(result.decisions.skillId).not.toBe(id(5));
  });

  it('keeps the procedure in progress on the call’s list when it is the farthest', async () => {
    const harness = new Harness();
    const context = harness.context(skills(20));
    harness.order = ranking(...numbers(1, 19));
    const first = await harness.engine.runTurn(
      emptyTurnState(),
      { text: 'param yatmadı' },
      context,
    );
    expect(first.decisions.skillId).toBe(id(1));
    const state: TurnState = first.nextState;

    harness.order = ranking(...numbers(2, 19), 1);
    const second = await harness.engine.runTurn(state, { text: 'oyuncu_123' }, context);
    expect(harness.offered(1)).toContain(id(1));
    expect(harness.offered(1)).toHaveLength(12);
    expect(second.decisions.skillId).toBe(id(1));
    expect(second.decisions.understood?.prefilter).toMatchObject({ offered: 12 });
  });

  it('an embedding that fails narrows nothing: all 20 offered, the turn goes on, the log says why', async () => {
    const harness = new Harness();
    harness.embedFailure = new EmbeddingProviderError('unavailable', { status: 503 });
    const result = await harness.engine.runTurn(
      emptyTurnState(),
      { text: 'zarzavat12 sorusu' },
      harness.context(skills(20)),
    );
    expect(harness.ranked).toEqual([]);
    expect(harness.offered()).toHaveLength(20);
    expect(result.decisions.skillId).toBe(id(12));
    expect(result.decisions.understood).not.toHaveProperty('prefilter');
    expect(result.decisions.log[0]).toEqual({
      step: 'prefilter',
      detail: 'not narrowed — the message could not be embedded (unavailable)',
      ok: false,
    });
  });

  it('so does today’s cap on the embedding', async () => {
    const harness = new Harness();
    harness.embedFailure = new AiDailyCapError('embedding', 'workspace', 120);
    const result = await harness.engine.runTurn(
      emptyTurnState(),
      { text: 'zarzavat12 sorusu' },
      harness.context(skills(20)),
    );
    expect(harness.offered()).toHaveLength(20);
    expect(result.decisions.skillId).toBe(id(12));
    expect(result.decisions.log[0]).toMatchObject({ step: 'prefilter', ok: false });
  });

  it('one embedding per turn: the knowledge search reuses the narrowing’s, and it is counted once', async () => {
    const harness = new Harness();
    harness.order = ranking(...numbers(10, 19));
    const kargo: TurnSkill = {
      id: 'kargo',
      name: 'Kargo',
      aiAgentId: 'agent-1',
      steps: [
        { type: 'detect_intent', intent: 'kargo', phrases: ['kargom nerede'] },
        { type: 'send_message', source: 'knowledge' },
      ],
      persona: PERSONA,
    };
    const result = await harness.engine.runTurn(
      emptyTurnState(),
      { text: 'kargom nerede' },
      harness.context([...skills(20), kargo]),
    );
    expect(result.decisions.skillId).toBe('kargo');
    expect(harness.embedded).toEqual(['kargom nerede']);
    expect(harness.searched).toEqual([
      { space: 'test:space', vector: '[1]', usage: { inputTokens: 0 } },
    ]);
    expect(result.decisions.usage.embeddingTokens).toBe(5);
    // The answer was written from what that search found.
    expect(JSON.stringify(harness.llm.calls)).toContain('Kargolar iki günde teslim edilir.');
  });
});
