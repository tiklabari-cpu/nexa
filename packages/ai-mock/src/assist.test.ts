import { describe, expect, it } from 'vitest';
import { enhanceText, summariseConversation, type ConversationTurn } from './assist.js';

describe('summariseConversation', () => {
  it('is deterministic — same turns, same summary', () => {
    const turns: ConversationTurn[] = [
      { role: 'customer', text: 'My order has not arrived' },
      { role: 'agent', text: 'Let me check that for you' },
      { role: 'customer', text: 'It was due last Tuesday' },
    ];
    expect(summariseConversation(turns)).toBe(summariseConversation(turns));
  });

  it('leads with what the customer opened with and their latest message', () => {
    const summary = summariseConversation([
      { role: 'customer', text: 'My order has not arrived' },
      { role: 'agent', text: 'Let me check' },
      { role: 'customer', text: 'It was due last Tuesday' },
    ]);
    expect(summary).toContain('opened with: "My order has not arrived"');
    expect(summary).toContain('Most recent: "It was due last Tuesday"');
    expect(summary).toContain('3 message(s)');
    expect(summary).toContain('2 from the customer');
  });

  it('does not repeat a single customer message as both opener and latest', () => {
    const summary = summariseConversation([{ role: 'customer', text: 'Where is my refund?' }]);
    expect(summary).toContain('opened with: "Where is my refund?"');
    expect(summary).not.toContain('Most recent');
  });

  it('ignores blank turns when counting', () => {
    const summary = summariseConversation([
      { role: 'customer', text: '   ' },
      { role: 'customer', text: 'Hello' },
    ]);
    expect(summary).toContain('1 message(s)');
    expect(summary).toContain('opened with: "Hello"');
  });

  it('handles a conversation with no customer message', () => {
    expect(summariseConversation([{ role: 'agent', text: 'Following up' }])).toContain(
      'no customer reply yet',
    );
  });

  it('handles an empty conversation without throwing', () => {
    expect(summariseConversation([])).toBe('No messages to summarise yet.');
  });

  it('clips a very long opening rather than echoing the whole message', () => {
    const long = 'a'.repeat(400);
    const summary = summariseConversation([{ role: 'customer', text: long }]);
    expect(summary).toContain('…');
    expect(summary.length).toBeLessThan(long.length);
  });
});

describe('enhanceText', () => {
  it('grammar mode tidies whitespace, capitalises and closes the sentence', () => {
    expect(enhanceText('  hello   world ', 'grammar')).toBe('Hello world.');
  });

  it('grammar mode is idempotent', () => {
    const once = enhanceText('thanks for waiting', 'grammar');
    expect(enhanceText(once, 'grammar')).toBe(once);
  });

  it('formal mode expands contractions', () => {
    const result = enhanceText("we can't do that and i'm sorry", 'formal');
    expect(result).toContain('cannot');
    expect(result).toContain('I am');
    expect(result).not.toMatch(/can't|i'm/i);
  });

  it('friendly mode adds a warm opener only once', () => {
    const first = enhanceText('your refund is on the way', 'friendly');
    expect(first).toMatch(/^Happy to help!/);
    expect(enhanceText(first, 'friendly')).toBe(first);
  });

  it('rephrase mode frames the draft only once', () => {
    const first = enhanceText('the item ships tomorrow', 'rephrase');
    expect(first).toMatch(/^To confirm:/);
    expect(enhanceText(first, 'rephrase')).toBe(first);
  });

  it('returns empty for empty input', () => {
    expect(enhanceText('   ', 'friendly')).toBe('');
  });

  it('is deterministic across modes', () => {
    for (const mode of ['rephrase', 'friendly', 'formal', 'grammar'] as const) {
      expect(enhanceText('please hold on', mode)).toBe(enhanceText('please hold on', mode));
    }
  });
});
