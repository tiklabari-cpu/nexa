/**
 * The knowledge path through the engine (tm 298 · SiyahTuş analysis AI-06): a
 * question no procedure takes is answered from the knowledge base, cited; a
 * draft that invents a figure or cites what it was not given is written
 * again and withheld if it still does; with no answer the AI says so and
 * hands over or asks, by the question's group; and on the AI's own
 * connection no turn ends in silence.
 *
 * The database a turn is handed throws when touched; the knowledge search is
 * a stand-in that holds the passages a test gives it.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NO_ANSWER,
  readPersona,
  splitSkillProcedure,
  type AiNoAnswerSettings,
} from '@siyahtus/types';
import { FakeLlmProvider } from '../../../../test/helpers/fake-llm-provider.js';
import { depositProcedure } from '../../../../test/helpers/procedure-fixtures.js';
import type { TenantClient, TenantContext } from '../../../lib/tenant.js';
import { skillDecision } from '../decision-log.js';
import {
  RETRIEVAL_THRESHOLD,
  type KnowledgeSearch,
  type KnowledgeService,
  type RetrievedChunk,
} from '../knowledge-service.js';
import { readAnswerGrounding } from '../provider/answer-prompt.js';
import { LlmProviderError } from '../provider/llm-error.js';
import type { LlmProvider } from '../provider/llm-provider.js';
import { MockLlmProvider } from '../provider/mock-llm-provider.js';
import { ConversationEngine } from './conversation-engine.js';
import type { KnowledgeFacts } from './knowledge-answer.js';
import {
  emptyTurnState,
  tookTurn,
  type TenantRunner,
  type TurnContext,
  type TurnMessage,
  type TurnResult,
  type TurnSkill,
  type TurnState,
} from './turn.js';

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

const FAQ: RetrievedChunk = {
  id: 'chunk-faq',
  sourceId: 'source-faq',
  sourceName: 'SSS',
  text: 'Çekim talepleri genellikle 24 saat içinde işlenir.',
  score: 0.8,
};

/** A knowledge base holding `chunks`, and every query it was asked. */
function knowledgeOf(chunks: RetrievedChunk[]): KnowledgeService & { searched: string[] } {
  const searched: string[] = [];
  return {
    searched,
    threshold: RETRIEVAL_THRESHOLD,
    embedQuery: async (query: string) => {
      searched.push(query);
      return { space: 'test:space', vector: '[1]', usage: { inputTokens: 3 } };
    },
    search: async (): Promise<KnowledgeSearch> => ({
      strategy: 'exact',
      chunksInScope: chunks.length,
      chunks,
    }),
  } as unknown as KnowledgeService & { searched: string[] };
}

function engine(
  knowledge: KnowledgeService,
  llm: LlmProvider = new MockLlmProvider(),
  facts?: KnowledgeFacts,
): ConversationEngine {
  return new ConversationEngine({
    llm,
    maxOutputTokens: 400,
    timeoutMs: 20_000,
    maxPromptChars: 16_000,
    knowledge,
    ...(facts ? { facts } : {}),
  });
}

/** A procedure the messages here never select — the decision order's knowledge path. */
const { procedure: depositBody, ...depositOwn } = splitSkillProcedure(depositProcedure());
const DEPOSIT_SKILL: TurnSkill = {
  id: 'deposit',
  name: 'Yatırım geçmedi',
  aiAgentId: 'agent-1',
  steps: [],
  persona: PERSONA,
  mode: 'procedure',
  definition: { ...depositOwn, procedure: depositBody },
  locked: false,
};
/** A one-message skill for refunds, which nothing here is about. */
const REFUNDS: TurnSkill = {
  id: 'refunds',
  name: 'Refunds',
  aiAgentId: 'agent-1',
  steps: [
    { type: 'detect_intent', intent: 'refund', phrases: ['refund'] },
    { type: 'send_message', source: 'text', text: 'Refunds take a week.' },
  ],
  persona: PERSONA,
};

/** The understanding handed in: no procedure is meant. */
const NOTHING_MEANT = { intent: { procedure_key: null, confidence: 0 } };

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
    procedure: { understanding: NOTHING_MEANT },
    ...overrides,
  };
}

