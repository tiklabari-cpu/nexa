/**
 * The behaviour rules and the persona's style in a turn (tm 299.1 · AI-07):
 * which rules a written call carries, where in the prompt, under which
 * budget, what the decision record keeps — and `max_questions_per_message`
 * applied by the procedure executor, not asked of the model.
 *
 * Every model request is captured on its way to the in-process stub, so what
 * is asserted is the request a model would have received.
 */
import { describe, expect, it } from 'vitest';
import {
  readPersona,
  readPersonaStyle,
  splitSkillProcedure,
  validateProcedure,
  type Procedure,
} from '@siyahtus/types';
import { FakeLlmProvider } from '../../../../test/helpers/fake-llm-provider.js';
import {
  DEPOSIT_OPTIONS,
  DEPOSIT_TEMPLATES,
  depositFacts,
  depositProcedure,
} from '../../../../test/helpers/procedure-fixtures.js';
import type { TenantClient, TenantContext } from '../../../lib/tenant.js';
import { skillDecision } from '../decision-log.js';
import {
  RETRIEVAL_THRESHOLD,
  type KnowledgeSearch,
  type KnowledgeService,
} from '../knowledge-service.js';
import type { LlmCompletion, LlmCompletionRequest, LlmProvider } from '../provider/llm-provider.js';
import { MockLlmProvider } from '../provider/mock-llm-provider.js';
import { ConversationEngine } from './conversation-engine.js';
import type { GuidanceRuleConfig } from './guidance.js';
import { UNDERSTAND_RESPONSE_NAME } from './understand.js';
import { emptyTurnState, type TenantRunner, type TurnContext, type TurnSkill } from './turn.js';

const TENANT: TenantContext = { licenseId: 1n, organizationId: 'org-test' };
const NOW = new Date('2026-10-18T10:50:00Z');
const PERSONA = readPersona({ tone: null, languages: [], persona: null });

const untouchable = new Proxy(
  {},
  {
    get: (_, table) => {
      throw new Error(`a turn touched the database (${String(table)})`);
    },
  },
) as TenantClient;
const db: TenantRunner = (fn) => fn(untouchable);

/** One passage about deposits; anything else finds nothing. */
const knowledge = {
  threshold: RETRIEVAL_THRESHOLD,
  embedQuery: async (query: string) => ({
    space: query,
    vector: '[1]',
    usage: { inputTokens: 3 },
  }),
  search: async (
    _tx: unknown,
    _tenant: unknown,
    query: { space: string },
  ): Promise<KnowledgeSearch> => ({
    strategy: 'exact',
    chunksInScope: 1,
    chunks: /yatırım/i.test(query.space)
      ? [
          {
            id: 'chunk-1',
            sourceId: 'source-1',
            sourceName: 'Yatırımlar',
            text: 'Papara yatırımları 30 dakikada yansır.',
            score: 0.9,
          },
        ]
      : [],
  }),
} as unknown as KnowledgeService;

/** The stub's answers, with every request kept. */
class Capturing implements LlmProvider {
  readonly id = 'mock' as const;
  readonly requests: LlmCompletionRequest[] = [];
  readonly #inner: LlmProvider;
  constructor(inner: LlmProvider = new MockLlmProvider()) {
    this.#inner = inner;
  }
  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    this.requests.push(request);
    return this.#inner.complete(request);
  }
  /** The written calls: compose and the knowledge answer, not the understanding. */
  written(): string[] {
    return this.requests
      .filter((request) => request.responseFormat?.name !== UNDERSTAND_RESPONSE_NAME)
      .map((request) => request.system);
  }
}

function engine(llm: LlmProvider): ConversationEngine {
  return new ConversationEngine({
    llm,
    maxOutputTokens: 400,
    timeoutMs: 20_000,
    maxPromptChars: 16_000,
    knowledge,
  });
}

