/**
 * Reply Suggestions generator (FR-MOD-02.3.2).
 *
 * The pure core the composer calls: a conversation in, a short list of chip
 * *intents* out — never sentences, which is what stops this feature answering a
 * Turkish conversation in English. What matters here is that it always offers
 * something, that it shapes the lead to what the customer last said in whichever
 * language they said it, and that it is deterministic. `Composer.suggestions`
 * then pins the language of the words and the chip → editable-composer hand-off.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_SUGGESTIONS,
  replySuggestionIds,
  withCopilotDraft,
  type ReplyChip,
  type SuggestionTurn,
} from './replySuggestions.js';

const templates = (...texts: string[]): ReplyChip[] =>
  texts.map((text) => ({ text, source: 'template' as const }));

describe('replySuggestionIds (FR-MOD-02.3.2)', () => {
  it('always offers holding replies, even with no conversation yet', () => {
    const result = replySuggestionIds([]);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    // The two safe holding lines are always there so Space never comes up empty.
    expect(result).toContain('holdingBear');
    expect(result).toContain('holdingMoment');
  });

  it('returns intent ids, never a sentence in any one language', () => {
    // The audit finding this task closes: the generator used to hand back fixed
    // English prose, so the chips were English whatever the console was set to.
    // An id carries no language at all — the catalogue supplies it.
    for (const turns of [
      [],
      [{ role: 'customer' as const, text: 'Hi there!' }],
      [{ role: 'customer' as const, text: 'Do you ship to Germany?' }],
    ]) {
      for (const id of replySuggestionIds(turns)) {
        expect(id).toMatch(/^[a-zA-Z]+$/);
        expect(id).not.toContain(' ');
      }
    }
  });

  it('leads with a greeting when the customer opened with one', () => {
    expect(replySuggestionIds([{ role: 'customer', text: 'Hi there!' }])[0]).toBe('greeting');
  });

  it('leads with a look-into-it line for a question', () => {
    const turns: SuggestionTurn[] = [{ role: 'customer', text: 'Do you ship to Germany?' }];
    expect(replySuggestionIds(turns)[0]).toBe('question');
  });

  it('shapes the lead to an order/refund intent', () => {
    const turns: SuggestionTurn[] = [
      { role: 'customer', text: 'I want a refund for my last order.' },
    ];
    expect(replySuggestionIds(turns)[0]).toBe('order');
  });

  it('reads the latest customer message, not the first', () => {
    const turns: SuggestionTurn[] = [
      { role: 'customer', text: 'Hello' },
      { role: 'agent', text: 'Hi! How can I help?' },
      { role: 'customer', text: 'Thanks, that solved it!' },
    ];
    expect(replySuggestionIds(turns)[0]).toBe('thanks');
  });

  it('ignores blank turns when picking the last customer message', () => {
    const turns: SuggestionTurn[] = [
      { role: 'customer', text: 'Can you help me?' },
      { role: 'customer', text: '   ' },
    ];
    expect(replySuggestionIds(turns)[0]).toBe('question');
  });

  it('is deterministic and de-duplicated', () => {
    const turns: SuggestionTurn[] = [{ role: 'customer', text: 'Any update?' }];
    const first = replySuggestionIds(turns);
    const second = replySuggestionIds(turns);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
  });

  it('never offers more than the row can be scanned at', () => {
    // The question branch is the widest lead (two lines) — even it stays inside
    // the budget once the two holding replies follow.
    const turns: SuggestionTurn[] = [{ role: 'customer', text: 'Do you ship to Germany?' }];
    expect(replySuggestionIds(turns)).toEqual([
      'question',
      'questionWait',
      'holdingBear',
      'holdingMoment',
    ]);
    expect(replySuggestionIds(turns).length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
  });

  describe('reads the customer in their own language, not only English', () => {
    // The intent is the same in both languages; only the words the catalogue
    // puts on the chip differ. A Turkish sentence reaching `details` (the
    // catch-all) would mean the conversation was read as unclassifiable.
    const cases: Array<[string, string]> = [
      ['Merhaba, yardımcı olur musunuz', 'greeting'],
      ['İyi günler', 'greeting'],
      ['Günaydın!', 'greeting'],
      ['Teşekkürler, sorunum çözüldü.', 'thanks'],
      ['Çok sağ olun', 'thanks'],
      ['Siparişimi iptal etmek istiyorum.', 'order'],
      ['İade talebim ne durumda', 'order'],
      ['Ödeme alınmış ama kargo gelmedi.', 'order'],
      ['Faturamı nereden indirebilirim', 'order'],
    ];

    for (const [text, expected] of cases) {
      it(`${text} → ${expected}`, () => {
        expect(replySuggestionIds([{ role: 'customer', text }])[0]).toBe(expected);
      });
    }

    it('does not let Turkish folding break the English patterns', () => {
      // `'I'.toLocaleLowerCase('tr')` is `'ı'`. Folding every message the
      // Turkish way would have silently stopped English matching.
      expect(replySuggestionIds([{ role: 'customer', text: 'I need an invoice' }])[0]).toBe(
        'order',
      );
      expect(replySuggestionIds([{ role: 'customer', text: 'HI THERE' }])[0]).toBe('greeting');
    });

    it('matches a Turkish word whose capital is the dotted İ', () => {
      // A plain `/iade/i` misses `İade`: the regex engine canonicalises through
      // ASCII uppercase, where `İ` and `i` do not meet.
      expect(replySuggestionIds([{ role: 'customer', text: 'İade istiyorum' }])[0]).toBe('order');
      expect(replySuggestionIds([{ role: 'customer', text: 'İptal edin lütfen' }])[0]).toBe(
        'order',
      );
    });

    it('falls back to the neutral lead when nothing is recognised', () => {
      expect(replySuggestionIds([{ role: 'customer', text: 'Модель X' }])[0]).toBe('details');
    });
  });
});

describe('withCopilotDraft (FR-MOD-02.3.2 · FR-MOD-12.3)', () => {
  it('puts the knowledge-base draft first and keeps the row inside its budget', () => {
    const chips = templates('one', 'two', 'three', 'four');
    const merged = withCopilotDraft(chips, 'Refunds over $500 need a manager.');

    expect(merged).toHaveLength(MAX_SUGGESTIONS);
    expect(merged[0]).toEqual({
      text: 'Refunds over $500 need a manager.',
      source: 'copilot',
    });
    // The last template is displaced rather than the row growing to five.
    expect(merged.map((chip) => chip.text)).not.toContain('four');
  });

  it('leaves the row untouched when the knowledge base had nothing to say', () => {
    const chips = templates('one', 'two');
    expect(withCopilotDraft(chips, '')).toEqual(chips);
    expect(withCopilotDraft(chips, '   ')).toEqual(chips);
  });

  it('does not offer the same sentence twice', () => {
    const chips = templates('Give me a moment.', 'two');
    const merged = withCopilotDraft(chips, 'Give me a moment.');
    expect(merged).toHaveLength(2);
    expect(merged[0]?.source).toBe('copilot');
    expect(merged.filter((chip) => chip.text === 'Give me a moment.')).toHaveLength(1);
  });

  it('trims the draft the way it will be shown', () => {
    expect(withCopilotDraft(templates('one'), '  hello  ')[0]?.text).toBe('hello');
  });
});
