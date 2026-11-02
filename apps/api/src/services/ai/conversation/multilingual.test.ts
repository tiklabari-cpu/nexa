/**
 * The AI in the player's language (tm 387 · SiyahTuş analysis AI-30): the
 * conversation keeps a language — a first confident message sets it, "ok"
 * does not move it, two confident messages in a row switch it; a language the
 * persona does not speak is a hand-over with the template in that language
 * and an AI-22 record; an answer translated from Turkish knowledge keeps
 * every figure, and about money it is not sent when one changed; the persona
 * can turn translation off per language and add a note to a translation; a
 * Russian promise is caught by the output check.
 *
 * The database a turn is handed throws when touched; the knowledge search is
 * a stand-in that holds the passages a test gives it.
 */
import { describe, expect, it } from 'vitest';
import {
  GUARDRAIL_OUTPUT_BLOCK_REASON,
  readPersona,
  splitSkillProcedure,
  TRANSLATION_NOTES,
  type Persona,
} from '@siyahtus/types';
import { FakeLlmProvider } from '../../../../test/helpers/fake-llm-provider.js';
import { depositProcedure } from '../../../../test/helpers/procedure-fixtures.js';
import type { TenantClient, TenantContext } from '../../../lib/tenant.js';
import {
  RETRIEVAL_THRESHOLD,
  type KnowledgeSearch,
  type KnowledgeService,
  type RetrievedChunk,
} from '../knowledge-service.js';
import { readAnswerGrounding } from '../provider/answer-prompt.js';
import type { LlmCompletionRequest } from '../provider/llm-provider.js';
import { ConversationEngine } from './conversation-engine.js';
import { safeText } from './guardrails/guardrail-turn.js';
import { inventedFigures, NO_ANSWER_PHRASES } from './knowledge-answer.js';
import { confidentLanguage, nextLanguageTrack, readLanguageTrack } from './policy.js';
import {
  emptyTurnState,
  type TenantRunner,
  type TurnContext,
  type TurnResult,
  type TurnSkill,
  type TurnState,
} from './turn.js';

const TENANT: TenantContext = { licenseId: 1n, organizationId: 'org-test' };
const NOW = new Date('2026-11-02T10:50:00Z');

const untouchable = new Proxy(
  {},
  {
    get: (_, table) => {
      throw new Error(`a turn touched the database (${String(table)})`);
    },
  },
) as TenantClient;
const db: TenantRunner = (fn) => fn(untouchable);

/** The Turkish passage AI-30's acceptance names: "Papara min 100 TL", "30 dakika". */
const PAPARA_TR: RetrievedChunk = {
  id: 'chunk-papara',
  sourceId: 'source-papara',
  sourceName: 'Yatırım SSS',
  sourceLanguage: 'tr',
  text: 'Papara ile minimum yatırım 100 TL, işlem genellikle 30 dakika içinde hesaba geçer.',
  score: 0.8,
};
const PAPARA_RU_REPLY =
  'Минимальный депозит через Papara — 100 TL, зачисление обычно занимает 30 минут.';

/** A Russian passage — knowledge in the player's own language, nothing to translate. */
const HOURS_RU: RetrievedChunk = {
  id: 'chunk-hours',
  sourceId: 'source-hours',
  sourceName: 'Часы работы',
  text: 'Служба поддержки работает круглосуточно, и вы можете написать нам в любое время.',
  score: 0.8,
};

function knowledgeOf(chunks: RetrievedChunk[]): KnowledgeService {
  return {
    threshold: RETRIEVAL_THRESHOLD,
    embedQuery: async () => ({ space: 'test:space', vector: '[1]', usage: { inputTokens: 3 } }),
    search: async (): Promise<KnowledgeSearch> => ({
      strategy: 'exact',
      chunksInScope: chunks.length,
      chunks,
    }),
  } as unknown as KnowledgeService;
}

function engine(chunks: RetrievedChunk[], llm: FakeLlmProvider): ConversationEngine {
  return new ConversationEngine({
    llm,
    maxOutputTokens: 400,
    timeoutMs: 20_000,
    maxPromptChars: 16_000,
    knowledge: knowledgeOf(chunks),
  });
}

const { procedure: depositBody, ...depositOwn } = splitSkillProcedure(depositProcedure());
function depositSkill(persona: Persona): TurnSkill {
  return {
    id: 'deposit',
    name: 'Yatırım geçmedi',
    aiAgentId: 'agent-1',
    steps: [],
    persona,
    mode: 'procedure',
    definition: { ...depositOwn, procedure: depositBody },
    locked: false,
  };
}

const TR_RU = readPersona({ tone: null, languages: ['tr', 'ru'], persona: null });
const TR_ONLY = readPersona({ tone: null, languages: ['tr'], persona: null });

