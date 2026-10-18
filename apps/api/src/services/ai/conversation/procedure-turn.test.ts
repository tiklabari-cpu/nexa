/**
 * Procedure turns through the conversation engine (tm 296.3 · AI-03): the
 * state a turn leaves is the next turn's input, as the live adapter saves it
 * — the pinned definition and its hash, the step, the slots, the topic set
 * aside — and the message is what the steps produced, with the knowledge
 * answers and the written part filled in by the providers.
 *
 * The database a turn is handed throws when touched (a turn reads its
 * configuration from its context and writes nothing). The understanding is the
 * call's (tm 297.1), answered by the mock provider's reading
 * (`understand-mock.ts`) unless a test hands one in; the payment-method facts
 * are a fixture (#310).
 */
import { describe, expect, it } from 'vitest';
import {
  readPersona,
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
import { AiDailyCapError, type AiDailyBudget } from '../ai-daily-budget.js';
import { skillDecision } from '../decision-log.js';
import { MeteredLlm } from '../metered-llm.js';
import {
  RETRIEVAL_THRESHOLD,
  type KnowledgeSearch,
  type KnowledgeService,
} from '../knowledge-service.js';
import { LlmProviderError } from '../provider/llm-error.js';
import type { LlmCompletionRequest, LlmProvider } from '../provider/llm-provider.js';
import { MockLlmProvider } from '../provider/mock-llm-provider.js';
import { ConversationEngine } from './conversation-engine.js';
import { procedureHash } from './procedure/executor.js';
import { mockUnderstanding } from './understand-mock.js';
import { readUnderstandGrounding, type UnderstandReply } from './understand.js';
import {
  emptyTurnState,
  skillRunRecord,
  type ProcedureTurnData,
  type TenantRunner,
  type TurnContext,
  type TurnResult,
  type TurnSkill,
  type TurnState,
} from './turn.js';

const TENANT: TenantContext = { licenseId: 1n, organizationId: 'org-test' };
/** 13:50 in Istanbul. */
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

/** What the knowledge search was asked, in order. */
const searched: string[] = [];
const knowledge = {
  threshold: RETRIEVAL_THRESHOLD,
  embedQuery: async (query: string) => {
    searched.push(query);
    return { space: 'test:space', vector: '[1]', usage: { inputTokens: 3 } };
  },
  search: async (): Promise<KnowledgeSearch> => ({
    strategy: 'exact',
    chunksInScope: 1,
    chunks: [
      {
        id: 'chunk-1',
        sourceId: 'source-1',
        sourceName: 'Yatırımlar',
        text: 'Papara yatırımları 30 dakikada yansır.',
        score: 0.9,
      },
    ],
  }),
} as unknown as KnowledgeService;

function engine(llm: LlmProvider = new MockLlmProvider()): ConversationEngine {
  return new ConversationEngine({
    llm,
    maxOutputTokens: 400,
    timeoutMs: 20_000,
    maxPromptChars: 16_000,
    knowledge,
  });
}

function procedureSkill(
  id: string,
  name: string,
  procedure: Procedure,
  extra: Partial<TurnSkill> = {},
): TurnSkill {
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
    ...extra,
  };
}

