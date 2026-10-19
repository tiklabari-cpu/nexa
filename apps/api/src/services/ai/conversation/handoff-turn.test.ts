/**
 * The hand-over triggers through the engine (tm 303.2 · SiyahTuş analysis
 * AI-09): a person asked for, the one question G16 allows, an upset player,
 * the workspace's limits and words, a repeat contact, a loop. The model is
 * the in-process stub (`understand-mock.ts`) unless a test hands the
 * understanding in; the triggers' pure parts: `handoff/triggers.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HANDOFF_AFTER_HOURS_TEXT,
  DEFAULT_HANDOFF_MESSAGES,
  mergeHandoffMessages,
  mergeHandoffTriggers,
  readPersona,
  splitSkillProcedure,
  validateProcedure,
  type HandoffTriggersChange,
  type Procedure,
} from '@siyahtus/types';
import {
  DEPOSIT_OPTIONS,
  depositFacts,
  depositProcedure,
} from '../../../../test/helpers/procedure-fixtures.js';
import type { TenantClient, TenantContext } from '../../../lib/tenant.js';
import { RETRIEVAL_THRESHOLD, type KnowledgeService } from '../knowledge-service.js';
import { skillDecision } from '../decision-log.js';
import { MockLlmProvider } from '../provider/mock-llm-provider.js';
import { ConversationEngine } from './conversation-engine.js';
import { DEFAULT_HANDOFF_CONFIG, HANDOFF_PHRASES, type HandoffConfig } from './handoff/triggers.js';
import type { HandoffRuleConfig } from './handoff/rules.js';
import { NO_ANSWER_PHRASES } from './knowledge-answer.js';
import {
  emptyTurnState,
  handoffOf,
  type TenantRunner,
  type TurnContext,
  type TurnHistory,
  type TurnResult,
  type TurnSkill,
  type TurnState,
} from './turn.js';

const TENANT: TenantContext = { licenseId: 1n, organizationId: 'org-test' };
const NOW = new Date('2026-10-18T10:50:00Z');
const PERSONA = readPersona({ tone: null, languages: [], persona: null });
const HANDING_OVER = NO_ANSWER_PHRASES.tr.handingOver;

const untouchable = new Proxy(
  {},
  {
    get: (_, table) => {
      throw new Error(`a turn touched the database (${String(table)})`);
    },
  },
) as TenantClient;
const db: TenantRunner = (fn) => fn(untouchable);

/** A knowledge base with nothing in it. */
const knowledge = {
  threshold: RETRIEVAL_THRESHOLD,
  embedQuery: async (query: string) => ({ space: query, vector: '[1]', usage: { inputTokens: 1 } }),
  search: async () => ({ strategy: 'exact', chunksInScope: 0, chunks: [] }),
} as unknown as KnowledgeService;

