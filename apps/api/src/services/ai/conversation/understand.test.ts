/**
 * The understanding call's pure parts (tm 297.1 · AI-05 §1, §3): the
 * catalogue it chooses among, the strict schema, the prompt and its context
 * line, and the gate a reply passes before a turn reads it. The call through
 * the engine — tries, failures, the mock's choices — is
 * `procedure-turn.test.ts`'s; the mock's reading is `understand-mock.test.ts`'s.
 */
import { describe, expect, it } from 'vitest';
import { validateProcedure, type Procedure } from '@siyahtus/types';
import { depositProcedure } from '../../../../test/helpers/procedure-fixtures.js';
import { assertStrictJsonSchema, exampleForSchema, validateJson } from '../provider/json-schema.js';
import { structuredRetryNote } from '../provider/structured-output.js';
import type { CatalogueEntry } from './procedure/understanding.js';
import {
  buildUnderstandPrompt,
  readUnderstandGrounding,
  readUnderstanding,
  understandCatalogue,
  understandGrounding,
  understoodDetail,
  UNDERSTAND_EXAMPLES_MAX,
  UNDERSTAND_MARKER,
  UNDERSTAND_RESPONSE_NAME,
  UNDERSTAND_RISKS,
  UNDERSTAND_SCHEMA,
  type UnderstandGrounding,
  type UnderstandReply,
} from './understand.js';

const NOW = new Date('2026-10-18T10:50:00Z');

function entry(key: string, extra: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return {
    key,
    name: key,
    whenToUse: `${key} için`,
    examples: [`${key} örneği`],
    priority: 100,
    locked: false,
    ...extra,
  };
}

/** A reply that passes the schema and asks for nothing. */
function reply(edit: (reply: UnderstandReply) => void = () => {}): UnderstandReply {
  const base = exampleForSchema(UNDERSTAND_SCHEMA) as UnderstandReply;
  edit(base);
  return base;
}

describe('the catalogue (AI-05 §1)', () => {
  it('keeps the brand’s procedures and those for every brand; a locked one whatever its brand (AI-14 · AI-15)', () => {
    const catalogue = understandCatalogue({
      procedures: [
        { entry: entry('ours'), brandIds: ['brand-a'] },
        { entry: entry('theirs'), brandIds: ['brand-b'] },
        { entry: entry('everyone'), brandIds: [] },
        { entry: entry('unscoped') },
        { entry: entry('self_exclusion', { locked: true }), brandIds: ['brand-b'] },
      ],
      active: null,
      brandId: 'brand-a',
    });
    expect(catalogue.map((item) => item.key)).toEqual([
      'self_exclusion',
      'everyone',
      'ours',
      'unscoped',
    ]);
  });

  it('filters nothing when the conversation’s brand is not known', () => {
    const catalogue = understandCatalogue({
      procedures: [{ entry: entry('a'), brandIds: ['brand-a'] }, { entry: entry('b') }],
      active: null,
    });
    expect(catalogue.map((item) => item.key)).toEqual(['a', 'b']);
  });

  it('always holds the active procedure: from its snapshot when unpublished, the live entry when not', () => {
    const snapshot = entry('deposit', { name: 'Yatırım (snapshot)' });
    const gone = understandCatalogue({ procedures: [], active: snapshot });
    expect(gone).toEqual([snapshot]);
    const live = understandCatalogue({
      procedures: [{ entry: entry('deposit', { name: 'Yatırım (live)' }) }],
      active: snapshot,
    });
    expect(live.map((item) => item.name)).toEqual(['Yatırım (live)']);
    // The active one is kept even for another brand.
    const elsewhere = understandCatalogue({
      procedures: [{ entry: entry('deposit'), brandIds: ['brand-b'] }],
      active: snapshot,
      brandId: 'brand-a',
    });
    expect(elsewhere.map((item) => item.name)).toEqual(['Yatırım (snapshot)']);
  });

  it(`gives each procedure at most ${UNDERSTAND_EXAMPLES_MAX} examples, the first ones, and orders locked → priority → name`, () => {
    const examples = Array.from({ length: 12 }, (_, n) => `örnek ${n + 1}`);
    const catalogue = understandCatalogue({
      procedures: [
        { entry: entry('zeta', { priority: 10 }) },
        { entry: entry('alfa', { priority: 50, examples }) },
        { entry: entry('beta', { priority: 50 }) },
        { entry: entry('kilit', { priority: 900, locked: true }) },
        { entry: entry('alfa', { priority: 1 }) },
      ],
      active: null,
    });
    expect(catalogue.map((item) => item.key)).toEqual(['kilit', 'zeta', 'alfa', 'beta']);
    expect(catalogue[2]!.examples).toEqual(examples.slice(0, UNDERSTAND_EXAMPLES_MAX));
  });
});