/** A conversation: each `say` runs a turn on the state the previous one left. */
function conversation(ai: ConversationEngine, overrides: Partial<TurnContext> = {}) {
  let state: TurnState = emptyTurnState();
  return {
    async say(text: string, more: Partial<TurnContext> = {}): Promise<TurnResult> {
      const result = await ai.runTurn(
        state,
        { text },
        context([DEPOSIT_SKILL], { ...overrides, ...more }),
      );
      state = result.nextState;
      return result;
    },
    get state() {
      return state;
    },
  };
}

/** A model that writes these knowledge answers, in order — the last one again after that. */
function freshDrafts(
  ...answers: Array<{ reply: string; grounded?: string; cited_ids?: string[] }>
) {
  let next = 0;
  return new FakeLlmProvider({
    reply: () => {
      const answer = answers[Math.min(next++, answers.length - 1)]!;
      return JSON.stringify({
        reply: answer.reply,
        grounded: answer.grounded ?? 'full',
        cited_ids: answer.cited_ids ?? ['P1'],
      });
    },
  });
}

const CANNOT_HAND_OVER =
  'Bu konuda size kesin bilgi veremiyorum. Sizi bir temsilcimize aktarıyorum.';
const CANNOT_ASK = 'Bu konuda size kesin bilgi veremiyorum. Sizi bir temsilcimize aktarayım mı?';

describe('an answer from the knowledge base (AI-06 §4–§7)', () => {
  it('answers a question no procedure takes from the passage, and the record names its source (AI-06 acceptance)', async () => {
    const knowledge = knowledgeOf([FAQ]);
    const llm = new FakeLlmProvider({ reply: FAQ.text });
    const result = await engine(knowledge, llm).runTurn(
      emptyTurnState(),
      { text: 'çekimim ne zaman işlenir?' },
      context([DEPOSIT_SKILL]),
    );

    expect(result.reply).toBe(FAQ.text);
    expect(result.decisions).toMatchObject({
      outcome: 'answered',
      replyKind: 'answer',
      skillId: null,
      policy: { step: 5, rule: 'knowledge' },
      knowledge: { grounded: 'full', cited_ids: ['chunk-faq'], source_ids: ['source-faq'] },
    });
    expect(skillDecision(result)).toMatchObject({
      decision: 'answered',
      details: { knowledge: { source_ids: ['source-faq'] } },
    });
    expect(tookTurn(result)).toBe(true);
    // The cited object, written by the default tier, with the passages labelled.
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]).toMatchObject({
      tier: 'default',
      responseFormat: { name: 'knowledge_answer' },
    });
    expect(readAnswerGrounding(llm.calls[0]!.system)).toMatchObject({
      passages: [FAQ.text],
      ids: ['P1'],
    });
  });

  it('the stub answers the same way, citing the passage it stitched', async () => {
    const result = await engine(knowledgeOf([FAQ])).runTurn(
      emptyTurnState(),
      { text: 'çekimim ne zaman işlenir?' },
      context([DEPOSIT_SKILL]),
    );
    expect(result.reply).toBe(FAQ.text);
    expect(result.decisions.knowledge?.cited_ids).toEqual(['chunk-faq']);
  });

  it('partial: the answer, and a person offered for the rest — "evet" hands over (AI-06 §7)', async () => {
    const chat = conversation(
      engine(knowledgeOf([FAQ]), freshDrafts({ reply: FAQ.text, grounded: 'partial' })),
    );
    const partial = await chat.say('çekimim ne zaman işlenir, limitim ne?');
    expect(partial.reply).toBe(
      `${FAQ.text}\nDaha fazla ayrıntı için sizi temsilcimize aktarabilirim.`,
    );
    expect(partial.decisions.knowledge).toMatchObject({ grounded: 'partial' });
    expect(chat.state.signals).toEqual({ no_answer: { turn: 1 } });

    const yes = await chat.say('evet');
    expect(yes.reply).toBe('Sizi bir temsilcimize aktarıyorum.');
    expect(yes.decisions).toMatchObject({ outcome: 'handed_off', handoffReason: 'no_knowledge' });
    expect(yes.sideEffects).toEqual([{ kind: 'handoff', team: null, reason: 'no_knowledge' }]);
  });

  it('asks the AI-13 tables before the knowledge base, and their row is the answer (AI-06 §3 · #310 seam)', async () => {
    const knowledge = knowledgeOf([FAQ]);
    const facts: KnowledgeFacts = {
      answer: async ({ message }) =>
        /papara/i.test(message)
          ? { text: 'Papara ile en az 100 TL yatırabilirsiniz.', factIds: ['row-papara'] }
          : null,
    };
    const result = await engine(knowledge, new MockLlmProvider(), facts).runTurn(
      emptyTurnState(),
      { text: 'Papara ile en az ne kadar yatırabilirim?' },
      context([DEPOSIT_SKILL]),
    );
    expect(result.reply).toBe('Papara ile en az 100 TL yatırabilirsiniz.');
    expect(knowledge.searched).toEqual([]);
  });

  it('searches a short answer with the question the AI asked before it (AI-06 §2)', async () => {
    const knowledge = knowledgeOf([FAQ]);
    const message: TurnMessage = {
      text: 'Papara',
      history: {
        messages: [
          { role: 'user', content: 'yatırım yapacağım' },
          { role: 'assistant', content: 'Memnuniyetle.\nHangi yöntemle yatırmak istersiniz?' },
        ],
        systemNotes: [],
        stateDigest: '',
        omitted: false,
        visitorMessages: 1,
      },
    };
    await engine(knowledge).runTurn(emptyTurnState(), message, context([DEPOSIT_SKILL]));
    expect(knowledge.searched).toEqual(['Hangi yöntemle yatırmak istersiniz?\nPapara']);
  });
});