function engine(): ConversationEngine {
  return new ConversationEngine({
    llm: new MockLlmProvider(),
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

function procedureSkill(id: string, name: string, procedure: Procedure): TurnSkill {
  const { procedure: body, ...own } = splitSkillProcedure(procedure);
  return {
    id,
    name,
    aiAgentId: 'agent-1',
    steps: [],
    persona: PERSONA,
    mode: 'procedure',
    definition: { ...own, procedure: body },
    locked: false,
  };
}

/** A one-turn topic: it says how withdrawals work and resolves. */
const WITHDRAWAL_SKILL = procedureSkill(
  'withdrawal',
  'Çekim',
  build({
    when_to_use: 'Oyuncu çekim yapamadığını söylüyor.',
    examples: ['çekim yapamıyorum', 'para çekemiyorum'],
    steps: [
      { id: 'bilgi', type: 'say', template_key: 'bilgi' },
      { id: 'bitti', type: 'resolve', outcome: 'resolved' },
    ],
    templates: [{ key: 'bilgi', text: 'Çekim talepleri genellikle 24 saat içinde işlenir.' }],
  }),
);
const DEPOSIT_SKILL = procedureSkill('deposit', 'Yatırım geçmedi', depositProcedure());
const SKILLS = [DEPOSIT_SKILL, WITHDRAWAL_SKILL];

function handoffConfig(
  triggers: HandoffTriggersChange = {},
  messages: Parameters<typeof mergeHandoffMessages>[1] = {},
): HandoffConfig {
  return {
    ...DEFAULT_HANDOFF_CONFIG,
    triggers: mergeHandoffTriggers(null, triggers),
    messages: mergeHandoffMessages(null, messages),
  };
}

function context(overrides: Partial<TurnContext> = {}, handoff?: HandoffConfig): TurnContext {
  return {
    tenant: TENANT,
    db,
    now: NOW,
    mode: 'live',
    chatId: 'c',
    configVersionId: null,
    config: { skills: SKILLS, ...(handoff ? { handoff } : {}) },
    toolStubs: {},
    timeZone: 'Europe/Istanbul',
    procedure: { facts: depositFacts(), options: DEPOSIT_OPTIONS },
    aiMode: 'ai',
    ...overrides,
  };
}

/** A conversation: each `say` runs a turn on the state the previous one left. */
function conversation(handoff?: HandoffConfig, start: TurnState = emptyTurnState()) {
  const ai = engine();
  let state = start;
  return {
    async say(text: string, more: Partial<TurnContext> = {}): Promise<TurnResult> {
      const result = await ai.runTurn(state, { text }, context(more, handoff));
      state = result.nextState;
      return result;
    },
    get state(): TurnState {
      return state;
    },
  };
}

const reasonsOf = (result: TurnResult) => handoffOf(result.sideEffects)?.reasons ?? null;
const hitsOf = (result: TurnResult) =>
  (result.decisions.guardrails?.hits ?? []).map(
    (hit) => `${hit.rule_key}/${hit.stage}/${hit.action}`,
  );

describe('a person asked for (AI-09 `player_request` · G16)', () => {
  it('“insanla görüşmek istiyorum” with the topic known: a person this turn, no question (AI-09 acceptance)', async () => {
    const chat = conversation();
    const first = await chat.say('param yatmadı');
    expect(handoffOf(first.sideEffects)).toBeNull();
    const asked = await chat.say('müşteri temsilcisiyle görüşmek istiyorum');
    expect(asked.reply).toBe(HANDING_OVER);
    expect(asked.decisions).toMatchObject({
      outcome: 'handed_off',
      handoffReasons: ['player_request'],
    });
    expect(reasonsOf(asked)).toEqual(['player_request']);
  });

  it('the topic in the same message: the understanding names it, and a person goes this turn', async () => {
    const result = await conversation().say(
      'müşteri temsilcisiyle görüşmek istiyorum, para çekemiyorum',
    );
    expect(result.reply).toBe(DEFAULT_HANDOFF_MESSAGES.player_request.tr);
    expect(reasonsOf(result)).toEqual(['player_request']);
    expect(hitsOf(result)).toContain('G16/input/handoff');
  });

  it('the topic not known: one question — "what is it about?" — and a person on the next message, whatever it says (AI-09-S1)', async () => {
    const chat = conversation();
    const asked = await chat.say('müşteri temsilcisiyle görüşmek istiyorum');
    expect(asked.reply).toBe(HANDOFF_PHRASES.tr.topic);
    expect(asked.decisions).toMatchObject({ outcome: 'answered', replyKind: 'question' });
    expect(handoffOf(asked.sideEffects)).toBeNull();
    expect(hitsOf(asked)).toContain('G16/input/evidence');
    expect(chat.state.signals['handoff']).toMatchObject({ topic_asked: 1 });

    const answered = await chat.say('bonusum hesabıma yüklenmedi');
    expect(answered.reply).toBe(DEFAULT_HANDOFF_MESSAGES.player_request.tr);
    expect(reasonsOf(answered)).toEqual(['player_request']);
    expect(skillDecision(answered)).toMatchObject({
      decision: 'handoff',
      details: { reason_codes: ['player_request'] },
    });
  });

  it('asked again after the question: a person, no second question', async () => {
    const chat = conversation();
    await chat.say('müşteri temsilcisiyle görüşmek istiyorum');
    const again = await chat.say('müşteri temsilcisiyle görüşmek istiyorum');
    expect(reasonsOf(again)).toEqual(['player_request']);
  });

  it('`wants_human.explicit` in words the lexicon does not know is a request too', async () => {
    const result = await conversation().say('bunu bir insan halletsin, param yatmadı', {
      procedure: {
        facts: depositFacts(),
        options: DEPOSIT_OPTIONS,
        understanding: {
          intent: { procedure_key: 'deposit', confidence: 0.9 },
          wants_human: { value: true, explicit: true },
        } as never,
      },
    });
    expect(result.reply).toBe(DEFAULT_HANDOFF_MESSAGES.player_request.tr);
    expect(reasonsOf(result)).toEqual(['player_request']);
  });

  it("the workspace's own message is said as written", async () => {
    const chat = conversation(
      handoffConfig({}, { player_request: 'Hemen bir arkadaşımı bağlıyorum.' }),
    );
    await chat.say('param yatmadı');
    const asked = await chat.say('müşteri temsilcisiyle görüşmek istiyorum');
    expect(asked.reply).toBe('Hemen bir arkadaşımı bağlıyorum.');
  });

  it('nobody accepting chats: the after-hours text after it (AI-12 §4)', async () => {
    const chat = conversation();
    await chat.say('param yatmadı');
    const asked = await chat.say('müşteri temsilcisiyle görüşmek istiyorum', {
      handoffAvailable: false,
    });
    expect(asked.reply).toBe(`${HANDING_OVER}\n${DEFAULT_HANDOFF_AFTER_HOURS_TEXT.tr}`);
  });
});

describe('an upset player (AI-09 `negative_sentiment`)', () => {
  it('angry: a person at once, priority high, the reason’s words', async () => {
    const result = await conversation().say('bu ne rezalet, param yatmadı');
    expect(result.reply).toBe(DEFAULT_HANDOFF_MESSAGES.negative_sentiment.tr);
    expect(handoffOf(result.sideEffects)).toMatchObject({
      reasons: ['negative_sentiment'],
      priority: 'high',
    });
  });

  it('negative twice in a row: a person on the second; switched off: never', async () => {
    const chat = conversation();
    const once = await chat.say('param yatmadı, çok kötü');
    expect(handoffOf(once.sideEffects)).toBeNull();
    const twice = await chat.say('Papara, 12:00 — çok kötü');
    expect(reasonsOf(twice)).toEqual(['negative_sentiment']);

    const off = conversation(handoffConfig({ negative_sentiment: { enabled: false } }));
    expect(handoffOf((await off.say('bu ne rezalet, param yatmadı')).sideEffects)).toBeNull();
  });

  it('`ask_first`: the turn answers and offers a person; "evet" hands over for that reason', async () => {
    const chat = conversation(handoffConfig({ negative_sentiment: { ask_first: true } }));
    const offered = await chat.say('bu ne rezalet, çekim yapamıyorum');
    expect(offered.reply).toBe(
      `Çekim talepleri genellikle 24 saat içinde işlenir.\nSorununuz çözüldü mü?\n${HANDOFF_PHRASES.tr.offer}`,
    );
    expect(handoffOf(offered.sideEffects)).toBeNull();
    const yes = await chat.say('evet');
    expect(yes.reply).toBe(HANDING_OVER);
    expect(yes.decisions.handoffReason).toBe('negative_sentiment');
    expect(reasonsOf(yes)).toEqual(['negative_sentiment']);
  });
});

describe('turns not understood (AI-09 `not_understood`)', () => {
  it('two in a row: the no-answer asks once, the second hands over — with both reasons on record', async () => {
    const nothing = {
      procedure: {
        facts: depositFacts(),
        options: DEPOSIT_OPTIONS,
        understanding: { intent: { procedure_key: null, confidence: 0 } },
      },
    };
    const chat = conversation();
    const first = await chat.say('asdfgh qwerty', nothing);
    expect(first.reply).toBe(
      'Bu konuda size kesin bilgi veremiyorum. Sizi bir temsilcimize aktarayım mı?',
    );
    expect(chat.state.signals['handoff']).toMatchObject({ not_understood: 1 });
    const second = await chat.say('zxcvb poiuy', nothing);
    expect(second.decisions).toMatchObject({
      outcome: 'handed_off',
      handoffReasons: ['no_knowledge', 'not_understood'],
    });
  });
});

describe("the workspace's limits", () => {
  it('abuse: the warnings the workspace set, then a person (G19 · `abuse.warnings`)', async () => {
    const chat = conversation(handoffConfig({ abuse: { warnings: 1 } }));
    const warned = await chat.say('aptal mısınız, param yatmadı');
    expect(warned.reply).toMatch(/^Size yardımcı olmak istiyorum; lütfen saygılı/);
    expect(handoffOf(warned.sideEffects)).toBeNull();
    const handed = await chat.say('aptal mısınız, param yatmadı');
    expect(reasonsOf(handed)).toEqual(['abuse']);
  });

  it("max_turns: the workspace's limit when lower than the procedure's; switched off, the procedure's own", async () => {
    const short = conversation(handoffConfig({ max_turns: { turns: 2 } }));
    await short.say('param yatmadı');
    await short.say('bilmiyorum');
    const third = await short.say('hatırlamıyorum');
    expect(third.decisions.handoffReason).toBe('max_turns');
    expect(third.reply).toBe(DEFAULT_HANDOFF_MESSAGES.max_turns.tr);

    const off = conversation(handoffConfig({ max_turns: { enabled: false, turns: 2 } }));
    await off.say('param yatmadı');
    await off.say('bilmiyorum');
    // Not the turn limit: the procedure goes on to its own end — here a refused answer.
    const kept = await off.say('hatırlamıyorum');
    expect(kept.decisions.handoffReason).toBe('slot_refused');
    expect(reasonsOf(kept)).toEqual(['missing_required_info']);
  });
});

describe('the same problem again today (AI-09 `repeat_same_day`)', () => {
  const repeat: TurnState = { ...emptyTurnState(), signals: { repeat_same_day: true } };

  it('no diagnosis: what the procedure would say is not said — a person, priority high', async () => {
    const result = await conversation(undefined, repeat).say('çekim yapamıyorum');
    expect(result.reply).toBe(DEFAULT_HANDOFF_MESSAGES.repeat_same_day.tr);
    expect(handoffOf(result.sideEffects)).toMatchObject({
      reason: 'repeat_same_day',
      reasons: ['repeat_same_day'],
      priority: 'high',
    });
  });

  it('only the questions are asked, and the hand-over at the end says it is a repeat', async () => {
    const chat = conversation(undefined, repeat);
    const asked = await chat.say('param yatmadı');
    expect(asked.decisions.replyKind).toBe('question');
    expect(handoffOf(asked.sideEffects)).toBeNull();
    let last: TurnResult = asked;
    for (const text of ['Papara, 12:00', 'hayır oluşturmadım']) {
      last = await chat.say(text);
      if (handoffOf(last.sideEffects)) break;
    }
    expect(handoffOf(last.sideEffects)).toMatchObject({
      reasons: ['procedure_rule', 'repeat_same_day'],
      priority: 'high',
    });
  });

  it('switched off: the procedure runs as it always did', async () => {
    const result = await conversation(
      handoffConfig({ repeat_same_day: { enabled: false } }),
      repeat,
    ).say('çekim yapamıyorum');
    expect(result.reply).toBe(
      'Çekim talepleri genellikle 24 saat içinde işlenir.\nSorununuz çözüldü mü?',
    );
  });
});

describe('a loop (AI-09 `loop_detected`)', () => {
  it('the same message a third time: a person, not the same answer again', async () => {
    const history: TurnHistory = {
      messages: [
        { role: 'user', content: 'çekim yapamıyorum' },
        { role: 'assistant', content: 'Çekim talepleri genellikle 24 saat içinde işlenir.' },
        { role: 'user', content: 'çekim yapamıyorum' },
        { role: 'assistant', content: 'Çekim talepleri genellikle 24 saat içinde işlenir.' },
      ],
      systemNotes: [],
      stateDigest: '',
      omitted: false,
      visitorMessages: 2,
    };
    const result = await engine().runTurn(
      emptyTurnState(),
      { text: 'çekim yapamıyorum', history },
      context(),
    );
    expect(result.reply).toBe(DEFAULT_HANDOFF_MESSAGES.loop_detected.tr);
    expect(reasonsOf(result)).toEqual(['loop_detected']);
  });
});

describe("the workspace's hand-over rules (K9 · tm 303.3)", () => {
  const deposit: HandoffRuleConfig = {
    id: 'rule-deposit',
    title: 'Para yatırma',
    trigger: { type: 'topic', value: 'deposit' },
    target: { topic: 'finance' },
    priority: 'high',
  };
  const phrase: HandoffRuleConfig = {
    id: 'rule-phrase',
    title: 'Yatırım ekibi',
    trigger: { type: 'phrase', value: 'para yatır' },
    target: { group_id: 7 },
    priority: 'normal',
  };
  const withRules = (rules: HandoffRuleConfig[]): HandoffConfig => ({
    ...DEFAULT_HANDOFF_CONFIG,
    rules,
  });

  it('"Para yatırma → Finans, high" hands a deposit question over before any model is asked; off, it does not (AI-09 acceptance)', async () => {
    const result = await conversation(withRules([deposit])).say(
      'Param yatmadı, yardım eder misiniz',
    );
    expect(result.reply).toBe(DEFAULT_HANDOFF_MESSAGES.tenant_rule.tr);
    expect(result.decisions).toMatchObject({
      outcome: 'handed_off',
      handoffReasons: ['tenant_rule'],
    });
    expect(result.decisions.usage.llmInputTokens).toBe(0);
    expect(handoffOf(result.sideEffects)).toMatchObject({
      reasons: ['tenant_rule'],
      topic: 'finance',
      priority: 'high',
      ruleId: 'rule-deposit',
    });
    expect(skillDecision(result)).toMatchObject({
      decision: 'handoff',
      details: { reason_codes: ['tenant_rule'] },
    });

    // Turned off — the turn carries active rules only: the deposit procedure answers.
    const off = await conversation(withRules([])).say('Param yatmadı, yardım eder misiniz');
    expect(handoffOf(off.sideEffects)).toBeNull();
    expect(off.decisions.skillId).toBe('deposit');
  });

  it('the order decides between two rules that both match', async () => {
    const text = 'Paramı yatırdım ama görünmüyor';
    const first = await conversation(withRules([phrase, deposit])).say(text);
    expect(handoffOf(first.sideEffects)).toMatchObject({
      groupId: 7,
      priority: 'normal',
      ruleId: 'rule-phrase',
    });
    const swapped = await conversation(withRules([deposit, phrase])).say(text);
    expect(handoffOf(swapped.sideEffects)).toMatchObject({
      topic: 'finance',
      priority: 'high',
      ruleId: 'rule-deposit',
    });
  });

  it('a phrase matches whatever the case, the letters and the endings; another message passes', async () => {
    const reset: HandoffRuleConfig = {
      id: 'rule-reset',
      title: 'Şifre',
      trigger: { type: 'phrase', value: 'Şifre sıfırla' },
      target: null,
      priority: 'normal',
    };
    const hit = await conversation(withRules([reset])).say('ŞİFREMİ SIFIRLAMAK istiyorum');
    expect(reasonsOf(hit)).toEqual(['tenant_rule']);
    expect(handoffOf(hit.sideEffects)).not.toHaveProperty('groupId');
    const miss = await conversation(withRules([reset])).say('çekim yapamıyorum');
    expect(handoffOf(miss.sideEffects)).toBeNull();
  });

  it('a risk flag the conversation carries sets its rule off; another flag does not', async () => {
    const fraud: HandoffRuleConfig = {
      id: 'rule-fraud',
      title: 'Dolandırıcılık şüphesi',
      trigger: { type: 'risk_flag', value: 'fraud_suspected' },
      target: { topic: 'kyc_risk' },
      priority: 'urgent',
    };
    const flagged = await conversation(withRules([fraud])).say('çekim yapamıyorum', {
      riskFlags: ['fraud_suspected'],
    });
    expect(handoffOf(flagged.sideEffects)).toMatchObject({
      reasons: ['tenant_rule'],
      topic: 'kyc_risk',
      priority: 'urgent',
    });
    const other = await conversation(withRules([fraud])).say('çekim yapamıyorum', {
      riskFlags: ['multi_account'],
    });
    expect(handoffOf(other.sideEffects)).toBeNull();
  });

  it('a procedure rule fires when the understanding names the procedure', async () => {
    const rule: HandoffRuleConfig = {
      id: 'rule-withdrawal',
      title: 'Çekimler insana',
      trigger: { type: 'procedure', value: 'withdrawal' },
      target: { group_id: 3 },
      priority: 'normal',
    };
    const result = await conversation(withRules([rule])).say('çekim yapamıyorum');
    expect(result.decisions.outcome).toBe('handed_off');
    expect(handoffOf(result.sideEffects)).toMatchObject({
      reasons: ['tenant_rule'],
      groupId: 3,
      ruleId: 'rule-withdrawal',
    });
    // After the understanding call named it — not on the input's words.
    expect(result.decisions.log.map((line) => line.step)).toEqual(['understand', 'handoff']);
    expect(result.decisions.understood).toMatchObject({ procedure_key: 'withdrawal' });
  });

  it('the locked rules come first: a self-exclusion request with deposit words is G1, not the rule', async () => {
    const result = await conversation(withRules([deposit])).say(
      'Hesabımı kapatmak istiyorum, para yatırmayı bırakacağım',
    );
    expect(reasonsOf(result)?.[0]).toBe('guardrail_rg');
    expect(reasonsOf(result)).not.toContain('tenant_rule');
  });

  it('"AI çözemedi" routes the AI\'s own hand-over: its team and priority, the AI\'s reasons', async () => {
    const unresolved: HandoffRuleConfig = {
      id: 'rule-unresolved',
      title: 'AI çözemedi',
      trigger: { type: 'ai_unresolved', value: null },
      target: { group_id: 9 },
      priority: 'high',
    };
    const nothing = {
      procedure: {
        facts: depositFacts(),
        options: DEPOSIT_OPTIONS,
        understanding: { intent: { procedure_key: null, confidence: 0 } },
      },
    };
    const chat = conversation(withRules([unresolved]));
    await chat.say('asdfgh qwerty', nothing);
    const second = await chat.say('zxcvb poiuy', nothing);
    expect(second.decisions.handoffReasons).toEqual(['no_knowledge', 'not_understood']);
    expect(handoffOf(second.sideEffects)).toMatchObject({
      groupId: 9,
      priority: 'high',
      ruleId: 'rule-unresolved',
    });
  });

  it("a `player_request` rule routes the person asked for; the reason stays the player's", async () => {
    const asked: HandoffRuleConfig = {
      id: 'rule-asked',
      title: 'İnsan istedi',
      trigger: { type: 'player_request', value: null },
      target: { topic: 'general' },
      priority: 'normal',
    };
    const chat = conversation(withRules([asked]));
    await chat.say('param yatmadı');
    const result = await chat.say('müşteri temsilcisiyle görüşmek istiyorum');
    expect(reasonsOf(result)).toEqual(['player_request']);
    expect(handoffOf(result.sideEffects)).toMatchObject({ topic: 'general', ruleId: 'rule-asked' });
  });
});