function build(raw: Record<string, unknown>): Procedure {
  const result = validateProcedure(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

/** A one-turn topic: it says how withdrawals work and resolves. */
const WITHDRAWAL = build({
  when_to_use: 'Oyuncu çekim yapamadığını söylüyor.',
  examples: ['çekim yapamıyorum', 'para çekemiyorum'],
  steps: [
    { id: 'bilgi', type: 'say', template_key: 'bilgi' },
    { id: 'bitti', type: 'resolve', outcome: 'resolved' },
  ],
  templates: [{ key: 'bilgi', text: 'Çekim talepleri 24 saat içinde işlenir.' }],
});

const DEPOSIT_SKILL = procedureSkill('deposit', 'Yatırım geçmedi', depositProcedure());
const WITHDRAWAL_SKILL = procedureSkill('withdrawal', 'Çekim', WITHDRAWAL);
/** A single-message skill with no gate: it answers every message nothing else takes. */
const CATCH_ALL: TurnSkill = {
  id: 'catch-all',
  name: 'Catch-all',
  aiAgentId: 'agent-1',
  steps: [{ type: 'send_message', source: 'text', text: 'Size nasıl yardımcı olabilirim?' }],
  persona: PERSONA,
};

const FIXTURES: ProcedureTurnData = { facts: depositFacts(), options: DEPOSIT_OPTIONS };

function context(skills: TurnSkill[], overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    tenant: TENANT,
    db,
    now: NOW,
    mode: 'live',
    chatId: 'c',
    configVersionId: null,
    config: { skills },
    toolStubs: {},
    timeZone: 'Europe/Istanbul',
    procedure: FIXTURES,
    ...overrides,
  };
}

/** A conversation: each `say` runs a turn on the state the previous one left. */
function conversation(
  ai: ConversationEngine,
  skills: () => TurnSkill[],
  overrides: Partial<TurnContext> = {},
) {
  let state: TurnState = emptyTurnState();
  return {
    async say(text: string, more: Partial<TurnContext> = {}): Promise<TurnResult> {
      const result = await ai.runTurn(
        state,
        { text },
        context(skills(), { ...overrides, ...more }),
      );
      state = result.nextState;
      return result;
    },
    get state() {
      return state;
    },
    set state(next: TurnState) {
      state = next;
    },
  };
}

describe('a procedure’s first turn (AI-03 §3–§4)', () => {
  it('pins the definition with its sha256, asks the step’s questions on one line and waits', async () => {
    const chat = conversation(engine(), () => [DEPOSIT_SKILL]);
    const first = await chat.say('param yatmadı');
    expect(first.reply).toBe(
      `${DEPOSIT_TEMPLATES.giris}\nHangi yöntemle yatırım yaptınız? Saat kaçta yatırdınız?`,
    );
    expect(first.decisions).toMatchObject({
      outcome: 'answered',
      skillId: 'deposit',
      skillName: 'Yatırım geçmedi',
      replyKind: 'question',
      handoffReason: null,
    });
    expect(first.decisions.trace?.map((step) => step.step_id)).toEqual([
      'karsilama',
      'yontem_zaman',
    ]);
    const next = chat.state;
    expect(next).toMatchObject({
      activeSkillId: 'deposit',
      procedureSnapshot: {
        skill_name: 'Yatırım geçmedi',
        ai_agent_id: 'agent-1',
        locked: false,
        procedure: depositProcedure(),
      },
      procedureSnapshotHash: procedureHash(depositProcedure()),
      stepId: 'yontem_zaman',
      stepStatus: 'awaiting_answer',
      counters: { turns: 1, procedure_turns: 1, last_turn_at: NOW.toISOString() },
      suspended: null,
    });
    expect(next.digest).toMatchObject({
      procedure_key: 'deposit',
      awaiting_answer: true,
      outcome: null,
    });
  });

  it('a catch-all single-message skill does not answer a message a procedure takes; it still answers the rest (AI-05)', async () => {
    const ai = engine();
    const taken = await ai.runTurn(
      emptyTurnState(),
      { text: 'param yatmadı' },
      context([CATCH_ALL, DEPOSIT_SKILL]),
    );
    expect(taken.decisions.skillId).toBe('deposit');
    const rest = await ai.runTurn(
      emptyTurnState(),
      { text: 'merhaba' },
      context([CATCH_ALL, DEPOSIT_SKILL]),
    );
    expect(rest.decisions.skillId).toBe('catch-all');
    expect(rest.reply).toBe('Size nasıl yardımcı olabilirim?');
    expect(rest.nextState.activeSkillId).toBeNull();
  });

  it('a procedure skill whose stored definition does not pass is skipped, never fatal', async () => {
    const broken: TurnSkill = {
      ...DEPOSIT_SKILL,
      definition: { ...DEPOSIT_SKILL.definition, procedure: { steps: [] } },
    };
    const result = await engine().runTurn(
      emptyTurnState(),
      { text: 'param yatmadı' },
      context([broken]),
    );
    expect(result.decisions.skillId).toBeNull();
    expect(result.nextState).toEqual(emptyTurnState());
  });
});

describe('the §3.1 deposit procedure through the engine (AI-03 acceptance)', () => {
  it('A — the understanding reads the answer to its question; the wait is explained and the topic resolved waiting, in two turns', async () => {
    const llm = new FakeLlmProvider();
    const chat = conversation(engine(llm), () => [DEPOSIT_SKILL]);
    await chat.say('param yatmadı');
    const second = await chat.say('Papara 13:40');
    expect(second.reply).toBe(
      'Papara ile yapılan yatırımlar genellikle 30 dk içinde hesaba yansır. İşleminiz 10 dk önce yapılmış; hâlâ normal süre içinde.\n30 dk dolduğunda bakiye görünmezse bu sohbete yazın.',
    );
    expect(second.decisions).toMatchObject({ outcome: 'answered', replyKind: 'answer' });
    // Templates only: no model was asked to write anything.
    expect(llm.calls).toHaveLength(0);
    expect(chat.state).toMatchObject({
      activeSkillId: null,
      procedureSnapshot: null,
      procedureSnapshotHash: null,
      stepId: null,
      stepStatus: null,
      counters: { turns: 2 },
    });
    expect(chat.state.digest).toMatchObject({
      outcome: 'resolved_waiting',
      awaiting_answer: false,
    });
    expect((chat.state.slots['yontem'] as { display: string }).display).toBe('Papara');
  });

  it('D — six turns: every slot collected, the passive lookup logged, a hand-over to the finance topic with its reason', async () => {
    const chat = conversation(engine(), () => [DEPOSIT_SKILL]);
    const replies: Array<string | null> = [];
    for (const text of [
      'param yatmadı',
      'Papara, 12:00',
      'evet oluşturdum, kendi hesabımdan gönderdim',
      '2.500 TL',
      'ahmet77',
      'REF12345',
    ]) {
      replies.push((await chat.say(text)).reply);
    }
    const last = await Promise.resolve(chat.state);
    expect(replies.slice(1, 5)).toEqual([
      'Göndermeden önce site üzerinden yatırım talebi oluşturdunuz mu? Gönderim kendi adınıza kayıtlı hesaptan mı yapıldı?',
      'Ne kadar yatırdınız?',
      'Kullanıcı adınızı yazar mısınız?',
      'İşlemin referans numarasını paylaşır mısınız?',
    ]);
    expect(replies[5]).toBeNull();
    expect(last).toMatchObject({
      activeSkillId: 'deposit',
      stepId: 'finansa_devir',
      stepStatus: 'done',
      counters: { turns: 6, procedure_turns: 6 },
    });
    expect(last.procedureSnapshotHash).toBe(procedureHash(depositProcedure()));
    for (const slot of [
      'yontem',
      'islem_zamani',
      'talep_olusturuldu',
      'gonderen_kendisi',
      'tutar',
      'kullanici_adi',
      'referans',
    ]) {
      expect((last.slots[slot] as { status: string }).status, slot).toBe('filled');
    }
    expect(last.digest).toMatchObject({
      outcome: 'handed_off',
      handoff: { reason_codes: ['expected_time_exceeded'] },
    });
  });

  it('the hand-over turn names its reason and target for the adapter and the decision record', async () => {
    const chat = conversation(engine(), () => [DEPOSIT_SKILL]);
    let result: TurnResult | null = null;
    for (const text of ['param yatmadı', 'Papara, 12:00', 'hayır oluşturmadım']) {
      result = await chat.say(text);
    }
    // "hayır" answers both questions: no request, and not sent from their own account.
    expect(result!.decisions).toMatchObject({
      outcome: 'handed_off',
      handoffReason: 'no_site_request',
    });
    expect(result!.reply).toBe(DEPOSIT_TEMPLATES.talep_yok);
    expect(result!.sideEffects).toEqual([
      { kind: 'handoff', team: null, topic: 'finance', reason: 'no_site_request' },
    ]);
    expect(skillDecision(result!)).toMatchObject({
      decision: 'handoff',
      procedureId: 'deposit',
      handoffReason: 'no_site_request',
    });
    expect(skillRunRecord(result!.decisions)).toMatchObject({
      skillId: 'deposit',
      status: 'succeeded',
    });
  });

  it('a hand-over target by team id travels as the id', async () => {
    const byId = procedureSkill(
      'deposit',
      'Yatırım geçmedi',
      depositProcedure((raw) => {
        (raw['handoff'] as Record<string, unknown>)['target'] = { group_id: 7 };
      }),
    );
    const chat = conversation(engine(), () => [byId]);
    await chat.say('param yatmadı');
    await chat.say('Papara, 12:00');
    const third = await chat.say('hayır oluşturmadım');
    expect(third.sideEffects).toEqual([
      { kind: 'handoff', team: null, groupId: 7, reason: 'no_site_request' },
    ]);
  });
});

describe('the pinned definition (AI-03 §3 acceptance)', () => {
  it('a definition published while the conversation is under way does not reach it; a new conversation gets it', async () => {
    let skills = [DEPOSIT_SKILL];
    const ai = engine();
    const chat = conversation(ai, () => skills);
    await chat.say('param yatmadı');

    const republished = procedureSkill(
      'deposit',
      'Yatırım geçmedi',
      depositProcedure((raw) => {
        for (const template of raw['templates'] as Array<{ key: string; text: string }>) {
          if (template.key === 'normal_sure') template.text = 'YENİ: {yontem} birazdan yansır.';
          if (template.key === 'giris') template.text = 'YENİ karşılama.';
        }
      }),
    );
    skills = [republished];

    const second = await chat.say('Papara 13:40');
    expect(second.reply).toContain('genellikle 30 dk içinde hesaba yansır');
    expect(second.reply).not.toContain('YENİ');

    const fresh = await ai.runTurn(emptyTurnState(), { text: 'param yatmadı' }, context(skills));
    expect(fresh.reply).toContain('YENİ karşılama.');
    expect(fresh.nextState.procedureSnapshotHash).not.toBe(procedureHash(depositProcedure()));
  });

  it('a procedure turned off since it started still finishes on its snapshot', async () => {
    let skills: TurnSkill[] = [DEPOSIT_SKILL];
    const chat = conversation(engine(), () => skills);
    await chat.say('param yatmadı');
    skills = [WITHDRAWAL_SKILL];
    const second = await chat.say('Papara 13:40');
    expect(second.decisions.skillId).toBe('deposit');
    expect(chat.state.digest).toMatchObject({ outcome: 'resolved_waiting' });
  });
});

describe('a topic change mid-procedure (AI-03 §7 acceptance)', () => {
  it('sets the procedure aside, runs the new topic, asks "Önceki konuya dönelim mi?" and, on yes, picks up at its question', async () => {
    const chat = conversation(engine(), () => [DEPOSIT_SKILL, WITHDRAWAL_SKILL]);
    await chat.say('param yatmadı');

    const switched = await chat.say('para çekemiyorum');
    expect(switched.decisions.skillId).toBe('withdrawal');
    expect(switched.reply).toBe(
      'Çekim talepleri 24 saat içinde işlenir.\nÖnceki konuya dönelim mi?',
    );
    expect(switched.decisions.log.map((entry) => entry.detail)).toContain(
      'Yatırım geçmedi set aside for Çekim',
    );
    expect(chat.state).toMatchObject({
      activeSkillId: null,
      stepStatus: null,
      suspended: {
        skill_id: 'deposit',
        step_id: 'yontem_zaman',
        step_status: 'awaiting_answer',
        offered: true,
      },
    });

    const back = await chat.say('evet');
    expect(back.decisions.skillId).toBe('deposit');
    expect(back.reply).toBe('Hangi yöntemle yatırım yaptınız? Saat kaçta yatırdınız?');
    expect(chat.state).toMatchObject({
      activeSkillId: 'deposit',
      stepId: 'yontem_zaman',
      stepStatus: 'awaiting_answer',
      suspended: null,
    });

    const answered = await chat.say('Papara 13:40');
    expect(answered.reply).toContain('Papara ile yapılan yatırımlar');
  });

  it('the "evet" that takes a topic up again is not read as an answer to its question', async () => {
    const chat = conversation(engine(), () => [DEPOSIT_SKILL, WITHDRAWAL_SKILL]);
    await chat.say('param yatmadı');
    await chat.say('para çekemiyorum');
    // An understanding that hears the yes as the time — the words are the player's.
    const back = await chat.say('evet', {
      procedure: {
        ...FIXTURES,
        understanding: {
          intent: { procedure_key: null, confidence: 0 },
          yes_no: 'yes',
          extracted: [{ slot: 'islem_zamani', raw_text: 'evet', confidence: 0.6 }],
        },
      },
    });
    expect(back.reply).toBe('Hangi yöntemle yatırım yaptınız? Saat kaçta yatırdınız?');
    expect((chat.state.slots['islem_zamani'] as { status: string } | undefined)?.status).not.toBe(
      'invalid',
    );
  });

  it('on no, the set-aside topic is let go and the AI says so', async () => {
    const chat = conversation(engine(), () => [DEPOSIT_SKILL, WITHDRAWAL_SKILL]);
    await chat.say('param yatmadı');
    await chat.say('para çekemiyorum');
    const no = await chat.say('hayır');
    expect(no.reply).toBe('Peki. Başka bir konuda yardımcı olabileceğim bir şey var mı?');
    expect(no.decisions.skillId).toBe('deposit');
    expect(chat.state.suspended).toBeNull();
    expect(chat.state.counters).toMatchObject({ turns: 3 });
  });

  it('an answer to the waiting question is not a topic change, even when it names another topic’s words', async () => {
    const chat = conversation(engine(), () => [DEPOSIT_SKILL, WITHDRAWAL_SKILL]);
    await chat.say('param yatmadı');
    const answer = await chat.say('Papara ile 13:40, para çekemiyorum da');
    expect(answer.decisions.skillId).toBe('deposit');
    expect(chat.state.suspended).toBeNull();
  });
});

describe('the written part (AI-03 §5)', () => {
  const WRITTEN = build({
    when_to_use: 'Test.',
    examples: ['bonus nedir'],
    slots: [{ name: 'kod', label: 'Kod', type: 'text', ask: 'Bonus kodunu yazar mısınız?' }],
    steps: [
      { id: 'yasal', type: 'say', template_key: 'yasal' },
      { id: 'anlat', type: 'say', instruction: 'Bonus kurallarını kısaca anlat.' },
      { id: 'sor', type: 'collect', slots: ['kod'] },
    ],
    templates: [{ key: 'yasal', text: '18 yaş altı katılamaz.', verbatim: true }],
  });
  const skills = () => [procedureSkill('bonus', 'Bonus', WRITTEN)];

  it('one model call writes the instructions; the verbatim template and the question go out as they are', async () => {
    const llm = new FakeLlmProvider({ reply: 'Bonus çevrim şartıyla verilir.' });
    const result = await engine(llm).runTurn(
      emptyTurnState(),
      { text: 'bonus nedir' },
      context(skills()),
    );
    expect(result.reply).toBe(
      '18 yaş altı katılamaz.\nBonus çevrim şartıyla verilir.\nBonus kodunu yazar mısınız?',
    );
    expect(llm.calls).toHaveLength(1);
    const { system } = llm.calls[0]!;
    expect(system).toContain('1. Bonus kurallarını kısaca anlat.');
    expect(system).toContain('word for word');
    expect(system).toContain('> 18 yaş altı katılamaz.');
    expect(result.decisions.log).toContainEqual(
      expect.objectContaining({ step: 'anlat', ok: true }),
    );
  });

  it('the in-process stub writes the instruction itself, deterministically', async () => {
    const result = await engine().runTurn(
      emptyTurnState(),
      { text: 'bonus nedir' },
      context(skills()),
    );
    expect(result.reply).toBe(
      '18 yaş altı katılamaz.\nBonus kurallarını kısaca anlat.\nBonus kodunu yazar mısınız?',
    );
  });

  it('a model that cannot write it ends the AI’s side: nothing is said, the failure is recorded, a person is sent', async () => {
    const llm = new FakeLlmProvider({ fail: new LlmProviderError('unavailable', { status: 503 }) });
    const result = await engine(llm).runTurn(
      emptyTurnState(),
      { text: 'bonus nedir' },
      context(skills()),
    );
    expect(result.reply).toBeNull();
    expect(result.decisions).toMatchObject({
      outcome: 'handed_off',
      replyKind: null,
      failure: { provider: 'llm', kind: 'unavailable', status: 503 },
      handoffReason: null,
    });
    expect(result.sideEffects).toEqual([{ kind: 'handoff', team: null, reason: 'llm_failure' }]);
    expect(result.nextState).toMatchObject({ stepId: 'anlat', stepStatus: 'done' });
    expect(skillDecision(result)).toMatchObject({
      decision: 'handoff',
      handoffReason: 'llm_failure',
    });
    expect(skillRunRecord(result.decisions)?.status).toBe('failed');
  });

  it('after a long silence the compose call is told to greet again', async () => {
    const chat = conversation(engine(new FakeLlmProvider()), skills);
    chat.state = {
      ...emptyTurnState(),
      activeSkillId: 'bonus',
      procedureSnapshot: {
        skill_name: 'Bonus',
        ai_agent_id: 'agent-1',
        locked: false,
        procedure: WRITTEN,
      } as unknown as Record<string, unknown>,
      procedureSnapshotHash: procedureHash(WRITTEN),
      stepId: 'anlat',
      stepStatus: 'ready',
      counters: {
        turns: 1,
        procedure_turns: 1,
        last_turn_at: new Date(NOW.getTime() - 2 * 3600_000).toISOString(),
      },
    };
    const llm = new FakeLlmProvider();
    const result = await engine(llm).runTurn(chat.state, { text: 'merhaba' }, context(skills()));
    expect(result.decisions.log).toContainEqual({
      step: 'procedure',
      detail: 'the player is back after more than 30 minutes',
      ok: true,
    });
    expect(llm.calls[0]!.system).toContain('back after a long break');
  });
});

describe('the other steps and limits, through the engine', () => {
  it('answer_from_knowledge searches with the step’s hint and the message', async () => {
    searched.length = 0;
    const procedure = build({
      when_to_use: 'Test.',
      examples: ['ne kadar sürer'],
      steps: [
        { id: 'bilgi', type: 'answer_from_knowledge', query_hint: 'yatırım süresi' },
        { id: 'bitti', type: 'resolve', outcome: 'resolved' },
      ],
    });
    const result = await engine().runTurn(
      emptyTurnState(),
      { text: 'ne kadar sürer' },
      context([procedureSkill('kb', 'Bilgi', procedure)]),
    );
    expect(searched).toEqual(['yatırım süresi\nne kadar sürer']);
    expect(result.reply).toContain('Papara yatırımları 30 dakikada yansır.');
    expect(result.decisions.usage.embeddingTokens).toBe(3);
  });

  it('past max_turns the procedure hands over with reason max_turns (AI-03 acceptance)', async () => {
    const short = procedureSkill(
      'deposit',
      'Yatırım geçmedi',
      depositProcedure((raw) => {
        raw['limits'] = { max_turns: 2 };
      }),
    );
    const chat = conversation(engine(), () => [short]);
    await chat.say('param yatmadı');
    await chat.say('bilmiyorum');
    const third = await chat.say('hatırlamıyorum');
    expect(third.decisions).toMatchObject({ outcome: 'handed_off', handoffReason: 'max_turns' });
    expect(third.sideEffects).toEqual([
      { kind: 'handoff', team: null, topic: 'finance', reason: 'max_turns' },
    ]);
    expect(skillDecision(third)?.handoffReason).toBe('max_turns');
  });

  it('the tool step is skipped and logged in F1 (AI-03 acceptance)', async () => {
    const procedure = build({
      when_to_use: 'Test.',
      examples: ['bakiyem nerede'],
      slots: [
        { name: 'kullanici', label: 'Kullanıcı', type: 'username', ask: 'Kullanıcı adınız?' },
      ],
      steps: [
        {
          id: 'sorgu',
          type: 'tool',
          tool_key: 'balance_lookup',
          inputs: { user: 'kullanici' },
          active: false,
        },
        { id: 'devir', type: 'handoff', reason_code: 'needs_check' },
      ],
    });
    const result = await engine().runTurn(
      emptyTurnState(),
      { text: 'bakiyem nerede' },
      context([procedureSkill('tool', 'Bakiye', procedure)]),
    );
    expect(result.decisions.trace).toContainEqual({
      step_id: 'sorgu',
      type: 'tool',
      cond_result: null,
      detail: 'tool balance_lookup is passive in F1 — skipped',
    });
    expect(result.decisions.log).toContainEqual({
      step: 'sorgu',
      detail: 'tool balance_lookup is passive in F1 — skipped',
      ok: true,
    });
    expect(result.decisions.handoffReason).toBe('needs_check');
  });

  it('a message in a language the persona does not speak leaves the procedure where it stood', async () => {
    const turkishOnly = {
      ...DEPOSIT_SKILL,
      persona: readPersona({ tone: null, languages: ['tr'], persona: null }),
    };
    const chat = conversation(engine(), () => [turkishOnly]);
    await chat.say('param yatmadı');
    const before = chat.state;
    const english = await chat.say(
      'Hello, I would like to know when my deposit will arrive in my account please',
    );
    expect(english.reply).toBeNull();
    expect(english.decisions.outcome).toBe('skipped');
    expect(chat.state).toMatchObject({
      stepId: before.stepId,
      stepStatus: before.stepStatus,
      slots: before.slots,
      counters: { turns: 2 },
    });
  });
});

describe('the understanding call on the turn (AI-05 §3 · tm 297.1)', () => {
  const DEPOSIT_NOT_CREDITED = procedureSkill(
    'deposit_not_credited',
    'Yatırım hesaba geçmedi',
    depositProcedure((raw) => {
      raw['examples'] = [
        'param yatmadı',
        'havale attım gözükmüyor',
        'usdt gönderdim düşmedi',
        'bakiyem gelmedi',
      ];
    }),
  );
  const SELF_EXCLUSION = procedureSkill(
    'self_exclusion',
    'Kendini sınırlama',
    build({
      when_to_use: 'Oyuncu hesabını kapatmak ya da sınırlamak istiyor.',
      examples: ['hesabımı kapatın', 'kendimi sınırlamak istiyorum'],
      priority: 500,
      steps: [
        { id: 'bilgi', type: 'say', template_key: 'bilgi' },
        { id: 'devir', type: 'handoff', reason_code: 'self_exclusion' },
      ],
      templates: [{ key: 'bilgi', text: 'Talebinizi sorumlu oyun ekibine iletiyorum.' }],
    }),
    { locked: true },
  );
  /** A tenant procedure with the very same example and a smaller priority. */
  const ACCOUNT_CLOSE = procedureSkill(
    'account_close',
    'Hesap kapatma',
    build({
      when_to_use: 'Hesap kapatma.',
      examples: ['hesabımı kapatın'],
      priority: 1,
      steps: [
        { id: 'bilgi', type: 'say', template_key: 'bilgi' },
        { id: 'bitti', type: 'resolve', outcome: 'resolved' },
      ],
      templates: [{ key: 'bilgi', text: 'Hesap ayarlarından kapatabilirsiniz.' }],
    }),
  );
  const ALL = [WITHDRAWAL_SKILL, DEPOSIT_NOT_CREDITED, SELF_EXCLUSION, ACCOUNT_CLOSE];

  /** The mock's reading of the request, edited — what a model that answered might say. */
  function answer(request: LlmCompletionRequest, edit: (reply: UnderstandReply) => void): string {
    const grounding = readUnderstandGrounding(request.system);
    if (!grounding) throw new Error('not an understanding request');
    const reply = mockUnderstanding(grounding);
    edit(reply);
    return JSON.stringify(reply);
  }

  it.each(['havale attım gözükmüyor', 'usdt gönderdim düşmedi', 'bakiyem gelmedi'])(
    '“%s” starts deposit_not_credited by its examples (AI-05 acceptance, mock)',
    async (text) => {
      const result = await engine().runTurn(emptyTurnState(), { text }, context(ALL));
      expect(result.decisions.skillId).toBe('deposit_not_credited');
      expect(result.decisions.log[0]).toEqual({
        step: 'understand',
        detail: 'understood: deposit_not_credited (1)',
        ok: true,
      });
      expect(result.nextState.activeSkillId).toBe('deposit_not_credited');
      expect(skillDecision(result)?.details).toMatchObject({
        understood: {
          procedure_key: 'deposit_not_credited',
          confidence: 1,
          alternatives: [],
          language: null,
          tries: 1,
        },
      });
    },
  );

  it('“hesabımı kapatın” takes the locked self-exclusion over a tie with a smaller priority, and over a procedure in progress (AI-05 acceptance)', async () => {
    const fresh = await engine().runTurn(
      emptyTurnState(),
      { text: 'hesabımı kapatın' },
      context(ALL),
    );
    expect(fresh.decisions.skillId).toBe('self_exclusion');
    expect(fresh.reply).toBe('Talebinizi sorumlu oyun ekibine iletiyorum.');

    const chat = conversation(engine(), () => ALL);
    await chat.say('param yatmadı');
    expect(chat.state.stepStatus).toBe('awaiting_answer');
    const midway = await chat.say('hesabımı kapatın');
    expect(midway.decisions.skillId).toBe('self_exclusion');
    expect(midway.sideEffects).toContainEqual(
      expect.objectContaining({ kind: 'handoff', reason: 'self_exclusion' }),
    );
  });

  it('asks once per turn, on the fast tier, for the schema, without a temperature — the catalogue and the question in its context line', async () => {
    const llm = new FakeLlmProvider();
    const chat = conversation(engine(llm), () => ALL);
    await chat.say('param yatmadı');
    await chat.say('papara ile');
    expect(llm.understandCalls).toHaveLength(2);
    const [first, second] = llm.understandCalls;
    expect(first).toMatchObject({
      tier: 'fast',
      responseFormat: { name: 'turn_understanding' },
      maxOutputTokens: 400,
      timeoutMs: 20_000,
    });
    expect(first).not.toHaveProperty('temperature');
    const opening = readUnderstandGrounding(first!.system)!;
    expect(opening.catalogue.map((entry) => entry.key)).toEqual([
      'self_exclusion',
      'account_close',
      'deposit_not_credited',
      'withdrawal',
    ]);
    expect(opening).toMatchObject({ active: null, pending: null, slots: [], questions: [] });
    const answering = readUnderstandGrounding(second!.system)!;
    expect(answering).toMatchObject({
      message: 'papara ile',
      active: { key: 'deposit_not_credited', name: 'Yatırım hesaba geçmedi' },
      pending: { asked: ['yontem', 'islem_zamani'] },
      options: { yontem: DEPOSIT_OPTIONS['yontem'] },
      now: NOW.toISOString(),
      time_zone: 'Europe/Istanbul',
      currency: 'TRY',
    });
    expect(second!.messages.at(-1)).toEqual({ role: 'user', content: 'papara ile' });
  });

  it('an invalid reply gets one more try with the problem named, and the turn goes on; both tries are on the run', async () => {
    let tries = 0;
    const llm = new FakeLlmProvider({
      understand: (request) =>
        tries++ === 0 ? 'Bence yatırım konusu.' : answer(request, () => {}),
      understandUsage: { inputTokens: 50, outputTokens: 20 },
    });
    const result = await engine(llm).runTurn(
      emptyTurnState(),
      { text: 'param yatmadı' },
      context(ALL),
    );
    expect(llm.understandCalls).toHaveLength(2);
    expect(llm.understandCalls[1]!.system).toContain(
      'Your previous reply could not be used (it was not valid JSON).',
    );
    expect(result.decisions.skillId).toBe('deposit_not_credited');
    expect(result.decisions.log[0]!.detail).toBe(
      'understood: deposit_not_credited (1) · second try',
    );
    expect(result.decisions.usage).toEqual({
      llmInputTokens: 100,
      llmOutputTokens: 40,
      embeddingTokens: 0,
    });
    expect(result.decisions.understood).toMatchObject({ tries: 2 });
  });

  it('two invalid replies are an AI failure: nothing is said, a person is sent, the procedure stays where it stood (AI-09)', async () => {
    const chat = conversation(engine(), () => ALL);
    await chat.say('param yatmadı');
    const before = chat.state;
    const llm = new FakeLlmProvider({
      understand: (request) =>
        answer(request, (reply) => ((reply as { sentiment: string }).sentiment = 'calm')),
      understandUsage: { inputTokens: 50, outputTokens: 20 },
    });
    const result = await engine(llm).runTurn(before, { text: 'papara ile' }, context(ALL));
    expect(llm.understandCalls).toHaveLength(2);
    expect(llm.calls).toHaveLength(0);
    expect(result.reply).toBeNull();
    expect(result.decisions).toMatchObject({
      outcome: 'handed_off',
      skillId: 'deposit_not_credited',
      failure: { provider: 'llm', kind: 'no_answer', reason: 'schema' },
      capped: null,
      usage: { llmInputTokens: 100, llmOutputTokens: 40 },
      log: [
        {
          step: 'understand',
          detail: 'the model could not read the message (no_answer) — handed to a human',
          ok: false,
        },
      ],
    });
    expect(result.sideEffects).toEqual([{ kind: 'handoff', team: null, reason: 'llm_failure' }]);
    expect(result.nextState).toMatchObject({
      activeSkillId: before.activeSkillId,
      stepId: before.stepId,
      stepStatus: before.stepStatus,
      slots: before.slots,
      counters: { turns: 2 },
    });
    expect(skillDecision(result)).toMatchObject({
      decision: 'handoff',
      procedureId: 'deposit_not_credited',
      handoffReason: 'llm_failure',
      errorType: 'llm:no_answer',
    });
  });

  it('a provider failure is not retried and ends the same way, with no procedure in progress too', async () => {
    const llm = new FakeLlmProvider({ understand: new LlmProviderError('timeout') });
    const result = await engine(llm).runTurn(
      emptyTurnState(),
      { text: 'param yatmadı' },
      context(ALL),
    );
    expect(llm.understandCalls).toHaveLength(1);
    expect(result.reply).toBeNull();
    expect(result.decisions).toMatchObject({
      outcome: 'handed_off',
      skillId: null,
      failure: { provider: 'llm', kind: 'timeout' },
    });
    expect(result.sideEffects).toEqual([{ kind: 'handoff', team: null, reason: 'llm_failure' }]);
    expect(result.nextState).toEqual({ ...emptyTurnState(), counters: { turns: 1 } });
  });

  it('today’s AI cap refuses the call before any model is asked: a person is sent, no failure is filed (tm 257.8)', async () => {
    const fake = new FakeLlmProvider();
    const refusal = new AiDailyCapError('llm', 'workspace', 120);
    const budget = {
      reserve: async () => {
        throw refusal;
      },
      settle: async () => {
        throw new Error('nothing was reserved, so nothing may be settled');
      },
    } as unknown as AiDailyBudget;
    const capped = new ConversationEngine({
      llm: new MeteredLlm(fake, budget),
      maxOutputTokens: 400,
      timeoutMs: 20_000,
      maxPromptChars: 16_000,
      knowledge,
    });
    const result = await capped.runTurn(emptyTurnState(), { text: 'param yatmadı' }, context(ALL));
    expect(fake.understandCalls).toHaveLength(0);
    expect(result.reply).toBeNull();
    expect(result.decisions).toMatchObject({
      outcome: 'handed_off',
      failure: null,
      capped: refusal,
    });
    expect(result.sideEffects).toEqual([{ kind: 'handoff', team: null, reason: 'ai_cap_reached' }]);
    expect(skillDecision(result)).toMatchObject({ decision: 'cap_reached' });
  });

  it('a procedure the catalogue does not hold starts nothing; the skill that answers instead carries the call’s cost', async () => {
    const llm = new FakeLlmProvider({
      understand: (request) =>
        answer(request, (reply) => {
          reply.intent.procedure_key = 'bonus_claim';
          reply.intent.confidence = 0.99;
        }),
      understandUsage: { inputTokens: 50, outputTokens: 20 },
    });
    const result = await engine(llm).runTurn(
      emptyTurnState(),
      { text: 'bonusumu alamadım' },
      context([CATCH_ALL, ...ALL]),
    );
    expect(result.decisions.skillId).toBe('catch-all');
    expect(result.reply).toBe('Size nasıl yardımcı olabilirim?');
    expect(result.decisions.usage).toMatchObject({ llmInputTokens: 50, llmOutputTokens: 20 });
    // The record says why no procedure ran: the key was not one of the catalogue's.
    expect(skillDecision(result)?.details).toMatchObject({
      understood: { procedure_key: null, confidence: 0, tries: 1 },
    });
    expect(result.nextState.activeSkillId).toBeNull();
  });

  describe('an `ai` answer belongs to the procedure it was asked for (AI-03)', () => {
    const PAYMENT = procedureSkill(
      'payment',
      'Ödeme',
      build({
        when_to_use: 'Ödeme.',
        examples: ['para yatırdım'],
        slots: [{ name: 'tutar', label: 'Tutar', type: 'money', ask: 'Ne kadar yatırdınız?' }],
        steps: [
          { id: 'sor', type: 'collect', slots: ['tutar'] },
          {
            id: 'uyari',
            type: 'say',
            template_key: 'ucuncu',
            when: { ai: { question: 'Para başkasının hesabından mı gönderilmiş?' } },
          },
          { id: 'son', type: 'say', template_key: 'son' },
          { id: 'bitti', type: 'resolve', outcome: 'resolved' },
        ],
        templates: [
          { key: 'ucuncu', text: 'Üçüncü kişi ödemesi kabul edilmez.' },
          { key: 'son', text: 'Kontrol ediyoruz.' },
        ],
      }),
    );
    const BONUS = procedureSkill(
      'bonus',
      'Bonus',
      build({
        when_to_use: 'Bonus.',
        examples: ['bonus var mı'],
        steps: [
          {
            id: 'uyari',
            type: 'say',
            template_key: 'sart',
            when: { ai: { question: 'Oyuncu çevrimsiz bonus mu istiyor?' } },
          },
          { id: 'bilgi', type: 'say', template_key: 'bilgi' },
          { id: 'bitti', type: 'resolve', outcome: 'resolved' },
        ],
        templates: [
          { key: 'sart', text: 'Çevrimsiz bonus yoktur.' },
          { key: 'bilgi', text: 'Kampanyalar sayfasına bakın.' },
        ],
      }),
    );

    async function secondTurn(edit: (reply: UnderstandReply) => void, text: string) {
      let turn = 0;
      const llm = new FakeLlmProvider({
        understand: (request) =>
          answer(request, (reply) => {
            if (turn++ === 0) return;
            reply.ai_conditions = [{ key: 'uyari', answer: true }];
            edit(reply);
          }),
      });
      const chat = conversation(engine(llm), () => [PAYMENT, BONUS]);
      expect((await chat.say('para yatırdım')).reply).toBe('Ne kadar yatırdınız?');
      expect(readUnderstandGrounding(llm.understandCalls[0]!.system)!.questions).toEqual([]);
      const result = await chat.say(text);
      expect(readUnderstandGrounding(llm.understandCalls[1]!.system)!.questions).toEqual([
        { key: 'uyari', question: 'Para başkasının hesabından mı gönderilmiş?' },
      ]);
      return result;
    }

    it('the procedure in progress reads it', async () => {
      const result = await secondTurn((reply) => {
        reply.intent.is_continuation = true;
        reply.answers_pending_question = true;
        reply.extracted = [{ slot: 'tutar', raw_text: '500 TL', value: '500', confidence: 0.9 }];
      }, '500 TL');
      expect(result.decisions.skillId).toBe('payment');
      expect(result.reply).toBe('Üçüncü kişi ödemesi kabul edilmez.\nKontrol ediyoruz.');
    });

    it('a procedure starting on the same turn does not, whatever its step ids', async () => {
      const result = await secondTurn((reply) => {
        reply.intent.procedure_key = 'bonus';
        reply.intent.confidence = 0.95;
      }, 'bonus var mı');
      expect(result.decisions.skillId).toBe('bonus');
      // The new topic resolves and asks about the one set aside (AI-03 §7).
      expect(result.reply).toBe('Kampanyalar sayfasına bakın.\nÖnceki konuya dönelim mi?');
    });
  });
});