describe('a draft that guesses is not sent (AI-06 §6, §11)', () => {
  it('a figure no passage gives is written again, and only the clean draft goes out (AI-06 acceptance)', async () => {
    const llm = freshDrafts(
      { reply: 'Çekim talepleri 2 saat içinde işlenir.' },
      { reply: FAQ.text },
    );
    const result = await engine(knowledgeOf([FAQ]), llm).runTurn(
      emptyTurnState(),
      { text: 'çekimim ne zaman işlenir?' },
      context([DEPOSIT_SKILL]),
    );
    expect(result.reply).toBe(FAQ.text);
    expect(llm.calls).toHaveLength(2);
    // The rewrite is told what was wrong, before the grounding — which stays readable.
    expect(llm.calls[1]!.system).toContain('figures no passage gives (2 saat)');
    expect(readAnswerGrounding(llm.calls[1]!.system)?.ids).toEqual(['P1']);
    expect(result.decisions.knowledge).toMatchObject({ grounded: 'full', drafts: 2 });
    expect(result.decisions.log.at(-1)?.detail).toContain('written again');
  });

  it('a second draft that still invents is withheld, and the player is told the AI cannot answer', async () => {
    // Hedged, so the figure is all it breaks (an unhedged time is G7's, tm 301.3).
    const llm = freshDrafts({ reply: 'Çekim talepleri genellikle 2 saat içinde işlenir.' });
    const result = await engine(knowledgeOf([FAQ]), llm).runTurn(
      emptyTurnState(),
      { text: 'çekimim ne zaman işlenir?' },
      context([DEPOSIT_SKILL]),
    );
    expect(llm.calls).toHaveLength(2);
    expect(result.reply).toBe(CANNOT_HAND_OVER);
    expect(result.decisions).toMatchObject({
      outcome: 'handed_off',
      handoffReason: 'no_knowledge',
      knowledge: { grounded: 'none', withheld: ['invented_figure'] },
      unanswered: { category: 'money', policy: 'handoff', reason: 'withheld' },
    });
    expect(JSON.stringify(result.decisions.log)).not.toContain('2 saat');
  });

  it('a citation of a passage it was not given is a broken draft too (ADR §6a.2)', async () => {
    const llm = freshDrafts({ reply: FAQ.text, cited_ids: ['P9'] }, { reply: FAQ.text });
    const result = await engine(knowledgeOf([FAQ]), llm).runTurn(
      emptyTurnState(),
      { text: 'çekimim ne zaman işlenir?' },
      context([DEPOSIT_SKILL]),
    );
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]!.system).toContain('cited passage ids that were not given');
    expect(result.reply).toBe(FAQ.text);
  });

  it('grounded "none": nothing of the reply is used (AI-06 §7)', async () => {
    const llm = freshDrafts({ reply: 'Muhtemelen 1 saat.', grounded: 'none', cited_ids: [] });
    const result = await engine(knowledgeOf([FAQ]), llm).runTurn(
      emptyTurnState(),
      { text: 'çekimim ne zaman işlenir?' },
      context([DEPOSIT_SKILL]),
    );
    expect(result.reply).toBe(CANNOT_HAND_OVER);
    expect(result.decisions.unanswered).toMatchObject({ reason: 'not_grounded' });
  });
});

