/**
 * A cluster's title (tm 317.2 · AI-22 §5): what the model is shown, what of
 * its reply is kept, and the lexical title that stands when no model may
 * write one.
 */
import { describe, expect, it } from 'vitest';
import {
  UNRESOLVED_LABEL_WORDS_MAX,
  UNRESOLVED_SUGGESTED_ACTIONS,
  unresolvedLabelDue,
  unresolvedLabelOf,
} from '@siyahtus/types';
import { assertStrictJsonSchema } from '../provider/json-schema.js';
import {
  buildUnresolvedLabelPrompt,
  lexicalUnresolvedLabel,
  readUnresolvedLabelReply,
  readUnresolvedLabelSamples,
  UNRESOLVED_LABEL_FALLBACK,
  UNRESOLVED_LABEL_RESPONSE_FORMAT,
  UNRESOLVED_LABEL_SAMPLE_MAX,
} from './label.js';

describe('the title prompt', () => {
  it('carries the samples as its last line, cut, and reads them back', () => {
    const long = `Papara ${'x'.repeat(2 * UNRESOLVED_LABEL_SAMPLE_MAX)}`;
    const prompt = buildUnresolvedLabelPrompt(['Papara ile yatırdım gözükmüyor', long]);
    const samples = readUnresolvedLabelSamples(prompt.system);
    expect(samples?.[0]).toBe('Papara ile yatırdım gözükmüyor');
    expect(samples?.[1]).toHaveLength(UNRESOLVED_LABEL_SAMPLE_MAX);
    expect(prompt.system).toContain('Turkish');
    for (const action of UNRESOLVED_SUGGESTED_ACTIONS) expect(prompt.system).toContain(action);
    expect(readUnresolvedLabelSamples('another prompt')).toBeNull();
  });

  it('asks for a strict object: a title and one of the actions', () => {
    expect(() =>
      assertStrictJsonSchema(
        UNRESOLVED_LABEL_RESPONSE_FORMAT.name,
        UNRESOLVED_LABEL_RESPONSE_FORMAT.schema,
      ),
    ).not.toThrow();
  });
});

describe('the model’s reply', () => {
  it('keeps a title and its action', () => {
    expect(
      readUnresolvedLabelReply({
        label: '“Papara yatırımı hesaba geçmedi.”',
        action: 'add_knowledge',
      }),
    ).toEqual({ label: 'Papara yatırımı hesaba geçmedi', source: 'llm', action: 'add_knowledge' });
  });

  it(`cuts a title to ${UNRESOLVED_LABEL_WORDS_MAX} words`, () => {
    const reply = readUnresolvedLabelReply({
      label: 'bir iki üç dört beş altı yedi sekiz dokuz on',
      action: 'review',
    });
    expect(reply?.label.split(' ')).toHaveLength(UNRESOLVED_LABEL_WORDS_MAX);
  });

  it('refuses a title with a digit, a card number or nothing in it, and an unknown action', () => {
    for (const reply of [
      { label: '500 TL Papara yatırımı', action: 'review' },
      { label: 'Kart 4111 1111 1111 1111 sorunu', action: 'review' },
      { label: '  ...  ', action: 'review' },
      { label: 'Papara yatırımı', action: 'escalate' },
      { label: 42, action: 'review' },
      null,
    ]) {
      expect(readUnresolvedLabelReply(reply)).toBeNull();
    }
  });
});

describe('the lexical title', () => {
  const papara = ['Papara ile yatırdım gözükmüyor', 'Papara yatırımım hesabımda gözükmüyor'];

  it('names a cluster by what tells it apart from the agent’s other questions, suggesting nothing', () => {
    const title = lexicalUnresolvedLabel(papara, ['Bonus çevrim şartı nedir']);
    expect(title.source).toBe('lexical');
    expect(title.action).toBeNull();
    expect(title.label.split(' ')).toContain('papara');
    expect(title.label).not.toMatch(/\d/);
  });

  it('falls back to the newest sample’s words, then to a fixed title — never a digit', () => {
    expect(lexicalUnresolvedLabel(['**** **** 4111 ok'], []).label).toBe('ok');
    expect(lexicalUnresolvedLabel(['4111 1111 1111 1111 9999'], []).label).toBe(
      UNRESOLVED_LABEL_FALLBACK,
    );
  });
});

describe('when a cluster is titled again', () => {
  it('when it opens, and once it has grown by half', () => {
    expect(unresolvedLabelDue(1, 0)).toBe(true);
    expect(unresolvedLabelDue(0, 0)).toBe(false);
    expect(unresolvedLabelDue(5, 4)).toBe(false);
    expect(unresolvedLabelDue(6, 4)).toBe(true);
    expect(unresolvedLabelDue(30, 20)).toBe(true);
  });

  it('keeps a title to words without digits', () => {
    expect(unresolvedLabelOf('  Papara   yatırımı ')).toBe('Papara yatırımı');
    expect(unresolvedLabelOf('Saat 13:42 yatırım')).toBeNull();
    expect(unresolvedLabelOf('!!!')).toBeNull();
  });
});
