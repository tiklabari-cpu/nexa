/**
 * Palette topic matching.
 *
 * Deterministic and lexical (same method as `detect_intent`), so the KK's
 * behaviour — "same query, same answer" — holds by construction rather than by
 * accident of an LLM's temperature.
 */
import { describe, expect, it } from 'vitest';
import { matchPaletteTopic, PALETTE_TOPICS } from './palette-intent.js';

describe('matchPaletteTopic', () => {
  it('matches the KK example query to the team-activity topic', () => {
    const result = matchPaletteTopic("Summarize my team's activity");
    expect(result?.topic.id).toBe('team_activity');
    expect(result?.topic.metricSource).toBe('totals.chats');
  });

  it('matches a satisfaction question', () => {
    expect(matchPaletteTopic('What is our customer satisfaction score?')?.topic.id).toBe('satisfaction');
  });

  it('matches a response-time question', () => {
    expect(matchPaletteTopic('How fast do we respond to customers?')?.topic.id).toBe('response_time');
  });

  it('matches a tickets question', () => {
    expect(matchPaletteTopic('How many open tickets do we have?')?.topic.id).toBe('tickets');
  });

  it('matches an automation question', () => {
    expect(matchPaletteTopic('How many chats were resolved automatically?')?.topic.id).toBe('automated');
  });

  it('returns null for a question with no matching topic', () => {
    expect(matchPaletteTopic('What is the meaning of life?')).toBeNull();
  });

  it('returns null for an empty or stop-word-only query', () => {
    expect(matchPaletteTopic('')).toBeNull();
    expect(matchPaletteTopic('is it the')).toBeNull();
  });

  it('is deterministic — the same query always resolves to the same topic', () => {
    const first = matchPaletteTopic('team activity this week');
    const second = matchPaletteTopic('team activity this week');
    expect(first).toEqual(second);
  });

  it('every topic has at least one phrase and a metric source', () => {
    for (const topic of PALETTE_TOPICS) {
      expect(topic.phrases.length).toBeGreaterThan(0);
      expect(topic.metricSource.length).toBeGreaterThan(0);
    }
  });
});