describe('no answer: the AI says so, never a silence (AI-06 §8, AI-06-S1)', () => {
  it('below the threshold the model is not asked; a money question goes to a person at once', async () => {
    const llm = new FakeLlmProvider();
    const result = await engine(knowledgeOf([]), llm).runTurn(
      emptyTurnState(),
      { text: 'çekim limitim ne kadar?' },
      context([DEPOSIT_SKILL]),
    );
    expect(llm.calls).toHaveLength(0);
    expect(result.reply).toBe(CANNOT_HAND_OVER);
    expect(result.sideEffects).toEqual([{ kind: 'handoff', team: null, reason: 'no_knowledge' }]);
    expect(skillDecision(result)).toMatchObject({
      decision: 'handoff',
      handoffReason: 'no_knowledge',
      details: {
        unanswered: { category: 'money', policy: 'handoff', reason: 'no_passages', language: null },
        policy: { step: 6, rule: 'unmatched' },
      },
    });
  });

  it('anything else is asked about once: "evet" hands over, "hayır" is answered, a second miss hands over unasked', async () => {
    const ai = engine(knowledgeOf([]));
    const chat = conversation(ai);
    const asked = await chat.say('canlı casino hangi saatlerde açık?');
    expect(asked.reply).toBe(CANNOT_ASK);
    expect(asked.decisions).toMatchObject({ outcome: 'answered', replyKind: 'question' });
    expect(skillDecision(asked)?.decision).toBe('asked');
    expect(asked.sideEffects).toEqual([]);

    const no = await chat.say('hayır');
    expect(no.reply).toBe('Peki. Başka bir konuda yardımcı olabileceğim bir şey var mı?');
    expect(no.sideEffects).toEqual([]);

    // Asked once already: the next miss is a hand-over, not a second question.
    const again = await chat.say('peki turnuvalar ne zaman başlıyor?');
    expect(again.reply).toBe(CANNOT_HAND_OVER);
    expect(again.decisions.handoffReason).toBe('no_knowledge');

    const other = conversation(ai);
    await other.say('canlı casino hangi saatlerde açık?');
    const yes = await other.say('evet');
    expect(yes.reply).toBe('Sizi bir temsilcimize aktarıyorum.');
    expect(yes.sideEffects).toEqual([{ kind: 'handoff', team: null, reason: 'no_knowledge' }]);
  });

  it('a longer message after the question is a new message, read the ordinary way', async () => {
    const chat = conversation(engine(knowledgeOf([FAQ])));
    await chat.say('canlı casino hangi saatlerde açık?', {
      procedure: { understanding: NOTHING_MEANT },
    });
    const next = await chat.say('peki çekimim ne zaman işlenir?');
    expect(next.reply).toBe(FAQ.text);
  });

  it('follows the agent’s setting: its own sentence, and its policy per group (no_answer)', async () => {
    const noAnswer: AiNoAnswerSettings = {
      policy_by_category: {
        ...DEFAULT_NO_ANSWER.policy_by_category,
        money: 'ask',
        other: 'handoff',
      },
      text: 'Sizi hemen bir uzmanımıza bağlıyorum.',
    };
    const ai = engine(knowledgeOf([]));
    const money = await ai.runTurn(
      emptyTurnState(),
      { text: 'çekim limitim ne kadar?' },
      context([DEPOSIT_SKILL], { noAnswer }),
    );
    expect(money.reply).toBe(CANNOT_ASK);
    const other = await ai.runTurn(
      emptyTurnState(),
      { text: 'canlı casino hangi saatlerde açık?' },
      context([DEPOSIT_SKILL], { noAnswer }),
    );
    expect(other.reply).toBe('Sizi hemen bir uzmanımıza bağlıyorum.');
    expect(other.decisions.handoffReason).toBe('no_knowledge');
  });

  it('speaks the persona’s language', async () => {
    const english: TurnSkill = {
      ...DEPOSIT_SKILL,
      persona: readPersona({ tone: null, languages: ['en'], persona: null }),
    };
    const result = await engine(knowledgeOf([])).runTurn(
      emptyTurnState(),
      { text: 'When does the live casino open?' },
      context([english]),
    );
    expect(result.reply).toBe(
      'I can’t give you a definite answer on this. Shall I pass you to one of our agents?',
    );
  });
});

