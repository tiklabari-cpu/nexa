/**
 * The mock's answer to the understanding call (tm 297.1 · AI-05 §6 · ADR
 * §6a.6): deterministic, from the context line, and a reply the schema gate
 * passes — the reading the interim understanding gave until #297, plus the
 * language and the least committal rest.
 */
import { describe, expect, it } from 'vitest';
import { depositProcedure, DEPOSIT_OPTIONS } from '../../../../test/helpers/procedure-fixtures.js';
import { exampleForSchema, validateJson } from '../provider/json-schema.js';
import { MockLlmProvider } from '../provider/mock-llm-provider.js';
import { completeStructured } from '../provider/structured-output.js';
import type { CatalogueEntry, PendingQuestion } from './procedure/understanding.js';
import { mockUnderstanding } from './understand-mock.js';
import {
  buildUnderstandPrompt,
  understandGrounding,
  UNDERSTAND_RESPONSE_FORMAT,
  UNDERSTAND_RISKS,
  UNDERSTAND_SCHEMA,
} from './understand.js';

const NOW = new Date('2026-10-18T10:50:00Z');

const DEPOSIT: CatalogueEntry = {
  key: 'deposit',
  name: 'Yatırım geçmedi',
  examples: ['param yatmadı', 'havale attım gözükmüyor'],
  priority: 50,
  locked: false,
};
const WITHDRAWAL: CatalogueEntry = {
  key: 'withdrawal',
  name: 'Çekim',
  examples: ['çekim yapamıyorum', 'para çekemiyorum'],
  priority: 100,
  locked: false,
};
const SELF_EXCLUSION: CatalogueEntry = {
  key: 'self_exclusion',
  name: 'Kendini sınırlama',
  examples: ['hesabımı kapatın'],
  priority: 100,
  locked: true,
};
const CATALOGUE = [DEPOSIT, WITHDRAWAL, SELF_EXCLUSION];

const procedure = depositProcedure();
const PENDING: PendingQuestion = {
  defs: procedure.slots as never,
  slots: {},
  asked: ['yontem', 'islem_zamani'],
  key: 'deposit',
};

function understand(message: string, pending: PendingQuestion | null = null) {
  return mockUnderstanding(
    understandGrounding({
      message,
      catalogue: CATALOGUE,
      active: pending ? { key: 'deposit', name: 'Yatırım geçmedi', procedure } : null,
      pending,
      options: DEPOSIT_OPTIONS,
      now: NOW,
      timeZone: 'Europe/Istanbul',
      currency: 'TRY',
    }),
  );
}

describe('the mock understanding (AI-05 §6)', () => {
  it('finds the procedure by its example sentences; the other scoring ones are the alternatives', () => {
    const result = understand('Param yatmadı!');
    expect(result.intent).toMatchObject({ procedure_key: 'deposit', confidence: 1 });
    expect(result.extracted).toEqual([]);
    expect(understand('hesabımı kapatın').intent.procedure_key).toBe('self_exclusion');
    expect(understand('merhaba').intent).toEqual({
      procedure_key: null,
      confidence: 0,
      alternatives: [],
      is_continuation: false,
      smalltalk: false,
      off_topic: false,
    });
    const both = understand('param yatmadı, çekim de yapamıyorum');
    expect(both.intent.alternatives.map((alternative) => alternative.key)).toEqual(['withdrawal']);
  });

  it('reads the message only for the slots the AI is waiting on, and only where it holds something of their kind', () => {
    const both = understand('Papara 13:40', PENDING);
    expect(both.extracted).toEqual([
      { slot: 'yontem', raw_text: 'Papara 13:40', value: null, confidence: 0.9 },
      { slot: 'islem_zamani', raw_text: 'Papara 13:40', value: null, confidence: 0.9 },
    ]);
    expect(both.answers_pending_question).toBe(true);
    expect(both.intent.is_continuation).toBe(true);

    const one = understand('papara ile', PENDING);
    expect(one.extracted.map((item) => item.slot)).toEqual(['yontem']);

    const other = understand('çekim yapamıyorum', PENDING);
    expect(other.extracted).toEqual([]);
    expect(other.answers_pending_question).toBe(false);
    expect(other.intent.procedure_key).toBe('withdrawal');
  });

  it('completes a partial moment the AI asked the time of', () => {
    const waiting: PendingQuestion = {
      ...PENDING,
      asked: ['islem_zamani'],
      slots: {
        islem_zamani: {
          status: 'partial',
          value: { date: '2026-10-18', time: null, time_zone: 'Europe/Istanbul' },
        },
      },
    };
    expect(understand('13:40', waiting).extracted.map((item) => item.slot)).toEqual([
      'islem_zamani',
    ]);
  });

  it('answers yes or no in Turkish, and tells the language', () => {
    expect(
      [understand('evet'), understand('hayır'), understand('bilmem')].map((r) => r.yes_no),
    ).toEqual(['yes', 'no', null]);
    expect(understand('param yatmadı, ne zaman gelir').language).toBe('tr');
    expect(understand('my deposit did not arrive, where is it').language).toBe('en');
  });

  it('reads nothing else into the message: no person asked for, neutral, no abuse, no risk', () => {
    const result = understand('hesabımı kapatın, kumar bağımlısıyım');
    expect(result).toMatchObject({
      relates_to_previous: null,
      wants_human: { value: false, explicit: false },
      correction: false,
      ai_conditions: [],
      sentiment: 'neutral',
      abuse: false,
    });
    for (const risk of UNDERSTAND_RISKS) {
      expect(result.risk[risk]).toEqual({ flag: false, evidence_quote: null });
    }
  });

  it('passes the schema, and the same turn always gets the same reply', () => {
    for (const message of ['Papara 13:40', 'evet', 'my deposit', 'hesabımı kapatın']) {
      const result = understand(message, PENDING);
      expect(validateJson(result, UNDERSTAND_SCHEMA), message).toBeNull();
      expect(JSON.stringify(understand(message, PENDING))).toBe(JSON.stringify(result));
    }
  });
});

describe('the mock provider answers the call (ADR §6a.6)', () => {
  const grounding = understandGrounding({
    message: 'havale attım gözükmüyor',
    catalogue: CATALOGUE,
    active: null,
    pending: null,
    now: NOW,
    timeZone: 'Europe/Istanbul',
    currency: 'TRY',
  });

  it('with the reading of the context line, through the structured gate', async () => {
    const { value, tries, usage } = await completeStructured(new MockLlmProvider(), {
      ...buildUnderstandPrompt({ grounding }),
      maxOutputTokens: 400,
      timeoutMs: 20_000,
      tier: 'fast',
      responseFormat: UNDERSTAND_RESPONSE_FORMAT,
    });
    expect(value).toEqual(mockUnderstanding(grounding));
    expect(tries).toBe(1);
    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('with the least committal object when the prompt has no context line', async () => {
    const { text } = await new MockLlmProvider().complete({
      system: 'not built by buildUnderstandPrompt',
      messages: [{ role: 'user', content: 'havale attım gözükmüyor' }],
      maxOutputTokens: 400,
      timeoutMs: 20_000,
      responseFormat: UNDERSTAND_RESPONSE_FORMAT,
    });
    expect(JSON.parse(text)).toEqual(exampleForSchema(UNDERSTAND_SCHEMA));
  });
});
