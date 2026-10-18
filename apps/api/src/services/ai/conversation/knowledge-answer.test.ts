/**
 * The knowledge answer's rules that need no provider (tm 298 · SiyahTuş
 * analysis AI-06): the draft's gate — citations and invented figures — the
 * question's group, the short "yes"/"no" to an offer of a person, the
 * `no_answer` setting as stored, and the mock's cited answer.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_NO_ANSWER, readNoAnswerSettings } from '@siyahtus/types';
import {
  inventedFigures,
  mockKnowledgeAnswer,
  noAnswerCategory,
  numberValues,
  problemDetail,
  readKnowledgeAnswer,
  readNoAnswerMark,
  readOfferAnswer,
  rewriteNote,
  type DraftProblem,
} from './knowledge-answer.js';

const NO_RISK = { intent: { procedure_key: null, confidence: 0 } };

describe('figures no passage gives (AI-06 §11)', () => {
  it('passes a figure a passage gives, in any spelling of its unit', () => {
    const sources = ['Papara yatırımları 30 dk içinde yansır; en az 100 TL, en çok 50.000 TL.'];
    expect(inventedFigures('Papara yatırımı 30 dakikada yansır.', sources)).toEqual([]);
    expect(inventedFigures('En az 100 lira, en çok 50000 TL yatırabilirsiniz.', sources)).toEqual(
      [],
    );
    expect(inventedFigures('Minimum ₺100.', sources)).toEqual([]);
  });

  it('flags a figure no passage gives, or one with another kind of unit', () => {
    const sources = ['Papara yatırımları 30 dakikada yansır.'];
    expect(inventedFigures('Papara yatırımı 45 dakikada yansır.', sources)).toEqual([
      '45 dakikada',
    ]);
    expect(inventedFigures('Papara yatırımı 30 saatte yansır.', sources)).toEqual(['30 saatte']);
    expect(inventedFigures('En az 200 TL, %5 komisyon.', sources)).toEqual(['200 tl', '%5']);
  });

  it('reads a table row’s bare number behind a reply’s figure', () => {
    expect(
      inventedFigures('En az 100 TL yatırabilirsiniz.', ['Papara | min 100 | max 50000']),
    ).toEqual([]);
  });

  it('reads percentages, multipliers and working days both ways round', () => {
    const sources = ['Çevrim şartı 30 kat; iade yüzde 10; çekim 3 iş günü sürer.'];
    expect(inventedFigures('30x çevrim, %10 iade, 3 gün.', sources)).toEqual([]);
    expect(inventedFigures('Wagering is x35.', sources)).toEqual(['x35']);
  });

  it('never takes a date or a clock time for a figure', () => {
    expect(
      inventedFigures('18.10.2026 tarihinde 14:30’da başlar, 2026-10-19’a dek sürer.', []),
    ).toEqual([]);
    // A unit word after a date or a time is not a figure's unit.
    expect(inventedFigures('Turnuva 18.10.2026 günü, 10:00 saatinde başlar.', [])).toEqual([]);
  });

  it('reads a written number both ways where its separator is ambiguous', () => {
    expect(numberValues('1.000')).toEqual([1000, 1]);
    expect(numberValues('2,5')).toEqual([2.5]);
    expect(numberValues('1.000,50')).toEqual([1000.5]);
    expect(numberValues('50.000')).toEqual([50000, 50]);
  });
});

describe('the draft’s gate (AI-06 §6)', () => {
  const given = {
    labels: ['P1', 'P2'],
    sources: ['Çekimler 24 saat içinde işlenir.', 'KYC gerekir.'],
  };

  it('keeps a grounded reply that cites what it was given', () => {
    expect(
      readKnowledgeAnswer(
        { reply: ' Çekimler 24 saatte işlenir. ', grounded: 'partial', cited_ids: ['P1'] },
        given,
      ),
    ).toEqual({
      reply: 'Çekimler 24 saatte işlenir.',
      grounded: 'partial',
      cited: ['P1'],
      problems: [],
    });
  });

  it('reads `none`, or an empty reply, as no answer and checks nothing else', () => {
    expect(
      readKnowledgeAnswer({ reply: 'Belki 5 dakika.', grounded: 'none', cited_ids: ['P9'] }, given),
    ).toEqual({ reply: '', grounded: 'none', cited: [], problems: [] });
    expect(
      readKnowledgeAnswer({ reply: '  ', grounded: 'full', cited_ids: [] }, given).grounded,
    ).toBe('none');
  });

  it('names a citation it was not given, nothing cited and an invented figure', () => {
    expect(
      readKnowledgeAnswer(
        { reply: 'Çekimler 2 saatte işlenir.', grounded: 'full', cited_ids: ['P1', 'P7'] },
        given,
      ).problems,
    ).toEqual([
      { kind: 'unknown_citation', count: 1 },
      { kind: 'invented_figure', figures: ['2 saatte'] },
    ]);
    expect(
      readKnowledgeAnswer({ reply: 'KYC gerekir.', grounded: 'full', cited_ids: [] }, given)
        .problems,
    ).toEqual([{ kind: 'uncited' }]);
  });

  it('asks the rewrite in the model’s terms, and logs counts — never the reply', () => {
    const problems = [
      { kind: 'unknown_citation', count: 1 },
      { kind: 'invented_figure', figures: ['2 saatte'] },
    ] satisfies DraftProblem[];
    expect(rewriteNote(problems)).toContain('figures no passage gives (2 saatte)');
    expect(rewriteNote(problems)).toContain('set grounded to "none"');
    expect(problemDetail(problems)).toBe(
      '1 citation(s) of a passage it was not given, 1 figure(s) no passage gives',
    );
    expect(problemDetail(problems)).not.toContain('saat');
  });
});

describe('the question’s group (AI-06-S1)', () => {
  it.each([
    ['Papara ile en az ne kadar yatırabilirim?', 'money'],
    ['çekim talebim ne zaman onaylanır', 'money'],
    ['şifremi unuttum', 'account'],
    ['hesabım neden doğrulanmadı', 'account'],
    ['hoş geldin bonusu nasıl alınır', 'bonus'],
    ['çevrim şartı ne demek', 'bonus'],
    ['kendimi oyundan uzaklaştırmak istiyorum', 'rg'],
    ['canlı casino hangi saatlerde açık', 'other'],
  ] as const)('%s → %s', (message, category) => {
    expect(noAnswerCategory(message, null)).toBe(category);
  });

  it('a responsible-gaming flag on the understanding wins over the words', () => {
    expect(
      noAnswerCategory('yatırım limitimi nasıl değiştiririm', {
        ...NO_RISK,
        risk: { rg_signal: { flag: true } },
      }),
    ).toBe('rg');
  });
});

describe('the answer to the offer of a person (AI-06 §7–§8)', () => {
  it.each([
    ['evet', 'yes'],
    ['olur lütfen', 'yes'],
    ['Yes please', 'yes'],
    ['hayır', 'no'],
    ['no thanks', 'no'],
  ] as const)('%s → %s', (text, answer) => {
    expect(readOfferAnswer(text)).toBe(answer);
  });

  it('a longer message is a new message, not an answer', () => {
    expect(readOfferAnswer('papara ile yatırdım ama hâlâ gelmedi')).toBeNull();
    expect(readOfferAnswer('canlı casino')).toBeNull();
  });

  it('keeps the offer as the turn it was made on, and ignores a malformed one', () => {
    expect(readNoAnswerMark({ no_answer: { turn: 3 } })).toEqual({ turn: 3 });
    expect(readNoAnswerMark({ no_answer: { turn: 'x' } })).toBeNull();
    expect(readNoAnswerMark({})).toBeNull();
  });
});

describe('the `no_answer` setting as stored (ai_handoff_settings.no_answer)', () => {
  it('is the defaults with nothing stored: money, account, bonus and rg at once, the rest asked', () => {
    expect(readNoAnswerSettings(null)).toEqual(DEFAULT_NO_ANSWER);
    expect(DEFAULT_NO_ANSWER.policy_by_category).toEqual({
      money: 'handoff',
      account: 'handoff',
      bonus: 'handoff',
      rg: 'handoff',
      other: 'ask',
    });
  });

  it('keeps what it knows and defaults the rest', () => {
    expect(
      readNoAnswerSettings({
        policy_by_category: { other: 'handoff', bonus: 'ask', money: 'maybe' },
        text: '  Sizi bir arkadaşıma bağlıyorum.  ',
      }),
    ).toEqual({
      policy_by_category: {
        money: 'handoff',
        account: 'handoff',
        bonus: 'ask',
        rg: 'handoff',
        other: 'handoff',
      },
      text: 'Sizi bir arkadaşıma bağlıyorum.',
    });
    expect(readNoAnswerSettings({ text: '   ' }).text).toBeNull();
    expect(readNoAnswerSettings([1, 2])).toEqual(DEFAULT_NO_ANSWER);
  });
});

describe('the mock’s cited answer (ADR §6a.6)', () => {
  const grounding = {
    passages: ['Çekimler 24 saat içinde işlenir.', 'KYC belgesi gerekir.'],
    ids: ['P1', 'P2'],
    tone: null,
    answerLength: null,
    answerIn: null,
  };

  it('stitches the passages its budget allows and cites exactly those', () => {
    expect(mockKnowledgeAnswer(grounding)).toEqual({
      reply: 'Çekimler 24 saat içinde işlenir.',
      grounded: 'full',
      cited_ids: ['P1'],
    });
    expect(mockKnowledgeAnswer({ ...grounding, answerLength: 'long' }).cited_ids).toEqual([
      'P1',
      'P2',
    ]);
  });

  it('answers nothing from nothing', () => {
    expect(mockKnowledgeAnswer({ ...grounding, passages: [], ids: [] })).toEqual({
      reply: '',
      grounded: 'none',
      cited_ids: [],
    });
  });
});