describe('the schema (ADR §6a.3)', () => {
  it('is in the strict subset, and its least committal object passes it', () => {
    expect(() => assertStrictJsonSchema(UNDERSTAND_RESPONSE_NAME, UNDERSTAND_SCHEMA)).not.toThrow();
    expect(validateJson(exampleForSchema(UNDERSTAND_SCHEMA), UNDERSTAND_SCHEMA)).toBeNull();
  });

  it('asks for every field of AI-05 §3, each risk with its evidence', () => {
    expect(UNDERSTAND_SCHEMA.required).toEqual([
      'language',
      'relates_to_previous',
      'wants_human',
      'intent',
      'answers_pending_question',
      'yes_no',
      'extracted',
      'correction',
      'ai_conditions',
      'sentiment',
      'abuse',
      'risk',
    ]);
    expect(UNDERSTAND_SCHEMA.properties?.['risk']?.required).toEqual([...UNDERSTAND_RISKS]);
  });

  it('refuses a confidence outside 0–1, an unknown sentiment and a yes/no that is neither', () => {
    expect(
      validateJson(
        reply((r) => (r.intent.confidence = 1.2)),
        UNDERSTAND_SCHEMA,
      ),
    ).toBe('$.intent.confidence: above 1');
    expect(
      validateJson(
        reply((r) => ((r as { sentiment: string }).sentiment = 'furious')),
        UNDERSTAND_SCHEMA,
      ),
    ).toBe('$.sentiment: not one of the enum values');
    expect(
      validateJson(
        reply((r) => ((r as { yes_no: string }).yes_no = 'maybe')),
        UNDERSTAND_SCHEMA,
      ),
    ).toBe('$.yes_no: not one of the enum values');
    expect(
      validateJson(
        reply((r) => r.intent.alternatives.push(...Array(4).fill({ key: 'a', confidence: 0.1 }))),
        UNDERSTAND_SCHEMA,
      ),
    ).toBe('$.intent.alternatives: more than 3 items');
  });
});