function build(raw: Record<string, unknown>): Procedure {
  const result = validateProcedure(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

function procedureSkill(
  id: string,
  procedure: Procedure,
  extra: Partial<TurnSkill> = {},
): TurnSkill {
  const { procedure: body, ...own } = splitSkillProcedure(procedure);
  return {
    id,
    name: id,
    aiAgentId: 'agent-1',
    steps: [],
    persona: PERSONA,
    mode: 'procedure',
    definition: { ...own, procedure: body },
    locked: false,
    ...extra,
  };
}

/** Two topics whose turns each end in a written part. */
const BONUS = procedureSkill(
  'bonus',
  build({
    when_to_use: 'Oyuncu bonusu soruyor.',
    examples: ['bonus nedir'],
    steps: [
      { id: 'anlat', type: 'say', instruction: 'Bonus kurallarını kısaca anlat.' },
      { id: 'bitti', type: 'resolve', outcome: 'resolved' },
    ],
  }),
);
const WITHDRAWAL = procedureSkill(
  'cekim',
  build({
    when_to_use: 'Oyuncu çekim yapamadığını söylüyor.',
    examples: ['çekim yapamıyorum'],
    steps: [
      { id: 'anlat', type: 'say', instruction: 'Çekim süresini kısaca anlat.' },
      { id: 'bitti', type: 'resolve', outcome: 'resolved' },
    ],
  }),
);

const ALL_RULE = 'Ödeme sorunlarında yöntemi, tutarı ve saati öğrenmeden çözüm önerme.';
const BONUS_RULE = 'Bonus kurallarını anlatırken çevrim şartını açıkça belirt.';
const OTHER_AGENT_RULE = 'Oyuncuya her zaman ilk adıyla seslen.';

function rule(
  id: string,
  body: string,
  extra: Partial<GuidanceRuleConfig> = {},
): GuidanceRuleConfig {
  return {
    id,
    aiAgentId: 'agent-1',
    body,
    category: 'communication',
    scope: { all: true },
    priority: 100,
    ...extra,
  };
}

const RULES: GuidanceRuleConfig[] = [
  rule('r-all', ALL_RULE, { category: 'clarification' }),
  rule('r-bonus', BONUS_RULE, { scope: { skill_ids: ['bonus'] } }),
  rule('r-other', OTHER_AGENT_RULE, { aiAgentId: 'agent-2' }),
];

function context(
  skills: TurnSkill[],
  guidance: readonly GuidanceRuleConfig[] = RULES,
  overrides: Partial<TurnContext> = {},
): TurnContext {
  return {
    tenant: TENANT,
    db,
    now: NOW,
    mode: 'live',
    chatId: 'c',
    configVersionId: null,
    config: { skills, guidance },
    toolStubs: {},
    timeZone: 'Europe/Istanbul',
    procedure: { facts: depositFacts(), options: DEPOSIT_OPTIONS },
    ...overrides,
  };
}

describe('which rules a written call carries (AI-07 §2)', () => {
  it('a rule scoped to the bonus procedure is in its compose request, and in no other procedure’s', async () => {
    const llm = new Capturing();
    const ai = engine(llm);
    const bonus = await ai.runTurn(
      emptyTurnState(),
      { text: 'bonus nedir' },
      context([BONUS, WITHDRAWAL]),
    );
    expect(bonus.decisions.skillId).toBe('bonus');
    const [bonusCompose] = llm.written();
    expect(bonusCompose).toContain(`- ${BONUS_RULE}`);
    expect(bonusCompose).toContain(`- ${ALL_RULE}`);
    expect(bonusCompose).not.toContain(OTHER_AGENT_RULE);

    llm.requests.length = 0;
    const withdrawal = await ai.runTurn(
      emptyTurnState(),
      { text: 'çekim yapamıyorum' },
      context([BONUS, WITHDRAWAL]),
    );
    expect(withdrawal.decisions.skillId).toBe('cekim');
    const [withdrawalCompose] = llm.written();
    expect(withdrawalCompose).toContain('1. Çekim süresini kısaca anlat.');
    expect(withdrawalCompose).toContain(`- ${ALL_RULE}`);
    expect(withdrawalCompose).not.toContain(BONUS_RULE);
    expect(withdrawalCompose).not.toContain(OTHER_AGENT_RULE);
  });

  it('the decision record keeps the ids of the rules the turn carried, never their words', async () => {
    const result = await engine(new Capturing()).runTurn(
      emptyTurnState(),
      { text: 'bonus nedir' },
      context([BONUS]),
    );
    expect(result.decisions.guidance).toEqual({ rule_ids: ['r-all', 'r-bonus'] });
    const record = skillDecision(result);
    expect(record?.details).toMatchObject({ guidance: { rule_ids: ['r-all', 'r-bonus'] } });
    expect(JSON.stringify(record?.details)).not.toContain('çevrim');
  });

  it('the knowledge path carries the every-conversation rules, not a procedure’s', async () => {
    const llm = new Capturing();
    const result = await engine(llm).runTurn(
      emptyTurnState(),
      { text: 'papara yatırımı ne kadar sürer' },
      context([BONUS]),
    );
    expect(result.reply).toContain('30 dakikada');
    const [answer] = llm.written();
    expect(answer).toContain(`- ${ALL_RULE}`);
    expect(answer).not.toContain(BONUS_RULE);
    expect(result.decisions.guidance).toEqual({ rule_ids: ['r-all'] });
  });

  it('with no rule and no style, the compose prompt has no rules block at all', async () => {
    const llm = new Capturing();
    await engine(llm).runTurn(emptyTurnState(), { text: 'bonus nedir' }, context([BONUS], []));
    const [compose] = llm.written();
    expect(compose).not.toContain('most binding first');
  });

  it('past 30 rules the lowest priorities are left out and the record says guidance_truncated', async () => {
    const many = Array.from({ length: 31 }, (_, n) =>
      rule(`r-${String(n).padStart(2, '0')}`, `Kural numarası ${n} için kısa bir cümle.`, {
        priority: n + 1,
      }),
    );
    const llm = new Capturing();
    const result = await engine(llm).runTurn(
      emptyTurnState(),
      { text: 'bonus nedir' },
      context([BONUS], many),
    );
    const [compose] = llm.written();
    expect(compose).toContain('Kural numarası 29 için');
    expect(compose).not.toContain('Kural numarası 30 için');
    expect(result.decisions.guidance?.rule_ids).toHaveLength(30);
    expect(result.decisions.guidance?.truncated).toEqual({ dropped: 1, rule_ids: ['r-30'] });
    expect(result.decisions.log.some((line) => line.detail.includes('guidance_truncated'))).toBe(
      true,
    );
  });
});

describe('the layer order in the prompt (AI-07 §1)', () => {
  it('step instruction, then the rules, then the persona — and the earlier wins', async () => {
    const llm = new Capturing();
    const styled = {
      ...BONUS,
      style: readPersonaStyle({ addressForm: 'siz', emoji: 'none' }),
    };
    await engine(llm).runTurn(emptyTurnState(), { text: 'bonus nedir' }, context([styled]));
    const [compose] = llm.written();
    const at = (text: string) => compose!.indexOf(text);
    expect(at('1. Bonus kurallarını kısaca anlat.')).toBeGreaterThanOrEqual(0);
    expect(at('Where two conflict, the earlier one wins.')).toBeGreaterThan(
      at('1. Bonus kurallarını kısaca anlat.'),
    );
    expect(at(`- ${ALL_RULE}`)).toBeGreaterThan(at("The business's rules for how you behave:"));
    expect(at('Persona:')).toBeGreaterThan(at(`- ${BONUS_RULE}`));
    expect(at('formally: in Turkish with "siz"')).toBeGreaterThan(at('Persona:'));
    expect(at('Use no emoji.')).toBeGreaterThan(at('Persona:'));
  });
});

describe('the persona’s style (AI-07 §3)', () => {
  it('a written part with an emoji the style rules out is sent, with a warning in the run log', async () => {
    const llm = new FakeLlmProvider({ reply: 'Bonuslar çevrim şartıyla verilir 🎉' });
    const styled = { ...BONUS, style: readPersonaStyle({ emoji: 'none' }) };
    const result = await engine(llm).runTurn(
      emptyTurnState(),
      { text: 'bonus nedir' },
      context([styled]),
    );
    expect(result.reply).toBe('Bonuslar çevrim şartıyla verilir 🎉');
    expect(result.decisions.log).toContainEqual(
      expect.objectContaining({
        step: 'anlat',
        detail: expect.stringContaining('style warning: emoji'),
      }),
    );
  });

  it('max_questions_per_message = 1: the deposit procedure asks one question per message', async () => {
    const deposit = procedureSkill('deposit', depositProcedure());
    const two = await engine(new Capturing()).runTurn(
      emptyTurnState(),
      { text: 'param yatmadı' },
      context([deposit]),
    );
    expect(two.reply).toBe(
      `${DEPOSIT_TEMPLATES.giris}\nHangi yöntemle yatırım yaptınız? Saat kaçta yatırdınız?`,
    );

    const one = { ...deposit, style: readPersonaStyle({ maxQuestionsPerMessage: 1 }) };
    const first = await engine(new Capturing()).runTurn(
      emptyTurnState(),
      { text: 'param yatmadı' },
      context([one]),
    );
    expect(first.reply).toBe(`${DEPOSIT_TEMPLATES.giris}\nHangi yöntemle yatırım yaptınız?`);
    expect(first.nextState.stepStatus).toBe('awaiting_answer');
  });
});
