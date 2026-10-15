/**
 * The strict structured-output subset (tm 283.1 · ADR §6a.3, §6a.4): what a
 * caller may ask for, the server-side gate every reply passes, and the mock's
 * deterministic answer.
 */
import { describe, expect, it } from 'vitest';
import {
  assertStrictJsonSchema,
  exampleForSchema,
  validateJson,
  type JsonSchema,
} from './json-schema.js';

/** AI-07's conflict check (ADR §6a.1), as a caller would write it. */
const CONFLICTS: JsonSchema = {
  type: 'object',
  properties: {
    conflicts: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        properties: {
          rule_id: { type: 'string' },
          explanation: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['rule_id', 'explanation', 'severity'],
        additionalProperties: false,
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    language: { type: ['string', 'null'] },
    wants_human: { type: 'boolean' },
    ids: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 2 },
    answer: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['conflicts', 'confidence', 'language', 'wants_human', 'ids', 'answer'],
  additionalProperties: false,
};

const VALID = {
  conflicts: [{ rule_id: 'r-1', explanation: 'says both', severity: 'high' }],
  confidence: 0.4,
  language: null,
  wants_human: false,
  ids: [3, 4],
  answer: 'yes',
};

describe('assertStrictJsonSchema — what OpenAI strict mode accepts, refused before sending (FR-05-06.EK1)', () => {
  it('accepts a schema inside the subset', () => {
    expect(() => assertStrictJsonSchema('rule_conflicts', CONFLICTS)).not.toThrow();
  });

  it.each<[string, JsonSchema, RegExp]>([
    ['a root that is not an object', { type: 'array', items: { type: 'string' } }, /root/],
    [
      'an object without additionalProperties: false',
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
      /additionalProperties/,
    ],
    [
      'an optional property',
      {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'string' } },
        required: ['a'],
        additionalProperties: false,
      },
      /required/,
    ],
    [
      'a keyword outside the subset',
      {
        type: 'object',
        properties: { a: { type: 'string', pattern: '^x' } as JsonSchema },
        required: ['a'],
        additionalProperties: false,
      },
      /pattern/,
    ],
    [
      'an array without items',
      {
        type: 'object',
        properties: { a: { type: 'array' } },
        required: ['a'],
        additionalProperties: false,
      },
      /items/,
    ],
  ])('refuses %s', (_label, schema, message) => {
    expect(() => assertStrictJsonSchema('x', schema)).toThrow(message);
  });

  it('refuses a name OpenAI would refuse, and nesting deeper than ten levels', () => {
    expect(() => assertStrictJsonSchema('has space', CONFLICTS)).toThrow(/name/);
    expect(() => assertStrictJsonSchema('x'.repeat(65), CONFLICTS)).toThrow(/name/);

    let deep: JsonSchema = { type: 'string' };
    for (let i = 0; i < 10; i += 1) {
      deep = {
        type: 'object',
        properties: { a: deep },
        required: ['a'],
        additionalProperties: false,
      };
    }
    expect(() => assertStrictJsonSchema('deep', deep)).toThrow(/deeper/);
  });
});

describe('validateJson — the gate every reply passes (FR-05-06.EK1)', () => {
  it('passes a conforming object', () => {
    expect(validateJson(VALID, CONFLICTS)).toBeNull();
  });

  it.each<[string, unknown, string]>([
    ['a string where an object goes', 'not an object', '$: expected object'],
    ['a missing field', { ...VALID, wants_human: undefined }, '$: missing "wants_human"'],
    ['an extra field', { ...VALID, extra: 1 }, '$: unexpected property'],
    [
      'a value outside the enum',
      { ...VALID, conflicts: [{ ...VALID.conflicts[0], severity: 'urgent' }] },
      '$.conflicts[0].severity: not one of the enum values',
    ],
    ['a number above the maximum', { ...VALID, confidence: 1.5 }, '$.confidence: above 1'],
    ['a fraction where an integer goes', { ...VALID, ids: [1, 2.5] }, '$.ids[1]: expected integer'],
    ['too few items', { ...VALID, ids: [1] }, '$.ids: fewer than 2 items'],
    ['no anyOf branch', { ...VALID, answer: 7 }, '$.answer: matches no anyOf branch'],
  ])('rejects %s, by path and rule', (_label, value, problem) => {
    const clean = JSON.parse(JSON.stringify(value)) as unknown;
    expect(validateJson(clean, CONFLICTS)).toBe(problem);
  });

  it('never quotes the value it rejected — the reply can quote the customer', () => {
    const secret = 'my card is 4111 1111 1111 1111';
    const problems = [
      validateJson({ ...VALID, confidence: secret }, CONFLICTS),
      validateJson({ ...VALID, [secret]: 1 }, CONFLICTS),
      validateJson(
        { ...VALID, conflicts: [{ ...VALID.conflicts[0], severity: secret }] },
        CONFLICTS,
      ),
    ];
    for (const problem of problems) {
      expect(problem).not.toBeNull();
      expect(problem).not.toContain('4111');
    }
  });
});

describe('exampleForSchema — the mock provider’s deterministic answer (FR-05-06.EK1)', () => {
  it('builds an object the gate passes, the same every time', () => {
    const example = exampleForSchema(CONFLICTS);
    expect(validateJson(example, CONFLICTS)).toBeNull();
    expect(example).toEqual({
      conflicts: [],
      confidence: 0,
      language: null,
      wants_human: false,
      ids: [1, 1],
      answer: '',
    });
    expect(JSON.stringify(exampleForSchema(CONFLICTS))).toBe(JSON.stringify(example));
  });
});