describe('the prompt and its context line', () => {
  const procedure: Procedure = depositProcedure();
  const grounding = understandGrounding({
    message: 'papara ile',
    catalogue: [entry('deposit', { examples: ['param yatmadı'] })],
    active: { key: 'deposit', name: 'Yatırım geçmedi', procedure },
    pending: {
      defs: procedure.slots as never,
      slots: {
        islem_zamani: {
          status: 'partial',
          value: { date: '2026-10-18', time: null, time_zone: 'Europe/Istanbul' },
        },
        yontem: { status: 'invalid', value: null },
      },
      asked: ['yontem', 'islem_zamani'],
      key: 'deposit',
    },
    options: { yontem: [{ value: 'Papara' }], unrelated: [{ value: 'x' }] },
    now: NOW,
    timeZone: 'Europe/Istanbul',
    currency: 'TRY',
  });

  it('carries the catalogue, the active procedure’s slots and the question it waits on', () => {
    expect(grounding).toMatchObject({
      message: 'papara ile',
      catalogue: [
        {
          key: 'deposit',
          name: 'deposit',
          when_to_use: 'deposit için',
          examples: ['param yatmadı'],
          locked: false,
        },
      ],
      active: { key: 'deposit', name: 'Yatırım geçmedi' },
      pending: {
        asked: ['yontem', 'islem_zamani'],
        // Only a partial value travels: what a later message may complete.
        partial: { islem_zamani: { date: '2026-10-18', time: null } },
      },
      options: { yontem: [{ value: 'Papara' }] },
      now: NOW.toISOString(),
      time_zone: 'Europe/Istanbul',
      currency: 'TRY',
    });
    expect(grounding.slots.map((slot) => slot.name)).toEqual(procedure.slots.map((s) => s.name));
    expect(Object.keys(grounding.options)).toEqual(['yontem']);
  });

  it('lists the active procedure’s `ai` questions by their keys, and none without one (AI-03)', () => {
    const asking = validateProcedure({
      when_to_use: 'x',
      examples: ['x'],
      steps: [
        {
          id: 'uyari',
          type: 'say',
          instruction: 'Üçüncü kişi kuralını anlat.',
          when: { ai: { question: 'Para başkasının hesabından mı gönderilmiş?' } },
        },
      ],
    });
    if (!asking.ok) throw new Error('fixture');
    const turn = {
      message: 'm',
      catalogue: [],
      pending: null,
      now: NOW,
      timeZone: 'Europe/Istanbul',
      currency: 'TRY',
    };
    const withQuestion = understandGrounding({
      ...turn,
      active: { key: 'k', name: 'n', procedure: asking.procedure },
    });
    expect(withQuestion.questions).toEqual([
      { key: 'uyari', question: 'Para başkasının hesabından mı gönderilmiş?' },
    ]);
    const without = understandGrounding({ ...turn, active: null });
    expect(without).toMatchObject({ slots: [], questions: [], pending: null, active: null });
  });

  it('ends with the marker and the context line, which reads back as written', () => {
    const prompt = buildUnderstandPrompt({ grounding });
    const lines = prompt.system.split('\n');
    expect(lines.at(-2)).toBe(UNDERSTAND_MARKER);
    expect(readUnderstandGrounding(prompt.system)).toEqual(grounding);
    expect(prompt.messages).toEqual([{ role: 'user', content: 'papara ile' }]);
  });

  it('puts the earlier exchange before the message, merged into a trailing visitor turn', () => {
    const prompt = buildUnderstandPrompt({
      grounding,
      history: {
        messages: [
          { role: 'user', content: 'param yatmadı' },
          { role: 'assistant', content: 'Hangi yöntemle yatırım yaptınız?' },
          { role: 'user', content: 'bir saniye' },
        ],
        systemNotes: [],
        stateDigest: '',
      },
    });
    expect(prompt.messages).toEqual([
      { role: 'user', content: 'param yatmadı' },
      { role: 'assistant', content: 'Hangi yöntemle yatırım yaptınız?' },
      { role: 'user', content: 'bir saniye\npapara ile' },
    ]);
    expect(prompt.system).toContain('The earlier messages of this conversation come before');
  });

  it('still reads back on the second try, whose note the structured gate appends below it', () => {
    const { system } = buildUnderstandPrompt({ grounding });
    expect(
      readUnderstandGrounding(`${system}\n\n${structuredRetryNote('it was not valid JSON')}`),
    ).toEqual(grounding);
  });

  it('is not read from any other prompt, nor from a broken line', () => {
    expect(readUnderstandGrounding('no marker here\n{}')).toBeNull();
    expect(readUnderstandGrounding(`${UNDERSTAND_MARKER}\nnot json`)).toBeNull();
    expect(readUnderstandGrounding(`x\n${UNDERSTAND_MARKER}\n{"message":1}`)).toBeNull();
    const bad: Partial<UnderstandGrounding> = { ...grounding, now: 'yesterday' };
    expect(readUnderstandGrounding(`x\n${UNDERSTAND_MARKER}\n${JSON.stringify(bad)}`)).toBeNull();
  });
});

