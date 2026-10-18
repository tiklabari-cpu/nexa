/**
 * The condition evaluator (tm 296.7 · AI-03 §1): every operator on the kinds
 * it takes, nesting, the three-valued unknown (an empty slot, a stub fact, an
 * `ai` question answered `unknown`), the three functions on the tenant's clock,
 * a conditional `required`, and data the validator should have refused —
 * against conditions the save-time validator accepts.
 */
import { validateProcedure, type Cond, type SlotDef } from '@siyahtus/types';
import { describe, expect, it } from 'vitest';
import { planQuestions } from '../slots/extract.js';
import {
  NO_FACTS,
  evaluateCondition,
  fixtureFacts,
  isSlotRequired,
  zonedInstant,
  zonedMoment,
  type ProcedureEvalContext,
} from './conditions.js';

const SLOTS = [
  {
    name: 'yontem',
    label: 'Yöntem',
    type: 'enum',
    ask: 'Hangi yöntemle yatırdınız?',
    validate: { enum_source: 'payment_methods.deposit' },
  },
  { name: 'islem_zamani', label: 'İşlem zamanı', type: 'datetime', ask: 'Saat kaçta?' },
  { name: 'tutar', label: 'Tutar', type: 'money', ask: 'Ne kadar?' },
  { name: 'talep', label: 'Talep', type: 'boolean', ask: 'Sitede talep oluşturdunuz mu?' },
  { name: 'kullanici', label: 'Kullanıcı adı', type: 'text', ask: 'Kullanıcı adınız?' },
  { name: 'aciklama', label: 'Açıklama', type: 'text', ask: 'Açıklama?' },
  {
    name: 'dekont',
    label: 'Dekont',
    type: 'file',
    ask: 'Dekontu gönderir misiniz?',
    required: { when: { fact: { path: 'method.receipt_required', op: 'eq', value: true } } },
  },
];

/**
 * The conditions as one procedure — a `check` step each — through the
 * save-time validator: every condition this file evaluates is one an author
 * could have saved.
 */
