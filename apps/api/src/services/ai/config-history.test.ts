import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AI_CONFIG_TEXT_LIMIT_BYTES,
  aiConfigDiffFields,
  aiConfigStepOf,
  isAiConfigMetaOnly,
} from '@siyahtus/types';
import { diffConfig, skillEntityType, storableConfigValue } from './config-history.js';
import { csvValue, entityNameOf } from './config-history-read.js';

describe('diffConfig — the JSON-path difference (AI-21)', () => {
  it('names one changed leaf by its path', () => {
    expect(diffConfig({ tone: 'friendly', name: 'Ada' }, { tone: 'formal', name: 'Ada' })).toEqual([
      { path: 'tone', kind: 'changed', before: 'friendly', after: 'formal' },
    ]);
  });

  it('walks into objects and arrays: a procedure step is steps[i]', () => {
    const before = {
      procedure: { steps: [{ type: 'say' }, { type: 'handoff', target: 'Finans' }] },
    };
    const after = { procedure: { steps: [{ type: 'say' }, { type: 'handoff', target: 'KYC' }] } };
    expect(diffConfig(before, after)).toEqual([
      { path: 'procedure.steps[1].target', kind: 'changed', before: 'Finans', after: 'KYC' },
    ]);
  });

  it('says added and removed, for keys and for array tails', () => {
    expect(diffConfig({ a: 1, list: [1, 2] }, { b: 2, list: [1] })).toEqual([
      { path: 'a', kind: 'removed', before: 1 },
      { path: 'list[1]', kind: 'removed', before: 2 },
      { path: 'b', kind: 'added', after: 2 },
    ]);
  });

  it('lists every field of a created or deleted entity', () => {
    expect(diffConfig(null, { name: 'x', active: false })).toEqual([
      { path: 'name', kind: 'added', after: 'x' },
      { path: 'active', kind: 'added', after: false },
    ]);
    expect(diffConfig({ name: 'x' }, null)).toEqual([
      { path: 'name', kind: 'removed', before: 'x' },
    ]);
  });

  it('finds nothing in an unchanged entity', () => {
    expect(diffConfig({ a: { b: [1, { c: 'd' }] } }, { a: { b: [1, { c: 'd' }] } })).toEqual([]);
  });

  it('a null that becomes a value is added, a value that becomes null removed', () => {
    expect(diffConfig({ owner_id: null }, { owner_id: 'u' })).toEqual([
      { path: 'owner_id', kind: 'added', after: 'u' },
    ]);
    expect(diffConfig({ owner_id: 'u' }, { owner_id: null })).toEqual([
      { path: 'owner_id', kind: 'removed', before: 'u' },
    ]);
  });
});

describe('storableConfigValue — masking and the 20 KB rule (AI-21 · AI-26)', () => {
  it('masks a card, an SMS code and a password in any text, at any depth', () => {
    const stored = storableConfigValue({
      instruction: 'Kart 4111 1111 1111 1111 ise sor',
      steps: [{ say: 'SMS kodu 482913 olsa bile' }, { say: 'şifrem Gizli123 dese bile' }],
    }) as { instruction: string; steps: Array<{ say: string }> };
    expect(stored.instruction).not.toContain('4111 1111 1111 1111');
    expect(stored.instruction).toContain('1111');
    expect(stored.steps[0]!.say).not.toContain('482913');
    expect(stored.steps[1]!.say).not.toContain('Gizli123');
  });

  it('keeps an IBAN: a payment method account is configuration (AI-26-S2)', () => {
    const iban = 'TR33 0006 1005 1978 6457 8413 26';
    expect(storableConfigValue({ account: iban })).toEqual({ account: iban });
  });

  it('keeps a text of exactly 20 KB, replaces a longer one by its digest and length', () => {
    const fits = 'a'.repeat(AI_CONFIG_TEXT_LIMIT_BYTES);
    expect(storableConfigValue(fits)).toBe(fits);
    const long = 'b'.repeat(AI_CONFIG_TEXT_LIMIT_BYTES + 1);
    expect(storableConfigValue({ content: long })).toEqual({
      content: {
        omitted: 'too_large',
        sha256: createHash('sha256').update(long).digest('hex'),
        length: long.length,
      },
    });
  });

  it('counts bytes, not characters: 10 241 Turkish letters are over the limit', () => {
    const turkish = 'ş'.repeat(AI_CONFIG_TEXT_LIMIT_BYTES / 2 + 1);
    expect(storableConfigValue(turkish)).toMatchObject({ omitted: 'too_large' });
  });

  it('leaves numbers, booleans and null alone', () => {
    expect(storableConfigValue({ n: 3, b: true, z: null })).toEqual({ n: 3, b: true, z: null });
  });
});

describe('the history vocabulary', () => {
  it('fields are the top-level columns, in order', () => {
    expect(
      aiConfigDiffFields([
        { path: 'procedure.steps[2].target', kind: 'changed' },
        { path: 'name', kind: 'changed' },
        { path: 'procedure.steps[0]', kind: 'added' },
      ]),
    ).toEqual(['procedure', 'name']);
  });

  it('a review alone is a meta change; a review with an edit is not', () => {
    expect(isAiConfigMetaOnly([{ path: 'reviewed_at', kind: 'changed' }])).toBe(true);
    expect(
      isAiConfigMetaOnly([
        { path: 'reviewed_at', kind: 'changed' },
        { path: 'content', kind: 'changed' },
      ]),
    ).toBe(false);
    expect(isAiConfigMetaOnly([])).toBe(false);
  });

  it('a step path reads as its 1-based step', () => {
    expect(aiConfigStepOf('procedure.steps[2].target')).toEqual({ step: 3, rest: 'target' });
    expect(aiConfigStepOf('steps[0]')).toEqual({ step: 1, rest: '' });
    expect(aiConfigStepOf('persona.welcome')).toBeNull();
  });

  it('a skill in procedure mode is a procedure', () => {
    expect(skillEntityType({ mode: 'procedure' })).toBe('procedure');
    expect(skillEntityType({ mode: 'single' })).toBe('skill');
  });

  it('names the entity from its name, title or label, after before before', () => {
    expect(entityNameOf({ before: { name: 'Eski' }, after: { name: 'Yeni' } })).toBe('Yeni');
    expect(entityNameOf({ before: { title: 'Silinen' }, after: null })).toBe('Silinen');
    expect(entityNameOf({ before: null, after: { id: 'x' } })).toBeNull();
  });

  it('a CSV cell is the text, JSON otherwise, the digest for an omitted text', () => {
    expect(csvValue('formal')).toBe('formal');
    expect(csvValue({ a: 1 })).toBe('{"a":1}');
    expect(csvValue(null)).toBe('');
    expect(csvValue({ omitted: 'too_large', sha256: 'ab', length: 30000 })).toBe(
      '[30000 chars · sha256 ab]',
    );
  });
});
