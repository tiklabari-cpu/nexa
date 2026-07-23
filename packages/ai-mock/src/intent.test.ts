/**
 * Intent matching.
 *
 * The failure that matters is the false positive: a skill firing at a customer
 * who asked something else. Teams turn automation off entirely after seeing
 * that once, so the threshold is tested from both sides.
 */
import { describe, expect, it } from 'vitest';
import { INTENT_THRESHOLD, matchIntent } from './intent.js';

describe('matchIntent', () => {
  it('matches a message containing the phrase', () => {
    const result = matchIntent('Where is my order?', 'order_status', ['order status', 'my order']);
    expect(result.matched).toBe(true);
    expect(result.hits).toContain('order');
  });

  it('falls back to the intent name when no phrases were given', () => {
    // `order_status` reads as "order status".
    expect(matchIntent('what is my order status', 'order_status').matched).toBe(true);
  });

  it('does not fire on a single incidental word', () => {
    // "I ordered a coffee while waiting" must not trigger an order-status skill.
    const result = matchIntent('I ordered a coffee while waiting', 'order_status', [
      'order status',
    ]);
    expect(result.matched).toBe(false);
  });

  it('ignores case and accents', () => {
    expect(matchIntent('KARGÓ NEREDE', 'shipping', ['kargo nerede']).matched).toBe(true);
  });

  it('scores by share of the phrase, so a long message still matches', () => {
    const short = matchIntent('order status', 'x', ['order status']);
    const long = matchIntent(
      'Hello, I hope you are well, I just wanted to check my order status please',
      'x',
      ['order status'],
    );
    expect(short.score).toBe(1);
    expect(long.score).toBe(1);
  });

  it('takes the best-scoring phrase', () => {
    const result = matchIntent('I need a refund', 'x', ['delivery times', 'refund']);
    expect(result.matched).toBe(true);
    expect(result.hits).toEqual(['refund']);
  });

  it('needs more than half the phrase, so one word of two is not enough', () => {
    // "order status" must not fire on a message that only says "order".
    const half = matchIntent('order please', 'x', ['order status']);
    expect(half.score).toBe(0.5);
    expect(half.matched).toBe(false);

    const whole = matchIntent('what is my order status', 'x', ['order status']);
    expect(whole.matched).toBe(true);
    expect(INTENT_THRESHOLD).toBeGreaterThan(0.5);
  });

  it('does not match an empty or stop-word-only message', () => {
    expect(matchIntent('', 'order_status').matched).toBe(false);
    expect(matchIntent('is it the', 'order_status').matched).toBe(false);
  });

  it('does not match when the phrase itself carries no tokens', () => {
    // An admin who typed punctuation as a phrase should get no matches, not
    // every message matching.
    expect(matchIntent('anything at all', 'x', ['...']).matched).toBe(false);
  });
});
