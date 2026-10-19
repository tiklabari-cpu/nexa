/**
 * The hand-over triggers, pure (tm 303.2 · SiyahTuş analysis AI-09): the
 * reasons a hand-over carries, its priority, its words, the understanding's
 * triggers and the end of the turn. The turns themselves, through the engine:
 * `handoff-turn.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HANDOFF_AFTER_HOURS_TEXT,
  DEFAULT_HANDOFF_MESSAGES,
  mergeHandoffMessages,
  mergeHandoffTriggers,
  readHandoffTriggers,
  scanGuardrails,
} from '@siyahtus/types';
import { NO_ANSWER_PHRASES } from '../knowledge-answer.js';
import { safeText } from '../guardrails/guardrail-turn.js';
import { emptyTurnState, type TurnDecisions, type TurnResult } from '../turn.js';
import {
  catalogueReason,
  DEFAULT_HANDOFF_CONFIG,
  effectiveMaxTurns,
  HANDOFF_PHRASES,
  handoffPriority,
  handoffWords,
  loopDetected,
  notUnderstoodTurn,
  openHandoffWatch,
  orderHandoffReasons,
  readHandoffConfig,
  readHandoffMark,
  readingOf,
  settleHandoffTurn,
  triggerHandoffTurn,
  understandVerdict,
  type HandoffConfig,
  type HandoffReading,
} from './triggers.js';

const DECIDED: TurnDecisions = {
  outcome: 'answered',
  skillId: 'skill-1',
  skillName: 'Skill',
  replyKind: 'answer',
  failure: null,
  capped: null,
  usage: { llmInputTokens: 0, llmOutputTokens: 0, embeddingTokens: 0 },
  log: [],
};

function turn(
  over: Partial<Omit<TurnResult, 'decisions'>> & { decisions?: Partial<TurnDecisions> } = {},
): TurnResult {
  return {
    reply: 'Yanıt.',
    sideEffects: [],
    nextState: { ...emptyTurnState(), counters: { turns: 1 } },
    ...over,
    decisions: { ...DECIDED, ...over.decisions },
  };
}

function handingOver(reason: string, reply: string | null = null, extra = {}): TurnResult {
  return turn({
    reply,
    decisions: { outcome: 'handed_off', replyKind: reply ? 'answer' : null },
    sideEffects: [{ kind: 'handoff', team: null, reason, ...extra }],
  });
}

function settle(
  result: TurnResult,
  over: { config?: HandoffConfig; reading?: HandoffReading; available?: boolean } = {},
): TurnResult {
  return settleHandoffTurn({
    state: emptyTurnState(),
    message: { text: 'merhaba' },
    result,
    config: over.config ?? DEFAULT_HANDOFF_CONFIG,
    watch: { ...openHandoffWatch(), reading: over.reading ?? null },
    answerIn: 'tr',
    ...(over.available !== undefined ? { available: over.available } : {}),
  });
}

const NOT_UNDERSTOOD: HandoffReading = {
  sentiment: 'neutral',
  wantsHuman: false,
  procedureKey: null,
};

describe('the reasons, the priority, the limit', () => {
  it('names every engine reason by its catalogue code', () => {
    expect(catalogueReason('guardrail_rg')).toBe('guardrail_rg');
    expect(catalogueReason('max_turns')).toBe('max_turns');
    expect(catalogueReason('slot_refused')).toBe('missing_required_info');
    expect(catalogueReason('llm_failure')).toBe('ai_failure');
    expect(catalogueReason('embedding_failure')).toBe('ai_failure');
    expect(catalogueReason('ai_cap_reached')).toBe('ai_failure');
    // A procedure's own `reason_code`, its conditions, a skill's team.
    expect(catalogueReason('no_site_request')).toBe('procedure_rule');
    expect(catalogueReason('procedure_condition')).toBe('procedure_rule');
    expect(catalogueReason(undefined)).toBe('procedure_rule');
  });

  it('keeps every reason once, most severe first — the first is the primary', () => {
    expect(
      orderHandoffReasons(['ai_failure', 'not_understood', 'player_request', 'ai_failure']),
    ).toEqual(['player_request', 'not_understood', 'ai_failure']);
  });

  it('urgent for a guardrail that says so, high for a repeat or an angry player, normal otherwise (AI-12 §3)', () => {
    expect(handoffPriority(['guardrail_self_harm'], 'urgent', false)).toBe('urgent');
    expect(handoffPriority(['procedure_rule', 'repeat_same_day'], undefined, false)).toBe('high');
    expect(handoffPriority(['negative_sentiment'], undefined, true)).toBe('high');
    expect(handoffPriority(['negative_sentiment'], undefined, false)).toBe('normal');
    expect(handoffPriority(['player_request'], 'normal', false)).toBe('normal');
  });

  it("the workspace's turn limit when it is on and lower than the procedure's own", () => {
    const on = mergeHandoffTriggers(null, { max_turns: { turns: 5 } });
    expect(effectiveMaxTurns(12, on)).toBe(5);
    expect(effectiveMaxTurns(3, on)).toBe(3);
    expect(
      effectiveMaxTurns(12, mergeHandoffTriggers(null, { max_turns: { enabled: false } })),
    ).toBe(12);
  });

  it('reads a stored row the way the API does, and none as the defaults', () => {
    expect(readHandoffConfig(null)).toBe(DEFAULT_HANDOFF_CONFIG);
    const read = readHandoffConfig({
      triggers: { abuse: { warnings: 3 } },
      messages: { ai_failure: 'Bir arkadaşım yazacak.' },
      afterHours: { text: 'Sabah 9’da döneriz.' },
    });
    expect(read.triggers.abuse.warnings).toBe(3);
    expect(read.triggers.not_understood).toEqual(readHandoffTriggers(null).not_understood);
    expect(read.messages.ai_failure).toBe('Bir arkadaşım yazacak.');
    expect(read.afterHours.text).toBe('Sabah 9’da döneriz.');
  });
});

describe('the words', () => {
  it("the workspace's message as written, else the default in the turn's language", () => {
    const config = {
      ...DEFAULT_HANDOFF_CONFIG,
      messages: mergeHandoffMessages(null, { player_request: 'Hemen bağlıyorum.' }),
    };
    expect(handoffWords(config, 'player_request', 'en')).toBe('Hemen bağlıyorum.');
    expect(handoffWords(config, 'ai_failure', 'en')).toBe(DEFAULT_HANDOFF_MESSAGES.ai_failure.en);
    expect(handoffWords(config, 'ai_failure', null)).toBe(DEFAULT_HANDOFF_MESSAGES.ai_failure.tr);
    // A persona language the defaults are not written in: its own "a person takes over".
    expect(handoffWords(config, 'ai_failure', 'de')).toBe(NO_ANSWER_PHRASES.de.handingOver);
    // No message of its own: the no-answer's sentence was said.
    expect(handoffWords(config, 'no_knowledge', 'tr')).toBeNull();
  });

  it('the fixed questions promise nothing — the output guardrails pass them', () => {
    for (const lang of ['tr', 'en'] as const) {
      for (const text of Object.values(HANDOFF_PHRASES[lang])) {
        expect(scanGuardrails(text, 'output'), text).toEqual([]);
      }
    }
  });
});

describe('the understanding’s triggers (AI-09 §2)', () => {
  const triggers = readHandoffTriggers(null);
  const base = {
    reading: { sentiment: 'neutral', wantsHuman: false, procedureKey: null } as HandoffReading,
    requested: false,
    topicKnown: false,
    mark: readHandoffMark({}),
    triggers,
    offered: false,
  };

  it('reads what a handed-in understanding says, and nothing it does not', () => {
    expect(readingOf({ intent: { procedure_key: 'deposit' } })).toEqual({
      sentiment: null,
      wantsHuman: false,
      procedureKey: 'deposit',
    });
    expect(
      readingOf({
        intent: { procedure_key: null },
        sentiment: 'angry',
        wants_human: { value: true, explicit: true },
      } as never),
    ).toEqual({ sentiment: 'angry', wantsHuman: true, procedureKey: null });
  });

  it('a person asked for with the topic known: a person now, no question', () => {
    const asked = { ...base, reading: { ...base.reading, wantsHuman: true }, topicKnown: true };
    expect(understandVerdict(asked).verdict).toEqual({
      kind: 'handoff',
      reasons: ['player_request'],
    });
  });

  it('the topic not known: one question first — asked once, then a person unconditionally (AI-09-S1)', () => {
    expect(understandVerdict({ ...base, requested: true }).verdict).toEqual({ kind: 'ask_topic' });
    const again = {
      ...base,
      requested: true,
      mark: { not_understood: 0, negative: 0, topic_asked: 1 },
    };
    expect(understandVerdict(again).verdict).toEqual({
      kind: 'handoff',
      reasons: ['player_request'],
    });
  });

  it('angry: a person at once, priority high; negative counts until `consecutive`', () => {
    const angry = understandVerdict({ ...base, reading: { ...base.reading, sentiment: 'angry' } });
    expect(angry.verdict).toEqual({ kind: 'handoff', reasons: ['negative_sentiment'] });
    expect(angry.angry).toBe(true);

    const once = understandVerdict({
      ...base,
      reading: { ...base.reading, sentiment: 'negative' },
    });
    expect(once.verdict).toEqual({ kind: 'go_on', offer: null });
    expect(once.mark.negative).toBe(1);
    const twice = understandVerdict({
      ...base,
      reading: { ...base.reading, sentiment: 'negative' },
      mark: once.mark,
    });
    expect(twice.verdict).toEqual({ kind: 'handoff', reasons: ['negative_sentiment'] });
    // A calm turn starts the count again.
    expect(understandVerdict({ ...base, mark: once.mark }).mark.negative).toBe(0);
  });

  it('`ask_first` offers a person once instead; switched off, nothing at all', () => {
    const asking = mergeHandoffTriggers(null, { negative_sentiment: { ask_first: true } });
    const angry = { ...base, reading: { ...base.reading, sentiment: 'angry' as const } };
    expect(understandVerdict({ ...angry, triggers: asking }).verdict).toEqual({
      kind: 'go_on',
      offer: 'negative_sentiment',
    });
    expect(understandVerdict({ ...angry, triggers: asking, offered: true }).verdict).toEqual({
      kind: 'handoff',
      reasons: ['negative_sentiment'],
    });
    const off = mergeHandoffTriggers(null, { negative_sentiment: { enabled: false } });
    expect(understandVerdict({ ...angry, triggers: off }).verdict).toEqual({
      kind: 'go_on',
      offer: null,
    });
  });
});

describe('the end-of-turn triggers', () => {
  it('a turn not understood: no intent, not carrying on, no answer', () => {
    const missed = {
      ...DECIDED,
      policy: { step: 6 as const, rule: 'unmatched' as const, high: 0.8, low: 0.5 },
    };
    expect(notUnderstoodTurn(NOT_UNDERSTOOD, missed)).toBe(true);
    expect(notUnderstoodTurn({ ...NOT_UNDERSTOOD, procedureKey: 'deposit' }, missed)).toBe(false);
    expect(
      notUnderstoodTurn(NOT_UNDERSTOOD, {
        ...missed,
        policy: { ...missed.policy, rule: 'continue' },
      }),
    ).toBe(false);
    expect(notUnderstoodTurn(NOT_UNDERSTOOD, DECIDED)).toBe(false);
    // No understanding call: nothing to count.
    expect(notUnderstoodTurn(null, missed)).toBeNull();
  });

  it('a loop: the question asked last asked again, or the same message a third time', () => {
    const history = (messages: Array<{ role: 'user' | 'assistant'; content: string }>) => ({
      messages,
      systemNotes: [],
      stateDigest: '',
      omitted: false,
      visitorMessages: messages.filter((entry) => entry.role === 'user').length,
    });
    expect(
      loopDetected({
        reply: 'Hangi yöntemle yatırdınız?',
        replyKind: 'question',
        text: 'bilmiyorum',
        history: history([
          { role: 'user', content: 'param yatmadı' },
          { role: 'assistant', content: 'Hangi yöntemle yatırdınız ?' },
        ]),
      }),
    ).toBe('question_repeated');
    expect(
      loopDetected({
        reply: 'Size nasıl yardımcı olabilirim?',
        replyKind: 'answer',
        text: 'MERHABA!',
        history: history([
          { role: 'user', content: 'merhaba' },
          { role: 'assistant', content: 'Size nasıl yardımcı olabilirim?' },
          { role: 'user', content: 'Merhaba' },
          { role: 'assistant', content: 'Size nasıl yardımcı olabilirim?' },
        ]),
      }),
    ).toBe('message_repeated');
    // Twice is not a loop; a different question is not either.
    expect(
      loopDetected({
        reply: 'Ne kadar yatırdınız?',
        replyKind: 'question',
        text: 'merhaba',
        history: history([
          { role: 'user', content: 'merhaba' },
          { role: 'assistant', content: 'Hangi yöntemle yatırdınız?' },
        ]),
      }),
    ).toBeNull();
    // Written again while a person had it (a hand-back): not answered each time, no loop.
    expect(
      loopDetected({
        reply: 'Yanıt.',
        replyKind: 'answer',
        text: 'iade ne zaman',
        history: history([
          { role: 'user', content: 'iade ne zaman' },
          { role: 'assistant', content: 'Yanıt.' },
          { role: 'user', content: 'iade ne zaman' },
        ]),
      }),
    ).toBeNull();
    // The AI's own words that happen to be the player's are not the player repeating.
    expect(
      loopDetected({
        reply: 'Tamam.',
        replyKind: 'answer',
        text: 'tamam',
        history: history([
          { role: 'assistant', content: 'Tamam.' },
          { role: 'user', content: 'tamam' },
          { role: 'assistant', content: 'Tamam.' },
          { role: 'user', content: 'teşekkürler' },
        ]),
      }),
    ).toBeNull();
  });
});

describe('the end of the turn: reasons, words, counts', () => {
  it('a silent hand-over says its reason’s message; its reasons and priority go with it', () => {
    const out = settle(handingOver('slot_refused'));
    expect(out.reply).toBe(DEFAULT_HANDOFF_MESSAGES.missing_required_info.tr);
    expect(out.decisions).toMatchObject({
      outcome: 'handed_off',
      replyKind: 'answer',
      handoffReasons: ['missing_required_info'],
    });
    expect(out.sideEffects).toEqual([
      {
        kind: 'handoff',
        team: null,
        reason: 'slot_refused',
        reasons: ['missing_required_info'],
        priority: 'normal',
      },
    ]);
  });

  it('a model that could not answer is no silence: ai_failure and its fixed sentence', () => {
    const failed = handingOver('llm_failure');
    const out = settle({
      ...failed,
      decisions: {
        ...failed.decisions,
        failure: {
          provider: 'llm',
          kind: 'timeout',
          transient: true,
          status: null,
          code: null,
          requestId: null,
          reason: null,
        },
      },
    });
    expect(out.reply).toBe(DEFAULT_HANDOFF_MESSAGES.ai_failure.tr);
    expect(out.decisions.handoffReasons).toEqual(['ai_failure']);
  });

  it("the workspace's message replaces the stock sentence, follows the crisis text, and leaves a procedure's own words", () => {
    const config: HandoffConfig = {
      ...DEFAULT_HANDOFF_CONFIG,
      messages: mergeHandoffMessages(null, {
        player_request: 'Hemen bir arkadaşımı bağlıyorum.',
        guardrail_self_harm: 'Yanınızdayız.',
        guardrail_output_block: 'Bir temsilci yazacak.',
        procedure_rule: 'Finans ekibimize aktarıyorum.',
      }),
    };
    expect(
      settle(handingOver('player_request', NO_ANSWER_PHRASES.tr.handingOver), { config }).reply,
    ).toBe('Hemen bir arkadaşımı bağlıyorum.');
    expect(settle(handingOver('guardrail_output_block', safeText('tr')), { config }).reply).toBe(
      'Bir temsilci yazacak.',
    );
    expect(settle(handingOver('guardrail_self_harm', 'Kriz hattı: 182'), { config }).reply).toBe(
      'Kriz hattı: 182\nYanınızdayız.',
    );
    expect(settle(handingOver('no_site_request', 'Talebinizi aldım.'), { config }).reply).toBe(
      'Talebinizi aldım.',
    );
  });

  it('a stored risk flag stays silent unless the workspace wrote a message for it', () => {
    expect(settle(handingOver('risk_flag')).reply).toBeNull();
    const config: HandoffConfig = {
      ...DEFAULT_HANDOFF_CONFIG,
      messages: mergeHandoffMessages(null, { risk_flag: 'Bir temsilci yazacak.' }),
    };
    expect(settle(handingOver('risk_flag'), { config }).reply).toBe('Bir temsilci yazacak.');
  });

  it('nobody accepting chats: the after-hours text follows (AI-12 §4)', () => {
    expect(settle(handingOver('player_request'), { available: false }).reply).toBe(
      `${DEFAULT_HANDOFF_MESSAGES.player_request.tr}\n${DEFAULT_HANDOFF_AFTER_HOURS_TEXT.tr}`,
    );
    const config: HandoffConfig = {
      ...DEFAULT_HANDOFF_CONFIG,
      afterHours: { text: 'Sabah 9’da döneriz.' },
    };
    expect(settle(handingOver('player_request'), { config, available: false }).reply).toBe(
      `${DEFAULT_HANDOFF_MESSAGES.player_request.tr}\nSabah 9’da döneriz.`,
    );
    expect(settle(handingOver('player_request'), { available: true }).reply).toBe(
      DEFAULT_HANDOFF_MESSAGES.player_request.tr,
    );
  });

  it('`turns` not understood in a row: asked once whether to hand over, then a person', () => {
    const missed = turn({
      decisions: { policy: { step: 6, rule: 'unmatched', high: 0.8, low: 0.5 } },
    });
    const first = settle(missed, { reading: NOT_UNDERSTOOD });
    expect(first.reply).toBe('Yanıt.');
    expect(first.nextState.signals['handoff']).toEqual({
      not_understood: 1,
      negative: 0,
      topic_asked: null,
    });

    const second = settleHandoffTurn({
      state: { ...emptyTurnState(), signals: first.nextState.signals },
      message: { text: 'xyz' },
      result: missed,
      config: DEFAULT_HANDOFF_CONFIG,
      watch: { ...openHandoffWatch(), reading: NOT_UNDERSTOOD },
      answerIn: 'tr',
    });
    expect(second.reply).toBe(`Yanıt.\n${HANDOFF_PHRASES.tr.offer}`);
    expect(second.decisions.replyKind).toBe('question');
    expect(second.nextState.signals['no_answer']).toEqual({ turn: 1, reason: 'not_understood' });

    // Offered once already, or the setting says not to ask: a person.
    const third = settleHandoffTurn({
      state: { ...emptyTurnState(), signals: second.nextState.signals },
      message: { text: 'xyz' },
      result: missed,
      config: DEFAULT_HANDOFF_CONFIG,
      watch: { ...openHandoffWatch(), reading: NOT_UNDERSTOOD },
      answerIn: 'tr',
    });
    expect(third.reply).toBe(DEFAULT_HANDOFF_MESSAGES.not_understood.tr);
    expect(third.decisions).toMatchObject({
      outcome: 'handed_off',
      handoffReason: 'not_understood',
      handoffReasons: ['not_understood'],
    });
  });

  it('a turn that asks whether to hand over already is that one offer — not a second question, not a hand-over', () => {
    const asking = turn({
      reply: 'Bu konuda bilgim yok. Aktarayım mı?',
      decisions: {
        replyKind: 'question',
        policy: { step: 6, rule: 'unmatched', high: 0.8, low: 0.5 },
        unanswered: { language: 'tr', category: 'other', policy: 'ask', reason: 'no_passages' },
      },
      nextState: {
        ...emptyTurnState(),
        signals: { no_answer: { turn: 1 } },
        counters: { turns: 1 },
      },
    });
    const out = settleHandoffTurn({
      state: { ...emptyTurnState(), signals: { handoff: { not_understood: 1 } } },
      message: { text: 'xyz' },
      result: asking,
      config: DEFAULT_HANDOFF_CONFIG,
      watch: { ...openHandoffWatch(), reading: NOT_UNDERSTOOD },
      answerIn: 'tr',
    });
    expect(out.reply).toBe('Bu konuda bilgim yok. Aktarayım mı?');
    expect(handoffEffects(out)).toEqual([]);
  });

  it('a hand-over for its own reason carries the count of turns not understood too', () => {
    const missedHandoff = handingOver('no_knowledge', 'Bilgim yok, aktarıyorum.');
    const out = settleHandoffTurn({
      state: { ...emptyTurnState(), signals: { handoff: { not_understood: 1 } } },
      message: { text: 'xyz' },
      result: {
        ...missedHandoff,
        decisions: {
          ...missedHandoff.decisions,
          unanswered: {
            language: 'tr',
            category: 'other',
            policy: 'handoff',
            reason: 'no_passages',
          },
        },
      },
      config: DEFAULT_HANDOFF_CONFIG,
      watch: { ...openHandoffWatch(), reading: NOT_UNDERSTOOD },
      answerIn: 'tr',
    });
    expect(out.decisions.handoffReasons).toEqual(['no_knowledge', 'not_understood']);
    expect(out.reply).toBe('Bilgim yok, aktarıyorum.');
  });

  it('a loop turns the turn into a hand-over; switched off, the turn stands', () => {
    const message = {
      text: 'merhaba',
      history: {
        messages: [
          { role: 'user' as const, content: 'merhaba' },
          { role: 'assistant' as const, content: 'Yanıt.' },
          { role: 'user' as const, content: 'merhaba' },
          { role: 'assistant' as const, content: 'Yanıt.' },
        ],
        systemNotes: [],
        stateDigest: '',
        omitted: false,
        visitorMessages: 2,
      },
    };
    const looped = settleHandoffTurn({
      state: emptyTurnState(),
      message,
      result: turn({ sideEffects: [{ kind: 'tag', tag: 'selam' }] }),
      config: DEFAULT_HANDOFF_CONFIG,
      watch: openHandoffWatch(),
      answerIn: 'tr',
    });
    expect(looped.reply).toBe(DEFAULT_HANDOFF_MESSAGES.loop_detected.tr);
    expect(looped.sideEffects).toEqual([
      { kind: 'tag', tag: 'selam' },
      {
        kind: 'handoff',
        team: null,
        reason: 'loop_detected',
        reasons: ['loop_detected'],
        priority: 'normal',
      },
    ]);
    const off = settleHandoffTurn({
      state: emptyTurnState(),
      message,
      result: turn(),
      config: {
        ...DEFAULT_HANDOFF_CONFIG,
        triggers: mergeHandoffTriggers(null, { loop_detected: { enabled: false } }),
      },
      watch: openHandoffWatch(),
      answerIn: 'tr',
    });
    expect(off.reply).toBe('Yanıt.');
  });

  it('a trigger’s hand-over turn says nothing yet and leaves the procedure where it stood', () => {
    const state = { ...emptyTurnState(), activeSkillId: 'deposit', stepId: 'tutar' };
    const out = triggerHandoffTurn(
      state,
      { text: 'x', throughSeq: 7 },
      {
        reasons: ['negative_sentiment', 'player_request'],
        detail: 'test',
        decided: {},
      },
    );
    expect(out.reply).toBeNull();
    expect(out.decisions).toMatchObject({ outcome: 'handed_off', handoffReason: 'player_request' });
    expect(out.sideEffects).toEqual([
      {
        kind: 'handoff',
        team: null,
        reason: 'player_request',
        reasons: ['player_request', 'negative_sentiment'],
      },
    ]);
    expect(out.nextState).toMatchObject({
      activeSkillId: 'deposit',
      stepId: 'tutar',
      lastProcessedEventSeq: 7,
      counters: { turns: 1 },
    });
  });
});

function handoffEffects(result: TurnResult) {
  return result.sideEffects.filter((effect) => effect.kind === 'handoff');
}
