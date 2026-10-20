import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KNOWLEDGE_AUDIENCES,
  DEFAULT_KNOWLEDGE_LIST_AUDIENCE,
  KNOWLEDGE_AUDIENCES,
  KNOWLEDGE_LANGUAGE_PATTERN,
  KNOWLEDGE_LIST_AUDIENCES,
  KNOWLEDGE_REVIEW_INTERVAL_DAYS,
  KNOWLEDGE_SCOPE_IDS_MAX,
  isKnowledgeAudience,
  isKnowledgeReviewDue,
  knowledgeReviewDueAt,
  knowledgeSourceServes,
  normalizeKnowledgeAudiences,
  type KnowledgeReader,
  type KnowledgeSourceScope,
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

describe('who a source serves — the knowledge filter (AI-14 · tm 309.2)', () => {
  const NOW = new Date('2026-10-21T12:00:00Z');
  const ADA = '00000000-0000-4000-8000-00000000000a';
  const BEA = '00000000-0000-4000-8000-00000000000b';
  const BRAND_A = '00000000-0000-4000-8000-0000000000a1';
  const BRAND_B = '00000000-0000-4000-8000-0000000000b1';
  const source = (scope: Partial<KnowledgeSourceScope> = {}): KnowledgeSourceScope => ({
    audiences: ['ai_agent', 'copilot'],
    aiAgentIds: [],
    brandIds: [],
    validUntil: null,
    ...scope,
  });
  const player = (aiAgentId: string | null, brandId: string | null): KnowledgeReader => ({
    audience: 'ai_agent',
    aiAgentId,
    brandId,
  });

  it('lists the store in three views, the AI agent’s by default (ADR §2.7)', () => {
    expect(KNOWLEDGE_LIST_AUDIENCES).toEqual(['all', 'ai_agent', 'copilot']);
    expect(DEFAULT_KNOWLEDGE_LIST_AUDIENCE).toBe('ai_agent');
    expect(KNOWLEDGE_SCOPE_IDS_MAX).toBe(100);
  });

  it('never gives a player a source for agents only, and gives Copilot everything (FR-MOD-12.2)', () => {
    const agentsOnly = source({ audiences: ['copilot'] });
    expect(knowledgeSourceServes(agentsOnly, player(ADA, BRAND_A), NOW)).toBe(false);
    expect(knowledgeSourceServes(agentsOnly, player(null, null), NOW)).toBe(false);
    expect(knowledgeSourceServes(agentsOnly, { audience: 'copilot', brandId: BRAND_A }, NOW)).toBe(
      true,
    );
    for (const audiences of [['ai_agent'], ['ai_agent', 'copilot']]) {
      expect(knowledgeSourceServes(source({ audiences }), player(ADA, null), NOW)).toBe(true);
      expect(knowledgeSourceServes(source({ audiences }), { audience: 'copilot' }, NOW)).toBe(true);
    }
  });

  it('narrows the AI agent to its own sources and every agent’s, and leaves Copilot unnarrowed', () => {
    const adas = source({ aiAgentIds: [ADA] });
    expect(knowledgeSourceServes(adas, player(ADA, null), NOW)).toBe(true);
    expect(knowledgeSourceServes(adas, player(BEA, null), NOW)).toBe(false);
    // A turn with no agent of its own reads every AI-agent source.
    expect(knowledgeSourceServes(adas, player(null, null), NOW)).toBe(true);
    expect(knowledgeSourceServes(source(), player(BEA, null), NOW)).toBe(true);
    expect(knowledgeSourceServes(adas, { audience: 'copilot', brandId: null }, NOW)).toBe(true);
  });

  it('keeps a brand’s source from another brand and from a conversation whose brand is not known (ADR §2.4)', () => {
    const brandA = source({ brandIds: [BRAND_A] });
    expect(knowledgeSourceServes(brandA, player(ADA, BRAND_A), NOW)).toBe(true);
    expect(knowledgeSourceServes(brandA, player(ADA, BRAND_B), NOW)).toBe(false);
    expect(knowledgeSourceServes(brandA, player(ADA, null), NOW)).toBe(false);
    expect(knowledgeSourceServes(brandA, { audience: 'copilot', brandId: BRAND_B }, NOW)).toBe(
      false,
    );
    expect(knowledgeSourceServes(brandA, { audience: 'copilot', brandId: null }, NOW)).toBe(false);
    // Copilot outside any conversation: no brand narrows it.
    expect(knowledgeSourceServes(brandA, { audience: 'copilot' }, NOW)).toBe(true);
    // Every brand's source serves every brand, and the unknown one.
    for (const brandId of [BRAND_A, BRAND_B, null]) {
      expect(knowledgeSourceServes(source(), player(ADA, brandId), NOW)).toBe(true);
    }
    expect(
      knowledgeSourceServes(source({ brandIds: [BRAND_A, BRAND_B] }), player(ADA, BRAND_B), NOW),
    ).toBe(true);
  });

  it('ends a source at valid_until — strictly after it answers nothing, a due review does not', () => {
    const ending = (at: Date) => source({ validUntil: at });
    expect(knowledgeSourceServes(ending(new Date(NOW.getTime() + 1)), player(ADA, null), NOW)).toBe(
      true,
    );
    expect(knowledgeSourceServes(ending(NOW), player(ADA, null), NOW)).toBe(false);
    expect(
      knowledgeSourceServes(ending(new Date(NOW.getTime() - 1)), { audience: 'copilot' }, NOW),
    ).toBe(false);
  });
});