describe('the reply, read against the turn (ADR §6a.2)', () => {
  const grounding = {
    message: 'Hesabımı kapatın, artık oynamak istemiyorum',
    catalogue: [
      { key: 'deposit', name: 'd', when_to_use: '', examples: [], locked: false },
      { key: 'self_exclusion', name: 's', when_to_use: '', examples: [], locked: true },
    ],
    questions: [{ key: 'uyari', question: 'q' }],
  };

  it('passes a reply about the catalogue as it is', () => {
    const { understanding, dropped } = readUnderstanding(
      reply((r) => {
        r.language = 'TR';
        r.intent = {
          procedure_key: 'self_exclusion',
          confidence: 0.92,
          alternatives: [{ key: 'deposit', confidence: 0.1 }],
          is_continuation: false,
          smalltalk: false,
          off_topic: false,
        };
        r.ai_conditions = [{ key: 'uyari', answer: false }];
        r.risk.self_exclusion = { flag: true, evidence_quote: '"hesabımı kapatın"' };
        r.sentiment = 'negative';
      }),
      grounding,
    );
    expect(dropped).toEqual([]);
    expect(understanding).toMatchObject({
      language: 'tr',
      intent: {
        procedure_key: 'self_exclusion',
        confidence: 0.92,
        alternatives: [{ key: 'deposit', confidence: 0.1 }],
      },
      ai_conditions: { uyari: false },
      sentiment: 'negative',
    });
    expect(understanding.risk.self_exclusion).toEqual({
      flag: true,
      evidence_quote: '"hesabımı kapatın"',
    });
  });

  it('drops a procedure key the catalogue does not hold — no key, no confidence — and such alternatives', () => {
    const { understanding, dropped } = readUnderstanding(
      reply((r) => {
        r.intent.procedure_key = 'bonus';
        r.intent.confidence = 0.95;
        r.intent.alternatives = [
          { key: 'casino', confidence: 0.4 },
          { key: 'deposit', confidence: 0.3 },
          { key: 'self_exclusion', confidence: 0.5 },
          { key: 'deposit', confidence: 0.2 },
        ];
      }),
      grounding,
    );
    expect(understanding.intent).toMatchObject({
      procedure_key: null,
      confidence: 0,
      // Known keys only, once each, the surer first.
      alternatives: [
        { key: 'self_exclusion', confidence: 0.5 },
        { key: 'deposit', confidence: 0.3 },
      ],
    });
    expect(dropped).toEqual([
      'intent.procedure_key is not in the catalogue',
      'an intent.alternatives key is not in the catalogue',
    ]);
  });

  it('does not repeat the choice among its alternatives', () => {
    const { understanding } = readUnderstanding(
      reply((r) => {
        r.intent.procedure_key = 'deposit';
        r.intent.confidence = 0.8;
        r.intent.alternatives = [{ key: 'deposit', confidence: 0.8 }];
      }),
      grounding,
    );
    expect(understanding.intent.alternatives).toEqual([]);
  });

  it('keeps `ai` answers only for questions it was asked, keyed', () => {
    const { understanding, dropped } = readUnderstanding(
      reply((r) => {
        r.ai_conditions = [
          { key: 'uyari', answer: null },
          { key: 'handoff.0', answer: true },
        ];
      }),
      grounding,
    );
    expect(understanding.ai_conditions).toEqual({ uyari: null });
    expect(dropped).toEqual(['an ai_conditions key was not asked']);
  });

  it('drops an evidence quote the player did not write, keeps the flag, and cuts a long one', () => {
    const { understanding, dropped } = readUnderstanding(
      reply((r) => {
        r.risk.rg_signal = { flag: true, evidence_quote: 'kumar borcum var' };
        r.risk.self_exclusion = { flag: true, evidence_quote: `  ${grounding.message}  ` };
      }),
      { ...grounding, message: `${grounding.message} ${'ve '.repeat(100)}` },
    );
    expect(understanding.risk.rg_signal).toEqual({ flag: true, evidence_quote: null });
    expect(understanding.risk.self_exclusion.evidence_quote).toBe(grounding.message);
    expect(dropped).toEqual(['risk.rg_signal.evidence_quote is not in the message']);

    const long = readUnderstanding(
      reply((r) => (r.risk.complaint_formal = { flag: true, evidence_quote: 've '.repeat(100) })),
      { ...grounding, message: 've '.repeat(100) },
    );
    expect(long.understanding.risk.complaint_formal.evidence_quote).toHaveLength(200);
  });

  it('reads a language that is not a code as unknown', () => {
    const { understanding, dropped } = readUnderstanding(
      reply((r) => (r.language = 'Turkish')),
      grounding,
    );
    expect(understanding.language).toBeNull();
    expect(dropped).toEqual(['language is not a code']);
  });

  it('says in one line what it understood, never the player’s words', () => {
    const { understanding } = readUnderstanding(
      reply((r) => {
        r.language = 'tr';
        r.intent.procedure_key = 'deposit';
        r.intent.confidence = 0.876;
        r.intent.alternatives = [{ key: 'self_exclusion', confidence: 0.4 }];
      }),
      grounding,
    );
    expect(understoodDetail(understanding, 2)).toBe(
      'understood: deposit (0.88) · or self_exclusion (0.4) · language tr · second try',
    );
    expect(understoodDetail(readUnderstanding(reply(), grounding).understanding, 1)).toBe(
      'understood: no procedure',
    );
  });
});