describe('the silence rule on the AI’s connection (AI-06 §9)', () => {
  it('with no procedure to decide by, the AI’s connection is answered from the knowledge base; one nobody has yet is no turn', async () => {
    const ai = engine(knowledgeOf([FAQ]));
    const theirs = await ai.runTurn(
      emptyTurnState(),
      { text: 'çekimim ne zaman işlenir?' },
      context([REFUNDS], { aiMode: 'ai' }),
    );
    expect(theirs.reply).toBe(FAQ.text);

    const nobodys = await ai.runTurn(
      emptyTurnState(),
      { text: 'çekimim ne zaman işlenir?' },
      context([REFUNDS], { aiMode: null }),
    );
    expect(nobodys.reply).toBeNull();
    expect(tookTurn(nobodys)).toBe(false);
  });

  it('a skill that ran and said nothing gets the no-answer reply, and what its steps did stays', async () => {
    const tagger: TurnSkill = {
      id: 'tagger',
      name: 'Tagger',
      aiAgentId: 'agent-1',
      steps: [
        { type: 'detect_intent', intent: 'bonus', phrases: ['bonus'] },
        { type: 'tag', tag: 'bonus-question' },
      ],
      persona: PERSONA,
    };
    const result = await engine(knowledgeOf([])).runTurn(
      emptyTurnState(),
      { text: 'bonus' },
      context([tagger], { aiMode: 'ai' }),
    );
    expect(result.reply).toBe(CANNOT_HAND_OVER);
    expect(result.decisions.skillId).toBe('tagger');
    expect(result.sideEffects).toEqual([
      { kind: 'tag', tag: 'bonus-question' },
      { kind: 'handoff', team: null, reason: 'no_knowledge' },
    ]);
    expect(result.decisions.unanswered).toMatchObject({
      category: 'bonus',
      reason: 'nothing_answered',
    });
  });

  it('a model that could not answer hands over — explicitly, not by a silence', async () => {
    const answering: TurnSkill = {
      ...REFUNDS,
      steps: [
        { type: 'detect_intent', intent: 'refund', phrases: ['refund'] },
        { type: 'send_message', source: 'knowledge' },
      ],
    };
    const llm = new FakeLlmProvider({ fail: new LlmProviderError('timeout') });
    const result = await engine(knowledgeOf([FAQ]), llm).runTurn(
      emptyTurnState(),
      { text: 'refund please' },
      context([answering], { aiMode: 'ai' }),
    );
    expect(result.reply).toBeNull();
    expect(result.decisions.outcome).toBe('handed_off');
    expect(result.sideEffects).toEqual([{ kind: 'handoff', team: null, reason: 'llm_failure' }]);
  });

  it('off the AI’s connection, a failed answer is left as it was: routing’s person has it', async () => {
    const answering: TurnSkill = {
      ...REFUNDS,
      steps: [
        { type: 'detect_intent', intent: 'refund', phrases: ['refund'] },
        { type: 'send_message', source: 'knowledge' },
      ],
    };
    const llm = new FakeLlmProvider({ fail: new LlmProviderError('timeout') });
    const result = await engine(knowledgeOf([FAQ]), llm).runTurn(
      emptyTurnState(),
      { text: 'refund please' },
      context([answering]),
    );
    expect(result.sideEffects).toEqual([]);
  });

  it('an AI with nothing to run takes no turn, even on its own connection', async () => {
    const result = await engine(knowledgeOf([FAQ])).runTurn(
      emptyTurnState(),
      { text: 'çekimim ne zaman işlenir?' },
      context([], { aiMode: 'ai' }),
    );
    expect(tookTurn(result)).toBe(false);
  });
});
