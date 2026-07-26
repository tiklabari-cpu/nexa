/**
 * Reply Suggestions generator (FR-MOD-02.3.2).
 *
 * The pure core the composer calls: a conversation in, a short list of editable
 * reply drafts out. What matters here is that it always offers something, that it
 * shapes the lead to what the customer last said, and that it is deterministic —
 * the composer test then pins the chip → editable-composer hand-off.
 */
import { describe, expect, it } from 'vitest';
import { replySuggestions, type SuggestionTurn } from './replySuggestions.js';

describe('replySuggestions', () => {
  it('always offers holding replies, even with no conversation yet', () => {
    const result = replySuggestions([]);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(4);
    // The two safe holding lines are always there so Space never comes up empty.
    expect(result.some((s) => /bear with me/i.test(s))).toBe(true);
    expect(result.some((s) => /give me a moment/i.test(s))).toBe(true);
  });

  it('leads with a greeting when the customer opened with one', () => {
    const turns: SuggestionTurn[] = [{ role: 'customer', text: 'Hi there!' }];
    expect(replySuggestions(turns)[0]).toMatch(/how can i help/i);
  });

  it('leads with a look-into-it line for a question', () => {
    const turns: SuggestionTurn[] = [
      { role: 'customer', text: 'Do you ship to Germany?' },
    ];
    expect(replySuggestions(turns)[0]).toMatch(/look into that|find the answer/i);
  });

  it('shapes the lead to an order/refund intent', () => {
    const turns: SuggestionTurn[] = [
      { role: 'customer', text: 'I want a refund for my last order.' },
    ];
    expect(replySuggestions(turns)[0]).toMatch(/pull up the details|happy to help/i);
  });

  it('reads the latest customer message, not the first', () => {
    const turns: SuggestionTurn[] = [
      { role: 'customer', text: 'Hello' },
      { role: 'agent', text: 'Hi! How can I help?' },
      { role: 'customer', text: 'Thanks, that solved it!' },
    ];
    expect(replySuggestions(turns)[0]).toMatch(/you're very welcome|anything else/i);
  });

  it('ignores blank turns when picking the last customer message', () => {
    const turns: SuggestionTurn[] = [
      { role: 'customer', text: 'Can you help me?' },
      { role: 'customer', text: '   ' },
    ];
    expect(replySuggestions(turns)[0]).toMatch(/look into that|find the answer/i);
  });

  it('is deterministic and de-duplicated', () => {
    const turns: SuggestionTurn[] = [{ role: 'customer', text: 'Any update?' }];
    const first = replySuggestions(turns);
    const second = replySuggestions(turns);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
  });
});