function context(persona: Persona, overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    tenant: TENANT,
    db,
    now: NOW,
    mode: 'live',
    chatId: 'c',
    configVersionId: null,
    config: { skills: [depositSkill(persona)] },
    toolStubs: {},
    timeZone: 'Europe/Istanbul',
    procedure: { understanding: { intent: { procedure_key: null, confidence: 0 } } },
    ...overrides,
  };
}

/** A conversation: each `say` runs a turn on the state the previous one left. */
function conversation(
  ai: ConversationEngine,
  persona: Persona,
  overrides: Partial<TurnContext> = {},
) {
  let state: TurnState = emptyTurnState();
  return {
    async say(text: string): Promise<TurnResult> {
      const result = await ai.runTurn(state, { text }, context(persona, overrides));
      state = result.nextState;
      return result;
    },
    get state() {
      return state;
    },
  };
}

/** The language each knowledge answer was asked in, in order. */
function askedIn(llm: FakeLlmProvider): Array<string | null> {
  return llm.calls.map((call) => readAnswerGrounding(call.system)?.answerIn ?? null);
}

/** A model that answers in the language it is asked to. */
function bilingual(): FakeLlmProvider {
  return new FakeLlmProvider({
    reply: (request: LlmCompletionRequest) =>
      readAnswerGrounding(request.system)?.answerIn === 'ru'
        ? 'Служба поддержки работает круглосуточно.'
        : 'Destek ekibimiz 7/24 çalışır.',
  });
}

describe('the conversation keeps a language (AI-30 §1)', () => {
  it('answers a Russian message in Russian, and "ok" does not change it (AI-30 acceptance)', async () => {
    const llm = bilingual();
    const chat = conversation(engine([HOURS_RU], llm), TR_RU);

    const first = await chat.say(
      'Здравствуйте, когда работает служба поддержки и как с вами связаться?',
    );
    expect(first.reply).toBe('Служба поддержки работает круглосуточно.');
    expect(readLanguageTrack(chat.state.signals)).toEqual({ current: 'ru', pending: null });

    const ok = await chat.say('ok');
    expect(ok.reply).toBe('Служба поддержки работает круглосуточно.');
    expect(askedIn(llm)).toEqual(['ru', 'ru']);
    expect(readLanguageTrack(chat.state.signals)).toEqual({ current: 'ru', pending: null });
  });

  it('switches only on the second confident message in another language', async () => {
    const llm = bilingual();
    const chat = conversation(engine([HOURS_RU], llm), TR_RU);
    await chat.say('Здравствуйте, когда работает служба поддержки и как с вами связаться?');

    await chat.say('Destek ekibi ne zaman çalışıyor, nasıl ulaşabilirim?');
    expect(readLanguageTrack(chat.state.signals)).toEqual({ current: 'ru', pending: 'tr' });
    await chat.say('Peki hafta sonu da açık mı, ne zaman yazabilirim?');
    expect(readLanguageTrack(chat.state.signals)).toEqual({ current: 'tr', pending: null });
    expect(askedIn(llm)).toEqual(['ru', 'ru', 'tr']);
  });

  it('a model reading below 0.7, or a message under three words, moves nothing', () => {
    expect(confidentLanguage('ok', 'ru')).toBeNull();
    expect(confidentLanguage('tamam', null)).toBeNull();
    // Greek, which the rule does not know: the model's reading counts when it is sure.
    const greek = 'Γεια σας η κατάθεσή μου δεν έφτασε';
    expect(confidentLanguage(greek, { language: 'el', language_confidence: 0.65 })).toBeNull();
    expect(confidentLanguage(greek, { language: 'el', language_confidence: 0.9 })).toBe('el');
    expect(nextLanguageTrack({ current: 'ru', pending: null }, null)).toEqual({
      current: 'ru',
      pending: null,
    });
  });

  it('starts in the visitor’s widget language when the persona speaks it, else its default', async () => {
    const llm = bilingual();
    await conversation(engine([HOURS_RU], llm), TR_RU, { visitorLanguage: 'ru' }).say('ok');
    const withDefault = readPersona({
      tone: null,
      languages: ['tr', 'ru'],
      persona: { defaultLanguage: 'ru' },
    });
    await conversation(engine([HOURS_RU], llm), withDefault, { visitorLanguage: 'de' }).say('ok');
    await conversation(engine([HOURS_RU], llm), TR_RU, { visitorLanguage: 'de' }).say('ok');
    expect(askedIn(llm)).toEqual(['ru', 'ru', 'tr']);
  });
});

describe('a language the persona does not speak (AI-30 §2)', () => {
  it('hands over with the template in that language, and AI-22 records unsupported_language (AI-30 acceptance)', async () => {
    const llm = bilingual();
    const result = await conversation(engine([PAPARA_TR], llm), TR_ONLY).say(
      'Мой депозит через Papara не пришёл, что мне делать?',
    );
    expect(result.reply).toBe(NO_ANSWER_PHRASES.ru.handingOver);
    expect(result.decisions).toMatchObject({
      outcome: 'handed_off',
      handoffReason: 'unsupported_language',
    });
    expect(result.sideEffects).toEqual([
      expect.objectContaining({ kind: 'handoff', reason: 'unsupported_language' }),
    ]);
    expect(result.unresolved).toMatchObject({ reason: 'unsupported_language' });
    expect(llm.calls).toHaveLength(0);
  });
});