function saveable(conds: readonly Cond[]): void {
  const result = validateProcedure({
    when_to_use: 'Yatırım hesaba geçmedi',
    slots: SLOTS,
    steps: [
      ...conds.map((when, i) => ({ id: `c${i}`, type: 'check', when, then: { goto: 'son' } })),
      { id: 'son', type: 'resolve', outcome: 'resolved' },
    ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problems, null, 2));
}

/** 2026-10-16 22:15 in Istanbul (UTC+3): 35 minutes after the 21:40 deposit. */
const NOW = new Date('2026-10-16T19:15:00Z');

const FILLED = {
  yontem: { value: 'Papara', display: 'Papara', status: 'filled' },
  islem_zamani: {
    value: { date: '2026-10-16', time: '21:40', time_zone: 'Europe/Istanbul' },
    display: '16.10.2026 21:40',
    status: 'filled',
  },
  tutar: { value: { amount: 2500, currency: 'TRY' }, display: '2.500 TRY', status: 'filled' },
  talep: { value: false, display: 'hayır', status: 'filled' },
  // Carried from an earlier connection today: the display alone (tm 294).
  kullanici: { display: 'Ali_34', status: 'carried' },
};

/** Papara: 30 minutes expected, 60 the delay threshold, processing 09:00–17:00 Istanbul time. */
const PAPARA = fixtureFacts({
  facts: {
    'method.name': 'Papara',
    'method.expected_minutes': 30,
    'method.delay_threshold_minutes': 60,
    'method.min_amount': 100,
    'method.max_amount': 50_000,
    'method.requires_site_request': true,
    'method.receipt_required': true,
  },
  withinWorkingHours: (at) => {
    const hour = Number(zonedMoment(at, 'Europe/Istanbul')?.time?.slice(0, 2));
    return hour >= 9 && hour < 17;
  },
  nextWindow: () => new Date('2026-10-17T06:00:00Z'),
});

function ctx(over: Partial<ProcedureEvalContext> = {}): ProcedureEvalContext {
  return { slots: FILLED, facts: PAPARA, now: NOW, timeZone: 'Europe/Istanbul', ...over };
}

function holds(cond: Cond, context = ctx()): boolean {
  return evaluateCondition(cond, context, 'c0').holds;
}

describe('each operator, on the kinds it takes', () => {
  const cases: Array<[string, Cond, boolean]> = [
    // A money slot compares by its amount.
    ['money gt', { slot: { name: 'tutar', op: 'gt', value: 2000 } }, true],
    ['money gt (equal)', { slot: { name: 'tutar', op: 'gt', value: 2500 } }, false],
    ['money gte', { slot: { name: 'tutar', op: 'gte', value: 2500 } }, true],
    ['money lt', { slot: { name: 'tutar', op: 'lt', value: 2500 } }, false],
    ['money lte', { slot: { name: 'tutar', op: 'lte', value: 2500 } }, true],
    ['money lte (below)', { slot: { name: 'tutar', op: 'lte', value: 2499.99 } }, false],
    ['money eq', { slot: { name: 'tutar', op: 'eq', value: 2500 } }, true],
    ['money neq', { slot: { name: 'tutar', op: 'neq', value: 2500 } }, false],
    ['money in', { slot: { name: 'tutar', op: 'in', value: [1000, 2500] } }, true],
    ['money in (absent)', { slot: { name: 'tutar', op: 'in', value: [1000, 2000] } }, false],
    ['money not_in', { slot: { name: 'tutar', op: 'not_in', value: [1000, 2500] } }, false],
    ['money not_in (absent)', { slot: { name: 'tutar', op: 'not_in', value: [1000] } }, true],
    // An enum option compares trimmed, in Turkish lower case.
    ['enum eq folds case', { slot: { name: 'yontem', op: 'eq', value: 'papara' } }, true],
    ['enum eq other', { slot: { name: 'yontem', op: 'eq', value: 'Havale' } }, false],
    ['enum neq', { slot: { name: 'yontem', op: 'neq', value: 'Havale' } }, true],
    ['enum in', { slot: { name: 'yontem', op: 'in', value: ['Havale', 'PAPARA'] } }, true],
    ['enum not_in', { slot: { name: 'yontem', op: 'not_in', value: ['Havale', 'EFT'] } }, true],
    ['text matches', { slot: { name: 'kullanici', op: 'matches', value: '^Ali_\\d+$' } }, true],
    ['text matches (no)', { slot: { name: 'kullanici', op: 'matches', value: '^Veli' } }, false],
    // A carried slot keeps only its display — still a text value.
    ['carried text eq', { slot: { name: 'kullanici', op: 'eq', value: 'ali_34' } }, true],
    ['boolean eq', { slot: { name: 'talep', op: 'eq', value: false } }, true],
    ['boolean neq', { slot: { name: 'talep', op: 'neq', value: false } }, false],
    ['exists (filled)', { slot: { name: 'yontem', op: 'exists' } }, true],
    ['exists (carried)', { slot: { name: 'kullanici', op: 'exists' } }, true],
    ['exists (moment)', { slot: { name: 'islem_zamani', op: 'exists' } }, true],
    ['exists (never given)', { slot: { name: 'dekont', op: 'exists' } }, false],
    ['missing (never given)', { slot: { name: 'dekont', op: 'missing' } }, true],
    ['missing (filled)', { slot: { name: 'tutar', op: 'missing' } }, false],
    // Facts.
    ['fact lt', { fact: { path: 'method.expected_minutes', op: 'lt', value: 45 } }, true],
    [
      'fact eq boolean',
      { fact: { path: 'method.requires_site_request', op: 'eq', value: true } },
      true,
    ],
    ['fact eq text', { fact: { path: 'method.name', op: 'eq', value: 'PAPARA' } }, true],
    ['fact exists', { fact: { path: 'method.delay_threshold_minutes', op: 'exists' } }, true],
    ['fact missing (no column)', { fact: { path: 'method.currency', op: 'missing' } }, true],
    // A slot against a fact, a slot against a slot.
    [
      'slot gte fact',
      { slot: { name: 'tutar', op: 'gte', value: { fact: 'method.min_amount' } } },
      true,
    ],
    [
      'slot gt fact',
      { slot: { name: 'tutar', op: 'gt', value: { fact: 'method.max_amount' } } },
      false,
    ],
    ['slot eq slot', { slot: { name: 'kullanici', op: 'eq', value: { slot: 'kullanici' } } }, true],
    ['fact eq slot', { fact: { path: 'method.name', op: 'eq', value: { slot: 'yontem' } } }, true],
    // The functions.
    [
      'elapsed_minutes gt expected',
      {
        fn: {
          name: 'elapsed_minutes',
          args: ['islem_zamani'],
          op: 'gt',
          value: { fact: 'method.expected_minutes' },
        },
      },
      true,
    ],
    [
      'elapsed_minutes eq 35',
      { fn: { name: 'elapsed_minutes', args: ['islem_zamani'], op: 'eq', value: 35 } },
      true,
    ],
    [
      'elapsed_minutes gt threshold',
      {
        fn: {
          name: 'elapsed_minutes',
          args: ['islem_zamani'],
          op: 'gt',
          value: { fact: 'method.delay_threshold_minutes' },
        },
      },
      false,
    ],
    // 21:40 Istanbul is outside 09:00–17:00.
    [
      'within_working_hours, its own answer',
      { fn: { name: 'within_working_hours', args: ['method', 'islem_zamani'] } },
      false,
    ],
    [
      'within_working_hours eq false',
      {
        fn: {
          name: 'within_working_hours',
          args: ['method', 'islem_zamani'],
          op: 'eq',
          value: false,
        },
      },
      true,
    ],
    ['next_window exists', { fn: { name: 'next_window', args: ['method'], op: 'exists' } }, true],
  ];

  it('every case is a condition the save-time validator accepts', () => {
    // In procedures of at most 30 steps (the limit is 40).
    for (let i = 0; i < cases.length; i += 30) {
      expect(() => saveable(cases.slice(i, i + 30).map(([, cond]) => cond))).not.toThrow();
    }
  });

  it.each(cases)('%s', (_name, cond, expected) => {
    const evaluation = evaluateCondition(cond, ctx(), 'c0');
    expect(evaluation).toMatchObject({ holds: expected, result: expected, unknown: [] });
    expect(evaluation.log).toEqual([]);
  });
});

describe('nesting', () => {
  // Research §3.1 branches: A wait (within expected), B outside working hours,
  // C past the threshold without a site request, D past the threshold with one.
  const branch = (minutes: number, talep: boolean, working: boolean) => ({
    a: {
      fn: {
        name: 'elapsed_minutes',
        args: ['islem_zamani'],
        op: 'lte',
        value: { fact: 'method.expected_minutes' },
      },
    },
    b: { not: { fn: { name: 'within_working_hours', args: ['method', 'islem_zamani'] } } },
    c: {
      all: [
        {
          fn: {
            name: 'elapsed_minutes',
            args: ['islem_zamani'],
            op: 'gt',
            value: { fact: 'method.delay_threshold_minutes' },
          },
        },
        {
          any: [
            { slot: { name: 'talep', op: 'eq', value: false } },
            { slot: { name: 'talep', op: 'missing' } },
          ],
        },
      ],
    },
    d: {
      all: [
        {
          fn: {
            name: 'elapsed_minutes',
            args: ['islem_zamani'],
            op: 'gt',
            value: { fact: 'method.delay_threshold_minutes' },
          },
        },
        { slot: { name: 'talep', op: 'eq', value: true } },
      ],
    },
    context: ctx({
      now: new Date(Date.parse('2026-10-16T18:40:00Z') + minutes * 60_000),
      slots: {
        ...FILLED,
        talep: { value: talep, display: talep ? 'evet' : 'hayır', status: 'filled' },
      },
      facts: fixtureFacts({
        facts: { 'method.expected_minutes': 30, 'method.delay_threshold_minutes': 60 },
        withinWorkingHours: () => working,
      }),
    }),
  });

  it('the §3.1 branch conditions are saveable', () => {
    const { a, b, c, d } = branch(0, false, true);
    expect(() => saveable([a, b, c, d] as Cond[])).not.toThrow();
  });

  it.each([
    [20, false, true, 'a'],
    [45, false, false, 'b'],
    [95, false, true, 'c'],
    [95, true, true, 'd'],
  ] as const)(
    '%i minutes, request %s, working hours %s → branch %s',
    (minutes, talep, working, expected) => {
      const { context, ...conds } = branch(minutes, talep, working);
      const taken = Object.entries(conds)
        .filter(([, cond]) => evaluateCondition(cond as Cond, context, 'c0').holds)
        .map(([key]) => key);
      expect(taken).toEqual([expected]);
    },
  );

  it('not, all and any combine to five levels', () => {
    const deep: Cond = {
      not: {
        all: [
          { any: [{ not: { slot: { name: 'yontem', op: 'eq', value: 'Havale' } } }] },
          { slot: { name: 'talep', op: 'eq', value: true } },
        ],
      },
    };
    saveable([deep]);
    // not(all[any[not(false)] = true, false]) = not(false) = true
    expect(holds(deep)).toBe(true);
  });
});

describe('unknown: what the conversation does not know counts as false, and is logged', () => {
  const empty = { slot: { name: 'aciklama', op: 'neq', value: 'x' } } as const;

  it('a comparison on a slot never given is unknown — neq is not true', () => {
    saveable([empty]);
    const evaluation = evaluateCondition(empty, ctx(), 'c0');
    expect(evaluation).toMatchObject({
      holds: false,
      result: 'unknown',
      unknown: ['slot aciklama'],
    });
    expect(evaluation.log).toEqual([
      { step: 'c0', detail: 'condition unknown (slot aciklama) — counted as false', ok: true },
    ]);
  });

  it('not keeps unknown unknown', () => {
    expect(evaluateCondition({ not: empty }, ctx(), 'c0')).toMatchObject({
      holds: false,
      result: 'unknown',
    });
  });

  it('all is false with one false part, any is true with one true part, whatever else is unknown', () => {
    const no = { slot: { name: 'talep', op: 'eq', value: true } } as const;
    const yes = { slot: { name: 'talep', op: 'eq', value: false } } as const;
    const allFalse = evaluateCondition({ all: [empty, no] }, ctx(), 'c0');
    expect(allFalse).toMatchObject({ holds: false, result: false });
    expect(allFalse.log).toEqual([]);
    expect(evaluateCondition({ any: [empty, yes] }, ctx(), 'c0')).toMatchObject({
      holds: true,
      result: true,
    });
    expect(evaluateCondition({ all: [empty, yes] }, ctx(), 'c0').result).toBe('unknown');
    expect(evaluateCondition({ any: [empty, no] }, ctx(), 'c0').result).toBe('unknown');
  });

  it('a moment given as a day alone (partial) has no elapsed minutes', () => {
    const partial = ctx({
      slots: {
        ...FILLED,
        islem_zamani: {
          value: {
            date: '2026-10-16',
            time: null,
            time_zone: 'Europe/Istanbul',
            part_of_day: 'evening',
          },
          display: '16.10.2026 akşam',
          status: 'partial',
        },
      },
    });
    const late: Cond = {
      fn: { name: 'elapsed_minutes', args: ['islem_zamani'], op: 'gt', value: 60 },
    };
    expect(evaluateCondition(late, partial, 'c0')).toMatchObject({
      holds: false,
      result: 'unknown',
      unknown: ['slot islem_zamani'],
    });
    expect(holds({ slot: { name: 'islem_zamani', op: 'exists' } }, partial)).toBe(false);
  });

  it('a settled moment without a time is unknown too — not a data fault', () => {
    const dayOnly = ctx({
      slots: {
        islem_zamani: {
          value: { date: '2026-10-16', time: null, time_zone: 'Europe/Istanbul' },
          display: '16.10.2026',
          status: 'carried',
        },
      },
    });
    const evaluation = evaluateCondition(
      { fn: { name: 'elapsed_minutes', args: ['islem_zamani'], op: 'gt', value: 60 } },
      dayOnly,
      'c0',
    );
    expect(evaluation).toMatchObject({ result: 'unknown', unknown: ['slot islem_zamani'] });
    expect(evaluation.log.every((entry) => entry.ok)).toBe(true);
  });

  it('the facts stub (until #310) knows nothing: comparisons unknown, exists false', () => {
    const stub = ctx({ facts: NO_FACTS });
    const evaluation = evaluateCondition(
      { fact: { path: 'method.expected_minutes', op: 'lt', value: 45 } },
      stub,
      'c0',
    );
    expect(evaluation).toMatchObject({
      result: 'unknown',
      unknown: ['fact method.expected_minutes'],
    });
    expect(holds({ fact: { path: 'method.expected_minutes', op: 'exists' } }, stub)).toBe(false);
    expect(holds({ fact: { path: 'method.expected_minutes', op: 'missing' } }, stub)).toBe(true);
    expect(
      evaluateCondition(
        { fn: { name: 'within_working_hours', args: ['method', 'islem_zamani'] } },
        stub,
        'c0',
      ).unknown,
    ).toEqual(['fn within_working_hours']);
    expect(holds({ fn: { name: 'next_window', args: ['method'], op: 'missing' } }, stub)).toBe(
      true,
    );
    // A slot compared with an unknown fact is unknown too.
    expect(
      evaluateCondition(
        { slot: { name: 'tutar', op: 'gte', value: { fact: 'method.min_amount' } } },
        stub,
        'c0',
      ).result,
    ).toBe('unknown');
  });

  it('an ai question reads the answer under its owner key; unknown and unanswered count as false', () => {
    const ask: Cond = { ai: { question: 'Oyuncu parayı başkasının hesabından mı göndermiş?' } };
    saveable([ask]);
    expect(evaluateCondition(ask, ctx({ aiAnswers: { c0: true } }), 'c0')).toMatchObject({
      holds: true,
      result: true,
    });
    expect(evaluateCondition(ask, ctx({ aiAnswers: { c0: false } }), 'c0')).toMatchObject({
      holds: false,
      result: false,
    });
    // Another owner's answer is not this one's.
    expect(evaluateCondition(ask, ctx({ aiAnswers: { c1: true } }), 'c0').result).toBe('unknown');
    const unsure = evaluateCondition(
      ask,
      ctx({ aiAnswers: { 'handoff.0': 'unknown' } }),
      'handoff.0',
    );
    expect(unsure).toMatchObject({ holds: false, result: 'unknown', unknown: ['ai'] });
    expect(unsure.log).toEqual([
      { step: 'handoff.0', detail: 'condition unknown (ai) — counted as false', ok: true },
    ]);
  });

  it('the log names what was unknown, never a value', () => {
    const evaluation = evaluateCondition(
      {
        all: [
          { slot: { name: 'tutar', op: 'gt', value: 2000 } },
          empty,
          { fact: { path: 'method.currency', op: 'eq', value: 'TRY' } },
        ],
      },
      ctx(),
      'c0',
    );
    expect(evaluation.unknown).toEqual(['slot aciklama', 'fact method.currency']);
    expect(JSON.stringify(evaluation.log)).not.toMatch(/2500|2\.500|Papara/);
  });
});

describe('a conditional required', () => {
  const defs = validateProcedure({
    when_to_use: 'Yatırım hesaba geçmedi',
    slots: SLOTS,
    steps: [{ id: 'sor', type: 'collect', slots: ['dekont'] }],
  });
  if (!defs.ok) throw new Error(JSON.stringify(defs.problems));
  const dekont = defs.procedure.slots.find((slot) => slot.name === 'dekont') as SlotDef;
  const always = defs.procedure.slots.find((slot) => slot.name === 'tutar') as SlotDef;

  it('always / never / when, with the condition logged under slot.<name>', () => {
    expect(isSlotRequired(always, ctx())).toBe(true);
    expect(isSlotRequired({ ...always, required: 'never' }, ctx())).toBe(false);
    expect(isSlotRequired(dekont, ctx())).toBe(true);
    const log: Array<{ step: string; detail: string; ok: boolean }> = [];
    expect(isSlotRequired(dekont, ctx({ facts: NO_FACTS }), log)).toBe(false);
    expect(log).toEqual([
      {
        step: 'slot.dekont',
        detail: 'condition unknown (fact method.receipt_required) — counted as false',
        ok: true,
      },
    ]);
  });

  it('planQuestions asks for the receipt only when the method requires one', () => {
    const ask = (context: ProcedureEvalContext) =>
      planQuestions({
        defs: [dekont],
        slots: context.slots,
        turn: 1,
        required: (def) => isSlotRequired(def, context),
      }).questions.map((q) => q.slot);
    expect(ask(ctx())).toEqual(['dekont']);
    expect(
      ask(ctx({ facts: fixtureFacts({ facts: { 'method.receipt_required': false } }) })),
    ).toEqual([]);
  });
});

describe('data the validator should have refused: unknown, logged as a fault, never a throw', () => {
  it('a fact of the wrong kind', () => {
    const evaluation = evaluateCondition(
      { fact: { path: 'method.expected_minutes', op: 'lt', value: 45 } },
      ctx({ facts: fixtureFacts({ facts: { 'method.expected_minutes': '30' } }) }),
      'c0',
    );
    expect(evaluation).toMatchObject({ holds: false, result: 'unknown' });
    expect(evaluation.log).toContainEqual({
      step: 'c0',
      detail: 'condition: fact method.expected_minutes is not a number value',
      ok: false,
    });
  });

  it.each([
    [
      'money against text',
      { slot: { name: 'tutar', op: 'eq', value: 'çok' } },
      'compares a number value with a text',
    ],
    ['lt on text', { slot: { name: 'yontem', op: 'lt', value: 3 } }, 'lt compares numbers'],
    [
      'a pattern that does not compile',
      { slot: { name: 'kullanici', op: 'matches', value: '(' } },
      'does not compile',
    ],
    [
      'two keys',
      { slot: { name: 'yontem', op: 'exists' }, fact: { path: 'method.name', op: 'exists' } },
      'malformed',
    ],
    ['an unknown function', { fn: { name: 'eval', args: ['1'] } }, 'eval is not a known function'],
    [
      'an unknown operator',
      { slot: { name: 'yontem', op: 'like', value: 'P%' } },
      'unknown operator like',
    ],
    [
      'a moment compared',
      { slot: { name: 'islem_zamani', op: 'eq', value: 'dün' } },
      'compares a moment value',
    ],
    ['not an object', 'true', 'malformed'],
  ])('%s', (_name, cond, detail) => {
    const evaluation = evaluateCondition(cond as unknown as Cond, ctx(), 'c0');
    expect(evaluation).toMatchObject({ holds: false, result: 'unknown' });
    expect(evaluation.log.some((entry) => !entry.ok && entry.detail.includes(detail))).toBe(true);
  });

  it('conditions nested past the depth limit', () => {
    let cond: Cond = { slot: { name: 'yontem', op: 'exists' } };
    for (let i = 0; i < 7; i += 1) cond = { not: cond };
    expect(evaluateCondition(cond, ctx(), 'c0').result).toBe('unknown');
  });
});

describe('moments on the tenant clock', () => {
  it('a wall-clock moment is read in its zone, across a daylight-saving change', () => {
    expect(zonedInstant('2026-10-16', '21:40', 'Europe/Istanbul')?.toISOString()).toBe(
      '2026-10-16T18:40:00.000Z',
    );
    // Berlin moves from +1 to +2 at 02:00 on 2026-03-29.
    expect(zonedInstant('2026-03-29', '01:30', 'Europe/Berlin')?.toISOString()).toBe(
      '2026-03-29T00:30:00.000Z',
    );
    expect(zonedInstant('2026-03-29', '03:30', 'Europe/Berlin')?.toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
    expect(zonedInstant('2026-10-16', '21:40', 'Mars/Olympus')).toBeNull();
    expect(zonedInstant('16.10.2026', '21:40', 'Europe/Istanbul')).toBeNull();
  });

  it('an instant on a zone wall clock', () => {
    expect(zonedMoment(new Date('2026-10-17T06:00:00Z'), 'Europe/Istanbul')).toEqual({
      date: '2026-10-17',
      time: '09:00',
      time_zone: 'Europe/Istanbul',
    });
  });

  it('elapsed minutes read the slot in its own zone; a moment a little ahead is 0', () => {
    const minutes = (time: string, timeZone: string) =>
      evaluateCondition(
        { fn: { name: 'elapsed_minutes', args: ['islem_zamani'], op: 'eq', value: 0 } },
        ctx({
          slots: {
            islem_zamani: {
              value: { date: '2026-10-16', time, time_zone: timeZone },
              status: 'filled',
            },
          },
        }),
        'c0',
      ).holds;
    expect(minutes('22:18', 'Europe/Istanbul')).toBe(true);
    // 19:15 UTC is 21:15 in Berlin — 22:15 there is still ahead; 20:15 there is an hour ago.
    expect(minutes('20:15', 'Europe/Berlin')).toBe(false);
    expect(
      holds(
        { fn: { name: 'elapsed_minutes', args: ['islem_zamani'], op: 'eq', value: 60 } },
        ctx({
          slots: {
            islem_zamani: {
              value: { date: '2026-10-16', time: '20:15', time_zone: 'Europe/Berlin' },
              status: 'filled',
            },
          },
        }),
      ),
    ).toBe(true);
  });
});
