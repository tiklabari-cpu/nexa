import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KNOWLEDGE_AUDIENCES,
  KNOWLEDGE_AUDIENCES,
  KNOWLEDGE_LANGUAGE_PATTERN,
  KNOWLEDGE_REVIEW_INTERVAL_DAYS,
  isKnowledgeAudience,
  isKnowledgeReviewDue,
  knowledgeReviewDueAt,
  normalizeKnowledgeAudiences,
} from './knowledge-store.js';
import { normaliseLanguage } from './persona.js';

describe('knowledge store audiences (AI-14 · K11 · tm 309.1)', () => {
  it('names the AI agent and Copilot, and a new source is open to both', () => {
    expect(KNOWLEDGE_AUDIENCES).toEqual(['ai_agent', 'copilot']);
    expect(DEFAULT_KNOWLEDGE_AUDIENCES).toEqual(KNOWLEDGE_AUDIENCES);
  });

  it.each([
    [
      ['copilot', 'ai_agent'],
      ['ai_agent', 'copilot'],
    ],
    [['copilot', 'copilot'], ['copilot']],
    [['ai_agent', 'public_kb', 7, null], ['ai_agent']],
    [[], []],
  ])('keeps one spelling of a set: %j → %j', (input, expected) => {
    expect(normalizeKnowledgeAudiences(input)).toEqual(expected);
  });

  it('a public KB is not an audience — the article has its own editor (ADR §2.2)', () => {
    expect(isKnowledgeAudience('ai_agent')).toBe(true);
    expect(isKnowledgeAudience('copilot')).toBe(true);
    expect(isKnowledgeAudience('public_kb')).toBe(false);
    expect(isKnowledgeAudience(undefined)).toBe(false);
  });
});

describe('knowledge review (AI-14-S3 · tm 309.1)', () => {
  const reviewedAt = new Date('2026-10-01T09:30:00Z');

  it('falls due a whole number of days after the review — 90 unless set', () => {
    expect(KNOWLEDGE_REVIEW_INTERVAL_DAYS).toEqual({ default: 90, min: 1, max: 365 });
    expect(knowledgeReviewDueAt(reviewedAt, 90).toISOString()).toBe('2026-12-30T09:30:00.000Z');
    expect(knowledgeReviewDueAt(reviewedAt, 1).toISOString()).toBe('2026-10-02T09:30:00.000Z');
  });

  it('is due only once the due moment has passed', () => {
    const due = knowledgeReviewDueAt(reviewedAt, 30);
    expect(isKnowledgeReviewDue(reviewedAt, 30, new Date(due.getTime() - 1))).toBe(false);
    expect(isKnowledgeReviewDue(reviewedAt, 30, due)).toBe(false);
    expect(isKnowledgeReviewDue(reviewedAt, 30, new Date(due.getTime() + 1))).toBe(true);
  });
});

describe('knowledge source language (tm 309.1)', () => {
  it.each(['tr', 'en-GB', 'TR', 'fil'])(
    'stores %s as a primary subtag the pattern holds',
    (raw) => {
      const code = normaliseLanguage(raw);
      expect(code).not.toBeNull();
      expect(KNOWLEDGE_LANGUAGE_PATTERN.test(code!)).toBe(true);
    },
  );

  it.each(['', 'turkish', '1', 'tr ', 'T'])('refuses %j', (raw) => {
    expect(KNOWLEDGE_LANGUAGE_PATTERN.test(raw)).toBe(false);
  });
});