describe('an answer translated from Turkish knowledge (AI-30 §2–§3)', () => {
  it('keeps "100 TL" and "30 dakika", told to translate faithfully (AI-30 acceptance)', async () => {
    const llm = new FakeLlmProvider({ reply: PAPARA_RU_REPLY });
    const result = await conversation(engine([PAPARA_TR], llm), TR_RU).say(
      'Какой минимальный депозит через Papara и сколько это занимает?',
    );
    expect(result.reply).toBe(PAPARA_RU_REPLY);
    expect(result.decisions.outcome).toBe('answered');
    const prompt = llm.calls[0]!.system;
    expect(readAnswerGrounding(prompt)).toMatchObject({ answerIn: 'ru', translateFrom: 'tr' });
    expect(prompt).toContain(
      'Keep every number, currency, limit, duration and payment-method name exactly as the passages give them, and add nothing they do not say.',
    );
    expect(result.decisions.log.at(-1)?.detail).toContain('translated from tr');
  });

  it.each([
    ['an amount', 'Минимальный депозит через Papara — 200 TL, обычно занимает 30 минут.'],
    ['a currency', 'Минимальный депозит через Papara — 100 рублей, обычно занимает 30 минут.'],
    ['a duration', 'Минимальный депозит через Papara — 100 TL, обычно занимает 50 минут.'],
  ])(
    'about money, a changed figure (%s) is not sent and a person answers (AI-30 acceptance)',
    async (_, reply) => {
      const llm = new FakeLlmProvider({ reply });
      const result = await conversation(engine([PAPARA_TR], llm), TR_RU).say(
        'Какой минимальный депозит через Papara и сколько это занимает?',
      );
      expect(result.reply).toBe(safeText('ru'));
      expect(result.reply).not.toContain('Papara');
      expect(result.decisions).toMatchObject({
        outcome: 'handed_off',
        handoffReason: GUARDRAIL_OUTPUT_BLOCK_REASON,
      });
      // Not written again: the first slip hands over.
      expect(llm.calls).toHaveLength(1);
      expect(result.decisions.log.at(-1)?.detail).toContain('the translation from tr changed');
    },
  );

  it('a persona that turned translation off for Russian hands it to a person, asking no model (AI-30-S1)', async () => {
    const llm = new FakeLlmProvider({ reply: PAPARA_RU_REPLY });
    const noRussianTranslation = readPersona({
      tone: null,
      languages: ['tr', 'ru'],
      persona: { translateFromKnowledge: { ru: false } },
    });
    const result = await conversation(engine([PAPARA_TR], llm), noRussianTranslation).say(
      'Какой минимальный депозит через Papara и сколько это занимает?',
    );
    expect(llm.calls).toHaveLength(0);
    expect(result.decisions).toMatchObject({
      outcome: 'handed_off',
      handoffReason: 'unsupported_language',
    });
    expect(result.unresolved).toMatchObject({ reason: 'unsupported_language' });
  });

  it('ends a translation with the note when the persona asks for one', async () => {
    const llm = new FakeLlmProvider({ reply: PAPARA_RU_REPLY });
    const noting = readPersona({
      tone: null,
      languages: ['tr', 'ru'],
      persona: { disclaimerOnTranslation: true },
    });
    const result = await conversation(engine([PAPARA_TR], llm), noting).say(
      'Какой минимальный депозит через Papara и сколько это занимает?',
    );
    expect(result.reply).toBe(`${PAPARA_RU_REPLY}\n${TRANSLATION_NOTES.ru}`);
  });

  it('reads Russian units and currencies against the Turkish source', () => {
    const source = [PAPARA_TR.text];
    expect(inventedFigures('100 лир, 30 минут', source)).toEqual([]);
    expect(inventedFigures('₺100 за 30 мин', source)).toEqual([]);
    expect(inventedFigures('100 руб', source)).toEqual(['100 руб']);
    expect(inventedFigures('100 USD', source)).toEqual(['100 usd']);
  });
});

describe('the output check in the reply’s language (AI-30 · AI-08)', () => {
  it('catches a Russian guarantee in a translated answer: the safe text, in Russian, and a person (AI-30 acceptance)', async () => {
    const llm = new FakeLlmProvider({
      reply: 'Мы гарантируем зачисление 100 TL через Papara за 30 минут.',
    });
    const result = await conversation(engine([PAPARA_TR], llm), TR_RU).say(
      'Какой минимальный депозит через Papara и сколько это занимает?',
    );
    expect(result.reply).toBe(safeText('ru'));
    expect(result.decisions.outcome).toBe('handed_off');
    expect(result.decisions.guardrails?.hits).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule_key: 'G7', stage: 'output' })]),
    );
  });
});
